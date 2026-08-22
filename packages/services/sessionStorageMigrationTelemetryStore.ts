import type {
  WhatsappSessionStorageMigrationState,
  WorkerWhatsappSessionProvider,
} from '@core/models';

export const SESSION_STORAGE_MIGRATION_PROVIDERS = [
  'baileys',
  'wwebjs',
  'whatsmeow',
] as const satisfies readonly WorkerWhatsappSessionProvider[];

export const SESSION_STORAGE_MIGRATION_STATES = [
  'queued',
  'capturing',
  'staged',
  'cutting_over',
  'starting',
  'validating',
  'retry_wait',
  'restoring',
  'recovery_required',
  'restored',
  'cleanup_pending',
  'deleting_volume',
  'completed',
] as const satisfies readonly WhatsappSessionStorageMigrationState[];

const DURATION_BUCKETS_MS = [
  1_000, 5_000, 30_000, 60_000, 300_000, 600_000,
] as const;

type Attempt = '1' | '2' | '3';
type CleanupOutcome = 'succeeded' | 'failed';

interface MutableHistogram {
  count: number;
  sum_ms: number;
  max_ms: number;
  buckets: Record<string, number>;
}

export interface SessionStorageMigrationTelemetrySnapshot {
  readonly transitions: Readonly<
    Record<
      WorkerWhatsappSessionProvider,
      Readonly<Record<WhatsappSessionStorageMigrationState, number>>
    >
  >;
  readonly attempts: Readonly<
    Record<WorkerWhatsappSessionProvider, Readonly<Record<Attempt, number>>>
  >;
  readonly failures: Readonly<
    Record<
      WorkerWhatsappSessionProvider,
      Readonly<Record<WhatsappSessionStorageMigrationState, number>>
    >
  >;
  readonly restorations: Readonly<
    Record<WorkerWhatsappSessionProvider, number>
  >;
  readonly cleanup: Readonly<
    Record<
      WorkerWhatsappSessionProvider,
      Readonly<Record<CleanupOutcome, number>>
    >
  >;
  readonly attempt_duration_ms: Readonly<
    Record<WorkerWhatsappSessionProvider, Readonly<MutableHistogram>>
  >;
  readonly last_activity_at: string | null;
}

const counter = <T extends string>(keys: readonly T[]): Record<T, number> =>
  Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;

const byProvider = <T>(
  factory: () => T
): Record<WorkerWhatsappSessionProvider, T> =>
  Object.fromEntries(
    SESSION_STORAGE_MIGRATION_PROVIDERS.map((provider) => [provider, factory()])
  ) as Record<WorkerWhatsappSessionProvider, T>;

const histogram = (): MutableHistogram => ({
  count: 0,
  sum_ms: 0,
  max_ms: 0,
  buckets: counter([...DURATION_BUCKETS_MS.map(String), '+Inf']),
});

/**
 * Process-local, low-cardinality migration metrics. Migration, worker,
 * account, phone and volume identifiers are deliberately excluded so this
 * snapshot can be exported to Prometheus/OTLP without unbounded label sets.
 */
export const createSessionStorageMigrationTelemetryStore = () => {
  const transitions = byProvider(() =>
    counter(SESSION_STORAGE_MIGRATION_STATES)
  );
  const attempts = byProvider(() => counter(['1', '2', '3'] as const));
  const failures = byProvider(() => counter(SESSION_STORAGE_MIGRATION_STATES));
  const restorations = counter(SESSION_STORAGE_MIGRATION_PROVIDERS);
  const cleanup = byProvider(() => counter(['succeeded', 'failed'] as const));
  const durations = byProvider(histogram);
  let lastActivityAt: string | null = null;

  const touch = () => {
    lastActivityAt = new Date().toISOString();
  };

  return {
    recordTransition: (
      provider: WorkerWhatsappSessionProvider,
      state: WhatsappSessionStorageMigrationState
    ) => {
      transitions[provider][state] += 1;
      touch();
    },
    recordAttempt: (
      provider: WorkerWhatsappSessionProvider,
      attempt: number
    ) => {
      if (attempt >= 1 && attempt <= 3) {
        attempts[provider][String(attempt) as Attempt] += 1;
        touch();
      }
    },
    recordFailure: (
      provider: WorkerWhatsappSessionProvider,
      state: WhatsappSessionStorageMigrationState
    ) => {
      failures[provider][state] += 1;
      touch();
    },
    recordAttemptDuration: (
      provider: WorkerWhatsappSessionProvider,
      durationMs: number
    ) => {
      const safe = Number.isFinite(durationMs)
        ? Math.max(0, Math.round(durationMs))
        : 0;
      const target = durations[provider];
      target.count += 1;
      target.sum_ms += safe;
      target.max_ms = Math.max(target.max_ms, safe);
      for (const upperBound of DURATION_BUCKETS_MS) {
        if (safe <= upperBound) target.buckets[String(upperBound)] += 1;
      }
      target.buckets['+Inf'] += 1;
      touch();
    },
    recordRestoration: (provider: WorkerWhatsappSessionProvider) => {
      restorations[provider] += 1;
      touch();
    },
    recordCleanup: (
      provider: WorkerWhatsappSessionProvider,
      outcome: CleanupOutcome
    ) => {
      cleanup[provider][outcome] += 1;
      touch();
    },
    snapshot: (): SessionStorageMigrationTelemetrySnapshot => ({
      transitions: Object.fromEntries(
        SESSION_STORAGE_MIGRATION_PROVIDERS.map((provider) => [
          provider,
          { ...transitions[provider] },
        ])
      ) as SessionStorageMigrationTelemetrySnapshot['transitions'],
      attempts: Object.fromEntries(
        SESSION_STORAGE_MIGRATION_PROVIDERS.map((provider) => [
          provider,
          { ...attempts[provider] },
        ])
      ) as SessionStorageMigrationTelemetrySnapshot['attempts'],
      failures: Object.fromEntries(
        SESSION_STORAGE_MIGRATION_PROVIDERS.map((provider) => [
          provider,
          { ...failures[provider] },
        ])
      ) as SessionStorageMigrationTelemetrySnapshot['failures'],
      restorations: { ...restorations },
      cleanup: Object.fromEntries(
        SESSION_STORAGE_MIGRATION_PROVIDERS.map((provider) => [
          provider,
          { ...cleanup[provider] },
        ])
      ) as SessionStorageMigrationTelemetrySnapshot['cleanup'],
      attempt_duration_ms: Object.fromEntries(
        SESSION_STORAGE_MIGRATION_PROVIDERS.map((provider) => [
          provider,
          {
            ...durations[provider],
            buckets: { ...durations[provider].buckets },
          },
        ])
      ) as SessionStorageMigrationTelemetrySnapshot['attempt_duration_ms'],
      last_activity_at: lastActivityAt,
    }),
  };
};

export const sessionStorageMigrationTelemetryStore =
  createSessionStorageMigrationTelemetryStore();
