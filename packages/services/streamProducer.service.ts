import { injectable, inject } from 'tsyringe';
import { Kafka, Producer, Partitioners } from 'kafkajs';

@injectable()
export class StreamProducerService {
  private producer: Producer | null = null;

  constructor(@inject('Kafka') private readonly kafka: Kafka) {}

  private async ensureProducer(): Promise<Producer> {
    if (!this.producer) {
      this.producer = this.kafka.producer({
        retry: { retries: 8, initialRetryTime: 300 },
        allowAutoTopicCreation: true,
        createPartitioner: Partitioners.LegacyPartitioner,
      });

      await this.producer.connect();
    }

    return this.producer;
  }

  private async reconnectProducer(): Promise<Producer> {
    if (this.producer) {
      try {
        await this.producer.disconnect();
      } catch {}
      this.producer = null;
    }

    return this.ensureProducer();
  }

  async send(topic: string, payload: unknown, key?: string): Promise<void> {
    const value = JSON.stringify(payload);
    const messages = key === undefined ? [{ value }] : [{ key, value }];

    const maxRetries = 3;
    let lastError: any;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        let producer = await this.ensureProducer();
        await producer.send({ topic, messages });
        return;
      } catch (error: any) {
        lastError = error;

        const isDisconnectedError =
          error?.message?.includes('disconnected') ||
          error?.code === 'ECONNREFUSED' ||
          error?.message?.includes('The producer is disconnected') ||
          error?.type === 'NOT_CONNECTED' ||
          error?.message?.includes('write after end');

        if (isDisconnectedError && attempt < maxRetries - 1) {
          await this.reconnectProducer();
          await new Promise((resolve) =>
            setTimeout(resolve, 100 * (attempt + 1))
          );
          continue;
        }

        if (!isDisconnectedError) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  async close(): Promise<boolean[]> {
    if (!this.producer) {
      return [];
    }

    try {
      await this.producer.disconnect();

      return [true];
    } finally {
      this.producer = null;
    }
  }
}
