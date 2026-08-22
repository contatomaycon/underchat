import { EWorkerStatus } from '../enums/EWorkerStatus';
import { EWorkerType } from '../enums/EWorkerType';
import {
  compareWhatsappConnectionStatusOrders,
  evaluateWhatsappRealtimeStatusFence,
  normalizeWhatsappConnectionStatus,
  normalizeWhatsappConnectionStatusOrder,
  normalizeWhatsappConnectionStatusSourceId,
  projectWhatsappChannelDisplayStatus,
  projectWhatsappConnectionPublicStatus,
  type WhatsappConnectionPublicStatus,
} from './whatsappConnectionStatus';

export interface MobileChannelStatusEvent {
  event_type?: 'status' | 'telemetry';
  worker_id: string;
  worker_name?: string;
  worker_type_id?: string;
  worker_status_id?: string;
  connection_status?: unknown;
  connection_status_source_id?: unknown;
  connection_status_order?: unknown;
  connection_online_acknowledged?: unknown;
  runtime_generation?: unknown;
}

export type MobileChannelStatusProjection =
  | { kind: 'ignored'; reason: string }
  | { kind: 'removed'; nextOrder?: string }
  | {
      kind: 'status';
      statusId: string;
      isOnline: boolean;
      publicStatus?: WhatsappConnectionPublicStatus;
      nextOrder?: string;
    };

const providerForWorkerType = (
  workerTypeId: string | undefined
): 'baileys' | 'wwebjs' | 'whatsmeow' | undefined => {
  if (workerTypeId === EWorkerType.baileys) return 'baileys';
  if (workerTypeId === EWorkerType.wwebjs) return 'wwebjs';
  if (workerTypeId === EWorkerType.whatsmeow) return 'whatsmeow';
  return undefined;
};

const effectiveStatusId = (
  display: ReturnType<typeof projectWhatsappChannelDisplayStatus>
): string | null => {
  if (display.kind === 'worker') return display.workerStatusId;
  return display.connectionStatus === 'online'
    ? EWorkerStatus.online
    : EWorkerStatus.offline;
};

/**
 * Fail-closed customer projection for mobile realtime events. A raw worker
 * ONLINE hint from an unofficial provider is never sufficient: the exact
 * native envelope, monotonic outbox order and central ONLINE acknowledgement
 * are required.
 */
export function projectMobileChannelStatusEvent(input: {
  payload: MobileChannelStatusEvent;
  currentStatusId?: string | null;
  currentOrder?: string;
  currentWorkerTypeId?: string;
  currentRuntimeGeneration?: number;
}): MobileChannelStatusProjection {
  const { payload } = input;
  const mutatesWorkerStatus = payload.event_type === 'status';
  const rawStatusId = mutatesWorkerStatus
    ? payload.worker_status_id
    : input.currentStatusId;
  let nextOrder: string | undefined;

  // Worker deletion is a manager-owned, monotonic lifecycle and must not be
  // fenced by provider/runtime ordering. `deleting` is only the durable
  // pending state; the channel is removed after the terminal `delete` event.
  // Telemetry can never advance either transition, even if it carries a
  // lifecycle-looking worker_status_id.
  if (mutatesWorkerStatus && rawStatusId === EWorkerStatus.delete) {
    return { kind: 'removed' };
  }
  if (mutatesWorkerStatus && rawStatusId === EWorkerStatus.deleting) {
    return {
      kind: 'status',
      statusId: EWorkerStatus.deleting,
      isOnline: false,
    };
  }

  if (payload.connection_status !== undefined) {
    const effectiveWorkerTypeId =
      payload.worker_type_id ?? input.currentWorkerTypeId;
    const provider = providerForWorkerType(effectiveWorkerTypeId);
    const snapshot = provider
      ? normalizeWhatsappConnectionStatus(payload.connection_status, provider)
      : undefined;
    const sourceId = normalizeWhatsappConnectionStatusSourceId(
      payload.connection_status_source_id
    );
    nextOrder = normalizeWhatsappConnectionStatusOrder(
      payload.connection_status_order
    );
    if (!snapshot || !sourceId || !nextOrder) {
      return { kind: 'ignored', reason: 'invalid_native_status_envelope' };
    }
    if (
      input.currentOrder &&
      compareWhatsappConnectionStatusOrders(nextOrder, input.currentOrder) <= 0
    ) {
      return { kind: 'ignored', reason: 'stale_native_status_order' };
    }
    const realtimeFence = evaluateWhatsappRealtimeStatusFence({
      persistedWorkerTypeId: input.currentWorkerTypeId,
      eventWorkerTypeId: payload.worker_type_id,
      persistedRuntimeGeneration: input.currentRuntimeGeneration,
      eventRuntimeGeneration: payload.runtime_generation,
      persistedConnectionStatusOrder: input.currentOrder,
      hasValidatedNativeProjection: true,
    });
    if (!realtimeFence.accepted) {
      return { kind: 'ignored', reason: realtimeFence.reason };
    }

    const publicStatus = projectWhatsappConnectionPublicStatus(snapshot);
    if (!publicStatus) {
      return { kind: 'ignored', reason: 'invalid_public_status_projection' };
    }
    const display = projectWhatsappChannelDisplayStatus({
      workerTypeId: realtimeFence.workerTypeId,
      workerStatusId: rawStatusId,
      connectionStatus: publicStatus,
      connectionOnlineAcknowledged:
        publicStatus === 'online' &&
        payload.connection_online_acknowledged === true,
    });
    const statusId = effectiveStatusId(display);
    if (!statusId) {
      return { kind: 'ignored', reason: 'missing_effective_status' };
    }
    return {
      kind: 'status',
      statusId,
      isOnline: statusId === EWorkerStatus.online,
      publicStatus:
        display.kind === 'connection' ? display.connectionStatus : undefined,
      nextOrder,
    };
  }

  if (!mutatesWorkerStatus) {
    return {
      kind: 'ignored',
      reason:
        payload.event_type === 'telemetry'
          ? 'telemetry_without_native_status'
          : 'invalid_event_type',
    };
  }
  if (!rawStatusId) {
    return { kind: 'ignored', reason: 'missing_worker_status' };
  }
  if (
    payload.connection_status_source_id !== undefined ||
    payload.connection_status_order !== undefined
  ) {
    return { kind: 'ignored', reason: 'native_metadata_without_envelope' };
  }
  const realtimeFence = evaluateWhatsappRealtimeStatusFence({
    persistedWorkerTypeId: input.currentWorkerTypeId,
    eventWorkerTypeId: payload.worker_type_id,
    persistedRuntimeGeneration: input.currentRuntimeGeneration,
    eventRuntimeGeneration: payload.runtime_generation,
    persistedConnectionStatusOrder: input.currentOrder,
    hasValidatedNativeProjection: false,
  });
  if (!realtimeFence.accepted) {
    return { kind: 'ignored', reason: realtimeFence.reason };
  }
  const display = projectWhatsappChannelDisplayStatus({
    workerTypeId: realtimeFence.workerTypeId,
    workerStatusId: rawStatusId,
    connectionOnlineAcknowledged: false,
  });
  const statusId = effectiveStatusId(display);
  if (!statusId) {
    return { kind: 'ignored', reason: 'missing_effective_status' };
  }
  return {
    kind: 'status',
    statusId,
    isOnline: statusId === EWorkerStatus.online,
    publicStatus:
      display.kind === 'connection' ? display.connectionStatus : undefined,
  };
}
