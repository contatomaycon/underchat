import { defineStore } from 'pinia';
import { EWorkerRecreatePhase } from '@core/common/enums/EWorkerRecreatePhase';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import {
  compareWhatsappConnectionStatusOrders,
  evaluateWhatsappRealtimeStatusFence,
  normalizeWhatsappConnectionStatus,
  normalizeWhatsappConnectionStatusOrder,
  normalizeWhatsappConnectionStatusSourceId,
  normalizeWhatsappRuntimeGeneration,
  projectWhatsappConnectionPublicStatus,
  type WhatsappConnectionPublicStatus,
} from '@core/common/functions/whatsappConnectionStatus';
import {
  buildManagerWorkerRecreatingStatusEvent,
  compareWorkerLifecycleOperationIds,
  isWorkerLifecycleOperationIdV7,
  isManagerWorkerRecreateCompletedStatusEvent,
  isManagerWorkerRecreateRuntimeRetiredStatusEvent,
  isManagerWorkerRecreateRuntimeStartedStatusEvent,
  isManagerWorkerRecreatingStatusEvent,
  normalizeWorkerLifecycleOperationId,
  normalizeWorkerLifecycleRuntimeGeneration,
  type ManagerWorkerLifecycleStatusEvent,
  type ManagerWorkerRecreateRuntimeStartedStatusEvent,
} from '@core/common/functions/workerLifecycleRealtimeStatus';
import type { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import type { ICreateWorkerResponse } from '@core/common/interfaces/ICreateWorkerResponse';
import type { IWorkerLifecycleAck } from '@core/common/interfaces/IWorkerLifecycleAck';
import type { WhatsappConnectionStatusProvider } from '@core/common/interfaces/IWhatsappConnectionStatus';
import type { ListOfflineChannelsResponse } from '@core/schema/dashboard/listOfflineChannels/response.schema';
import type { ListChannelsStatusResponse } from '@core/schema/dashboard/listChannelsStatus/response.schema';
import type { ListWorkerResponse } from '@core/schema/worker/listWorker/response.schema';
import type { ViewWorkerResponse } from '@core/schema/worker/viewWorker/response.schema';
import type { DisconnectWorkerConnectionResponse } from '@core/schema/worker/disconnectWorkerConnection/response.schema';
import type { WhatsappProviderHandoffView } from '@webcore/interfaces/IWhatsappProviderHandoff';
import type { ChannelStatusPresentationInput } from '@webcore/utils/channelStatusPresentation';

const providerByWorkerTypeId: Partial<
  Record<string, WhatsappConnectionStatusProvider>
> = {
  [EWorkerType.baileys]: 'baileys',
  [EWorkerType.wwebjs]: 'wwebjs',
  [EWorkerType.whatsmeow]: 'whatsmeow',
};

type ChannelStatusProjectionSource =
  | 'dashboard_http'
  | 'offline_http'
  | 'worker_http'
  | 'realtime'
  | 'create_ack'
  | 'session_removal_ack';

export interface ChannelStatusPresentationSnapshot extends ChannelStatusPresentationInput {
  workerId: string;
  workerTypeId: string | null;
  workerStatusId: string | null;
  sessionIdentityPresent: boolean;
  workerStatusObservedAt: string | null;
  /** Durable runtime tombstone for the connection epoch removed by the user. */
  sessionRemovalObservedAt: string | null;
  connectionStatus: WhatsappConnectionPublicStatus | null;
  connectionStatusSourceId: string | null;
  connectionStatusOrder: string | null;
  connectionStatusObservedAt: string | null;
  connectionOnlineAcknowledged: boolean;
  runtimeGeneration: number | null;
  lifecycleOperationId: string | null;
  completedLifecycleOperationId: string | null;
  completedLifecycleRuntimeGeneration: number | null;
  completedLifecycleAt: string | null;
  recreateBaselineConnectionStatusOrder: string | null;
  recreatePhase: EWorkerRecreatePhase | null;
  recreatePhaseObservedAt: string | null;
  recreateRuntimeRetired: boolean;
  source: ChannelStatusProjectionSource;
}

export type ChannelStatusPresentationMutation =
  | { kind: 'hydrate'; snapshot: ChannelStatusPresentationSnapshot }
  | {
      kind: 'provider_handoff_source_recovery';
      snapshot: ChannelStatusPresentationSnapshot;
      handoff: WhatsappProviderHandoffView;
    }
  | { kind: 'realtime'; event: IBaileysConnectionState };

export type ChannelStatusPresentationReduction =
  | { accepted: false }
  | { accepted: true; remove: true }
  | { accepted: true; snapshot: ChannelStatusPresentationSnapshot };

export interface ProviderHandoffSourceRecoveryAcceptance {
  releasedOperationId: string | null;
  terminalOperationId: string;
  operationIds: string[];
  runtimeGeneration: number;
  observedAt: string;
}

type NativeProjectionFields = Pick<
  ChannelStatusPresentationSnapshot,
  | 'connectionStatus'
  | 'connectionStatusSourceId'
  | 'connectionStatusOrder'
  | 'connectionStatusObservedAt'
  | 'connectionOnlineAcknowledged'
>;

interface CompletionMarker {
  operationId: string | null;
  runtimeGeneration: number | null;
  completedAt: string | null;
}

interface RecreatePhaseMarker {
  phase: EWorkerRecreatePhase;
  observedAt: string | null;
  runtimeRetired: boolean;
}

type ProviderHandoffSourceRecoveryProof =
  ProviderHandoffSourceRecoveryAcceptance;

type RecreatePhaseTransition =
  { accepted: false } | ({ accepted: true } & RecreatePhaseMarker);

const isPublicConnectionStatus = (
  value: unknown
): value is WhatsappConnectionPublicStatus =>
  value === 'connecting' ||
  value === 'qr' ||
  value === 'online' ||
  value === 'offline' ||
  value === 'reconnect_required' ||
  value === 'error';

const normalizeRecreatePhase = (
  value: unknown
): EWorkerRecreatePhase | null => {
  if (value === EWorkerRecreatePhase.recreating) {
    return EWorkerRecreatePhase.recreating;
  }
  if (value === EWorkerRecreatePhase.connecting) {
    return EWorkerRecreatePhase.connecting;
  }
  return null;
};

const normalizeWorkerTypeId = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const normalizeWorkerStatusId = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const normalizeRuntimeGeneration = (value: unknown): number | null =>
  normalizeWhatsappRuntimeGeneration(value) ?? null;

const normalizeObservedAt = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
};

const normalizeHydratedWorkerStatusObservedAt = (input: {
  worker_status_observed_at?: unknown;
  updated_at?: unknown;
}): string | null =>
  normalizeObservedAt(input.worker_status_observed_at ?? input.updated_at);

/**
 * Worker status has its own durable clock. Lifecycle and native-connection
 * timestamps order their respective projections and must never make an old
 * worker status look newer merely because those tombstones remain present in
 * a later payload.
 */
const normalizeEventWorkerStatusObservedAt = (input: {
  worker_status_observed_at?: unknown;
}): string | null => normalizeObservedAt(input.worker_status_observed_at);

export const isSessionRemovalTerminalPublication = (
  event: IBaileysConnectionState
): boolean =>
  event.event_type === 'status' &&
  event.worker_status_id === EWorkerStatus.disponible &&
  event.session_removed === true &&
  event.disconnected_user === true &&
  normalizeRuntimeGeneration(event.runtime_generation) !== null &&
  normalizeEventWorkerStatusObservedAt(event) !== null;

export const isManagerPairingReadyPublication = (
  event: IBaileysConnectionState
): boolean =>
  event.event_type === 'status' &&
  event.worker_status_id === EWorkerStatus.disponible &&
  event.status === EBaileysConnectionStatus.connecting &&
  event.code === ECodeMessage.awaitingReadQrCode &&
  event.qr_pending === true &&
  Boolean(event.connection_attempt_id?.trim()) &&
  normalizeRuntimeGeneration(event.runtime_generation) !== null &&
  normalizeEventWorkerStatusObservedAt(event) !== null;

const compareObservedAt = (
  candidate: string | null,
  current: string | null
): -1 | 0 | 1 | null => {
  if (!candidate || !current) return null;
  const candidateMs = Date.parse(candidate);
  const currentMs = Date.parse(current);
  if (!Number.isFinite(candidateMs) || !Number.isFinite(currentMs)) return null;
  if (candidateMs < currentMs) return -1;
  if (candidateMs > currentMs) return 1;
  return 0;
};

const publicationFollowsSessionRemoval = (
  terminalObservedAt: string | null,
  event: IBaileysConnectionState
): boolean => {
  if (!terminalObservedAt) return false;
  const observations = [
    event.worker_status_observed_at,
    event.connection_status_observed_at,
    event.recreate_phase_observed_at,
    event.recreate_completed_at,
  ]
    .map(normalizeObservedAt)
    .filter((value): value is string => value !== null);

  return (
    observations.length > 0 &&
    observations.every(
      (observedAt) => compareObservedAt(observedAt, terminalObservedAt) !== -1
    ) &&
    observations.some(
      (observedAt) => compareObservedAt(observedAt, terminalObservedAt) === 1
    )
  );
};

/**
 * Two Vue consumers share one physical Centrifugo subscription. The first
 * consumer advances the canonical reducer; the second must still be able to
 * apply idempotent view-store side effects for that exact publication without
 * treating an arbitrary rejected/stale event as observed.
 */
export const canonicalSnapshotIncludesPublication = (
  snapshot: ChannelStatusPresentationSnapshot | undefined,
  event: IBaileysConnectionState
): boolean => {
  if (!snapshot) return false;

  if (isSessionRemovalTerminalPublication(event)) {
    const observedAt = normalizeEventWorkerStatusObservedAt(event);
    return (
      snapshot.workerStatusId === EWorkerStatus.disponible &&
      snapshot.workerStatusObservedAt === observedAt &&
      snapshot.sessionRemovalObservedAt === observedAt &&
      snapshot.connectionStatus === null &&
      snapshot.connectionStatusSourceId === null &&
      snapshot.connectionStatusOrder === null &&
      snapshot.connectionOnlineAcknowledged === false &&
      snapshot.lifecycleOperationId === null &&
      snapshot.runtimeGeneration === event.runtime_generation
    );
  }

  const operationId = normalizeWorkerLifecycleOperationId(
    event.lifecycle_operation_id
  );
  if (operationId) {
    if (isManagerWorkerRecreateCompletedStatusEvent(event)) {
      return (
        snapshot.lifecycleOperationId === null &&
        snapshot.completedLifecycleOperationId === operationId &&
        snapshot.completedLifecycleRuntimeGeneration ===
          event.runtime_generation &&
        snapshot.completedLifecycleAt ===
          normalizeObservedAt(event.recreate_completed_at) &&
        snapshot.workerStatusId === event.worker_status_id
      );
    }

    if (
      snapshot.lifecycleOperationId !== operationId ||
      (event.runtime_generation !== undefined &&
        snapshot.runtimeGeneration !== event.runtime_generation) ||
      (event.worker_status_id &&
        snapshot.workerStatusId !== event.worker_status_id)
    ) {
      return false;
    }
    if (
      event.recreate_phase !== undefined ||
      event.recreate_phase_observed_at !== undefined ||
      event.recreate_runtime_retired !== undefined
    ) {
      return (
        snapshot.recreatePhase === event.recreate_phase &&
        snapshot.recreatePhaseObservedAt ===
          normalizeObservedAt(event.recreate_phase_observed_at) &&
        snapshot.recreateRuntimeRetired ===
          (event.recreate_runtime_retired === true)
      );
    }
    return true;
  }

  if (event.connection_status !== undefined) {
    const workerTypeId = event.worker_type_id ?? snapshot.workerTypeId;
    const provider = providerByWorkerTypeId[workerTypeId ?? ''];
    const native = provider
      ? normalizeWhatsappConnectionStatus(event.connection_status, provider)
      : undefined;
    return (
      Boolean(native) &&
      snapshot.connectionStatusSourceId ===
        normalizeWhatsappConnectionStatusSourceId(
          event.connection_status_source_id
        ) &&
      snapshot.connectionStatusOrder ===
        normalizeWhatsappConnectionStatusOrder(event.connection_status_order) &&
      snapshot.connectionStatus ===
        (native ? projectWhatsappConnectionPublicStatus(native) : null) &&
      (event.runtime_generation === undefined ||
        snapshot.runtimeGeneration === event.runtime_generation) &&
      (event.event_type !== 'status' ||
        !event.worker_status_id ||
        snapshot.workerStatusId === event.worker_status_id)
    );
  }

  const workerStatusObservedAt = normalizeEventWorkerStatusObservedAt(event);
  return (
    event.event_type === 'status' &&
    Boolean(event.worker_status_id) &&
    snapshot.workerStatusId === event.worker_status_id &&
    (!workerStatusObservedAt ||
      snapshot.workerStatusObservedAt === workerStatusObservedAt) &&
    (event.runtime_generation === undefined ||
      snapshot.runtimeGeneration === event.runtime_generation)
  );
};

const normalizeCompletionMarker = (input: {
  operationId?: unknown;
  runtimeGeneration?: unknown;
  completedAt?: unknown;
}): CompletionMarker => {
  const operationId =
    normalizeWorkerLifecycleOperationId(input.operationId) ?? null;
  const runtimeGeneration =
    normalizeWorkerLifecycleRuntimeGeneration(input.runtimeGeneration) ?? null;
  const completedAt = normalizeObservedAt(input.completedAt);
  return operationId && runtimeGeneration && completedAt
    ? { operationId, runtimeGeneration, completedAt }
    : { operationId: null, runtimeGeneration: null, completedAt: null };
};

const newerCompletionMarker = (
  current: CompletionMarker,
  candidate: CompletionMarker
): CompletionMarker => {
  if (!candidate.operationId || !candidate.completedAt) return current;
  if (!current.operationId || !current.completedAt) return candidate;
  if (candidate.operationId === current.operationId) {
    return Date.parse(candidate.completedAt) >= Date.parse(current.completedAt)
      ? candidate
      : current;
  }
  return Date.parse(candidate.completedAt) > Date.parse(current.completedAt)
    ? candidate
    : current;
};

/**
 * Orders phase changes independently from native provider events. The clock is
 * persisted by PostgreSQL (bootstrap/retirement marker), so delivery order,
 * reconnect history and HTTP replica timing cannot reopen an older phase.
 */
const reduceRecreatePhaseMarker = (input: {
  currentPhase: EWorkerRecreatePhase | null;
  currentObservedAt: string | null;
  currentRuntimeRetired: boolean;
  candidatePhase: EWorkerRecreatePhase | null;
  candidateObservedAt: string | null;
  candidateRuntimeRetired: boolean;
  generationAdvanced?: boolean;
}): RecreatePhaseTransition => {
  if (!input.candidatePhase) return { accepted: false };
  if (
    input.candidateRuntimeRetired &&
    (input.candidatePhase !== EWorkerRecreatePhase.recreating ||
      !input.candidateObservedAt)
  ) {
    return { accepted: false };
  }
  if (input.generationAdvanced) {
    if (
      input.candidatePhase === EWorkerRecreatePhase.connecting &&
      !input.candidateObservedAt
    ) {
      return { accepted: false };
    }
    return {
      accepted: true,
      phase: input.candidatePhase,
      observedAt: input.candidateObservedAt,
      runtimeRetired: input.candidateRuntimeRetired,
    };
  }
  if (input.currentRuntimeRetired) {
    return input.candidateRuntimeRetired &&
      input.candidatePhase === EWorkerRecreatePhase.recreating &&
      input.candidateObservedAt === input.currentObservedAt
      ? {
          accepted: true,
          phase: EWorkerRecreatePhase.recreating,
          observedAt: input.currentObservedAt,
          runtimeRetired: true,
        }
      : { accepted: false };
  }
  if (!input.currentPhase) {
    return {
      accepted: true,
      phase: input.candidatePhase,
      observedAt: input.candidateObservedAt,
      runtimeRetired: input.candidateRuntimeRetired,
    };
  }
  if (
    input.currentPhase === EWorkerRecreatePhase.connecting &&
    input.candidatePhase === EWorkerRecreatePhase.recreating &&
    !input.candidateRuntimeRetired
  ) {
    return { accepted: false };
  }
  if (input.currentObservedAt && input.candidateObservedAt) {
    const order = compareObservedAt(
      input.candidateObservedAt,
      input.currentObservedAt
    );
    if (order === -1) return { accepted: false };
    const exactBootstrapDominatesEqualInitialPhase =
      order === 0 &&
      input.currentPhase === EWorkerRecreatePhase.recreating &&
      !input.currentRuntimeRetired &&
      input.candidatePhase === EWorkerRecreatePhase.connecting &&
      !input.candidateRuntimeRetired;
    if (
      order === 0 &&
      input.candidatePhase !== input.currentPhase &&
      !input.candidateRuntimeRetired &&
      !exactBootstrapDominatesEqualInitialPhase
    ) {
      return { accepted: false };
    }
    return {
      accepted: true,
      phase: input.candidatePhase,
      observedAt: input.candidateObservedAt,
      runtimeRetired: input.candidateRuntimeRetired,
    };
  }
  if (input.currentObservedAt && !input.candidateObservedAt) {
    return input.candidatePhase === input.currentPhase
      ? {
          accepted: true,
          phase: input.currentPhase,
          observedAt: input.currentObservedAt,
          runtimeRetired: false,
        }
      : { accepted: false };
  }
  if (!input.currentObservedAt && input.candidateObservedAt) {
    return {
      accepted: true,
      phase: input.candidatePhase,
      observedAt: input.candidateObservedAt,
      runtimeRetired: input.candidateRuntimeRetired,
    };
  }
  return input.candidatePhase === input.currentPhase
    ? {
        accepted: true,
        phase: input.currentPhase,
        observedAt: null,
        runtimeRetired: false,
      }
    : { accepted: false };
};

const workerConnectionPublicStatus = (
  channel: ListWorkerResponse | ViewWorkerResponse
): WhatsappConnectionPublicStatus | null => {
  const workerTypeId = normalizeWorkerTypeId(channel.type?.id);
  const provider = providerByWorkerTypeId[workerTypeId ?? ''];
  if (!provider) return null;
  return (
    projectWhatsappConnectionPublicStatus(
      normalizeWhatsappConnectionStatus(channel.connection_status, provider)
    ) ?? null
  );
};

const recreateSnapshotFields = (input: {
  workerStatusId: string | null;
  lifecycleOperationId?: unknown;
  recreatePhase?: unknown;
  recreatePhaseObservedAt?: unknown;
  recreateRuntimeRetired?: unknown;
}) => {
  const lifecycleOperationId =
    normalizeWorkerLifecycleOperationId(input.lifecycleOperationId) ?? null;
  if (!lifecycleOperationId) {
    return {
      lifecycleOperationId: null,
      recreatePhase: null,
      recreatePhaseObservedAt: null,
      recreateRuntimeRetired: false,
    };
  }
  const deletionTerminal =
    input.workerStatusId === EWorkerStatus.deleting ||
    input.workerStatusId === EWorkerStatus.delete;
  if (deletionTerminal) {
    return {
      lifecycleOperationId: null,
      recreatePhase: null,
      recreatePhaseObservedAt: null,
      recreateRuntimeRetired: false,
    };
  }
  const recreatePhase =
    normalizeRecreatePhase(input.recreatePhase) ??
    EWorkerRecreatePhase.recreating;
  const recreatePhaseObservedAt = normalizeObservedAt(
    input.recreatePhaseObservedAt
  );
  return {
    lifecycleOperationId,
    recreatePhase,
    recreatePhaseObservedAt,
    recreateRuntimeRetired:
      recreatePhase === EWorkerRecreatePhase.recreating &&
      input.recreateRuntimeRetired === true &&
      recreatePhaseObservedAt !== null,
  };
};

const completionSnapshotFields = (input: {
  recreate_completed_operation_id?: unknown;
  recreate_completed_runtime_generation?: unknown;
  recreate_completed_at?: unknown;
}) => {
  const marker = normalizeCompletionMarker({
    operationId: input.recreate_completed_operation_id,
    runtimeGeneration: input.recreate_completed_runtime_generation,
    completedAt: input.recreate_completed_at,
  });
  return {
    completedLifecycleOperationId: marker.operationId,
    completedLifecycleRuntimeGeneration: marker.runtimeGeneration,
    completedLifecycleAt: marker.completedAt,
  };
};

export const workerChannelStatusPresentationSnapshot = (
  channel: ListWorkerResponse | ViewWorkerResponse
): ChannelStatusPresentationSnapshot => {
  const workerStatusId = normalizeWorkerStatusId(channel.status?.id);
  const sessionRemovalObservedAt = normalizeObservedAt(
    channel.connection_disconnected_at
  );
  const connectionStatusObservedAt = sessionRemovalObservedAt
    ? null
    : normalizeObservedAt(channel.connection_status_observed_at);
  return {
    workerId: channel.id,
    workerTypeId: normalizeWorkerTypeId(channel.type?.id),
    workerStatusId,
    sessionIdentityPresent:
      !sessionRemovalObservedAt &&
      typeof channel.number === 'string' &&
      channel.number.trim().length > 0,
    workerStatusObservedAt: normalizeHydratedWorkerStatusObservedAt(channel),
    sessionRemovalObservedAt,
    connectionStatus: sessionRemovalObservedAt
      ? null
      : workerConnectionPublicStatus(channel),
    connectionStatusSourceId: sessionRemovalObservedAt
      ? null
      : (normalizeWhatsappConnectionStatusSourceId(
          channel.connection_status_source_id
        ) ?? null),
    connectionStatusOrder: sessionRemovalObservedAt
      ? null
      : (normalizeWhatsappConnectionStatusOrder(
          channel.connection_status_order
        ) ?? null),
    connectionStatusObservedAt,
    connectionOnlineAcknowledged:
      !sessionRemovalObservedAt &&
      channel.connection_online_acknowledged === true &&
      connectionStatusObservedAt !== null,
    runtimeGeneration: normalizeRuntimeGeneration(channel.runtime_generation),
    ...(sessionRemovalObservedAt
      ? {
          lifecycleOperationId: null,
          recreatePhase: null,
          recreatePhaseObservedAt: null,
          recreateRuntimeRetired: false,
          completedLifecycleOperationId: null,
          completedLifecycleRuntimeGeneration: null,
          completedLifecycleAt: null,
        }
      : {
          ...recreateSnapshotFields({
            workerStatusId,
            lifecycleOperationId: channel.lifecycle_operation_id,
            recreatePhase: channel.recreate_phase,
            recreatePhaseObservedAt: channel.recreate_phase_observed_at,
            recreateRuntimeRetired: channel.recreate_runtime_retired,
          }),
          ...completionSnapshotFields(channel),
        }),
    recreateBaselineConnectionStatusOrder: null,
    source: sessionRemovalObservedAt ? 'session_removal_ack' : 'worker_http',
  };
};

export const offlineChannelStatusPresentationSnapshot = (
  channel: ListOfflineChannelsResponse
): ChannelStatusPresentationSnapshot => {
  const workerStatusId = normalizeWorkerStatusId(channel.status?.id);
  const sessionRemovalObservedAt = normalizeObservedAt(
    channel.connection_disconnected_at
  );
  const connectionStatusObservedAt = sessionRemovalObservedAt
    ? null
    : normalizeObservedAt(channel.connection_status_observed_at);
  return {
    workerId: channel.id,
    workerTypeId: normalizeWorkerTypeId(channel.worker_type_id),
    workerStatusId,
    sessionIdentityPresent:
      !sessionRemovalObservedAt && channel.session_identity_present === true,
    workerStatusObservedAt: normalizeHydratedWorkerStatusObservedAt(channel),
    sessionRemovalObservedAt,
    connectionStatus:
      !sessionRemovalObservedAt &&
      isPublicConnectionStatus(channel.connection_status)
        ? channel.connection_status
        : null,
    connectionStatusSourceId: sessionRemovalObservedAt
      ? null
      : (normalizeWhatsappConnectionStatusSourceId(
          channel.connection_status_source_id
        ) ?? null),
    connectionStatusOrder: sessionRemovalObservedAt
      ? null
      : (normalizeWhatsappConnectionStatusOrder(
          channel.connection_status_order
        ) ?? null),
    connectionStatusObservedAt,
    connectionOnlineAcknowledged:
      !sessionRemovalObservedAt &&
      channel.connection_online_acknowledged === true &&
      connectionStatusObservedAt !== null,
    runtimeGeneration: normalizeRuntimeGeneration(channel.runtime_generation),
    ...(sessionRemovalObservedAt
      ? {
          lifecycleOperationId: null,
          recreatePhase: null,
          recreatePhaseObservedAt: null,
          recreateRuntimeRetired: false,
          completedLifecycleOperationId: null,
          completedLifecycleRuntimeGeneration: null,
          completedLifecycleAt: null,
        }
      : {
          ...recreateSnapshotFields({
            workerStatusId,
            lifecycleOperationId: channel.lifecycle_operation_id,
            recreatePhase: channel.recreate_phase,
            recreatePhaseObservedAt: channel.recreate_phase_observed_at,
            recreateRuntimeRetired: channel.recreate_runtime_retired,
          }),
          ...completionSnapshotFields(channel),
        }),
    recreateBaselineConnectionStatusOrder: null,
    source: sessionRemovalObservedAt ? 'session_removal_ack' : 'offline_http',
  };
};

/**
 * `/chat/channels-status` is the banner's authoritative baseline for every
 * channel, including rows that are currently online and therefore absent from
 * `/dashboard/offline-channels`. It intentionally does not invent a native
 * connection projection; its type, generation, lifecycle and observation time
 * are enough to fence manager publications that follow the HTTP snapshot.
 */
export const dashboardChannelStatusPresentationSnapshot = (
  channel: ListChannelsStatusResponse
): ChannelStatusPresentationSnapshot => {
  const workerStatusId = normalizeWorkerStatusId(channel.status?.id);
  const sessionRemovalObservedAt = normalizeObservedAt(
    channel.connection_disconnected_at
  );
  return {
    workerId: channel.id,
    workerTypeId: normalizeWorkerTypeId(channel.worker_type_id),
    workerStatusId,
    sessionIdentityPresent:
      !sessionRemovalObservedAt && channel.session_identity_present === true,
    workerStatusObservedAt: normalizeHydratedWorkerStatusObservedAt(channel),
    sessionRemovalObservedAt,
    connectionStatus: null,
    connectionStatusSourceId: sessionRemovalObservedAt
      ? null
      : (normalizeWhatsappConnectionStatusSourceId(
          channel.connection_status_source_id
        ) ?? null),
    connectionStatusOrder: sessionRemovalObservedAt
      ? null
      : (normalizeWhatsappConnectionStatusOrder(
          channel.connection_status_order
        ) ?? null),
    connectionStatusObservedAt: sessionRemovalObservedAt
      ? null
      : normalizeObservedAt(channel.connection_status_observed_at),
    connectionOnlineAcknowledged: false,
    runtimeGeneration: normalizeRuntimeGeneration(channel.runtime_generation),
    ...(sessionRemovalObservedAt
      ? {
          lifecycleOperationId: null,
          recreatePhase: null,
          recreatePhaseObservedAt: null,
          recreateRuntimeRetired: false,
          completedLifecycleOperationId: null,
          completedLifecycleRuntimeGeneration: null,
          completedLifecycleAt: null,
        }
      : {
          ...recreateSnapshotFields({
            workerStatusId,
            lifecycleOperationId: channel.lifecycle_operation_id,
            recreatePhase: channel.recreate_phase,
            recreatePhaseObservedAt: channel.recreate_phase_observed_at,
            recreateRuntimeRetired: channel.recreate_runtime_retired,
          }),
          ...completionSnapshotFields(channel),
        }),
    recreateBaselineConnectionStatusOrder: null,
    source: sessionRemovalObservedAt ? 'session_removal_ack' : 'dashboard_http',
  };
};

const nativeProjection = (
  snapshot: ChannelStatusPresentationSnapshot
): NativeProjectionFields => ({
  connectionStatus: snapshot.connectionStatus,
  connectionStatusSourceId: snapshot.connectionStatusSourceId,
  connectionStatusOrder: snapshot.connectionStatusOrder,
  connectionStatusObservedAt: snapshot.connectionStatusObservedAt,
  connectionOnlineAcknowledged: snapshot.connectionOnlineAcknowledged,
});

const clearedNativeProjection = (
  current: ChannelStatusPresentationSnapshot,
  observedAt: string | null
): NativeProjectionFields => ({
  connectionStatus: null,
  connectionStatusSourceId: null,
  connectionStatusOrder: current.connectionStatusOrder,
  connectionStatusObservedAt:
    compareObservedAt(observedAt, current.connectionStatusObservedAt) === 1
      ? observedAt
      : current.connectionStatusObservedAt,
  connectionOnlineAcknowledged: false,
});

const mergeNativeProjection = (
  current: ChannelStatusPresentationSnapshot,
  candidate: ChannelStatusPresentationSnapshot,
  baselineOrder: string | null = null
): NativeProjectionFields => {
  const currentOrder = current.connectionStatusOrder;
  const candidateOrder = candidate.connectionStatusOrder;
  if (
    baselineOrder &&
    candidateOrder &&
    compareWhatsappConnectionStatusOrders(candidateOrder, baselineOrder) <= 0
  ) {
    return nativeProjection(current);
  }
  if (currentOrder && candidateOrder) {
    const order = compareWhatsappConnectionStatusOrders(
      candidateOrder,
      currentOrder
    );
    if (order < 0) return nativeProjection(current);
    if (order > 0) return nativeProjection(candidate);
    const observation = compareObservedAt(
      candidate.connectionStatusObservedAt,
      current.connectionStatusObservedAt
    );
    if (observation === 1) return nativeProjection(candidate);
    if (observation === -1) return nativeProjection(current);
    const sameSource = Boolean(
      current.connectionStatusSourceId &&
      current.connectionStatusSourceId === candidate.connectionStatusSourceId
    );
    if (!sameSource) return nativeProjection(current);

    // `/chat/channels-status` carries the durable cursor but deliberately no
    // provider envelope. A later `/worker` snapshot at that exact cursor may
    // enrich the canonical baseline; conversely, the envelope-less snapshot
    // must never erase native state or downgrade a durable ONLINE ACK.
    if (!current.connectionStatus && candidate.connectionStatus) {
      return nativeProjection(candidate);
    }
    if (current.connectionStatus && !candidate.connectionStatus) {
      return nativeProjection(current);
    }
    if (
      current.connectionStatus &&
      current.connectionStatus === candidate.connectionStatus
    ) {
      return {
        ...nativeProjection(candidate),
        connectionOnlineAcknowledged:
          current.connectionOnlineAcknowledged ||
          candidate.connectionOnlineAcknowledged,
      };
    }
    // Two different envelopes cannot both own the same source/order/clock.
    // Keep the established projection instead of guessing which is newer.
    return nativeProjection(current);
  }
  if (currentOrder && !candidateOrder) {
    const observation = compareObservedAt(
      candidate.connectionStatusObservedAt,
      current.connectionStatusObservedAt
    );
    if (observation === 1 && !candidate.connectionOnlineAcknowledged) {
      return {
        ...nativeProjection(current),
        connectionStatusObservedAt: candidate.connectionStatusObservedAt,
        connectionOnlineAcknowledged: false,
      };
    }
    return {
      ...nativeProjection(current),
      connectionOnlineAcknowledged:
        current.connectionOnlineAcknowledged &&
        candidate.connectionOnlineAcknowledged,
    };
  }
  if (!currentOrder && candidateOrder) return nativeProjection(candidate);
  const observation = compareObservedAt(
    candidate.connectionStatusObservedAt,
    current.connectionStatusObservedAt
  );
  if (observation === 1) return nativeProjection(candidate);
  if (observation === -1) return nativeProjection(current);
  return {
    ...nativeProjection(current),
    connectionStatus: current.connectionStatus ?? candidate.connectionStatus,
    connectionStatusSourceId:
      current.connectionStatusSourceId ?? candidate.connectionStatusSourceId,
    connectionOnlineAcknowledged:
      current.connectionOnlineAcknowledged &&
      candidate.connectionOnlineAcknowledged,
  };
};

const currentCompletion = (
  snapshot: ChannelStatusPresentationSnapshot
): CompletionMarker => ({
  operationId: snapshot.completedLifecycleOperationId,
  runtimeGeneration: snapshot.completedLifecycleRuntimeGeneration,
  completedAt: snapshot.completedLifecycleAt,
});

const withCompletion = (
  snapshot: ChannelStatusPresentationSnapshot,
  completion: CompletionMarker
): ChannelStatusPresentationSnapshot => ({
  ...snapshot,
  completedLifecycleOperationId: completion.operationId,
  completedLifecycleRuntimeGeneration: completion.runtimeGeneration,
  completedLifecycleAt: completion.completedAt,
});

const sameSnapshot = (
  left: ChannelStatusPresentationSnapshot,
  right: ChannelStatusPresentationSnapshot
): boolean =>
  left.workerId === right.workerId &&
  left.workerTypeId === right.workerTypeId &&
  left.workerStatusId === right.workerStatusId &&
  left.sessionIdentityPresent === right.sessionIdentityPresent &&
  left.workerStatusObservedAt === right.workerStatusObservedAt &&
  left.sessionRemovalObservedAt === right.sessionRemovalObservedAt &&
  left.connectionStatus === right.connectionStatus &&
  left.connectionStatusSourceId === right.connectionStatusSourceId &&
  left.connectionStatusOrder === right.connectionStatusOrder &&
  left.connectionStatusObservedAt === right.connectionStatusObservedAt &&
  left.connectionOnlineAcknowledged === right.connectionOnlineAcknowledged &&
  left.runtimeGeneration === right.runtimeGeneration &&
  left.lifecycleOperationId === right.lifecycleOperationId &&
  left.completedLifecycleOperationId === right.completedLifecycleOperationId &&
  left.completedLifecycleRuntimeGeneration ===
    right.completedLifecycleRuntimeGeneration &&
  left.completedLifecycleAt === right.completedLifecycleAt &&
  left.recreateBaselineConnectionStatusOrder ===
    right.recreateBaselineConnectionStatusOrder &&
  left.recreatePhase === right.recreatePhase &&
  left.recreatePhaseObservedAt === right.recreatePhaseObservedAt &&
  left.recreateRuntimeRetired === right.recreateRuntimeRetired &&
  left.source === right.source;

const snapshotHasObservationAfter = (
  snapshot: ChannelStatusPresentationSnapshot,
  observedAt: string
): boolean =>
  [
    snapshot.workerStatusObservedAt,
    snapshot.connectionStatusObservedAt,
    snapshot.recreatePhaseObservedAt,
    snapshot.completedLifecycleAt,
  ].some((candidate) => compareObservedAt(candidate, observedAt) === 1);

const reduceHydratedSnapshot = (
  current: ChannelStatusPresentationSnapshot | undefined,
  hydratedCandidate: ChannelStatusPresentationSnapshot
): ChannelStatusPresentationReduction => {
  if (!current) return { accepted: true, snapshot: hydratedCandidate };
  let candidate = hydratedCandidate;
  const currentGeneration = current.runtimeGeneration;
  const candidateGeneration = candidate.runtimeGeneration;
  if (
    currentGeneration &&
    candidateGeneration &&
    candidateGeneration < currentGeneration
  ) {
    return { accepted: false };
  }

  if (candidate.sessionRemovalObservedAt) {
    const terminalObservedAt =
      candidate.workerStatusObservedAt ?? candidate.sessionRemovalObservedAt;
    if (
      candidate.workerStatusId !== EWorkerStatus.disponible ||
      snapshotHasObservationAfter(current, terminalObservedAt)
    ) {
      return { accepted: false };
    }
    return {
      accepted: true,
      snapshot: {
        ...candidate,
        workerStatusId: EWorkerStatus.disponible,
        connectionStatus: null,
        connectionStatusSourceId: null,
        connectionStatusOrder: null,
        connectionStatusObservedAt: null,
        connectionOnlineAcknowledged: false,
        runtimeGeneration: candidateGeneration ?? currentGeneration,
        lifecycleOperationId: null,
        completedLifecycleOperationId: null,
        completedLifecycleRuntimeGeneration: null,
        completedLifecycleAt: null,
        recreateBaselineConnectionStatusOrder: null,
        recreatePhase: null,
        recreatePhaseObservedAt: null,
        recreateRuntimeRetired: false,
        source: 'session_removal_ack',
      },
    };
  }

  const sameRuntimeGeneration =
    currentGeneration === candidateGeneration ||
    candidateGeneration === null ||
    currentGeneration === null;
  const workerObservationComparison = compareObservedAt(
    candidate.workerStatusObservedAt,
    current.workerStatusObservedAt
  );
  if (
    sameRuntimeGeneration &&
    !current.lifecycleOperationId &&
    !candidate.lifecycleOperationId &&
    current.workerStatusObservedAt &&
    workerObservationComparison !== 1
  ) {
    // Read-replica/list hydration can arrive after realtime while describing
    // an older durable worker row. Preserve the newer worker projection, but
    // still allow the independently ordered native connection envelope below
    // to merge if it is genuinely newer.
    candidate = {
      ...candidate,
      workerStatusId: current.workerStatusId,
      sessionIdentityPresent: current.sessionIdentityPresent,
      workerStatusObservedAt: current.workerStatusObservedAt,
      source: current.source,
    };
  }

  // During recreate the worker row may temporarily lose its projected
  // `number` while the replacement runtime is being provisioned. That is not
  // evidence that the persisted session disappeared. Preserve an identity
  // already proven by the pre-recreate snapshot until an explicit removal
  // tombstone or a terminal `disponible` publication clears it.
  if (
    candidate.lifecycleOperationId &&
    candidate.workerStatusId === EWorkerStatus.recreating &&
    current.sessionIdentityPresent &&
    !candidate.sessionRemovalObservedAt
  ) {
    candidate = {
      ...candidate,
      sessionIdentityPresent: true,
    };
  }

  const candidateOperation = candidate.lifecycleOperationId;
  const candidateCompletion = currentCompletion(candidate);
  if (
    current.completedLifecycleOperationId &&
    !current.lifecycleOperationId &&
    !candidateOperation
  ) {
    const completedComparison = compareWorkerLifecycleOperationIds(
      candidateCompletion.operationId,
      current.completedLifecycleOperationId
    );
    const carriesCurrentOrNewerCompletion = Boolean(
      candidateCompletion.operationId &&
      candidateCompletion.runtimeGeneration &&
      candidateCompletion.completedAt &&
      ((completedComparison === 0 &&
        candidateCompletion.runtimeGeneration ===
          current.completedLifecycleRuntimeGeneration &&
        candidateCompletion.completedAt === current.completedLifecycleAt) ||
        (completedComparison === 1 &&
          (!current.completedLifecycleRuntimeGeneration ||
            candidateCompletion.runtimeGeneration >=
              current.completedLifecycleRuntimeGeneration) &&
          current.completedLifecycleAt &&
          compareObservedAt(
            candidateCompletion.completedAt,
            current.completedLifecycleAt
          ) === 1))
    );
    if (!carriesCurrentOrNewerCompletion) return { accepted: false };
  }
  if (candidateOperation && current.completedLifecycleOperationId) {
    const completedComparison = compareWorkerLifecycleOperationIds(
      candidateOperation,
      current.completedLifecycleOperationId
    );
    const carriesCurrentCompletion = Boolean(
      candidateCompletion.operationId ===
        current.completedLifecycleOperationId &&
      candidateCompletion.runtimeGeneration ===
        current.completedLifecycleRuntimeGeneration &&
      candidateCompletion.completedAt === current.completedLifecycleAt
    );
    if (
      completedComparison === 0 ||
      completedComparison === -1 ||
      (completedComparison === undefined && !carriesCurrentCompletion)
    ) {
      return { accepted: false };
    }
  }

  if (current.lifecycleOperationId) {
    if (!candidateOperation) {
      const exactCompletion = Boolean(
        candidateCompletion.operationId === current.lifecycleOperationId &&
        candidateCompletion.runtimeGeneration &&
        candidateCompletion.runtimeGeneration === candidateGeneration &&
        (!currentGeneration ||
          candidateCompletion.runtimeGeneration >= currentGeneration)
      );
      if (!exactCompletion) return { accepted: false };
      return {
        accepted: true,
        snapshot: {
          ...candidate,
          ...mergeNativeProjection(current, candidate),
          lifecycleOperationId: null,
          recreateBaselineConnectionStatusOrder: null,
          recreatePhase: null,
          recreatePhaseObservedAt: null,
          recreateRuntimeRetired: false,
        },
      };
    }
    const operationComparison = compareWorkerLifecycleOperationIds(
      candidateOperation,
      current.lifecycleOperationId
    );
    if (operationComparison !== 0) {
      const carriesExactCurrentCompletion = Boolean(
        candidateCompletion.operationId === current.lifecycleOperationId &&
        candidateCompletion.runtimeGeneration &&
        candidateGeneration &&
        candidateCompletion.runtimeGeneration <= candidateGeneration &&
        (!currentGeneration ||
          candidateCompletion.runtimeGeneration >= currentGeneration) &&
        candidateCompletion.completedAt
      );
      if (operationComparison !== 1 && !carriesExactCurrentCompletion) {
        return { accepted: false };
      }
      const completion = newerCompletionMarker(
        currentCompletion(current),
        candidateCompletion
      );
      const nextPhase =
        candidate.recreatePhase ?? EWorkerRecreatePhase.recreating;
      return {
        accepted: true,
        snapshot: withCompletion(
          {
            ...candidate,
            ...clearedNativeProjection(
              current,
              candidate.connectionStatusObservedAt
            ),
            recreateBaselineConnectionStatusOrder:
              current.connectionStatusOrder,
            recreatePhase: nextPhase,
            recreatePhaseObservedAt: candidate.recreatePhaseObservedAt,
            recreateRuntimeRetired: candidate.recreateRuntimeRetired,
          },
          completion
        ),
      };
    }
    if (
      currentGeneration &&
      candidateGeneration &&
      candidateGeneration < currentGeneration
    ) {
      return { accepted: false };
    }
    const generationAdvanced = Boolean(
      candidateGeneration &&
      currentGeneration &&
      candidateGeneration > currentGeneration
    );
    const phaseTransition = reduceRecreatePhaseMarker({
      currentPhase: current.recreatePhase,
      currentObservedAt: current.recreatePhaseObservedAt,
      currentRuntimeRetired: current.recreateRuntimeRetired,
      candidatePhase: candidate.recreatePhase,
      candidateObservedAt: candidate.recreatePhaseObservedAt,
      candidateRuntimeRetired: candidate.recreateRuntimeRetired,
      generationAdvanced,
    });
    if (!phaseTransition.accepted) return { accepted: false };
    const recreatePhase = phaseTransition.phase;
    const baselineOrder = current.recreateBaselineConnectionStatusOrder;
    const nativeBase = generationAdvanced
      ? {
          ...current,
          ...clearedNativeProjection(
            current,
            candidate.connectionStatusObservedAt
          ),
        }
      : current;
    const native =
      recreatePhase === EWorkerRecreatePhase.connecting
        ? mergeNativeProjection(nativeBase, candidate, baselineOrder)
        : clearedNativeProjection(
            nativeBase,
            candidate.connectionStatusObservedAt
          );
    return {
      accepted: true,
      snapshot: withCompletion(
        {
          ...candidate,
          ...native,
          workerStatusId: EWorkerStatus.recreating,
          runtimeGeneration: candidateGeneration ?? currentGeneration,
          lifecycleOperationId: current.lifecycleOperationId,
          recreateBaselineConnectionStatusOrder: baselineOrder,
          recreatePhase,
          recreatePhaseObservedAt: phaseTransition.observedAt,
          recreateRuntimeRetired: phaseTransition.runtimeRetired,
        },
        currentCompletion(current)
      ),
    };
  }

  if (candidateOperation) {
    const completion = newerCompletionMarker(
      currentCompletion(current),
      candidateCompletion
    );
    const phase = candidate.recreatePhase ?? EWorkerRecreatePhase.recreating;
    return {
      accepted: true,
      snapshot: withCompletion(
        {
          ...candidate,
          ...(phase === EWorkerRecreatePhase.connecting
            ? mergeNativeProjection(current, candidate)
            : clearedNativeProjection(
                current,
                candidate.connectionStatusObservedAt
              )),
          workerStatusId: EWorkerStatus.recreating,
          recreateBaselineConnectionStatusOrder: current.connectionStatusOrder,
          recreatePhase: phase,
          recreatePhaseObservedAt: candidate.recreatePhaseObservedAt,
          recreateRuntimeRetired: candidate.recreateRuntimeRetired,
        },
        completion
      ),
    };
  }

  const completion = newerCompletionMarker(
    currentCompletion(current),
    candidateCompletion
  );
  return {
    accepted: true,
    snapshot: withCompletion(
      {
        ...candidate,
        ...mergeNativeProjection(current, candidate),
        runtimeGeneration: candidateGeneration ?? currentGeneration,
        lifecycleOperationId: null,
        recreateBaselineConnectionStatusOrder: null,
        recreatePhase: null,
        recreatePhaseObservedAt: null,
        recreateRuntimeRetired: false,
      },
      completion
    ),
  };
};

const reduceInitialCreationHydration = (input: {
  current?: ChannelStatusPresentationSnapshot;
  candidate: ChannelStatusPresentationSnapshot;
  operationId?: string;
}): ChannelStatusPresentationReduction | undefined => {
  const { current, candidate, operationId } = input;
  if (
    !current ||
    !operationId ||
    current.lifecycleOperationId !== operationId
  ) {
    return undefined;
  }
  if (
    current.workerTypeId &&
    candidate.workerTypeId &&
    current.workerTypeId !== candidate.workerTypeId
  ) {
    return { accepted: false };
  }
  if (
    current.runtimeGeneration &&
    candidate.runtimeGeneration &&
    candidate.runtimeGeneration < current.runtimeGeneration
  ) {
    return { accepted: false };
  }

  if (candidate.lifecycleOperationId === operationId) {
    return {
      accepted: true,
      snapshot: {
        ...candidate,
        ...clearedNativeProjection(
          current,
          candidate.connectionStatusObservedAt
        ),
        workerStatusId: EWorkerStatus.creating,
        runtimeGeneration:
          candidate.runtimeGeneration ?? current.runtimeGeneration,
        lifecycleOperationId: operationId,
        completedLifecycleOperationId: null,
        completedLifecycleRuntimeGeneration: null,
        completedLifecycleAt: null,
        recreateBaselineConnectionStatusOrder: null,
        recreatePhase: null,
        recreatePhaseObservedAt: null,
        recreateRuntimeRetired: false,
      },
    };
  }

  const terminalStatus =
    candidate.workerStatusId &&
    candidate.workerStatusId !== EWorkerStatus.new &&
    candidate.workerStatusId !== EWorkerStatus.creating &&
    candidate.workerStatusId !== EWorkerStatus.recreating;
  if (
    candidate.lifecycleOperationId !== null ||
    !candidate.runtimeGeneration ||
    !terminalStatus
  ) {
    return { accepted: false };
  }

  return {
    accepted: true,
    snapshot: {
      ...candidate,
      ...mergeNativeProjection(current, candidate),
      lifecycleOperationId: null,
      completedLifecycleOperationId: null,
      completedLifecycleRuntimeGeneration: null,
      completedLifecycleAt: null,
      recreateBaselineConnectionStatusOrder: null,
      recreatePhase: null,
      recreatePhaseObservedAt: null,
      recreateRuntimeRetired: false,
    },
  };
};

/**
 * A failed provider handoff is not a successful recreate and therefore does
 * not persist a `recreate_completed_*` tombstone. Its recovery journal is the
 * independent durable proof that the exact source runtime was restored. This
 * reduction is deliberately narrower than ordinary hydration: it releases
 * only the active handoff operation and only from a fresh, acknowledged,
 * source-provider ONLINE worker projection.
 */
const providerHandoffSourceRecoveryProof = (
  current: ChannelStatusPresentationSnapshot | undefined,
  candidate: ChannelStatusPresentationSnapshot,
  handoff: WhatsappProviderHandoffView
): ProviderHandoffSourceRecoveryProof | null => {
  const lifecycleOperationId =
    normalizeWorkerLifecycleOperationId(handoff.lifecycle_operation_id) ?? null;
  const handoffOperationId =
    normalizeWorkerLifecycleOperationId(
      handoff.handoff_lifecycle_operation_id ?? handoff.lifecycle_operation_id
    ) ?? null;
  const resolutionOperationId =
    normalizeWorkerLifecycleOperationId(handoff.resolution_operation_id) ??
    null;
  const automaticRecoveryPendingDecision =
    handoff.resolution_required === true &&
    handoff.resolution_action === null &&
    handoff.resolution_state === null &&
    handoff.resolution_operation_id === null &&
    handoff.resolution_status === 'awaiting_decision';
  const completedExplicitReturn =
    handoff.resolution_required === false &&
    handoff.resolution_action === 'return' &&
    handoff.resolution_state === 'completed' &&
    resolutionOperationId !== null &&
    handoff.resolution_status === 'completed';
  const durableLifecycleOperationMatches =
    lifecycleOperationId === handoffOperationId ||
    (completedExplicitReturn && lifecycleOperationId === resolutionOperationId);
  const candidateProvider =
    providerByWorkerTypeId[candidate.workerTypeId ?? ''];
  const activeLifecycle = current?.lifecycleOperationId ?? null;
  const currentProjectsRecoveredSource = Boolean(
    current &&
    providerByWorkerTypeId[current.workerTypeId ?? ''] ===
      handoff.source_provider &&
    (activeLifecycle !== null ||
      current.workerStatusId === EWorkerStatus.online) &&
    current.connectionStatus === 'online' &&
    current.connectionOnlineAcknowledged === true
  );
  const alreadyProjectsRecoveredSource = Boolean(
    currentProjectsRecoveredSource &&
    activeLifecycle === null &&
    current?.recreatePhase === null
  );
  const activeLifecycleCarriesRecoveredSource = Boolean(
    currentProjectsRecoveredSource &&
    activeLifecycle !== null &&
    current?.recreatePhaseObservedAt
  );
  const explicitBaselineOrder =
    current?.recreateBaselineConnectionStatusOrder ?? null;
  const baselineOrder =
    explicitBaselineOrder ?? current?.connectionStatusOrder ?? null;
  const canReuseCurrentOrderWithoutExplicitBaseline = Boolean(
    !explicitBaselineOrder &&
    (alreadyProjectsRecoveredSource || activeLifecycleCarriesRecoveredSource)
  );
  const canReuseExplicitBaselineForCompletedReturn = Boolean(
    explicitBaselineOrder && completedExplicitReturn && activeLifecycle
  );
  const candidateFollowsBaseline = Boolean(
    baselineOrder &&
    candidate.connectionStatusOrder &&
    (canReuseCurrentOrderWithoutExplicitBaseline ||
    canReuseExplicitBaselineForCompletedReturn
      ? compareWhatsappConnectionStatusOrders(
          candidate.connectionStatusOrder,
          baselineOrder
        ) >= 0
      : compareWhatsappConnectionStatusOrders(
          candidate.connectionStatusOrder,
          baselineOrder
        ) > 0)
  );
  const candidateDoesNotRegressRecoveredSource = Boolean(
    !currentProjectsRecoveredSource ||
    (current?.connectionStatusOrder &&
      candidate.connectionStatusOrder &&
      compareWhatsappConnectionStatusOrders(
        candidate.connectionStatusOrder,
        current.connectionStatusOrder
      ) >= 0)
  );
  const candidateFollowsLifecycle = Boolean(
    candidate.connectionStatusObservedAt &&
    (current?.recreatePhaseObservedAt
      ? compareObservedAt(
          candidate.connectionStatusObservedAt,
          current.recreatePhaseObservedAt
        ) === 1
      : current?.connectionStatusObservedAt
        ? alreadyProjectsRecoveredSource
          ? compareObservedAt(
              candidate.connectionStatusObservedAt,
              current.connectionStatusObservedAt
            ) !== -1
          : compareObservedAt(
              candidate.connectionStatusObservedAt,
              current.connectionStatusObservedAt
            ) === 1
        : false)
  );

  if (
    !current ||
    !lifecycleOperationId ||
    !handoffOperationId ||
    !durableLifecycleOperationMatches ||
    current.workerId !== candidate.workerId ||
    handoff.worker_id !== current.workerId ||
    (!activeLifecycle && !alreadyProjectsRecoveredSource) ||
    (!automaticRecoveryPendingDecision && !completedExplicitReturn) ||
    (automaticRecoveryPendingDecision &&
      activeLifecycle !== null &&
      activeLifecycle !== handoffOperationId) ||
    (completedExplicitReturn &&
      activeLifecycle !== null &&
      activeLifecycle !== handoffOperationId &&
      activeLifecycle !== resolutionOperationId) ||
    (activeLifecycle !== null && !current.recreatePhase) ||
    !current.runtimeGeneration ||
    handoff.state !== 'failed' ||
    handoff.recovery_state !== 'completed' ||
    handoff.recovery_error_code !== null ||
    handoff.source_revision_preserved !== true ||
    handoff.source_runtime_restored !== true ||
    handoff.source_provider === handoff.target_provider ||
    candidateProvider !== handoff.source_provider ||
    candidate.workerStatusId !== EWorkerStatus.online ||
    candidate.connectionStatus !== 'online' ||
    candidate.connectionOnlineAcknowledged !== true ||
    !candidate.connectionStatusSourceId ||
    !candidate.connectionStatusOrder ||
    !candidate.connectionStatusObservedAt ||
    !candidate.runtimeGeneration ||
    candidate.lifecycleOperationId !== null ||
    candidate.runtimeGeneration < current.runtimeGeneration ||
    !candidateFollowsBaseline ||
    !candidateDoesNotRegressRecoveredSource ||
    !candidateFollowsLifecycle
  ) {
    return null;
  }

  const terminalOperationId = completedExplicitReturn
    ? resolutionOperationId
    : handoffOperationId;
  if (!terminalOperationId) return null;
  return {
    releasedOperationId: activeLifecycle,
    terminalOperationId,
    operationIds: Array.from(
      new Set(
        [handoffOperationId, resolutionOperationId].filter(
          (operationId): operationId is string => operationId !== null
        )
      )
    ),
    runtimeGeneration: candidate.runtimeGeneration,
    observedAt: candidate.connectionStatusObservedAt,
  };
};

const reduceProviderHandoffSourceRecovery = (
  current: ChannelStatusPresentationSnapshot | undefined,
  candidate: ChannelStatusPresentationSnapshot,
  handoff: WhatsappProviderHandoffView
): ChannelStatusPresentationReduction => {
  if (
    !current ||
    !providerHandoffSourceRecoveryProof(current, candidate, handoff)
  ) {
    return { accepted: false };
  }

  const completion = newerCompletionMarker(
    currentCompletion(current),
    currentCompletion(candidate)
  );
  return {
    accepted: true,
    snapshot: withCompletion(
      {
        ...candidate,
        lifecycleOperationId: null,
        recreateBaselineConnectionStatusOrder: null,
        recreatePhase: null,
        recreatePhaseObservedAt: null,
        recreateRuntimeRetired: false,
      },
      completion
    ),
  };
};

const followsProviderHandoffSourceRecovery = (
  marker: ProviderHandoffSourceRecoveryAcceptance,
  operationId: string,
  runtimeGeneration: number | null
): boolean => {
  if (marker.operationIds.includes(operationId) || !runtimeGeneration) {
    return false;
  }
  const comparison = compareWorkerLifecycleOperationIds(
    operationId,
    marker.terminalOperationId
  );
  if (comparison === 1) {
    return runtimeGeneration >= marker.runtimeGeneration;
  }
  return (
    comparison === undefined &&
    isWorkerLifecycleOperationIdV7(operationId) &&
    runtimeGeneration > marker.runtimeGeneration
  );
};

const providerHandoffSourceRecoveryFenceAllows = (
  marker: ProviderHandoffSourceRecoveryAcceptance | undefined,
  mutation: ChannelStatusPresentationMutation
): boolean => {
  if (!marker || mutation.kind === 'provider_handoff_source_recovery') {
    return true;
  }
  const operationId =
    mutation.kind === 'hydrate'
      ? mutation.snapshot.lifecycleOperationId
      : (normalizeWorkerLifecycleOperationId(
          mutation.event.lifecycle_operation_id
        ) ?? null);
  if (!operationId) return true;
  const runtimeGeneration =
    mutation.kind === 'hydrate'
      ? mutation.snapshot.runtimeGeneration
      : normalizeRuntimeGeneration(mutation.event.runtime_generation);
  return followsProviderHandoffSourceRecovery(
    marker,
    operationId,
    runtimeGeneration
  );
};

const emptySnapshot = (
  event: IBaileysConnectionState,
  workerTypeId: string | null,
  runtimeGeneration: number | null
): ChannelStatusPresentationSnapshot => ({
  workerId: event.worker_id,
  workerTypeId,
  workerStatusId: null,
  sessionIdentityPresent: false,
  // Native telemetry can legitimately arrive before the worker HTTP
  // snapshot. Its envelope may carry a fresh observation clock, but without
  // an authoritative worker status that clock must not fence the later
  // database hydration and leave the channel projected as "unknown".
  workerStatusObservedAt:
    event.event_type === 'status' && event.worker_status_id
      ? normalizeEventWorkerStatusObservedAt(event)
      : null,
  sessionRemovalObservedAt: null,
  connectionStatus: null,
  connectionStatusSourceId: null,
  connectionStatusOrder: null,
  connectionStatusObservedAt: null,
  connectionOnlineAcknowledged: false,
  runtimeGeneration,
  lifecycleOperationId: null,
  completedLifecycleOperationId: null,
  completedLifecycleRuntimeGeneration: null,
  completedLifecycleAt: null,
  recreateBaselineConnectionStatusOrder: null,
  recreatePhase: null,
  recreatePhaseObservedAt: null,
  recreateRuntimeRetired: false,
  source: 'realtime',
});

const lifecycleTypeTransitionAllowed = (
  currentWorkerTypeId: string | null | undefined,
  event: IBaileysConnectionState
): boolean =>
  !currentWorkerTypeId ||
  event.worker_type_id === currentWorkerTypeId ||
  event.previous_worker_type_id === currentWorkerTypeId;

const reduceManagerStart = (
  current: ChannelStatusPresentationSnapshot | undefined,
  event: ManagerWorkerLifecycleStatusEvent
): ChannelStatusPresentationReduction => {
  const operationId =
    normalizeWorkerLifecycleOperationId(event.lifecycle_operation_id) ?? null;
  const eventGeneration = normalizeRuntimeGeneration(event.runtime_generation);
  if (operationId && current?.lifecycleOperationId === operationId) {
    return { accepted: true, snapshot: current };
  }
  if (
    !operationId ||
    !lifecycleTypeTransitionAllowed(current?.workerTypeId, event) ||
    (current?.runtimeGeneration &&
      eventGeneration &&
      eventGeneration < current.runtimeGeneration) ||
    (current?.completedLifecycleOperationId &&
      (compareWorkerLifecycleOperationIds(
        operationId,
        current.completedLifecycleOperationId
      ) ?? -1) <= 0) ||
    (current?.lifecycleOperationId &&
      (compareWorkerLifecycleOperationIds(
        operationId,
        current.lifecycleOperationId
      ) ?? -1) < 0) ||
    (!current?.lifecycleOperationId &&
      !isWorkerLifecycleOperationIdV7(operationId))
  ) {
    return { accepted: false };
  }
  const workerTypeId =
    current?.workerTypeId ??
    normalizeWorkerTypeId(event.previous_worker_type_id) ??
    normalizeWorkerTypeId(event.worker_type_id);
  const base =
    current ?? emptySnapshot(event, workerTypeId, eventGeneration ?? null);
  return {
    accepted: true,
    snapshot: {
      ...base,
      ...clearedNativeProjection(
        base,
        normalizeObservedAt(event.connection_status_observed_at)
      ),
      workerTypeId,
      workerStatusId: EWorkerStatus.recreating,
      sessionIdentityPresent:
        event.remove_session === true
          ? false
          : base.sessionIdentityPresent ||
            event.previous_worker_status_id === EWorkerStatus.online,
      workerStatusObservedAt:
        normalizeEventWorkerStatusObservedAt(event) ??
        base.workerStatusObservedAt,
      runtimeGeneration: eventGeneration ?? base.runtimeGeneration,
      lifecycleOperationId: operationId,
      recreateBaselineConnectionStatusOrder: base.connectionStatusOrder,
      recreatePhase: EWorkerRecreatePhase.recreating,
      // `started` is emitted from the app clock. Keep it outside the durable
      // phase clock so a skewed manager cannot outrank PostgreSQL markers.
      recreatePhaseObservedAt: null,
      recreateRuntimeRetired: false,
      source: 'realtime',
    },
  };
};

const reduceManagerRuntimeStarted = (
  current: ChannelStatusPresentationSnapshot | undefined,
  event: ManagerWorkerRecreateRuntimeStartedStatusEvent
): ChannelStatusPresentationReduction => {
  const operationId =
    normalizeWorkerLifecycleOperationId(event.lifecycle_operation_id) ?? null;
  const generation = normalizeRuntimeGeneration(event.runtime_generation);
  const workerTypeId = normalizeWorkerTypeId(event.worker_type_id);
  const phaseObservedAt = normalizeObservedAt(event.recreate_phase_observed_at);
  if (
    !operationId ||
    !generation ||
    !workerTypeId ||
    !phaseObservedAt ||
    (current?.runtimeGeneration !== null &&
      current?.runtimeGeneration !== undefined &&
      generation < current.runtimeGeneration) ||
    !lifecycleTypeTransitionAllowed(current?.workerTypeId, event) ||
    current?.completedLifecycleOperationId === operationId
  ) {
    return { accepted: false };
  }
  if (!current?.lifecycleOperationId) {
    const eventObservedAt = normalizeObservedAt(
      event.connection_status_observed_at
    );
    const completedComparison = current?.completedLifecycleOperationId
      ? compareWorkerLifecycleOperationIds(
          operationId,
          current.completedLifecycleOperationId
        )
      : 1;
    const followsCompletedTombstone = Boolean(
      !current?.completedLifecycleOperationId ||
      (completedComparison === 1 &&
        current.completedLifecycleRuntimeGeneration &&
        generation > current.completedLifecycleRuntimeGeneration &&
        current.completedLifecycleAt &&
        compareObservedAt(eventObservedAt, current.completedLifecycleAt) === 1)
    );
    if (
      !current?.workerTypeId ||
      !current.runtimeGeneration ||
      !isWorkerLifecycleOperationIdV7(operationId) ||
      generation <= current.runtimeGeneration ||
      !followsCompletedTombstone
    ) {
      return { accepted: false };
    }
    const base = current;
    return {
      accepted: true,
      snapshot: {
        ...base,
        ...clearedNativeProjection(
          base,
          normalizeObservedAt(event.connection_status_observed_at)
        ),
        workerTypeId,
        workerStatusId: EWorkerStatus.recreating,
        sessionIdentityPresent:
          event.remove_session === true
            ? false
            : base.sessionIdentityPresent ||
              event.previous_worker_status_id === EWorkerStatus.online,
        workerStatusObservedAt: phaseObservedAt,
        runtimeGeneration: generation,
        lifecycleOperationId: operationId,
        recreateBaselineConnectionStatusOrder: base.connectionStatusOrder,
        recreatePhase: EWorkerRecreatePhase.connecting,
        recreatePhaseObservedAt: phaseObservedAt,
        recreateRuntimeRetired: false,
        source: 'realtime',
      },
    };
  }
  if (
    operationId !== current.lifecycleOperationId ||
    current.completedLifecycleOperationId === operationId
  ) {
    return { accepted: false };
  }
  const generationAdvanced = Boolean(
    current.runtimeGeneration && generation > current.runtimeGeneration
  );
  const phaseTransition = reduceRecreatePhaseMarker({
    currentPhase: current.recreatePhase,
    currentObservedAt: current.recreatePhaseObservedAt,
    currentRuntimeRetired: current.recreateRuntimeRetired,
    candidatePhase: EWorkerRecreatePhase.connecting,
    candidateObservedAt: phaseObservedAt,
    candidateRuntimeRetired: false,
    generationAdvanced,
  });
  if (!phaseTransition.accepted) return { accepted: false };
  return {
    accepted: true,
    snapshot: {
      ...current,
      ...clearedNativeProjection(
        current,
        normalizeObservedAt(event.connection_status_observed_at)
      ),
      workerTypeId,
      workerStatusId: EWorkerStatus.recreating,
      sessionIdentityPresent:
        event.remove_session === true
          ? false
          : current.sessionIdentityPresent ||
            event.previous_worker_status_id === EWorkerStatus.online,
      workerStatusObservedAt: phaseObservedAt,
      runtimeGeneration: generation,
      recreatePhase: phaseTransition.phase,
      recreatePhaseObservedAt: phaseTransition.observedAt,
      recreateRuntimeRetired: phaseTransition.runtimeRetired,
      source: 'realtime',
    },
  };
};

const reduceManagerRuntimeRetired = (
  current: ChannelStatusPresentationSnapshot | undefined,
  event: IBaileysConnectionState
): ChannelStatusPresentationReduction => {
  const operationId =
    normalizeWorkerLifecycleOperationId(event.lifecycle_operation_id) ?? null;
  const generation = normalizeRuntimeGeneration(event.runtime_generation);
  const workerTypeId = normalizeWorkerTypeId(event.worker_type_id);
  const phaseObservedAt = normalizeObservedAt(event.recreate_phase_observed_at);
  if (
    !operationId ||
    !generation ||
    !workerTypeId ||
    !phaseObservedAt ||
    (current?.runtimeGeneration !== null &&
      current?.runtimeGeneration !== undefined &&
      generation < current.runtimeGeneration) ||
    !lifecycleTypeTransitionAllowed(current?.workerTypeId, event) ||
    current?.completedLifecycleOperationId === operationId
  ) {
    return { accepted: false };
  }

  if (!current?.lifecycleOperationId) {
    const completedComparison = current?.completedLifecycleOperationId
      ? compareWorkerLifecycleOperationIds(
          operationId,
          current.completedLifecycleOperationId
        )
      : 1;
    const followsCompletedTombstone = Boolean(
      !current?.completedLifecycleOperationId ||
      (completedComparison === 1 &&
        current.completedLifecycleRuntimeGeneration &&
        generation > current.completedLifecycleRuntimeGeneration &&
        current.completedLifecycleAt &&
        compareObservedAt(phaseObservedAt, current.completedLifecycleAt) === 1)
    );
    if (
      !current?.workerTypeId ||
      !current.runtimeGeneration ||
      !isWorkerLifecycleOperationIdV7(operationId) ||
      generation <= current.runtimeGeneration ||
      !followsCompletedTombstone
    ) {
      return { accepted: false };
    }
    return {
      accepted: true,
      snapshot: {
        ...current,
        ...clearedNativeProjection(current, phaseObservedAt),
        workerTypeId,
        workerStatusId: EWorkerStatus.recreating,
        workerStatusObservedAt: phaseObservedAt,
        runtimeGeneration: generation,
        lifecycleOperationId: operationId,
        recreateBaselineConnectionStatusOrder: current.connectionStatusOrder,
        recreatePhase: EWorkerRecreatePhase.recreating,
        recreatePhaseObservedAt: phaseObservedAt,
        recreateRuntimeRetired: true,
        source: 'realtime',
      },
    };
  }

  if (operationId !== current.lifecycleOperationId) {
    return { accepted: false };
  }
  const generationAdvanced = Boolean(
    current.runtimeGeneration && generation > current.runtimeGeneration
  );
  const phaseTransition = reduceRecreatePhaseMarker({
    currentPhase: current.recreatePhase,
    currentObservedAt: current.recreatePhaseObservedAt,
    currentRuntimeRetired: current.recreateRuntimeRetired,
    candidatePhase: EWorkerRecreatePhase.recreating,
    candidateObservedAt: phaseObservedAt,
    candidateRuntimeRetired: true,
    generationAdvanced,
  });
  if (!phaseTransition.accepted) return { accepted: false };
  if (
    current.recreatePhase === phaseTransition.phase &&
    current.recreatePhaseObservedAt === phaseTransition.observedAt &&
    current.recreateRuntimeRetired === phaseTransition.runtimeRetired &&
    current.runtimeGeneration === generation &&
    current.workerTypeId === workerTypeId
  ) {
    return { accepted: true, snapshot: current };
  }
  return {
    accepted: true,
    snapshot: {
      ...current,
      ...clearedNativeProjection(current, phaseObservedAt),
      workerTypeId,
      workerStatusId: EWorkerStatus.recreating,
      workerStatusObservedAt: phaseObservedAt,
      runtimeGeneration: generation,
      recreatePhase: phaseTransition.phase,
      recreatePhaseObservedAt: phaseTransition.observedAt,
      recreateRuntimeRetired: phaseTransition.runtimeRetired,
      source: 'realtime',
    },
  };
};

const reduceManagerCompletion = (
  current: ChannelStatusPresentationSnapshot | undefined,
  event: IBaileysConnectionState
): ChannelStatusPresentationReduction => {
  const operationId =
    normalizeWorkerLifecycleOperationId(event.lifecycle_operation_id) ?? null;
  const generation = normalizeRuntimeGeneration(event.runtime_generation);
  const completedAt = normalizeObservedAt(event.recreate_completed_at);
  const eventObservedAt = normalizeObservedAt(
    event.connection_status_observed_at
  );
  if (
    operationId &&
    current?.completedLifecycleOperationId === operationId &&
    !current.lifecycleOperationId
  ) {
    return generation === current.completedLifecycleRuntimeGeneration &&
      completedAt === current.completedLifecycleAt &&
      eventObservedAt === completedAt
      ? { accepted: true, snapshot: current }
      : { accepted: false };
  }
  if (
    !operationId ||
    !generation ||
    !completedAt ||
    eventObservedAt !== completedAt ||
    event.recreate_completed_operation_id !== operationId ||
    event.recreate_completed_runtime_generation !== generation ||
    (current?.runtimeGeneration !== null &&
      current?.runtimeGeneration !== undefined &&
      generation < current.runtimeGeneration) ||
    !lifecycleTypeTransitionAllowed(current?.workerTypeId, event)
  ) {
    return { accepted: false };
  }
  if (
    current?.lifecycleOperationId &&
    operationId !== current.lifecycleOperationId
  ) {
    return { accepted: false };
  }

  // A terminal publication may legitimately be the first lifecycle event this
  // tab observes. Establishing an operation from that event is intentionally
  // stricter than completing an operation already proven by HTTP/`started`:
  // only an ordered UUIDv7, a fully verifiable type+generation+time baseline,
  // and the exact self tombstone may advance the state. Recovery UUIDv4 values
  // remain equality-only and therefore require a durable active operation.
  if (!current?.lifecycleOperationId) {
    const currentGeneration = current?.runtimeGeneration;
    const sameRuntimeWasRevalidated = Boolean(
      current &&
      generation === currentGeneration &&
      event.reason === 'liveness_runtime_recovered_before_recreate' &&
      event.worker_status_id === EWorkerStatus.online &&
      event.worker_type_id === current.workerTypeId
    );
    const completionComparison = current?.completedLifecycleOperationId
      ? compareWorkerLifecycleOperationIds(
          operationId,
          current.completedLifecycleOperationId
        )
      : 1;
    const followsCompletedTombstone = Boolean(
      !current?.completedLifecycleOperationId ||
      (completionComparison === 1 &&
        current.completedLifecycleRuntimeGeneration &&
        generation >= current.completedLifecycleRuntimeGeneration &&
        current.completedLifecycleAt &&
        compareObservedAt(completedAt, current.completedLifecycleAt) === 1)
    );
    if (
      !current?.workerTypeId ||
      !currentGeneration ||
      !current.connectionStatusObservedAt ||
      !isWorkerLifecycleOperationIdV7(operationId) ||
      (generation <= currentGeneration && !sameRuntimeWasRevalidated) ||
      compareObservedAt(completedAt, current.connectionStatusObservedAt) !==
        1 ||
      !followsCompletedTombstone
    ) {
      return { accepted: false };
    }
  }
  const workerTypeId =
    normalizeWorkerTypeId(event.worker_type_id) ??
    current?.workerTypeId ??
    null;
  const base = current ?? emptySnapshot(event, workerTypeId, generation);
  const online = event.worker_status_id === EWorkerStatus.online;
  return {
    accepted: true,
    snapshot: {
      ...base,
      workerTypeId,
      workerStatusId: online ? EWorkerStatus.online : EWorkerStatus.disponible,
      sessionIdentityPresent: online,
      workerStatusObservedAt:
        normalizeEventWorkerStatusObservedAt(event) ?? completedAt,
      connectionStatus: online ? 'online' : null,
      connectionStatusSourceId: base.connectionStatusSourceId,
      connectionStatusOrder: base.connectionStatusOrder,
      connectionStatusObservedAt: completedAt,
      connectionOnlineAcknowledged: online,
      runtimeGeneration: generation,
      lifecycleOperationId: null,
      completedLifecycleOperationId: operationId,
      completedLifecycleRuntimeGeneration: generation,
      completedLifecycleAt: completedAt,
      recreateBaselineConnectionStatusOrder: null,
      recreatePhase: null,
      recreatePhaseObservedAt: null,
      recreateRuntimeRetired: false,
      source: 'realtime',
    },
  };
};

const reduceNativeRealtime = (
  current: ChannelStatusPresentationSnapshot | undefined,
  event: IBaileysConnectionState
): ChannelStatusPresentationReduction => {
  const workerTypeId =
    normalizeWorkerTypeId(event.worker_type_id) ??
    current?.workerTypeId ??
    null;
  const provider = providerByWorkerTypeId[workerTypeId ?? ''];
  const native = provider
    ? normalizeWhatsappConnectionStatus(event.connection_status, provider)
    : undefined;
  const sourceId =
    normalizeWhatsappConnectionStatusSourceId(
      event.connection_status_source_id
    ) ?? null;
  const order =
    normalizeWhatsappConnectionStatusOrder(event.connection_status_order) ??
    null;
  const generation = normalizeRuntimeGeneration(event.runtime_generation);
  const observedAt = normalizeObservedAt(event.connection_status_observed_at);
  const nativeChangedAt = native ? normalizeObservedAt(native.changedAt) : null;
  if (!native || !sourceId || !order || !generation) {
    return { accepted: false };
  }

  if (current?.lifecycleOperationId) {
    const operationId =
      normalizeWorkerLifecycleOperationId(event.lifecycle_operation_id) ?? null;
    const requestedPhase = normalizeRecreatePhase(event.recreate_phase);
    const phaseObservedAt = normalizeObservedAt(
      event.recreate_phase_observed_at
    );
    const requestedRuntimeRetired = event.recreate_runtime_retired === true;
    if (
      operationId !== current.lifecycleOperationId ||
      !requestedPhase ||
      !phaseObservedAt ||
      typeof event.recreate_runtime_retired !== 'boolean' ||
      (current.runtimeGeneration !== null &&
        generation < current.runtimeGeneration)
    ) {
      return { accepted: false };
    }
    const generationAdvanced = Boolean(
      current.runtimeGeneration && generation > current.runtimeGeneration
    );
    const phaseTransition = reduceRecreatePhaseMarker({
      currentPhase: current.recreatePhase,
      currentObservedAt: current.recreatePhaseObservedAt,
      currentRuntimeRetired: current.recreateRuntimeRetired,
      candidatePhase: requestedPhase,
      candidateObservedAt: phaseObservedAt,
      candidateRuntimeRetired: requestedRuntimeRetired,
      generationAdvanced,
    });
    if (!phaseTransition.accepted) return { accepted: false };
    const baselineOrder = current.recreateBaselineConnectionStatusOrder;
    if (
      baselineOrder &&
      compareWhatsappConnectionStatusOrders(order, baselineOrder) <= 0
    ) {
      return { accepted: false };
    }
    const publicStatus = projectWhatsappConnectionPublicStatus(native) ?? null;
    const phase = phaseTransition.phase;
    const candidate: ChannelStatusPresentationSnapshot = {
      ...current,
      workerTypeId,
      workerStatusId: EWorkerStatus.recreating,
      workerStatusObservedAt:
        normalizeEventWorkerStatusObservedAt(event) ??
        current.workerStatusObservedAt,
      connectionStatus: publicStatus,
      connectionStatusSourceId: sourceId,
      connectionStatusOrder: order,
      connectionStatusObservedAt: observedAt,
      connectionOnlineAcknowledged:
        publicStatus === 'online' &&
        event.connection_online_acknowledged === true &&
        observedAt !== null,
      runtimeGeneration: generation,
      recreatePhase: phase,
      recreatePhaseObservedAt: phaseTransition.observedAt,
      recreateRuntimeRetired: phaseTransition.runtimeRetired,
      source: 'realtime',
    };
    if (phase === EWorkerRecreatePhase.recreating) {
      return {
        accepted: true,
        snapshot: {
          ...candidate,
          ...clearedNativeProjection(
            current,
            candidate.connectionStatusObservedAt
          ),
        },
      };
    }
    const nativeBase = generationAdvanced
      ? {
          ...current,
          ...clearedNativeProjection(
            current,
            candidate.connectionStatusObservedAt
          ),
        }
      : current;
    return {
      accepted: true,
      snapshot: {
        ...candidate,
        ...mergeNativeProjection(nativeBase, candidate, baselineOrder),
        recreatePhase: EWorkerRecreatePhase.connecting,
        recreatePhaseObservedAt: phaseTransition.observedAt,
        recreateRuntimeRetired: false,
      },
    };
  }

  if (
    event.lifecycle_operation_id !== undefined ||
    event.recreate_phase !== undefined ||
    event.recreate_phase_observed_at !== undefined ||
    event.recreate_runtime_retired !== undefined
  ) {
    return { accepted: false };
  }
  if (
    current?.completedLifecycleAt &&
    current.completedLifecycleRuntimeGeneration === generation &&
    (compareObservedAt(observedAt, current.completedLifecycleAt) !== 1 ||
      compareObservedAt(nativeChangedAt, current.completedLifecycleAt) !== 1)
  ) {
    return { accepted: false };
  }
  const fence = evaluateWhatsappRealtimeStatusFence({
    persistedWorkerTypeId: current?.workerTypeId,
    eventWorkerTypeId: event.worker_type_id,
    persistedRuntimeGeneration: current?.runtimeGeneration,
    eventRuntimeGeneration: event.runtime_generation,
    persistedConnectionStatusOrder: current?.connectionStatusOrder,
    hasValidatedNativeProjection: true,
  });
  if (!fence.accepted || !fence.runtimeGeneration) {
    return { accepted: false };
  }
  const publicStatus = projectWhatsappConnectionPublicStatus(native) ?? null;
  const candidate: ChannelStatusPresentationSnapshot = {
    ...(current ?? emptySnapshot(event, fence.workerTypeId, generation)),
    workerId: event.worker_id,
    workerTypeId: fence.workerTypeId,
    workerStatusId:
      event.event_type === 'status' && event.worker_status_id
        ? event.worker_status_id
        : (current?.workerStatusId ?? null),
    sessionIdentityPresent:
      event.event_type === 'status' &&
      event.worker_status_id === EWorkerStatus.online
        ? true
        : event.event_type === 'status' &&
            event.worker_status_id === EWorkerStatus.disponible
          ? false
          : (current?.sessionIdentityPresent ?? false),
    workerStatusObservedAt:
      event.event_type === 'status' && event.worker_status_id
        ? (normalizeEventWorkerStatusObservedAt(event) ??
          current?.workerStatusObservedAt ??
          null)
        : (current?.workerStatusObservedAt ?? null),
    connectionStatus: publicStatus,
    connectionStatusSourceId: sourceId,
    connectionStatusOrder: order,
    connectionStatusObservedAt: observedAt,
    connectionOnlineAcknowledged:
      publicStatus === 'online' &&
      event.connection_online_acknowledged === true &&
      observedAt !== null,
    runtimeGeneration: fence.runtimeGeneration,
    lifecycleOperationId: null,
    recreateBaselineConnectionStatusOrder: null,
    recreatePhase: null,
    recreatePhaseObservedAt: null,
    recreateRuntimeRetired: false,
    source: 'realtime',
  };
  if (!current) return { accepted: true, snapshot: candidate };
  return {
    accepted: true,
    snapshot: { ...candidate, ...mergeNativeProjection(current, candidate) },
  };
};

const reduceRawRealtime = (
  current: ChannelStatusPresentationSnapshot | undefined,
  event: IBaileysConnectionState
): ChannelStatusPresentationReduction => {
  if (
    event.event_type !== 'status' ||
    !event.worker_status_id ||
    current?.lifecycleOperationId
  ) {
    return { accepted: false };
  }
  const fence = evaluateWhatsappRealtimeStatusFence({
    persistedWorkerTypeId: current?.workerTypeId,
    eventWorkerTypeId: event.worker_type_id,
    persistedRuntimeGeneration: current?.runtimeGeneration,
    eventRuntimeGeneration: event.runtime_generation,
    persistedConnectionStatusOrder: current?.connectionStatusOrder,
    hasValidatedNativeProjection: false,
  });
  if (!fence.accepted) return { accepted: false };
  const generation =
    fence.runtimeGeneration ?? current?.runtimeGeneration ?? null;
  if (
    current?.completedLifecycleAt &&
    current.completedLifecycleRuntimeGeneration === generation
  ) {
    return { accepted: false };
  }
  const observedAt = normalizeObservedAt(event.connection_status_observed_at);
  const base = current ?? emptySnapshot(event, fence.workerTypeId, generation);
  const generationAdvanced = Boolean(
    generation &&
    (!current?.runtimeGeneration || generation > current.runtimeGeneration)
  );
  return {
    accepted: true,
    snapshot: {
      ...base,
      ...(generationAdvanced ? clearedNativeProjection(base, observedAt) : {}),
      workerTypeId: fence.workerTypeId,
      workerStatusId: event.worker_status_id,
      sessionIdentityPresent:
        event.worker_status_id === EWorkerStatus.online
          ? true
          : event.worker_status_id === EWorkerStatus.disponible
            ? false
            : base.sessionIdentityPresent,
      workerStatusObservedAt:
        normalizeEventWorkerStatusObservedAt(event) ??
        base.workerStatusObservedAt,
      connectionOnlineAcknowledged:
        event.worker_status_id === EWorkerStatus.online &&
        base.connectionOnlineAcknowledged,
      runtimeGeneration: generation,
      lifecycleOperationId: null,
      recreateBaselineConnectionStatusOrder: null,
      recreatePhase: null,
      recreatePhaseObservedAt: null,
      recreateRuntimeRetired: false,
      source: 'realtime',
    },
  };
};

const reduceManagerPairingReady = (
  current: ChannelStatusPresentationSnapshot | undefined,
  event: IBaileysConnectionState
): ChannelStatusPresentationReduction => {
  if (!isManagerPairingReadyPublication(event)) {
    return { accepted: false };
  }
  const workerTypeId = normalizeWorkerTypeId(event.worker_type_id);
  const runtimeGeneration = normalizeRuntimeGeneration(
    event.runtime_generation
  );
  const observedAt = normalizeEventWorkerStatusObservedAt(event);
  if (
    !workerTypeId ||
    !runtimeGeneration ||
    !observedAt ||
    current?.lifecycleOperationId ||
    (current?.workerTypeId && current.workerTypeId !== workerTypeId) ||
    (current?.runtimeGeneration &&
      runtimeGeneration < current.runtimeGeneration) ||
    (current?.workerStatusObservedAt &&
      compareObservedAt(observedAt, current.workerStatusObservedAt) !== 1)
  ) {
    return { accepted: false };
  }

  const base = current ?? emptySnapshot(event, workerTypeId, runtimeGeneration);
  return {
    accepted: true,
    snapshot: {
      ...base,
      ...clearedNativeProjection(base, observedAt),
      workerTypeId,
      workerStatusId: EWorkerStatus.disponible,
      sessionIdentityPresent: false,
      workerStatusObservedAt: observedAt,
      sessionRemovalObservedAt: null,
      runtimeGeneration,
      lifecycleOperationId: null,
      completedLifecycleOperationId: null,
      completedLifecycleRuntimeGeneration: null,
      completedLifecycleAt: null,
      recreateBaselineConnectionStatusOrder: null,
      recreatePhase: null,
      recreatePhaseObservedAt: null,
      recreateRuntimeRetired: false,
      source: 'realtime',
    },
  };
};

const reduceSessionRemovalTerminal = (
  current: ChannelStatusPresentationSnapshot | undefined,
  event: IBaileysConnectionState
): ChannelStatusPresentationReduction => {
  if (!isSessionRemovalTerminalPublication(event)) {
    return { accepted: false };
  }
  const runtimeGeneration = normalizeRuntimeGeneration(
    event.runtime_generation
  );
  const observedAt = normalizeEventWorkerStatusObservedAt(event);
  const workerTypeId =
    normalizeWorkerTypeId(event.worker_type_id) ??
    current?.workerTypeId ??
    null;
  if (
    !runtimeGeneration ||
    !observedAt ||
    (current?.runtimeGeneration !== null &&
      current?.runtimeGeneration !== undefined &&
      runtimeGeneration < current.runtimeGeneration) ||
    (current?.workerTypeId &&
      workerTypeId &&
      current.workerTypeId !== workerTypeId) ||
    (current && snapshotHasObservationAfter(current, observedAt))
  ) {
    return { accepted: false };
  }

  const base = current ?? emptySnapshot(event, workerTypeId, runtimeGeneration);
  return {
    accepted: true,
    snapshot: {
      ...base,
      workerTypeId,
      workerStatusId: EWorkerStatus.disponible,
      sessionIdentityPresent: false,
      workerStatusObservedAt: observedAt,
      sessionRemovalObservedAt: observedAt,
      connectionStatus: null,
      connectionStatusSourceId: null,
      connectionStatusOrder: null,
      connectionStatusObservedAt: null,
      connectionOnlineAcknowledged: false,
      runtimeGeneration,
      lifecycleOperationId: null,
      completedLifecycleOperationId: null,
      completedLifecycleRuntimeGeneration: null,
      completedLifecycleAt: null,
      recreateBaselineConnectionStatusOrder: null,
      recreatePhase: null,
      recreatePhaseObservedAt: null,
      recreateRuntimeRetired: false,
      source: 'session_removal_ack',
    },
  };
};

const reduceRealtimeEvent = (
  current: ChannelStatusPresentationSnapshot | undefined,
  event: IBaileysConnectionState
): ChannelStatusPresentationReduction => {
  if (
    event.event_type === 'status' &&
    event.worker_status_id === EWorkerStatus.delete
  ) {
    return { accepted: true, remove: true };
  }
  if (
    event.event_type === 'status' &&
    event.worker_status_id === EWorkerStatus.deleting
  ) {
    if (!current) return { accepted: false };
    return {
      accepted: true,
      snapshot: {
        ...current,
        workerStatusId: EWorkerStatus.deleting,
        workerStatusObservedAt:
          normalizeEventWorkerStatusObservedAt(event) ??
          current.workerStatusObservedAt,
        connectionStatus: null,
        connectionStatusSourceId: null,
        connectionOnlineAcknowledged: false,
        lifecycleOperationId: null,
        recreateBaselineConnectionStatusOrder: null,
        recreatePhase: null,
        recreatePhaseObservedAt: null,
        recreateRuntimeRetired: false,
        source: 'realtime',
      },
    };
  }
  if (isSessionRemovalTerminalPublication(event)) {
    return reduceSessionRemovalTerminal(current, event);
  }
  if (isManagerPairingReadyPublication(event)) {
    return reduceManagerPairingReady(current, event);
  }
  if (isManagerWorkerRecreateRuntimeStartedStatusEvent(event)) {
    return reduceManagerRuntimeStarted(current, event);
  }
  if (isManagerWorkerRecreateRuntimeRetiredStatusEvent(event)) {
    return reduceManagerRuntimeRetired(current, event);
  }
  if (isManagerWorkerRecreateCompletedStatusEvent(event)) {
    return reduceManagerCompletion(current, event);
  }
  if (isManagerWorkerRecreatingStatusEvent(event)) {
    return reduceManagerStart(current, event);
  }
  if (
    event.lifecycle_source !== undefined ||
    event.lifecycle_action !== undefined ||
    event.lifecycle_phase !== undefined
  ) {
    return { accepted: false };
  }
  if (event.connection_status !== undefined) {
    return reduceNativeRealtime(current, event);
  }
  if (
    event.connection_status_source_id !== undefined ||
    event.connection_status_order !== undefined
  ) {
    return { accepted: false };
  }
  return reduceRawRealtime(current, event);
};

export const reduceChannelStatusPresentation = (
  current: ChannelStatusPresentationSnapshot | undefined,
  mutation: ChannelStatusPresentationMutation
): ChannelStatusPresentationReduction =>
  mutation.kind === 'hydrate'
    ? reduceHydratedSnapshot(current, mutation.snapshot)
    : mutation.kind === 'provider_handoff_source_recovery'
      ? reduceProviderHandoffSourceRecovery(
          current,
          mutation.snapshot,
          mutation.handoff
        )
      : reduceRealtimeEvent(current, mutation.event);

export const useChannelStatusPresentationStore = defineStore(
  'channelStatusPresentation',
  {
    state: () => ({
      byWorkerId: {} as Record<string, ChannelStatusPresentationSnapshot>,
      providerHandoffSourceRecoveryByWorkerId: {} as Record<
        string,
        ProviderHandoffSourceRecoveryAcceptance
      >,
      initialCreationOperationByWorkerId: {} as Record<string, string>,
      /**
       * A terminal session-removal response is an authoritative barrier. HTTP
       * hydration and delayed Centrifugo publications from the retired session
       * cannot replace it. A publication with a durable later observation (or
       * a newer generation) releases it, including when another tab starts the
       * next connection.
       */
      sessionRemovalGenerationByWorkerId: {} as Record<string, number>,
    }),
    getters: {
      snapshot:
        (state) =>
        (workerId: string): ChannelStatusPresentationSnapshot | undefined =>
          state.byWorkerId[workerId],
    },
    actions: {
      applyReduction(
        workerId: string,
        reduction: ChannelStatusPresentationReduction
      ): boolean {
        if (!reduction.accepted) return false;
        if ('remove' in reduction) {
          delete this.providerHandoffSourceRecoveryByWorkerId[workerId];
          delete this.sessionRemovalGenerationByWorkerId[workerId];
          delete this.initialCreationOperationByWorkerId[workerId];
          if (!this.byWorkerId[workerId]) return true;
          const next = { ...this.byWorkerId };
          delete next[workerId];
          this.byWorkerId = next;
          return true;
        }
        const current = this.byWorkerId[workerId];
        if (current && sameSnapshot(current, reduction.snapshot)) return true;
        this.byWorkerId = {
          ...this.byWorkerId,
          [workerId]: reduction.snapshot,
        };
        return true;
      },
      mergeHydratedSnapshot(
        candidate: ChannelStatusPresentationSnapshot
      ): boolean {
        const current = this.byWorkerId[candidate.workerId];
        const initialCreationReduction = reduceInitialCreationHydration({
          current,
          candidate,
          operationId:
            this.initialCreationOperationByWorkerId[candidate.workerId],
        });
        if (initialCreationReduction) {
          const applied = this.applyReduction(
            candidate.workerId,
            initialCreationReduction
          );
          if (
            applied &&
            initialCreationReduction.accepted &&
            !('remove' in initialCreationReduction) &&
            initialCreationReduction.snapshot.lifecycleOperationId === null
          ) {
            delete this.initialCreationOperationByWorkerId[candidate.workerId];
          }
          return applied;
        }
        const removalGeneration =
          this.sessionRemovalGenerationByWorkerId[candidate.workerId];
        const terminalObservedAt =
          current?.sessionRemovalObservedAt ??
          (current?.source === 'session_removal_ack'
            ? current.workerStatusObservedAt
            : null);
        let releasesSessionRemoval = false;
        if (removalGeneration && !candidate.sessionRemovalObservedAt) {
          const generationAdvanced = Boolean(
            candidate.runtimeGeneration &&
            candidate.runtimeGeneration > removalGeneration
          );
          const durableProjectionAdvanced = Boolean(
            terminalObservedAt &&
            [
              candidate.workerStatusObservedAt,
              candidate.recreatePhaseObservedAt,
              candidate.completedLifecycleAt,
              candidate.connectionStatusOrder
                ? candidate.connectionStatusObservedAt
                : null,
            ].some(
              (observedAt) =>
                compareObservedAt(observedAt, terminalObservedAt) === 1
            )
          );
          if (!generationAdvanced && !durableProjectionAdvanced) {
            return false;
          }
          releasesSessionRemoval = true;
          delete this.sessionRemovalGenerationByWorkerId[candidate.workerId];
        }
        if (
          current?.source === 'session_removal_ack' &&
          !candidate.sessionRemovalObservedAt &&
          !releasesSessionRemoval &&
          compareObservedAt(
            candidate.workerStatusObservedAt,
            current.workerStatusObservedAt
          ) !== 1
        ) {
          return false;
        }
        const mutation: ChannelStatusPresentationMutation = {
          kind: 'hydrate',
          snapshot: candidate,
        };
        if (
          !providerHandoffSourceRecoveryFenceAllows(
            this.providerHandoffSourceRecoveryByWorkerId[candidate.workerId],
            mutation
          )
        ) {
          return false;
        }
        let reduction = reduceChannelStatusPresentation(
          this.byWorkerId[candidate.workerId],
          mutation
        );
        if (
          releasesSessionRemoval &&
          reduction.accepted &&
          !('remove' in reduction)
        ) {
          reduction = {
            accepted: true,
            snapshot: {
              ...reduction.snapshot,
              sessionRemovalObservedAt: null,
              source: candidate.source,
            },
          };
        }
        const applied = this.applyReduction(candidate.workerId, reduction);
        if (!applied && releasesSessionRemoval && removalGeneration) {
          this.sessionRemovalGenerationByWorkerId[candidate.workerId] =
            removalGeneration;
        }
        if (applied && candidate.sessionRemovalObservedAt) {
          const generation = candidate.runtimeGeneration;
          if (generation) {
            this.sessionRemovalGenerationByWorkerId[candidate.workerId] =
              generation;
          }
        }
        return applied;
      },
      hydrateWorkerChannel(
        channel: ListWorkerResponse | ViewWorkerResponse
      ): boolean {
        return this.mergeHydratedSnapshot(
          workerChannelStatusPresentationSnapshot(channel)
        );
      },
      hydrateWorkerChannels(channels: ListWorkerResponse[]) {
        for (const channel of channels) this.hydrateWorkerChannel(channel);
      },
      reconcileProviderHandoffSourceRecovery(
        channel: ListWorkerResponse | ViewWorkerResponse,
        handoff: WhatsappProviderHandoffView
      ): ProviderHandoffSourceRecoveryAcceptance | null {
        if (
          channel.lifecycle_operation_id !== null &&
          channel.lifecycle_operation_id !== undefined
        ) {
          return null;
        }
        const candidate = workerChannelStatusPresentationSnapshot(channel);
        const current = this.byWorkerId[candidate.workerId];
        const proof = providerHandoffSourceRecoveryProof(
          current,
          candidate,
          handoff
        );
        if (!proof) return null;
        const accepted = this.applyReduction(
          candidate.workerId,
          reduceChannelStatusPresentation(current, {
            kind: 'provider_handoff_source_recovery',
            snapshot: candidate,
            handoff,
          })
        );
        if (!accepted) return null;
        this.providerHandoffSourceRecoveryByWorkerId[candidate.workerId] =
          proof;
        return proof;
      },
      hydrateOfflineChannel(channel: ListOfflineChannelsResponse): boolean {
        return this.mergeHydratedSnapshot(
          offlineChannelStatusPresentationSnapshot(channel)
        );
      },
      hydrateOfflineChannels(channels: ListOfflineChannelsResponse[]) {
        for (const channel of channels) this.hydrateOfflineChannel(channel);
      },
      hydrateDashboardChannelStatus(
        channel: ListChannelsStatusResponse
      ): boolean {
        const candidate = dashboardChannelStatusPresentationSnapshot(channel);
        const current = this.byWorkerId[channel.id];
        return this.mergeHydratedSnapshot(
          current
            ? {
                ...candidate,
                // This endpoint carries ordering metadata but no native status
                // envelope. Preserve an already validated native projection.
                ...nativeProjection(current),
              }
            : candidate
        );
      },
      hydrateDashboardChannelStatuses(channels: ListChannelsStatusResponse[]) {
        for (const channel of channels) {
          this.hydrateDashboardChannelStatus(channel);
        }
      },
      applyRealtimeEvent(event: IBaileysConnectionState): boolean {
        const channelDeletion =
          event.event_type === 'status' &&
          (event.worker_status_id === EWorkerStatus.deleting ||
            event.worker_status_id === EWorkerStatus.delete);
        const current = this.byWorkerId[event.worker_id];
        const terminalPublication = isSessionRemovalTerminalPublication(event);
        const removalGeneration =
          this.sessionRemovalGenerationByWorkerId[event.worker_id];
        let releasesSessionRemoval = false;
        if (removalGeneration && !channelDeletion && !terminalPublication) {
          const eventGeneration = normalizeRuntimeGeneration(
            event.runtime_generation
          );
          const terminalObservedAt =
            current?.sessionRemovalObservedAt ??
            current?.workerStatusObservedAt ??
            null;
          if (
            !eventGeneration ||
            eventGeneration < removalGeneration ||
            !publicationFollowsSessionRemoval(terminalObservedAt, event)
          ) {
            return false;
          }
          releasesSessionRemoval = true;
          delete this.sessionRemovalGenerationByWorkerId[event.worker_id];
        }
        if (
          current?.source === 'session_removal_ack' &&
          !channelDeletion &&
          !terminalPublication &&
          !releasesSessionRemoval &&
          !publicationFollowsSessionRemoval(
            current.sessionRemovalObservedAt ?? current.workerStatusObservedAt,
            event
          )
        ) {
          return false;
        }
        const mutation: ChannelStatusPresentationMutation = {
          kind: 'realtime',
          event,
        };
        if (
          !providerHandoffSourceRecoveryFenceAllows(
            this.providerHandoffSourceRecoveryByWorkerId[event.worker_id],
            mutation
          )
        ) {
          return false;
        }
        let reduction = reduceChannelStatusPresentation(
          this.byWorkerId[event.worker_id],
          mutation
        );
        if (
          releasesSessionRemoval &&
          reduction.accepted &&
          !('remove' in reduction)
        ) {
          reduction = {
            accepted: true,
            snapshot: {
              ...reduction.snapshot,
              sessionRemovalObservedAt: null,
              source: 'realtime',
            },
          };
        }
        const applied = this.applyReduction(event.worker_id, reduction);
        if (!applied && releasesSessionRemoval && removalGeneration) {
          this.sessionRemovalGenerationByWorkerId[event.worker_id] =
            removalGeneration;
        }
        if (terminalPublication) {
          const generation = normalizeRuntimeGeneration(
            event.runtime_generation
          );
          if (generation && applied) {
            this.sessionRemovalGenerationByWorkerId[event.worker_id] =
              generation;
          }
        }
        return applied;
      },
      applySessionRemovalTerminal(
        result: DisconnectWorkerConnectionResponse
      ): boolean {
        const current = this.byWorkerId[result.worker_id];
        const runtimeGeneration = normalizeRuntimeGeneration(
          result.runtime_generation
        );
        const terminalObservedAt =
          normalizeHydratedWorkerStatusObservedAt(result);
        if (
          !current ||
          result.worker_status_id !== EWorkerStatus.disponible ||
          result.session_removed !== true ||
          result.disconnected_user !== true ||
          !runtimeGeneration ||
          !terminalObservedAt ||
          (current.runtimeGeneration !== null &&
            runtimeGeneration < current.runtimeGeneration) ||
          snapshotHasObservationAfter(current, terminalObservedAt)
        ) {
          return false;
        }

        delete this.providerHandoffSourceRecoveryByWorkerId[result.worker_id];
        this.sessionRemovalGenerationByWorkerId[result.worker_id] =
          runtimeGeneration;
        this.byWorkerId = {
          ...this.byWorkerId,
          [result.worker_id]: {
            ...current,
            workerStatusId: EWorkerStatus.disponible,
            workerStatusObservedAt: terminalObservedAt,
            sessionRemovalObservedAt: terminalObservedAt,
            connectionStatus: null,
            connectionStatusSourceId: null,
            connectionStatusOrder: null,
            connectionStatusObservedAt: null,
            connectionOnlineAcknowledged: false,
            runtimeGeneration,
            lifecycleOperationId: null,
            completedLifecycleOperationId: null,
            completedLifecycleRuntimeGeneration: null,
            completedLifecycleAt: null,
            recreateBaselineConnectionStatusOrder: null,
            recreatePhase: null,
            recreatePhaseObservedAt: null,
            recreateRuntimeRetired: false,
            source: 'session_removal_ack',
          },
        };
        return true;
      },
      releaseSessionRemovalFence(workerId: string): void {
        delete this.sessionRemovalGenerationByWorkerId[workerId];
      },
      /**
       * Projects the manager's durable `202/queued` recreate acknowledgement
       * immediately. Centrifugo remains an idempotent confirmation, but the UI
       * must not depend on that publication arriving after the HTTP response.
       */
      applyAcceptedRecreateAck(
        ack: IWorkerLifecycleAck,
        options: { allowProviderChange?: boolean } = {}
      ): boolean {
        const operationId = normalizeWorkerLifecycleOperationId(
          ack.operation_id
        );
        const workerTypeId = normalizeWorkerTypeId(ack.worker_type_id);
        if (
          ack.code !== 202 ||
          ack.status !== 'queued' ||
          ack.queued !== true ||
          ack.worker_status_id !== EWorkerStatus.recreating ||
          !operationId ||
          !workerTypeId
        ) {
          return false;
        }

        const current = this.byWorkerId[ack.worker_id];
        delete this.initialCreationOperationByWorkerId[ack.worker_id];
        const acknowledgedRuntimeGeneration = normalizeRuntimeGeneration(
          ack.runtime_generation
        );
        if (
          current?.workerTypeId &&
          current.workerTypeId !== workerTypeId &&
          options.allowProviderChange !== true
        ) {
          return false;
        }
        if (
          current?.runtimeGeneration &&
          acknowledgedRuntimeGeneration &&
          acknowledgedRuntimeGeneration < current.runtimeGeneration
        ) {
          return current.lifecycleOperationId === operationId;
        }
        const effectiveRuntimeGeneration =
          current?.workerTypeId === workerTypeId
            ? (current.runtimeGeneration ?? acknowledgedRuntimeGeneration)
            : acknowledgedRuntimeGeneration;
        const removalGeneration =
          this.sessionRemovalGenerationByWorkerId[ack.worker_id];
        delete this.sessionRemovalGenerationByWorkerId[ack.worker_id];
        const applied = this.applyRealtimeEvent(
          buildManagerWorkerRecreatingStatusEvent(
            {
              action: EWorkerAction.recreate,
              worker_id: ack.worker_id,
              account_id: ack.account_id,
              server_id: ack.server_id ?? '',
              worker_type_id: workerTypeId as EWorkerType,
              previous_worker_type_id:
                (current?.workerTypeId as EWorkerType | null) ?? undefined,
              worker_status_id: EWorkerStatus.recreating,
              lifecycle_operation_id: operationId,
              recreate_available_at: ack.recreate_available_at,
              debug_trace_id: ack.debug_trace_id,
            },
            effectiveRuntimeGeneration
          )
        );
        if (!applied && removalGeneration) {
          this.sessionRemovalGenerationByWorkerId[ack.worker_id] =
            removalGeneration;
        }
        return applied;
      },
      applyAcceptedCreateAck(ack: ICreateWorkerResponse): boolean {
        const operationId = normalizeWorkerLifecycleOperationId(
          ack.operation_id
        );
        const workerTypeId = normalizeWorkerTypeId(ack.worker_type_id);
        if (
          ack.code !== 202 ||
          ack.status !== 'queued' ||
          ack.queued !== true ||
          ack.worker_status_id !== EWorkerStatus.creating ||
          !operationId ||
          !workerTypeId
        ) {
          return false;
        }

        const current = this.byWorkerId[ack.worker_id];
        if (current?.lifecycleOperationId === operationId) {
          this.initialCreationOperationByWorkerId[ack.worker_id] = operationId;
          return true;
        }
        if (current) return false;

        delete this.providerHandoffSourceRecoveryByWorkerId[ack.worker_id];
        delete this.sessionRemovalGenerationByWorkerId[ack.worker_id];
        this.initialCreationOperationByWorkerId[ack.worker_id] = operationId;
        this.byWorkerId = {
          ...this.byWorkerId,
          [ack.worker_id]: {
            workerId: ack.worker_id,
            workerTypeId,
            workerStatusId: EWorkerStatus.creating,
            workerStatusObservedAt: null,
            sessionIdentityPresent: false,
            sessionRemovalObservedAt: null,
            connectionStatus: null,
            connectionStatusSourceId: null,
            connectionStatusOrder: null,
            connectionStatusObservedAt: null,
            connectionOnlineAcknowledged: false,
            runtimeGeneration: normalizeRuntimeGeneration(
              ack.runtime_generation
            ),
            lifecycleOperationId: operationId,
            completedLifecycleOperationId: null,
            completedLifecycleRuntimeGeneration: null,
            completedLifecycleAt: null,
            recreateBaselineConnectionStatusOrder: null,
            recreatePhase: null,
            recreatePhaseObservedAt: null,
            recreateRuntimeRetired: false,
            source: 'create_ack',
          },
        };
        return true;
      },
    },
  }
);
