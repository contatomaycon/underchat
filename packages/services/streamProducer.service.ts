import { injectable, inject } from 'tsyringe';
import { Producer, LibrdKafkaError } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { toError, getErrorMessage } from '@core/common/functions/toError';

@injectable()
export class StreamProducerService {
  private producer: Producer | null = null;
  private static readonly MAX_RETRIES = 3;
  private static readonly INITIAL_BACKOFF_MS = 100;

  constructor(@inject('Kafka') private readonly kafka: KafkaClient) {}

  private async ensureProducer(): Promise<Producer> {
    if (!this.producer) {
      this.producer = this.kafka.createProducer();

      this.producer.on('event.error', (err: LibrdKafkaError) => {
        console.error('Kafka producer error:', err);
      });

      const producer = this.producer;
      if (!producer) {
        throw new Error('Producer not initialized');
      }

      await new Promise<void>((resolve, reject) => {
        producer.connect({}, (err) => {
          if (err) {
            reject(toError(err));
            return;
          }
          resolve();
        });
      });
    }

    return this.producer;
  }

  private async reconnectProducer(): Promise<Producer> {
    if (this.producer) {
      try {
        const producer = this.producer;
        if (producer) {
          await new Promise<void>((resolve) => {
            producer.disconnect(resolve);
          });
        }
      } catch {}
      this.producer = null;
    }

    return this.ensureProducer();
  }

  private isDisconnectedError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const errorMessage = getErrorMessage(error);
    const errorCode = 'code' in error ? error.code : null;

    return (
      errorMessage.includes('disconnected') ||
      errorCode === 'ECONNREFUSED' ||
      errorMessage.includes('NOT_CONNECTED') ||
      errorMessage.includes('write after end')
    );
  }

  private async produceMessage(
    producer: Producer,
    topic: string,
    value: Buffer,
    keyBuffer: Buffer | undefined
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      producer.produce(
        topic,
        null,
        value,
        keyBuffer,
        Date.now(),
        (err: LibrdKafkaError | null) => {
          if (err) {
            reject(toError(err));
            return;
          }
          resolve();
        }
      );
    });
  }

  private calculateBackoff(attempt: number): number {
    return StreamProducerService.INITIAL_BACKOFF_MS * (attempt + 1);
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async sendWithRetry(
    topic: string,
    value: Buffer,
    keyBuffer: Buffer | undefined,
    attempt = 0
  ): Promise<void> {
    if (attempt >= StreamProducerService.MAX_RETRIES) {
      throw new Error(
        `Failed to send message after ${StreamProducerService.MAX_RETRIES} attempts`
      );
    }

    try {
      const producer = await this.ensureProducer();
      await this.produceMessage(producer, topic, value, keyBuffer);
    } catch (error) {
      const isDisconnected = this.isDisconnectedError(error);

      if (!isDisconnected) {
        throw error;
      }

      if (attempt < StreamProducerService.MAX_RETRIES - 1) {
        await this.reconnectProducer();
        const backoffMs = this.calculateBackoff(attempt);
        await this.delay(backoffMs);
        return this.sendWithRetry(topic, value, keyBuffer, attempt + 1);
      }

      throw error;
    }
  }

  async send(topic: string, payload: unknown, key?: string): Promise<void> {
    const value = Buffer.from(JSON.stringify(payload));
    const keyBuffer = key ? Buffer.from(key) : undefined;

    await this.sendWithRetry(topic, value, keyBuffer);
  }

  async close(): Promise<boolean[]> {
    if (!this.producer) {
      return [];
    }

    try {
      const producer = this.producer;
      if (!producer) {
        return [];
      }

      await new Promise<void>((resolve) => {
        producer.disconnect(resolve);
      });

      return [true];
    } finally {
      this.producer = null;
    }
  }
}
