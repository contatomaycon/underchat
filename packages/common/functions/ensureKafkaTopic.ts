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
  timeout = 5000
): Promise<ITopicMetadata | null> {
  return new Promise<ITopicMetadata>((resolve, reject) => {
    (admin as any).getMetadata(
      { timeout },
      (err: LibrdKafkaError | null, data: ITopicMetadata) => {
        if (err) {
          reject(toError(err));
          return;
        }
        resolve(data);
      }
    );
  }).catch(() => null);
}

function topicExists(
  metadata: ITopicMetadata | null,
  topicName: string
): boolean {
  if (!metadata?.topics) {
    return false;
  }

  return metadata.topics.some(
    (t) => t.name === topicName && t.partitions && t.partitions.length > 0
  );
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

          if (errorMessage.includes('Topic already exists')) {
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

  while (true) {
    const metadata = await getMetadata(admin);
    const topicInfo = getTopicInfo(metadata, topic);

    if (isTopicReady(topicInfo, numPartitions)) {
      return;
    }

    if (Date.now() - start > timeoutMs) {
      throw new Error(`Topic not ready: ${topic}`);
    }

    await wait(500);
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
    const metadata = await getMetadata(admin);
    const exists = topicExists(metadata, topic);

    if (!exists) {
      await createTopic(admin, topic, numPartitions, replicationFactor);
    }

    await waitForTopicReady(admin, topic, numPartitions, timeoutMs);
  } finally {
    (admin as any).disconnect();
  }
}
