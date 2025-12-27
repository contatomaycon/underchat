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
  retries = 3
): Promise<ITopicMetadata | null> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await new Promise<ITopicMetadata>((resolve, reject) => {
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
      });
    } catch (error) {
      lastError = toError(error);
      if (attempt < retries - 1) {
        await wait(200 * (attempt + 1));
      }
    }
  }

  return null;
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
  retries = 3
): Promise<boolean> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
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

              const lowerMessage = errorMessage.toLowerCase();
              if (
                errorCode === 36 ||
                errorMessage.includes('Topic already exists') ||
                errorMessage.includes('already exists') ||
                (lowerMessage.includes('topic') &&
                  lowerMessage.includes('exists'))
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
      return true;
    } catch (error) {
      lastError = toError(error);
      const errorMessage = getErrorMessage(error);
      const errorCode = (error as any)?.code ?? (error as any)?.errno;

      if (
        errorCode === 36 ||
        errorMessage.includes('Topic already exists') ||
        errorMessage.includes('already exists')
      ) {
        return false;
      }

      if (attempt < retries - 1) {
        await wait(300 * (attempt + 1));
      }
    }
  }

  if (lastError) {
    const errorMessage = getErrorMessage(lastError);
    const errorCode = (lastError as any)?.code ?? (lastError as any)?.errno;

    if (
      errorCode === 36 ||
      errorMessage.includes('Topic already exists') ||
      errorMessage.includes('already exists')
    ) {
      return false;
    }

    throw lastError;
  }

  return true;
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
  let consecutiveErrors = 0;
  let consecutiveNotFound = 0;
  const maxConsecutiveErrors = 5;
  const maxConsecutiveNotFound = 10;
  let waitTime = 200;

  while (true) {
    const metadata = await getMetadata(admin, 5000, 2);

    if (metadata) {
      consecutiveErrors = 0;
      lastState = getTopicState(metadata, topic);

      if (lastState.exists) {
        consecutiveNotFound = 0;
        const topicInfo = getTopicInfo(metadata, topic);

        if (isTopicReady(topicInfo, numPartitions)) {
          return;
        }

        if (lastState.readyPartitions > 0) {
          waitTime = Math.min(waitTime * 1.2, 2000);
        }
      } else {
        consecutiveNotFound++;
        if (consecutiveNotFound > maxConsecutiveNotFound) {
          waitTime = Math.min(waitTime * 1.5, 3000);
        }
      }
    } else {
      consecutiveErrors++;
      consecutiveNotFound++;

      if (consecutiveErrors > maxConsecutiveErrors) {
        lastError = new Error('Failed to get metadata after multiple attempts');
        waitTime = Math.min(waitTime * 2, 5000);
      }
    }

    const elapsed = Date.now() - start;
    if (elapsed > timeoutMs) {
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

      if (lastState?.exists && lastState.readyPartitions > 0) {
        return;
      }

      throw new Error(`Topic not ready: ${topic}${stateHint}${errorHint}`);
    }

    await wait(waitTime);
  }
}

export async function ensureKafkaTopic(
  kafka: KafkaClient,
  topic: string,
  numPartitions = 1,
  replicationFactor = 1,
  timeoutMs = 90000
): Promise<void> {
  const admin = createAdminClient(kafka);

  try {
    let metadata = await getMetadata(admin, 5000, 3);
    let exists = topicExists(metadata, topic);

    if (!exists) {
      const created = await createTopic(
        admin,
        topic,
        numPartitions,
        replicationFactor,
        3
      );

      if (created) {
        await wait(500);
      }

      for (let i = 0; i < 5; i++) {
        metadata = await getMetadata(admin, 5000, 2);
        exists = topicExists(metadata, topic);

        if (exists) {
          break;
        }

        await wait(300 * (i + 1));
      }
    }

    await waitForTopicReady(admin, topic, numPartitions, timeoutMs);
  } finally {
    try {
      (admin as any).disconnect();
    } catch {}
  }
}
