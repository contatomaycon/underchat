import { injectable, inject } from 'tsyringe';
import { AdminClient, LibrdKafkaError } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { ITopicMetadata } from '@core/common/interfaces/ITopicMetadata';
import { toError, getErrorMessage } from '@core/common/functions/toError';

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

  private async getMetadata(): Promise<ITopicMetadata> {
    return new Promise<ITopicMetadata>((resolve, reject) => {
      (this.admin as any).getMetadata(
        { timeout: 5000 },
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

  private async createSingleTopic(
    topic: string,
    numPartitions: number,
    replicationFactor: number
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
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
  }

  async createTopics(
    topics: string[],
    numPartitions = 1,
    replicationFactor = 1
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
        this.createSingleTopic(topic, numPartitions, replicationFactor)
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
