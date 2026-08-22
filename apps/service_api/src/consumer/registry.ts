import {
  buildMissingKafkaConsumerHealthSnapshot,
  getConsumerOwnerKafkaHealthSnapshot,
  getConsumerOwnerName,
  type IKafkaConsumerOwnerHealthSnapshot,
} from '@core/common/functions/kafkaConsumerHealth';
import { isWhatsappDurableCommittedTopic } from '@core/common/functions/kafkaConsumerStartPositionPolicy';
import { getServiceApiConsumerStartupAttempt } from './startupAttempt';

export interface IServiceApiConsumer {
  close?: () => Promise<void>;
  restart?: () => Promise<void>;
}

interface IRegisteredServiceApiConsumer {
  consumer: IServiceApiConsumer;
  healthSnapshotMissingSince: number | null;
  registeredAt: number;
}

export type ServiceApiConsumerStartupState = 'starting' | 'ready' | 'failed';

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

const consumers: IRegisteredServiceApiConsumer[] = [];
const MISSING_SNAPSHOT_GRACE_MS = Math.max(
  1_000,
  readPositiveIntegerEnv('KAFKA_CONSUMER_MISSING_SNAPSHOT_GRACE_MS', 1_000)
);
const HEALTH_SNAPSHOT_RECOVERY_TIMEOUT_MS = Math.max(
  30_000,
  readPositiveIntegerEnv(
    'SERVICE_API_KAFKA_READINESS_RECOVERY_TIMEOUT_MS',
    3 * 60 * 1000
  )
);
let consumerStartupState: ServiceApiConsumerStartupState = 'starting';
const PROCESSING_STALL_REASONS = new Set([
  'pending_offset_stall',
  'lag_no_commit_progress',
  'lag_measurement_unavailable',
]);

function isProcessingStallReason(reason: string | undefined): boolean {
  if (!reason) {
    return false;
  }

  return (
    PROCESSING_STALL_REASONS.has(reason) ||
    [...PROCESSING_STALL_REASONS].some(
      (processingReason) => reason === `${processingReason}_watchdog`
    )
  );
}

function isAssignmentNotReady(
  snapshot: IKafkaConsumerOwnerHealthSnapshot
): boolean {
  return (
    snapshot.assignments_ready !== true ||
    (snapshot.assignment_positioning_count ?? 0) > 0
  );
}

function isInactiveConsumer(
  snapshot: IKafkaConsumerOwnerHealthSnapshot
): boolean {
  return snapshot.connected !== true || snapshot.consuming !== true;
}

function hasDurableWhatsappTopic(
  snapshot: IKafkaConsumerOwnerHealthSnapshot
): boolean {
  return getSnapshotTopics(snapshot).some(isWhatsappDurableCommittedTopic);
}

function getSnapshotTopics(
  snapshot: IKafkaConsumerOwnerHealthSnapshot
): string[] {
  const topics = new Set<string>([
    ...(snapshot.topics ?? []),
    ...(snapshot.assigned_topics ?? []),
    ...(snapshot.assignments ?? []).map((assignment) => assignment.topic),
  ]);

  return [...topics];
}

function isDurableGlobalWorkerTopic(topic: string): boolean {
  const parts = topic.split('.');
  return (
    parts.length >= 3 &&
    parts[0] === 'worker' &&
    (parts[1] === 'lifecycle' || parts[1] === 'warm')
  );
}

function hasServiceCriticalDurableTopic(
  snapshot: IKafkaConsumerOwnerHealthSnapshot
): boolean {
  return (
    hasDurableWhatsappTopic(snapshot) ||
    getSnapshotTopics(snapshot).some(isDurableGlobalWorkerTopic)
  );
}

/**
 * Processing stalls are readiness-blocking for the durable WhatsApp, worker
 * lifecycle and warm-pool pipelines. Those queues must never stay assigned to
 * a member that is connected but no longer advancing its committed position.
 *
 * Other administrative consumers keep their existing watchdog semantics and
 * do not remove HTTP serving capacity solely because a long-running job is in
 * progress.
 */
function isReadinessCriticalProcessingStall(
  snapshot: IKafkaConsumerOwnerHealthSnapshot
): boolean {
  if (!isProcessingStallReason(snapshot.stall_reason)) {
    return false;
  }

  return hasServiceCriticalDurableTopic(snapshot);
}

function isPodReplacementRequired(
  snapshot: IKafkaConsumerOwnerHealthSnapshot
): boolean {
  if (snapshot.pod_replacement_required === true) {
    return true;
  }

  if (snapshot.health_snapshot_recovery_exhausted === true) {
    return true;
  }

  return (
    snapshot.unhealthy === true &&
    snapshot.stall_recovery_exhausted === true &&
    isProcessingStallReason(snapshot.stall_reason)
  );
}

function isReadinessBlockingUnhealthy(
  snapshot: IKafkaConsumerOwnerHealthSnapshot
): boolean {
  if (snapshot.unhealthy !== true) {
    return false;
  }

  if (!isProcessingStallReason(snapshot.stall_reason)) {
    return true;
  }

  return (
    isInactiveConsumer(snapshot) ||
    isAssignmentNotReady(snapshot) ||
    isReadinessCriticalProcessingStall(snapshot)
  );
}

export function getServiceApiConsumerStartupState(): ServiceApiConsumerStartupState {
  return consumerStartupState;
}

export function isServiceApiConsumerStartupPending(): boolean {
  return consumerStartupState === 'starting';
}

export function hasServiceApiConsumerStartupFailed(): boolean {
  return consumerStartupState === 'failed';
}

/**
 * Tracks asynchronous Kafka startup. A rejected startup remains failed until
 * a new startup attempt explicitly begins.
 */
export async function trackServiceApiConsumerStartup(
  startup: () => Promise<void>
): Promise<void> {
  consumerStartupState = 'starting';

  try {
    await startup();
    consumerStartupState = 'ready';
  } catch (error) {
    consumerStartupState = 'failed';
    throw error;
  }
}

export function registerServiceApiConsumer(
  consumer: IServiceApiConsumer
): void {
  const registeredAt = Date.now();
  consumers.push({
    consumer,
    healthSnapshotMissingSince: null,
    registeredAt,
  });
}

export function getServiceApiConsumers(): IServiceApiConsumer[] {
  return consumers.map((item) => item.consumer);
}

export function getServiceApiKafkaHealthSnapshots(): IKafkaConsumerOwnerHealthSnapshot[] {
  return consumers.map((item) => {
    const now = Date.now();
    const observedSnapshot = getConsumerOwnerKafkaHealthSnapshot(item.consumer);
    const snapshot = observedSnapshot
      ? observedSnapshot
      : buildMissingKafkaConsumerHealthSnapshot({
          owner: getConsumerOwnerName(item.consumer),
          registeredAt: item.registeredAt,
          graceMs: MISSING_SNAPSHOT_GRACE_MS,
        });
    const registeredAgeMs = Math.max(0, now - item.registeredAt);
    const startupGraceElapsed = registeredAgeMs >= MISSING_SNAPSHOT_GRACE_MS;
    const inactive = isInactiveConsumer(snapshot);
    const assignmentNotReady = isAssignmentNotReady(snapshot);
    const blockingStall = isReadinessCriticalProcessingStall(snapshot);
    const derivedUnhealthy =
      startupGraceElapsed && (inactive || assignmentNotReady || blockingStall);
    const startupAttempt = getServiceApiConsumerStartupAttempt(item.consumer);
    const missingSnapshotRecoveryEligible =
      snapshot.missing === true && startupAttempt?.state !== 'pending';

    if (missingSnapshotRecoveryEligible) {
      item.healthSnapshotMissingSince ??= now;
    } else {
      item.healthSnapshotMissingSince = null;
    }

    const healthSnapshotMissingAgeMs =
      item.healthSnapshotMissingSince !== null
        ? Math.max(0, now - item.healthSnapshotMissingSince)
        : 0;
    const healthSnapshotRecoveryExhausted =
      missingSnapshotRecoveryEligible &&
      healthSnapshotMissingAgeMs >= HEALTH_SNAPSHOT_RECOVERY_TIMEOUT_MS;

    return {
      ...snapshot,
      unhealthy: snapshot.unhealthy === true || derivedUnhealthy,
      stall_reason:
        snapshot.stall_reason ||
        (derivedUnhealthy ? 'consumer_not_ready' : undefined),
      last_error:
        snapshot.last_error || (derivedUnhealthy ? 'consumer_not_ready' : ''),
      registered_at: item.registeredAt,
      health_snapshot_missing_since:
        item.healthSnapshotMissingSince ?? undefined,
      health_snapshot_missing_age_ms: healthSnapshotMissingAgeMs,
      health_snapshot_recovery_timeout_ms: HEALTH_SNAPSHOT_RECOVERY_TIMEOUT_MS,
      health_snapshot_recovery_exhausted: healthSnapshotRecoveryExhausted,
    };
  });
}

export function hasUnhealthyServiceApiKafkaConsumer(): boolean {
  return getServiceApiKafkaHealthSnapshots().some(
    (snapshot) => snapshot.unhealthy === true
  );
}

export function hasUnreadyServiceApiKafkaConsumer(): boolean {
  return getServiceApiKafkaHealthSnapshots().some((snapshot) => {
    if (
      snapshot.missing === true ||
      isInactiveConsumer(snapshot) ||
      isAssignmentNotReady(snapshot)
    ) {
      return true;
    }

    return isReadinessBlockingUnhealthy(snapshot);
  });
}

/**
 * Readiness removes traffic but does not make Kafka relinquish a partition.
 * Once the managed consumer has exhausted its internal generation restarts,
 * liveness must fail so Kubernetes replaces the exact pod and forces a group
 * rebalance. This last-resort barrier covers every topic: an administrative
 * partition can block its own consumer group just as permanently as a message
 * partition.
 */
export function hasServiceApiKafkaConsumerRequiringPodReplacement(): boolean {
  return getServiceApiKafkaConsumersRequiringPodReplacement().length > 0;
}

/**
 * Exposes the exact consumers that exhausted their in-process recovery. The
 * liveness endpoint uses this snapshot to make a kubelet restart actionable:
 * operators can identify the owner, topics and terminal stall reason without
 * reconstructing it from logs emitted by a previous process generation.
 */
export function getServiceApiKafkaConsumersRequiringPodReplacement(): IKafkaConsumerOwnerHealthSnapshot[] {
  return getServiceApiKafkaHealthSnapshots().filter(isPodReplacementRequired);
}
