import { injectable, inject } from 'tsyringe';
import type { Producer, LibrdKafkaError, MessageHeader } from 'node-rdkafka';
import type { KafkaClient } from '@core/plugins/kafkaStreams';
import { toError, getErrorMessage } from '@core/common/functions/toError';
import { ulid } from 'ulid';
import { IPendingMessageWithTimestamp } from '@core/common/interfaces/IPendingMessageWithTimestamp';
import { IQueuedMessage } from '@core/common/interfaces/IQueuedMessage';
import { IDeferred } from '@core/common/interfaces/IDeferred';
import {
  buildMessageLifecycleContext,
  getMessageLifecycleContext,
  injectKafkaTraceHeaders,
  isMessageLifecycleDebugEnabled,
  runWithMessageLifecycleContext,
} from '@core/plugins/telemetry/messageLifecycleDebug';

@injectable()
export class StreamProducerService {
  private producer: Producer | null = null;
  private producerReady: Promise<Producer> | null = null;

  private pollTimeout: NodeJS.Timeout | null = null;
  private pollToken = 0;

  private flushTimeout: NodeJS.Timeout | null = null;
  private flushLoop: Promise<void> | null = null;
  private flushFailureCount = 0;

  private reconnecting: Promise<Producer> | null = null;

  private pendingMessages: Map<string, IPendingMessageWithTimestamp> =
    new Map();
  private pendingDrain: IDeferred | null = null;

  private inflight: Set<Promise<void>> = new Set();
  private inflightDrain: IDeferred | null = null;

  private sendQueue: IQueuedMessage[] = [];

  private closing = false;
  private closePromise: Promise<boolean[]> | null = null;

  private metrics = {
    messagesSent: 0,
    messagesFailed: 0,
    messagesRejected: 0,
    reconnections: 0,
    connectionErrors: 0,
    queueFullErrors: 0,
    deliveryTimeouts: 0,
    totalLatencyMs: 0,
    lastMessageTime: 0,
  };

  // Retry - alinhado com producer config (retry.backoff.ms: 100, retry.backoff.max.ms: 1000)
  private static readonly MAX_RETRIES = 10;
  private static readonly INITIAL_BACKOFF_MS = 100;
  private static readonly MAX_BACKOFF_MS = 1000;

  // Polling - otimizado para chat real-time
  private static readonly POLL_INTERVAL_MS = 5;
  private static readonly DELIVERY_TIMEOUT_MS = 30000;

  // Queue full handling
  private static readonly MAX_QUEUE_FULL_RETRIES = 3;
  private static readonly QUEUE_FULL_BACKOFF_BASE_MS = 25;
  private static readonly QUEUE_FULL_BACKOFF_MAX_MS = 500;

  // Batching - alinhado com environment (batchNumMessages: 50)
  private static readonly MAX_INFLIGHT_MESSAGES = 10000;
  private static readonly MAX_BATCH_SIZE = 50;
  private static readonly BATCH_FLUSH_MS = 5;
  private static readonly MAX_CONCURRENT_SENDS = 50;

  // Timeouts - alinhado com socket.timeout.ms (10000)
  private static readonly CONNECTION_TIMEOUT_MS = 10000;
  private static readonly SHUTDOWN_FLUSH_TIMEOUT_MS = 60000;
  private static readonly RECONNECT_TIMEOUT_MS = 10000;

  constructor(@inject('Kafka') private readonly kafka: KafkaClient) {}

  private isMessageLifecyclePayload(payload: unknown): boolean {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'worker_id' in payload &&
      'account_id' in payload &&
      'message' in payload
    );
  }

  private readonly deliveryReportHandler = (
    err: LibrdKafkaError | null,
    report: any
  ): void => {
    const correlationId = report?.opaque;
    if (!correlationId) {
      return;
    }

    const pending = this.pendingMessages.get(correlationId);
    if (!pending) {
      return;
    }

    if (pending.timeoutFired) {
      return;
    }

    const startTime = pending.startTime;
    this.pendingMessages.delete(correlationId);
    clearTimeout(pending.timeoutHandle);

    if (err) {
      if (this.isDisconnectedError(err)) {
        this.invalidateProducerForReconnect(toError(err));
      }
      this.metrics.messagesFailed += 1;
      pending.reject(toError(err));
      this.signalPendingDrain();
      return;
    }

    const latency = Date.now() - startTime;
    this.metrics.messagesSent += 1;
    this.metrics.totalLatencyMs += latency;
    this.metrics.lastMessageTime = Date.now();
    pending.resolve();
    this.signalPendingDrain();
  };

  private readonly runtimeErrorHandler = (err: LibrdKafkaError): void => {
    this.metrics.connectionErrors += 1;
    console.error('Kafka producer error:', {
      error: getErrorMessage(err),
      code: 'code' in err ? (err as any).code : null,
      metrics: this.getMetrics(),
    });
    if (!this.isDisconnectedError(err)) {
      return;
    }

    this.invalidateProducerForReconnect(toError(err));
  };

  private setupDeliveryReportListener(producer: Producer): void {
    producer.removeListener('delivery-report', this.deliveryReportHandler);
    producer.on('delivery-report', this.deliveryReportHandler);
  }

  private setupRuntimeErrorListener(producer: Producer): void {
    producer.removeListener('event.error', this.runtimeErrorHandler);
    producer.on('event.error', this.runtimeErrorHandler);
  }

  private schedulePoll(immediate = false): void {
    if (this.closing) {
      return;
    }

    const existingTimeout = this.pollTimeout;
    if (existingTimeout) {
      return;
    }

    const producer = this.producer;
    if (!producer) {
      return;
    }

    const token = this.pollToken;
    const delay = immediate ? 0 : StreamProducerService.POLL_INTERVAL_MS;

    const timeoutId = setTimeout(() => {
      if (this.pollTimeout !== timeoutId) {
        return;
      }

      this.pollTimeout = null;

      if (this.closing) {
        return;
      }

      if (token !== this.pollToken) {
        return;
      }

      const currentProducer = this.producer;
      if (!currentProducer) {
        return;
      }

      try {
        currentProducer.poll();
      } catch (error) {
        console.error('[schedulePoll.timeout] ERRO durante polling:', error);
      }

      if (this.closing) {
        return;
      }

      if (this.pendingMessages.size > 0) {
        this.schedulePoll();
      } else {
        this.stopPolling();
      }
    }, delay);

    if (this.pollTimeout === existingTimeout) {
      this.pollTimeout = timeoutId;
    } else {
      clearTimeout(timeoutId);
    }
  }

  private stopPolling(): void {
    this.pollToken += 1;

    if (!this.pollTimeout) {
      return;
    }

    clearTimeout(this.pollTimeout);
    this.pollTimeout = null;
  }

  private createDeferred(): IDeferred {
    let resolve!: () => void;
    const promise = new Promise<void>((resolver) => {
      resolve = resolver;
    });

    return { promise, resolve };
  }

  private getPendingDrainPromise(): Promise<void> {
    if (this.pendingMessages.size === 0) {
      return Promise.resolve();
    }

    let existing = this.pendingDrain;
    if (existing) {
      return existing.promise;
    }

    const newDeferred = this.createDeferred();
    if (this.pendingDrain === null) {
      this.pendingDrain = newDeferred;
      return newDeferred.promise;
    }

    return this.pendingDrain.promise;
  }

  private signalPendingDrain(): void {
    if (this.pendingMessages.size !== 0) {
      return;
    }

    const deferred = this.pendingDrain;
    if (!deferred) {
      return;
    }

    this.pendingDrain = null;
    deferred.resolve();
  }

  private getInflightDrainPromise(): Promise<void> {
    if (this.inflight.size === 0) {
      return Promise.resolve();
    }

    let existing = this.inflightDrain;
    if (existing) {
      return existing.promise;
    }

    const newDeferred = this.createDeferred();
    if (this.inflightDrain === null) {
      this.inflightDrain = newDeferred;
      return newDeferred.promise;
    }

    return this.inflightDrain.promise;
  }

  private signalInflightDrain(): void {
    if (this.inflight.size !== 0) {
      return;
    }

    const deferred = this.inflightDrain;
    if (!deferred) {
      return;
    }

    this.inflightDrain = null;
    deferred.resolve();
  }

  private trackInflight(task: Promise<void>): Promise<void> {
    const tracked = task.finally(() => {
      this.inflight.delete(tracked);
      this.signalInflightDrain();
    });

    this.inflight.add(tracked);
    return tracked;
  }

  private async ensureProducer(): Promise<Producer> {
    if (this.closing) {
      throw new Error('Cannot create producer during shutdown');
    }

    const existing = this.producerReady;
    if (existing) {
      if (this.closing) {
        throw new Error('Cannot create producer during shutdown');
      }
      return existing;
    }

    const producer = this.kafka.createProducer();
    this.producer = producer;

    const producerPromise = new Promise<Producer>((resolve, reject) => {
      let completed = false;

      let cleanup: () => void;
      let timeout: NodeJS.Timeout;

      const finalizeError = (err: unknown) => {
        if (completed) {
          return;
        }

        completed = true;
        cleanup();

        if (this.producer === producer) {
          this.producer = null;
        }
        if (this.producerReady === producerPromise) {
          this.producerReady = null;
        }

        try {
          producer.removeAllListeners();
          producer.disconnect(() => {});
        } catch {}

        reject(toError(err));
      };

      const finalizeReady = () => {
        if (completed) {
          return;
        }

        if (this.closing) {
          finalizeError(new Error('Cannot create producer during shutdown'));
          return;
        }

        completed = true;
        cleanup();

        this.setupDeliveryReportListener(producer);
        this.setupRuntimeErrorListener(producer);

        resolve(producer);
      };

      const readyHandler = () => {
        clearTimeout(timeout);
        finalizeReady();
      };

      const errorHandler = (err: LibrdKafkaError) => {
        clearTimeout(timeout);
        finalizeError(err);
      };

      cleanup = () => {
        producer.removeListener('ready', readyHandler);
        producer.removeListener('event.error', errorHandler);
      };

      timeout = setTimeout(() => {
        const broker = this.kafka.getBroker();
        finalizeError(
          new Error(
            `Kafka producer connection timeout after ${StreamProducerService.CONNECTION_TIMEOUT_MS}ms. Broker: ${broker}. Verifique se o Kafka está acessível e se as configurações estão corretas.`
          )
        );
      }, StreamProducerService.CONNECTION_TIMEOUT_MS);

      producer.once('ready', readyHandler);
      producer.once('event.error', errorHandler);

      producer.connect({}, (err) => {
        if (!err) {
          return;
        }

        errorHandler(toError(err) as unknown as LibrdKafkaError);
      });
    });

    if (this.producerReady === null) {
      this.producerReady = producerPromise;
    } else {
      this.producer = null;
      try {
        producer.removeAllListeners();
        producer.disconnect(() => {});
      } catch {}
      return this.producerReady;
    }

    if (this.closing) {
      this.producerReady = null;
      this.producer = null;
      try {
        producer.removeAllListeners();
        producer.disconnect(() => {});
      } catch {}
      throw new Error('Cannot create producer during shutdown');
    }

    return producerPromise;
  }

  private invalidateProducerForReconnect(error: Error): void {
    this.rejectAllPendingMessages(error);
    this.rejectAllInflightTasks();
    this.stopPolling();

    this.producerReady = null;

    if (this.reconnecting) {
      this.reconnecting.catch(() => {});
      this.reconnecting = null;
    }

    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }

    const producer = this.producer;
    if (!producer) {
      this.producer = null;
      if (this.sendQueue.length > 0 && !this.closing) {
        this.scheduleFlush();
      }
      return;
    }

    try {
      producer.removeListener('delivery-report', this.deliveryReportHandler);
      producer.removeListener('event.error', this.runtimeErrorHandler);
      producer.disconnect(() => {});
    } catch {}

    this.producer = null;

    if (this.sendQueue.length > 0 && !this.closing) {
      this.scheduleFlush();
    }
  }

  private rejectAllPendingMessages(error: Error): void {
    const pending = Array.from(this.pendingMessages.values());
    this.pendingMessages.clear();
    this.stopPolling();

    for (const message of pending) {
      clearTimeout(message.timeoutHandle);
      this.metrics.messagesRejected += 1;
      message.reject(error);
    }

    this.signalPendingDrain();
  }

  private rejectAllInflightTasks(): void {
    const tasks = Array.from(this.inflight);
    this.inflight.clear();

    for (const task of tasks) {
      task.catch(() => {});
    }

    this.signalInflightDrain();
  }

  private rejectQueuedMessages(error: Error): void {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }

    const queued = this.sendQueue.splice(0);
    for (const message of queued) {
      this.metrics.messagesRejected += 1;
      message.reject(error);
    }
  }

  private async reconnectProducer(): Promise<Producer> {
    const existing = this.reconnecting;
    if (existing) {
      return existing;
    }

    const reconnectPromise = this.performReconnect().finally(() => {
      if (this.reconnecting === reconnectPromise) {
        this.reconnecting = null;
      }
    });

    if (this.reconnecting === null) {
      this.reconnecting = reconnectPromise;
      return reconnectPromise;
    }

    return this.reconnecting;
  }

  private async performReconnect(): Promise<Producer> {
    if (this.closing) {
      throw new Error('Cannot reconnect during shutdown');
    }

    this.metrics.reconnections += 1;
    this.stopPolling();

    const producer = this.producer;
    this.producer = null;
    this.producerReady = null;

    if (producer) {
      try {
        producer.removeAllListeners();
        await new Promise<void>((resolve) => {
          producer.disconnect(resolve);
        });
      } catch {}
    }

    return this.ensureProducer();
  }

  private isDisconnectedError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const errorMessage = getErrorMessage(error);
    const errorCode = 'code' in error ? (error as any).code : null;

    return (
      errorMessage.includes('disconnected') ||
      errorMessage.includes('disconnection') ||
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
      typeof error === 'object' && 'code' in error ? (error as any).code : null;

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
    keyBuffer: Buffer | undefined,
    headers?: MessageHeader[]
  ): Promise<void> {
    if (this.closing) {
      throw new Error('Cannot produce message during shutdown');
    }

    if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
      throw new Error('Invalid topic: topic must be a non-empty string');
    }

    const currentProducer = this.producer;
    if (!currentProducer || currentProducer !== producer) {
      throw new Error('Producer was invalidated');
    }

    return new Promise<void>((resolve, reject) => {
      if (this.closing || this.producer !== producer) {
        reject(new Error('Producer was invalidated or is closing'));
        return;
      }

      const correlationId = ulid();

      const startTime = Date.now();
      const timeoutHandle = setTimeout(() => {
        const pending = this.pendingMessages.get(correlationId);
        if (!pending) {
          return;
        }

        pending.timeoutFired = true;
        this.pendingMessages.delete(correlationId);

        if (this.pendingMessages.size === 0) {
          this.stopPolling();
        }

        this.signalPendingDrain();

        this.metrics.deliveryTimeouts += 1;
        this.metrics.messagesFailed += 1;

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
        startTime,
        timeoutFired: false,
      });

      if (this.pendingMessages.size === 1) {
        this.schedulePoll(true);
      }

      if (this.closing || this.producer !== producer) {
        const pending = this.pendingMessages.get(correlationId);
        if (pending) {
          this.pendingMessages.delete(correlationId);
          clearTimeout(pending.timeoutHandle);
          this.signalPendingDrain();
        }

        reject(new Error('Producer was invalidated or is closing'));
        return;
      }

      let produceResult: unknown;
      try {
        produceResult = producer.produce(
          topic,
          null,
          value,
          keyBuffer,
          Date.now(),
          correlationId,
          headers
        );
      } catch (error) {
        const pending = this.pendingMessages.get(correlationId);
        if (pending) {
          this.pendingMessages.delete(correlationId);
          clearTimeout(pending.timeoutHandle);
          this.signalPendingDrain();
        }

        reject(toError(error));
        return;
      }

      if (typeof produceResult === 'boolean') {
        if (produceResult) {
          return;
        }

        const pending = this.pendingMessages.get(correlationId);
        if (pending) {
          this.pendingMessages.delete(correlationId);
          clearTimeout(pending.timeoutHandle);
          this.signalPendingDrain();
        }

        const error = new Error(
          `Failed to produce message to topic "${topic}": unexpected false return from produce()`
        );

        if (this.isDisconnectedError(error)) {
          this.invalidateProducerForReconnect(error);
        }

        reject(error);
        return;
      }

      if (produceResult === null || produceResult === undefined) {
        const pending = this.pendingMessages.get(correlationId);
        if (pending) {
          this.pendingMessages.delete(correlationId);
          clearTimeout(pending.timeoutHandle);
          this.signalPendingDrain();
        }

        const error = new Error(
          `Failed to produce message to topic "${topic}": unexpected null/undefined return from produce()`
        );

        if (this.isDisconnectedError(error)) {
          this.invalidateProducerForReconnect(error);
        }

        reject(error);
        return;
      }

      const pending = this.pendingMessages.get(correlationId);
      if (pending) {
        this.pendingMessages.delete(correlationId);
        clearTimeout(pending.timeoutHandle);
        this.signalPendingDrain();
      }

      if (typeof produceResult === 'number' && produceResult < 0) {
        const error = new Error(
          `Failed to produce message: librdkafka error code ${produceResult}`
        );

        if (this.isDisconnectedError(error)) {
          this.invalidateProducerForReconnect(error);
        }

        reject(error);
        return;
      }

      if (produceResult instanceof Error) {
        if (this.isDisconnectedError(produceResult)) {
          this.invalidateProducerForReconnect(produceResult);
        }
        reject(produceResult);
        return;
      }

      if (typeof produceResult === 'string') {
        const error = new Error(produceResult);
        if (this.isDisconnectedError(error)) {
          this.invalidateProducerForReconnect(error);
        }
        reject(error);
        return;
      }

      const error = new Error(
        `Failed to produce message to topic "${topic}": unexpected return: ${String(produceResult)} (type: ${typeof produceResult})`
      );

      if (this.isDisconnectedError(error)) {
        this.invalidateProducerForReconnect(error);
      }

      reject(error);
    });
  }

  private async produceWithQueueFullRetry(
    producer: Producer,
    topic: string,
    value: Buffer,
    keyBuffer: Buffer | undefined,
    headers: MessageHeader[] | undefined,
    attempt = 0
  ): Promise<void> {
    if (this.closing) {
      throw new Error('Cannot produce message during shutdown');
    }

    try {
      await this.produceMessage(producer, topic, value, keyBuffer, headers);
    } catch (error) {
      if (this.closing) {
        throw new Error('Producer is closing');
      }

      const isQueueFull = this.isQueueFullError(error);

      if (!isQueueFull) {
        throw error;
      }

      if (attempt >= StreamProducerService.MAX_QUEUE_FULL_RETRIES) {
        this.metrics.queueFullErrors += 1;
        throw new Error(
          `Kafka queue full after ${StreamProducerService.MAX_QUEUE_FULL_RETRIES} retries. Backpressure exceeded.`
        );
      }

      const backoffMs = this.calculateBackoff(
        attempt,
        StreamProducerService.QUEUE_FULL_BACKOFF_BASE_MS,
        StreamProducerService.QUEUE_FULL_BACKOFF_MAX_MS
      );
      await this.delay(backoffMs);

      if (this.closing) {
        throw new Error('Producer is closing');
      }

      if (this.producer !== producer || !this.producer) {
        throw new Error('Producer was invalidated during backoff');
      }

      await this.produceWithQueueFullRetry(
        producer,
        topic,
        value,
        keyBuffer,
        headers,
        attempt + 1
      );
    }
  }

  private calculateBackoff(
    attempt: number,
    baseMs: number,
    maxMs: number
  ): number {
    const exponential = Math.min(maxMs, baseMs * 2 ** attempt);
    const jitter = Math.floor(Math.random() * baseMs);
    return exponential + jitter;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | null = null;

    const timeout = new Promise<T>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Timeout')), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private serializePayload(payload: unknown): Buffer {
    if (Buffer.isBuffer(payload)) {
      return payload;
    }

    if (typeof payload === 'string') {
      return Buffer.from(payload, 'utf-8');
    }

    if (payload instanceof Uint8Array) {
      return Buffer.from(payload);
    }

    if (payload instanceof ArrayBuffer) {
      return Buffer.from(payload);
    }

    try {
      return Buffer.from(JSON.stringify(payload), 'utf-8');
    } catch (error) {
      throw new Error(`Failed to serialize payload: ${getErrorMessage(error)}`);
    }
  }

  private serializeKey(key?: string | Buffer): Buffer | undefined {
    if (!key) {
      return undefined;
    }

    return Buffer.isBuffer(key) ? key : Buffer.from(key, 'utf-8');
  }

  private enqueueSend(
    topic: string,
    value: Buffer,
    keyBuffer: Buffer | undefined,
    headers?: MessageHeader[]
  ): Promise<void> {
    if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
      return Promise.reject(
        new Error('Invalid topic: topic must be a non-empty string')
      );
    }

    return new Promise((resolve, reject) => {
      if (this.closing) {
        reject(new Error('Producer is closing'));
        return;
      }

      const bufferedCount = this.pendingMessages.size + this.sendQueue.length;

      if (bufferedCount >= StreamProducerService.MAX_INFLIGHT_MESSAGES) {
        this.metrics.messagesRejected += 1;
        reject(
          new Error(
            `Producer backpressure: ${bufferedCount} buffered messages exceeds limit ${StreamProducerService.MAX_INFLIGHT_MESSAGES}`
          )
        );
        return;
      }

      this.sendQueue.push({
        topic,
        value,
        keyBuffer,
        headers,
        resolve,
        reject,
      });
      this.scheduleFlush();
    });
  }

  private scheduleFlush(delayOverrideMs?: number): void {
    if (this.closing) {
      return;
    }

    if (this.flushTimeout) {
      return;
    }

    if (this.flushLoop) {
      return;
    }

    const delay =
      typeof delayOverrideMs === 'number'
        ? delayOverrideMs
        : this.sendQueue.length >= StreamProducerService.MAX_BATCH_SIZE
          ? 0
          : StreamProducerService.BATCH_FLUSH_MS;

    this.flushTimeout = setTimeout(() => {
      this.flushTimeout = null;
      if (!this.closing) {
        void this.flushQueue();
      }
    }, delay);
  }

  private async flushQueue(): Promise<void> {
    if (this.flushLoop) {
      await this.flushLoop;
      return;
    }

    this.flushLoop = this.runFlushLoop().finally(() => {
      this.flushLoop = null;

      if (this.sendQueue.length > 0 && !this.closing) {
        this.scheduleFlush();
      }
    });

    await this.flushLoop;
  }

  private async runFlushLoop(): Promise<void> {
    while (this.sendQueue.length > 0 && !this.closing) {
      const batch = this.sendQueue.splice(
        0,
        StreamProducerService.MAX_BATCH_SIZE
      );

      let producer: Producer;
      try {
        if (this.closing) {
          for (const message of batch) {
            this.metrics.messagesRejected += 1;
            message.reject(new Error('Producer is closing'));
          }
          return;
        }

        producer = await this.ensureProducer();
        this.flushFailureCount = 0;
      } catch {
        if (this.closing) {
          for (const message of batch) {
            this.metrics.messagesRejected += 1;
            message.reject(new Error('Producer is closing'));
          }
          return;
        }

        this.flushFailureCount += 1;

        if (this.flushFailureCount > StreamProducerService.MAX_RETRIES) {
          for (const message of batch) {
            this.metrics.messagesRejected += 1;
            message.reject(
              new Error(
                `Failed to establish producer connection after ${StreamProducerService.MAX_RETRIES} attempts`
              )
            );
          }
          const queued = this.sendQueue.splice(0);
          for (const message of queued) {
            this.metrics.messagesRejected += 1;
            message.reject(
              new Error('Producer connection failed, rejecting queued messages')
            );
          }
          this.rejectAllInflightTasks();
          return;
        }

        this.sendQueue.unshift(...batch);

        const backoffMs = this.calculateBackoff(
          Math.min(
            this.flushFailureCount - 1,
            StreamProducerService.MAX_RETRIES - 1
          ),
          StreamProducerService.INITIAL_BACKOFF_MS,
          StreamProducerService.MAX_BACKOFF_MS
        );

        this.scheduleFlush(backoffMs);
        return;
      }

      if (this.closing) {
        for (const message of batch) {
          this.metrics.messagesRejected += 1;
          message.reject(new Error('Producer is closing'));
        }
        return;
      }

      await this.processBatchInParallel(batch, producer);

      if (this.sendQueue.length > 0 && !this.closing) {
        await this.nextTick();
      }
    }
  }

  private async nextTick(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  private async processBatchInParallel(
    batch: IQueuedMessage[],
    producer: Producer
  ): Promise<void> {
    if (batch.length === 0) {
      return;
    }

    if (batch.length <= StreamProducerService.MAX_CONCURRENT_SENDS) {
      if (this.closing) {
        for (const message of batch) {
          this.metrics.messagesRejected += 1;
          message.reject(new Error('Producer is closing'));
        }
        return;
      }

      const tasks: Promise<void>[] = [];
      for (const message of batch) {
        const task = this.sendWithRetry(
          message.topic,
          message.value,
          message.keyBuffer,
          message.headers,
          0,
          producer
        )
          .then(() => {
            message.resolve();
          })
          .catch((err) => {
            message.reject(toError(err));
          });

        const tracked = this.trackInflight(task);
        tasks.push(tracked);
      }

      await Promise.allSettled(tasks);
      return;
    }

    const concurrency = StreamProducerService.MAX_CONCURRENT_SENDS;
    const chunks: IQueuedMessage[][] = [];

    for (let i = 0; i < batch.length; i += concurrency) {
      chunks.push(batch.slice(i, i + concurrency));
    }

    for (const chunk of chunks) {
      if (this.closing) {
        for (const message of chunk) {
          this.metrics.messagesRejected += 1;
          message.reject(new Error('Producer is closing'));
        }
        return;
      }

      const tasks: Promise<void>[] = [];
      for (const message of chunk) {
        const task = this.sendWithRetry(
          message.topic,
          message.value,
          message.keyBuffer,
          message.headers,
          0,
          producer
        )
          .then(() => {
            message.resolve();
          })
          .catch((err) => {
            message.reject(toError(err));
          });

        const tracked = this.trackInflight(task);
        tasks.push(tracked);
      }

      await Promise.allSettled(tasks);
    }
  }

  private async sendWithRetry(
    topic: string,
    value: Buffer,
    keyBuffer: Buffer | undefined,
    headers: MessageHeader[] | undefined,
    attempt = 0,
    producer?: Producer
  ): Promise<void> {
    if (this.closing) {
      throw new Error('Producer is closing');
    }

    if (attempt >= StreamProducerService.MAX_RETRIES) {
      throw new Error(
        `Failed to send message after ${StreamProducerService.MAX_RETRIES} attempts`
      );
    }

    try {
      const resolvedProducer = producer ?? (await this.ensureProducer());
      await this.produceWithQueueFullRetry(
        resolvedProducer,
        topic,
        value,
        keyBuffer,
        headers
      );
    } catch (error) {
      if (this.closing) {
        throw new Error('Producer is closing');
      }

      const isDisconnected = this.isDisconnectedError(error);

      if (!isDisconnected) {
        throw error;
      }

      const reconnectedProducer = await this.reconnectProducer();

      if (this.closing) {
        throw new Error('Producer is closing');
      }

      if (!reconnectedProducer || this.producer !== reconnectedProducer) {
        throw new Error('Producer reconnection failed or was invalidated');
      }

      const backoffMs = this.calculateBackoff(
        attempt,
        StreamProducerService.INITIAL_BACKOFF_MS,
        StreamProducerService.MAX_BACKOFF_MS
      );
      await this.delay(backoffMs);

      if (this.closing) {
        throw new Error('Producer is closing');
      }

      await this.sendWithRetry(
        topic,
        value,
        keyBuffer,
        headers,
        attempt + 1,
        reconnectedProducer
      );
    }
  }

  async send(
    topic: string,
    payload: unknown,
    key?: string | Buffer,
    headers?: MessageHeader[]
  ): Promise<void> {
    const enqueue = () => {
      const value = this.serializePayload(payload);
      const keyBuffer = this.serializeKey(key);
      const kafkaHeaders = injectKafkaTraceHeaders(headers);
      return this.enqueueSend(topic, value, keyBuffer, kafkaHeaders);
    };

    if (
      isMessageLifecycleDebugEnabled() &&
      !getMessageLifecycleContext() &&
      this.isMessageLifecyclePayload(payload)
    ) {
      return runWithMessageLifecycleContext(
        buildMessageLifecycleContext(payload as never),
        enqueue
      ) as Promise<void>;
    }

    return enqueue();
  }

  async close(): Promise<boolean[]> {
    if (this.closePromise) {
      return this.closePromise;
    }

    this.closePromise = this.performClose();
    return this.closePromise;
  }

  private async performClose(): Promise<boolean[]> {
    this.closing = true;

    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }

    if (this.reconnecting) {
      try {
        await Promise.race([
          this.reconnecting,
          new Promise<void>((resolve, reject) =>
            setTimeout(() => {
              reject(new Error('Reconnection timeout during shutdown'));
            }, StreamProducerService.RECONNECT_TIMEOUT_MS)
          ),
        ]);
      } catch (error) {
        console.error('Error waiting for reconnection during shutdown:', error);
      }
      this.reconnecting = null;
    }

    const flushLoopPromise = this.flushLoop;
    if (flushLoopPromise) {
      try {
        await this.withTimeout(
          flushLoopPromise,
          StreamProducerService.SHUTDOWN_FLUSH_TIMEOUT_MS
        );
      } catch {
        this.rejectQueuedMessages(
          new Error('Producer shutdown: flush loop timeout')
        );
        this.flushLoop = null;
      }
    }

    try {
      await this.withTimeout(
        Promise.all([
          this.getInflightDrainPromise(),
          this.getPendingDrainPromise(),
        ]).then(() => undefined),
        StreamProducerService.SHUTDOWN_FLUSH_TIMEOUT_MS
      );
    } catch {
      this.rejectAllInflightTasks();
      this.rejectAllPendingMessages(
        new Error('Producer shutdown: pending drain timeout')
      );
    }

    this.rejectQueuedMessages(
      new Error('Producer shutdown: rejecting queued messages')
    );

    const producer = this.producer;
    if (!producer) {
      return [true];
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const flushTimeout = setTimeout(() => {
          reject(new Error('Flush timeout during shutdown'));
        }, StreamProducerService.SHUTDOWN_FLUSH_TIMEOUT_MS);

        producer.flush(
          StreamProducerService.SHUTDOWN_FLUSH_TIMEOUT_MS,
          (err) => {
            clearTimeout(flushTimeout);

            if (err) {
              this.rejectAllPendingMessages(
                new Error('Producer shutdown: flush failed')
              );
              reject(
                new Error(
                  `Flush error during shutdown: ${getErrorMessage(err)}`
                )
              );
              return;
            }

            resolve();
          }
        );
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
      this.producerReady = null;
      this.reconnecting = null;
    }

    return [true];
  }

  getMetrics(): {
    messagesSent: number;
    messagesFailed: number;
    messagesRejected: number;
    reconnections: number;
    connectionErrors: number;
    queueFullErrors: number;
    deliveryTimeouts: number;
    averageLatencyMs: number;
    queueSize: number;
    pendingMessages: number;
    inflightMessages: number;
  } {
    const averageLatencyMs =
      this.metrics.messagesSent > 0
        ? Math.round(this.metrics.totalLatencyMs / this.metrics.messagesSent)
        : 0;

    return {
      messagesSent: this.metrics.messagesSent,
      messagesFailed: this.metrics.messagesFailed,
      messagesRejected: this.metrics.messagesRejected,
      reconnections: this.metrics.reconnections,
      connectionErrors: this.metrics.connectionErrors,
      queueFullErrors: this.metrics.queueFullErrors,
      deliveryTimeouts: this.metrics.deliveryTimeouts,
      averageLatencyMs,
      queueSize: this.sendQueue.length,
      pendingMessages: this.pendingMessages.size,
      inflightMessages: this.inflight.size,
    };
  }

  resetMetrics(): void {
    this.metrics = {
      messagesSent: 0,
      messagesFailed: 0,
      messagesRejected: 0,
      reconnections: 0,
      connectionErrors: 0,
      queueFullErrors: 0,
      deliveryTimeouts: 0,
      totalLatencyMs: 0,
      lastMessageTime: 0,
    };
  }
}
