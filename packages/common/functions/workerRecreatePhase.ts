import { EWorkerStatus } from '../enums/EWorkerStatus';
import { EWorkerRecreatePhase } from '../enums/EWorkerRecreatePhase';

const DOCKER_CONTAINER_ID_PATTERN = /^[0-9a-f]{12,64}$/u;
const UUID_RFC_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface WorkerRecreatePhaseProjectionInput {
  workerStatusId?: unknown;
  lifecycleOperationId?: unknown;
  workerContainerId?: unknown;
  runtimeContainerId?: unknown;
  runtimeGeneration?: unknown;
  bootstrapOperationId?: unknown;
  bootstrapRuntimeGeneration?: unknown;
  bootstrapContainerId?: unknown;
  bootstrapStartedAt?: unknown;
  retiredOperationId?: unknown;
  retiredRuntimeGeneration?: unknown;
  retiredContainerId?: unknown;
  retiredAt?: unknown;
}

export interface WorkerRecreatePhaseProjection {
  phase: EWorkerRecreatePhase;
  observedAt?: string;
  /** Exact durable tombstone for this operation/runtime tuple. */
  runtimeRetired: boolean;
}

function normalizeContainerId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return DOCKER_CONTAINER_ID_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : undefined;
}

function normalizeUuid(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return UUID_RFC_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizeGeneration(value: unknown): number | undefined {
  const generation = Number(value);
  return Number.isSafeInteger(generation) && generation > 0
    ? generation
    : undefined;
}

/**
 * Projects the customer-visible phase of a durable recreate without changing
 * the worker status used by lifecycle and SQL fences.
 *
 * The manager owns the bootstrap marker and writes it only after Docker starts
 * the exact cold target or a warm runtime acknowledges activation. Every part
 * of the durable marker must match the current operation and runtime identity;
 * stale, partial, retired and recovery pointers therefore fail closed.
 */
export function projectWorkerRecreatePhaseProjection(
  input: WorkerRecreatePhaseProjectionInput
): WorkerRecreatePhaseProjection | undefined {
  if (
    (input.workerStatusId !== EWorkerStatus.recreating &&
      input.workerStatusId !== EWorkerStatus.online) ||
    !normalizeUuid(input.lifecycleOperationId)
  ) {
    return undefined;
  }

  const lifecycleOperationId = normalizeUuid(input.lifecycleOperationId);
  const runtimeContainerId = normalizeContainerId(input.runtimeContainerId);
  const runtimeGeneration = normalizeGeneration(input.runtimeGeneration);
  const bootstrapOperationId = normalizeUuid(input.bootstrapOperationId);
  const bootstrapRuntimeGeneration = normalizeGeneration(
    input.bootstrapRuntimeGeneration
  );
  const bootstrapContainerId = normalizeContainerId(input.bootstrapContainerId);
  const bootstrapStartedAt = normalizeTimestamp(input.bootstrapStartedAt);
  const retiredOperationId = normalizeUuid(input.retiredOperationId);
  const retiredRuntimeGeneration = normalizeGeneration(
    input.retiredRuntimeGeneration
  );
  const retiredContainerId = normalizeContainerId(input.retiredContainerId);
  const retiredAt = normalizeTimestamp(input.retiredAt);
  const exactRetiredRuntime = Boolean(
    runtimeContainerId &&
    runtimeGeneration &&
    lifecycleOperationId &&
    retiredOperationId === lifecycleOperationId &&
    retiredRuntimeGeneration === runtimeGeneration &&
    retiredContainerId === runtimeContainerId &&
    retiredAt
  );
  const exactBootstrap = Boolean(
    runtimeContainerId &&
    runtimeGeneration &&
    lifecycleOperationId &&
    bootstrapOperationId === lifecycleOperationId &&
    bootstrapRuntimeGeneration === runtimeGeneration &&
    bootstrapContainerId === runtimeContainerId &&
    bootstrapStartedAt
  );

  // Retirement is irreversible for this exact operation/runtime tuple. It
  // deliberately wins even if corrupt legacy data happens to retain both
  // complete markers; the UI must never reopen a retired writer as connecting.
  if (exactRetiredRuntime) {
    return {
      phase: EWorkerRecreatePhase.recreating,
      observedAt: retiredAt,
      runtimeRetired: true,
    };
  }
  if (exactBootstrap) {
    return {
      phase: EWorkerRecreatePhase.connecting,
      observedAt: bootstrapStartedAt,
      runtimeRetired: false,
    };
  }
  return {
    phase: EWorkerRecreatePhase.recreating,
    runtimeRetired: false,
  };
}

export function projectWorkerRecreatePhase(
  input: WorkerRecreatePhaseProjectionInput
): EWorkerRecreatePhase | undefined {
  return projectWorkerRecreatePhaseProjection(input)?.phase;
}
