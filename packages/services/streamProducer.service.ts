import { injectable, inject } from 'tsyringe';
import { Producer, LibrdKafkaError } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { toError, getErrorMessage } from '@core/common/functions/toError';
import { ulid } from 'ulid';
import { IPendingMessage } from '@core/common/interfaces/IPendingMessage';

@injectable()
export class StreamProducerService {
  private producer: Producer | null = null;
  private pollingInterval: NodeJS.Timeout | null = null;
  private pendingMessages: Map<string, IPendingMessage> = new Map();
  private static readonly MAX_RETRIES = 3;
  private static readonly INITIAL_BACKOFF_MS = 100;
  private static readonly POLL_INTERVAL_MS = 100;
  private static readonly DELIVERY_TIMEOUT_MS = 5000;
  private static readonly MAX_QUEUE_FULL_RETRIES = 3;
  private static readonly QUEUE_FULL_BACKOFF_MS = 50;

  constructor(@inject('Kafka') private readonly kafka: KafkaClient) {}

  private setupDeliveryReportListener(producer: Producer): void {
    producer.on(
      'delivery-report',
      (err: LibrdKafkaError | null, report: any) => {
        const correlationId = report?.opaque;
        if (!correlationId) {
          return;
        }

        const pending = this.pendingMessages.get(correlationId);
        if (!pending) {
          return;
        }

        this.pendingMessages.delete(correlationId);
        clearTimeout(pending.timeoutHandle);

        if (err) {
          if (this.isDisconnectedError(err)) {
            this.invalidateProducer();
          }
          pending.reject(toError(err));
          return;
        }

        pending.resolve();
      }
    );
  }

  private startPolling(producer: Producer): void {
    if (this.pollingInterval) {
      return;
    }

    this.pollingInterval = setInterval(() => {
      try {
        producer.poll();
      } catch (error) {
        console.error('Error during producer polling:', error);
      }
    }, StreamProducerService.POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (!this.pollingInterval) {
      return;
    }

    clearInterval(this.pollingInterval);
    this.pollingInterval = null;
  }

  private async ensureProducer(): Promise<Producer> {
    if (this.producer) {
      return this.producer;
    }

    this.producer = this.kafka.createProducer();

    const producer = this.producer;
    if (!producer) {
      throw new Error('Producer not initialized');
    }

    await new Promise<void>((resolve, reject) => {
      let isResolved = false;
      const timeout = setTimeout(() => {
        if (isResolved) {
          return;
        }

        isResolved = true;
        this.producer = null;
        producer.removeAllListeners();
        try {
          producer.disconnect(() => {});
        } catch {}
        const broker = this.kafka.getBroker();
        reject(
          new Error(
            `Kafka producer connection timeout after 60s. Broker: ${broker}. Verifique se o Kafka está acessível e se as configurações estão corretas.`
          )
        );
      }, 60000);

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
        }
        producer.removeAllListeners('ready');
        producer.removeAllListeners('event.error');
      };

      const errorHandler = (err: LibrdKafkaError) => {
        if (isResolved) {
          return;
        }

        isResolved = true;
        cleanup();
        this.producer = null;
        try {
          producer.disconnect(() => {});
        } catch {}
        reject(toError(err));
      };

      const readyHandler = () => {
        if (isResolved) {
          return;
        }

        isResolved = true;
        cleanup();
        this.setupDeliveryReportListener(producer);
        this.startPolling(producer);
        resolve();
      };

      producer.once('ready', readyHandler);
      producer.once('event.error', errorHandler);

      producer.on('event.error', (err: LibrdKafkaError) => {
        console.error('Kafka producer error:', err);
        if (this.isDisconnectedError(err)) {
          this.invalidateProducer();
        }
      });

      producer.connect({}, (err) => {
        if (!err) {
          return;
        }

        if (isResolved) {
          return;
        }

        isResolved = true;
        cleanup();
        this.producer = null;
        reject(toError(err));
      });
    });

    return this.producer;
  }

  private invalidateProducer(): void {
    this.rejectAllPendingMessages(
      new Error('Producer invalidated due to disconnection')
    );
    this.stopPolling();
    if (!this.producer) {
      return;
    }

    try {
      const producer = this.producer;
      producer.removeAllListeners();
      producer.disconnect(() => {});
    } catch {}
    this.producer = null;
  }

  private rejectAllPendingMessages(error: Error): void {
    const pending = Array.from(this.pendingMessages.values());
    this.pendingMessages.clear();

    for (const message of pending) {
      clearTimeout(message.timeoutHandle);
      message.reject(error);
    }
  }

  private async reconnectProducer(): Promise<Producer> {
    this.stopPolling();
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
      errorMessage.includes('not connected') ||
      errorMessage.includes('Producer not connected') ||
      errorMessage.includes('write after end') ||
      errorMessage.includes('broker transport failure') ||
      errorMessage.includes('all broker connections are down') ||
      errorMessage.includes('Flush timeout') ||
      errorMessage.includes('flush timeout') ||
      errorMessage.includes('connection timeout') ||
      errorMessage.includes('timed out') ||
      errorMessage.includes('timeout')
    );
  }

  private isQueueFullError(error: unknown): boolean {
    if (!error) {
      return false;
    }

    const errorMessage = getErrorMessage(error);
    const errorCode =
      typeof error === 'object' && 'code' in error ? error.code : null;

    return (
      errorCode === -184 ||
      errorMessage.includes('Local: Queue full') ||
      errorMessage.includes('queue full') ||
      errorMessage.includes('ERR__QUEUE_FULL')
    );
  }

  private async produceMessage(
    producer: Producer,
    topic: string,
    value: Buffer,
    keyBuffer: Buffer | undefined
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const correlationId = ulid();

      const timeoutHandle = setTimeout(() => {
        const pending = this.pendingMessages.get(correlationId);
        if (!pending) {
          return;
        }

        this.pendingMessages.delete(correlationId);
        reject(
          new Error(
            `Message delivery timeout after ${StreamProducerService.DELIVERY_TIMEOUT_MS}ms`
          )
        );
      }, StreamProducerService.DELIVERY_TIMEOUT_MS);

      this.pendingMessages.set(correlationId, {
        resolve,
        reject,
        timeoutHandle,
      });

      const produceError = producer.produce(
        topic,
        null,
        value,
        keyBuffer,
        Date.now(),
        correlationId
      );

      if (produceError === null || produceError === undefined) {
        return;
      }

      const pending = this.pendingMessages.get(correlationId);
      if (!pending) {
        return;
      }

      this.pendingMessages.delete(correlationId);
      clearTimeout(pending.timeoutHandle);

      if (typeof produceError === 'number' && produceError < 0) {
        const error = new Error(
          `Failed to produce message: librdkafka error code ${produceError}`
        );
        if (this.isDisconnectedError(error)) {
          this.invalidateProducer();
        }
        reject(error);
        return;
      }

      if (produceError instanceof Error) {
        if (this.isDisconnectedError(produceError)) {
          this.invalidateProducer();
        }
        reject(produceError);
        return;
      }

      if (typeof produceError === 'string') {
        const error = new Error(produceError);
        if (this.isDisconnectedError(error)) {
          this.invalidateProducer();
        }
        reject(error);
        return;
      }
    });
  }

  private async produceWithQueueFullRetry(
    producer: Producer,
    topic: string,
    value: Buffer,
    keyBuffer: Buffer | undefined,
    attempt = 0
  ): Promise<void> {
    try {
      await this.produceMessage(producer, topic, value, keyBuffer);
    } catch (error) {
      const isQueueFull = this.isQueueFullError(error);

      if (!isQueueFull) {
        throw error;
      }

      if (attempt >= StreamProducerService.MAX_QUEUE_FULL_RETRIES) {
        throw new Error(
          `Kafka queue full after ${StreamProducerService.MAX_QUEUE_FULL_RETRIES} retries. Backpressure exceeded.`
        );
      }

      const backoffMs =
        StreamProducerService.QUEUE_FULL_BACKOFF_MS * (attempt + 1);
      await this.delay(backoffMs);

      return this.produceWithQueueFullRetry(
        producer,
        topic,
        value,
        keyBuffer,
        attempt + 1
      );
    }
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
      await this.produceWithQueueFullRetry(producer, topic, value, keyBuffer);
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

    const producer = this.producer;

    try {
      await new Promise<void>((resolve, reject) => {
        const flushTimeout = setTimeout(() => {
          reject(new Error('Flush timeout during shutdown'));
        }, 10000);

        producer.flush(10000, (err) => {
          clearTimeout(flushTimeout);

          if (err) {
            this.rejectAllPendingMessages(
              new Error('Producer shutdown: flush failed')
            );
            reject(
              new Error(`Flush error during shutdown: ${getErrorMessage(err)}`)
            );
            return;
          }

          resolve();
        });
      });
    } catch (error) {
      console.error('Error during producer flush on shutdown:', error);
      this.rejectAllPendingMessages(
        new Error('Producer shutdown with flush error')
      );
    } finally {
      this.stopPolling();

      try {
        await new Promise<void>((resolve) => {
          producer.disconnect(resolve);
        });
      } catch (error) {
        console.error('Error during producer disconnect:', error);
      }

      this.producer = null;
    }

    return [true];
  }
}
