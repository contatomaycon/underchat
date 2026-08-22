import type { KafkaConsumer } from 'node-rdkafka';
import type { KafkaConsumerStartPosition } from '@core/plugins/kafkaStreams';
import { createConsumer } from './createConsumer';
import { connectConsumer } from './connectConsumer';
import { commitOffset } from './commitOffset';
import { handleConsumerError } from './handleConsumerError';
import { resolveKafkaConsumerStartPosition } from './kafkaConsumerStartPositionPolicy';
import { getWorkerKafkaDispatchAuthorizationState } from './workerKafkaDispatchAuthorization';
import { kafkaConsumerDisconnectBudget } from './kafkaConsumerDisconnectBudget';
import { KafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';
import { runWithKafkaDispatchGuard } from './kafkaDispatchFenceContext';
import {
  acquireKafkaConsumerEntityFence,
  type IKafkaConsumerEntityFenceCancellation,
} from './kafkaConsumerEntityFence';
import type {
  KafkaConsumerEffectLease,
  KafkaConsumerRunnerContext,
  KafkaConsumerRunnerDiscardReason,
  KafkaConsumerRunnerErrorDecision,
  KafkaConsumerRunnerOptions,
  KafkaRunnerMessage,
} from '@core/common/interfaces/KafkaConsumerRunnerOptions';

interface IPartitionCommitState {
  assignmentEpoch?: number;
  dispatchGeneration?: number;
  runnerGeneration: number;
  nextOffset: number | null;
  pendingOffsets: Set<number>;
  completedOffsets: Set<number>;
  commitChain: Promise<void>;
}

interface IResolvedCommitConsumer extends KafkaConsumer {
  commitResolvedSync?: (
    offsets: Array<{
      topic: string;
      partition: number;
      offset: number;
      consumerAssignmentEpoch?: number;
    }>
  ) => unknown;
}

interface IAssignmentEpochConsumer extends KafkaConsumer {
  __health?: () => {
    pod_replacement_required?: boolean;
    last_error?: string;
  };
  __isAssignmentEpochActive?: (
    topic: string,
    partition: number,
    epoch: number
  ) => boolean;
  __reportProcessingProgress?: (
    topic: string,
    partition: number,
    offset: number,
    epoch: number
  ) => boolean;
  __markProcessingStarted?: (
    topic: string,
    partition: number,
    offset: number,
    epoch: number
  ) => boolean;
  __markProcessingSettled?: (
    topic: string,
    partition: number,
    offset: number,
    epoch: number
  ) => boolean;
  __isLatestAssignmentCutoverCommitted?: () => boolean;
  __restartGenerationWithoutCommit?: (reason: string) => void;
  __subscribeAssignmentInvalidation?: (
    listener: (partitions?: number[]) => void
  ) => () => void;
  __setRunnerPartitionBackpressure?: (
    topic: string,
    partition: number,
    assignmentEpoch: number,
    paused: boolean
  ) => boolean;
}

interface IAssignmentBackpressureToken {
  assignmentEpoch: number;
  runnerGeneration: number;
}

interface IActiveCoalesceEntry {
  assignmentEpoch?: number;
  dispatchGeneration?: number;
  offset: number;
  runnerGeneration: number;
}

interface IEntityChainEntry {
  assignmentEpoch: number;
  partition: number;
  promise: Promise<void>;
  runnerGeneration: number;
}

interface IGenerationRestartWithoutCommitRequest {
  message: KafkaRunnerMessage;
  entityKey: string;
  reason: string;
  cause?: unknown;
  restartLogMessage: string;
  unavailableLogMessage: string;
  failedLogMessage: string;
}

type CoalesceAdmission =
  | { kind: 'disabled' | 'bypass' | 'duplicate' | 'same_offset' }
  | {
      kind: 'primary';
      key: string;
      entry: IActiveCoalesceEntry;
    };

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

function withProcessingWatchdog<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  const timeout = setTimeout(onTimeout, timeoutMs) as ReturnType<
    typeof setTimeout
  > & {
    unref?: () => void;
  };
  timeout.unref?.();

  return promise.finally(() => clearTimeout(timeout));
}

export class KafkaConsumerRunner<TPayload> {
  public consumer: KafkaConsumer | null = null;

  private running = false;
  private closing = false;
  private acceptingRecords = false;
  private startPromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private totalInFlight = 0;
  private readonly inFlightByPartition = new Map<number, number>();
  private readonly inFlightAssignmentTokens = new Map<
    number,
    IAssignmentBackpressureToken
  >();
  private readonly pausedPartitions = new Map<
    number,
    IAssignmentBackpressureToken
  >();
  private readonly knownPartitions = new Map<
    number,
    IAssignmentBackpressureToken
  >();
  private readonly partitionCommitStates = new Map<
    number,
    IPartitionCommitState
  >();
  private readonly entityChains = new Map<string, IEntityChainEntry>();
  private readonly activeCoalesceKeys = new Map<
    number,
    Map<string, IActiveCoalesceEntry>
  >();
  private readonly tasks = new Set<Promise<void>>();
  private readonly entityFenceCancellationListeners = new Set<() => void>();
  private assignmentInvalidationUnsubscribe: (() => void) | null = null;
  private runnerGeneration = 0;

  private readonly maxInFlightTotal: number;
  private readonly maxInFlightPerPartition: number;
  private readonly maxRetries: number;
  private readonly retryDelaysMs: number[];
  private readonly processingTimeoutMs: number;
  private readonly shutdownDrainTimeoutMs: number;
  private readonly disconnectTimeoutMs: number;
  private readonly startPosition: KafkaConsumerStartPosition | undefined;
  private readonly startRetryBaseMs = readFirstPositiveIntegerEnv(
    ['KAFKA_CONSUMER_START_RETRY_BASE_MS'],
    1_000
  );
  private readonly startRetryMaxMs = readFirstPositiveIntegerEnv(
    ['KAFKA_CONSUMER_START_RETRY_MAX_MS'],
    5_000
  );

  constructor(private readonly options: KafkaConsumerRunnerOptions<TPayload>) {
    this.startPosition = resolveKafkaConsumerStartPosition(
      options.topic,
      options.startPosition
    );
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
        10_000
      );
    this.disconnectTimeoutMs = kafkaConsumerDisconnectBudget.wrapperTimeoutMs;
  }

  async start(onConnected?: () => void): Promise<void> {
    const closeInFlight = this.closePromise;
    if (closeInFlight) {
      await closeInFlight;
    }
    if (this.startPromise) {
      await this.startPromise;
      return;
    }

    if (this.consumer) {
      return;
    }

    this.closing = false;
    this.acceptingRecords = false;
    this.runnerGeneration += 1;
    const startPromise = this.startWithRetry(onConnected);
    this.startPromise = startPromise;
    try {
      await startPromise;
    } finally {
      if (this.startPromise === startPromise) {
        this.startPromise = null;
      }
    }
  }

  private async startWithRetry(onConnected?: () => void): Promise<void> {
    let attempt = 0;
    while (!this.closing) {
      try {
        await this.startInternal(onConnected);
        return;
      } catch (error) {
        if (this.closing) {
          throw error;
        }

        attempt += 1;
        const retryInMs = Math.min(
          this.startRetryMaxMs,
          this.startRetryBaseMs * 2 ** Math.min(attempt - 1, 5)
        );
        this.options.logger?.warn?.(
          {
            err: error,
            topic: this.options.topic,
            groupId: this.options.groupId,
            attempt,
            retryInMs,
          },
          'Kafka consumer start failed; retrying'
        );
        await delay(retryInMs);
      }
    }

    throw new Error('Kafka consumer start cancelled');
  }

  private async startInternal(onConnected?: () => void): Promise<void> {
    if (this.closing) {
      throw new Error('Kafka consumer start cancelled before client creation');
    }

    const consumer = createConsumer(this.options.kafka, this.options.groupId, {
      startPosition: this.startPosition,
      requireDispatchAuthorization: this.options.requireDispatchAuthorization,
    });
    this.consumer = consumer;
    this.subscribeAssignmentInvalidation(consumer);

    const runnerGeneration = this.runnerGeneration;
    consumer.on('data', (message) => {
      this.handleData(message as KafkaRunnerMessage, runnerGeneration);
    });

    consumer.on('event.error', (error) => {
      handleConsumerError(error, this.options.topic);
    });

    try {
      await connectConsumer(consumer, this.options.topic, () => {
        if (this.closing || this.consumer !== consumer) {
          return;
        }
        if (!this.isLatestAssignmentCutoverCommitted(consumer)) {
          throw new Error(
            `Kafka latest-on-assignment cutover is not committed for topic ${this.options.topic}`
          );
        }
        this.running = true;
        this.acceptingRecords = true;
        onConnected?.();
      });

      if (
        this.closing ||
        this.consumer !== consumer ||
        (this.startPosition === 'latest-on-assignment' &&
          (!this.running || !this.isLatestAssignmentCutoverCommitted(consumer)))
      ) {
        throw new Error('Kafka consumer start cancelled before readiness');
      }
    } catch (error) {
      this.acceptingRecords = false;
      this.running = false;
      if (this.consumer === consumer) {
        this.consumer = null;
      }
      this.unsubscribeAssignmentInvalidation();
      await this.disconnectConsumer(consumer);
      this.clearState();
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }

    const operation = this.closeInternal();
    this.closePromise = operation;
    try {
      await operation;
    } finally {
      if (this.closePromise === operation) {
        this.closePromise = null;
      }
    }
  }

  private async closeInternal(): Promise<void> {
    const startInFlight = this.startPromise;
    const wasRunning = this.running;
    /*
     * Stop admission first, but keep the current generation valid while
     * already-admitted work drains and commits. Invalidating the generation
     * before this drain creates a real loss window: a handler may finish just
     * before shutdown while its broker commit is silently skipped.
     */
    this.acceptingRecords = false;

    if (startInFlight && !wasRunning) {
      this.closing = true;
      this.running = false;
      this.runnerGeneration += 1;
      this.cancelEntityFenceWaiters();
      this.clearActiveCoalesceKeys();
      this.unsubscribeAssignmentInvalidation();
      const startingConsumer = this.consumer;
      if (startingConsumer) {
        await this.disconnectConsumer(startingConsumer);
      }
    }
    if (startInFlight) {
      await startInFlight.catch(() => undefined);
    }

    if (wasRunning) {
      this.pauseAllKnownPartitions();
      await this.waitForDrain(Array.from(this.tasks), 'tasks');
      await this.waitForDrain(
        Array.from(this.partitionCommitStates.values()).map(
          (state) => state.commitChain
        ),
        'commit_chains'
      );
    }

    this.closing = true;
    this.running = false;
    this.runnerGeneration += 1;
    this.cancelEntityFenceWaiters();
    this.clearActiveCoalesceKeys();
    this.unsubscribeAssignmentInvalidation();

    const consumer = this.consumer;
    if (!consumer) {
      this.clearState();
      return;
    }

    await this.disconnectConsumer(consumer);

    if (this.consumer === consumer) {
      this.consumer = null;
    }
    this.clearState();
  }

  private async disconnectConsumer(consumer: KafkaConsumer): Promise<void> {
    const disconnect = new Promise<void>((resolve) => {
      try {
        consumer.unsubscribe();
      } catch {}
      try {
        consumer.disconnect(resolve);
      } catch {
        resolve();
      }
    });

    try {
      await withTimeout(
        disconnect,
        this.disconnectTimeoutMs,
        `Kafka consumer disconnect timed out after ${this.disconnectTimeoutMs}ms`
      );
    } catch (error) {
      this.options.logger?.warn?.(
        {
          topic: this.options.topic,
          groupId: this.options.groupId,
          timeoutMs: this.disconnectTimeoutMs,
          error,
        },
        'Kafka consumer disconnect timed out during close'
      );
      throw error;
    }

    const health = (consumer as IAssignmentEpochConsumer).__health?.();
    if (health?.pod_replacement_required) {
      throw new Error(
        health.last_error ||
          'Kafka consumer requires process replacement after native disconnect failure'
      );
    }
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

  private handleData(
    message: KafkaRunnerMessage,
    runnerGeneration: number
  ): void {
    if (
      !this.acceptingRecords ||
      !this.isRunnerGenerationActive(runnerGeneration)
    ) {
      return;
    }

    const dispatchState = getWorkerKafkaDispatchAuthorizationState();
    if (
      this.options.requireDispatchAuthorization &&
      !dispatchState.authorized
    ) {
      return;
    }
    const dispatchGeneration = this.options.requireDispatchAuthorization
      ? dispatchState.generation
      : undefined;

    const normalizedMessage: KafkaRunnerMessage = {
      ...message,
      topic: message.topic || this.options.topic,
    };
    if (!this.isMessageAssignmentActive(normalizedMessage, runnerGeneration)) {
      return;
    }

    const backpressureToken = this.createBackpressureToken(
      normalizedMessage,
      runnerGeneration
    );
    this.registerKnownPartition(normalizedMessage.partition, backpressureToken);
    this.registerOffset(
      normalizedMessage.partition,
      normalizedMessage.offset,
      normalizedMessage.consumerAssignmentEpoch,
      dispatchGeneration,
      runnerGeneration
    );
    this.incrementInFlight(normalizedMessage.partition, backpressureToken);
    this.applyBackpressure(normalizedMessage.partition, backpressureToken);

    const task = this.processMessage(
      normalizedMessage,
      dispatchGeneration,
      runnerGeneration
    )
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
        if (this.runnerGeneration === runnerGeneration) {
          const releasedCurrentAssignment = this.decrementInFlight(
            normalizedMessage.partition,
            backpressureToken
          );
          if (releasedCurrentAssignment) {
            this.releaseBackpressure();
          }
        }
      });

    this.tasks.add(task);
  }

  private async processMessage(
    message: KafkaRunnerMessage,
    dispatchGeneration: number | undefined,
    runnerGeneration: number
  ): Promise<void> {
    if (
      !this.isMessageExecutionActive(
        message,
        dispatchGeneration,
        runnerGeneration
      )
    ) {
      return;
    }

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
      if (
        !this.isMessageExecutionActive(
          message,
          dispatchGeneration,
          runnerGeneration
        )
      ) {
        return;
      }
      if (!this.markProcessingStarted(message)) {
        return;
      }
      await this.runInvalidMessageHook(message);
      if (
        !this.isMessageExecutionActive(
          message,
          dispatchGeneration,
          runnerGeneration
        )
      ) {
        return;
      }
      this.logInvalidPayloadDiscarded(message, error);
      await this.completeOffset(
        message.partition,
        message.offset,
        message.consumerAssignmentEpoch,
        dispatchGeneration,
        runnerGeneration
      );
      return;
    }

    if (!payload) {
      if (
        !this.isMessageExecutionActive(
          message,
          dispatchGeneration,
          runnerGeneration
        )
      ) {
        return;
      }
      if (!this.markProcessingStarted(message)) {
        return;
      }
      await this.runInvalidMessageHook(message);
      if (
        !this.isMessageExecutionActive(
          message,
          dispatchGeneration,
          runnerGeneration
        )
      ) {
        return;
      }
      this.logInvalidPayloadDiscarded(message, null);
      await this.completeOffset(
        message.partition,
        message.offset,
        message.consumerAssignmentEpoch,
        dispatchGeneration,
        runnerGeneration
      );
      return;
    }

    const coalesceAdmission = this.resolveCoalesceAdmission(
      payload,
      message,
      dispatchGeneration,
      runnerGeneration
    );
    if (coalesceAdmission.kind === 'duplicate') {
      void this.completeOffset(
        message.partition,
        message.offset,
        message.consumerAssignmentEpoch,
        dispatchGeneration,
        runnerGeneration
      );
      return;
    }
    if (coalesceAdmission.kind === 'same_offset') {
      return;
    }

    try {
      await this.processParsedPayload(
        payload,
        message,
        dispatchGeneration,
        runnerGeneration
      );
    } finally {
      if (coalesceAdmission.kind === 'primary') {
        this.releaseActiveCoalesceKey(
          message.partition,
          coalesceAdmission.key,
          coalesceAdmission.entry
        );
      }
    }
  }

  private async processParsedPayload(
    payload: TPayload,
    message: KafkaRunnerMessage,
    dispatchGeneration: number | undefined,
    runnerGeneration: number
  ): Promise<void> {
    const entityKey = this.resolveEntityKey(payload, message);
    if (!this.options.preserveEntityOrder) {
      await this.processPayloadWithEntityFence(
        payload,
        message,
        entityKey,
        dispatchGeneration,
        runnerGeneration
      );
      return;
    }

    const existing = this.entityChains.get(entityKey);
    const previous =
      existing &&
      existing.partition === message.partition &&
      existing.assignmentEpoch === message.consumerAssignmentEpoch &&
      existing.runnerGeneration === runnerGeneration
        ? existing.promise
        : Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() =>
        this.processPayloadWithEntityFence(
          payload,
          message,
          entityKey,
          dispatchGeneration,
          runnerGeneration
        )
      )
      .finally(() => {
        if (this.entityChains.get(entityKey)?.promise === current) {
          this.entityChains.delete(entityKey);
        }
      });

    this.entityChains.set(entityKey, {
      assignmentEpoch: message.consumerAssignmentEpoch as number,
      partition: message.partition,
      promise: current,
      runnerGeneration,
    });
    await current;
  }

  private async processPayloadWithEntityFence(
    payload: TPayload,
    message: KafkaRunnerMessage,
    entityKey: string,
    dispatchGeneration: number | undefined,
    runnerGeneration: number
  ): Promise<void> {
    if (
      !this.options.preserveEntityOrder &&
      !this.options.requireDispatchAuthorization
    ) {
      await this.processPayload(
        payload,
        message,
        entityKey,
        dispatchGeneration,
        runnerGeneration
      );
      return;
    }

    const lease = await acquireKafkaConsumerEntityFence({
      brokers: this.options.kafka.getBroker(),
      groupId: this.options.groupId,
      topic: this.options.topic,
      entityKey,
      cancellation: this.entityFenceCancellation(runnerGeneration),
    });
    if (!lease) {
      return;
    }

    try {
      await this.processPayload(
        payload,
        message,
        entityKey,
        dispatchGeneration,
        runnerGeneration
      );
    } finally {
      lease.release();
    }
  }

  private async processPayload(
    payload: TPayload,
    message: KafkaRunnerMessage,
    entityKey: string,
    dispatchGeneration: number | undefined,
    runnerGeneration: number
  ): Promise<void> {
    if (
      !this.isMessageExecutionActive(
        message,
        dispatchGeneration,
        runnerGeneration
      )
    ) {
      return;
    }
    if (!this.markProcessingStarted(message)) {
      return;
    }

    const kafkaKey = keyToString(message.key);

    for (let attempt = 1; ; attempt += 1) {
      if (
        attempt > this.maxRetries &&
        !this.isExtendedRetryActive(
          message,
          dispatchGeneration,
          runnerGeneration
        )
      ) {
        return;
      }
      if (
        !this.isMessageExecutionActive(
          message,
          dispatchGeneration,
          runnerGeneration
        )
      ) {
        return;
      }

      let effectLease: KafkaConsumerEffectLease | null = null;
      const isEffectLeaseOwned = (): boolean => {
        if (!effectLease) {
          return true;
        }
        try {
          effectLease.assertOwned();
          return true;
        } catch {
          return false;
        }
      };
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
        isActive: () =>
          this.isMessageExecutionActive(
            message,
            dispatchGeneration,
            runnerGeneration
          ) && isEffectLeaseOwned(),
        assertActive: () => {
          if (
            !this.isMessageExecutionActive(
              message,
              dispatchGeneration,
              runnerGeneration
            ) ||
            !isEffectLeaseOwned()
          ) {
            throw new KafkaConsumerDispatchRevokedError();
          }
        },
        reportProgress: () => {
          context.assertActive();
          const epoch = message.consumerAssignmentEpoch;
          const consumer = this.consumer as IAssignmentEpochConsumer | null;
          if (
            typeof epoch !== 'number' ||
            consumer?.__reportProcessingProgress?.(
              this.options.topic,
              message.partition,
              message.offset,
              epoch
            ) !== true
          ) {
            throw new KafkaConsumerDispatchRevokedError();
          }
        },
      };
      let retryDelayAfterRelease = 0;

      try {
        if (this.options.acquireEffectLease) {
          effectLease = await this.acquireEffectLeaseOrResolveRejection(
            payload,
            context,
            message,
            entityKey,
            dispatchGeneration,
            runnerGeneration
          );
          if (!effectLease) {
            return;
          }
          context.assertActive();
        }
        await runWithKafkaDispatchGuard(context.assertActive, () =>
          withProcessingWatchdog(
            this.options.handle(payload, context),
            this.processingTimeoutMs,
            () => {
              this.options.logger?.warn?.(
                {
                  topic: this.options.topic,
                  groupId: this.options.groupId,
                  partition: message.partition,
                  offset: message.offset,
                  timeoutMs: this.processingTimeoutMs,
                },
                'Kafka consumer handler exceeded its processing watchdog; waiting for the original attempt to settle'
              );
            }
          )
        );
        context.assertActive();
        await runWithKafkaDispatchGuard(context.assertActive, () =>
          this.runProcessedHook(payload, context)
        );
        context.assertActive();
        await this.completeOffset(
          message.partition,
          message.offset,
          message.consumerAssignmentEpoch,
          dispatchGeneration,
          runnerGeneration
        );
        return;
      } catch (error) {
        if (!context.isActive()) {
          return;
        }
        await runWithKafkaDispatchGuard(context.assertActive, () =>
          this.runFailedHook(payload, context, error)
        );

        if (!context.isActive()) {
          return;
        }

        if (this.resolveErrorDecision(payload, context, error) === 'terminal') {
          this.logTerminalErrorDiscarded(payload, message, entityKey, error);
          context.assertActive();
          await runWithKafkaDispatchGuard(context.assertActive, () =>
            this.runDiscardedHook(payload, context, error, 'terminal_error')
          );
          context.assertActive();
          await this.completeOffset(
            message.partition,
            message.offset,
            message.consumerAssignmentEpoch,
            dispatchGeneration,
            runnerGeneration
          );
          return;
        }

        const retriesExhausted = attempt >= this.maxRetries;
        if (retriesExhausted) {
          const continueWithoutCommit = this.shouldContinueRetryWithoutCommit(
            payload,
            context,
            error
          );
          if (!continueWithoutCommit) {
            this.logRetriesExhausted(payload, message, entityKey, error);
            context.assertActive();
            await runWithKafkaDispatchGuard(context.assertActive, () =>
              this.runDiscardedHook(payload, context, error, 'retry_exhausted')
            );
            context.assertActive();
            await this.completeOffset(
              message.partition,
              message.offset,
              message.consumerAssignmentEpoch,
              dispatchGeneration,
              runnerGeneration
            );
            return;
          }
          if (
            !this.isExtendedRetryActive(
              message,
              dispatchGeneration,
              runnerGeneration
            )
          ) {
            return;
          }
        }

        retryDelayAfterRelease = this.retryDelayMs(attempt);
      } finally {
        if (effectLease) {
          await effectLease.release().catch((error) => {
            this.options.logger?.error?.(
              {
                err: error,
                topic: this.options.topic,
                groupId: this.options.groupId,
                partition: message.partition,
                offset: message.offset,
                entityKey,
              },
              'Kafka consumer failed to release its runtime effect lease; TTL cleanup will fence cutover'
            );
          });
        }
      }
      if (retryDelayAfterRelease > 0) {
        await delay(retryDelayAfterRelease);
      }
    }
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
      if (this.options.failOnInvalidMessageHookError) {
        throw error;
      }
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

  private shouldContinueRetryWithoutCommit(
    payload: TPayload,
    context: KafkaConsumerRunnerContext<TPayload>,
    error: unknown
  ): boolean {
    try {
      return Boolean(
        this.options.shouldContinueRetryWithoutCommit?.(payload, context, error)
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
        'Kafka consumer runner shouldContinueRetryWithoutCommit hook failed'
      );
      return false;
    }
  }

  private retryDelayMs(attempt: number): number {
    return (
      this.retryDelaysMs[attempt - 1] ??
      this.retryDelaysMs[this.retryDelaysMs.length - 1] ??
      1000
    );
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
      if (this.options.failOnDiscardedHookError) {
        this.restartAfterDiscardHookFailure(context, error);
        throw error;
      }
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

  private resolveCoalesceAdmission(
    payload: TPayload,
    message: KafkaRunnerMessage,
    dispatchGeneration: number | undefined,
    runnerGeneration: number
  ): CoalesceAdmission {
    const key = this.resolveCoalesceKey(payload, message);
    if (!key) {
      return { kind: 'disabled' };
    }

    const current = this.activeCoalesceKeys.get(message.partition)?.get(key);
    if (
      current &&
      !this.isActiveCoalesceEntry(
        current,
        message,
        dispatchGeneration,
        runnerGeneration
      )
    ) {
      this.releaseActiveCoalesceKey(message.partition, key, current);
    } else if (current) {
      if (message.offset > current.offset) {
        return { kind: 'duplicate' };
      }
      if (message.offset === current.offset) {
        return { kind: 'same_offset' };
      }
      return { kind: 'bypass' };
    }

    const entry: IActiveCoalesceEntry = {
      assignmentEpoch: message.consumerAssignmentEpoch,
      dispatchGeneration,
      offset: message.offset,
      runnerGeneration,
    };
    const partitionEntries =
      this.activeCoalesceKeys.get(message.partition) ?? new Map();
    partitionEntries.set(key, entry);
    this.activeCoalesceKeys.set(message.partition, partitionEntries);
    return { kind: 'primary', key, entry };
  }

  private resolveCoalesceKey(
    payload: TPayload,
    message: KafkaRunnerMessage
  ): string | null {
    if (!this.options.resolveCoalesceKey) {
      return null;
    }

    try {
      return this.options.resolveCoalesceKey(payload, message)?.trim() || null;
    } catch (error) {
      this.options.logger?.error?.(
        {
          err: error,
          topic: this.options.topic,
          groupId: this.options.groupId,
          partition: message.partition,
          offset: message.offset,
        },
        'Kafka consumer runner coalesce key resolver failed; processing record normally'
      );
      return null;
    }
  }

  private isActiveCoalesceEntry(
    entry: IActiveCoalesceEntry,
    message: KafkaRunnerMessage,
    dispatchGeneration: number | undefined,
    runnerGeneration: number
  ): boolean {
    return (
      entry.assignmentEpoch === message.consumerAssignmentEpoch &&
      entry.dispatchGeneration === dispatchGeneration &&
      entry.runnerGeneration === runnerGeneration &&
      this.isRunnerGenerationActive(entry.runnerGeneration) &&
      this.isAssignmentEpochActive(message.partition, entry.assignmentEpoch) &&
      this.isDispatchGenerationActive(entry.dispatchGeneration)
    );
  }

  private releaseActiveCoalesceKey(
    partition: number,
    key: string,
    entry: IActiveCoalesceEntry
  ): void {
    const partitionEntries = this.activeCoalesceKeys.get(partition);
    if (!partitionEntries || partitionEntries.get(key) !== entry) {
      return;
    }

    partitionEntries.delete(key);
    if (partitionEntries.size === 0) {
      this.activeCoalesceKeys.delete(partition);
    }
  }

  private resolveEntityKey(
    payload: TPayload,
    message: KafkaRunnerMessage
  ): string {
    try {
      const resolved = this.options.resolveEntityKey
        ? this.options.resolveEntityKey(payload, message)?.trim()
        : null;
      if (resolved) {
        return resolved;
      }
    } catch (error) {
      this.options.logger?.error?.(
        {
          err: error,
          topic: this.options.topic,
          groupId: this.options.groupId,
          partition: message.partition,
          offset: message.offset,
        },
        'Kafka consumer runner entity key resolver failed; using record identity fallback'
      );
    }

    const kafkaKey = keyToString(message.key);
    if (kafkaKey) {
      return kafkaKey;
    }

    return `${this.options.topic}:${message.partition}:${message.offset}`;
  }

  private markProcessingStarted(message: KafkaRunnerMessage): boolean {
    const consumer = this.consumer as IAssignmentEpochConsumer | null;
    const markStarted = consumer?.__markProcessingStarted;
    if (typeof markStarted !== 'function') {
      return true;
    }

    const epoch = message.consumerAssignmentEpoch;
    return (
      typeof epoch === 'number' &&
      markStarted.call(
        consumer,
        this.options.topic,
        message.partition,
        message.offset,
        epoch
      ) === true
    );
  }

  private markProcessingSettled(
    partition: number,
    offset: number,
    assignmentEpoch?: number
  ): boolean {
    const consumer = this.consumer as IAssignmentEpochConsumer | null;
    const markSettled = consumer?.__markProcessingSettled;
    if (typeof markSettled !== 'function') {
      return true;
    }

    return (
      typeof assignmentEpoch === 'number' &&
      markSettled.call(
        consumer,
        this.options.topic,
        partition,
        offset,
        assignmentEpoch
      ) === true
    );
  }

  private registerOffset(
    partition: number,
    offset: number,
    assignmentEpoch?: number,
    dispatchGeneration?: number,
    runnerGeneration = this.runnerGeneration
  ): void {
    const state = this.getPartitionCommitState(
      partition,
      assignmentEpoch,
      dispatchGeneration,
      runnerGeneration
    );
    state.pendingOffsets.add(offset);
    if (state.nextOffset === null || offset < state.nextOffset) {
      state.nextOffset = offset;
    }
  }

  private async acquireEffectLeaseOrResolveRejection(
    payload: TPayload,
    context: KafkaConsumerRunnerContext<TPayload>,
    message: KafkaRunnerMessage,
    entityKey: string,
    dispatchGeneration: number | undefined,
    runnerGeneration: number
  ): Promise<KafkaConsumerEffectLease | null> {
    const acquireEffectLease = this.options.acquireEffectLease;
    if (!acquireEffectLease) {
      this.restartGenerationWithoutCommit(
        message,
        entityKey,
        new Error('Runtime effect lease acquisition is not configured')
      );
      return null;
    }

    let effectLease: KafkaConsumerEffectLease | null;
    try {
      effectLease = await acquireEffectLease(payload, context);
    } catch (error) {
      if (
        !this.isMessageExecutionActive(
          message,
          dispatchGeneration,
          runnerGeneration
        )
      ) {
        return null;
      }
      if (this.resolveErrorDecision(payload, context, error) === 'terminal') {
        // Let the outer processing boundary execute the normal terminal
        // hooks and commit path. Infrastructure uncertainty remains below as
        // restart-without-commit.
        throw error;
      }

      try {
        context.assertActive();
        const recovery =
          (await this.options.recoverEffectLeaseAcquisitionFailure?.(
            payload,
            context,
            error
          )) ?? 'retry';
        if (
          !this.isMessageExecutionActive(
            message,
            dispatchGeneration,
            runnerGeneration
          )
        ) {
          return null;
        }
        if (recovery === 'durable_handoff') {
          context.assertActive();
          await this.completeOffset(
            message.partition,
            message.offset,
            message.consumerAssignmentEpoch,
            dispatchGeneration,
            runnerGeneration
          );
          return null;
        }
      } catch (recoveryError) {
        if (
          !this.isMessageExecutionActive(
            message,
            dispatchGeneration,
            runnerGeneration
          )
        ) {
          return null;
        }
        if (
          this.shouldContinueRetryWithoutCommit(payload, context, recoveryError)
        ) {
          throw recoveryError;
        }
        this.restartGenerationWithoutCommit(message, entityKey, recoveryError);
        return null;
      }

      if (this.shouldContinueRetryWithoutCommit(payload, context, error)) {
        throw error;
      }
      this.restartGenerationWithoutCommit(message, entityKey, error);
      return null;
    }

    if (effectLease) {
      return effectLease;
    }

    let decision: 'retry' | 'terminal' = 'retry';
    try {
      decision =
        (await this.options.classifyEffectLeaseRejection?.(payload, context)) ??
        'retry';
    } catch (error) {
      if (
        !this.isMessageExecutionActive(
          message,
          dispatchGeneration,
          runnerGeneration
        )
      ) {
        return null;
      }
      // A failed current-runtime check is infrastructure uncertainty, never
      // proof that the event is stale. Redrive it without committing.
      if (this.shouldContinueRetryWithoutCommit(payload, context, error)) {
        throw error;
      }
      this.restartGenerationWithoutCommit(message, entityKey, error);
      return null;
    }

    if (
      !this.isMessageExecutionActive(
        message,
        dispatchGeneration,
        runnerGeneration
      )
    ) {
      return null;
    }

    if (decision !== 'terminal') {
      this.restartGenerationWithoutCommit(message, entityKey);
      return null;
    }

    this.options.logger?.warn?.(
      {
        topic: this.options.topic,
        groupId: this.options.groupId,
        partition: message.partition,
        offset: message.offset,
        entityKey,
      },
      'Kafka consumer discarded a runtime-fenced event proven stale and committed its offset'
    );
    context.assertActive();
    await this.completeOffset(
      message.partition,
      message.offset,
      message.consumerAssignmentEpoch,
      dispatchGeneration,
      runnerGeneration
    );
    return null;
  }

  private restartGenerationWithoutCommit(
    message: KafkaRunnerMessage,
    entityKey: string,
    cause?: unknown
  ): void {
    const reason = cause
      ? `runtime effect lease admission check failed for ${this.options.topic}` +
        `[${message.partition}] at offset ${message.offset}`
      : `runtime effect lease admission rejected for ${this.options.topic}` +
        `[${message.partition}] at offset ${message.offset}`;

    this.requestGenerationRestartWithoutCommit({
      message,
      entityKey,
      reason,
      cause,
      restartLogMessage: cause
        ? 'Kafka consumer runtime effect lease admission check failed; restarting the generation without committing for redelivery'
        : 'Kafka consumer runtime effect lease admission closed; restarting the generation without committing for redelivery',
      unavailableLogMessage:
        'Kafka consumer cannot restart its generation; record was left uncommitted and the partition was paused',
      failedLogMessage:
        'Kafka consumer generation restart failed; record was left uncommitted and the partition was paused',
    });
  }

  private restartAfterDiscardHookFailure(
    context: KafkaConsumerRunnerContext<TPayload>,
    error: unknown
  ): void {
    this.requestGenerationRestartWithoutCommit({
      message: context.message,
      entityKey: context.entityKey,
      reason:
        `discard hook failed for ${this.options.topic}` +
        `[${context.partition}] at offset ${context.offset}`,
      cause: error,
      restartLogMessage:
        'Kafka consumer fail-closed discard hook failed; restarting the generation without committing for redelivery',
      unavailableLogMessage:
        'Kafka consumer cannot restart after a fail-closed discard hook failure; record was left uncommitted and the partition was paused',
      failedLogMessage:
        'Kafka consumer generation restart after a fail-closed discard hook failure failed; record was left uncommitted and the partition was paused',
    });
  }

  private requestGenerationRestartWithoutCommit(
    input: IGenerationRestartWithoutCommitRequest
  ): void {
    const consumer = this.consumerOrThrow as IAssignmentEpochConsumer;
    this.options.logger?.warn?.(
      {
        err: input.cause,
        topic: this.options.topic,
        groupId: this.options.groupId,
        partition: input.message.partition,
        offset: input.message.offset,
        entityKey: input.entityKey,
      },
      input.restartLogMessage
    );

    let restartError: unknown;
    if (typeof consumer.__restartGenerationWithoutCommit === 'function') {
      try {
        consumer.__restartGenerationWithoutCommit(input.reason);
        return;
      } catch (error) {
        restartError = error;
      }
    }

    // createConsumer always supplies the managed restart hook. Keep this
    // fallback fail-closed for test doubles or an unexpected unmanaged
    // consumer: stop this partition and never commit it. A broken hook must
    // not fall through to retry exhaustion, which may commit a discard.
    const pauseError = this.pausePartitionWithoutCommit(
      consumer,
      input.message
    );
    this.options.logger?.error?.(
      {
        err: restartError ?? pauseError,
        topic: this.options.topic,
        groupId: this.options.groupId,
        partition: input.message.partition,
        offset: input.message.offset,
      },
      restartError ? input.failedLogMessage : input.unavailableLogMessage
    );
  }

  private pausePartitionWithoutCommit(
    consumer: IAssignmentEpochConsumer,
    message: KafkaRunnerMessage
  ): unknown {
    try {
      consumer.pause([
        {
          topic: this.options.topic,
          partition: message.partition,
        },
      ]);
      return undefined;
    } catch (error) {
      return error;
    }
  }

  private async completeOffset(
    partition: number,
    offset: number,
    assignmentEpoch?: number,
    dispatchGeneration?: number,
    runnerGeneration = this.runnerGeneration
  ): Promise<void> {
    const state = this.partitionCommitStates.get(partition);
    if (
      !state ||
      state.assignmentEpoch !== assignmentEpoch ||
      state.dispatchGeneration !== dispatchGeneration ||
      state.runnerGeneration !== runnerGeneration ||
      !this.isRunnerGenerationActive(runnerGeneration) ||
      !this.isDispatchGenerationActive(dispatchGeneration)
    ) {
      return;
    }
    if (!this.markProcessingSettled(partition, offset, assignmentEpoch)) {
      return;
    }
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
    try {
      await state.commitChain;
    } catch (error) {
      // The handler has already completed. Retrying it because only the Kafka
      // commit failed can duplicate irreversible effects. Keep the completed
      // offset in the partition state so the next contiguous flush retries
      // the commit without invoking the handler again.
      this.options.logger?.error?.(
        {
          err: error,
          topic: this.options.topic,
          groupId: this.options.groupId,
          partition,
          offset,
        },
        'Kafka consumer offset commit failed after processing; handler will not be replayed'
      );
    }
  }

  private async flushContiguousOffsets(
    partition: number,
    state: IPartitionCommitState
  ): Promise<void> {
    if (state.pendingOffsets.size === 0) {
      return;
    }

    if (
      this.partitionCommitStates.get(partition) !== state ||
      !this.isRunnerGenerationActive(state.runnerGeneration) ||
      !this.isAssignmentEpochActive(partition, state.assignmentEpoch) ||
      !this.isDispatchGenerationActive(state.dispatchGeneration)
    ) {
      return;
    }

    /*
     * Kafka offsets are monotonically increasing, but they are not guaranteed
     * to be numerically contiguous: log compaction can make a fetch jump from
     * offset 10 straight to 12. Coordinate the commit against the ordered set
     * of records actually delivered to this runner. Requiring `offset + 1`
     * would leave every later completed record permanently uncommitted after
     * the first compacted gap.
     */
    const completedPrefix: number[] = [];
    const deliveredOffsets = [...state.pendingOffsets].sort(
      (left, right) => left - right
    );
    for (const deliveredOffset of deliveredOffsets) {
      if (!state.completedOffsets.has(deliveredOffset)) {
        break;
      }
      completedPrefix.push(deliveredOffset);
    }

    const commitUpTo = completedPrefix[completedPrefix.length - 1];
    if (commitUpTo === undefined) {
      return;
    }

    await this.commitResolvedOffset(
      partition,
      commitUpTo,
      state.assignmentEpoch,
      state.dispatchGeneration,
      state.runnerGeneration
    );

    if (
      this.partitionCommitStates.get(partition) !== state ||
      !this.isRunnerGenerationActive(state.runnerGeneration) ||
      !this.isAssignmentEpochActive(partition, state.assignmentEpoch) ||
      !this.isDispatchGenerationActive(state.dispatchGeneration)
    ) {
      return;
    }

    for (const completedOffset of completedPrefix) {
      state.completedOffsets.delete(completedOffset);
      state.pendingOffsets.delete(completedOffset);
    }

    state.nextOffset =
      state.pendingOffsets.size > 0 ? Math.min(...state.pendingOffsets) : null;

    if (state.pendingOffsets.size === 0 && state.completedOffsets.size === 0) {
      this.partitionCommitStates.delete(partition);
    }
  }

  private getPartitionCommitState(
    partition: number,
    assignmentEpoch?: number,
    dispatchGeneration?: number,
    runnerGeneration = this.runnerGeneration
  ): IPartitionCommitState {
    const existing = this.partitionCommitStates.get(partition);
    if (
      existing &&
      existing.assignmentEpoch === assignmentEpoch &&
      existing.dispatchGeneration === dispatchGeneration &&
      existing.runnerGeneration === runnerGeneration
    ) {
      return existing;
    }

    const created: IPartitionCommitState = {
      assignmentEpoch,
      dispatchGeneration,
      runnerGeneration,
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
    offset: number,
    assignmentEpoch?: number,
    dispatchGeneration?: number,
    runnerGeneration = this.runnerGeneration
  ): Promise<void> {
    if (
      !this.isRunnerGenerationActive(runnerGeneration) ||
      !this.isAssignmentEpochActive(partition, assignmentEpoch) ||
      !this.isDispatchGenerationActive(dispatchGeneration)
    ) {
      return;
    }

    const consumer = this.consumerOrThrow as IResolvedCommitConsumer;
    if (typeof consumer.commitResolvedSync !== 'function') {
      await commitOffset(consumer, this.options.topic, partition, offset);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      setImmediate(() => {
        try {
          if (
            !this.isRunnerGenerationActive(runnerGeneration) ||
            !this.isAssignmentEpochActive(partition, assignmentEpoch) ||
            !this.isDispatchGenerationActive(dispatchGeneration)
          ) {
            resolve();
            return;
          }
          consumer.commitResolvedSync?.([
            {
              topic: this.options.topic,
              partition,
              offset: offset + 1,
              consumerAssignmentEpoch: assignmentEpoch,
            },
          ]);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private createBackpressureToken(
    message: KafkaRunnerMessage,
    runnerGeneration: number
  ): IAssignmentBackpressureToken {
    if (typeof message.consumerAssignmentEpoch !== 'number') {
      throw new Error(
        `Kafka record for ${this.options.topic}[${message.partition}] is missing its assignment epoch`
      );
    }

    return {
      assignmentEpoch: message.consumerAssignmentEpoch,
      runnerGeneration,
    };
  }

  private registerKnownPartition(
    partition: number,
    token: IAssignmentBackpressureToken
  ): void {
    const current = this.knownPartitions.get(partition);
    if (current && !this.isSameBackpressureToken(current, token)) {
      this.invalidatePartitionState(partition);
    }
    this.knownPartitions.set(partition, token);
  }

  private incrementInFlight(
    partition: number,
    token: IAssignmentBackpressureToken
  ): void {
    const current = this.inFlightAssignmentTokens.get(partition);
    if (current && !this.isSameBackpressureToken(current, token)) {
      this.clearPartitionInFlight(partition);
    }

    this.inFlightAssignmentTokens.set(partition, token);
    this.totalInFlight += 1;
    this.inFlightByPartition.set(
      partition,
      (this.inFlightByPartition.get(partition) ?? 0) + 1
    );
  }

  private decrementInFlight(
    partition: number,
    token: IAssignmentBackpressureToken
  ): boolean {
    this.totalInFlight = Math.max(0, this.totalInFlight - 1);
    const current = this.inFlightAssignmentTokens.get(partition);
    if (!current || !this.isSameBackpressureToken(current, token)) {
      return false;
    }

    const next = Math.max(
      0,
      (this.inFlightByPartition.get(partition) ?? 0) - 1
    );
    if (next === 0) {
      this.inFlightByPartition.delete(partition);
      this.inFlightAssignmentTokens.delete(partition);
      return true;
    }
    this.inFlightByPartition.set(partition, next);
    return true;
  }

  private applyBackpressure(
    partition: number,
    token: IAssignmentBackpressureToken
  ): void {
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

    this.pausePartition(partition, token);
  }

  private releaseBackpressure(): void {
    if (!this.acceptingRecords || this.totalInFlight >= this.maxInFlightTotal) {
      return;
    }

    for (const [pausedPartition, token] of Array.from(
      this.pausedPartitions.entries()
    )) {
      if (!this.isBackpressureTokenActive(pausedPartition, token)) {
        this.pausedPartitions.delete(pausedPartition);
        continue;
      }
      if (
        (this.inFlightByPartition.get(pausedPartition) ?? 0) <
        this.maxInFlightPerPartition
      ) {
        this.resumePartition(pausedPartition, token);
      }
    }
  }

  private pauseAllKnownPartitions(): void {
    for (const [partition, token] of this.knownPartitions) {
      this.pausePartition(partition, token);
    }
  }

  private pausePartition(
    partition: number,
    token: IAssignmentBackpressureToken
  ): void {
    if (!this.isBackpressureTokenActive(partition, token)) {
      return;
    }

    const current = this.pausedPartitions.get(partition);
    if (current && this.isSameBackpressureToken(current, token)) {
      return;
    }
    if (current) {
      this.pausedPartitions.delete(partition);
    }

    try {
      const consumer = this.consumerOrThrow as IAssignmentEpochConsumer;
      if (typeof consumer.__setRunnerPartitionBackpressure === 'function') {
        const accepted = consumer.__setRunnerPartitionBackpressure(
          this.options.topic,
          partition,
          token.assignmentEpoch,
          true
        );
        if (!accepted) {
          return;
        }
      } else {
        consumer.pause([{ topic: this.options.topic, partition }]);
      }
      this.pausedPartitions.set(partition, token);
    } catch {}
  }

  private resumePartition(
    partition: number,
    token: IAssignmentBackpressureToken
  ): void {
    const current = this.pausedPartitions.get(partition);
    if (!current || !this.isSameBackpressureToken(current, token)) {
      return;
    }
    if (!this.isBackpressureTokenActive(partition, token)) {
      this.pausedPartitions.delete(partition);
      return;
    }

    try {
      const consumer = this.consumerOrThrow as IAssignmentEpochConsumer;
      if (typeof consumer.__setRunnerPartitionBackpressure === 'function') {
        consumer.__setRunnerPartitionBackpressure(
          this.options.topic,
          partition,
          token.assignmentEpoch,
          false
        );
      } else {
        consumer.resume([{ topic: this.options.topic, partition }]);
      }
      this.pausedPartitions.delete(partition);
    } catch {}
  }

  private isSameBackpressureToken(
    left: IAssignmentBackpressureToken,
    right: IAssignmentBackpressureToken
  ): boolean {
    return (
      left.assignmentEpoch === right.assignmentEpoch &&
      left.runnerGeneration === right.runnerGeneration
    );
  }

  private isBackpressureTokenActive(
    partition: number,
    token: IAssignmentBackpressureToken
  ): boolean {
    const known = this.knownPartitions.get(partition);
    if (!known) {
      return false;
    }

    return (
      token.runnerGeneration === this.runnerGeneration &&
      this.isRunnerGenerationActive(token.runnerGeneration) &&
      this.isAssignmentEpochActive(partition, token.assignmentEpoch) &&
      this.isSameBackpressureToken(known, token)
    );
  }

  private clearPartitionInFlight(partition: number): void {
    this.inFlightByPartition.delete(partition);
    this.inFlightAssignmentTokens.delete(partition);
  }

  private invalidatePartitionState(partition: number): void {
    this.clearPartitionInFlight(partition);
    this.pausedPartitions.delete(partition);
    this.knownPartitions.delete(partition);
    this.partitionCommitStates.delete(partition);
    this.activeCoalesceKeys.delete(partition);
    for (const [entityKey, entry] of this.entityChains) {
      if (entry.partition === partition) {
        this.entityChains.delete(entityKey);
      }
    }
  }

  private isMessageAssignmentActive(
    message: KafkaRunnerMessage,
    runnerGeneration: number
  ): boolean {
    return (
      this.isRunnerGenerationActive(runnerGeneration) &&
      this.isAssignmentEpochActive(
        message.partition,
        message.consumerAssignmentEpoch
      )
    );
  }

  private isMessageExecutionActive(
    message: KafkaRunnerMessage,
    dispatchGeneration: number | undefined,
    runnerGeneration: number
  ): boolean {
    return (
      this.isMessageAssignmentActive(message, runnerGeneration) &&
      this.isDispatchGenerationActive(dispatchGeneration)
    );
  }

  private isRunnerGenerationActive(runnerGeneration: number): boolean {
    return (
      !this.closing &&
      this.running &&
      this.consumer !== null &&
      this.runnerGeneration === runnerGeneration
    );
  }

  private isDispatchGenerationActive(dispatchGeneration?: number): boolean {
    if (!this.options.requireDispatchAuthorization) {
      return true;
    }

    const state = getWorkerKafkaDispatchAuthorizationState();
    return (
      !this.closing &&
      this.running &&
      state.authorized &&
      typeof dispatchGeneration === 'number' &&
      state.generation === dispatchGeneration
    );
  }

  private isExtendedRetryActive(
    message: KafkaRunnerMessage,
    dispatchGeneration: number | undefined,
    runnerGeneration: number
  ): boolean {
    return (
      this.isRunnerGenerationActive(runnerGeneration) &&
      this.isMessageExecutionActive(
        message,
        dispatchGeneration,
        runnerGeneration
      )
    );
  }

  private entityFenceCancellation(
    runnerGeneration: number
  ): IKafkaConsumerEntityFenceCancellation {
    return {
      isCancelled: () => !this.isRunnerGenerationActive(runnerGeneration),
      onCancel: (listener) => {
        if (!this.isRunnerGenerationActive(runnerGeneration)) {
          listener();
          return () => undefined;
        }

        this.entityFenceCancellationListeners.add(listener);
        return () => {
          this.entityFenceCancellationListeners.delete(listener);
        };
      },
    };
  }

  private cancelEntityFenceWaiters(): void {
    const listeners = Array.from(this.entityFenceCancellationListeners);
    this.entityFenceCancellationListeners.clear();
    for (const listener of listeners) {
      listener();
    }
  }

  private subscribeAssignmentInvalidation(consumer: KafkaConsumer): void {
    this.unsubscribeAssignmentInvalidation();
    const assignmentConsumer = consumer as IAssignmentEpochConsumer;
    if (!assignmentConsumer.__subscribeAssignmentInvalidation) {
      return;
    }

    try {
      this.assignmentInvalidationUnsubscribe =
        assignmentConsumer.__subscribeAssignmentInvalidation((partitions) => {
          this.invalidateAssignmentState(partitions);
        });
    } catch (error) {
      this.options.logger?.error?.(
        {
          err: error,
          topic: this.options.topic,
          groupId: this.options.groupId,
        },
        'Kafka consumer runner could not subscribe to assignment invalidation'
      );
    }
  }

  private unsubscribeAssignmentInvalidation(): void {
    const unsubscribe = this.assignmentInvalidationUnsubscribe;
    this.assignmentInvalidationUnsubscribe = null;
    try {
      unsubscribe?.();
    } catch {}
  }

  private clearActiveCoalesceKeys(partitions?: number[]): void {
    if (!partitions) {
      this.activeCoalesceKeys.clear();
      return;
    }

    for (const partition of new Set(partitions)) {
      this.activeCoalesceKeys.delete(partition);
    }
  }

  private invalidateAssignmentState(partitions?: number[]): void {
    if (!partitions) {
      this.inFlightByPartition.clear();
      this.inFlightAssignmentTokens.clear();
      this.pausedPartitions.clear();
      this.knownPartitions.clear();
      this.partitionCommitStates.clear();
      this.entityChains.clear();
      this.clearActiveCoalesceKeys();
      return;
    }

    for (const partition of new Set(partitions)) {
      this.invalidatePartitionState(partition);
    }
    this.releaseBackpressure();
  }

  private isAssignmentEpochActive(
    partition: number,
    assignmentEpoch?: number
  ): boolean {
    if (typeof assignmentEpoch !== 'number') {
      return false;
    }

    const consumer = this.consumer as IAssignmentEpochConsumer | null;
    return Boolean(
      consumer?.__isAssignmentEpochActive?.(
        this.options.topic,
        partition,
        assignmentEpoch
      )
    );
  }

  private isLatestAssignmentCutoverCommitted(consumer: KafkaConsumer): boolean {
    if (this.startPosition !== 'latest-on-assignment') {
      return true;
    }

    const managed = consumer as IAssignmentEpochConsumer;
    return (
      typeof managed.__isLatestAssignmentCutoverCommitted === 'function' &&
      managed.__isLatestAssignmentCutoverCommitted() === true
    );
  }

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }
    return this.consumer;
  }

  private clearState(): void {
    this.acceptingRecords = false;
    this.totalInFlight = 0;
    this.inFlightByPartition.clear();
    this.inFlightAssignmentTokens.clear();
    this.pausedPartitions.clear();
    this.knownPartitions.clear();
    this.partitionCommitStates.clear();
    this.entityChains.clear();
    this.clearActiveCoalesceKeys();
    this.unsubscribeAssignmentInvalidation();
    this.tasks.clear();
  }
}
