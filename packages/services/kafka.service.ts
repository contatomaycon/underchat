import { injectable, inject } from 'tsyringe';
import { AdminClient, LibrdKafkaError } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { ITopicMetadata } from '@core/common/interfaces/ITopicMetadata';
import { toError, getErrorMessage } from '@core/common/functions/toError';
import { wait } from '@core/common/functions/wait';

@injectable()
export class KafkaService {
  private readonly admin: AdminClient;

  constructor(@inject('Kafka') private readonly kafka: KafkaClient) {
    this.admin = AdminClient.create({
      'client.id': 'kafka-admin',
      'metadata.broker.list': this.kafka.getBroker(),
    });
  }

  private async getExistingTopics(): Promise<string[]> {
    const metadata = await this.getMetadata(5000, 3);
    if (!metadata) {
      return [];
    }
    return metadata.topics.map((t) => t.name);
  }

  private async getMetadata(
    timeout = 5000,
    retries = 3
  ): Promise<ITopicMetadata | null> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await new Promise<ITopicMetadata>((resolve, reject) => {
          (this.admin as any).getMetadata(
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

  private getTopicState(
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

  private async waitForTopicReady(
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
      const metadata = await this.getMetadata(5000, 2);

      if (metadata) {
        consecutiveErrors = 0;
        lastState = this.getTopicState(metadata, topic);

        if (lastState.exists) {
          consecutiveNotFound = 0;

          if (lastState.readyPartitions >= numPartitions) {
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
          lastError = new Error(
            'Failed to get metadata after multiple attempts'
          );
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

  private async createSingleTopic(
    topic: string,
    numPartitions: number,
    replicationFactor: number,
    timeoutMs: number
  ): Promise<void> {
    const retries = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        await new Promise<void>((resolve, reject) => {
          (this.admin as any).createTopic(
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
                  errorMessage.includes('already exists') ||
                  (errorMessage.toLowerCase().includes('topic') &&
                    errorMessage.toLowerCase().includes('exists'))
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

        await wait(500);

        for (let i = 0; i < 5; i++) {
          const metadata = await this.getMetadata(5000, 2);
          const exists = metadata
            ? metadata.topics.some((t) => t.name === topic)
            : false;

          if (exists) {
            break;
          }

          await wait(300 * (i + 1));
        }

        await this.waitForTopicReady(topic, numPartitions, timeoutMs);
        return;
      } catch (error) {
        lastError = toError(error);
        const errorMessage = getErrorMessage(error);
        const errorCode = (error as any)?.code ?? (error as any)?.errno;

        if (
          errorCode === 36 ||
          errorMessage.includes('Topic already exists') ||
          errorMessage.includes('already exists')
        ) {
          await this.waitForTopicReady(topic, numPartitions, timeoutMs);
          return;
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
        await this.waitForTopicReady(topic, numPartitions, timeoutMs);
        return;
      }

      throw lastError;
    }
  }

  async createTopics(
    topics: string[],
    numPartitions = 1,
    replicationFactor = 1,
    timeoutMs = 90000
  ): Promise<void> {
    if (topics.length === 0) {
      return;
    }

    const existingTopics = await this.getExistingTopics();
    const topicsToCreate = topics.filter(
      (topic) => !existingTopics.includes(topic)
    );

    if (topicsToCreate.length === 0) {
      return;
    }

    await Promise.all(
      topicsToCreate.map((topic) =>
        this.createSingleTopic(
          topic,
          numPartitions,
          replicationFactor,
          timeoutMs
        )
      )
    );
  }

  async deleteTopics(topics: string[]): Promise<void> {
    if (topics.length === 0) {
      return;
    }

    const existingTopics = await this.getExistingTopics();
    const topicsToDelete = topics.filter((topic) =>
      existingTopics.includes(topic)
    );

    if (topicsToDelete.length === 0) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      (this.admin as any).deleteTopic(
        topicsToDelete,
        5000,
        (err: LibrdKafkaError | null) => {
          if (err) {
            const errorMessage = getErrorMessage(err);

            if (
              errorMessage.includes(
                'This server does not host this topic-partition'
              ) ||
              errorMessage.includes('UNKNOWN_TOPIC_OR_PART')
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

  async close(): Promise<void> {
    (this.admin as any).disconnect();
  }
}
