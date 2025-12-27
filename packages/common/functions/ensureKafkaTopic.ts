import { AdminClient, LibrdKafkaError } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { wait } from './wait';
import { ITopicMetadata } from '@core/common/interfaces/ITopicMetadata';
import { ITopicInfo } from '@core/common/interfaces/ITopicInfo';
import { toError, getErrorMessage } from './toError';

function createAdminClient(kafka: KafkaClient): AdminClient {
  return AdminClient.create({
    'client.id': 'kafka-admin',
    'metadata.broker.list': kafka.getBroker(),
  });
}

async function getMetadata(
  admin: AdminClient,
  timeout = 3000
): Promise<ITopicMetadata | null> {
  try {
    return await new Promise<ITopicMetadata | null>((resolve, reject) => {
      (admin as any).getMetadata(
        { timeout },
        (err: LibrdKafkaError | null, data: ITopicMetadata) => {
          if (err) {
            const errorCode = (err as any).code ?? (err as any).errno;
            if (errorCode === -185) {
              resolve(null);
              return;
            }
            reject(toError(err));
            return;
          }
          resolve(data);
        }
      );
    });
  } catch (error) {
    const errorCode = (error as any)?.code ?? (error as any)?.errno;
    if (errorCode === -185) {
      return null;
    }
    return null;
  }
}

async function waitForMetadataReady(
  admin: AdminClient,
  timeoutMs: number,
  pollIntervalMs = 300
): Promise<ITopicMetadata> {
  const start = Date.now();

  while (true) {
    const metadata = await getMetadata(admin, 3000);
    if (metadata) {
      return metadata;
    }

    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Kafka metadata request timed out after ${timeoutMs}ms`
      );
    }

    await wait(pollIntervalMs);
  }
}

function topicExists(
  metadata: ITopicMetadata | null,
  topicName: string
): boolean {
  if (!metadata?.topics) {
    return false;
  }

  return metadata.topics.some((t) => t.name === topicName);
}

function getTopicInfo(
  metadata: ITopicMetadata | null,
  topicName: string
): ITopicInfo | null {
  if (!metadata?.topics) {
    return null;
  }

  const topic = metadata.topics.find((t) => t.name === topicName);
  if (!topic?.partitions) {
    return null;
  }

  return {
    name: topic.name,
    partitions: topic.partitions.filter(
      (p): p is { leader: number } =>
        typeof p.leader === 'number' && p.leader >= 0
    ),
  };
}

function getTopicState(
  metadata: ITopicMetadata | null,
  topicName: string
): { exists: boolean; totalPartitions: number; readyPartitions: number } {
  if (!metadata?.topics) {
    return { exists: false, totalPartitions: 0, readyPartitions: 0 };
  }

  const topic = metadata.topics.find((t) => t.name === topicName);
  if (!topic) {
    return { exists: false, totalPartitions: 0, readyPartitions: 0 };
  }

  const totalPartitions = topic.partitions?.length ?? 0;
  const readyPartitions =
    topic.partitions?.filter(
      (p) => typeof p.leader === 'number' && p.leader >= 0
    ).length ?? 0;

  return { exists: true, totalPartitions, readyPartitions };
}

async function createTopic(
  admin: AdminClient,
  topic: string,
  numPartitions: number,
  replicationFactor: number,
  timeoutMs: number
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    (admin as any).createTopic(
      {
        topic,
        num_partitions: numPartitions,
        replication_factor: replicationFactor,
      },
      timeoutMs,
      (err: LibrdKafkaError | null) => {
        if (err) {
          const errorMessage = getErrorMessage(err);
          const errorCode = (err as any).code ?? (err as any).errno;

          if (
            errorCode === 36 ||
            errorMessage.includes('Topic already exists') ||
            errorMessage.includes('already exists')
          ) {
            resolve();
            return;
          }

          reject(toError(err));
          return;
        }
        resolve();
      }
    );
  });
}

function isTopicReady(
  topicInfo: ITopicInfo | null,
  requiredPartitions: number
): boolean {
  if (!topicInfo) {
    return false;
  }

  return (
    topicInfo.partitions.length >= requiredPartitions &&
    topicInfo.partitions.every((p) => typeof p.leader === 'number')
  );
}

async function waitForTopicReady(
  admin: AdminClient,
  topic: string,
  numPartitions: number,
  timeoutMs: number
): Promise<void> {
  const start = Date.now();
  let lastState: {
    exists: boolean;
    totalPartitions: number;
    readyPartitions: number;
  } | null = null;

  while (true) {
    const metadata = await getMetadata(admin, 3000);

    if (metadata) {
      lastState = getTopicState(metadata, topic);

      if (lastState.exists) {
        const topicInfo = getTopicInfo(metadata, topic);

        if (isTopicReady(topicInfo, numPartitions)) {
          return;
        }
      }
    }

    const elapsed = Date.now() - start;
    if (elapsed > timeoutMs) {
      if (lastState?.exists && lastState.readyPartitions > 0) {
        return;
      }

      const stateHint = lastState
        ? lastState.exists
          ? ` (ready partitions: ${lastState.readyPartitions}/${numPartitions})`
          : ' (topic not visible in metadata)'
        : ' (metadata unavailable)';

      throw new Error(`Topic not ready: ${topic}${stateHint}`);
    }

    await wait(300);
  }
}

export async function ensureKafkaTopic(
  kafka: KafkaClient,
  topic: string,
  numPartitions = 1,
  replicationFactor = 1,
  timeoutMs = 30000
): Promise<void> {
  const admin = createAdminClient(kafka);

  try {
    const metadata = await waitForMetadataReady(admin, timeoutMs);
    const exists = topicExists(metadata, topic);

    if (!exists) {
      await createTopic(
        admin,
        topic,
        numPartitions,
        replicationFactor,
        timeoutMs
      );
      await wait(200);
    }

    await waitForTopicReady(admin, topic, numPartitions, timeoutMs);
  } finally {
    try {
      (admin as any).disconnect();
    } catch {}
  }
}
