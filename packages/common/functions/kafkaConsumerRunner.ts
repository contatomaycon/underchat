import type { KafkaConsumer } from 'node-rdkafka';
import { createConsumer } from './createConsumer';
import { connectConsumer } from './connectConsumer';
import { commitOffset } from './commitOffset';
import { ensureKafkaTopic } from './ensureKafkaTopic';
import { handleConsumerError } from './handleConsumerError';
import { resolveKafkaTopicConfig } from './kafkaTopicConfig';
import type {
  KafkaConsumerRunnerContext,
  KafkaConsumerRunnerDiscardReason,
  KafkaConsumerRunnerErrorDecision,
  KafkaConsumerRunnerOptions,
  KafkaRunnerMessage,
} from '@core/common/interfaces/KafkaConsumerRunnerOptions';

interface IPartitionCommitState {
  nextOffset: number | null;
  pendingOffsets: Set<number>;
  completedOffsets: Set<number>;
  commitChain: Promise<void>;
}

interface IResolvedCommitConsumer extends KafkaConsumer {
  commitResolvedSync?: (
    offsets: Array<{ topic: string; partition: number; offset: number }>
  ) => unknown;
}

function readFirstPositiveIntegerEnv(
  names: string[],
  fallback: number
): number {
  for (const name of names) {
    const raw = Number(process.env[name]);
    if (Number.isFinite(raw) && raw > 0) {
      return Math.floor(raw);
    }
  }

  return fallback;
}

function topicEnvSuffix(topic: string): string {
  return topic
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function isLongRunningServiceApiTopic(topic: string): boolean {
  return (
    topic.includes('embedding') ||
    topic.includes('pdf') ||
    topic.includes('build') ||
    topic.includes('balance') ||
    topic.includes('create.server') ||
    topic.includes('worker.warm') ||
    topic.includes('worker.lifecycle')
  );
}

function resolveMaxInFlightTotal(topic: string, override?: number): number {
  if (typeof override === 'number') {
    return override;
  }

  const suffix = topicEnvSuffix(topic);
  const topicOverride = readFirstPositiveIntegerEnv(
    [
      `KAFKA_CONSUMER_MAX_IN_FLIGHT_TOTAL_${suffix}`,
      `SERVICE_API_KAFKA_MAX_IN_FLIGHT_TOTAL_${suffix}`,
    ],
    0
  );
  if (topicOverride > 0) return topicOverride;

  if (isLongRunningServiceApiTopic(topic)) {
    return 2;
  }

  return readFirstPositiveIntegerEnv(
    [
      'KAFKA_CONSUMER_MAX_IN_FLIGHT_TOTAL',
      'SERVICE_API_KAFKA_MAX_IN_FLIGHT_TOTAL',
    ],
    32
  );
}

function resolveMaxInFlightPerPartition(
  topic: string,
  override?: number
): number {
  if (typeof override === 'number') {
    return override;
  }

  const suffix = topicEnvSuffix(topic);
  const topicOverride = readFirstPositiveIntegerEnv(
    [
      `KAFKA_CONSUMER_MAX_IN_FLIGHT_PER_PARTITION_${suffix}`,
      `SERVICE_API_KAFKA_MAX_IN_FLIGHT_PER_PARTITION_${suffix}`,
    ],
    0
  );
  if (topicOverride > 0) return topicOverride;

  return readFirstPositiveIntegerEnv(
    [
      'KAFKA_CONSUMER_MAX_IN_FLIGHT_PER_PARTITION',
      'SERVICE_API_KAFKA_MAX_IN_FLIGHT_PER_PARTITION',
    ],
    4
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function keyToString(key?: Buffer | string | null): string | null {
  if (!key) {
    return null;
  }

  if (Buffer.isBuffer(key)) {
    const value = key.toString('utf8').trim();
    return value || null;
  }

  const value = String(key).trim();
  return value || null;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

export class KafkaConsumerRunner<TPayload> {
  public consumer: KafkaConsumer | null = null;

  private running = false;
  private closing = false;
  private totalInFlight = 0;
  private readonly inFlightByPartition = new Map<number, number>();
  private readonly pausedPartitions = new Set<number>();
  private readonly knownPartitions = new Set<number>();
  private readonly partitionCommitStates = new Map<
    number,
    IPartitionCommitState
  >();
  private readonly entityChains = new Map<string, Promise<void>>();
  private readonly tasks = new Set<Promise<void>>();

  private readonly maxInFlightTotal: number;
  private readonly maxInFlightPerPartition: number;
  private readonly maxRetries: number;
  private readonly retryDelaysMs: number[];
  private readonly processingTimeoutMs: number;
  private readonly shutdownDrainTimeoutMs: number;

  constructor(private readonly options: KafkaConsumerRunnerOptions<TPayload>) {
    this.maxInFlightTotal = resolveMaxInFlightTotal(
      options.topic,
      options.maxInFlightTotal
    );
    this.maxInFlightPerPartition = resolveMaxInFlightPerPartition(
      options.topic,
      options.maxInFlightPerPartition
    );
    this.maxRetries = Math.max(1, options.maxRetries ?? 1);
    this.retryDelaysMs = options.retryDelaysMs ?? [250, 1000, 3000];
    this.processingTimeoutMs = options.processingTimeoutMs ?? 0;
    this.shutdownDrainTimeoutMs =
      options.shutdownDrainTimeoutMs ??
      readFirstPositiveIntegerEnv(
        ['KAFKA_CONSUMER_SHUTDOWN_DRAIN_TIMEOUT_MS'],
        30_000
      );
  }

  async start(onConnected?: () => void): Promise<void> {
    if (this.consumer && this.running) {
      return;
    }

    this.closing = false;
    const topicConfig = resolveKafkaTopicConfig(this.options.topic);
    await ensureKafkaTopic(
      this.options.kafka,
      this.options.topic,
      topicConfig.numPartitions,
      topicConfig.replicationFactor
    );

    const consumer = createConsumer(this.options.kafka, this.options.groupId);
    this.consumer = consumer;

    consumer.on('data', (message) => {
      this.handleData(message as KafkaRunnerMessage);
    });

    consumer.on('event.error', (error) => {
      handleConsumerError(error, this.options.topic);
    });

    await connectConsumer(consumer, this.options.topic, () => {
      this.running = true;
      onConnected?.();
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    this.running = false;

    await this.waitForDrain(Array.from(this.tasks), 'tasks');
    await this.waitForDrain(
      Array.from(this.partitionCommitStates.values()).map(
        (state) => state.commitChain
      ),
      'commit_chains'
    );

    const consumer = this.consumer;
    if (!consumer) {
      this.clearState();
      return;
    }

    await new Promise<void>((resolve) => {
      try {
        consumer.unsubscribe();
      } catch {}
      try {
        consumer.disconnect(resolve);
      } catch {
        resolve();
      }
    });

    this.consumer = null;
    this.clearState();
  }

  private async waitForDrain(
    promises: Promise<unknown>[],
    label: string
  ): Promise<void> {
    if (promises.length === 0) {
      return;
    }

    const drain = Promise.allSettled(promises).then(() => undefined);
    if (this.shutdownDrainTimeoutMs <= 0) {
      await drain;
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | null = null;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timeout = setTimeout(
        () => resolve('timeout'),
        this.shutdownDrainTimeoutMs
      );
    });

    const result = await Promise.race([drain, timedOut]);
    if (timeout) {
      clearTimeout(timeout);
    }

    if (result === 'timeout') {
      this.options.logger?.warn?.(
        {
          topic: this.options.topic,
          groupId: this.options.groupId,
          pending: promises.length,
          timeoutMs: this.shutdownDrainTimeoutMs,
          label,
        },
        'Kafka consumer runner drain timed out during close'
      );
    }
  }

  async restart(onConnected?: () => void): Promise<void> {
    await this.close();
    await this.start(onConnected);
  }

  private handleData(message: KafkaRunnerMessage): void {
    if (this.closing) {
      return;
    }

    const normalizedMessage: KafkaRunnerMessage = {
      ...message,
      topic: message.topic || this.options.topic,
    };

    this.knownPartitions.add(normalizedMessage.partition);
    this.registerOffset(normalizedMessage.partition, normalizedMessage.offset);
    this.incrementInFlight(normalizedMessage.partition);
    this.applyBackpressure(normalizedMessage.partition);

    const task = this.processMessage(normalizedMessage)
      .catch((error) => {
        this.options.logger?.error?.(
          {
            err: error,
            topic: this.options.topic,
            groupId: this.options.groupId,
            partition: normalizedMessage.partition,
            offset: normalizedMessage.offset,
          },
          'Kafka consumer runner task failed'
        );
      })
      .finally(() => {
        this.tasks.delete(task);
        this.decrementInFlight(normalizedMessage.partition);
        this.releaseBackpressure();
      });

    this.tasks.add(task);
  }

  private async processMessage(message: KafkaRunnerMessage): Promise<void> {
    let payload: TPayload | null;
    try {
      payload = this.options.parse(message);
    } catch (error) {
      this.options.logger?.error?.(
        {
          err: error,
          topic: this.options.topic,
          groupId: this.options.groupId,
          partition: message.partition,
          offset: message.offset,
        },
        'Kafka consumer runner parser failed'
      );
      await this.runInvalidMessageHook(message);
      this.logInvalidPayloadDiscarded(message, error);
      await this.completeOffset(message.partition, message.offset);
      return;
    }

    if (!payload) {
      await this.runInvalidMessageHook(message);
      this.logInvalidPayloadDiscarded(message, null);
      await this.completeOffset(message.partition, message.offset);
      return;
    }

    const entityKey = this.resolveEntityKey(payload, message);
    if (!this.options.preserveEntityOrder) {
      await this.processPayload(payload, message, entityKey);
      return;
    }

    const previous = this.entityChains.get(entityKey) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.processPayload(payload, message, entityKey))
      .finally(() => {
        if (this.entityChains.get(entityKey) === current) {
          this.entityChains.delete(entityKey);
        }
      });

    this.entityChains.set(entityKey, current);
    await current;
  }

  private async processPayload(
    payload: TPayload,
    message: KafkaRunnerMessage,
    entityKey: string
  ): Promise<void> {
    const kafkaKey = keyToString(message.key);

    let lastError: unknown;
    let lastContext: KafkaConsumerRunnerContext<TPayload> | null = null;
    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      const context: KafkaConsumerRunnerContext<TPayload> = {
        topic: this.options.topic,
        groupId: this.options.groupId,
        message,
        partition: message.partition,
        offset: message.offset,
        kafkaKey,
        entityKey,
        attempt,
        payload,
      };
      lastContext = context;

      try {
        await withTimeout(
          this.options.handle(payload, context),
          this.processingTimeoutMs,
          `Kafka message processing timeout after ${this.processingTimeoutMs}ms`
        );
        await this.runProcessedHook(payload, context);
        await this.completeOffset(message.partition, message.offset);
        return;
      } catch (error) {
        lastError = error;
        await this.runFailedHook(payload, context, error);

        if (this.resolveErrorDecision(payload, context, error) === 'terminal') {
          this.logTerminalErrorDiscarded(payload, message, entityKey, error);
          await this.runDiscardedHook(
            payload,
            context,
            error,
            'terminal_error'
          );
          await this.completeOffset(message.partition, message.offset);
          return;
        }

        if (attempt < this.maxRetries) {
          const delayMs =
            this.retryDelaysMs[attempt - 1] ??
            this.retryDelaysMs[this.retryDelaysMs.length - 1] ??
            1000;
          await delay(delayMs);
        }
      }
    }

    this.logRetriesExhausted(payload, message, entityKey, lastError);
    if (lastContext) {
      await this.runDiscardedHook(
        payload,
        lastContext,
        lastError,
        'retry_exhausted'
      );
    }
    await this.completeOffset(message.partition, message.offset);
  }

  private async runInvalidMessageHook(
    message: KafkaRunnerMessage
  ): Promise<void> {
    try {
      await this.options.onInvalidMessage?.(message);
    } catch (error) {
      this.options.logger?.error?.(
        {
          err: error,
          topic: this.options.topic,
          groupId: this.options.groupId,
          partition: message.partition,
          offset: message.offset,
        },
        'Kafka consumer runner onInvalidMessage hook failed'
      );
    }
  }

  private async runProcessedHook(
    payload: TPayload,
    context: KafkaConsumerRunnerContext<TPayload>
  ): Promise<void> {
    try {
      await this.options.onProcessed?.(payload, context);
    } catch (error) {
      this.options.logger?.error?.(
        {
          err: error,
          topic: this.options.topic,
          groupId: this.options.groupId,
          partition: context.partition,
          offset: context.offset,
        },
        'Kafka consumer runner onProcessed hook failed'
      );
    }
  }

  private async runFailedHook(
    payload: TPayload,
    context: KafkaConsumerRunnerContext<TPayload>,
    handlerError: unknown
  ): Promise<void> {
    try {
      await this.options.onFailed?.(payload, context, handlerError);
    } catch (error) {
      this.options.logger?.error?.(
        {
          err: error,
          handlerErr: handlerError,
          topic: this.options.topic,
          groupId: this.options.groupId,
          partition: context.partition,
          offset: context.offset,
        },
        'Kafka consumer runner onFailed hook failed'
      );
    }
  }

  private resolveErrorDecision(
    payload: TPayload,
    context: KafkaConsumerRunnerContext<TPayload>,
    error: unknown
  ): KafkaConsumerRunnerErrorDecision {
    try {
      return (
        this.options.classifyError?.(payload, context, error) ?? 'retryable'
      );
    } catch (hookError) {
      this.options.logger?.error?.(
        {
          err: hookError,
          handlerErr: error,
          topic: this.options.topic,
          groupId: this.options.groupId,
          partition: context.partition,
          offset: context.offset,
        },
        'Kafka consumer runner classifyError hook failed'
      );
      return 'retryable';
    }
  }

  private async runDiscardedHook(
    payload: TPayload,
    context: KafkaConsumerRunnerContext<TPayload>,
    handlerError: unknown,
    reason: KafkaConsumerRunnerDiscardReason
  ): Promise<void> {
    try {
      await this.options.onDiscarded?.(payload, context, handlerError, reason);
    } catch (error) {
      this.options.logger?.error?.(
        {
          err: error,
          handlerErr: handlerError,
          reason,
          topic: this.options.topic,
          groupId: this.options.groupId,
          partition: context.partition,
          offset: context.offset,
        },
        'Kafka consumer runner onDiscarded hook failed'
      );
    }
  }

  private logInvalidPayloadDiscarded(
    message: KafkaRunnerMessage,
    error: unknown
  ): void {
    this.options.logger?.warn?.(
      {
        err: error,
        topic: this.options.topic,
        groupId: this.options.groupId,
        partition: message.partition,
        offset: message.offset,
        kafkaKey: keyToString(message.key),
        reason: 'invalid_payload',
      },
      'Kafka consumer runner discarded invalid payload'
    );
  }

  private logTerminalErrorDiscarded(
    payload: TPayload,
    message: KafkaRunnerMessage,
    entityKey: string,
    error: unknown
  ): void {
    this.options.logger?.warn?.(
      {
        err: error,
        topic: this.options.topic,
        groupId: this.options.groupId,
        partition: message.partition,
        offset: message.offset,
        kafkaKey: keyToString(message.key),
        entityKey,
        payload,
      },
      'Kafka consumer runner discarded terminal message'
    );
  }

  private logRetriesExhausted(
    payload: TPayload,
    message: KafkaRunnerMessage,
    entityKey: string,
    error: unknown
  ): void {
    this.options.logger?.error?.(
      {
        err: error,
        topic: this.options.topic,
        groupId: this.options.groupId,
        partition: message.partition,
        offset: message.offset,
        kafkaKey: keyToString(message.key),
        entityKey,
        attempts: this.maxRetries,
        payload,
      },
      'Kafka consumer runner exhausted retries; discarding message'
    );
  }

  private resolveEntityKey(
    payload: TPayload,
    message: KafkaRunnerMessage
  ): string {
    const resolved =
      this.options.resolveEntityKey?.(payload, message)?.trim() ||
      keyToString(message.key);
    if (resolved) {
      return resolved;
    }

    return `${this.options.topic}:${message.partition}:${message.offset}`;
  }

  private registerOffset(partition: number, offset: number): void {
    const state = this.getPartitionCommitState(partition);
    state.pendingOffsets.add(offset);
    if (state.nextOffset === null || offset < state.nextOffset) {
      state.nextOffset = offset;
    }
  }

  private async completeOffset(
    partition: number,
    offset: number
  ): Promise<void> {
    const state = this.getPartitionCommitState(partition);
    state.completedOffsets.add(offset);
    state.commitChain = state.commitChain
      .catch((error) => {
        this.options.logger?.error?.(
          {
            err: error,
            topic: this.options.topic,
            groupId: this.options.groupId,
            partition,
          },
          'Kafka consumer runner previous commit failed; retrying contiguous flush'
        );
      })
      .then(() => this.flushContiguousOffsets(partition, state));
    await state.commitChain;
  }

  private async flushContiguousOffsets(
    partition: number,
    state: IPartitionCommitState
  ): Promise<void> {
    if (state.nextOffset === null) {
      return;
    }

    let commitUpTo = state.nextOffset - 1;
    while (state.completedOffsets.has(commitUpTo + 1)) {
      commitUpTo += 1;
    }

    if (commitUpTo < state.nextOffset) {
      return;
    }

    await this.commitResolvedOffset(partition, commitUpTo);

    for (let offset = state.nextOffset; offset <= commitUpTo; offset += 1) {
      state.completedOffsets.delete(offset);
      state.pendingOffsets.delete(offset);
    }

    state.nextOffset = commitUpTo + 1;

    if (state.pendingOffsets.size === 0 && state.completedOffsets.size === 0) {
      this.partitionCommitStates.delete(partition);
    }
  }

  private getPartitionCommitState(partition: number): IPartitionCommitState {
    const existing = this.partitionCommitStates.get(partition);
    if (existing) {
      return existing;
    }

    const created: IPartitionCommitState = {
      nextOffset: null,
      pendingOffsets: new Set(),
      completedOffsets: new Set(),
      commitChain: Promise.resolve(),
    };
    this.partitionCommitStates.set(partition, created);
    return created;
  }

  private async commitResolvedOffset(
    partition: number,
    offset: number
  ): Promise<void> {
    const consumer = this.consumerOrThrow as IResolvedCommitConsumer;
    if (typeof consumer.commitResolvedSync !== 'function') {
      await commitOffset(consumer, this.options.topic, partition, offset);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      setImmediate(() => {
        try {
          consumer.commitResolvedSync?.([
            {
              topic: this.options.topic,
              partition,
              offset: offset + 1,
            },
          ]);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private incrementInFlight(partition: number): void {
    this.totalInFlight += 1;
    this.inFlightByPartition.set(
      partition,
      (this.inFlightByPartition.get(partition) ?? 0) + 1
    );
  }

  private decrementInFlight(partition: number): void {
    this.totalInFlight = Math.max(0, this.totalInFlight - 1);
    const next = Math.max(
      0,
      (this.inFlightByPartition.get(partition) ?? 0) - 1
    );
    if (next === 0) {
      this.inFlightByPartition.delete(partition);
      return;
    }
    this.inFlightByPartition.set(partition, next);
  }

  private applyBackpressure(partition: number): void {
    if (this.totalInFlight >= this.maxInFlightTotal) {
      this.pauseAllKnownPartitions();
      return;
    }

    if (
      (this.inFlightByPartition.get(partition) ?? 0) <
      this.maxInFlightPerPartition
    ) {
      return;
    }

    this.pausePartition(partition);
  }

  private releaseBackpressure(): void {
    if (this.totalInFlight >= this.maxInFlightTotal) {
      return;
    }

    for (const pausedPartition of Array.from(this.pausedPartitions)) {
      if (
        (this.inFlightByPartition.get(pausedPartition) ?? 0) <
        this.maxInFlightPerPartition
      ) {
        this.resumePartition(pausedPartition);
      }
    }
  }

  private pauseAllKnownPartitions(): void {
    for (const partition of this.knownPartitions) {
      this.pausePartition(partition);
    }
  }

  private pausePartition(partition: number): void {
    if (this.pausedPartitions.has(partition)) {
      return;
    }

    try {
      this.consumerOrThrow.pause([{ topic: this.options.topic, partition }]);
      this.pausedPartitions.add(partition);
    } catch {}
  }

  private resumePartition(partition: number): void {
    if (!this.pausedPartitions.has(partition)) {
      return;
    }

    try {
      this.consumerOrThrow.resume([{ topic: this.options.topic, partition }]);
      this.pausedPartitions.delete(partition);
    } catch {}
  }

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }
    return this.consumer;
  }

  private clearState(): void {
    this.totalInFlight = 0;
    this.inFlightByPartition.clear();
    this.pausedPartitions.clear();
    this.knownPartitions.clear();
    this.partitionCommitStates.clear();
    this.entityChains.clear();
    this.tasks.clear();
  }
}
