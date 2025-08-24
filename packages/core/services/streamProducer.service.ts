import { injectable, inject } from 'tsyringe';
import { Kafka, Producer } from 'kafkajs';

@injectable()
export class StreamProducerService {
  private producer: Producer | null = null;

  constructor(@inject('Kafka') private readonly kafka: Kafka) {}

  private async ensureProducer(): Promise<Producer> {
    if (!this.producer) {
      this.producer = this.kafka.producer({
        retry: { retries: 8, initialRetryTime: 300 },
      });
      await this.producer.connect();
    }
    return this.producer;
  }

  async send(topic: string, payload: unknown, key?: string): Promise<void> {
    const producer = await this.ensureProducer();
    const value = JSON.stringify(payload);
    const messages = key === undefined ? [{ value }] : [{ key, value }];
    await producer.send({ topic, messages });
  }

  async close(): Promise<boolean[]> {
    if (!this.producer) return [];
    try {
      await this.producer.disconnect();
      return [true];
    } finally {
      this.producer = null;
    }
  }
}
