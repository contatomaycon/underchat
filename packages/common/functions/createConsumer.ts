import type {
  Assignment,
  KafkaConsumer,
  LibrdKafkaError,
  Metadata,
  TopicPartitionOffset,
  WatermarkOffsets,
} from 'node-rdkafka';
import type { KafkaClient } from '@core/plugins/kafkaStreams';
import { EventEmitter } from 'node:events';
import { ensureKafkaTopic } from './ensureKafkaTopic';
import {
  isRecoverableKafkaTopicError,
  resolveKafkaTopicConfig,
} from './kafkaTopicConfig';
import { getErrorMessage } from './toError';

type ConsumerCallback = (err?: Error | null) => void;

interface ITopicPartitionOffset {
  topic: string;
  partition: number;
  offset?: number;
}

interface ITopicPartition {
  topic: string;
  partition: number;
}

interface IPendingOffsetState {
  firstSeenAt: number;
}

interface IPartitionLagSnapshot {
  topic: string;
  partition: number;
  committed_offset: number | null;
  high_watermark: number | null;
  lag: number;
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }

  return Math.floor(raw);
}

const CONNECT_TIMEOUT_MS = 30000;
const METADATA_REFRESH_TIMEOUT_MS = readPositiveIntegerEnv(
  'KAFKA_CONSUMER_METADATA_REFRESH_TIMEOUT_MS',
  5000
);
const RESTART_BASE_MS = 1000;
const RESTART_MAX_MS = 30000;
const SEND_IDLE_RESTART_MS = Number(
  process.env.KAFKA_CONSUMER_SEND_IDLE_RESTART_MS ?? 0
);
const STALL_RESTART_SCOPE = (
  process.env.KAFKA_CONSUMER_STALL_RESTART_SCOPE ?? 'worker_scoped'
).toLowerCase();
const STALL_MS = readPositiveIntegerEnv('KAFKA_CONSUMER_STALL_MS', 300000);
const STALL_CHECK_MS = readPositiveIntegerEnv(
  'KAFKA_CONSUMER_STALL_CHECK_MS',
  30000
);
const MAX_STALL_RESTARTS_BEFORE_UNHEALTHY = readPositiveIntegerEnv(
  'KAFKA_CONSUMER_MAX_RESTARTS_BEFORE_UNHEALTHY',
  3
);
const WATERMARK_TIMEOUT_MS = readPositiveIntegerEnv(
  'KAFKA_CONSUMER_WATERMARK_TIMEOUT_MS',
  2000
);
const GLOBAL_WORKER_TOPIC_SEGMENTS = new Set(['config', 'warm', 'lifecycle']);

function isWorkerSendTopic(topic: string): boolean {
  const parts = topic.split('.');
  return (
    parts.length === 4 &&
    parts[0] === 'worker' &&
    parts[1].length > 0 &&
    parts[2] === 'send' &&
    parts[3] === 'message'
  );
}

function isWorkerScopedTopic(topic: string): boolean {
  const parts = topic.split('.');
  return (
    parts.length >= 4 &&
    parts[0] === 'worker' &&
    parts[1].length > 0 &&
    !GLOBAL_WORKER_TOPIC_SEGMENTS.has(parts[1])
  );
}

function shouldRestartStalledConsumerForTopics(topics: string[]): boolean {
  if (STALL_RESTART_SCOPE === 'all') {
    return true;
  }

  if (
    STALL_RESTART_SCOPE === 'none' ||
    STALL_RESTART_SCOPE === 'off' ||
    STALL_RESTART_SCOPE === 'disabled' ||
    STALL_RESTART_SCOPE === 'false'
  ) {
    return false;
  }

  return topics.some(isWorkerScopedTopic);
}

function kafkaErrorCode(error: unknown): number | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'number') {
    return code;
  }
  if (typeof code === 'string' && code.trim() !== '') {
    const parsed = Number(code);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isStaleCommitGenerationError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  const code = kafkaErrorCode(error);

  return (
    code === 22 ||
    message.includes('specified group generation id is not valid') ||
    message.includes('illegal generation') ||
    message.includes('rebalance in progress')
  );
}

class ManagedKafkaConsumer extends EventEmitter {
  readonly __managedKafkaConsumer = true;

  private current: KafkaConsumer | null = null;
  private topics: string[] = [];
  private consuming = false;
  private connected = false;
  private closed = false;
  private connecting = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimeout: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private restartCount = 0;
  private lastMessageAt = 0;
  private lastCommitAt = 0;
  private lastRestartAt = 0;
  private lastProgressAt = 0;
  private connectedAt = 0;
  private lastWatchdogAt = 0;
  private lastError = '';
  private unhealthy = false;
  private stallReason = '';
  private consecutiveStallRestarts = 0;
  private partitionLag = new Map<string, IPartitionLagSnapshot>();
  private pendingOffsets = new Map<string, Map<number, IPendingOffsetState>>();

  constructor(
    private readonly kafka: KafkaClient,
    private readonly groupId: string
  ) {
    super();
  }

  __health() {
    const assignments = this.getAssignments();
    const pending = this.getPendingHealth();
    const partitions = Array.from(this.partitionLag.values());
    const lag = partitions.reduce((total, item) => total + item.lag, 0);
    const highWatermarks = partitions
      .map((item) => item.high_watermark)
      .filter((value): value is number => typeof value === 'number');
    const committedOffsets = partitions
      .map((item) => item.committed_offset)
      .filter((value): value is number => typeof value === 'number');

    return {
      group_id: this.groupId,
      topics: this.topics,
      connected: this.connected,
      consuming: this.consuming,
      unhealthy: this.unhealthy,
      stall_reason: this.stallReason,
      assignments,
      assigned_topics: Array.from(
        new Set(assignments.map((assignment) => assignment.topic))
      ),
      partitions,
      lag,
      high_watermark:
        highWatermarks.length > 0 ? Math.max(...highWatermarks) : null,
      committed_offset:
        committedOffsets.length > 0 ? Math.min(...committedOffsets) : null,
      pending_count: pending.pendingCount,
      oldest_pending_age_ms: pending.oldestPendingAgeMs,
      restart_count: this.restartCount,
      consecutive_stall_restart_count: this.consecutiveStallRestarts,
      stall_restart_scope: STALL_RESTART_SCOPE,
      stall_restart_enabled: this.isStallRestartEnabled(),
      last_message_at: this.lastMessageAt,
      last_commit_at: this.lastCommitAt,
      last_progress_at: this.lastProgressAt,
      last_restart_at: this.lastRestartAt,
      last_watchdog_at: this.lastWatchdogAt,
      last_error: this.lastError,
    };
  }

  async __ensureTopic(topic: string): Promise<void> {
    const config = resolveKafkaTopicConfig(topic);
    try {
      await ensureKafkaTopic(
        this.kafka,
        topic,
        config.numPartitions,
        config.replicationFactor
      );
    } catch (error) {
      throw error;
    }
  }

  connect(optionsOrCallback: unknown = {}, callback?: ConsumerCallback): this {
    const resolvedCallback =
      typeof optionsOrCallback === 'function'
        ? (optionsOrCallback as ConsumerCallback)
        : callback;

    this.closed = false;
    void this.connectFresh(resolvedCallback);
    return this;
  }

  subscribe(topics: string[]): this {
    this.topics = Array.from(new Set(topics.filter(Boolean)));
    const consumer = this.current;
    if (consumer && this.connected) {
      consumer.subscribe(this.topics);
    }
    return this;
  }

  consume(): this {
    this.consuming = true;
    const consumer = this.current;
    if (consumer && this.connected) {
      consumer.consume();
    }
    return this;
  }

  commitSync(offsets: ITopicPartitionOffset[]): unknown {
    const consumer = this.current;
    if (!consumer || !this.connected) {
      const error = new Error('Kafka consumer is not connected');
      this.lastError = error.message;
      throw error;
    }

    try {
      const result = consumer.commitSync(offsets as never);
      this.recordCommit(offsets);
      return result;
    } catch (error) {
      this.lastError = getErrorMessage(error);
      if (isStaleCommitGenerationError(error)) {
        throw error;
      }
      this.scheduleRestart('commit_error', error);
      throw error;
    }
  }

  commit(offsets?: ITopicPartitionOffset | ITopicPartitionOffset[]): this {
    const consumer = this.current;
    if (!consumer || !this.connected) {
      return this;
    }

    try {
      const commit = (
        consumer as unknown as { commit: (offsets?: unknown) => unknown }
      ).commit.bind(consumer);
      if (typeof offsets === 'undefined') {
        commit();
      } else {
        commit(offsets);
      }
    } catch (error) {
      this.lastError = getErrorMessage(error);
    }

    return this;
  }

  pause(assignments: Array<{ topic: string; partition: number }>): unknown {
    return this.current?.pause(assignments as never);
  }

  resume(assignments: Array<{ topic: string; partition: number }>): unknown {
    return this.current?.resume(assignments as never);
  }

  unsubscribe(): this {
    this.topics = [];
    this.consuming = false;
    try {
      this.current?.unsubscribe();
    } catch {}
    return this;
  }

  disconnect(callback?: () => void): this {
    this.closed = true;
    this.clearTimers();
    this.clearOffsetTracking();
    const consumer = this.current;
    this.current = null;
    this.connected = false;
    this.connecting = false;

    if (!consumer) {
      callback?.();
      return this;
    }

    try {
      consumer.removeAllListeners();
      consumer.disconnect(() => {
        callback?.();
      });
    } catch {
      callback?.();
    }

    return this;
  }

  private async connectFresh(callback?: ConsumerCallback): Promise<void> {
    if (this.closed || this.connecting) {
      return;
    }

    this.connecting = true;
    this.connected = false;

    try {
      await this.ensureKnownTopics();
    } catch (error) {
      this.connecting = false;
      this.lastError = getErrorMessage(error);
      callback?.(error instanceof Error ? error : new Error(this.lastError));
      this.scheduleRestart('topic_ensure_error', error);
      return;
    }

    if (this.closed) {
      this.connecting = false;
      return;
    }

    const previous = this.current;
    if (previous) {
      try {
        previous.removeAllListeners();
        previous.disconnect(() => {});
      } catch {}
    }

    const consumer = this.kafka.createConsumer(this.groupId);
    this.current = consumer;
    this.attachCurrentConsumer(consumer, callback);

    this.connectTimeout = setTimeout(() => {
      if (this.closed || this.current !== consumer || this.connected) {
        return;
      }

      const error = new Error(
        `Kafka consumer connection timeout after ${CONNECT_TIMEOUT_MS}ms`
      );
      this.lastError = error.message;
      callback?.(error);
      this.scheduleRestart('connect_timeout', error);
    }, CONNECT_TIMEOUT_MS);

    try {
      consumer.connect({}, (err) => {
        if (!err) {
          return;
        }

        this.lastError = getErrorMessage(err);
        callback?.(err instanceof Error ? err : new Error(this.lastError));
        this.scheduleRestart('connect_error', err);
      });
    } catch (error) {
      this.lastError = getErrorMessage(error);
      callback?.(error instanceof Error ? error : new Error(this.lastError));
      this.scheduleRestart('connect_exception', error);
    }
  }

  private attachCurrentConsumer(
    consumer: KafkaConsumer,
    callback?: ConsumerCallback
  ): void {
    consumer.on('ready', () => {
      if (this.closed || this.current !== consumer) {
        return;
      }
      this.clearConnectTimeout();

      void this.finishReady(consumer, callback);
    });

    consumer.on('data', (message) => {
      this.trackReceivedMessage(message);
      this.emit('data', message);
    });

    consumer.on('event.error', (error) => {
      this.lastError = getErrorMessage(error);
      this.emit('event.error', error);
      this.scheduleRestart('event_error', error);
    });

    consumer.on('disconnected', () => {
      this.connected = false;
      this.connecting = false;
      this.clearConnectTimeout();
      this.emit('disconnected');
      this.scheduleRestart('disconnected');
    });
  }

  private async finishReady(
    consumer: KafkaConsumer,
    callback?: ConsumerCallback
  ): Promise<void> {
    try {
      await this.refreshTopicMetadata(consumer);
    } catch (error) {
      if (this.closed || this.current !== consumer) {
        return;
      }

      this.connecting = false;
      this.connected = false;
      this.lastError = getErrorMessage(error);
      callback?.(error instanceof Error ? error : new Error(this.lastError));
      this.scheduleRestart('metadata_refresh_error', error);
      return;
    }

    if (this.closed || this.current !== consumer) {
      return;
    }

    if (this.topics.length > 0) {
      consumer.subscribe(this.topics);
    }

    if (this.consuming) {
      if (!this.startConsuming(consumer)) {
        callback?.(new Error(this.lastError));
        return;
      }
    }

    this.connected = true;
    this.connecting = false;
    this.connectedAt = Date.now();
    this.lastProgressAt = Math.max(this.lastProgressAt, this.connectedAt);
    this.lastError = '';

    callback?.(null);
    this.emit('ready');
    this.armWatchdog();
  }

  private startConsuming(consumer: KafkaConsumer): boolean {
    try {
      consumer.consume();
      return true;
    } catch (error) {
      this.connecting = false;
      this.connected = false;
      this.lastError = getErrorMessage(error);
      this.scheduleRestart('consume_error', error);
      return false;
    }
  }

  private async refreshTopicMetadata(consumer: KafkaConsumer): Promise<void> {
    if (this.topics.length === 0) {
      return;
    }

    await Promise.all(
      this.topics.map(
        (topic) =>
          new Promise<void>((resolve, reject) => {
            try {
              consumer.getMetadata(
                { topic, timeout: METADATA_REFRESH_TIMEOUT_MS },
                (err: LibrdKafkaError, metadata: Metadata) => {
                  if (err) {
                    reject(err);
                    return;
                  }

                  const topicMetadata = metadata?.topics?.find(
                    (entry) => entry.name === topic
                  );
                  if (!topicMetadata || topicMetadata.partitions.length === 0) {
                    reject(
                      new Error(
                        `Kafka metadata missing partitions for topic ${topic}`
                      )
                    );
                    return;
                  }

                  resolve();
                }
              );
            } catch (error) {
              reject(error);
            }
          })
      )
    );
  }

  private getAssignments(): ITopicPartition[] {
    if (!this.current || !this.connected) {
      return [];
    }

    return this.readAssignments(this.current);
  }

  private readAssignments(consumer: KafkaConsumer): ITopicPartition[] {
    try {
      return (consumer.assignments() ?? []).map((assignment: Assignment) => ({
        topic: assignment.topic,
        partition: assignment.partition,
      }));
    } catch {
      return [];
    }
  }

  private async ensureKnownTopics(): Promise<void> {
    if (this.topics.length === 0) {
      return;
    }

    await Promise.all(this.topics.map((topic) => this.__ensureTopic(topic)));
  }

  private scheduleRestart(reason: string, error?: unknown): void {
    if (this.closed || this.restartTimer) {
      return;
    }

    if (error && !isRecoverableKafkaTopicError(error)) {
      this.lastError = getErrorMessage(error);
    }

    this.restartCount += 1;
    if (reason.includes('stall') || reason.includes('watchdog')) {
      this.consecutiveStallRestarts += 1;
      if (
        this.consecutiveStallRestarts >= MAX_STALL_RESTARTS_BEFORE_UNHEALTHY
      ) {
        this.unhealthy = true;
        this.stallReason = reason;
      }
    }
    this.lastRestartAt = Date.now();

    const delayMs = Math.min(
      RESTART_MAX_MS,
      RESTART_BASE_MS * 2 ** Math.min(this.restartCount - 1, 5)
    );

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.restart();
    }, delayMs);
  }

  private async restart(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.clearConnectTimeout();
    this.clearWatchdog();
    this.connected = false;
    this.connecting = false;
    this.clearOffsetTracking();

    const consumer = this.current;
    this.current = null;
    if (consumer) {
      try {
        consumer.removeAllListeners();
        await new Promise<void>((resolve) => consumer.disconnect(resolve));
      } catch {}
    }

    await this.connectFresh();
  }

  private armWatchdog(): void {
    this.clearWatchdog();
    if (STALL_MS <= 0 || STALL_CHECK_MS <= 0) {
      return;
    }

    this.watchdogTimer = setTimeout(() => {
      void this.runWatchdogCheck().finally(() => {
        if (!this.closed) {
          this.armWatchdog();
        }
      });
    }, STALL_CHECK_MS);
  }

  private async runWatchdogCheck(): Promise<void> {
    if (this.closed || !this.connected || !this.current) {
      return;
    }

    this.lastWatchdogAt = Date.now();
    const assignments = this.getAssignments();
    if (assignments.length === 0) {
      return;
    }

    await this.refreshLagSnapshot(this.current, assignments);

    const pending = this.getPendingHealth();
    const canRestartOnStall = this.isStallRestartEnabled();
    if (pending.oldestPendingAgeMs >= STALL_MS) {
      this.stallReason = 'pending_offset_stall';
      if (canRestartOnStall) {
        this.scheduleRestart('pending_offset_stall_watchdog');
      }
      return;
    }

    const lag = Array.from(this.partitionLag.values()).reduce(
      (total, item) => total + item.lag,
      0
    );
    const noCommitProgressMs = Date.now() - this.lastProgressAt;
    if (lag > 0 && noCommitProgressMs >= STALL_MS) {
      this.stallReason = 'lag_no_commit_progress';
      if (canRestartOnStall) {
        this.scheduleRestart('lag_no_commit_progress_watchdog');
      }
      return;
    }

    if (
      SEND_IDLE_RESTART_MS > 0 &&
      this.topics.some(isWorkerSendTopic) &&
      (lag > 0 || pending.pendingCount > 0)
    ) {
      const idleMs =
        Date.now() -
        Math.max(this.lastMessageAt, this.lastCommitAt, this.lastRestartAt);
      if (idleMs >= SEND_IDLE_RESTART_MS) {
        this.stallReason = 'send_idle_with_backlog';
        this.scheduleRestart('send_idle_watchdog');
      }
    }
  }

  private isStallRestartEnabled(): boolean {
    return shouldRestartStalledConsumerForTopics(this.topics);
  }

  private trackReceivedMessage(message: {
    topic?: string;
    partition?: number;
    offset?: number;
  }): void {
    const now = Date.now();
    this.lastMessageAt = now;

    const topic =
      typeof message.topic === 'string' && message.topic.length > 0
        ? message.topic
        : this.topics.length === 1
          ? this.topics[0]
          : '';
    if (
      !topic ||
      typeof message.partition !== 'number' ||
      typeof message.offset !== 'number'
    ) {
      return;
    }

    const key = this.partitionKey(topic, message.partition);
    const offsets = this.pendingOffsets.get(key) ?? new Map();
    offsets.set(message.offset, { firstSeenAt: now });
    this.pendingOffsets.set(key, offsets);
  }

  private recordCommit(offsets: ITopicPartitionOffset[]): void {
    const now = Date.now();
    this.lastCommitAt = now;
    this.lastProgressAt = now;
    this.unhealthy = false;
    this.stallReason = '';
    this.consecutiveStallRestarts = 0;

    for (const offset of offsets) {
      if (
        !offset.topic ||
        typeof offset.partition !== 'number' ||
        typeof offset.offset !== 'number'
      ) {
        continue;
      }

      const key = this.partitionKey(offset.topic, offset.partition);
      const pending = this.pendingOffsets.get(key);
      if (pending) {
        for (const pendingOffset of pending.keys()) {
          if (pendingOffset < offset.offset) {
            pending.delete(pendingOffset);
          }
        }
        if (pending.size === 0) {
          this.pendingOffsets.delete(key);
        }
      }

      const existing = this.partitionLag.get(key);
      this.partitionLag.set(key, {
        topic: offset.topic,
        partition: offset.partition,
        committed_offset: offset.offset,
        high_watermark: existing?.high_watermark ?? null,
        lag:
          typeof existing?.high_watermark === 'number'
            ? Math.max(0, existing.high_watermark - offset.offset)
            : 0,
      });
    }
  }

  private getPendingHealth(): {
    pendingCount: number;
    oldestPendingAgeMs: number;
  } {
    let pendingCount = 0;
    let oldestSeenAt = 0;

    for (const offsets of this.pendingOffsets.values()) {
      pendingCount += offsets.size;
      for (const pending of offsets.values()) {
        if (oldestSeenAt === 0 || pending.firstSeenAt < oldestSeenAt) {
          oldestSeenAt = pending.firstSeenAt;
        }
      }
    }

    return {
      pendingCount,
      oldestPendingAgeMs: oldestSeenAt > 0 ? Date.now() - oldestSeenAt : 0,
    };
  }

  private async refreshLagSnapshot(
    consumer: KafkaConsumer,
    assignments: ITopicPartition[]
  ): Promise<void> {
    let committedOffsets: TopicPartitionOffset[] = [];
    try {
      committedOffsets = await new Promise<TopicPartitionOffset[]>(
        (resolve, reject) => {
          consumer.committed(
            assignments as never,
            WATERMARK_TIMEOUT_MS,
            (err: LibrdKafkaError, offsets: TopicPartitionOffset[]) => {
              if (err) {
                reject(err);
                return;
              }
              resolve(offsets ?? []);
            }
          );
        }
      );
    } catch (error) {
      this.lastError = getErrorMessage(error);
    }

    await Promise.all(
      assignments.map(async (assignment) => {
        const key = this.partitionKey(assignment.topic, assignment.partition);
        const committed = committedOffsets.find(
          (item) =>
            item.topic === assignment.topic &&
            item.partition === assignment.partition
        );
        const committedOffset =
          typeof committed?.offset === 'number' && committed.offset >= 0
            ? committed.offset
            : null;
        let highWatermark: number | null = null;

        try {
          const offsets = await new Promise<WatermarkOffsets>(
            (resolve, reject) => {
              consumer.queryWatermarkOffsets(
                assignment.topic,
                assignment.partition,
                WATERMARK_TIMEOUT_MS,
                (err: LibrdKafkaError, watermark: WatermarkOffsets) => {
                  if (err) {
                    reject(err);
                    return;
                  }
                  resolve(watermark);
                }
              );
            }
          );
          highWatermark =
            typeof offsets?.highOffset === 'number' ? offsets.highOffset : null;
        } catch (error) {
          this.lastError = getErrorMessage(error);
        }

        const effectiveCommittedOffset = committedOffset ?? 0;
        this.partitionLag.set(key, {
          topic: assignment.topic,
          partition: assignment.partition,
          committed_offset: committedOffset,
          high_watermark: highWatermark,
          lag:
            typeof highWatermark === 'number'
              ? Math.max(0, highWatermark - effectiveCommittedOffset)
              : 0,
        });
      })
    );
  }

  private partitionKey(topic: string, partition: number): string {
    return `${topic}:${partition}`;
  }

  private clearTimers(): void {
    this.clearConnectTimeout();
    this.clearWatchdog();
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private clearOffsetTracking(): void {
    this.pendingOffsets.clear();
    this.partitionLag.clear();
  }

  private clearConnectTimeout(): void {
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }
}

export function createConsumer(
  kafka: KafkaClient,
  groupId: string
): KafkaConsumer {
  return new ManagedKafkaConsumer(kafka, groupId) as unknown as KafkaConsumer;
}
