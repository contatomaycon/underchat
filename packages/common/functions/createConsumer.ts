import type {
  Assignment,
  KafkaConsumer,
  LibrdKafkaError,
  Message,
  Metadata,
  TopicPartitionOffset,
  WatermarkOffsets,
} from 'node-rdkafka';
import type {
  KafkaClient,
  KafkaConsumerCreateOptions,
  KafkaConsumerStartPosition,
} from '@core/plugins/kafkaStreams';
import { randomInt } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { isRecoverableKafkaTopicError } from './kafkaTopicConfig';
import { getErrorMessage } from './toError';
import {
  isWorkerKafkaDispatchAuthorized,
  subscribeWorkerKafkaDispatchAuthorization,
} from './workerKafkaDispatchAuthorization';
import { workerLifecycleBudgets } from './workerLifecycleBudgets';
import { isWhatsappDurableCommittedTopic } from './kafkaConsumerStartPositionPolicy';
import { kafkaConsumerDisconnectBudget } from './kafkaConsumerDisconnectBudget';

type ConsumerCallback = (err?: Error | null) => void;
type AssignmentInvalidationListener = (partitions?: number[]) => void;

interface ITopicPartitionOffset {
  topic: string;
  partition: number;
  offset?: number;
  consumerAssignmentEpoch?: number;
}

interface ITopicPartition {
  topic: string;
  partition: number;
}

interface IPendingOffsetState {
  firstSeenAt: number;
  executionState: 'queued' | 'processing' | 'settled';
  lastProgressAt?: number;
  settledAt?: number;
  consumerAssignmentEpoch?: number;
}

interface IPartitionLagSnapshot {
  topic: string;
  partition: number;
  committed_offset: number | null;
  position_offset: number | null;
  low_watermark: number | null;
  high_watermark: number | null;
  effective_progress_offset: number | null;
  lag: number;
}

interface IPartitionLagProgressState {
  effectiveOffset: number | null;
  continuousSince: number;
}

interface ILagSnapshotRefreshResult {
  complete: boolean;
  errors: string[];
  refreshedKeys: Set<string>;
}

class KafkaCutoverAssignmentSupersededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KafkaCutoverAssignmentSupersededError';
  }
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }

  return Math.floor(raw);
}

const CONNECT_TIMEOUT_MS = 30000;
const MIN_METADATA_REFRESH_TIMEOUT_MS = 15000;
const METADATA_REFRESH_TIMEOUT_MS = Math.max(
  MIN_METADATA_REFRESH_TIMEOUT_MS,
  readPositiveIntegerEnv(
    'KAFKA_CONSUMER_METADATA_REFRESH_TIMEOUT_MS',
    MIN_METADATA_REFRESH_TIMEOUT_MS
  )
);
const METADATA_REFRESH_RETRY_MS = readPositiveIntegerEnv(
  'KAFKA_CONSUMER_METADATA_REFRESH_RETRY_MS',
  250
);
const RESTART_BASE_MS = 1000;
const RESTART_MAX_MS = 30000;
const RESTART_BACKOFF_STABLE_MS = readPositiveIntegerEnv(
  'KAFKA_CONSUMER_RESTART_BACKOFF_STABLE_MS',
  30000
);
const SEND_IDLE_RESTART_MS = Number(
  process.env.KAFKA_CONSUMER_SEND_IDLE_RESTART_MS ?? 0
);
const STALL_RESTART_SCOPE = (
  process.env.KAFKA_CONSUMER_STALL_RESTART_SCOPE ?? 'all'
).toLowerCase();
const STALL_MS = readPositiveIntegerEnv('KAFKA_CONSUMER_STALL_MS', 300000);
/*
 * A broker backlog with no locally dispatched handler is a different failure
 * mode from a legitimately long-running handler. Detect the idle-consumer
 * case quickly while retaining the wider generic stall budget for in-flight
 * work.
 */
const IDLE_LAG_STALL_MS = readPositiveIntegerEnv(
  'KAFKA_CONSUMER_IDLE_LAG_STALL_MS',
  90000
);
const STALL_CHECK_MS = readPositiveIntegerEnv(
  'KAFKA_CONSUMER_STALL_CHECK_MS',
  30000
);
const MAX_LAG_MEASUREMENT_FAILURES_BEFORE_RECOVERY = readPositiveIntegerEnv(
  'KAFKA_CONSUMER_MAX_LAG_MEASUREMENT_FAILURES_BEFORE_RECOVERY',
  3
);
const ASSIGNMENT_EPOCH_RANDOM_BUCKETS = 1024;

function initialAssignmentEpoch(): number {
  return (
    Date.now() * ASSIGNMENT_EPOCH_RANDOM_BUCKETS +
    randomInt(ASSIGNMENT_EPOCH_RANDOM_BUCKETS)
  );
}
const MAX_STALL_RESTARTS_BEFORE_UNHEALTHY = readPositiveIntegerEnv(
  'KAFKA_CONSUMER_MAX_RESTARTS_BEFORE_UNHEALTHY',
  3
);
const WATERMARK_TIMEOUT_MS = readPositiveIntegerEnv(
  'KAFKA_CONSUMER_WATERMARK_TIMEOUT_MS',
  2000
);
const LATEST_ASSIGNMENT_SEEK_TIMEOUT_MS = readPositiveIntegerEnv(
  'KAFKA_CONSUMER_LATEST_ASSIGNMENT_SEEK_TIMEOUT_MS',
  5000
);
const LATEST_ASSIGNMENT_COMMIT_TIMEOUT_MS = readPositiveIntegerEnv(
  'KAFKA_CONSUMER_LATEST_ASSIGNMENT_COMMIT_TIMEOUT_MS',
  5000
);
const LATEST_ASSIGNMENT_STALE_GRACE_MS = readPositiveIntegerEnv(
  'KAFKA_CONSUMER_LATEST_ASSIGNMENT_STALE_GRACE_MS',
  5000
);
const NATIVE_DISCONNECT_TIMEOUT_MS =
  kafkaConsumerDisconnectBudget.nativeTimeoutMs;
const MAX_PENDING_TOTAL = readPositiveIntegerEnv(
  'SERVICE_API_KAFKA_MAX_IN_FLIGHT_TOTAL',
  32
);
const MAX_PENDING_PER_PARTITION = readPositiveIntegerEnv(
  'SERVICE_API_KAFKA_MAX_IN_FLIGHT_PER_PARTITION',
  4
);
const MAX_PENDING_DISPATCH_AUTHORIZATION = readPositiveIntegerEnv(
  'KAFKA_CONSUMER_PREAUTH_BUFFER_MAX',
  64
);
const PROCESS_REPLACEMENT_HARD_EXIT_MS = 45_000;
const GLOBAL_WORKER_TOPIC_SEGMENTS = new Set(['config', 'warm', 'lifecycle']);
const DURABLE_GLOBAL_STALL_RESTART_SEGMENTS = new Set(['warm', 'lifecycle']);
let processReplacementExitScheduled = false;
let processReplacementHardExitTimer: NodeJS.Timeout | null = null;
let gracefulProcessShutdownInProgress = false;

export interface IKafkaConsumerProcessReplacementRequest {
  groupId: string;
  reason: string;
}

export function isKafkaConsumerProcessReplacementPending(): boolean {
  return (
    processReplacementExitScheduled ||
    process.exitCode === 130 ||
    process.exitCode === 143
  );
}

/**
 * Marks the process-wide application shutdown boundary. A native disconnect
 * callback that times out after this point is still reported, but must not
 * start a second SIGTERM/replacement cycle while Kubernetes is already
 * terminating this process.
 */
export function beginKafkaConsumerGracefulProcessShutdown(): void {
  gracefulProcessShutdownInProgress = true;
}

export function resetKafkaConsumerProcessReplacementForTests(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      'Kafka process replacement state may only be reset in tests'
    );
  }
  if (processReplacementHardExitTimer) {
    clearTimeout(processReplacementHardExitTimer);
    processReplacementHardExitTimer = null;
  }
  processReplacementExitScheduled = false;
  gracefulProcessShutdownInProgress = false;
}

function requestDefaultKafkaConsumerProcessReplacement(
  request: IKafkaConsumerProcessReplacementRequest
): void {
  /*
   * A native member whose disconnect callback never returns can keep
   * heartbeating without an application handler. There is no safe in-process
   * generation to create beside that ghost member, so process replacement is
   * the recovery boundary. Explicit commits make an abrupt exit safe: any
   * unfinished record remains eligible for redelivery.
   */
  if (
    process.env.NODE_ENV === 'test' ||
    isKafkaConsumerProcessReplacementPending()
  ) {
    return;
  }

  processReplacementExitScheduled = true;
  console.error('Kafka native consumer requires process replacement', {
    group_id: request.groupId,
    reason: request.reason,
    hard_exit_ms: PROCESS_REPLACEMENT_HARD_EXIT_MS,
  });
  /*
   * Let the application-level SIGTERM coordinator stop HTTP admission, drain
   * the other consumers and commit completed work. A native librdkafka thread
   * may itself prevent that drain from terminating, so retain a short,
   * process-local hard boundary that does not depend on Kubernetes probes.
   */
  try {
    process.kill(process.pid, 'SIGTERM');
  } catch (error) {
    console.error('Unable to start graceful Kafka process replacement', {
      group_id: request.groupId,
      reason: request.reason,
      error: getErrorMessage(error),
    });
    process.exit(1);
  }
  processReplacementHardExitTimer = setTimeout(() => {
    processReplacementHardExitTimer = null;
    process.exit(1);
  }, PROCESS_REPLACEMENT_HARD_EXIT_MS);
  /*
   * Do not keep a clean Service API drain alive for the whole deadline. A
   * wedged native librdkafka handle already keeps Node's event loop alive, so
   * this unref'ed boundary still fires in the failure case; when every handle
   * closes normally, Node exits immediately with the signal exit code.
   */
  processReplacementHardExitTimer.unref?.();
}

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

function isWorkerLifecycleTopic(topic: string): boolean {
  return topic === 'worker.lifecycle.request';
}

function isDefaultRestartableDurableTopic(topic: string): boolean {
  if (isWhatsappDurableCommittedTopic(topic)) {
    return true;
  }

  const parts = topic.split('.');
  /*
   * Warm-pool signals and lifecycle commands are global topics, but both are
   * committed, idempotent and durably fenced. Leaving a detected stall in
   * observation-only mode can block unrelated servers behind one partition
   * forever. Restarting the consumer generation preserves the uncommitted
   * offset and redelivers it through the same durable fences.
   */
  if (
    parts.length >= 3 &&
    parts[0] === 'worker' &&
    DURABLE_GLOBAL_STALL_RESTART_SEGMENTS.has(parts[1])
  ) {
    return true;
  }

  return (
    parts.length >= 4 &&
    parts[0] === 'worker' &&
    parts[1].length > 0 &&
    !GLOBAL_WORKER_TOPIC_SEGMENTS.has(parts[1])
  );
}

function shouldRestartStalledConsumerForTopics(topics: string[]): boolean {
  if (
    STALL_RESTART_SCOPE === 'none' ||
    STALL_RESTART_SCOPE === 'off' ||
    STALL_RESTART_SCOPE === 'disabled' ||
    STALL_RESTART_SCOPE === 'false'
  ) {
    return false;
  }

  if (
    STALL_RESTART_SCOPE === 'worker_scoped' ||
    STALL_RESTART_SCOPE === 'durable'
  ) {
    return topics.some(isDefaultRestartableDurableTopic);
  }

  /*
   * `all` is deliberately the default, including for unknown values. A typo or
   * a missing optional environment variable must never silently leave a
   * partition in observation-only mode. Recovery recreates the native member
   * without committing, so Kafka redelivers from the durable group offset.
   */
  return true;
}

function getEffectiveStallRestartScope(): 'all' | 'durable' | 'none' {
  if (
    STALL_RESTART_SCOPE === 'none' ||
    STALL_RESTART_SCOPE === 'off' ||
    STALL_RESTART_SCOPE === 'disabled' ||
    STALL_RESTART_SCOPE === 'false'
  ) {
    return 'none';
  }
  if (
    STALL_RESTART_SCOPE === 'worker_scoped' ||
    STALL_RESTART_SCOPE === 'durable'
  ) {
    return 'durable';
  }
  return 'all';
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
    code === 25 ||
    code === 27 ||
    code === -172 ||
    message.includes('specified group generation id is not valid') ||
    message.includes('illegal generation') ||
    message.includes('unknown member') ||
    message.includes('rebalance in progress')
  );
}

type NativeKafkaDisconnectResult = 'disconnected' | 'error' | 'timeout';

function disconnectFailureReason(result: NativeKafkaDisconnectResult): string {
  return result === 'timeout'
    ? `Kafka consumer disconnect timed out after ${NATIVE_DISCONNECT_TIMEOUT_MS}ms`
    : 'Kafka consumer disconnect threw before native shutdown was confirmed';
}

function disconnectNativeKafkaConsumer(
  consumer: KafkaConsumer
): Promise<NativeKafkaDisconnectResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: NativeKafkaDisconnectResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      const nativeIsConnected = (
        consumer as KafkaConsumer & { isConnected?: () => boolean }
      ).isConnected;

      if (typeof nativeIsConnected === 'function') {
        try {
          if (!nativeIsConnected.call(consumer)) {
            finish('disconnected');
            return;
          }
        } catch {
          // A failed native state probe cannot prove that the member left.
        }
      }

      finish('timeout');
    }, NATIVE_DISCONNECT_TIMEOUT_MS);
    timeout.unref?.();

    try {
      consumer.disconnect(() => finish('disconnected'));
    } catch {
      finish('error');
    }
  });
}

function waitForNativeKafkaCallback<T>(
  operation: string,
  timeoutMs: number,
  invoke: (finish: (error?: unknown, value?: T) => void) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, value?: T): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
        return;
      }
      resolve(value as T);
    };
    const timeout = setTimeout(
      () =>
        finish(
          new Error(`${operation} callback timed out after ${timeoutMs}ms`)
        ),
      timeoutMs
    );
    timeout.unref?.();

    try {
      invoke(finish);
    } catch (error) {
      finish(error);
    }
  });
}

function waitForTimer(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function hasTopicMetadataPartitions(
  metadata: Metadata,
  topic: string
): boolean {
  return Boolean(
    metadata?.topics?.find((entry) => entry.name === topic)?.partitions.length
  );
}

class ManagedKafkaConsumer extends EventEmitter {
  readonly __managedKafkaConsumer = true;
  readonly __managedKafkaConsumerStartPosition: KafkaConsumerStartPosition;

  private current: KafkaConsumer | null = null;
  private topics: string[] = [];
  private consuming = false;
  private connected = false;
  private closed = false;
  private connecting = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private restartPromise: Promise<void> | null = null;
  private connectTimeout: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private staleAssignmentRestartTimer: ReturnType<typeof setTimeout> | null =
    null;
  private restartCount = 0;
  private consecutiveRestartBackoffAttempt = 0;
  private lastMessageAt = 0;
  private lastCommitAt = 0;
  private lastRestartAt = 0;
  private lastProgressAt = 0;
  private lastHealthyConsumerEvidenceAt = 0;
  private connectedAt = 0;
  private lastWatchdogAt = 0;
  private lastError = '';
  private unhealthy = false;
  private stallReason = '';
  private consecutiveStallRestarts = 0;
  private lagMeasurementComplete = false;
  private consecutiveLagMeasurementFailures = 0;
  private lastLagMeasurementAt = 0;
  private podReplacementRequired = false;
  private podReplacementReason = '';
  private partitionLag = new Map<string, IPartitionLagSnapshot>();
  private partitionLagProgress = new Map<string, IPartitionLagProgressState>();
  private pendingOffsets = new Map<string, Map<number, IPendingOffsetState>>();
  private completedOffsets = new Map<string, Set<number>>();
  private pausedPartitions = new Map<string, ITopicPartition>();
  private runnerPausedPartitions = new Map<string, number>();
  // Assignment epochs are persisted by guarded redrives. Seed them with a
  // process-unique value so a restart cannot accidentally revive epoch "1"
  // from a previous consumer instance.
  private assignmentEpoch = initialAssignmentEpoch();
  private activeAssignmentEpochs = new Map<string, number>();
  private assignmentFenceFailures = new Set<string>();
  private assignmentStartOffsets = new Map<string, number>();
  private assignmentPreparationSequence = 0;
  private assignmentPreparations = new Map<string, number>();
  /*
   * librdkafka does not expose a reliable paused-partition snapshot through
   * node-rdkafka. A partition paused by the previous assignment can therefore
   * disagree with the local pause-owner maps after revoke clears their old
   * assignment epoch. Track only committed assignments that crossed a revoke;
   * resume() is idempotent for an already-running partition in our librdkafka
   * version, while the local pause-owner checks below keep real backpressure
   * closed.
   */
  private committedAssignmentResumeReconciliations = new Set<string>();
  private readyAnnouncedForCurrent = false;
  private assignmentObservedForCurrent = false;
  private pendingReadyCallback: ConsumerCallback | undefined;
  private dispatchAuthorized = true;
  private dispatchAuthorizationReplayRequired = false;
  private currentGenerationFenced = false;
  private pendingDispatchMessages: Message[] = [];
  private unsubscribeDispatchAuthorization: (() => void) | undefined;
  private readonly assignmentInvalidationListeners =
    new Set<AssignmentInvalidationListener>();

  constructor(
    private readonly kafka: KafkaClient,
    private readonly groupId: string,
    private readonly startPosition: KafkaConsumerStartPosition = 'committed',
    private readonly requireDispatchAuthorization = false,
    private readonly onProcessReplacementRequired: (
      request: IKafkaConsumerProcessReplacementRequest
    ) => void = requestDefaultKafkaConsumerProcessReplacement
  ) {
    super();
    this.__managedKafkaConsumerStartPosition = startPosition;
    if (requireDispatchAuthorization) {
      this.dispatchAuthorized = isWorkerKafkaDispatchAuthorized();
      this.unsubscribeDispatchAuthorization =
        subscribeWorkerKafkaDispatchAuthorization((authorized) => {
          this.applyDispatchAuthorization(authorized);
        });
    }
  }

  __health() {
    const assignments = this.getAssignments();
    this.pruneTrackingToAssignments(assignments);
    const assignmentsReady =
      this.startPosition === 'committed'
        ? this.connected
        : this.connected &&
          this.assignmentObservedForCurrent &&
          this.assignmentPreparations.size === 0 &&
          this.areAssignmentsPositioned(assignments);
    const pending = this.getPendingHealth();
    const partitions = Array.from(this.partitionLag.values());
    const lagMeasurementComplete =
      this.lagMeasurementComplete &&
      assignments.length > 0 &&
      partitions.length === assignments.length &&
      assignments.every((assignment) =>
        this.partitionLag.has(
          this.partitionKey(assignment.topic, assignment.partition)
        )
      );
    const measuredLag = partitions.reduce((total, item) => total + item.lag, 0);
    const lag = lagMeasurementComplete ? measuredLag : null;
    const highWatermarks = partitions
      .map((item) => item.high_watermark)
      .filter((value): value is number => typeof value === 'number');
    const lowWatermarks = partitions
      .map((item) => item.low_watermark)
      .filter((value): value is number => typeof value === 'number');
    const committedOffsets = partitions
      .map((item) => item.committed_offset)
      .filter((value): value is number => typeof value === 'number');
    const positionOffsets = partitions
      .map((item) => item.position_offset)
      .filter((value): value is number => typeof value === 'number');
    const effectiveProgressOffsets = partitions
      .map((item) => item.effective_progress_offset)
      .filter((value): value is number => typeof value === 'number');

    return {
      group_id: this.groupId,
      start_position: this.startPosition,
      assignment_epoch: this.assignmentEpoch,
      assignments_ready: assignmentsReady,
      assignment_positioning_count: this.assignmentPreparations.size,
      committed_assignment_resume_reconciliation_count:
        this.committedAssignmentResumeReconciliations.size,
      dispatch_authorized: this.dispatchAuthorized,
      dispatch_replay_required: this.dispatchAuthorizationReplayRequired,
      pending_dispatch_authorization_count: this.pendingDispatchMessages.length,
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
      low_watermark:
        lowWatermarks.length > 0 ? Math.min(...lowWatermarks) : null,
      committed_offset:
        committedOffsets.length > 0 ? Math.min(...committedOffsets) : null,
      position_offset:
        positionOffsets.length > 0 ? Math.min(...positionOffsets) : null,
      effective_progress_offset:
        effectiveProgressOffsets.length > 0
          ? Math.min(...effectiveProgressOffsets)
          : null,
      pending_count: pending.pendingCount,
      pending_queued_count: pending.queuedCount,
      pending_processing_count: pending.processingCount,
      pending_settled_count: pending.settledCount,
      oldest_pending_age_ms: pending.oldestPendingAgeMs,
      oldest_pending_no_progress_age_ms: pending.oldestPendingNoProgressAgeMs,
      pending_stall_budget_ms: this.getPendingStallBudgetMs(),
      restart_count: this.restartCount,
      consecutive_restart_backoff_attempt:
        this.consecutiveRestartBackoffAttempt,
      consecutive_stall_restart_count: this.consecutiveStallRestarts,
      stall_recovery_exhausted:
        this.isStallRestartEnabled() &&
        this.consecutiveStallRestarts >= MAX_STALL_RESTARTS_BEFORE_UNHEALTHY,
      lag_measurement_complete: lagMeasurementComplete,
      lag_measurement_failure_count: this.consecutiveLagMeasurementFailures,
      last_lag_measurement_at: this.lastLagMeasurementAt,
      pod_replacement_required: this.podReplacementRequired,
      pod_replacement_reason: this.podReplacementReason,
      stall_restart_scope: STALL_RESTART_SCOPE,
      stall_restart_effective_scope: getEffectiveStallRestartScope(),
      stall_restart_enabled: this.isStallRestartEnabled(),
      last_message_at: this.lastMessageAt,
      last_commit_at: this.lastCommitAt,
      last_progress_at: this.lastProgressAt,
      last_restart_at: this.lastRestartAt,
      last_watchdog_at: this.lastWatchdogAt,
      last_error: this.lastError,
    };
  }

  __isAssignmentEpochActive(
    topic: string,
    partition: number,
    epoch: number
  ): boolean {
    return (
      this.activeAssignmentEpochs.get(this.partitionKey(topic, partition)) ===
      epoch
    );
  }

  __reportProcessingProgress(
    topic: string,
    partition: number,
    offset: number,
    epoch: number
  ): boolean {
    const key = this.partitionKey(topic, partition);
    if (
      !this.connected ||
      this.currentGenerationFenced ||
      this.activeAssignmentEpochs.get(key) !== epoch
    ) {
      return false;
    }

    const pending = this.pendingOffsets.get(key)?.get(offset);
    if (
      !pending ||
      pending.consumerAssignmentEpoch !== epoch ||
      pending.executionState !== 'processing'
    ) {
      return false;
    }

    const now = Date.now();
    pending.lastProgressAt = now;
    this.lastProgressAt = Math.max(this.lastProgressAt, now);
    return true;
  }

  __markProcessingStarted(
    topic: string,
    partition: number,
    offset: number,
    epoch: number
  ): boolean {
    const key = this.partitionKey(topic, partition);
    if (
      !this.connected ||
      this.currentGenerationFenced ||
      this.activeAssignmentEpochs.get(key) !== epoch
    ) {
      return false;
    }

    const pending = this.pendingOffsets.get(key)?.get(offset);
    if (
      !pending ||
      pending.consumerAssignmentEpoch !== epoch ||
      pending.executionState !== 'queued'
    ) {
      return false;
    }

    pending.executionState = 'processing';
    pending.lastProgressAt = Date.now();
    return true;
  }

  __markProcessingSettled(
    topic: string,
    partition: number,
    offset: number,
    epoch: number
  ): boolean {
    const key = this.partitionKey(topic, partition);
    if (
      !this.connected ||
      this.currentGenerationFenced ||
      this.activeAssignmentEpochs.get(key) !== epoch
    ) {
      return false;
    }

    const pending = this.pendingOffsets.get(key)?.get(offset);
    if (!pending || pending.consumerAssignmentEpoch !== epoch) {
      return false;
    }

    if (pending.executionState !== 'settled') {
      pending.executionState = 'settled';
      pending.settledAt = Date.now();
    }
    return true;
  }

  __isLatestAssignmentCutoverCommitted(): boolean {
    if (this.startPosition !== 'latest-on-assignment') {
      return true;
    }

    const consumer = this.current;
    return Boolean(
      consumer &&
      this.connected &&
      this.assignmentObservedForCurrent &&
      this.assignmentPreparations.size === 0 &&
      this.areAssignmentsPositioned(this.readAssignments(consumer))
    );
  }

  __subscribeAssignmentInvalidation(
    listener: AssignmentInvalidationListener
  ): () => void {
    this.assignmentInvalidationListeners.add(listener);
    return () => {
      this.assignmentInvalidationListeners.delete(listener);
    };
  }

  __setRunnerPartitionBackpressure(
    topic: string,
    partition: number,
    assignmentEpoch: number,
    paused: boolean
  ): boolean {
    const key = this.partitionKey(topic, partition);
    if (this.activeAssignmentEpochs.get(key) !== assignmentEpoch) {
      if (!paused && this.runnerPausedPartitions.get(key) === assignmentEpoch) {
        this.runnerPausedPartitions.delete(key);
      }
      return false;
    }

    if (paused) {
      if (this.runnerPausedPartitions.get(key) === assignmentEpoch) {
        return true;
      }

      if (!this.pausedPartitions.has(key)) {
        this.current?.pause([{ topic, partition }] as never);
      }
      this.runnerPausedPartitions.set(key, assignmentEpoch);
      return true;
    }

    if (this.runnerPausedPartitions.get(key) !== assignmentEpoch) {
      return false;
    }

    if (
      this.pausedPartitions.has(key) ||
      (this.requireDispatchAuthorization && !this.dispatchAuthorized) ||
      this.assignmentPreparations.has(key)
    ) {
      this.runnerPausedPartitions.delete(key);
      return true;
    }

    if (!this.current || !this.connected) {
      this.runnerPausedPartitions.delete(key);
      return false;
    }

    this.current.resume([{ topic, partition }] as never);
    this.runnerPausedPartitions.delete(key);
    return true;
  }

  __restartGenerationWithoutCommit(reason: string): void {
    if (this.closed) {
      return;
    }

    this.currentGenerationFenced = true;
    const consumer = this.current;
    const assignments = this.getAssignments();
    let diagnostic = reason;
    if (consumer && assignments.length > 0) {
      try {
        consumer.pause(assignments as never);
      } catch (error) {
        diagnostic = `${reason}; pause failed: ${getErrorMessage(error)}`;
      }
    }

    // Fence all in-flight work before the delayed native reconnect. The next
    // generation starts from the last committed group offset, which makes the
    // rejected record eligible for redelivery without acknowledging it.
    this.connected = false;
    this.connecting = false;
    this.invalidateAssignments();
    this.clearOffsetTracking();
    this.lastError = diagnostic;
    this.scheduleRestart('redelivery_without_commit');
  }

  connect(optionsOrCallback: unknown = {}, callback?: ConsumerCallback): this {
    const resolvedCallback =
      typeof optionsOrCallback === 'function'
        ? (optionsOrCallback as ConsumerCallback)
        : callback;

    this.closed = false;
    if (
      this.podReplacementRequired ||
      isKafkaConsumerProcessReplacementPending()
    ) {
      const error = new Error(
        this.podReplacementReason ||
          'Kafka process replacement in progress; refusing a new consumer generation'
      );
      resolvedCallback?.(error);
      return this;
    }
    this.ensureDispatchAuthorizationSubscription();
    void this.connectFresh(resolvedCallback).catch((error: unknown) => {
      if (this.closed) {
        return;
      }

      this.connecting = false;
      this.connected = false;
      this.currentGenerationFenced = true;
      this.lastError = getErrorMessage(error);
      const normalizedError =
        error instanceof Error ? error : new Error(this.lastError);
      this.emit('event.error', normalizedError);
      resolvedCallback?.(normalizedError);
      this.scheduleRestart('consumer_factory_error', normalizedError);
    });
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
    const contiguousOffsets = this.resolveContiguousCommitOffsets(
      this.filterActiveCommitOffsets(offsets)
    );
    if (contiguousOffsets.length === 0) {
      return undefined;
    }

    return this.commitResolvedSync(contiguousOffsets);
  }

  commitResolvedSync(offsets: ITopicPartitionOffset[]): unknown {
    return this.commitOffsetsToKafka(offsets);
  }

  commit(offsets?: ITopicPartitionOffset | ITopicPartitionOffset[]): this {
    if (!this.current || !this.connected) {
      return this;
    }

    if (typeof offsets === 'undefined') {
      return this;
    }

    try {
      this.commitSync(Array.isArray(offsets) ? offsets : [offsets]);
    } catch (error) {
      this.lastError = getErrorMessage(error);
    }

    return this;
  }

  private commitOffsetsToKafka(offsets: ITopicPartitionOffset[]): unknown {
    const consumer = this.current;
    if (!consumer || !this.connected) {
      const error = new Error('Kafka consumer is not connected');
      this.lastError = error.message;
      throw error;
    }

    const activeOffsets = this.filterActiveCommitOffsets(offsets);
    if (activeOffsets.length === 0) {
      return undefined;
    }

    const nativeOffsets = activeOffsets.map(({ topic, partition, offset }) => ({
      topic,
      partition,
      offset,
    }));

    try {
      const result = consumer.commitSync(nativeOffsets as never);
      this.recordCommit(activeOffsets);
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

  pause(assignments: Array<{ topic: string; partition: number }>): unknown {
    return this.current?.pause(assignments as never);
  }

  resume(assignments: Array<{ topic: string; partition: number }>): unknown {
    if (this.requireDispatchAuthorization && !this.dispatchAuthorized) {
      return undefined;
    }
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
    this.currentGenerationFenced = true;
    this.dispatchAuthorizationReplayRequired = false;
    this.consecutiveRestartBackoffAttempt = 0;
    this.connectedAt = 0;
    this.lastHealthyConsumerEvidenceAt = 0;
    this.unsubscribeDispatchAuthorization?.();
    this.unsubscribeDispatchAuthorization = undefined;
    this.clearTimers();
    this.invalidateAssignments();
    this.clearOffsetTracking();
    const pendingReadyCallback = this.pendingReadyCallback;
    const consumer = this.current;
    this.current = null;
    this.connected = false;
    this.connecting = false;
    this.pendingReadyCallback = undefined;
    this.readyAnnouncedForCurrent = false;
    try {
      pendingReadyCallback?.(
        new Error('Kafka consumer disconnected before readiness was reached')
      );
    } catch (error) {
      console.error('Kafka disconnect readiness callback failed', {
        group_id: this.groupId,
        error: getErrorMessage(error),
      });
    }

    if (!consumer) {
      try {
        callback?.();
      } catch (error) {
        console.error('Kafka disconnect callback failed', {
          group_id: this.groupId,
          error: getErrorMessage(error),
        });
      }
      return this;
    }

    try {
      consumer.removeAllListeners();
    } catch {}
    void disconnectNativeKafkaConsumer(consumer).then((result) => {
      if (result !== 'disconnected') {
        const reason = disconnectFailureReason(result);
        this.lastError = reason;
        console.error('Kafka native consumer shutdown was not confirmed', {
          group_id: this.groupId,
          topics: this.topics,
          result,
          timeout_ms: NATIVE_DISCONNECT_TIMEOUT_MS,
          graceful_process_shutdown: gracefulProcessShutdownInProgress,
          reason,
        });
        if (!gracefulProcessShutdownInProgress) {
          this.markPodReplacementRequired(reason);
        }
      }
      try {
        callback?.();
      } catch (error) {
        console.error('Kafka disconnect callback failed', {
          group_id: this.groupId,
          error: getErrorMessage(error),
        });
      }
    });

    return this;
  }

  private async connectFresh(callback?: ConsumerCallback): Promise<void> {
    if (
      this.closed ||
      this.connecting ||
      this.podReplacementRequired ||
      isKafkaConsumerProcessReplacementPending()
    ) {
      return;
    }

    this.connecting = true;
    this.connected = false;
    this.readyAnnouncedForCurrent = false;
    this.assignmentObservedForCurrent = false;
    this.pendingReadyCallback = callback;

    if (this.closed) {
      this.connecting = false;
      return;
    }

    const previous = this.current;
    if (previous) {
      try {
        previous.removeAllListeners();
      } catch {}
      this.current = null;
      const result = await disconnectNativeKafkaConsumer(previous);
      if (result !== 'disconnected') {
        this.markPodReplacementRequired(disconnectFailureReason(result));
        return;
      }
    }

    if (
      this.closed ||
      this.podReplacementRequired ||
      isKafkaConsumerProcessReplacementPending()
    ) {
      this.connecting = false;
      return;
    }

    let consumer: KafkaConsumer;
    const consumerOptions: KafkaConsumerCreateOptions = {
      startPosition: this.startPosition,
    };
    consumerOptions.onPartitionsAssigned = (assignments) => {
      if (this.current !== consumer) return;
      if (this.startPosition === 'latest-on-assignment') {
        void this.prepareLatestAssignments(consumer, assignments);
        return;
      }
      this.activateCommittedAssignments(assignments);
    };
    consumerOptions.onPartitionsRevoked = (assignments) => {
      if (this.current !== consumer) return;
      this.revokeAssignments(assignments);
    };
    consumerOptions.onRebalanceError = (error) => {
      if (this.current !== consumer) return;
      this.handleRebalanceError(error);
    };

    consumer = this.kafka.createConsumer(this.groupId, consumerOptions);
    // Creating a replacement native member satisfies every replay request
    // observed before this point: its fetch cursor is initialized from the
    // durable group offset. A later authorization revoke will set the flag
    // again and require another replacement.
    this.dispatchAuthorizationReplayRequired = false;
    this.currentGenerationFenced = false;
    this.current = consumer;
    this.attachCurrentConsumer(consumer, callback);

    this.connectTimeout = setTimeout(() => {
      if (
        this.closed ||
        this.current !== consumer ||
        this.readyAnnouncedForCurrent
      ) {
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
      if (
        this.closed ||
        this.current !== consumer ||
        this.currentGenerationFenced
      ) {
        return;
      }
      if (this.startPosition === 'committed') {
        this.clearConnectTimeout();
      }

      void this.finishReady(consumer, callback);
    });

    consumer.on('data', (message) => {
      if (
        this.closed ||
        this.current !== consumer ||
        this.currentGenerationFenced
      ) {
        return;
      }
      if (this.requireDispatchAuthorization && !this.dispatchAuthorized) {
        this.bufferPendingDispatchMessage(message);
        return;
      }
      this.dispatchMessage(message);
    });

    consumer.on('event.error', (error) => {
      if (this.current !== consumer || this.currentGenerationFenced) {
        return;
      }
      this.lastError = getErrorMessage(error);
      this.emit('event.error', error);
      this.scheduleRestart('event_error', error);
    });

    consumer.on('disconnected', () => {
      if (this.current !== consumer) {
        return;
      }
      this.connected = false;
      this.connecting = false;
      this.invalidateAssignments();
      this.clearOffsetTracking();
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
      if (
        this.closed ||
        this.current !== consumer ||
        this.currentGenerationFenced
      ) {
        return;
      }

      this.connecting = false;
      this.connected = false;
      this.lastError = getErrorMessage(error);
      callback?.(error instanceof Error ? error : new Error(this.lastError));
      this.scheduleRestart('metadata_refresh_error', error);
      return;
    }

    if (
      this.closed ||
      this.current !== consumer ||
      this.currentGenerationFenced
    ) {
      return;
    }

    if (this.topics.length > 0) {
      consumer.subscribe(this.topics);
    }

    if (this.startPosition === 'committed') {
      // A real librdkafka member reports ownership through rebalance_cb. The
      // snapshot also covers clients whose assignment was already observable
      // when subscribe() returned, without changing or seeking their offsets.
      this.activateCommittedAssignments(this.readAssignments(consumer));
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
    // Readiness alone is not evidence that consumption is healthy. A durable
    // commit or a watchdog sample with no pending work/lag must occur before a
    // later incident may reset the consecutive restart backoff.
    this.lastHealthyConsumerEvidenceAt = 0;
    this.lastProgressAt = Math.max(this.lastProgressAt, this.connectedAt);
    this.lastError = '';

    if (
      this.startPosition === 'committed' ||
      this.areLatestAssignmentsReady(consumer)
    ) {
      this.announceReady();
    }
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
      this.topics.map((topic) =>
        this.waitForTopicMetadataPartitions(consumer, topic)
      )
    );
  }

  private async waitForTopicMetadataPartitions(
    consumer: KafkaConsumer,
    topic: string
  ): Promise<void> {
    const deadlineAt = Date.now() + METADATA_REFRESH_TIMEOUT_MS;

    for (;;) {
      const remainingMs = Math.max(1, deadlineAt - Date.now());
      const metadata = await waitForNativeKafkaCallback<Metadata>(
        `Kafka metadata refresh for ${topic}`,
        remainingMs,
        (finish) => {
          consumer.getMetadata(
            { topic, timeout: remainingMs },
            (err: LibrdKafkaError, metadata: Metadata) => {
              if (err) {
                finish(err);
                return;
              }

              finish(undefined, metadata);
            }
          );
        }
      );

      if (hasTopicMetadataPartitions(metadata, topic)) {
        return;
      }

      if (Date.now() >= deadlineAt) {
        throw new Error(`Kafka metadata missing partitions for topic ${topic}`);
      }

      await waitForTimer(
        Math.min(
          METADATA_REFRESH_RETRY_MS,
          Math.max(1, deadlineAt - Date.now())
        )
      );
    }
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

  private async prepareLatestAssignments(
    consumer: KafkaConsumer,
    assignments: Assignment[]
  ): Promise<void> {
    this.clearStaleAssignmentRestartTimer();
    this.assignmentObservedForCurrent = true;
    if (assignments.length === 0) {
      if (this.connected && this.areLatestAssignmentsReady(consumer)) {
        this.announceReady();
      }
      return;
    }

    // librdkafka can deliver another assignment callback while the previous
    // high-watermark/seek/commit barrier is still awaiting broker I/O. A
    // second preparation would supersede the global assignment epoch and
    // leave the first callback's partitions paused forever. Fail closed: stop
    // dispatch for every partition currently owned by this consumer, revoke
    // every preparation epoch and recreate the native member from scratch.
    if (this.assignmentPreparations.size > 0) {
      this.failOverlappingAssignmentPreparation(consumer, assignments);
      return;
    }

    const preparation = ++this.assignmentPreparationSequence;
    const assignmentEpoch = ++this.assignmentEpoch;
    const partitions = assignments.map(({ topic, partition }) => ({
      topic,
      partition,
    }));
    for (const assignment of partitions) {
      const key = this.partitionKey(assignment.topic, assignment.partition);
      this.assignmentPreparations.set(key, preparation);
      this.activeAssignmentEpochs.delete(key);
      this.clearPartitionTracking(key);
    }

    try {
      consumer.pause(partitions);
      const numericAssignments = await Promise.all(
        partitions.map(async (assignment) => ({
          ...assignment,
          offset: await this.queryHighWatermark(consumer, assignment),
        }))
      );
      if (
        !this.isAssignmentPreparationActive(
          consumer,
          partitions,
          preparation,
          assignmentEpoch
        )
      ) {
        return;
      }

      await Promise.all(
        numericAssignments.map((assignment) =>
          this.seekToNumericOffset(consumer, assignment)
        )
      );
      if (
        !this.isAssignmentPreparationActive(
          consumer,
          partitions,
          preparation,
          assignmentEpoch
        )
      ) {
        return;
      }

      const cutoverCommitted = await this.commitLatestAssignmentCutover(
        consumer,
        numericAssignments,
        preparation,
        assignmentEpoch
      );
      if (!cutoverCommitted) {
        return;
      }

      this.activateAssignments(numericAssignments, assignmentEpoch, false);
      if (!this.requireDispatchAuthorization || this.dispatchAuthorized) {
        consumer.resume(partitions);
      }
      for (const assignment of partitions) {
        this.assignmentPreparations.delete(
          this.partitionKey(assignment.topic, assignment.partition)
        );
      }
      if (this.connected && this.areLatestAssignmentsReady(consumer)) {
        this.announceReady();
      }
    } catch (error) {
      if (
        !this.isAssignmentPreparationActive(
          consumer,
          partitions,
          preparation,
          assignmentEpoch
        )
      ) {
        return;
      }
      if (
        isStaleCommitGenerationError(error) ||
        error instanceof KafkaCutoverAssignmentSupersededError
      ) {
        this.supersedeAssignmentPreparation(
          consumer,
          partitions,
          preparation,
          assignmentEpoch,
          error
        );
        return;
      }
      for (const assignment of partitions) {
        this.assignmentPreparations.delete(
          this.partitionKey(assignment.topic, assignment.partition)
        );
      }
      this.handleRebalanceError(error);
    }
  }

  private activateCommittedAssignments(assignments: Assignment[]): void {
    const partitions = assignments.map(({ topic, partition }) => ({
      topic,
      partition,
    }));
    // A duplicate assignment notification must not churn the epoch of work
    // already running. A genuine reassignment is preceded by revoke, which
    // removes the key and therefore receives a fresh epoch here.
    const partitionsToActivate = partitions.filter(
      (assignment) =>
        !this.activeAssignmentEpochs.has(
          this.partitionKey(assignment.topic, assignment.partition)
        )
    );
    if (partitionsToActivate.length === 0) {
      return;
    }

    this.invalidateLagMeasurementFreshness();
    const assignmentEpoch = ++this.assignmentEpoch;
    for (const assignment of partitionsToActivate) {
      const key = this.partitionKey(assignment.topic, assignment.partition);
      this.clearPartitionTracking(key);
      this.assignmentFenceFailures.delete(key);
      this.activeAssignmentEpochs.set(key, assignmentEpoch);
    }

    this.reconcileCommittedAssignmentDelivery(partitionsToActivate);
  }

  private reconcileCommittedAssignmentDelivery(
    assignments: ITopicPartition[]
  ): void {
    const consumer = this.current;
    if (
      !consumer ||
      this.currentGenerationFenced ||
      (this.requireDispatchAuthorization && !this.dispatchAuthorized)
    ) {
      return;
    }

    const resumable = assignments.filter((assignment) => {
      const key = this.partitionKey(assignment.topic, assignment.partition);
      return (
        this.committedAssignmentResumeReconciliations.has(key) &&
        this.activeAssignmentEpochs.has(key) &&
        !this.assignmentPreparations.has(key) &&
        !this.pausedPartitions.has(key) &&
        !this.runnerPausedPartitions.has(key)
      );
    });
    if (resumable.length === 0) {
      return;
    }

    try {
      consumer.resume(resumable as never);
      for (const assignment of resumable) {
        this.committedAssignmentResumeReconciliations.delete(
          this.partitionKey(assignment.topic, assignment.partition)
        );
      }
    } catch (error) {
      const reconciliationError = new Error(
        `Kafka committed assignment resume reconciliation failed: ${getErrorMessage(
          error
        )}`
      );
      this.handleRebalanceError(reconciliationError);
    }
  }

  private failOverlappingAssignmentPreparation(
    consumer: KafkaConsumer,
    incomingAssignments: Assignment[]
  ): void {
    const partitionsByKey = new Map<string, ITopicPartition>();
    for (const assignment of [
      ...this.readAssignments(consumer),
      ...incomingAssignments,
    ]) {
      const partition = {
        topic: assignment.topic,
        partition: assignment.partition,
      };
      partitionsByKey.set(
        this.partitionKey(partition.topic, partition.partition),
        partition
      );
    }

    const partitions = Array.from(partitionsByKey.values());
    try {
      if (partitions.length > 0) {
        consumer.pause(partitions);
      }
    } catch (error) {
      this.lastError = getErrorMessage(error);
    }

    this.handleRebalanceError(
      new Error(
        'Kafka overlapping latest-assignment preparations require a fail-closed consumer restart'
      )
    );
  }

  private queryHighWatermark(
    consumer: KafkaConsumer,
    assignment: ITopicPartition
  ): Promise<number> {
    return waitForNativeKafkaCallback<number>(
      `Kafka high watermark query for ${assignment.topic}[${assignment.partition}]`,
      WATERMARK_TIMEOUT_MS,
      (finish) => {
        consumer.queryWatermarkOffsets(
          assignment.topic,
          assignment.partition,
          WATERMARK_TIMEOUT_MS,
          (error, offsets) => {
            if (error) {
              finish(error);
              return;
            }
            const highOffset = Number(offsets?.highOffset);
            if (!Number.isSafeInteger(highOffset) || highOffset < 0) {
              finish(
                new Error(
                  `Kafka high watermark unavailable for ${assignment.topic}[${assignment.partition}]`
                )
              );
              return;
            }
            finish(undefined, highOffset);
          }
        );
      }
    );
  }

  private seekToNumericOffset(
    consumer: KafkaConsumer,
    assignment: ITopicPartition & { offset: number }
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        consumer.seek(
          assignment,
          LATEST_ASSIGNMENT_SEEK_TIMEOUT_MS,
          (error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  private isAssignmentPreparationActive(
    consumer: KafkaConsumer,
    assignments: ITopicPartition[],
    preparation: number,
    assignmentEpoch: number
  ): boolean {
    return (
      !this.closed &&
      this.current === consumer &&
      this.assignmentEpoch === assignmentEpoch &&
      assignments.every(
        (assignment) =>
          this.assignmentPreparations.get(
            this.partitionKey(assignment.topic, assignment.partition)
          ) === preparation
      )
    );
  }

  private async commitLatestAssignmentCutover(
    consumer: KafkaConsumer,
    assignments: Array<ITopicPartition & { offset: number }>,
    preparation: number,
    assignmentEpoch: number
  ): Promise<boolean> {
    const partitions = assignments.map(({ topic, partition }) => ({
      topic,
      partition,
    }));
    if (
      !this.isAssignmentPreparationActive(
        consumer,
        partitions,
        preparation,
        assignmentEpoch
      )
    ) {
      return false;
    }

    consumer.commitSync(assignments);
    if (
      !this.isAssignmentPreparationActive(
        consumer,
        partitions,
        preparation,
        assignmentEpoch
      )
    ) {
      return false;
    }

    const committedOffsets = await this.readCommittedOffsets(
      consumer,
      partitions
    );
    if (
      !this.isAssignmentPreparationActive(
        consumer,
        partitions,
        preparation,
        assignmentEpoch
      )
    ) {
      return false;
    }

    const committedByPartition = new Map(
      committedOffsets.map((offset) => [
        this.partitionKey(offset.topic, offset.partition),
        offset.offset,
      ])
    );
    for (const assignment of assignments) {
      const committedOffset = committedByPartition.get(
        this.partitionKey(assignment.topic, assignment.partition)
      );
      if (
        typeof committedOffset === 'number' &&
        committedOffset > assignment.offset
      ) {
        throw new KafkaCutoverAssignmentSupersededError(
          `Kafka cutover offset was superseded for ${assignment.topic}[${assignment.partition}]: expected ${assignment.offset}, got ${committedOffset}`
        );
      }
      if (committedOffset !== assignment.offset) {
        throw new Error(
          `Kafka cutover offset confirmation failed for ${assignment.topic}[${assignment.partition}]: expected ${assignment.offset}, got ${String(
            committedOffset
          )}`
        );
      }
    }

    const now = Date.now();
    this.lastCommitAt = now;
    this.lastProgressAt = Math.max(this.lastProgressAt, now);
    this.lastHealthyConsumerEvidenceAt = now;
    this.lastError = '';
    return true;
  }

  private supersedeAssignmentPreparation(
    consumer: KafkaConsumer,
    assignments: ITopicPartition[],
    preparation: number,
    assignmentEpoch: number,
    error: unknown
  ): void {
    if (
      !this.isAssignmentPreparationActive(
        consumer,
        assignments,
        preparation,
        assignmentEpoch
      )
    ) {
      return;
    }

    for (const assignment of assignments) {
      const key = this.partitionKey(assignment.topic, assignment.partition);
      if (this.assignmentPreparations.get(key) === preparation) {
        this.assignmentPreparations.delete(key);
      }
      this.activeAssignmentEpochs.delete(key);
      this.clearPartitionTracking(key);
    }

    this.assignmentEpoch += 1;
    const supersededEpoch = this.assignmentEpoch;
    this.lastError = getErrorMessage(error);
    this.staleAssignmentRestartTimer = setTimeout(() => {
      this.staleAssignmentRestartTimer = null;
      if (
        this.closed ||
        this.current !== consumer ||
        this.assignmentEpoch !== supersededEpoch
      ) {
        return;
      }

      this.handleRebalanceError(
        new Error(
          `Kafka cutover assignment did not advance after stale generation: ${this.lastError}`
        )
      );
    }, LATEST_ASSIGNMENT_STALE_GRACE_MS);
    this.staleAssignmentRestartTimer.unref?.();
  }

  private readCommittedOffsets(
    consumer: KafkaConsumer,
    assignments: ITopicPartition[]
  ): Promise<TopicPartitionOffset[]> {
    return waitForNativeKafkaCallback<TopicPartitionOffset[]>(
      'Kafka cutover offset confirmation',
      LATEST_ASSIGNMENT_COMMIT_TIMEOUT_MS,
      (finish) => {
        consumer.committed(
          assignments,
          LATEST_ASSIGNMENT_COMMIT_TIMEOUT_MS,
          (error, offsets) => finish(error, offsets ?? [])
        );
      }
    );
  }

  private activateAssignments(
    assignments: Array<ITopicPartition & { offset: number }>,
    epoch: number,
    announceReady = true
  ): void {
    if (assignments.length > 0) {
      this.invalidateLagMeasurementFreshness();
    }
    for (const assignment of assignments) {
      const key = this.partitionKey(assignment.topic, assignment.partition);
      this.clearPartitionTracking(key);
      this.activeAssignmentEpochs.set(key, epoch);
      this.partitionLag.set(key, {
        topic: assignment.topic,
        partition: assignment.partition,
        committed_offset:
          Number.isSafeInteger(assignment.offset) && assignment.offset >= 0
            ? assignment.offset
            : null,
        position_offset:
          Number.isSafeInteger(assignment.offset) && assignment.offset >= 0
            ? assignment.offset
            : null,
        low_watermark:
          Number.isSafeInteger(assignment.offset) && assignment.offset >= 0
            ? assignment.offset
            : null,
        high_watermark:
          Number.isSafeInteger(assignment.offset) && assignment.offset >= 0
            ? assignment.offset
            : null,
        effective_progress_offset:
          Number.isSafeInteger(assignment.offset) && assignment.offset >= 0
            ? assignment.offset
            : null,
        lag: 0,
      });
      if (Number.isSafeInteger(assignment.offset) && assignment.offset >= 0) {
        this.assignmentStartOffsets.set(key, assignment.offset);
      }
    }

    if (announceReady && assignments.length > 0 && this.connected) {
      this.announceReady();
    }
  }

  private announceReady(): void {
    if (this.readyAnnouncedForCurrent) {
      return;
    }

    this.readyAnnouncedForCurrent = true;
    this.clearConnectTimeout();
    const callback = this.pendingReadyCallback;
    this.pendingReadyCallback = undefined;
    callback?.(null);
    this.emit('ready');
  }

  private revokeAssignments(assignments: Assignment[]): void {
    this.clearStaleAssignmentRestartTimer();
    if (assignments.length > 0) {
      this.invalidateLagMeasurementFreshness();
    }
    this.assignmentEpoch += 1;
    for (const assignment of assignments) {
      const key = this.partitionKey(assignment.topic, assignment.partition);
      if (this.startPosition === 'committed') {
        this.committedAssignmentResumeReconciliations.add(key);
      }
      this.assignmentPreparations.delete(key);
      this.activeAssignmentEpochs.delete(key);
      this.clearPartitionTracking(key);
    }
    this.notifyAssignmentInvalidation(
      assignments.map((assignment) => assignment.partition)
    );

    if (this.assignmentPreparations.size > 0) {
      this.handleRebalanceError(
        new Error(
          'Kafka partial revoke interrupted latest assignment preparation'
        )
      );
    }
  }

  private invalidateAssignments(): void {
    this.clearStaleAssignmentRestartTimer();
    this.invalidateLagMeasurementFreshness();
    this.assignmentEpoch += 1;
    this.assignmentObservedForCurrent = false;
    this.assignmentPreparations.clear();
    this.activeAssignmentEpochs.clear();
    this.assignmentFenceFailures.clear();
    this.assignmentStartOffsets.clear();
    this.committedAssignmentResumeReconciliations.clear();
    this.pendingDispatchMessages = [];
    this.runnerPausedPartitions.clear();
    this.notifyAssignmentInvalidation();
  }

  private notifyAssignmentInvalidation(partitions?: number[]): void {
    for (const listener of this.assignmentInvalidationListeners) {
      try {
        listener(partitions);
      } catch {}
    }
  }

  private handleRebalanceError(error: unknown): void {
    this.invalidateAssignments();
    this.clearOffsetTracking();
    this.lastError = getErrorMessage(error);
    this.emit(
      'event.error',
      error instanceof Error ? error : new Error(this.lastError)
    );
    this.scheduleRestart('rebalance_error', error);
  }

  private areLatestAssignmentsReady(consumer: KafkaConsumer): boolean {
    return (
      this.assignmentObservedForCurrent &&
      this.assignmentPreparations.size === 0 &&
      this.areAssignmentsPositioned(this.readAssignments(consumer))
    );
  }

  private areAssignmentsPositioned(assignments: ITopicPartition[]): boolean {
    return assignments.every((assignment) =>
      this.activeAssignmentEpochs.has(
        this.partitionKey(assignment.topic, assignment.partition)
      )
    );
  }

  private scheduleRestart(reason: string, error?: unknown): void {
    if (this.closed || this.restartTimer || this.podReplacementRequired) {
      return;
    }

    if (error && !isRecoverableKafkaTopicError(error)) {
      this.lastError = getErrorMessage(error);
    }

    const now = Date.now();
    if (this.hasStableHealthyConsumerEvidence(now)) {
      this.consecutiveRestartBackoffAttempt = 0;
    }
    this.restartCount += 1;
    this.consecutiveRestartBackoffAttempt += 1;
    if (reason.includes('stall') || reason.includes('watchdog')) {
      this.consecutiveStallRestarts += 1;
      if (
        this.consecutiveStallRestarts >= MAX_STALL_RESTARTS_BEFORE_UNHEALTHY
      ) {
        this.unhealthy = true;
        this.stallReason = reason;
      }
    }
    this.lastRestartAt = now;

    const delayMs = Math.min(
      RESTART_MAX_MS,
      RESTART_BASE_MS *
        2 ** Math.min(this.consecutiveRestartBackoffAttempt - 1, 5)
    );

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.restart();
    }, delayMs);
  }

  private restart(): Promise<void> {
    if (this.restartPromise) {
      return this.restartPromise;
    }

    const restartPromise = this.restartInternal()
      .catch((error) => {
        this.lastError = getErrorMessage(error);
        this.scheduleRestart('restart_error', error);
      })
      .finally(() => {
        if (this.restartPromise === restartPromise) {
          this.restartPromise = null;
        }
      });
    this.restartPromise = restartPromise;
    return restartPromise;
  }

  private async restartInternal(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.clearConnectTimeout();
    this.clearWatchdog();
    this.currentGenerationFenced = true;
    this.connected = false;
    this.connecting = false;
    this.connectedAt = 0;
    this.lastHealthyConsumerEvidenceAt = 0;
    this.invalidateAssignments();
    this.clearOffsetTracking();

    const consumer = this.current;
    this.current = null;
    if (consumer) {
      try {
        consumer.removeAllListeners();
      } catch {}
      const result = await disconnectNativeKafkaConsumer(consumer);
      if (result !== 'disconnected') {
        this.markPodReplacementRequired(disconnectFailureReason(result));
        return;
      }
    }

    if (this.podReplacementRequired) {
      return;
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

    if (this.requireDispatchAuthorization && !this.dispatchAuthorized) {
      this.lastProgressAt = Date.now();
      this.partitionLagProgress.clear();
      this.clearStallHealth(true);
      return;
    }

    this.lastWatchdogAt = Date.now();
    const assignments = this.getAssignments();
    this.pruneTrackingToAssignments(assignments);
    if (assignments.length === 0) {
      /*
       * A temporarily empty assignment is not global proof of recovery. In
       * particular, resetting here would make repeated stall restarts
       * impossible to exhaust while the replacement member is rebalancing.
       */
      this.clearStallHealth(false);
      return;
    }

    const lagRefresh = await this.refreshLagSnapshot(this.current, assignments);
    if (lagRefresh.complete) {
      this.recordLagMeasurementSuccess();
    } else {
      this.recordLagMeasurementFailure(lagRefresh.errors);
    }

    const pending = this.getPendingHealth();
    const canRestartOnStall = this.isStallRestartEnabled();
    const pendingStallBudgetMs = this.getPendingStallBudgetMs();
    const activePendingCount = pending.processingCount + pending.settledCount;
    if (
      activePendingCount > 0 &&
      pending.oldestPendingNoProgressAgeMs >= pendingStallBudgetMs
    ) {
      this.stallReason = 'pending_offset_stall';
      this.unhealthy = true;
      if (canRestartOnStall) {
        this.scheduleRestart('pending_offset_stall_watchdog');
      }
      return;
    }

    if (!lagRefresh.complete) {
      if (
        pending.pendingCount === 0 &&
        this.consecutiveLagMeasurementFailures >=
          MAX_LAG_MEASUREMENT_FAILURES_BEFORE_RECOVERY
      ) {
        this.unhealthy = true;
        this.stallReason = 'lag_measurement_unavailable';
        if (canRestartOnStall) {
          this.scheduleRestart('lag_measurement_unavailable_watchdog');
        }
      }
      return;
    }

    const lag = Array.from(this.partitionLag.values()).reduce(
      (total, item) => total + item.lag,
      0
    );
    const oldestLagNoProgressAgeMs = this.getOldestLagNoProgressAgeMs();
    const lagNoProgressStallMs =
      activePendingCount === 0 ? IDLE_LAG_STALL_MS : pendingStallBudgetMs;
    if (lag > 0 && oldestLagNoProgressAgeMs >= lagNoProgressStallMs) {
      this.stallReason = 'lag_no_commit_progress';
      this.unhealthy = true;
      if (canRestartOnStall) {
        this.scheduleRestart('lag_no_commit_progress_watchdog');
      }
      return;
    }

    const hasFreshGlobalHealthyEvidence =
      pending.pendingCount === 0 &&
      lag === 0 &&
      assignments.every((assignment) =>
        lagRefresh.refreshedKeys.has(
          this.partitionKey(assignment.topic, assignment.partition)
        )
      );
    this.clearStallHealth(hasFreshGlobalHealthyEvidence);
    if (hasFreshGlobalHealthyEvidence) {
      this.lastHealthyConsumerEvidenceAt = Date.now();
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

  private getPendingStallBudgetMs(): number {
    return this.topics.some(isWorkerLifecycleTopic)
      ? workerLifecycleBudgets.pendingWatchdogMs
      : STALL_MS;
  }

  private trackReceivedMessage<
    TMessage extends {
      topic?: string;
      partition?: number;
      offset?: number;
    },
  >(
    message: TMessage
  ): (TMessage & { consumerAssignmentEpoch?: number }) | null {
    const topic =
      typeof message.topic === 'string' && message.topic.length > 0
        ? message.topic
        : this.topics.length === 1
          ? this.topics[0]
          : '';
    const hasOffsetIdentity =
      Boolean(topic) &&
      typeof message.partition === 'number' &&
      typeof message.offset === 'number';

    if (!hasOffsetIdentity) {
      return null;
    }

    const consumerAssignmentEpoch = this.activeAssignmentEpochs.get(
      this.partitionKey(topic, message.partition as number)
    );
    if (typeof consumerAssignmentEpoch !== 'number') {
      return null;
    }

    const now = Date.now();
    this.lastMessageAt = now;

    const partition = message.partition as number;
    const offset = message.offset as number;
    const key = this.partitionKey(topic, partition);
    const offsets = this.pendingOffsets.get(key) ?? new Map();
    if (!offsets.has(offset)) {
      offsets.set(offset, {
        firstSeenAt: now,
        executionState: 'queued',
        consumerAssignmentEpoch,
      });
    }
    this.pendingOffsets.set(key, offsets);
    if (this.startPosition === 'latest-on-assignment') {
      const existing = this.partitionLag.get(key);
      const positionOffset = Math.max(
        existing?.position_offset ?? 0,
        offset + 1
      );
      this.partitionLag.set(key, {
        topic,
        partition,
        committed_offset: existing?.committed_offset ?? null,
        position_offset: positionOffset,
        low_watermark: existing?.low_watermark ?? null,
        high_watermark: existing?.high_watermark ?? null,
        effective_progress_offset:
          typeof existing?.low_watermark === 'number'
            ? Math.max(positionOffset, existing.low_watermark)
            : positionOffset,
        lag:
          typeof existing?.high_watermark === 'number'
            ? Math.max(
                0,
                existing.high_watermark -
                  (typeof existing.low_watermark === 'number'
                    ? Math.max(positionOffset, existing.low_watermark)
                    : positionOffset)
              )
            : 0,
      });
      this.partitionLagProgress.delete(key);
    }
    this.applyPendingBackpressure(topic, partition);

    return { ...message, consumerAssignmentEpoch };
  }

  private dispatchMessage(message: Message): void {
    if (!this.isMessageAtOrAfterAssignmentStart(message)) {
      return;
    }

    const trackedMessage = this.trackReceivedMessage(message);
    if (trackedMessage) {
      this.emit('data', trackedMessage);
    }
  }

  private bufferPendingDispatchMessage(message: Message): void {
    if (!this.isMessageAtOrAfterAssignmentStart(message)) {
      return;
    }

    if (
      this.pendingDispatchMessages.length >= MAX_PENDING_DISPATCH_AUTHORIZATION
    ) {
      this.pendingDispatchMessages = [];
      const error = new Error(
        'Kafka pre-authorization message buffer overflowed'
      );
      this.lastError = error.message;
      this.scheduleRestart('dispatch_authorization_buffer_overflow', error);
      return;
    }

    this.pendingDispatchMessages.push(message);
  }

  private isMessageAtOrAfterAssignmentStart(message: Message): boolean {
    if (
      typeof message.topic !== 'string' ||
      typeof message.partition !== 'number' ||
      typeof message.offset !== 'number'
    ) {
      return false;
    }

    const key = this.partitionKey(message.topic, message.partition);
    if (!this.activeAssignmentEpochs.has(key)) {
      if (this.startPosition === 'committed') {
        this.handleMissingCommittedAssignmentEpoch(message);
      }
      return false;
    }
    if (this.startPosition !== 'latest-on-assignment') {
      return true;
    }

    const startOffset = this.assignmentStartOffsets.get(key);
    return typeof startOffset === 'number' && message.offset >= startOffset;
  }

  private handleMissingCommittedAssignmentEpoch(message: Message): void {
    const key = this.partitionKey(message.topic, message.partition);
    if (this.assignmentFenceFailures.has(key)) {
      return;
    }
    this.assignmentFenceFailures.add(key);

    const error = new Error(
      `Kafka committed record arrived without an active assignment epoch for ${message.topic}[${message.partition}] at offset ${message.offset}`
    );
    this.lastError = error.message;
    try {
      this.current?.pause([
        { topic: message.topic, partition: message.partition },
      ] as never);
      this.pausedPartitions.set(key, {
        topic: message.topic,
        partition: message.partition,
      });
    } catch (pauseError) {
      this.lastError = `${error.message}; pause failed: ${getErrorMessage(
        pauseError
      )}`;
    }
    this.emit('event.error', error);
    this.scheduleRestart('committed_assignment_epoch_missing', error);
  }

  private flushPendingDispatchMessages(): void {
    if (!this.dispatchAuthorized || this.pendingDispatchMessages.length === 0) {
      return;
    }

    while (
      this.dispatchAuthorized &&
      !this.closed &&
      this.connected &&
      this.pendingDispatchMessages.length > 0
    ) {
      const message = this.pendingDispatchMessages.shift();
      if (!message) {
        return;
      }
      this.dispatchMessage(message);
    }
  }

  private resolveContiguousCommitOffsets(
    offsets: ITopicPartitionOffset[]
  ): ITopicPartitionOffset[] {
    const ready: ITopicPartitionOffset[] = [];

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
      if (!pending || pending.size === 0) {
        const existing = this.partitionLag.get(key);
        if (
          typeof existing?.committed_offset === 'number' &&
          offset.offset <= existing.committed_offset
        ) {
          continue;
        }
        ready.push(offset);
        continue;
      }

      const completedMessageOffset = offset.offset - 1;
      const pendingOffsets = Array.from(pending.keys());
      const firstPendingOffset = Math.min(...pendingOffsets);
      const lastPendingOffset = Math.max(...pendingOffsets);

      if (completedMessageOffset < firstPendingOffset) {
        continue;
      }

      const completed = this.completedOffsets.get(key) ?? new Set<number>();
      if (completedMessageOffset <= lastPendingOffset) {
        completed.add(completedMessageOffset);
        this.completedOffsets.set(key, completed);
      }

      let commitMessageOffset = firstPendingOffset - 1;
      while (
        pending.has(commitMessageOffset + 1) &&
        completed.has(commitMessageOffset + 1)
      ) {
        commitMessageOffset += 1;
      }

      if (commitMessageOffset >= firstPendingOffset) {
        const completedState = pending.get(commitMessageOffset);
        ready.push({
          topic: offset.topic,
          partition: offset.partition,
          offset: commitMessageOffset + 1,
          consumerAssignmentEpoch:
            offset.consumerAssignmentEpoch ??
            completedState?.consumerAssignmentEpoch,
        });
      }
    }

    return ready;
  }

  private filterActiveCommitOffsets(
    offsets: ITopicPartitionOffset[]
  ): ITopicPartitionOffset[] {
    return offsets.filter((offset) => {
      if (
        !offset.topic ||
        typeof offset.partition !== 'number' ||
        typeof offset.offset !== 'number'
      ) {
        return false;
      }

      const key = this.partitionKey(offset.topic, offset.partition);
      const messageOffset = offset.offset - 1;
      const epoch =
        offset.consumerAssignmentEpoch ??
        this.pendingOffsets.get(key)?.get(messageOffset)
          ?.consumerAssignmentEpoch;

      return (
        typeof epoch === 'number' &&
        this.activeAssignmentEpochs.get(key) === epoch
      );
    });
  }

  private recordCommit(offsets: ITopicPartitionOffset[]): void {
    const now = Date.now();
    this.lastCommitAt = now;
    this.lastProgressAt = now;
    /*
     * Do not clear stall recovery here. A busy healthy partition may keep
     * committing while another assignment is completely stuck. Only a fresh
     * watchdog snapshot proving zero global lag and zero global pending work
     * resets consecutive recovery attempts.
     */

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
      const completed = this.completedOffsets.get(key);
      if (pending) {
        for (const pendingOffset of pending.keys()) {
          if (pendingOffset < offset.offset) {
            pending.delete(pendingOffset);
            completed?.delete(pendingOffset);
          }
        }
        if (pending.size === 0) {
          this.pendingOffsets.delete(key);
        }
      }
      if (completed?.size === 0) {
        this.completedOffsets.delete(key);
      }

      const existing = this.partitionLag.get(key);
      const positionOffset = Math.max(
        existing?.position_offset ?? 0,
        offset.offset
      );
      const effectiveProgressOffset =
        this.startPosition === 'latest-on-assignment'
          ? positionOffset
          : typeof existing?.low_watermark === 'number'
            ? Math.max(offset.offset, existing.low_watermark)
            : offset.offset;
      this.partitionLag.set(key, {
        topic: offset.topic,
        partition: offset.partition,
        committed_offset: offset.offset,
        position_offset: positionOffset,
        low_watermark: existing?.low_watermark ?? null,
        high_watermark: existing?.high_watermark ?? null,
        effective_progress_offset: effectiveProgressOffset,
        lag:
          typeof existing?.high_watermark === 'number'
            ? Math.max(0, existing.high_watermark - effectiveProgressOffset)
            : 0,
      });
      this.partitionLagProgress.delete(key);
    }

    this.releasePendingBackpressure();
  }

  private hasStableHealthyConsumerEvidence(now: number): boolean {
    return (
      this.connectedAt > 0 &&
      now - this.connectedAt >= RESTART_BACKOFF_STABLE_MS &&
      this.lastHealthyConsumerEvidenceAt >= this.connectedAt &&
      this.lastHealthyConsumerEvidenceAt <= now
    );
  }

  private applyPendingBackpressure(topic: string, partition: number): void {
    if (!this.current || !this.connected) {
      return;
    }

    const key = this.partitionKey(topic, partition);
    if (this.pausedPartitions.has(key)) {
      return;
    }

    const partitionPending = this.pendingOffsets.get(key)?.size ?? 0;
    const totalPending = this.getPendingHealth().pendingCount;
    if (
      partitionPending < MAX_PENDING_PER_PARTITION &&
      totalPending < MAX_PENDING_TOTAL
    ) {
      return;
    }

    if (this.runnerPausedPartitions.has(key)) {
      this.pausedPartitions.set(key, { topic, partition });
      return;
    }

    try {
      this.current.pause([{ topic, partition }] as never);
      this.pausedPartitions.set(key, { topic, partition });
    } catch (error) {
      this.lastError = getErrorMessage(error);
    }
  }

  private releasePendingBackpressure(): void {
    if (
      !this.current ||
      !this.connected ||
      this.pausedPartitions.size === 0 ||
      (this.requireDispatchAuthorization && !this.dispatchAuthorized)
    ) {
      return;
    }

    const totalPending = this.getPendingHealth().pendingCount;
    if (totalPending >= MAX_PENDING_TOTAL) {
      return;
    }

    for (const [key, assignment] of this.pausedPartitions.entries()) {
      const partitionPending = this.pendingOffsets.get(key)?.size ?? 0;
      if (partitionPending >= MAX_PENDING_PER_PARTITION) {
        continue;
      }

      if (this.runnerPausedPartitions.has(key)) {
        this.pausedPartitions.delete(key);
        continue;
      }

      try {
        this.current.resume([assignment] as never);
        this.pausedPartitions.delete(key);
      } catch (error) {
        this.lastError = getErrorMessage(error);
      }
    }
  }

  private getPendingHealth(): {
    pendingCount: number;
    queuedCount: number;
    processingCount: number;
    settledCount: number;
    oldestPendingAgeMs: number;
    oldestPendingNoProgressAgeMs: number;
  } {
    let pendingCount = 0;
    let queuedCount = 0;
    let processingCount = 0;
    let settledCount = 0;
    let oldestSeenAt = 0;
    let oldestProgressAt = 0;

    for (const offsets of this.pendingOffsets.values()) {
      pendingCount += offsets.size;
      for (const pending of offsets.values()) {
        if (oldestSeenAt === 0 || pending.firstSeenAt < oldestSeenAt) {
          oldestSeenAt = pending.firstSeenAt;
        }
        if (pending.executionState === 'queued') {
          queuedCount += 1;
          continue;
        }
        if (pending.executionState === 'settled') {
          settledCount += 1;
          if (
            typeof pending.settledAt === 'number' &&
            (oldestProgressAt === 0 || pending.settledAt < oldestProgressAt)
          ) {
            oldestProgressAt = pending.settledAt;
          }
        } else {
          processingCount += 1;
        }
        if (
          pending.executionState === 'processing' &&
          typeof pending.lastProgressAt === 'number'
        ) {
          if (
            oldestProgressAt === 0 ||
            pending.lastProgressAt < oldestProgressAt
          ) {
            oldestProgressAt = pending.lastProgressAt;
          }
        }
      }
    }

    return {
      pendingCount,
      queuedCount,
      processingCount,
      settledCount,
      oldestPendingAgeMs: oldestSeenAt > 0 ? Date.now() - oldestSeenAt : 0,
      oldestPendingNoProgressAgeMs:
        oldestProgressAt > 0 ? Date.now() - oldestProgressAt : 0,
    };
  }

  private async refreshLagSnapshot(
    consumer: KafkaConsumer,
    assignments: ITopicPartition[]
  ): Promise<ILagSnapshotRefreshResult> {
    const refreshedKeys = new Set<string>();
    const errors: string[] = [];
    let committedOffsets: TopicPartitionOffset[] = [];
    let positionOffsets: TopicPartitionOffset[] = [];
    let committedReadSucceeded = this.startPosition === 'latest-on-assignment';
    let positionReadSucceeded = this.startPosition === 'committed';
    if (this.startPosition === 'latest-on-assignment') {
      try {
        positionOffsets = consumer.position(assignments as never) ?? [];
        positionReadSucceeded = true;
      } catch (error) {
        errors.push(getErrorMessage(error));
      }
    } else {
      try {
        committedOffsets = await waitForNativeKafkaCallback<
          TopicPartitionOffset[]
        >(
          'Kafka committed-offset watchdog query',
          WATERMARK_TIMEOUT_MS,
          (finish) => {
            consumer.committed(
              assignments as never,
              WATERMARK_TIMEOUT_MS,
              (err: LibrdKafkaError, offsets: TopicPartitionOffset[]) => {
                finish(err, offsets ?? []);
              }
            );
          }
        );
        committedReadSucceeded = true;
      } catch (error) {
        errors.push(getErrorMessage(error));
      }
    }

    await Promise.all(
      assignments.map(async (assignment) => {
        const key = this.partitionKey(assignment.topic, assignment.partition);
        const existing = this.partitionLag.get(key);
        const committed = committedOffsets.find(
          (item) =>
            item.topic === assignment.topic &&
            item.partition === assignment.partition
        );
        const positioned = positionOffsets.find(
          (item) =>
            item.topic === assignment.topic &&
            item.partition === assignment.partition
        );
        const observedPositionOffset =
          typeof positioned?.offset === 'number' && positioned.offset >= 0
            ? positioned.offset
            : null;
        let lowWatermark: number | null = null;
        let highWatermark: number | null = null;

        try {
          const offsets = await waitForNativeKafkaCallback<WatermarkOffsets>(
            `Kafka watermark watchdog query for ${assignment.topic}[${assignment.partition}]`,
            WATERMARK_TIMEOUT_MS,
            (finish) => {
              consumer.queryWatermarkOffsets(
                assignment.topic,
                assignment.partition,
                WATERMARK_TIMEOUT_MS,
                (err: LibrdKafkaError, watermark: WatermarkOffsets) => {
                  finish(err, watermark);
                }
              );
            }
          );
          const observedLowWatermark = Number(offsets?.lowOffset);
          const observedHighWatermark = Number(offsets?.highOffset);
          if (
            !Number.isSafeInteger(observedLowWatermark) ||
            observedLowWatermark < 0 ||
            !Number.isSafeInteger(observedHighWatermark) ||
            observedHighWatermark < 0 ||
            observedLowWatermark > observedHighWatermark
          ) {
            throw new Error(
              `Kafka watermark range unavailable for ${assignment.topic}[${assignment.partition}]`
            );
          }
          lowWatermark = observedLowWatermark;
          highWatermark = observedHighWatermark;
        } catch (error) {
          errors.push(getErrorMessage(error));
        }

        if (lowWatermark === null || highWatermark === null) {
          return;
        }

        const committedEntryKnown =
          this.startPosition === 'latest-on-assignment' || Boolean(committed);
        const committedOffset =
          this.startPosition === 'latest-on-assignment'
            ? (existing?.committed_offset ?? null)
            : typeof committed?.offset === 'number' && committed.offset >= 0
              ? committed.offset
              : null;
        const positionOffsetKnown =
          this.startPosition === 'committed' || observedPositionOffset !== null;
        if (
          !committedReadSucceeded ||
          !positionReadSucceeded ||
          !committedEntryKnown ||
          !positionOffsetKnown
        ) {
          errors.push(
            `Kafka lag snapshot incomplete for ${assignment.topic}[${assignment.partition}]`
          );
          return;
        }

        const positionOffset =
          this.startPosition === 'latest-on-assignment'
            ? observedPositionOffset
            : (existing?.position_offset ?? committedOffset ?? lowWatermark);
        const rawProgressOffset =
          this.startPosition === 'latest-on-assignment'
            ? positionOffset
            : (committedOffset ?? lowWatermark);
        if (rawProgressOffset === null) {
          errors.push(
            `Kafka progress offset unavailable for ${assignment.topic}[${assignment.partition}]`
          );
          return;
        }
        const effectiveProgressOffset = Math.max(
          rawProgressOffset,
          lowWatermark
        );
        if (this.current !== consumer || !this.connected) {
          errors.push(
            'Kafka consumer generation changed during lag measurement'
          );
          return;
        }
        if (!this.isCurrentlyAssigned(consumer, assignment)) {
          this.clearPartitionTracking(key);
          errors.push(
            `Kafka assignment changed during lag measurement for ${assignment.topic}[${assignment.partition}]`
          );
          return;
        }

        const snapshot: IPartitionLagSnapshot = {
          topic: assignment.topic,
          partition: assignment.partition,
          committed_offset: committedOffset,
          position_offset: positionOffset,
          low_watermark: lowWatermark,
          high_watermark: highWatermark,
          effective_progress_offset: effectiveProgressOffset,
          lag: Math.max(0, highWatermark - effectiveProgressOffset),
        };
        this.partitionLag.set(key, snapshot);
        this.updatePartitionLagProgress(key, snapshot, Date.now());
        refreshedKeys.add(key);
      })
    );

    if (this.current === consumer && this.connected) {
      const currentAssignments = this.readAssignments(consumer);
      this.pruneTrackingToAssignments(currentAssignments);
      const expectedKeys = new Set(
        assignments.map((assignment) =>
          this.partitionKey(assignment.topic, assignment.partition)
        )
      );
      const currentKeys = new Set(
        currentAssignments.map((assignment) =>
          this.partitionKey(assignment.topic, assignment.partition)
        )
      );
      const assignmentStable =
        expectedKeys.size === currentKeys.size &&
        [...expectedKeys].every((key) => currentKeys.has(key));
      const complete =
        assignmentStable &&
        refreshedKeys.size === expectedKeys.size &&
        [...expectedKeys].every((key) => refreshedKeys.has(key));
      if (!assignmentStable) {
        errors.push('Kafka assignments changed during lag measurement');
      }
      return { complete, errors, refreshedKeys };
    }

    errors.push('Kafka consumer generation changed during lag measurement');
    return { complete: false, errors, refreshedKeys: new Set() };
  }

  private isCurrentlyAssigned(
    consumer: KafkaConsumer,
    assignment: ITopicPartition
  ): boolean {
    const key = this.partitionKey(assignment.topic, assignment.partition);
    return this.readAssignments(consumer).some(
      (current) => this.partitionKey(current.topic, current.partition) === key
    );
  }

  private pruneTrackingToAssignments(assignments: ITopicPartition[]): void {
    const assignedKeys = new Set(
      assignments.map((assignment) =>
        this.partitionKey(assignment.topic, assignment.partition)
      )
    );
    const trackedKeys = new Set([
      ...this.partitionLag.keys(),
      ...this.partitionLagProgress.keys(),
      ...this.pendingOffsets.keys(),
      ...this.completedOffsets.keys(),
      ...this.pausedPartitions.keys(),
      ...this.assignmentStartOffsets.keys(),
      ...this.activeAssignmentEpochs.keys(),
      ...this.assignmentPreparations.keys(),
    ]);

    for (const key of trackedKeys) {
      if (assignedKeys.has(key)) {
        continue;
      }
      this.activeAssignmentEpochs.delete(key);
      this.assignmentPreparations.delete(key);
      this.clearPartitionTracking(key);
    }

    this.pendingDispatchMessages = this.pendingDispatchMessages.filter(
      (message) =>
        assignedKeys.has(this.partitionKey(message.topic, message.partition))
    );
  }

  private updatePartitionLagProgress(
    key: string,
    snapshot: IPartitionLagSnapshot,
    now: number
  ): void {
    if (snapshot.lag <= 0) {
      this.partitionLagProgress.delete(key);
      return;
    }

    const effectiveOffset = snapshot.effective_progress_offset;
    const existing = this.partitionLagProgress.get(key);
    if (!existing || existing.effectiveOffset !== effectiveOffset) {
      this.partitionLagProgress.set(key, {
        effectiveOffset,
        continuousSince: now,
      });
    }
  }

  private getOldestLagNoProgressAgeMs(): number {
    const now = Date.now();
    let oldestContinuousSince = 0;

    for (const [key, progress] of this.partitionLagProgress.entries()) {
      if ((this.partitionLag.get(key)?.lag ?? 0) <= 0) {
        continue;
      }

      /*
       * A committed offset cannot advance while its handler is still
       * completing durable sub-steps. Explicit handler progress is therefore
       * valid evidence for this partition, but never for another partition.
       * The pending-offset check above still catches any sibling handler that
       * stopped reporting progress.
       */
      const pending = Array.from(this.pendingOffsets.get(key)?.values() ?? []);
      const active = pending.filter((item) => item.executionState !== 'queued');
      /*
       * A record that is only waiting for the runner's entity chain or local
       * backpressure has not started processing. Its queueing time cannot be
       * evidence that the Kafka handler itself is stalled.
       */
      if (pending.length > 0 && active.length === 0) {
        continue;
      }
      const latestPendingProgressAt = Math.max(
        0,
        ...active.map((item) =>
          item.executionState === 'settled'
            ? (item.settledAt ?? 0)
            : (item.lastProgressAt ?? 0)
        )
      );
      const continuousSince = Math.max(
        progress.continuousSince,
        latestPendingProgressAt
      );
      if (
        oldestContinuousSince === 0 ||
        continuousSince < oldestContinuousSince
      ) {
        oldestContinuousSince = continuousSince;
      }
    }

    return oldestContinuousSince > 0 ? now - oldestContinuousSince : 0;
  }

  private recordLagMeasurementFailure(errors: string[]): void {
    this.lagMeasurementComplete = false;
    this.consecutiveLagMeasurementFailures += 1;
    if (errors.length > 0) {
      const uniqueErrors = [...new Set(errors)];
      const visibleErrors = uniqueErrors.slice(0, 5);
      const hiddenErrorCount = uniqueErrors.length - visibleErrors.length;
      this.lastError = `${visibleErrors.join('; ')}${
        hiddenErrorCount > 0 ? `; and ${hiddenErrorCount} more` : ''
      }`;
    }
  }

  private recordLagMeasurementSuccess(): void {
    this.lagMeasurementComplete = true;
    this.consecutiveLagMeasurementFailures = 0;
    this.lastLagMeasurementAt = Date.now();
  }

  private invalidateLagMeasurementFreshness(): void {
    this.lagMeasurementComplete = false;
    this.lastLagMeasurementAt = 0;
  }

  private markPodReplacementRequired(reason: string): void {
    if (this.podReplacementRequired) {
      return;
    }

    const pendingReadyCallback = this.pendingReadyCallback;
    this.pendingReadyCallback = undefined;
    this.podReplacementRequired = true;
    this.podReplacementReason = 'native_disconnect_timeout';
    this.currentGenerationFenced = true;
    this.connected = false;
    this.connecting = false;
    this.unhealthy = true;
    this.stallReason = this.podReplacementReason;
    this.lastError = reason;
    this.clearConnectTimeout();
    this.clearWatchdog();
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    console.error('Kafka consumer generation requires process replacement', {
      group_id: this.groupId,
      topics: this.topics,
      reason,
      disconnect_timeout_ms: NATIVE_DISCONNECT_TIMEOUT_MS,
      restart_count: this.restartCount,
      consecutive_stall_restart_count: this.consecutiveStallRestarts,
    });
    try {
      pendingReadyCallback?.(new Error(reason));
    } catch (error) {
      console.error('Kafka pending readiness callback failed', {
        group_id: this.groupId,
        reason,
        error: getErrorMessage(error),
      });
    }
    try {
      this.onProcessReplacementRequired({
        groupId: this.groupId,
        reason,
      });
    } catch (error) {
      console.error('Kafka process replacement callback failed', {
        group_id: this.groupId,
        reason,
        error: getErrorMessage(error),
      });
    }
  }

  private clearStallHealth(resetConsecutiveRestarts: boolean): void {
    if (this.podReplacementRequired) {
      this.unhealthy = true;
      this.stallReason = this.podReplacementReason;
      return;
    }

    if (resetConsecutiveRestarts) {
      this.unhealthy = false;
      this.stallReason = '';
      this.consecutiveStallRestarts = 0;
      return;
    }

    /*
     * Once internal recovery is exhausted, keep liveness failed across the
     * empty-assignment and newly-observed-lag windows of the next generation.
     * Only global zero lag/pending evidence (or an explicit dispatch
     * authorization reset) may unlatch it.
     */
    if (
      this.isStallRestartEnabled() &&
      this.consecutiveStallRestarts >= MAX_STALL_RESTARTS_BEFORE_UNHEALTHY
    ) {
      return;
    }

    this.unhealthy = false;
    this.stallReason = '';
  }

  private partitionKey(topic: string, partition: number): string {
    return `${topic}:${partition}`;
  }

  private clearPartitionTracking(key: string): void {
    this.pendingOffsets.delete(key);
    this.completedOffsets.delete(key);
    this.partitionLag.delete(key);
    this.partitionLagProgress.delete(key);
    this.pausedPartitions.delete(key);
    this.runnerPausedPartitions.delete(key);
    this.assignmentFenceFailures.delete(key);
    this.assignmentStartOffsets.delete(key);
    this.pendingDispatchMessages = this.pendingDispatchMessages.filter(
      (message) => this.partitionKey(message.topic, message.partition) !== key
    );
  }

  private clearTimers(): void {
    this.clearConnectTimeout();
    this.clearWatchdog();
    this.clearStaleAssignmentRestartTimer();
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private applyDispatchAuthorization(authorized: boolean): void {
    const wasAuthorized = this.dispatchAuthorized;
    this.dispatchAuthorized = authorized;

    if (wasAuthorized && !authorized) {
      // librdkafka advances its local fetch position before the runner commits.
      // Once the dispatch generation is revoked, in-flight work is fenced and
      // can no longer commit. Reusing this native member would let a later
      // offset in the new dispatch generation commit across those abandoned
      // records. Require a fresh group generation so delivery resumes from the
      // broker's committed offset.
      this.dispatchAuthorizationReplayRequired = true;
    }

    if (authorized && this.dispatchAuthorizationReplayRequired) {
      // Never flush or resume a native member that observed a true -> false
      // authorization transition. Fence it immediately and replace it from the
      // durable group cursor before allowing any further dispatch.
      this.__restartGenerationWithoutCommit(
        'Kafka dispatch authorization restored after revocation; replaying from committed offsets'
      );
      return;
    }

    const consumer = this.current;
    if (!consumer || !this.connected) {
      return;
    }

    const assignments = this.readAssignments(consumer);
    if (assignments.length === 0) {
      return;
    }

    try {
      if (!authorized) {
        consumer.pause(assignments as never);
        return;
      }

      this.lastProgressAt = Date.now();
      this.clearStallHealth(true);
      this.flushPendingDispatchMessages();
      this.releasePendingBackpressure();

      const resumable = assignments.filter(
        (assignment) =>
          this.activeAssignmentEpochs.has(
            this.partitionKey(assignment.topic, assignment.partition)
          ) &&
          !this.assignmentPreparations.has(
            this.partitionKey(assignment.topic, assignment.partition)
          ) &&
          !this.pausedPartitions.has(
            this.partitionKey(assignment.topic, assignment.partition)
          ) &&
          !this.runnerPausedPartitions.has(
            this.partitionKey(assignment.topic, assignment.partition)
          )
      );
      if (resumable.length > 0) {
        consumer.resume(resumable as never);
        for (const assignment of resumable) {
          this.committedAssignmentResumeReconciliations.delete(
            this.partitionKey(assignment.topic, assignment.partition)
          );
        }
      }
    } catch (error) {
      this.lastError = getErrorMessage(error);
    }
  }

  private ensureDispatchAuthorizationSubscription(): void {
    if (
      !this.requireDispatchAuthorization ||
      this.unsubscribeDispatchAuthorization
    ) {
      return;
    }

    this.dispatchAuthorized = isWorkerKafkaDispatchAuthorized();
    this.unsubscribeDispatchAuthorization =
      subscribeWorkerKafkaDispatchAuthorization((authorized) => {
        this.applyDispatchAuthorization(authorized);
      });
  }

  private clearOffsetTracking(): void {
    this.invalidateLagMeasurementFreshness();
    this.pendingOffsets.clear();
    this.completedOffsets.clear();
    this.partitionLag.clear();
    this.partitionLagProgress.clear();
    this.pausedPartitions.clear();
    this.runnerPausedPartitions.clear();
    this.assignmentFenceFailures.clear();
    this.assignmentStartOffsets.clear();
    this.committedAssignmentResumeReconciliations.clear();
    this.pendingDispatchMessages = [];
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

  private clearStaleAssignmentRestartTimer(): void {
    if (this.staleAssignmentRestartTimer) {
      clearTimeout(this.staleAssignmentRestartTimer);
      this.staleAssignmentRestartTimer = null;
    }
  }
}

export function createConsumer(
  kafka: KafkaClient,
  groupId: string,
  options: {
    startPosition?: KafkaConsumerStartPosition;
    requireDispatchAuthorization?: boolean;
    onProcessReplacementRequired?: (
      request: IKafkaConsumerProcessReplacementRequest
    ) => void;
  } = {}
): KafkaConsumer {
  if (isKafkaConsumerProcessReplacementPending()) {
    throw new Error(
      'Kafka process replacement in progress; refusing a new native consumer generation'
    );
  }

  const startPosition =
    options.startPosition === 'latest-on-assignment' &&
    process.env.NODE_ENV !== 'test'
      ? 'committed'
      : options.startPosition;

  return new ManagedKafkaConsumer(
    kafka,
    groupId,
    startPosition,
    options.requireDispatchAuthorization,
    options.onProcessReplacementRequired
  ) as unknown as KafkaConsumer;
}
