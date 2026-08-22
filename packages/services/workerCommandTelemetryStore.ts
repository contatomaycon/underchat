import { WORKER_COMMAND_TYPES } from '@core/common/constants/workerCommandTransport';
import type { WorkerCommandType } from '@core/common/interfaces/IWorkerCommandEnvelope';

export const WORKER_COMMAND_PUBLISH_OUTCOMES = [
  'accepted',
  'duplicate',
  'unknown',
  'rejected',
  'contract_rejected',
  'publisher_closed',
] as const;

export const WORKER_COMMAND_DEFERRED_OUTCOMES = [
  'received',
  'relayed',
  'terminal_failure',
  'technical_retry',
] as const;

export type WorkerCommandPublishOutcome =
  (typeof WORKER_COMMAND_PUBLISH_OUTCOMES)[number];
export type WorkerCommandDeferredOutcome =
  (typeof WORKER_COMMAND_DEFERRED_OUTCOMES)[number];

const PUBACK_LATENCY_BUCKETS_MS = [
  10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000,
] as const;

interface MutableLatencyHistogram {
  count: number;
  sum_ms: number;
  max_ms: number;
  buckets: Record<string, number>;
}

export interface WorkerCommandLatencyHistogramSnapshot {
  readonly count: number;
  readonly sum_ms: number;
  readonly max_ms: number;
  /** Cumulative upper-bound buckets, suitable for Prometheus/OTLP conversion. */
  readonly buckets: Readonly<Record<string, number>>;
}

export interface WorkerCommandTelemetrySnapshot {
  readonly publish: {
    readonly outcomes: Readonly<Record<WorkerCommandPublishOutcome, number>>;
    readonly by_command_type: Readonly<
      Record<
        WorkerCommandType,
        Readonly<Record<WorkerCommandPublishOutcome, number>>
      >
    >;
    readonly public_retry_requests: number;
    readonly technical_retries: number;
    readonly puback_latency_ms: WorkerCommandLatencyHistogramSnapshot;
  };
  readonly deferred: Readonly<Record<WorkerCommandDeferredOutcome, number>>;
  readonly gauges: {
    readonly admission_identities: number | null;
    readonly deadline_records: number | null;
    readonly sample_errors: number;
    readonly observed_at: string | null;
  };
  readonly last_activity_at: string | null;
}

export interface WorkerCommandTelemetryStore {
  recordPublishRequest(publicRetry: boolean): void;
  recordPublishOutcome(
    commandType: WorkerCommandType,
    outcome: WorkerCommandPublishOutcome
  ): void;
  recordPublishTechnicalRetry(): void;
  recordPubAckLatency(durationMs: number): void;
  recordDeferred(outcome: WorkerCommandDeferredOutcome): void;
  setRedisGauges(input: {
    admissionIdentities: number;
    deadlineRecords: number;
  }): void;
  recordRedisGaugeError(): void;
  snapshot(): WorkerCommandTelemetrySnapshot;
  flushActivity(): WorkerCommandTelemetrySnapshot | null;
}

const createCounterRecord = <TKey extends string>(
  keys: readonly TKey[]
): Record<TKey, number> =>
  Object.fromEntries(keys.map((key) => [key, 0])) as Record<TKey, number>;

const createHistogram = (): MutableLatencyHistogram => ({
  count: 0,
  sum_ms: 0,
  max_ms: 0,
  buckets: Object.fromEntries(
    [...PUBACK_LATENCY_BUCKETS_MS.map(String), '+Inf'].map((key) => [key, 0])
  ),
});

const copyHistogram = (
  histogram: MutableLatencyHistogram
): WorkerCommandLatencyHistogramSnapshot => ({
  count: histogram.count,
  sum_ms: histogram.sum_ms,
  max_ms: histogram.max_ms,
  buckets: { ...histogram.buckets },
});

/**
 * Process-local, low-cardinality command-plane telemetry. Dynamic worker,
 * account, chat and operation identifiers are deliberately excluded. The
 * snapshot can be exposed by health and converted to Prometheus/OTLP without
 * creating unbounded label sets.
 */
export const createWorkerCommandTelemetryStore =
  (): WorkerCommandTelemetryStore => {
    let publishOutcomes = createCounterRecord(WORKER_COMMAND_PUBLISH_OUTCOMES);
    let publishByCommandType = Object.fromEntries(
      WORKER_COMMAND_TYPES.map((commandType) => [
        commandType,
        createCounterRecord(WORKER_COMMAND_PUBLISH_OUTCOMES),
      ])
    ) as Record<WorkerCommandType, Record<WorkerCommandPublishOutcome, number>>;
    let publicRetryRequests = 0;
    let technicalRetries = 0;
    let latency = createHistogram();
    let deferred = createCounterRecord(WORKER_COMMAND_DEFERRED_OUTCOMES);
    let admissionIdentities: number | null = null;
    let deadlineRecords: number | null = null;
    let gaugeSampleErrors = 0;
    let gaugeObservedAt: string | null = null;
    let lastActivityAt: string | null = null;

    const touch = (): void => {
      lastActivityAt = new Date().toISOString();
    };

    const snapshot = (): WorkerCommandTelemetrySnapshot => ({
      publish: {
        outcomes: { ...publishOutcomes },
        by_command_type: Object.fromEntries(
          WORKER_COMMAND_TYPES.map((commandType) => [
            commandType,
            { ...publishByCommandType[commandType] },
          ])
        ) as Record<
          WorkerCommandType,
          Record<WorkerCommandPublishOutcome, number>
        >,
        public_retry_requests: publicRetryRequests,
        technical_retries: technicalRetries,
        puback_latency_ms: copyHistogram(latency),
      },
      deferred: { ...deferred },
      gauges: {
        admission_identities: admissionIdentities,
        deadline_records: deadlineRecords,
        sample_errors: gaugeSampleErrors,
        observed_at: gaugeObservedAt,
      },
      last_activity_at: lastActivityAt,
    });

    const hasActivity = (): boolean =>
      publicRetryRequests > 0 ||
      technicalRetries > 0 ||
      latency.count > 0 ||
      Object.values(publishOutcomes).some((count) => count > 0) ||
      Object.values(deferred).some((count) => count > 0);

    return {
      recordPublishRequest: (publicRetry): void => {
        if (publicRetry) publicRetryRequests += 1;
        touch();
      },
      recordPublishOutcome: (commandType, outcome): void => {
        publishOutcomes[outcome] += 1;
        publishByCommandType[commandType][outcome] += 1;
        touch();
      },
      recordPublishTechnicalRetry: (): void => {
        technicalRetries += 1;
        touch();
      },
      recordPubAckLatency: (durationMs): void => {
        const safeDuration = Number.isFinite(durationMs)
          ? Math.max(0, Math.round(durationMs))
          : 0;
        latency.count += 1;
        latency.sum_ms += safeDuration;
        latency.max_ms = Math.max(latency.max_ms, safeDuration);
        for (const upperBound of PUBACK_LATENCY_BUCKETS_MS) {
          if (safeDuration <= upperBound)
            latency.buckets[String(upperBound)] += 1;
        }
        latency.buckets['+Inf'] += 1;
        touch();
      },
      recordDeferred: (outcome): void => {
        deferred[outcome] += 1;
        touch();
      },
      setRedisGauges: (input): void => {
        admissionIdentities = input.admissionIdentities;
        deadlineRecords = input.deadlineRecords;
        gaugeObservedAt = new Date().toISOString();
        touch();
      },
      recordRedisGaugeError: (): void => {
        gaugeSampleErrors += 1;
        touch();
      },
      snapshot,
      flushActivity: (): WorkerCommandTelemetrySnapshot | null => {
        if (!hasActivity()) return null;
        const current = snapshot();
        publishOutcomes = createCounterRecord(WORKER_COMMAND_PUBLISH_OUTCOMES);
        publishByCommandType = Object.fromEntries(
          WORKER_COMMAND_TYPES.map((commandType) => [
            commandType,
            createCounterRecord(WORKER_COMMAND_PUBLISH_OUTCOMES),
          ])
        ) as Record<
          WorkerCommandType,
          Record<WorkerCommandPublishOutcome, number>
        >;
        publicRetryRequests = 0;
        technicalRetries = 0;
        latency = createHistogram();
        deferred = createCounterRecord(WORKER_COMMAND_DEFERRED_OUTCOMES);
        return current;
      },
    };
  };

export const workerCommandTelemetryStore = createWorkerCommandTelemetryStore();
