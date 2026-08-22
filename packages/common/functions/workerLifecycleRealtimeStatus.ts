import { EBaileysConnectionStatus } from '../enums/EBaileysConnectionStatus';
import { ECodeMessage } from '../enums/ECodeMessage';
import { EWorkerAction } from '../enums/EWorkerAction';
import { EWorkerStatus } from '../enums/EWorkerStatus';
import { IBaileysConnectionState } from '../interfaces/IBaileysConnectionState';
import { IWorkerPayload } from '../interfaces/IWorkerPayload';
import { EWorkerRecreatePhase } from '../enums/EWorkerRecreatePhase';
import { currentTime } from './currentTime';

const UUID_RFC_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function normalizeWorkerLifecycleOperationId(
  value: unknown
): string | undefined {
  if (typeof value !== 'string') return undefined;

  const operationId = value.trim().toLowerCase();
  return UUID_RFC_PATTERN.test(operationId) ? operationId : undefined;
}

export function isWorkerLifecycleOperationIdV7(value: unknown): boolean {
  const operationId = normalizeWorkerLifecycleOperationId(value);
  return Boolean(operationId && UUID_V7_PATTERN.test(operationId));
}

/**
 * Compares lifecycle ids only when doing so is safe. Equality is meaningful
 * for every RFC UUID; chronological ordering is meaningful only for UUIDv7.
 */
export function compareWorkerLifecycleOperationIds(
  left: unknown,
  right: unknown
): -1 | 0 | 1 | undefined {
  const normalizedLeft = normalizeWorkerLifecycleOperationId(left);
  const normalizedRight = normalizeWorkerLifecycleOperationId(right);
  if (!normalizedLeft || !normalizedRight) return undefined;
  if (normalizedLeft === normalizedRight) return 0;
  if (
    !isWorkerLifecycleOperationIdV7(normalizedLeft) ||
    !isWorkerLifecycleOperationIdV7(normalizedRight)
  ) {
    return undefined;
  }
  return normalizedLeft < normalizedRight ? -1 : 1;
}

export function normalizeWorkerLifecycleRuntimeGeneration(
  value: unknown
): number | undefined {
  const generation = Number(value);
  return Number.isSafeInteger(generation) && generation > 0
    ? generation
    : undefined;
}

export function normalizeConnectionStatusObservedAt(
  value: unknown
): string | undefined {
  if (typeof value !== 'string' || value.length > 64) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : undefined;
}

export type ManagerWorkerLifecycleStatusEvent = IBaileysConnectionState &
  IWorkerPayload & {
    event_type: 'status';
    lifecycle_source: 'manager';
    lifecycle_action: EWorkerAction.recreate;
    lifecycle_phase: 'started';
    worker_status_id: EWorkerStatus.recreating;
    lifecycle_operation_id: string;
  };

export type ManagerWorkerLifecycleCompletedStatusEvent =
  IBaileysConnectionState &
    IWorkerPayload & {
      event_type: 'status';
      lifecycle_source: 'manager';
      lifecycle_action: EWorkerAction.recreate;
      lifecycle_phase: 'completed';
      worker_status_id: EWorkerStatus.online | EWorkerStatus.disponible;
      lifecycle_operation_id: string;
      runtime_generation: number;
      connection_online_acknowledged: boolean;
      recreate_completed_operation_id: string;
      recreate_completed_runtime_generation: number;
      recreate_completed_at: string;
      reason?: 'liveness_runtime_recovered_before_recreate';
    };

export type ManagerWorkerRecreateRuntimeStartedStatusEvent =
  IBaileysConnectionState &
    IWorkerPayload & {
      event_type: 'status';
      lifecycle_source: 'manager';
      lifecycle_action: EWorkerAction.recreate;
      lifecycle_phase: 'runtime_started';
      worker_status_id: EWorkerStatus.recreating;
      lifecycle_operation_id: string;
      runtime_generation: number;
      recreate_phase: EWorkerRecreatePhase.connecting;
      recreate_phase_observed_at: string;
      recreate_runtime_retired: false;
      connection_online_acknowledged: false;
    };

export type ManagerWorkerRecreateRuntimeRetiredStatusEvent =
  IBaileysConnectionState &
    IWorkerPayload & {
      event_type: 'status';
      lifecycle_source: 'manager';
      lifecycle_action: EWorkerAction.recreate;
      lifecycle_phase: 'runtime_retired';
      worker_status_id: EWorkerStatus.recreating;
      lifecycle_operation_id: string;
      runtime_generation: number;
      recreate_phase: EWorkerRecreatePhase.recreating;
      recreate_phase_observed_at: string;
      recreate_runtime_retired: true;
      connection_online_acknowledged: false;
    };

export type ManagerWorkerLifecycleFenceResult =
  | {
      accepted: true;
      operationId: string;
      runtimeGeneration?: number;
    }
  | {
      accepted: false;
      reason:
        | 'invalid_manager_lifecycle_envelope'
        | 'worker_type_mismatch'
        | 'runtime_generation_unverifiable'
        | 'runtime_generation_mismatch'
        | 'stale_lifecycle_operation';
    };

export type ManagerWorkerLifecycleCompletionFenceResult =
  | {
      accepted: true;
      operationId: string;
      runtimeGeneration: number;
    }
  | {
      accepted: false;
      reason:
        | 'invalid_manager_lifecycle_completion_envelope'
        | 'worker_type_mismatch'
        | 'runtime_generation_unverifiable'
        | 'runtime_generation_mismatch'
        | 'lifecycle_operation_unverifiable'
        | 'lifecycle_operation_mismatch';
    };

/**
 * Builds the manager-owned lifecycle notification emitted only after the
 * worker row has been fenced and the durable lifecycle command was queued.
 * It intentionally carries no provider/native connection projection.
 */
export function buildManagerWorkerRecreatingStatusEvent(
  payload: IWorkerPayload,
  runtimeGeneration?: number | null
): ManagerWorkerLifecycleStatusEvent {
  const normalizedRuntimeGeneration =
    normalizeWorkerLifecycleRuntimeGeneration(runtimeGeneration);

  return {
    action: EWorkerAction.recreate,
    worker_id: payload.worker_id,
    account_id: payload.account_id,
    server_id: payload.server_id,
    worker_type_id: payload.worker_type_id,
    previous_worker_type_id: payload.previous_worker_type_id,
    previous_worker_status_id: payload.previous_worker_status_id,
    remove_session: payload.remove_session,
    remove_volume: payload.remove_volume,
    session_storage: payload.session_storage,
    lifecycle_operation_id: payload.lifecycle_operation_id,
    debug_trace_id: payload.debug_trace_id,
    event_type: 'status',
    lifecycle_source: 'manager',
    lifecycle_action: EWorkerAction.recreate,
    lifecycle_phase: 'started',
    status: EBaileysConnectionStatus.info,
    code: ECodeMessage.info,
    worker_status_id: EWorkerStatus.recreating,
    connection_status_observed_at: currentTime(),
    ...(normalizedRuntimeGeneration
      ? { runtime_generation: normalizedRuntimeGeneration }
      : {}),
  } as ManagerWorkerLifecycleStatusEvent;
}

/**
 * Emits the only same-generation recreate completion currently supported:
 * the manager revalidated the exact runtime through the provider's strict
 * health contract and atomically released the same durable operation fence.
 * It intentionally carries no unordered provider projection.
 */
export function buildManagerWorkerRecreateCompletedStatusEvent(
  payload: IWorkerPayload & {
    lifecycle_operation_id: string;
    worker_type_id: NonNullable<IWorkerPayload['worker_type_id']>;
  },
  runtimeGeneration: number,
  containerId: string,
  persistedCompletedAt: string
): ManagerWorkerLifecycleCompletedStatusEvent {
  const normalizedContainerId = containerId.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(normalizedContainerId)) {
    throw new TypeError('containerId must be a full immutable Docker ID');
  }
  const completedAt = normalizeConnectionStatusObservedAt(persistedCompletedAt);
  if (!completedAt) {
    throw new TypeError('persistedCompletedAt must be an ISO timestamp');
  }
  return {
    action: EWorkerAction.recreate,
    worker_id: payload.worker_id,
    account_id: payload.account_id,
    server_id: payload.server_id,
    worker_type_id: payload.worker_type_id,
    previous_worker_type_id: payload.previous_worker_type_id,
    lifecycle_operation_id: payload.lifecycle_operation_id,
    debug_trace_id: payload.debug_trace_id,
    event_type: 'status',
    lifecycle_source: 'manager',
    lifecycle_action: EWorkerAction.recreate,
    lifecycle_phase: 'completed',
    status: EBaileysConnectionStatus.info,
    code: ECodeMessage.info,
    worker_status_id: EWorkerStatus.online,
    runtime_generation: runtimeGeneration,
    reason: 'liveness_runtime_recovered_before_recreate',
    connection_online_acknowledged: true,
    connection_status_observed_at: completedAt,
    recreate_completed_operation_id: payload.lifecycle_operation_id,
    recreate_completed_runtime_generation: runtimeGeneration,
    recreate_completed_at: completedAt,
  } as ManagerWorkerLifecycleCompletedStatusEvent;
}

export function buildManagerWorkerRecreateRuntimeStartedStatusEvent(
  payload: IWorkerPayload & {
    lifecycle_operation_id: string;
    worker_type_id: NonNullable<IWorkerPayload['worker_type_id']>;
  },
  runtimeGeneration: number,
  persistedBootstrapStartedAt: string
): ManagerWorkerRecreateRuntimeStartedStatusEvent {
  const bootstrapStartedAt = normalizeConnectionStatusObservedAt(
    persistedBootstrapStartedAt
  );
  if (!bootstrapStartedAt) {
    throw new TypeError('persistedBootstrapStartedAt must be an ISO timestamp');
  }
  return {
    action: EWorkerAction.recreate,
    worker_id: payload.worker_id,
    account_id: payload.account_id,
    server_id: payload.server_id,
    worker_type_id: payload.worker_type_id,
    previous_worker_type_id: payload.previous_worker_type_id,
    lifecycle_operation_id: payload.lifecycle_operation_id,
    debug_trace_id: payload.debug_trace_id,
    event_type: 'status',
    lifecycle_source: 'manager',
    lifecycle_action: EWorkerAction.recreate,
    lifecycle_phase: 'runtime_started',
    status: EBaileysConnectionStatus.info,
    code: ECodeMessage.info,
    worker_status_id: EWorkerStatus.recreating,
    runtime_generation: runtimeGeneration,
    recreate_phase: EWorkerRecreatePhase.connecting,
    recreate_phase_observed_at: bootstrapStartedAt,
    recreate_runtime_retired: false,
    connection_online_acknowledged: false,
    connection_status_observed_at: bootstrapStartedAt,
  } as ManagerWorkerRecreateRuntimeStartedStatusEvent;
}

export function buildManagerWorkerRecreateRuntimeRetiredStatusEvent(
  payload: IWorkerPayload & {
    lifecycle_operation_id: string;
    worker_type_id: NonNullable<IWorkerPayload['worker_type_id']>;
  },
  runtimeGeneration: number,
  persistedRetiredAt: string
): ManagerWorkerRecreateRuntimeRetiredStatusEvent {
  const retiredAt = normalizeConnectionStatusObservedAt(persistedRetiredAt);
  if (!retiredAt) {
    throw new TypeError('persistedRetiredAt must be an ISO timestamp');
  }
  return {
    action: EWorkerAction.recreate,
    worker_id: payload.worker_id,
    account_id: payload.account_id,
    server_id: payload.server_id,
    worker_type_id: payload.worker_type_id,
    previous_worker_type_id: payload.previous_worker_type_id,
    lifecycle_operation_id: payload.lifecycle_operation_id,
    debug_trace_id: payload.debug_trace_id,
    event_type: 'status',
    lifecycle_source: 'manager',
    lifecycle_action: EWorkerAction.recreate,
    lifecycle_phase: 'runtime_retired',
    status: EBaileysConnectionStatus.info,
    code: ECodeMessage.info,
    worker_status_id: EWorkerStatus.recreating,
    runtime_generation: runtimeGeneration,
    recreate_phase: EWorkerRecreatePhase.recreating,
    recreate_phase_observed_at: retiredAt,
    recreate_runtime_retired: true,
    connection_online_acknowledged: false,
    connection_status_observed_at: retiredAt,
  } as ManagerWorkerRecreateRuntimeRetiredStatusEvent;
}

export function buildManagerWorkerRecreateTerminalStatusEvent(
  payload: IWorkerPayload & {
    lifecycle_operation_id: string;
    worker_type_id: NonNullable<IWorkerPayload['worker_type_id']>;
  },
  runtimeGeneration: number,
  workerStatusId: EWorkerStatus.online | EWorkerStatus.disponible,
  persistedCompletedAt: string
): ManagerWorkerLifecycleCompletedStatusEvent {
  const online = workerStatusId === EWorkerStatus.online;
  const completedAt = normalizeConnectionStatusObservedAt(persistedCompletedAt);
  if (!completedAt) {
    throw new TypeError('persistedCompletedAt must be an ISO timestamp');
  }
  return {
    action: EWorkerAction.recreate,
    worker_id: payload.worker_id,
    account_id: payload.account_id,
    server_id: payload.server_id,
    worker_type_id: payload.worker_type_id,
    previous_worker_type_id: payload.previous_worker_type_id,
    lifecycle_operation_id: payload.lifecycle_operation_id,
    debug_trace_id: payload.debug_trace_id,
    event_type: 'status',
    lifecycle_source: 'manager',
    lifecycle_action: EWorkerAction.recreate,
    lifecycle_phase: 'completed',
    status: online
      ? EBaileysConnectionStatus.connected
      : EBaileysConnectionStatus.info,
    code: online ? ECodeMessage.connectionEstablished : ECodeMessage.info,
    worker_status_id: workerStatusId,
    runtime_generation: runtimeGeneration,
    connection_online_acknowledged: online,
    connection_status_observed_at: completedAt,
    recreate_completed_operation_id: payload.lifecycle_operation_id,
    recreate_completed_runtime_generation: runtimeGeneration,
    recreate_completed_at: completedAt,
  } as ManagerWorkerLifecycleCompletedStatusEvent;
}

export function isManagerWorkerRecreatingStatusEvent(
  input: IBaileysConnectionState
): input is ManagerWorkerLifecycleStatusEvent {
  return Boolean(
    input.event_type === 'status' &&
    input.lifecycle_source === 'manager' &&
    input.lifecycle_action === EWorkerAction.recreate &&
    input.lifecycle_phase === 'started' &&
    input.worker_status_id === EWorkerStatus.recreating &&
    input.status === EBaileysConnectionStatus.info &&
    input.code === ECodeMessage.info &&
    input.worker_type_id &&
    normalizeWorkerLifecycleOperationId(input.lifecycle_operation_id) &&
    input.connection_status === undefined &&
    input.connection_status_source_id === undefined &&
    input.connection_status_order === undefined &&
    normalizeConnectionStatusObservedAt(input.connection_status_observed_at) !==
      undefined &&
    (input.runtime_generation === undefined ||
      normalizeWorkerLifecycleRuntimeGeneration(input.runtime_generation) !==
        undefined)
  );
}

export function isManagerWorkerRecreateCompletedStatusEvent(
  input: IBaileysConnectionState
): input is ManagerWorkerLifecycleCompletedStatusEvent {
  return Boolean(
    input.event_type === 'status' &&
    input.lifecycle_source === 'manager' &&
    input.lifecycle_action === EWorkerAction.recreate &&
    input.lifecycle_phase === 'completed' &&
    (input.worker_status_id === EWorkerStatus.online ||
      input.worker_status_id === EWorkerStatus.disponible) &&
    (input.status === EBaileysConnectionStatus.info ||
      input.status === EBaileysConnectionStatus.connected) &&
    (input.code === ECodeMessage.info ||
      input.code === ECodeMessage.connectionEstablished) &&
    (input.reason === undefined ||
      input.reason === 'liveness_runtime_recovered_before_recreate') &&
    input.worker_type_id &&
    normalizeWorkerLifecycleOperationId(input.lifecycle_operation_id) &&
    normalizeWorkerLifecycleRuntimeGeneration(input.runtime_generation) &&
    input.recreate_completed_operation_id === input.lifecycle_operation_id &&
    input.recreate_completed_runtime_generation === input.runtime_generation &&
    normalizeConnectionStatusObservedAt(input.recreate_completed_at) !==
      undefined &&
    input.connection_online_acknowledged ===
      (input.worker_status_id === EWorkerStatus.online) &&
    input.connection_status === undefined &&
    input.connection_status_source_id === undefined &&
    input.connection_status_order === undefined &&
    normalizeConnectionStatusObservedAt(input.connection_status_observed_at) !==
      undefined
  );
}

export function isManagerWorkerRecreateRuntimeStartedStatusEvent(
  input: IBaileysConnectionState
): input is ManagerWorkerRecreateRuntimeStartedStatusEvent {
  return Boolean(
    input.event_type === 'status' &&
    input.lifecycle_source === 'manager' &&
    input.lifecycle_action === EWorkerAction.recreate &&
    input.lifecycle_phase === 'runtime_started' &&
    input.worker_status_id === EWorkerStatus.recreating &&
    input.status === EBaileysConnectionStatus.info &&
    input.code === ECodeMessage.info &&
    input.worker_type_id &&
    normalizeWorkerLifecycleOperationId(input.lifecycle_operation_id) &&
    normalizeWorkerLifecycleRuntimeGeneration(input.runtime_generation) &&
    input.recreate_phase === EWorkerRecreatePhase.connecting &&
    input.recreate_runtime_retired === false &&
    normalizeConnectionStatusObservedAt(input.recreate_phase_observed_at) ===
      normalizeConnectionStatusObservedAt(
        input.connection_status_observed_at
      ) &&
    input.connection_online_acknowledged === false &&
    input.connection_status === undefined &&
    input.connection_status_source_id === undefined &&
    input.connection_status_order === undefined &&
    input.container_id === undefined &&
    normalizeConnectionStatusObservedAt(input.connection_status_observed_at) !==
      undefined
  );
}

export function isManagerWorkerRecreateRuntimeRetiredStatusEvent(
  input: IBaileysConnectionState
): input is ManagerWorkerRecreateRuntimeRetiredStatusEvent {
  return Boolean(
    input.event_type === 'status' &&
    input.lifecycle_source === 'manager' &&
    input.lifecycle_action === EWorkerAction.recreate &&
    input.lifecycle_phase === 'runtime_retired' &&
    input.worker_status_id === EWorkerStatus.recreating &&
    input.status === EBaileysConnectionStatus.info &&
    input.code === ECodeMessage.info &&
    input.worker_type_id &&
    normalizeWorkerLifecycleOperationId(input.lifecycle_operation_id) &&
    normalizeWorkerLifecycleRuntimeGeneration(input.runtime_generation) &&
    input.recreate_phase === EWorkerRecreatePhase.recreating &&
    input.recreate_runtime_retired === true &&
    normalizeConnectionStatusObservedAt(input.recreate_phase_observed_at) ===
      normalizeConnectionStatusObservedAt(
        input.connection_status_observed_at
      ) &&
    input.connection_online_acknowledged === false &&
    input.connection_status === undefined &&
    input.connection_status_source_id === undefined &&
    input.connection_status_order === undefined &&
    input.container_id === undefined &&
    normalizeConnectionStatusObservedAt(input.connection_status_observed_at) !==
      undefined
  );
}

export function evaluateManagerWorkerRecreateRuntimeStartedFence(input: {
  event: IBaileysConnectionState;
  persistedWorkerTypeId?: string | null;
  persistedRuntimeGeneration?: number | null;
  currentLifecycleOperationId?: string | null;
}): ManagerWorkerLifecycleCompletionFenceResult {
  const { event } = input;
  if (!isManagerWorkerRecreateRuntimeStartedStatusEvent(event)) {
    return {
      accepted: false,
      reason: 'invalid_manager_lifecycle_completion_envelope',
    };
  }
  if (
    input.persistedWorkerTypeId &&
    event.worker_type_id !== input.persistedWorkerTypeId &&
    event.previous_worker_type_id !== input.persistedWorkerTypeId
  ) {
    return { accepted: false, reason: 'worker_type_mismatch' };
  }
  const persistedGeneration = normalizeWorkerLifecycleRuntimeGeneration(
    input.persistedRuntimeGeneration
  );
  const eventGeneration = normalizeWorkerLifecycleRuntimeGeneration(
    event.runtime_generation
  ) as number;
  if (!persistedGeneration) {
    return {
      accepted: false,
      reason: 'runtime_generation_unverifiable',
    };
  }
  if (eventGeneration < persistedGeneration) {
    return { accepted: false, reason: 'runtime_generation_mismatch' };
  }
  const currentOperationId = normalizeWorkerLifecycleOperationId(
    input.currentLifecycleOperationId
  );
  if (!currentOperationId) {
    return {
      accepted: false,
      reason: 'lifecycle_operation_unverifiable',
    };
  }
  const operationId = normalizeWorkerLifecycleOperationId(
    event.lifecycle_operation_id
  ) as string;
  if (operationId !== currentOperationId) {
    return { accepted: false, reason: 'lifecycle_operation_mismatch' };
  }
  return {
    accepted: true,
    operationId,
    runtimeGeneration: eventGeneration,
  };
}

export function evaluateManagerWorkerRecreateRuntimeRetiredFence(input: {
  event: IBaileysConnectionState;
  persistedWorkerTypeId?: string | null;
  persistedRuntimeGeneration?: number | null;
  currentLifecycleOperationId?: string | null;
}): ManagerWorkerLifecycleCompletionFenceResult {
  const { event } = input;
  if (!isManagerWorkerRecreateRuntimeRetiredStatusEvent(event)) {
    return {
      accepted: false,
      reason: 'invalid_manager_lifecycle_completion_envelope',
    };
  }
  if (
    input.persistedWorkerTypeId &&
    event.worker_type_id !== input.persistedWorkerTypeId &&
    event.previous_worker_type_id !== input.persistedWorkerTypeId
  ) {
    return { accepted: false, reason: 'worker_type_mismatch' };
  }
  const persistedGeneration = normalizeWorkerLifecycleRuntimeGeneration(
    input.persistedRuntimeGeneration
  );
  const eventGeneration = normalizeWorkerLifecycleRuntimeGeneration(
    event.runtime_generation
  ) as number;
  if (!persistedGeneration) {
    return {
      accepted: false,
      reason: 'runtime_generation_unverifiable',
    };
  }
  if (eventGeneration < persistedGeneration) {
    return { accepted: false, reason: 'runtime_generation_mismatch' };
  }
  const currentOperationId = normalizeWorkerLifecycleOperationId(
    input.currentLifecycleOperationId
  );
  if (!currentOperationId) {
    return {
      accepted: false,
      reason: 'lifecycle_operation_unverifiable',
    };
  }
  const operationId = normalizeWorkerLifecycleOperationId(
    event.lifecycle_operation_id
  ) as string;
  if (operationId !== currentOperationId) {
    return { accepted: false, reason: 'lifecycle_operation_mismatch' };
  }
  return {
    accepted: true,
    operationId,
    runtimeGeneration: eventGeneration,
  };
}

/**
 * A completion is accepted only for the exact operation currently held by the
 * browser and a runtime generation that has not regressed. A generic
 * ONLINE/provider publication can therefore never release this fence, even
 * when it arrives later on the stream.
 */
export function evaluateManagerWorkerLifecycleCompletionFence(input: {
  event: IBaileysConnectionState;
  persistedWorkerTypeId?: string | null;
  persistedRuntimeGeneration?: number | null;
  currentLifecycleOperationId?: string | null;
}): ManagerWorkerLifecycleCompletionFenceResult {
  const { event } = input;
  if (!isManagerWorkerRecreateCompletedStatusEvent(event)) {
    return {
      accepted: false,
      reason: 'invalid_manager_lifecycle_completion_envelope',
    };
  }

  if (
    input.persistedWorkerTypeId &&
    event.worker_type_id !== input.persistedWorkerTypeId &&
    event.previous_worker_type_id !== input.persistedWorkerTypeId
  ) {
    return { accepted: false, reason: 'worker_type_mismatch' };
  }

  const persistedRuntimeGeneration = normalizeWorkerLifecycleRuntimeGeneration(
    input.persistedRuntimeGeneration
  );
  const eventRuntimeGeneration = normalizeWorkerLifecycleRuntimeGeneration(
    event.runtime_generation
  ) as number;
  if (!persistedRuntimeGeneration) {
    return {
      accepted: false,
      reason: 'runtime_generation_unverifiable',
    };
  }
  if (eventRuntimeGeneration < persistedRuntimeGeneration) {
    return { accepted: false, reason: 'runtime_generation_mismatch' };
  }

  const currentOperationId = normalizeWorkerLifecycleOperationId(
    input.currentLifecycleOperationId
  );
  if (!currentOperationId) {
    return {
      accepted: false,
      reason: 'lifecycle_operation_unverifiable',
    };
  }
  const operationId = normalizeWorkerLifecycleOperationId(
    event.lifecycle_operation_id
  ) as string;
  if (operationId !== currentOperationId) {
    return { accepted: false, reason: 'lifecycle_operation_mismatch' };
  }

  return {
    accepted: true,
    operationId,
    runtimeGeneration: eventRuntimeGeneration,
  };
}

/**
 * Manager lifecycle events are fenced independently from provider status.
 * UUIDv7 operation ids give each browser a monotonic stale-event fence while
 * recovery UUIDs of other RFC versions require an exact durable lifecycle
 * match. Runtime generation and provider identity prevent a retired container
 * from changing the current channel lifecycle.
 */
export function evaluateManagerWorkerLifecycleStatusFence(input: {
  event: IBaileysConnectionState;
  persistedWorkerTypeId?: string | null;
  persistedRuntimeGeneration?: number | null;
  currentLifecycleOperationId?: string | null;
  completedLifecycleOperationId?: string | null;
}): ManagerWorkerLifecycleFenceResult {
  const { event } = input;
  if (!isManagerWorkerRecreatingStatusEvent(event)) {
    return {
      accepted: false,
      reason: 'invalid_manager_lifecycle_envelope',
    };
  }

  if (
    input.persistedWorkerTypeId &&
    event.worker_type_id !== input.persistedWorkerTypeId &&
    event.previous_worker_type_id !== input.persistedWorkerTypeId
  ) {
    return { accepted: false, reason: 'worker_type_mismatch' };
  }

  const persistedRuntimeGeneration = normalizeWorkerLifecycleRuntimeGeneration(
    input.persistedRuntimeGeneration
  );
  const eventRuntimeGeneration = normalizeWorkerLifecycleRuntimeGeneration(
    event.runtime_generation
  );
  if (
    input.persistedRuntimeGeneration !== undefined &&
    input.persistedRuntimeGeneration !== null &&
    persistedRuntimeGeneration === undefined
  ) {
    return {
      accepted: false,
      reason: 'runtime_generation_unverifiable',
    };
  }
  if (persistedRuntimeGeneration !== undefined) {
    if (eventRuntimeGeneration === undefined) {
      return {
        accepted: false,
        reason: 'runtime_generation_unverifiable',
      };
    }
    if (eventRuntimeGeneration !== persistedRuntimeGeneration) {
      return { accepted: false, reason: 'runtime_generation_mismatch' };
    }
  }

  const currentOperationId = normalizeWorkerLifecycleOperationId(
    input.currentLifecycleOperationId
  );
  const operationId = normalizeWorkerLifecycleOperationId(
    event.lifecycle_operation_id
  ) as string;
  const completedOperationId = normalizeWorkerLifecycleOperationId(
    input.completedLifecycleOperationId
  );
  if (currentOperationId) {
    const currentComparison = compareWorkerLifecycleOperationIds(
      operationId,
      currentOperationId
    );
    if (currentComparison === undefined || currentComparison < 0) {
      return { accepted: false, reason: 'stale_lifecycle_operation' };
    }
  } else if (!isWorkerLifecycleOperationIdV7(operationId)) {
    return { accepted: false, reason: 'stale_lifecycle_operation' };
  }
  if (completedOperationId) {
    const exactCurrentLifecycleProof = currentOperationId === operationId;
    if (operationId === completedOperationId) {
      return { accepted: false, reason: 'stale_lifecycle_operation' };
    }
    if (!exactCurrentLifecycleProof) {
      const completedComparison = compareWorkerLifecycleOperationIds(
        operationId,
        completedOperationId
      );
      if (completedComparison === undefined || completedComparison < 0) {
        return { accepted: false, reason: 'stale_lifecycle_operation' };
      }
    }
  }

  return {
    accepted: true,
    operationId,
    ...(eventRuntimeGeneration
      ? { runtimeGeneration: eventRuntimeGeneration }
      : {}),
  };
}
