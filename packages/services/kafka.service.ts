import { injectable, inject } from 'tsyringe';
import { AdminClient, LibrdKafkaError } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { kafkaEnvironment } from '@core/config/environments';
import { toError, getErrorMessage } from '@core/common/functions/toError';

@injectable()
export class KafkaService {
  private readonly admin: AdminClient;

  constructor(@inject('Kafka') private readonly kafka: KafkaClient) {
    const protocol = kafkaEnvironment.securityProtocol.toLowerCase();

    const config: Record<string, string | boolean> = {
      'client.id': 'kafka-admin',
      'metadata.broker.list': this.kafka.getBroker(),
      'security.protocol': protocol,
      'sasl.mechanism': kafkaEnvironment.saslMechanism,
      'sasl.username': kafkaEnvironment.kafkaUsername,
      'sasl.password': kafkaEnvironment.kafkaPassword,
    };

    if (protocol === 'sasl_ssl' || protocol === 'ssl') {
      config['enable.ssl.certificate.verification'] = false;
    }

    this.admin = AdminClient.create(config);
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
  }

  private async deleteSingleTopic(
    topic: string,
    timeoutMs: number
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      (this.admin as any).deleteTopic(
        topic,
        timeoutMs,
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

  async createTopics(
    topics: string[],
    numPartitions = 1,
    replicationFactor = 1,
    timeoutMs = 30000
  ): Promise<void> {
    if (topics.length === 0) {
      return;
    }

    await Promise.all(
      topics.map((topic) =>
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

    await Promise.all(
      topics.map((topic) => this.deleteSingleTopic(topic, 5000))
    );
  }

  async close(): Promise<void> {
    (this.admin as any).disconnect();
  }
}
