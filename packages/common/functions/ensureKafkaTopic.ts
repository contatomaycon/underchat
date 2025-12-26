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
  timeout = 5000,
  topic?: string
): Promise<ITopicMetadata> {
  return new Promise<ITopicMetadata>((resolve, reject) => {
    const options = topic ? { timeout, topic } : { timeout };
    (admin as any).getMetadata(
      options,
      (err: LibrdKafkaError | null, data: ITopicMetadata) => {
        if (err) {
          reject(toError(err));
          return;
        }
        resolve(data);
      }
    );
  });
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
  replicationFactor: number
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    (admin as any).createTopic(
      {
        topic,
        num_partitions: numPartitions,
        replication_factor: replicationFactor,
      },
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
  let lastError: Error | null = null;
  let lastState: {
    exists: boolean;
    totalPartitions: number;
    readyPartitions: number;
  } | null = null;

  while (true) {
    let metadata: ITopicMetadata | null = null;

    try {
      metadata = await getMetadata(admin, 5000, topic);
      lastState = getTopicState(metadata, topic);
    } catch (error) {
      lastError = toError(error);
    }

    if (metadata) {
      const topicInfo = getTopicInfo(metadata, topic);
      if (isTopicReady(topicInfo, numPartitions)) {
        return;
      }
    }

    if (Date.now() - start > timeoutMs) {
      const stateHint = lastState
        ? lastState.exists
          ? ` (ready partitions: ${lastState.readyPartitions}/${Math.max(
              lastState.totalPartitions,
              numPartitions
            )})`
          : ' (topic not visible in metadata yet)'
        : '';
      const errorHint = lastError
        ? ` (last metadata error: ${lastError.message})`
        : '';

      throw new Error(`Topic not ready: ${topic}${stateHint}${errorHint}`);
    }

    await wait(500);
  }
}

export async function ensureKafkaTopic(
  kafka: KafkaClient,
  topic: string,
  numPartitions = 1,
  replicationFactor = 1,
  timeoutMs = 60000
): Promise<void> {
  const admin = createAdminClient(kafka);

  try {
    let metadata: ITopicMetadata | null = null;

    try {
      metadata = await getMetadata(admin, 5000, topic);
    } catch {
      metadata = null;
    }

    const exists = topicExists(metadata, topic);

    if (!exists) {
      await createTopic(admin, topic, numPartitions, replicationFactor);
    }

    await waitForTopicReady(admin, topic, numPartitions, timeoutMs);
  } finally {
    (admin as any).disconnect();
  }
}
