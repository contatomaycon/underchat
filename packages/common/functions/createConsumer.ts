import type {
  Assignment,
  KafkaConsumer,
  LibrdKafkaError,
  Metadata,
} from 'node-rdkafka';
import type { KafkaClient } from '@core/plugins/kafkaStreams';
import { EventEmitter } from 'node:events';
import { logger } from '@core/plugins/telemetry/logger';
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
  private restartTimer: NodeJS.Timeout | null = null;
  private connectTimeout: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private restartCount = 0;
  private lastMessageAt = 0;
  private lastCommitAt = 0;
  private lastRestartAt = 0;
  private lastError = '';

  constructor(
    private readonly kafka: KafkaClient,
    private readonly groupId: string
  ) {
    super();
  }

  __health() {
    const assignments = this.getAssignments();

    return {
      group_id: this.groupId,
      topics: this.topics,
      connected: this.connected,
      consuming: this.consuming,
      assignments,
      assigned_topics: Array.from(
        new Set(assignments.map((assignment) => assignment.topic))
      ),
      restart_count: this.restartCount,
      last_message_at: this.lastMessageAt,
      last_commit_at: this.lastCommitAt,
      last_restart_at: this.lastRestartAt,
      last_error: this.lastError,
    };
  }

  async __ensureTopic(topic: string): Promise<void> {
    const config = resolveKafkaTopicConfig(topic);
    logger.info(
      {
        type: 'kafka.topic.ensure.start',
        group_id: this.groupId,
        topic,
        partitions: config.numPartitions,
        replication_factor: config.replicationFactor,
      },
      'Kafka consumer ensuring topic'
    );
    try {
      await ensureKafkaTopic(
        this.kafka,
        topic,
        config.numPartitions,
        config.replicationFactor
      );
    } catch (error) {
      logger.error(
        {
          type: 'kafka.topic.ensure.error',
          group_id: this.groupId,
          topic,
          partitions: config.numPartitions,
          replication_factor: config.replicationFactor,
          error: getErrorMessage(error),
        },
        'Kafka consumer topic ensure failed'
      );
      throw error;
    }

    logger.info(
      {
        type: 'kafka.topic.ensure.success',
        group_id: this.groupId,
        topic,
        partitions: config.numPartitions,
        replication_factor: config.replicationFactor,
      },
      'Kafka consumer topic ensured'
    );
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
      this.scheduleRestart('commit_without_connection', error);
      throw error;
    }

    try {
      const result = consumer.commitSync(offsets as never);
      this.lastCommitAt = Date.now();
      return result;
    } catch (error) {
      this.lastError = getErrorMessage(error);
      if (isStaleCommitGenerationError(error)) {
        logger.warn(
          {
            type: 'kafka.commit.stale_generation',
            group_id: this.groupId,
            topics: this.topics,
            error: this.lastError,
          },
          'Kafka consumer commit skipped after group generation changed'
        );
        throw error;
      }

      logger.error(
        {
          type: 'kafka.commit.error',
          group_id: this.groupId,
          topics: this.topics,
          error: this.lastError,
        },
        'Kafka consumer commit failed'
      );
      this.scheduleRestart('commit_error', error);
      throw error;
    }
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

    logger.info(
      {
        type: 'kafka.consumer.connect.start',
        group_id: this.groupId,
        topics: this.topics,
      },
      'Kafka consumer connect start'
    );

    this.connectTimeout = setTimeout(() => {
      if (this.closed || this.current !== consumer || this.connected) {
        return;
      }
      const error = new Error(
        `Kafka consumer connection timeout after ${CONNECT_TIMEOUT_MS}ms`
      );
      this.lastError = error.message;
      logger.warn(
        {
          type: 'kafka.consumer.connect.timeout',
          group_id: this.groupId,
          topics: this.topics,
          timeout_ms: CONNECT_TIMEOUT_MS,
          error: error.message,
        },
        'Kafka consumer connect timeout'
      );
      callback?.(error);
      this.scheduleRestart('connect_timeout', error);
    }, CONNECT_TIMEOUT_MS);

    try {
      consumer.connect({}, (err) => {
        if (!err) {
          return;
        }
        this.lastError = getErrorMessage(err);
        logger.error(
          {
            type: 'kafka.consumer.connect.error',
            group_id: this.groupId,
            topics: this.topics,
            error: this.lastError,
          },
          'Kafka consumer connect callback failed'
        );
        callback?.(err instanceof Error ? err : new Error(this.lastError));
        this.scheduleRestart('connect_error', err);
      });
    } catch (error) {
      this.lastError = getErrorMessage(error);
      logger.error(
        {
          type: 'kafka.consumer.connect.error',
          group_id: this.groupId,
          topics: this.topics,
          error: this.lastError,
        },
        'Kafka consumer connect threw'
      );
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
      this.lastMessageAt = Date.now();
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
      logger.warn(
        {
          type: 'kafka.consumer.metadata.refresh.error',
          group_id: this.groupId,
          topics: this.topics,
          timeout_ms: METADATA_REFRESH_TIMEOUT_MS,
          error: this.lastError,
        },
        'Kafka consumer topic metadata refresh failed'
      );
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
      if (!this.startConsuming(consumer, 'ready')) {
        callback?.(new Error(this.lastError));
        return;
      }
    }

    this.connected = true;
    this.connecting = false;
    this.lastError = '';

    logger.info(
      {
        type: 'kafka.consumer.connect.success',
        group_id: this.groupId,
        topics: this.topics,
        restart_count: this.restartCount,
        assignment_count: this.getAssignments().length,
      },
      'Kafka consumer connected'
    );

    callback?.(null);
    this.emit('ready');
    this.armWatchdog();
  }

  private startConsuming(consumer: KafkaConsumer, phase: string): boolean {
    try {
      consumer.consume();
      logger.info(
        {
          type: 'kafka.consumer.consume.start',
          group_id: this.groupId,
          topics: this.topics,
          phase,
        },
        'Kafka consumer consume loop started'
      );
      return true;
    } catch (error) {
      this.connecting = false;
      this.connected = false;
      this.lastError = getErrorMessage(error);
      logger.error(
        {
          type: 'kafka.consumer.consume.error',
          group_id: this.groupId,
          topics: this.topics,
          phase,
          error: this.lastError,
        },
        'Kafka consumer consume loop failed to start'
      );
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

    logger.info(
      {
        type: 'kafka.consumer.metadata.refresh.success',
        group_id: this.groupId,
        topics: this.topics,
        timeout_ms: METADATA_REFRESH_TIMEOUT_MS,
      },
      'Kafka consumer topic metadata refreshed'
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

    const recoverableTopicError = error
      ? isRecoverableKafkaTopicError(error)
      : false;
    this.restartCount += 1;
    this.lastRestartAt = Date.now();

    logger.warn(
      {
        type:
          reason === 'send_idle_watchdog'
            ? 'kafka.consumer.stalled'
            : 'kafka.consumer.restart',
        group_id: this.groupId,
        topics: this.topics,
        reason,
        restart_count: this.restartCount,
        recoverable_topic_error: recoverableTopicError,
        error: error ? getErrorMessage(error) : undefined,
      },
      'Kafka consumer restarting'
    );

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
    if (SEND_IDLE_RESTART_MS <= 0 || !this.topics.some(isWorkerSendTopic)) {
      return;
    }

    this.watchdogTimer = setTimeout(() => {
      if (this.closed || !this.connected) {
        return;
      }

      const lastActivity = Math.max(
        this.lastMessageAt,
        this.lastCommitAt,
        this.lastRestartAt
      );
      const idleMs = Date.now() - lastActivity;
      if (idleMs >= SEND_IDLE_RESTART_MS) {
        this.scheduleRestart('send_idle_watchdog');
        return;
      }

      this.armWatchdog();
    }, SEND_IDLE_RESTART_MS);
  }

  private clearTimers(): void {
    this.clearConnectTimeout();
    this.clearWatchdog();
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
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
