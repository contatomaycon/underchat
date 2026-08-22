import {
  buildMissingKafkaConsumerHealthSnapshot,
  getConsumerOwnerKafkaHealthSnapshot,
  getConsumerOwnerName,
  type IKafkaConsumerOwnerHealthSnapshot,
} from '@core/common/functions/kafkaConsumerHealth';

export interface IWorkerConsumer {
  execute?: () => Promise<void>;
  close?: () => Promise<void>;
  restart?: () => Promise<void>;
}

interface IRegisterWorkerConsumerOptions {
  monitorKafkaHealth?: boolean;
}

interface IRegisteredWorkerConsumer {
  consumer: IWorkerConsumer;
  registeredAt: number;
  monitorKafkaHealth: boolean;
  readinessIssueSince: number | null;
  reconciliationAttempt: number;
  nextReconciliationAt: number;
  hasObservedReady: boolean;
}

export interface IKafkaConsumerHealthSummary {
  expected: number;
  active: number;
  missing: number;
  unhealthy: number;
}

export const EXPECTED_KAFKA_CONSUMER_COUNT = 1;

interface IKafkaConsumerLog {
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

const consumers: IRegisteredWorkerConsumer[] = [];
let supervisorTimer: NodeJS.Timeout | null = null;
let desiredProviderReady = true;
let appliedProviderReady: boolean | null = true;
let providerTransition = Promise.resolve();
let supervisorQueued = false;
const immediateConsumerStops = new WeakMap<IWorkerConsumer, Promise<void>>();

const SUPERVISOR_INTERVAL_MS = Math.max(
  1000,
  Number(process.env.KAFKA_CONSUMER_SUPERVISOR_INTERVAL_MS) || 30000
);
const MISSING_SNAPSHOT_GRACE_MS = Math.max(
  1000,
  Number(process.env.KAFKA_CONSUMER_MISSING_SNAPSHOT_GRACE_MS) || 1000
);
const ASSIGNMENT_READY_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.KAFKA_CONSUMER_ASSIGNMENT_READY_TIMEOUT_MS) || 10000
);
const REBALANCE_GRACE_MS = Math.max(
  1000,
  Number(process.env.KAFKA_CONSUMER_REBALANCE_GRACE_MS) ||
    ASSIGNMENT_READY_TIMEOUT_MS
);
const RECONCILE_BACKOFF_BASE_MS = Math.max(
  1000,
  Number(process.env.KAFKA_CONSUMER_RECONCILE_BACKOFF_BASE_MS) || 5000
);
const RECONCILE_BACKOFF_MAX_MS = Math.max(
  RECONCILE_BACKOFF_BASE_MS,
  Number(process.env.KAFKA_CONSUMER_RECONCILE_BACKOFF_MAX_MS) || 60000
);
const configuredReconcileJitterRatio = Number(
  process.env.KAFKA_CONSUMER_RECONCILE_JITTER_RATIO
);
const RECONCILE_JITTER_RATIO = Number.isFinite(configuredReconcileJitterRatio)
  ? Math.min(1, Math.max(0, configuredReconcileJitterRatio))
  : 0.2;
const ASSIGNMENT_READY_POLL_MS = 100;

export function registerWorkerConsumer(
  consumer: IWorkerConsumer,
  options: IRegisterWorkerConsumerOptions = {}
): void {
  if (consumers.some((item) => item.consumer === consumer)) {
    return;
  }
  consumers.push({
    consumer,
    registeredAt: Date.now(),
    monitorKafkaHealth: options.monitorKafkaHealth !== false,
    readinessIssueSince: null,
    reconciliationAttempt: 0,
    nextReconciliationAt: 0,
    hasObservedReady: false,
  });
}

export function unregisterWorkerConsumer(consumer: IWorkerConsumer): boolean {
  const index = consumers.findIndex((item) => item.consumer === consumer);
  if (index < 0) {
    return false;
  }
  consumers.splice(index, 1);
  return true;
}

export function getWorkerConsumers(): IWorkerConsumer[] {
  return consumers.map((item) => item.consumer);
}

export function getKafkaConsumerHealthSnapshots(): IKafkaConsumerOwnerHealthSnapshot[] {
  return consumers.filter(shouldMonitorKafkaHealth).map((item) => {
    const snapshot = getRegisteredConsumerHealthSnapshot(item);
    observeConsumerReadiness(item, snapshot);
    return snapshot;
  });
}

export function getKafkaConsumerHealthSummary(
  snapshots: IKafkaConsumerOwnerHealthSnapshot[] = getKafkaConsumerHealthSnapshots()
): IKafkaConsumerHealthSummary {
  const registered = snapshots.length;
  return {
    expected: EXPECTED_KAFKA_CONSUMER_COUNT,
    active: snapshots.filter(isKafkaConsumerActive).length,
    missing:
      snapshots.filter((snapshot) => snapshot.missing === true).length +
      Math.max(0, EXPECTED_KAFKA_CONSUMER_COUNT - registered),
    unhealthy: snapshots.filter((snapshot) => snapshot.unhealthy === true)
      .length,
  };
}

export function areKafkaConsumersReady(
  summary: IKafkaConsumerHealthSummary = getKafkaConsumerHealthSummary()
): boolean {
  return (
    summary.expected === EXPECTED_KAFKA_CONSUMER_COUNT &&
    summary.active === EXPECTED_KAFKA_CONSUMER_COUNT &&
    summary.missing === 0 &&
    summary.unhealthy === 0
  );
}

export function hasUnhealthyKafkaConsumer(): boolean {
  return !areKafkaConsumersReady();
}

export function hasKafkaConsumerRequiringProcessReplacement(): boolean {
  return getKafkaConsumerHealthSnapshots().some(
    (snapshot) => snapshot.pod_replacement_required === true
  );
}

export async function waitForKafkaConsumersReady(
  options: {
    timeoutMs?: number;
    shouldContinue?: () => boolean;
  } = {}
): Promise<void> {
  const timeoutMs = Math.max(
    1,
    Number.isFinite(options.timeoutMs)
      ? Math.floor(options.timeoutMs as number)
      : ASSIGNMENT_READY_TIMEOUT_MS
  );
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const summary = getKafkaConsumerHealthSummary();
    if (areKafkaConsumersReady(summary)) {
      return;
    }
    if (options.shouldContinue?.() === false) {
      throw new Error('kafka_consumer_readiness_cancelled');
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(
        `kafka_consumers_not_ready:expected=${summary.expected},active=${summary.active},missing=${summary.missing},unhealthy=${summary.unhealthy}`
      );
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, Math.min(ASSIGNMENT_READY_POLL_MS, remainingMs));
    });
  }
}

function isKafkaConsumerActive(
  snapshot: IKafkaConsumerOwnerHealthSnapshot
): boolean {
  return (
    snapshot.missing !== true &&
    snapshot.unhealthy !== true &&
    snapshot.connected === true &&
    snapshot.consuming === true &&
    snapshot.assignments_ready === true &&
    isWorkerCommandIngressIdentity(snapshot)
  );
}

function isWorkerCommandIngressIdentity(
  snapshot: IKafkaConsumerOwnerHealthSnapshot
): boolean {
  return (
    snapshot.group_id.startsWith('uc_worker_') &&
    snapshot.topics.length === 1 &&
    snapshot.topics[0].startsWith('uc.worker.command.')
  );
}

export function startKafkaConsumerSupervisor(log: IKafkaConsumerLog): void {
  if (supervisorTimer) {
    return;
  }

  supervisorTimer = setInterval(() => {
    void reconcileKafkaConsumers(log, 'supervisor');
  }, SUPERVISOR_INTERVAL_MS);
  supervisorTimer.unref?.();
}

export function setKafkaConsumersProviderReady(
  ready: boolean,
  log: IKafkaConsumerLog
): Promise<void> {
  const providerWasDesiredReady = desiredProviderReady;
  desiredProviderReady = ready;
  const immediateStop =
    !ready && providerWasDesiredReady
      ? beginImmediateProviderStop(log)
      : Promise.resolve(false);
  providerTransition = providerTransition.then(
    async () => {
      const stoppedImmediately = await immediateStop;
      if (!ready && stoppedImmediately && !desiredProviderReady) {
        appliedProviderReady = false;
      }
      await reconcileRequestedProviderState(ready, log);
    },
    async () => {
      const stoppedImmediately = await immediateStop;
      if (!ready && stoppedImmediately && !desiredProviderReady) {
        appliedProviderReady = false;
      }
      await reconcileRequestedProviderState(ready, log);
    }
  );

  return providerTransition;
}

function closeConsumerImmediately(
  item: IRegisteredWorkerConsumer
): Promise<void> {
  const existing = immediateConsumerStops.get(item.consumer);
  if (existing) {
    return existing;
  }

  const closing = Promise.resolve()
    .then(() => item.consumer.close?.())
    .then(() => undefined)
    .finally(() => {
      if (immediateConsumerStops.get(item.consumer) === closing) {
        immediateConsumerStops.delete(item.consumer);
      }
    });
  immediateConsumerStops.set(item.consumer, closing);
  return closing;
}

async function beginImmediateProviderStop(
  log: IKafkaConsumerLog
): Promise<boolean> {
  const monitoredConsumers = consumers.filter(shouldMonitorKafkaHealth);
  const results = await Promise.allSettled(
    monitoredConsumers.map((item) => closeConsumerImmediately(item))
  );

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      resetConsumerReconciliation(monitoredConsumers[index], true);
      return;
    }
    log.error(
      {
        err: result.reason,
        owner: getConsumerOwnerName(monitoredConsumers[index].consumer),
        ready: false,
      },
      'Kafka consumer immediate provider stop failed'
    );
  });
  return results.every((result) => result.status === 'fulfilled');
}

async function reconcileRequestedProviderState(
  requestedReady: boolean,
  log: IKafkaConsumerLog
): Promise<void> {
  if (requestedReady && !desiredProviderReady) {
    return;
  }

  if (appliedProviderReady !== requestedReady) {
    await applyProviderState(requestedReady, log);
  }

  while (appliedProviderReady !== desiredProviderReady) {
    await applyProviderState(desiredProviderReady, log);
  }
}

async function applyProviderState(
  ready: boolean,
  log: IKafkaConsumerLog
): Promise<void> {
  const monitoredConsumers = consumers.filter(shouldMonitorKafkaHealth);
  const results = await Promise.allSettled(
    monitoredConsumers.map(async (item) => {
      if (ready) {
        try {
          await item.consumer.execute?.();
        } catch (error) {
          if (!desiredProviderReady) {
            await closeConsumerImmediately(item);
            return;
          }
          throw error;
        }

        if (!consumers.includes(item)) {
          await closeConsumerImmediately(item);
          return;
        }

        if (!desiredProviderReady) {
          await closeConsumerImmediately(item);
          return;
        }
        item.registeredAt = Date.now();
        resetConsumerReconciliation(item, true);
        return;
      }
      await closeConsumerImmediately(item);
      resetConsumerReconciliation(item, true);
    })
  );

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      return;
    }
    log.error(
      {
        err: result.reason,
        owner: getConsumerOwnerName(monitoredConsumers[index].consumer),
        ready,
      },
      'Kafka consumer provider lifecycle transition failed'
    );
  });

  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  if (failures.length > 0) {
    if (ready) {
      const rollbackResults = await Promise.allSettled(
        monitoredConsumers.map((item) => closeConsumerImmediately(item))
      );
      const rollbackFailed = rollbackResults.some(
        (result) => result.status === 'rejected'
      );
      appliedProviderReady = rollbackFailed ? null : false;
      rollbackResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          return;
        }
        log.error(
          {
            err: result.reason,
            owner: getConsumerOwnerName(monitoredConsumers[index].consumer),
          },
          'Kafka consumer provider lifecycle rollback failed'
        );
      });
    } else {
      appliedProviderReady = null;
    }

    throw new Error(
      `Kafka consumer provider lifecycle transition failed for ${failures.length} consumer(s)`
    );
  }

  const providerStateApplied = ready && desiredProviderReady;
  appliedProviderReady = providerStateApplied;
  const healthSummary = getKafkaConsumerHealthSummary();
  const consumersReady =
    providerStateApplied && areKafkaConsumersReady(healthSummary);
  log.warn(
    {
      ready: consumersReady,
      provider_state_applied: providerStateApplied,
      consumer_count: monitoredConsumers.length,
      expected_consumer_count: healthSummary.expected,
      active_consumer_count: healthSummary.active,
      missing_consumer_count: healthSummary.missing,
      unhealthy_consumer_count: healthSummary.unhealthy,
    },
    consumersReady
      ? 'Kafka consumers restarted after provider became ready'
      : providerStateApplied
        ? 'Kafka provider ready; consumers are still registering or assigning'
        : 'Kafka consumers stopped while provider is unavailable'
  );
}

export function reconcileKafkaConsumers(
  log: IKafkaConsumerLog,
  trigger = 'manual'
): Promise<void> {
  if (supervisorQueued) {
    return providerTransition;
  }

  supervisorQueued = true;
  const run = async (): Promise<void> => {
    try {
      if (!desiredProviderReady || !appliedProviderReady) {
        return;
      }
      await restartNonReadyConsumers(log, trigger);
    } catch (err) {
      log.error(
        { err, trigger },
        'Kafka consumer supervisor transition failed'
      );
    } finally {
      supervisorQueued = false;
    }
  };
  providerTransition = providerTransition.then(run, run);
  return providerTransition;
}

async function restartNonReadyConsumers(
  log: IKafkaConsumerLog,
  trigger: string
): Promise<void> {
  if (!desiredProviderReady || !appliedProviderReady) {
    return;
  }
  for (const item of consumers.filter(shouldMonitorKafkaHealth)) {
    if (!desiredProviderReady || !appliedProviderReady) {
      return;
    }
    if (!consumers.includes(item)) {
      continue;
    }
    const consumer = item.consumer;
    const snapshot = getRegisteredConsumerHealthSnapshot(item);
    const readinessIssue = observeConsumerReadiness(item, snapshot);
    if (!readinessIssue) {
      continue;
    }
    if (snapshot.pod_replacement_required === true) {
      /*
       * A timed-out native disconnect may still be heartbeating inside
       * librdkafka. Starting another managed generation in the same process
       * would leak members and could leave partitions assigned to a ghost.
       * Keep the owner fenced; /health/check makes Docker replace the process.
       */
      log.error(
        {
          owner: snapshot.owner,
          group_id: snapshot.group_id,
          topics: snapshot.topics,
          pod_replacement_reason: snapshot.pod_replacement_reason,
          reconciliation_trigger: trigger,
        },
        'Kafka native consumer requires worker process replacement'
      );
      continue;
    }

    const now = Date.now();
    const readinessIssueAgeMs = Math.max(
      0,
      now - (item.readinessIssueSince ?? now)
    );
    const graceElapsed =
      snapshot.unhealthy === true || readinessIssueAgeMs >= REBALANCE_GRACE_MS;
    if (!graceElapsed || now < item.nextReconciliationAt) {
      continue;
    }

    const reconciliationAttempt = item.reconciliationAttempt + 1;
    const retryInMs = getReconciliationBackoffMs(reconciliationAttempt);
    try {
      if (!consumers.includes(item)) {
        continue;
      }
      log.warn(
        {
          owner: snapshot.owner,
          group_id: snapshot.group_id,
          topics: snapshot.topics,
          stall_reason: snapshot.stall_reason,
          restart_count: snapshot.restart_count,
          readiness_issue: readinessIssue,
          readiness_issue_age_ms: readinessIssueAgeMs,
          reconciliation_attempt: reconciliationAttempt,
          reconciliation_trigger: trigger,
          retry_in_ms: retryInMs,
        },
        'Kafka consumer supervisor reconciling non-ready owner'
      );

      if (consumer.restart) {
        await consumer.restart();
        if (!consumers.includes(item)) {
          await closeConsumerImmediately(item);
          continue;
        }
        if (!desiredProviderReady) {
          await closeConsumerImmediately(item);
          return;
        }
      } else {
        if (consumer.close) {
          await closeConsumerImmediately(item);
        } else {
          forceResetConsumerOwner(consumer);
        }
        if (!desiredProviderReady) {
          return;
        }
        if (!consumers.includes(item)) {
          continue;
        }
        await consumer.execute?.();
        if (!consumers.includes(item)) {
          await closeConsumerImmediately(item);
          continue;
        }
        if (!desiredProviderReady) {
          await closeConsumerImmediately(item);
          return;
        }
      }
      item.registeredAt = Date.now();
      item.hasObservedReady = false;
    } catch (err) {
      log.error(
        {
          err,
          owner: snapshot.owner,
          group_id: snapshot.group_id,
          topics: snapshot.topics,
          readiness_issue: readinessIssue,
          reconciliation_attempt: reconciliationAttempt,
          reconciliation_trigger: trigger,
          retry_in_ms: retryInMs,
        },
        'Kafka consumer supervisor failed to restart owner'
      );
    } finally {
      item.reconciliationAttempt = reconciliationAttempt;
      item.nextReconciliationAt = Date.now() + retryInMs;
    }
  }
}

function getRegisteredConsumerHealthSnapshot(
  item: IRegisteredWorkerConsumer
): IKafkaConsumerOwnerHealthSnapshot {
  const snapshot = getConsumerOwnerKafkaHealthSnapshot(item.consumer);
  if (snapshot) {
    return {
      ...snapshot,
      registered_at: item.registeredAt,
    };
  }

  return buildMissingKafkaConsumerHealthSnapshot({
    owner: getConsumerOwnerName(item.consumer),
    registeredAt: item.registeredAt,
    graceMs: MISSING_SNAPSHOT_GRACE_MS,
  });
}

function observeConsumerReadiness(
  item: IRegisteredWorkerConsumer,
  snapshot: IKafkaConsumerOwnerHealthSnapshot
): string | null {
  const readinessIssue = getKafkaConsumerReadinessIssue(snapshot);
  if (!readinessIssue) {
    item.hasObservedReady = true;
    resetConsumerReconciliation(item);
    return null;
  }

  if (item.readinessIssueSince === null) {
    item.readinessIssueSince = item.hasObservedReady
      ? Date.now()
      : Math.min(item.registeredAt, Date.now());
  }
  return readinessIssue;
}

function getKafkaConsumerReadinessIssue(
  snapshot: IKafkaConsumerOwnerHealthSnapshot
): string | null {
  if (snapshot.missing === true) {
    return 'missing_consumer_health_snapshot';
  }
  if (snapshot.unhealthy === true) {
    return snapshot.stall_reason || 'consumer_unhealthy';
  }
  if (snapshot.connected !== true) {
    return 'consumer_disconnected';
  }
  if (snapshot.consuming !== true) {
    return 'consumer_not_consuming';
  }
  if (snapshot.assignments_ready !== true) {
    return 'assignments_not_ready';
  }
  if (!isWorkerCommandIngressIdentity(snapshot)) {
    return 'worker_command_ingress_identity_invalid';
  }
  return null;
}

function resetConsumerReconciliation(
  item: IRegisteredWorkerConsumer,
  resetReadinessObservation = false
): void {
  item.readinessIssueSince = null;
  item.reconciliationAttempt = 0;
  item.nextReconciliationAt = 0;
  if (resetReadinessObservation) {
    item.hasObservedReady = false;
  }
}

function getReconciliationBackoffMs(attempt: number): number {
  const exponent = Math.min(30, Math.max(0, attempt - 1));
  const backoffMs = Math.min(
    RECONCILE_BACKOFF_MAX_MS,
    RECONCILE_BACKOFF_BASE_MS * 2 ** exponent
  );
  const jitterMultiplier = 1 + (Math.random() * 2 - 1) * RECONCILE_JITTER_RATIO;
  return Math.max(
    1000,
    Math.min(RECONCILE_BACKOFF_MAX_MS, Math.round(backoffMs * jitterMultiplier))
  );
}

function shouldMonitorKafkaHealth(item: IRegisteredWorkerConsumer): boolean {
  return item.monitorKafkaHealth;
}

function forceResetConsumerOwner(consumer: IWorkerConsumer): void {
  const owner = consumer as IWorkerConsumer & Record<string, unknown>;
  const kafkaConsumer = owner.consumer as
    | { unsubscribe?: () => void; disconnect?: (cb?: () => void) => void }
    | null
    | undefined;

  try {
    kafkaConsumer?.unsubscribe?.();
  } catch {}
  try {
    kafkaConsumer?.disconnect?.(() => {});
  } catch {}

  owner.consumer = null;
  owner.isRunning = false;
  clearMap(owner.lastMessageTypeByChatId);
}

function clearMap(value: unknown): void {
  if (value instanceof Map) {
    value.clear();
  }
}
