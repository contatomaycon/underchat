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
    const metadata = await this.getMetadata(3000);
    if (!metadata) {
      return [];
    }
    return metadata.topics.map((t) => t.name);
  }

  private async getMetadata(timeout = 5000): Promise<ITopicMetadata | null> {
    try {
      return await new Promise<ITopicMetadata | null>((resolve, reject) => {
        (this.admin as any).getMetadata(
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

  private async waitForMetadataReady(
    timeoutMs: number,
    pollIntervalMs = 300
  ): Promise<ITopicMetadata> {
    const start = Date.now();

    while (true) {
      const metadata = await this.getMetadata(3000);
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
    let lastState: {
      exists: boolean;
      totalPartitions: number;
      readyPartitions: number;
    } | null = null;

    while (true) {
      const metadata = await this.getMetadata(3000);

      if (metadata) {
        lastState = this.getTopicState(metadata, topic);

        if (lastState.exists && lastState.readyPartitions >= numPartitions) {
          return;
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

  private async createSingleTopic(
    topic: string,
    numPartitions: number,
    replicationFactor: number,
    timeoutMs: number
  ): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
        (this.admin as any).createTopic(
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
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      const errorCode = (error as any)?.code ?? (error as any)?.errno;

      if (
        errorCode === 36 ||
        errorMessage.includes('Topic already exists') ||
        errorMessage.includes('already exists')
      ) {
      } else {
        throw error;
      }
    }

    await wait(200);
    await this.waitForTopicReady(topic, numPartitions, timeoutMs);
  }

  async createTopics(
    topics: string[],
    numPartitions = 1,
    replicationFactor = 1,
    timeoutMs = 30000
  ): Promise<void> {
    if (topics.length === 0) {
      return;
    }

    const metadata = await this.waitForMetadataReady(timeoutMs);
    const existingTopics = metadata.topics.map((t) => t.name);
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
