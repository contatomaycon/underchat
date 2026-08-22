const MINUTE_MS = 60_000;

const DEFAULT_SLOT_WAIT_MS = 2 * MINUTE_MS;
const DEFAULT_SLOT_MAX_HOLD_MS = 5 * MINUTE_MS;
const DEFAULT_RECREATE_CONNECTION_CONFIRMATION_WAIT_MS = MINUTE_MS;
const DEFAULT_SESSION_STORAGE_MIGRATION_CONNECTION_CONFIRMATION_WAIT_MS =
  4 * MINUTE_MS;
const DEFAULT_SESSION_STORAGE_MIGRATION_ATTEMPT_MS = 9 * MINUTE_MS;
const DEFAULT_PROVIDER_HANDOFF_CONNECTION_CONFIRMATION_WAIT_MS = 5 * MINUTE_MS;
const PROVIDER_HANDOFF_STARTUP_GRACE_MS = 3 * MINUTE_MS;
const LIFECYCLE_GRPC_GRACE_MS = MINUTE_MS;
const LIFECYCLE_PENDING_WATCHDOG_GRACE_MS = MINUTE_MS;

export const WORKER_RECREATE_SERVER_SLOT_HOLD_TIMEOUT_ERROR_NAME =
  'WorkerRecreateServerSlotHoldTimeoutError';

export interface IWorkerLifecycleBudgets {
  slotWaitMs: number;
  slotMaxHoldMs: number;
  recreateConnectionConfirmationWaitMs: number;
  sessionStorageMigrationConnectionConfirmationWaitMs: number;
  sessionStorageMigrationAttemptMs: number;
  providerHandoffConnectionConfirmationWaitMs: number;
  grpcDeadlineMs: number;
  pendingWatchdogMs: number;
}

type WorkerLifecycleBudgetEnvironment = Record<string, string | undefined>;

function readPositiveInteger(
  environment: WorkerLifecycleBudgetEnvironment,
  name: string,
  fallback: number,
  minimum = 1
): number {
  const parsed = Number(environment[name]);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.max(minimum, parsed);
}

function safeBudgetSum(...values: number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number.isSafeInteger(total) ? total : Number.MAX_SAFE_INTEGER;
}

/**
 * Lifecycle timeouts form one ordered budget. Every environment override is
 * optional, while the derived floors prevent a shorter outer deadline from
 * interrupting an operation that is still legitimately inside an inner wait.
 */
export function resolveWorkerLifecycleBudgets(
  environment: WorkerLifecycleBudgetEnvironment = process.env
): IWorkerLifecycleBudgets {
  const recreateConnectionConfirmationWaitMs = readPositiveInteger(
    environment,
    'WORKER_RECREATE_CONNECTION_CONFIRMATION_WAIT_MS',
    DEFAULT_RECREATE_CONNECTION_CONFIRMATION_WAIT_MS,
    10_000
  );
  const sessionStorageMigrationConnectionConfirmationWaitMs = Math.max(
    recreateConnectionConfirmationWaitMs,
    readPositiveInteger(
      environment,
      'WORKER_SESSION_STORAGE_MIGRATION_CONNECTION_CONFIRMATION_WAIT_MS',
      DEFAULT_SESSION_STORAGE_MIGRATION_CONNECTION_CONFIRMATION_WAIT_MS,
      10_000
    )
  );
  const sessionStorageMigrationAttemptMs = Math.max(
    safeBudgetSum(
      // A protected volume -> PostgreSQL attempt performs two independent
      // lifecycle boots: the import/validation runtime and the final runtime
      // detached from the rollback volume. Each boot may legitimately consume
      // the full connection-confirmation window.
      sessionStorageMigrationConnectionConfirmationWaitMs,
      sessionStorageMigrationConnectionConfirmationWaitMs,
      MINUTE_MS
    ),
    readPositiveInteger(
      environment,
      'WORKER_SESSION_STORAGE_MIGRATION_ATTEMPT_MS',
      DEFAULT_SESSION_STORAGE_MIGRATION_ATTEMPT_MS,
      MINUTE_MS
    )
  );
  const providerHandoffConnectionConfirmationWaitMs = Math.max(
    recreateConnectionConfirmationWaitMs,
    readPositiveInteger(
      environment,
      'WORKER_PROVIDER_HANDOFF_CONNECTION_CONFIRMATION_WAIT_MS',
      DEFAULT_PROVIDER_HANDOFF_CONNECTION_CONFIRMATION_WAIT_MS,
      10_000
    )
  );
  const slotWaitMs = readPositiveInteger(
    environment,
    'WORKER_RECREATE_SERVER_SLOT_WAIT_MS',
    DEFAULT_SLOT_WAIT_MS,
    MINUTE_MS
  );
  const minimumSlotMaxHoldMs = Math.max(
    sessionStorageMigrationAttemptMs,
    safeBudgetSum(
      Math.max(
        providerHandoffConnectionConfirmationWaitMs,
        sessionStorageMigrationConnectionConfirmationWaitMs
      ),
      PROVIDER_HANDOFF_STARTUP_GRACE_MS
    )
  );
  const slotMaxHoldMs = Math.max(
    minimumSlotMaxHoldMs,
    readPositiveInteger(
      environment,
      'WORKER_RECREATE_SERVER_SLOT_MAX_HOLD_MS',
      DEFAULT_SLOT_MAX_HOLD_MS,
      MINUTE_MS
    )
  );
  const minimumGrpcDeadlineMs = safeBudgetSum(
    slotWaitMs,
    slotMaxHoldMs,
    LIFECYCLE_GRPC_GRACE_MS
  );
  const grpcDeadlineMs = Math.max(
    minimumGrpcDeadlineMs,
    readPositiveInteger(
      environment,
      'WORKER_LIFECYCLE_GRPC_DEADLINE_MS',
      minimumGrpcDeadlineMs
    )
  );
  const minimumPendingWatchdogMs = safeBudgetSum(
    grpcDeadlineMs,
    LIFECYCLE_PENDING_WATCHDOG_GRACE_MS
  );
  const pendingWatchdogMs = Math.max(
    minimumPendingWatchdogMs,
    readPositiveInteger(
      environment,
      'KAFKA_WORKER_LIFECYCLE_STALL_MS',
      minimumPendingWatchdogMs
    )
  );

  return {
    slotWaitMs,
    slotMaxHoldMs,
    recreateConnectionConfirmationWaitMs,
    sessionStorageMigrationConnectionConfirmationWaitMs,
    sessionStorageMigrationAttemptMs,
    providerHandoffConnectionConfirmationWaitMs,
    grpcDeadlineMs,
    pendingWatchdogMs,
  };
}

export const workerLifecycleBudgets = resolveWorkerLifecycleBudgets();

export function isWorkerRecreateServerSlotHoldTimeoutError(
  error: unknown
): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as {
    name?: unknown;
    message?: unknown;
    details?: unknown;
  };
  return (
    candidate.name === WORKER_RECREATE_SERVER_SLOT_HOLD_TIMEOUT_ERROR_NAME ||
    (typeof candidate.message === 'string' &&
      candidate.message.startsWith(
        'Timed out holding recreate slot on server'
      )) ||
    (typeof candidate.details === 'string' &&
      candidate.details.startsWith('Timed out holding recreate slot on server'))
  );
}

export function isWorkerLifecycleBudgetExhaustionError(
  error: unknown
): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const rawCode = (error as { code?: unknown }).code;
  const code =
    typeof rawCode === 'number'
      ? rawCode
      : typeof rawCode === 'string' && rawCode.trim()
        ? Number(rawCode)
        : Number.NaN;

  // @grpc/grpc-js status.DEADLINE_EXCEEDED
  return code === 4 || isWorkerRecreateServerSlotHoldTimeoutError(error);
}
