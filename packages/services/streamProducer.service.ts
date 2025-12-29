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

      const producer = this.producer;
      if (!producer) {
        throw new Error('Producer not initialized');
      }

      await new Promise<void>((resolve, reject) => {
        let isResolved = false;
        const timeout = setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            this.producer = null;
            reject(new Error('Kafka producer connection timeout'));
          }
        }, 15000);

        const errorHandler = (err: LibrdKafkaError) => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeout);
            producer.removeAllListeners('ready');
            producer.removeAllListeners('event.error');
            this.producer = null;
            reject(toError(err));
          }
        };

        const readyHandler = () => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeout);
            producer.removeAllListeners('ready');
            producer.removeAllListeners('event.error');
            resolve();
          }
        };

        producer.once('ready', readyHandler);
        producer.once('event.error', errorHandler);

        producer.on('event.error', (err: LibrdKafkaError) => {
          console.error('Kafka producer error:', err);
        });

        producer.connect({}, (err) => {
          if (err) {
            if (!isResolved) {
              isResolved = true;
              clearTimeout(timeout);
              producer.removeAllListeners('ready');
              producer.removeAllListeners('event.error');
              this.producer = null;
              reject(toError(err));
            }
          }
        });
      });
    }

    return this.producer;
  }

  private invalidateProducer(): void {
    if (this.producer) {
      try {
        const producer = this.producer;
        producer.removeAllListeners();
        producer.disconnect(() => {});
      } catch {}
      this.producer = null;
    }
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
      errorMessage.includes('write after end') ||
      errorMessage.includes('broker transport failure') ||
      errorMessage.includes('all broker connections are down') ||
      errorMessage.includes('Flush timeout')
    );
  }

  private getErrorMessage(err: unknown): string {
    if (err instanceof Error) {
      return err.message;
    }

    if (typeof err === 'string') {
      return err;
    }

    if (typeof err === 'number') {
      return `Flush error code: ${err}`;
    }

    return `Flush error: ${JSON.stringify(err)}`;
  }

  private async produceMessage(
    producer: Producer,
    topic: string,
    value: Buffer,
    keyBuffer: Buffer | undefined
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let isResolved = false;
      let lastError: LibrdKafkaError | null = null;
      let timeout: NodeJS.Timeout | null = null;

      const errorHandler = (err: LibrdKafkaError) => {
        lastError = err;
        const errorMessage = err.message || 'Unknown Kafka error';

        if (
          errorMessage.includes('broker transport failure') ||
          errorMessage.includes('all broker connections are down')
        ) {
          if (!isResolved) {
            isResolved = true;
            if (timeout) {
              clearTimeout(timeout);
            }
            this.invalidateProducer();
            reject(new Error(`Kafka connection error: ${errorMessage}`));
          }
        }
      };

      producer.once('event.error', errorHandler);

      const produceError = producer.produce(
        topic,
        null,
        value,
        keyBuffer,
        Date.now(),
        (err: LibrdKafkaError | null) => {
          if (isResolved) {
            return;
          }

          if (err) {
            isResolved = true;
            if (timeout) {
              clearTimeout(timeout);
            }
            producer.removeListener('event.error', errorHandler);
            const errorMessage = err.message || '';
            if (
              errorMessage.includes('broker transport failure') ||
              errorMessage.includes('all broker connections are down')
            ) {
              this.invalidateProducer();
            }
            reject(toError(err));
          }
        }
      );

      if (produceError !== null && produceError !== undefined) {
        if (typeof produceError === 'number' && produceError < 0) {
          producer.removeListener('event.error', errorHandler);
          const error = new Error(
            `Failed to produce message: librdkafka error code ${produceError}`
          );
          reject(error);
          return;
        }

        if (produceError instanceof Error) {
          producer.removeListener('event.error', errorHandler);
          reject(produceError);
          return;
        }

        if (typeof produceError === 'string') {
          producer.removeListener('event.error', errorHandler);
          reject(new Error(produceError));
          return;
        }

        if (typeof produceError === 'number' && produceError >= 0) {
          return;
        }
      }

      producer.poll();

      timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          producer.removeListener('event.error', errorHandler);

          if (lastError) {
            reject(
              new Error(
                `Flush timeout: ${lastError.message || 'Kafka connection error'}`
              )
            );
            return;
          }

          reject(new Error('Flush timeout: message not sent within 5 seconds'));
        }
      }, 5000);

      producer.flush(5000, (err) => {
        if (timeout) {
          clearTimeout(timeout);
        }
        producer.removeListener('event.error', errorHandler);

        if (isResolved) {
          return;
        }

        isResolved = true;

        if (err) {
          const errorMessage = this.getErrorMessage(err);

          if (
            errorMessage.includes('broker transport failure') ||
            errorMessage.includes('all broker connections are down') ||
            errorMessage.includes('timed out')
          ) {
            this.invalidateProducer();
          }

          reject(new Error(errorMessage));
          return;
        }

        resolve();
      });
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
