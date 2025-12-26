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
    const metadata = await this.getMetadata();
    return metadata.topics.map((t) => t.name);
  }

  private async getMetadata(
    timeout = 5000,
    topic?: string
  ): Promise<ITopicMetadata> {
    return new Promise<ITopicMetadata>((resolve, reject) => {
      const options = topic ? { timeout, topic } : { timeout };
      (this.admin as any).getMetadata(
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

    while (true) {
      let metadata: ITopicMetadata | null = null;

      try {
        metadata = await this.getMetadata(5000, topic);
        lastState = this.getTopicState(metadata, topic);
      } catch (error) {
        lastError = toError(error);
      }

      if (metadata && lastState && lastState.readyPartitions >= numPartitions) {
        return;
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

  private async createSingleTopic(
    topic: string,
    numPartitions: number,
    replicationFactor: number,
    timeoutMs: number
  ): Promise<void> {
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

    await this.waitForTopicReady(topic, numPartitions, timeoutMs);
  }

  async createTopics(
    topics: string[],
    numPartitions = 1,
    replicationFactor = 1,
    timeoutMs = 60000
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
