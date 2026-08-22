import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import { PagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import axios from '@webcore/axios';
import { AxiosError, type AxiosRequestConfig } from 'axios';
import { IListChannels } from '@webcore/interfaces/IListChannels';
import {
  ListWorkerFinalResponse,
  ListWorkerResponse,
} from '@core/schema/worker/listWorker/response.schema';
import { ListWorkerRequest } from '@core/schema/worker/listWorker/request.schema';
import { CreateWorkerRequest } from '@core/schema/worker/createWorker/request.schema';
import {
  ListWorkerServersResponse,
  ListWorkerServersItemResponse,
} from '@core/schema/worker/listWorkerServers/response.schema';
import { EditWorkerRequest } from '@core/schema/worker/editWorker/request.schema';
import { ViewWorkerResponse } from '@core/schema/worker/viewWorker/response.schema';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import type { WhatsappConnectionStatusProvider } from '@core/common/interfaces/IWhatsappConnectionStatus';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { WorkerConnectionLogsQuery } from '@core/schema/worker/workerConnectionLogs/request.schema';
import { WorkerConnectionHealthResponse } from '@core/schema/worker/workerConnectionLogs/response.schema';
import { ProfileStatus } from '@core/schema/worker/listProfileStatus/response.schema';
import { WorkerProfileStatus } from '@core/schema/worker/uploadProfileStatus/response.schema';
import { WorkerProfileInfo } from '@core/schema/worker/uploadProfileInfo/response.schema';
import { WorkerConfig } from '@core/schema/worker/updateWorkerConfig/response.schema';
import { ViewWorkerConfigResponse } from '@core/schema/worker/viewWorkerConfig/response.schema';
import { UpdateWorkerConfigRequest } from '@core/schema/worker/updateWorkerConfig/request.schema';
import { ViewWorkerConfigForChatResponse } from '@core/schema/chat/viewWorkerConfigForChat/response.schema';
import { ViewAttendanceHoursResponse } from '@core/schema/worker/viewAttendanceHours/response.schema';
import { UpdateAttendanceHoursRequest } from '@core/schema/worker/updateAttendanceHours/request.schema';
import { UpdateAttendanceHoursResponse } from '@core/schema/worker/updateAttendanceHours/response.schema';
import { ViewAttendanceInactivityAlertResponse } from '@core/schema/worker/viewAttendanceInactivityAlert/response.schema';
import { UpdateAttendanceInactivityAlertRequest } from '@core/schema/worker/updateAttendanceInactivityAlert/request.schema';
import { UpdateAttendanceInactivityAlertResponse } from '@core/schema/worker/updateAttendanceInactivityAlert/response.schema';
import { ViewOperatorReplyPendingAlertResponse } from '@core/schema/worker/viewOperatorReplyPendingAlert/response.schema';
import { UpdateOperatorReplyPendingAlertRequest } from '@core/schema/worker/updateOperatorReplyPendingAlert/request.schema';
import { UpdateOperatorReplyPendingAlertResponse } from '@core/schema/worker/updateOperatorReplyPendingAlert/response.schema';
import { ViewOperatorReplyPendingRedistributionResponse } from '@core/schema/worker/viewOperatorReplyPendingRedistribution/response.schema';
import { UpdateOperatorReplyPendingRedistributionRequest } from '@core/schema/worker/updateOperatorReplyPendingRedistribution/request.schema';
import { UpdateOperatorReplyPendingRedistributionResponse } from '@core/schema/worker/updateOperatorReplyPendingRedistribution/response.schema';
import { ViewTypingSimulationResponse } from '@core/schema/worker/viewTypingSimulation/response.schema';
import { UpdateTypingSimulationRequest } from '@core/schema/worker/updateTypingSimulation/request.schema';
import { UpdateTypingSimulationResponse } from '@core/schema/worker/updateTypingSimulation/response.schema';
import { ViewSecurityKeyResponse } from '@core/schema/worker/viewSecurityKey/response.schema';
import { UpdateSecurityKeyRequest } from '@core/schema/worker/updateSecurityKey/request.schema';
import { UpdateSecurityKeyResponse } from '@core/schema/worker/updateSecurityKey/response.schema';
import { WorkerExternalConnectionLinkResponse } from '@core/schema/worker/externalConnectionLink/response.schema';
import { WorkerExternalConnectionViewResponse } from '@core/schema/worker/externalConnection/response.schema';
import { WorkerSecureConnectionSessionResponse } from '@core/schema/worker/secureConnection/response.schema';
import {
  DownloadArtifactResponse,
  DownloadArtifactsResponse,
} from '@core/schema/config/downloadArtifacts/response.schema';
import { ICreateWorkerResponse } from '@core/common/interfaces/ICreateWorkerResponse';
import { IWorkerLifecycleAck } from '@core/common/interfaces/IWorkerLifecycleAck';
import { WorkerWhatsappEmbeddedConfigResponse } from '@core/schema/worker/whatsappEmbeddedConfig/response.schema';
import { ConnectWhatsappEmbeddedRequest } from '@core/schema/worker/connectWhatsappEmbedded/request.schema';
import { ConnectWhatsappEmbeddedResponse } from '@core/schema/worker/connectWhatsappEmbedded/response.schema';
import { DisconnectWhatsappOfficialResponse } from '@core/schema/worker/disconnectWhatsappOfficial/response.schema';
import type { DisconnectWorkerConnectionResponse } from '@core/schema/worker/disconnectWorkerConnection/response.schema';
import { ConnectWhatsappOfficialRequest } from '@core/schema/worker/connectWhatsappOfficial/request.schema';
import { ConnectWhatsappOfficialResponse } from '@core/schema/worker/connectWhatsappOfficial/response.schema';
import { EnsureWhatsappOfficialWebhookSubscriptionResponse } from '@core/schema/worker/ensureWhatsappOfficialWebhookSubscription/response.schema';
import { EnsureWhatsappOfficialWebhookSubscriptionRequest } from '@core/schema/worker/ensureWhatsappOfficialWebhookSubscription/request.schema';
import { WhatsappOfficialHealthResponse } from '@core/schema/worker/whatsappOfficialHealth/response.schema';
import { WhatsappBusinessProfileVertical } from '@core/common/enums/EWhatsappBusinessProfileVertical';
import {
  connectionLifecycleDebugHeaders,
  createConnectionLifecycleDebugTraceId,
  isConnectionLifecycleDebugEnabled,
  logConnectionLifecycleDebug,
} from '@webcore/utils/connectionLifecycleDebug';
import { logLocalConnectionStatus } from '@webcore/utils/localConnectionStatusLog';
import {
  compareWhatsappConnectionStatusOrders,
  evaluateWhatsappRealtimeStatusFence,
  isWhatsappConnectionOnline,
  mergeWhatsappOrderedChannelHttpSnapshot,
  normalizeWhatsappConnectionStatus,
  normalizeWhatsappConnectionStatusOrder,
} from '@core/common/functions/whatsappConnectionStatus';
import type {
  WhatsappProviderHandoffAction,
  WhatsappProviderHandoffLookup,
  WhatsappProviderHandoffRequestOptions,
  WhatsappProviderHandoffResolution,
  WhatsappProviderHandoffView,
} from '@webcore/interfaces/IWhatsappProviderHandoff';
import {
  isManagerPairingReadyPublication,
  isSessionRemovalTerminalPublication,
  type ProviderHandoffSourceRecoveryAcceptance,
} from '@webcore/stores/channelStatusPresentation';
import {
  buildManagerWorkerRecreatingStatusEvent,
  compareWorkerLifecycleOperationIds,
  evaluateManagerWorkerLifecycleCompletionFence,
  evaluateManagerWorkerLifecycleStatusFence,
  isManagerWorkerRecreateCompletedStatusEvent,
  isManagerWorkerRecreateRuntimeRetiredStatusEvent,
  isManagerWorkerRecreateRuntimeStartedStatusEvent,
  isWorkerLifecycleOperationIdV7,
  normalizeWorkerLifecycleOperationId,
  normalizeWorkerLifecycleRuntimeGeneration,
} from '@core/common/functions/workerLifecycleRealtimeStatus';

type WorkerRecreateCooldownConflictResponse = IApiResponse<{
  recreate_available_at: string | null;
}>;

type ConnectionLifecycleDebugRequestOptions = {
  debugTraceId?: string;
};

type ChannelRecreateBaseline = {
  workerTypeId?: string | null;
  runtimeGeneration?: number | null;
  allowProviderChange?: boolean;
};

type ProviderHandoffSourceRecoveryLegacyFence =
  ProviderHandoffSourceRecoveryAcceptance & {
    recovered: ViewWorkerResponse;
  };

type ChannelUpdateResult = boolean | IWorkerLifecycleAck;
type AuthenticatorPlatform = 'linux' | 'macos' | 'windows';

type OfficialWorkerProfileInfoPayload = {
  about?: string | null;
  description?: string | null;
  address?: string | null;
  email?: string | null;
  websites?: string | null;
  vertical?: WhatsappBusinessProfileVertical | null;
  profile_picture_handle?: string | null;
};

const whatsappConnectionStatusProviderByWorkerTypeId: Partial<
  Record<string, WhatsappConnectionStatusProvider>
> = {
  [EWorkerType.baileys]: 'baileys',
  [EWorkerType.wwebjs]: 'wwebjs',
  [EWorkerType.whatsmeow]: 'whatsmeow',
};

const resolveWhatsappConnectionStatusProvider = (
  workerTypeId?: string | null
): WhatsappConnectionStatusProvider | undefined =>
  whatsappConnectionStatusProviderByWorkerTypeId[workerTypeId ?? ''];

const normalizeWorkerStatusObservedAt = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
};

const publicationFollowsRemovedSession = (
  terminalObservedAt: string,
  event: IBaileysConnectionState
): boolean => {
  const observations = [
    event.worker_status_observed_at,
    event.connection_status_observed_at,
    event.recreate_phase_observed_at,
    event.recreate_completed_at,
  ]
    .map(normalizeWorkerStatusObservedAt)
    .filter((value): value is string => value !== null);

  return (
    observations.length > 0 &&
    observations.every(
      (observedAt) => Date.parse(observedAt) >= Date.parse(terminalObservedAt)
    ) &&
    observations.some(
      (observedAt) => Date.parse(observedAt) > Date.parse(terminalObservedAt)
    )
  );
};

type SessionRemovalFenceDecision = 'accepted' | 'rejected' | 'release';

type NativeRealtimeProjection = {
  expectedProvider: WhatsappConnectionStatusProvider | undefined;
  nativeSnapshot: ReturnType<typeof normalizeWhatsappConnectionStatus>;
  nativeSourceId: string | undefined;
  nativeOrder: string | undefined;
  hasNativeSource: boolean;
  appliesNativeProjection: boolean;
};

type NativeRealtimeProjectionDecision =
  | { accepted: false }
  | { accepted: true; projection: NativeRealtimeProjection };

type RealtimeProjectionPreviousValues = {
  workerTypeId: string | null;
  workerStatusId: string | null;
  number: string | null;
  connectionDate: string | null;
};

const NATIVE_CONNECTION_SOURCE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const isChannelDeletionPublication = (
  input: IBaileysConnectionState
): boolean =>
  input.event_type === 'status' &&
  (input.worker_status_id === EWorkerStatus.deleting ||
    input.worker_status_id === EWorkerStatus.delete);

const hasManagerWorkerLifecycleEnvelope = (
  input: IBaileysConnectionState
): boolean =>
  input.lifecycle_source !== undefined ||
  input.lifecycle_action !== undefined ||
  input.lifecycle_phase !== undefined;

const evaluateSessionRemovalPublicationFence = (input: {
  event: IBaileysConnectionState;
  channelDeletion: boolean;
  terminalObservedAt?: string;
  terminalGeneration?: number;
}): SessionRemovalFenceDecision => {
  if (input.channelDeletion) return 'accepted';

  if (input.terminalGeneration) {
    const eventGeneration = normalizeWorkerLifecycleRuntimeGeneration(
      input.event.runtime_generation
    );
    if (
      !eventGeneration ||
      eventGeneration < input.terminalGeneration ||
      !input.terminalObservedAt ||
      !publicationFollowsRemovedSession(input.terminalObservedAt, input.event)
    ) {
      return 'rejected';
    }
    return 'release';
  }

  if (
    input.terminalObservedAt &&
    !publicationFollowsRemovedSession(input.terminalObservedAt, input.event)
  ) {
    return 'rejected';
  }
  return 'accepted';
};

const resolveCanonicalLifecycleTerminalStatus = (
  input: IBaileysConnectionState,
  canonicalWorkerStatusId?: string | null
): EWorkerStatus.online | EWorkerStatus.disponible => {
  if (
    canonicalWorkerStatusId === EWorkerStatus.online ||
    canonicalWorkerStatusId === EWorkerStatus.disponible
  ) {
    return canonicalWorkerStatusId;
  }

  return input.worker_status_id === EWorkerStatus.online &&
    input.connection_online_acknowledged === true
    ? EWorkerStatus.online
    : EWorkerStatus.disponible;
};

const validateNativeRealtimeProjection = (
  channel: ListWorkerResponse,
  input: IBaileysConnectionState
): NativeRealtimeProjectionDecision => {
  const persistedWorkerTypeId = channel.type?.id;
  const eventWorkerTypeId = input.worker_type_id ?? persistedWorkerTypeId;
  const expectedProvider =
    resolveWhatsappConnectionStatusProvider(eventWorkerTypeId);
  const nativeSnapshot = expectedProvider
    ? normalizeWhatsappConnectionStatus(
        input.connection_status,
        expectedProvider
      )
    : undefined;
  const nativeSourceId = input.connection_status_source_id
    ?.trim()
    .toLowerCase();
  const nativeOrder = normalizeWhatsappConnectionStatusOrder(
    input.connection_status_order
  );
  const hasNativeSource = NATIVE_CONNECTION_SOURCE_ID_PATTERN.test(
    nativeSourceId ?? ''
  );

  if (
    input.connection_status &&
    (!nativeSnapshot || !hasNativeSource || !nativeOrder)
  ) {
    return { accepted: false };
  }
  if (
    input.connection_status === undefined &&
    (input.connection_status_source_id !== undefined ||
      input.connection_status_order !== undefined)
  ) {
    return { accepted: false };
  }

  let appliesNativeProjection = false;
  if (nativeSnapshot && nativeSourceId && nativeOrder) {
    const currentSnapshot = normalizeWhatsappConnectionStatus(
      channel.connection_status,
      expectedProvider
    );
    const currentSourceId = channel.connection_status_source_id;
    const currentOrder = normalizeWhatsappConnectionStatusOrder(
      channel.connection_status_order
    );
    if (
      currentOrder &&
      compareWhatsappConnectionStatusOrders(nativeOrder, currentOrder) <= 0
    ) {
      return { accepted: false };
    }
    if (
      currentSnapshot &&
      currentSourceId === nativeSourceId &&
      nativeSnapshot.sequence < currentSnapshot.sequence
    ) {
      return { accepted: false };
    }
    appliesNativeProjection = true;
  }

  return {
    accepted: true,
    projection: {
      expectedProvider,
      nativeSnapshot,
      nativeSourceId,
      nativeOrder,
      hasNativeSource,
      appliesNativeProjection,
    },
  };
};

const isWeakOnlinePublication = (
  input: IBaileysConnectionState,
  projection: NativeRealtimeProjection
): boolean =>
  input.worker_status_id === EWorkerStatus.online &&
  (input.session_ready !== true ||
    !input.phone?.trim() ||
    (projection.expectedProvider !== undefined &&
      (input.can_send !== true ||
        input.can_receive_runtime !== true ||
        input.authenticated !== true ||
        !projection.hasNativeSource ||
        !isWhatsappConnectionOnline(projection.nativeSnapshot) ||
        input.connection_online_acknowledged !== true)));

const applyAcceptedRealtimeProjection = (
  channel: ListWorkerResponse,
  input: IBaileysConnectionState,
  projection: NativeRealtimeProjection,
  runtimeGeneration?: number
): RealtimeProjectionPreviousValues => {
  const previous: RealtimeProjectionPreviousValues = {
    workerTypeId: channel.type?.id ?? null,
    workerStatusId: channel.status?.id ?? null,
    number: channel.number ?? null,
    connectionDate: channel.connection_date ?? null,
  };

  if (runtimeGeneration) {
    channel.runtime_generation = runtimeGeneration;
  }
  if (
    projection.appliesNativeProjection &&
    projection.nativeSnapshot &&
    projection.nativeSourceId &&
    projection.nativeOrder
  ) {
    channel.connection_status = projection.nativeSnapshot;
    channel.connection_status_source_id = projection.nativeSourceId;
    channel.connection_status_order = projection.nativeOrder;
    channel.connection_online_acknowledged =
      input.connection_online_acknowledged === true &&
      isWhatsappConnectionOnline(projection.nativeSnapshot);

    // Provider identity belongs to the same ordered projection as the native
    // status. Only a fully validated, newer envelope may advance it.
    if (input.worker_type_id) {
      channel.type = {
        id: input.worker_type_id,
        name: projection.nativeSnapshot.provider,
      };
    }
  }

  if (
    channel.status &&
    input.event_type === 'status' &&
    input.worker_status_id
  ) {
    channel.status.id = input.worker_status_id;
    channel.worker_status_observed_at =
      normalizeWorkerStatusObservedAt(input.worker_status_observed_at) ??
      channel.worker_status_observed_at;
  }
  if (isManagerPairingReadyPublication(input)) {
    channel.connection_status = null;
    channel.connection_status_source_id = null;
    channel.connection_online_acknowledged = false;
  }
  if (
    input.event_type === 'status' &&
    input.worker_status_id === EWorkerStatus.online
  ) {
    channel.number = input.phone?.trim() ?? channel.number;
    channel.connection_date = new Date().toISOString();
  }
  if (
    input.event_type === 'status' &&
    (input.worker_status_id === EWorkerStatus.disponible ||
      (input.worker_status_id === EWorkerStatus.offline &&
        input.disconnected_user === true))
  ) {
    channel.number = null;
    channel.connection_date = null;
    channel.last_connection_check_at = null;
  }
  if ('recreate_available_at' in input) {
    channel.recreate_available_at = input.recreate_available_at ?? null;
  }

  return previous;
};

const isWorkerLifecycleAck = (value: unknown): value is IWorkerLifecycleAck =>
  typeof value === 'object' &&
  value !== null &&
  (value as { queued?: unknown }).queued === true;

const isHttpDeletionLifecycleChannel = (channel: ListWorkerResponse): boolean =>
  channel.status?.id === EWorkerStatus.deleting ||
  channel.status?.id === EWorkerStatus.delete;

const httpSnapshotFollowsRemovedSession = (input: {
  sessionRemovalObservedAt?: string;
  sessionRemovalGeneration?: number;
  httpRuntimeGeneration?: number | null;
  httpProjectionObservations: string[];
}): boolean => {
  if (!input.sessionRemovalObservedAt) return false;
  if (
    input.httpRuntimeGeneration &&
    input.sessionRemovalGeneration &&
    input.httpRuntimeGeneration > input.sessionRemovalGeneration
  ) {
    return true;
  }

  const removedAt = Date.parse(input.sessionRemovalObservedAt);
  return input.httpProjectionObservations.some(
    (observedAt) => Date.parse(observedAt) > removedAt
  );
};

const resolveActiveHttpLifecycleStatus = (
  current: ListWorkerResponse | undefined,
  httpChannel: ListWorkerResponse | undefined,
  isInitialCreation: boolean
): NonNullable<ListWorkerResponse['status']> => {
  if (isInitialCreation) {
    return { id: EWorkerStatus.creating, name: 'creating' };
  }
  if (current?.status?.id === EWorkerStatus.creating) {
    return current.status;
  }
  if (httpChannel?.status?.id === EWorkerStatus.creating) {
    return httpChannel.status;
  }

  return (
    current?.status ?? {
      id: EWorkerStatus.recreating,
      name: 'recreating',
    }
  );
};

const projectActiveHttpLifecycleChannel = (
  channel: ListWorkerResponse,
  current: ListWorkerResponse | undefined,
  httpChannel: ListWorkerResponse | undefined,
  isInitialCreation: boolean
): ListWorkerResponse => {
  const projected: ListWorkerResponse = {
    ...channel,
    status: resolveActiveHttpLifecycleStatus(
      current,
      httpChannel,
      isInitialCreation
    ),
  };
  if (isInitialCreation) {
    delete projected.recreate_phase;
    delete projected.recreate_phase_observed_at;
    delete projected.recreate_runtime_retired;
  }
  return projected;
};

const isInitialCreationTerminalHttpSnapshot = (input: {
  currentLifecycleOperationId?: string;
  initialCreationOperationId?: string;
  durableLifecycleOperationId?: string;
  statusId?: string;
  runtimeGeneration?: number | null;
}): boolean =>
  Boolean(
    input.currentLifecycleOperationId &&
    input.currentLifecycleOperationId === input.initialCreationOperationId &&
    !input.durableLifecycleOperationId &&
    input.runtimeGeneration &&
    input.statusId &&
    input.statusId !== EWorkerStatus.new &&
    input.statusId !== EWorkerStatus.creating &&
    input.statusId !== EWorkerStatus.recreating
  );

const projectCompletedInitialCreationHttpChannel = (input: {
  channel: ListWorkerResponse;
  httpChannel?: ListWorkerResponse;
  runtimeGeneration?: number | null;
  currentLifecycleOperationId?: string;
  initialCreationOperationId?: string;
  durableLifecycleOperationId?: string;
}): ListWorkerResponse | undefined => {
  if (
    !isInitialCreationTerminalHttpSnapshot({
      currentLifecycleOperationId: input.currentLifecycleOperationId,
      initialCreationOperationId: input.initialCreationOperationId,
      durableLifecycleOperationId: input.durableLifecycleOperationId,
      statusId: input.httpChannel?.status?.id,
      runtimeGeneration: input.runtimeGeneration,
    })
  ) {
    return undefined;
  }

  return {
    ...input.channel,
    ...(input.httpChannel?.status ? { status: input.httpChannel.status } : {}),
    ...(input.httpChannel?.type ? { type: input.httpChannel.type } : {}),
    runtime_generation: input.runtimeGeneration,
    lifecycle_operation_id: undefined,
    recreate_phase: undefined,
  };
};

const projectCompletedRecreateHttpChannel = (input: {
  channel: ListWorkerResponse;
  httpChannel?: ListWorkerResponse;
  runtimeGeneration?: number | null;
  completedOperationId?: string;
  completedRuntimeGeneration?: number;
  completedAt?: string;
}): ListWorkerResponse => ({
  ...input.channel,
  ...(input.httpChannel?.status ? { status: input.httpChannel.status } : {}),
  ...(input.httpChannel?.type ? { type: input.httpChannel.type } : {}),
  runtime_generation: input.runtimeGeneration,
  lifecycle_operation_id: undefined,
  recreate_completed_operation_id: input.completedOperationId,
  recreate_completed_runtime_generation: input.completedRuntimeGeneration,
  recreate_completed_at: input.completedAt,
  recreate_phase: undefined,
});

const followsProviderHandoffSourceRecoveryLegacyFence = (
  marker: ProviderHandoffSourceRecoveryLegacyFence,
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

const providerHandoffSourceRecoveryLegacyFenceAllowsEvent = (
  marker: ProviderHandoffSourceRecoveryLegacyFence | undefined,
  event: IBaileysConnectionState
): boolean => {
  if (!marker) return true;
  const operationId = normalizeWorkerLifecycleOperationId(
    event.lifecycle_operation_id
  );
  if (!operationId) return true;
  return followsProviderHandoffSourceRecoveryLegacyFence(
    marker,
    operationId,
    normalizeWorkerLifecycleRuntimeGeneration(event.runtime_generation) ?? null
  );
};

const buildConnectionLifecycleDebugConfig = (
  debugTraceId: string | undefined,
  config: AxiosRequestConfig = {}
): AxiosRequestConfig => {
  const headers = connectionLifecycleDebugHeaders(debugTraceId);
  if (!headers) {
    return config;
  }

  return {
    ...config,
    headers: {
      ...((config.headers ?? {}) as Record<string, string>),
      ...headers,
    },
  };
};

const createWebTraceId = (prefix: string): string | undefined =>
  isConnectionLifecycleDebugEnabled()
    ? createConnectionLifecycleDebugTraceId(prefix)
    : undefined;

const connectionDownloadEnvironment = (): 'dev' | 'prod' =>
  import.meta.env.PROD ? 'prod' : 'dev';

const openPublicDownloadUrl = (url: string): void => {
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
};

const workerConfigForChatPendingModule: Record<
  string,
  Promise<ViewWorkerConfigForChatResponse | null>
> = {};

export const useChannelsStore = defineStore('channels', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    list: [] as ListWorkerResponse[],
    pagings: {
      current_page: 1 as number,
      total_pages: 1 as number,
      per_page: 10 as number,
      count: 0 as number,
      total: 0 as number,
    } as PagingResponseSchema,
    workerConfigCache: {} as Record<string, ViewWorkerConfigResponse | null>,
    workerConfigForChatCache: {} as Record<
      string,
      ViewWorkerConfigForChatResponse | null
    >,
    whatsappEmbeddedConfig: null as WorkerWhatsappEmbeddedConfigResponse | null,
    connectionDownloadArtifacts: null as DownloadArtifactsResponse | null,
    /**
     * A worker id is immutable and is never reused. Once the durable delete
     * publication is observed, keep a local tombstone so an HTTP response
     * that started before the deletion cannot put the channel back on screen.
     */
    channelDeletionTombstones: {} as Record<string, true>,
    channelLifecycleOperationById: {} as Record<string, string>,
    channelLifecycleCompletedOperationById: {} as Record<string, string>,
    channelInitialCreationOperationById: {} as Record<string, string>,
    sessionRemovalGenerationByWorkerId: {} as Record<string, number>,
    sessionRemovalObservedAtByWorkerId: {} as Record<string, string>,
    providerHandoffSourceRecoveryByWorkerId: {} as Record<
      string,
      ProviderHandoffSourceRecoveryLegacyFence
    >,
  }),
  actions: {
    showSnackbar(message: string, color: EColor) {
      this.snackbar.message = message;
      this.snackbar.color = color;
      this.snackbar.status = true;
    },
    hideSnackbar() {
      this.snackbar.status = false;
    },
    updateChannelRecreateAvailableAt(
      workerId: string,
      recreateAvailableAt: string | null
    ) {
      const channel = this.list.find((item) => item.id === workerId);

      if (!channel) {
        return;
      }

      channel.recreate_available_at = recreateAvailableAt;
    },
    applyManagerWorkerLifecycleStatus(input: IBaileysConnectionState): boolean {
      if (
        !providerHandoffSourceRecoveryLegacyFenceAllowsEvent(
          this.providerHandoffSourceRecoveryByWorkerId[input.worker_id],
          input
        )
      ) {
        return false;
      }
      const channel = this.list.find(
        (item) =>
          item.id === input.worker_id && item.account?.id === input.account_id
      );
      if (!channel || this.channelDeletionTombstones[input.worker_id]) {
        return false;
      }

      const fence = evaluateManagerWorkerLifecycleStatusFence({
        event: input,
        persistedWorkerTypeId: channel.type?.id,
        persistedRuntimeGeneration: channel.runtime_generation,
        currentLifecycleOperationId:
          this.channelLifecycleOperationById[input.worker_id],
        completedLifecycleOperationId:
          this.channelLifecycleCompletedOperationById[input.worker_id],
      });
      if (!fence.accepted) {
        logLocalConnectionStatus('web.store.manager_lifecycle.fence_rejected', {
          layer: 'web.store',
          worker_id: input.worker_id,
          account_id: input.account_id,
          worker_type_id: input.worker_type_id,
          worker_status_id: input.worker_status_id,
          lifecycle_operation_id: input.lifecycle_operation_id,
          runtime_generation: input.runtime_generation,
          persisted_runtime_generation: channel.runtime_generation,
          reason: fence.reason,
        });
        return false;
      }

      this.channelLifecycleOperationById[input.worker_id] = fence.operationId;
      delete this.channelInitialCreationOperationById[input.worker_id];
      channel.status = {
        id: EWorkerStatus.recreating,
        name: 'recreating',
      };
      if ('recreate_available_at' in input) {
        channel.recreate_available_at = input.recreate_available_at ?? null;
      }

      logLocalConnectionStatus('web.store.manager_lifecycle.applied', {
        layer: 'web.store',
        worker_id: input.worker_id,
        account_id: input.account_id,
        worker_type_id: input.worker_type_id,
        worker_status_id: input.worker_status_id,
        lifecycle_operation_id: fence.operationId,
        runtime_generation: input.runtime_generation,
      });
      return true;
    },
    applyManagerWorkerLifecycleCompletion(
      input: IBaileysConnectionState,
      canonicalWorkerStatusId?: string | null
    ): boolean {
      if (
        !providerHandoffSourceRecoveryLegacyFenceAllowsEvent(
          this.providerHandoffSourceRecoveryByWorkerId[input.worker_id],
          input
        )
      ) {
        return false;
      }
      const channel = this.list.find(
        (item) =>
          item.id === input.worker_id && item.account?.id === input.account_id
      );
      if (!channel || this.channelDeletionTombstones[input.worker_id]) {
        return false;
      }

      const fence = evaluateManagerWorkerLifecycleCompletionFence({
        event: input,
        persistedWorkerTypeId: channel.type?.id,
        persistedRuntimeGeneration: channel.runtime_generation,
        currentLifecycleOperationId:
          this.channelLifecycleOperationById[input.worker_id],
      });
      if (!fence.accepted) {
        logLocalConnectionStatus(
          'web.store.manager_lifecycle.completion_fence_rejected',
          {
            layer: 'web.store',
            worker_id: input.worker_id,
            account_id: input.account_id,
            worker_type_id: input.worker_type_id,
            worker_status_id: input.worker_status_id,
            lifecycle_operation_id: input.lifecycle_operation_id,
            runtime_generation: input.runtime_generation,
            persisted_runtime_generation: channel.runtime_generation,
            reason: fence.reason,
          }
        );
        return false;
      }

      delete this.channelLifecycleOperationById[input.worker_id];
      delete this.channelInitialCreationOperationById[input.worker_id];
      this.channelLifecycleCompletedOperationById[input.worker_id] =
        fence.operationId;
      delete channel.lifecycle_operation_id;
      const terminalStatusId = resolveCanonicalLifecycleTerminalStatus(
        input,
        canonicalWorkerStatusId
      );
      channel.status = {
        id: terminalStatusId,
        name:
          terminalStatusId === EWorkerStatus.online ? 'online' : 'disponible',
      };
      if (input.worker_type_id) {
        channel.type = {
          ...channel.type,
          id: input.worker_type_id,
          name: input.worker_type_id,
        };
      }
      channel.runtime_generation = fence.runtimeGeneration;
      channel.connection_online_acknowledged =
        terminalStatusId === EWorkerStatus.online &&
        input.connection_online_acknowledged === true;
      channel.recreate_completed_operation_id = fence.operationId;
      channel.recreate_completed_runtime_generation = fence.runtimeGeneration;
      channel.recreate_completed_at = input.recreate_completed_at;
      delete channel.recreate_phase;

      logLocalConnectionStatus('web.store.manager_lifecycle.completed', {
        layer: 'web.store',
        worker_id: input.worker_id,
        account_id: input.account_id,
        worker_type_id: input.worker_type_id,
        worker_status_id: input.worker_status_id,
        lifecycle_operation_id: fence.operationId,
        runtime_generation: fence.runtimeGeneration,
        reason: input.reason,
      });
      return true;
    },
    applyManagerWorkerLifecycleEvent(
      input: IBaileysConnectionState,
      canonicalWorkerStatusId?: string | null
    ): boolean {
      if (
        !providerHandoffSourceRecoveryLegacyFenceAllowsEvent(
          this.providerHandoffSourceRecoveryByWorkerId[input.worker_id],
          input
        )
      ) {
        return false;
      }
      if (
        isManagerWorkerRecreateRuntimeStartedStatusEvent(input) ||
        isManagerWorkerRecreateRuntimeRetiredStatusEvent(input)
      ) {
        // `channelStatusPresentation` is the canonical lifecycle state machine
        // and receives this publication before the legacy list store. These
        // phase markers are therefore acknowledged here without duplicating
        // its ordering rules or partially mutating the legacy projection.
        return true;
      }

      if (isManagerWorkerRecreateCompletedStatusEvent(input)) {
        return this.applyManagerWorkerLifecycleCompletion(
          input,
          canonicalWorkerStatusId
        );
      }

      return this.applyManagerWorkerLifecycleStatus(input);
    },
    /**
     * Mirrors a source recovery that the canonical presentation reducer has
     * already validated from the exact durable handoff journal plus a fresh
     * worker GET. This legacy list fence intentionally performs no competing
     * provider/recovery ordering; it only releases the same operation id and
     * adopts the already-authoritative worker projection.
     */
    applyCanonicalProviderHandoffSourceRecovery(
      recovered: ViewWorkerResponse,
      acceptance: ProviderHandoffSourceRecoveryAcceptance
    ): boolean {
      const operationId = normalizeWorkerLifecycleOperationId(
        acceptance.releasedOperationId
      );
      const index = this.list.findIndex(
        (channel) => channel.id === recovered.id
      );
      const current = index >= 0 ? this.list[index] : undefined;
      const activeOperationId = normalizeWorkerLifecycleOperationId(
        this.channelLifecycleOperationById[recovered.id] ??
          current?.lifecycle_operation_id
      );
      const releasesKnownRecoveryOperation = Boolean(
        activeOperationId && acceptance.operationIds.includes(activeOperationId)
      );
      if (
        (activeOperationId && !releasesKnownRecoveryOperation) ||
        (recovered.lifecycle_operation_id !== null &&
          recovered.lifecycle_operation_id !== undefined) ||
        recovered.status?.id !== EWorkerStatus.online
      ) {
        return false;
      }

      this.providerHandoffSourceRecoveryByWorkerId[recovered.id] = {
        ...acceptance,
        operationIds: [...acceptance.operationIds],
        recovered,
      };
      if (operationId || releasesKnownRecoveryOperation) {
        delete this.channelLifecycleOperationById[recovered.id];
        delete this.channelInitialCreationOperationById[recovered.id];
      }
      if (!current) return true;

      const next: ListWorkerResponse = {
        ...current,
        ...recovered,
        last_connection_check_at: current.last_connection_check_at,
      };
      delete next.lifecycle_operation_id;
      delete next.recreate_phase;
      delete next.recreate_phase_observed_at;
      delete next.recreate_runtime_retired;
      this.list.splice(index, 1, next);

      logLocalConnectionStatus(
        'web.store.provider_handoff.source_recovery_mirrored',
        {
          layer: 'web.store',
          worker_id: recovered.id,
          worker_type_id: recovered.type?.id,
          worker_status_id: recovered.status?.id,
          lifecycle_operation_id: operationId ?? activeOperationId,
          terminal_operation_id: acceptance.terminalOperationId,
          runtime_generation: recovered.runtime_generation,
        }
      );
      return true;
    },
    applyAcceptedRecreateAck(
      ack: IWorkerLifecycleAck,
      baseline: ChannelRecreateBaseline
    ): boolean {
      const channel = this.list.find(
        (item) =>
          item.id === ack.worker_id && item.account?.id === ack.account_id
      );
      if (
        !channel ||
        ack.code !== 202 ||
        ack.status !== 'queued' ||
        ack.queued !== true ||
        ack.worker_status_id !== EWorkerStatus.recreating ||
        !ack.worker_type_id
      ) {
        return false;
      }

      const currentRuntimeGeneration =
        normalizeWorkerLifecycleRuntimeGeneration(channel.runtime_generation);
      const acknowledgedRuntimeGeneration =
        normalizeWorkerLifecycleRuntimeGeneration(ack.runtime_generation);
      if (
        channel.type?.id &&
        channel.type.id !== ack.worker_type_id &&
        baseline.allowProviderChange !== true
      ) {
        return false;
      }
      if (
        currentRuntimeGeneration &&
        acknowledgedRuntimeGeneration &&
        acknowledgedRuntimeGeneration < currentRuntimeGeneration
      ) {
        logLocalConnectionStatus('web.store.recreate_ack.superseded', {
          layer: 'web.store',
          worker_id: ack.worker_id,
          account_id: ack.account_id,
          worker_type_id: ack.worker_type_id,
          worker_status_id: ack.worker_status_id,
          lifecycle_operation_id: ack.operation_id,
          runtime_generation: ack.runtime_generation,
        });
        return (
          this.channelLifecycleOperationById[ack.worker_id] === ack.operation_id
        );
      }

      const applied = this.applyManagerWorkerLifecycleStatus(
        buildManagerWorkerRecreatingStatusEvent(
          {
            action: EWorkerAction.recreate,
            worker_id: ack.worker_id,
            server_id: ack.server_id ?? channel.server?.id ?? '',
            account_id: ack.account_id,
            worker_type_id: ack.worker_type_id as EWorkerType,
            previous_worker_type_id: (channel.type?.id ??
              baseline.workerTypeId) as EWorkerType | undefined,
            worker_status_id: EWorkerStatus.recreating,
            lifecycle_operation_id: ack.operation_id,
            recreate_available_at: ack.recreate_available_at,
            debug_trace_id: ack.debug_trace_id,
          },
          channel.type?.id === ack.worker_type_id
            ? (currentRuntimeGeneration ??
                acknowledgedRuntimeGeneration ??
                baseline.runtimeGeneration)
            : (acknowledgedRuntimeGeneration ??
                baseline.runtimeGeneration ??
                currentRuntimeGeneration)
        )
      );
      if (applied) {
        delete this.sessionRemovalGenerationByWorkerId[ack.worker_id];
      }
      return applied;
    },
    applyAcceptedCreateAck(ack: ICreateWorkerResponse): boolean {
      if (
        ack.code !== 202 ||
        ack.status !== 'queued' ||
        ack.queued !== true ||
        ack.worker_status_id !== EWorkerStatus.creating ||
        !ack.operation_id
      ) {
        return false;
      }

      this.channelLifecycleOperationById[ack.worker_id] = ack.operation_id;
      this.channelInitialCreationOperationById[ack.worker_id] =
        ack.operation_id;
      return true;
    },
    applyInitialCreationTerminal(
      worker: ViewWorkerResponse,
      operationId: string
    ): boolean {
      const currentLifecycleOperationId =
        this.channelLifecycleOperationById[worker.id];
      if (
        !isInitialCreationTerminalHttpSnapshot({
          currentLifecycleOperationId,
          initialCreationOperationId:
            this.channelInitialCreationOperationById[worker.id],
          durableLifecycleOperationId:
            normalizeWorkerLifecycleOperationId(
              worker.lifecycle_operation_id
            ) ?? undefined,
          statusId: worker.status?.id,
          runtimeGeneration: normalizeWorkerLifecycleRuntimeGeneration(
            worker.runtime_generation
          ),
        }) ||
        currentLifecycleOperationId !== operationId
      ) {
        return false;
      }

      const index = this.list.findIndex((channel) => channel.id === worker.id);
      if (index === -1) return false;
      const terminalChannel: ListWorkerResponse = {
        ...this.list[index],
        ...worker,
        last_connection_check_at: this.list[index].last_connection_check_at,
      };
      delete terminalChannel.lifecycle_operation_id;
      delete terminalChannel.recreate_phase;
      delete terminalChannel.recreate_phase_observed_at;
      delete terminalChannel.recreate_runtime_retired;
      this.list[index] = terminalChannel;
      this.channelLifecycleCompletedOperationById[worker.id] = operationId;
      delete this.channelLifecycleOperationById[worker.id];
      delete this.channelInitialCreationOperationById[worker.id];
      return true;
    },
    applySessionRemovalTerminal(
      result: DisconnectWorkerConnectionResponse
    ): boolean {
      const runtimeGeneration = normalizeWorkerLifecycleRuntimeGeneration(
        result.runtime_generation
      );
      const workerStatusObservedAt = normalizeWorkerStatusObservedAt(
        result.worker_status_observed_at
      );
      if (
        result.worker_status_id !== EWorkerStatus.disponible ||
        result.session_removed !== true ||
        result.disconnected_user !== true ||
        !runtimeGeneration ||
        !workerStatusObservedAt
      ) {
        return false;
      }

      const channel = this.list.find((item) => item.id === result.worker_id);
      const currentRuntimeGeneration =
        normalizeWorkerLifecycleRuntimeGeneration(channel?.runtime_generation);
      const currentRemovalObservedAt =
        this.sessionRemovalObservedAtByWorkerId[result.worker_id];
      const currentWorkerStatusObservedAt = normalizeWorkerStatusObservedAt(
        channel?.worker_status_observed_at
      );
      const currentProjectionObservations = [
        currentWorkerStatusObservedAt,
        normalizeWorkerStatusObservedAt(channel?.connection_status_observed_at),
        normalizeWorkerStatusObservedAt(channel?.recreate_phase_observed_at),
        normalizeWorkerStatusObservedAt(channel?.recreate_completed_at),
      ].filter((value): value is string => value !== null);
      if (
        currentRuntimeGeneration &&
        runtimeGeneration < currentRuntimeGeneration
      ) {
        return false;
      }
      if (
        (currentRemovalObservedAt &&
          Date.parse(workerStatusObservedAt) <
            Date.parse(currentRemovalObservedAt)) ||
        currentProjectionObservations.some(
          (observedAt) =>
            Date.parse(observedAt) > Date.parse(workerStatusObservedAt)
        )
      ) {
        return false;
      }

      this.sessionRemovalGenerationByWorkerId[result.worker_id] =
        runtimeGeneration;
      this.sessionRemovalObservedAtByWorkerId[result.worker_id] =
        workerStatusObservedAt;
      delete this.channelLifecycleOperationById[result.worker_id];
      delete this.channelLifecycleCompletedOperationById[result.worker_id];
      delete this.channelInitialCreationOperationById[result.worker_id];
      delete this.providerHandoffSourceRecoveryByWorkerId[result.worker_id];

      if (!channel) {
        return true;
      }

      channel.status = {
        id: EWorkerStatus.disponible,
        name: 'disponible',
      };
      channel.number = null;
      channel.connection_date = null;
      channel.last_connection_check_at = null;
      channel.connection_status = null;
      channel.connection_status_source_id = null;
      channel.connection_status_order = null;
      channel.connection_online_acknowledged = false;
      channel.runtime_generation = runtimeGeneration;
      channel.worker_status_observed_at = workerStatusObservedAt;
      delete channel.lifecycle_operation_id;
      delete channel.recreate_phase;
      delete channel.recreate_phase_observed_at;
      delete channel.recreate_runtime_retired;
      delete channel.recreate_completed_operation_id;
      delete channel.recreate_completed_runtime_generation;
      delete channel.recreate_completed_at;
      return true;
    },
    releaseSessionRemovalFence(workerId: string): void {
      delete this.sessionRemovalGenerationByWorkerId[workerId];
    },
    markChannelDeleting(workerId: string): boolean {
      if (this.channelDeletionTombstones[workerId]) {
        return false;
      }

      const channel = this.list.find((item) => item.id === workerId);
      if (!channel) {
        return false;
      }

      channel.status = {
        id: EWorkerStatus.deleting,
        name: 'deleting',
      };

      return true;
    },
    finalizeChannelDeletion(workerId: string, accountId: string): boolean {
      const workerIndex = this.list.findIndex((item) => item.id === workerId);
      const index = this.list.findIndex(
        (item) => item.id === workerId && item.account?.id === accountId
      );

      // A publication for another account must never hide a known row. An
      // already removed/off-page row is safe to tombstone because worker ids
      // are globally immutable and the account subscription is authenticated.
      if (workerIndex !== -1 && index === -1) {
        return false;
      }

      this.channelDeletionTombstones[workerId] = true;
      delete this.sessionRemovalGenerationByWorkerId[workerId];
      delete this.sessionRemovalObservedAtByWorkerId[workerId];
      delete this.channelLifecycleOperationById[workerId];
      delete this.channelLifecycleCompletedOperationById[workerId];
      delete this.channelInitialCreationOperationById[workerId];
      delete this.providerHandoffSourceRecoveryByWorkerId[workerId];

      if (index === -1) {
        return true;
      }

      this.list.splice(index, 1);

      const total = Math.max(0, this.pagings.total - 1);
      const totalPages =
        this.pagings.per_page > 0
          ? Math.max(1, Math.ceil(total / this.pagings.per_page))
          : 1;
      this.pagings = {
        ...this.pagings,
        current_page: Math.min(this.pagings.current_page, totalPages),
        total_pages: totalPages,
        count: this.list.length,
        total,
      };

      return true;
    },
    async listChannels(
      input?: IListChannels
    ): Promise<ListWorkerFinalResponse | null> {
      try {
        this.loading = true;
        const connectionStatusBaseline = new Map(
          this.list.flatMap((channel) => {
            const order = normalizeWhatsappConnectionStatusOrder(
              channel.connection_status_order
            );
            return order ? [[channel.id, order] as const] : [];
          })
        );
        const workerTypeBaseline = new Map(
          this.list.flatMap((channel) =>
            channel.type?.id ? [[channel.id, channel.type.id] as const] : []
          )
        );
        const request: ListWorkerRequest | undefined = input
          ? {
              current_page: input.page,
              per_page: input.per_page,
              sort_by: input.sort_by,
              name: input.search,
              number: input.search,
              server: input.search,
              account: input.search,
              status: input.status,
              type: input.type,
            }
          : undefined;

        const response = await axios.get<IApiResponse<ListWorkerFinalResponse>>(
          `/worker`,
          {
            params: request,
          }
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('worker_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        const visibleResults = data.data.results.filter(
          (channel) =>
            !this.channelDeletionTombstones[channel.id] &&
            !isHttpDeletionLifecycleChannel(channel)
        );
        const suppressedDeletionLifecycleRows =
          data.data.results.length - visibleResults.length;

        // Keep the worker lifecycle (`disponible`, `recreating`, …) separate
        // from the provider-owned WhatsApp connection projection. Consumers
        // that need factual connectivity read `connection_status` directly.
        const currentVisibleChannels = this.list.filter(
          (channel) => !this.channelDeletionTombstones[channel.id]
        );
        const currentVisibleChannelsById = new Map(
          currentVisibleChannels.map((channel) => [channel.id, channel])
        );
        const httpChannelsById = new Map(
          visibleResults.map((channel) => [channel.id, channel])
        );
        const mergedChannels = mergeWhatsappOrderedChannelHttpSnapshot(
          currentVisibleChannels,
          visibleResults,
          connectionStatusBaseline,
          {
            retainAdvancedMissing: false,
            baselineWorkerTypeIds: workerTypeBaseline,
          }
        );
        this.list = mergedChannels.map((channel) => {
          const httpChannel = httpChannelsById.get(channel.id);
          const current = currentVisibleChannelsById.get(channel.id);
          const sessionRemovalGeneration =
            this.sessionRemovalGenerationByWorkerId[channel.id];
          const sessionRemovalObservedAt =
            this.sessionRemovalObservedAtByWorkerId[channel.id];
          const httpWorkerStatusObservedAt = normalizeWorkerStatusObservedAt(
            httpChannel?.worker_status_observed_at
          );
          const httpConnectionDisconnectedAt = normalizeWorkerStatusObservedAt(
            httpChannel?.connection_disconnected_at
          );
          const httpRuntimeGeneration =
            normalizeWorkerLifecycleRuntimeGeneration(
              httpChannel?.runtime_generation
            );
          const httpProjectionObservations = [
            httpWorkerStatusObservedAt,
            normalizeWorkerStatusObservedAt(
              httpChannel?.recreate_phase_observed_at
            ),
            normalizeWorkerStatusObservedAt(httpChannel?.recreate_completed_at),
            httpChannel?.connection_status_order
              ? normalizeWorkerStatusObservedAt(
                  httpChannel.connection_status_observed_at
                )
              : null,
          ].filter((value): value is string => value !== null);
          const httpFollowsRemovedSession = httpSnapshotFollowsRemovedSession({
            sessionRemovalObservedAt,
            sessionRemovalGeneration,
            httpRuntimeGeneration,
            httpProjectionObservations,
          });
          if (httpConnectionDisconnectedAt) {
            if (httpRuntimeGeneration) {
              this.sessionRemovalGenerationByWorkerId[channel.id] =
                httpRuntimeGeneration;
            }
            this.sessionRemovalObservedAtByWorkerId[channel.id] =
              httpWorkerStatusObservedAt ?? httpConnectionDisconnectedAt;
          } else if (
            sessionRemovalGeneration &&
            httpFollowsRemovedSession &&
            (!httpRuntimeGeneration ||
              httpRuntimeGeneration >= sessionRemovalGeneration)
          ) {
            delete this.sessionRemovalGenerationByWorkerId[channel.id];
          }
          const activeSessionRemovalGeneration =
            this.sessionRemovalGenerationByWorkerId[channel.id];
          const activeSessionRemovalObservedAt =
            this.sessionRemovalObservedAtByWorkerId[channel.id];
          if (
            activeSessionRemovalGeneration ||
            (activeSessionRemovalObservedAt && !httpFollowsRemovedSession)
          ) {
            const removedSessionChannel: ListWorkerResponse = {
              ...(current ?? channel),
              number: null,
              status: {
                id: EWorkerStatus.disponible,
                name: 'disponible',
              },
              connection_date: null,
              last_connection_check_at: null,
              connection_status: null,
              connection_status_source_id: null,
              connection_status_order: null,
              connection_online_acknowledged: false,
              runtime_generation:
                activeSessionRemovalGeneration ??
                current?.runtime_generation ??
                channel.runtime_generation,
              worker_status_observed_at:
                activeSessionRemovalObservedAt ??
                current?.worker_status_observed_at ??
                null,
              connection_disconnected_at:
                httpConnectionDisconnectedAt ??
                current?.connection_disconnected_at ??
                null,
            };
            delete removedSessionChannel.lifecycle_operation_id;
            delete removedSessionChannel.recreate_phase;
            delete removedSessionChannel.recreate_phase_observed_at;
            delete removedSessionChannel.recreate_runtime_retired;
            delete removedSessionChannel.recreate_completed_operation_id;
            delete removedSessionChannel.recreate_completed_runtime_generation;
            delete removedSessionChannel.recreate_completed_at;
            return removedSessionChannel;
          }
          const existingLifecycleOperationId =
            this.channelLifecycleOperationById[channel.id];
          const completedLifecycleOperationId =
            this.channelLifecycleCompletedOperationById[channel.id];
          const durableLifecycleOperationId =
            normalizeWorkerLifecycleOperationId(
              httpChannel?.lifecycle_operation_id
            );
          const durableCompletedOperationId =
            normalizeWorkerLifecycleOperationId(
              httpChannel?.recreate_completed_operation_id
            );
          const durableCompletedRuntimeGeneration =
            normalizeWorkerLifecycleRuntimeGeneration(
              httpChannel?.recreate_completed_runtime_generation
            );
          const durableCompletedAt = httpChannel?.recreate_completed_at;
          const currentRuntimeGeneration =
            normalizeWorkerLifecycleRuntimeGeneration(
              current?.runtime_generation
            );
          const currentCompletedRuntimeGeneration =
            normalizeWorkerLifecycleRuntimeGeneration(
              current?.recreate_completed_runtime_generation
            );
          const providerSourceRecovery =
            this.providerHandoffSourceRecoveryByWorkerId[channel.id];
          const staleProviderSourceRecoveryLifecycle = Boolean(
            providerSourceRecovery &&
            durableLifecycleOperationId &&
            !followsProviderHandoffSourceRecoveryLegacyFence(
              providerSourceRecovery,
              durableLifecycleOperationId,
              httpRuntimeGeneration ?? null
            )
          );
          const currentActiveLifecycleFollowsSourceRecovery = Boolean(
            providerSourceRecovery &&
            existingLifecycleOperationId &&
            followsProviderHandoffSourceRecoveryLegacyFence(
              providerSourceRecovery,
              existingLifecycleOperationId,
              currentRuntimeGeneration ?? null
            )
          );
          const currentCompletedLifecycleFollowsSourceRecovery = Boolean(
            providerSourceRecovery &&
            completedLifecycleOperationId &&
            followsProviderHandoffSourceRecoveryLegacyFence(
              providerSourceRecovery,
              completedLifecycleOperationId,
              currentCompletedRuntimeGeneration ??
                currentRuntimeGeneration ??
                null
            )
          );
          if (staleProviderSourceRecoveryLifecycle && providerSourceRecovery) {
            if (
              current &&
              (currentActiveLifecycleFollowsSourceRecovery ||
                currentCompletedLifecycleFollowsSourceRecovery)
            ) {
              return current;
            }
            const recovered: ListWorkerResponse = {
              ...channel,
              ...providerSourceRecovery.recovered,
              last_connection_check_at:
                current?.last_connection_check_at ??
                channel.last_connection_check_at,
            };
            delete recovered.lifecycle_operation_id;
            delete recovered.recreate_phase;
            delete recovered.recreate_phase_observed_at;
            delete recovered.recreate_runtime_retired;
            return recovered;
          }
          const carriesExactActiveCompletion = Boolean(
            existingLifecycleOperationId &&
            durableCompletedOperationId === existingLifecycleOperationId &&
            durableCompletedRuntimeGeneration &&
            httpRuntimeGeneration &&
            durableCompletedRuntimeGeneration <= httpRuntimeGeneration &&
            (!currentRuntimeGeneration ||
              durableCompletedRuntimeGeneration >= currentRuntimeGeneration) &&
            typeof durableCompletedAt === 'string' &&
            Number.isFinite(Date.parse(durableCompletedAt))
          );
          const carriesExactCompletedLifecycle = Boolean(
            durableCompletedOperationId === completedLifecycleOperationId &&
            durableCompletedRuntimeGeneration &&
            typeof durableCompletedAt === 'string' &&
            Number.isFinite(Date.parse(durableCompletedAt))
          );
          const completedLifecycleComparison = completedLifecycleOperationId
            ? compareWorkerLifecycleOperationIds(
                durableLifecycleOperationId,
                completedLifecycleOperationId
              )
            : undefined;
          const staleCompletedLifecycleSnapshot = Boolean(
            durableLifecycleOperationId &&
            completedLifecycleOperationId &&
            (completedLifecycleComparison === 0 ||
              completedLifecycleComparison === -1 ||
              (completedLifecycleComparison === undefined &&
                !carriesExactCompletedLifecycle))
          );
          const activeLifecycleComparison = existingLifecycleOperationId
            ? compareWorkerLifecycleOperationIds(
                durableLifecycleOperationId,
                existingLifecycleOperationId
              )
            : undefined;
          const unprovenActiveLifecycleReplacement = Boolean(
            durableLifecycleOperationId &&
            existingLifecycleOperationId &&
            activeLifecycleComparison !== 0 &&
            activeLifecycleComparison !== 1 &&
            !carriesExactActiveCompletion
          );
          const regressedActiveRuntimeSnapshot = Boolean(
            existingLifecycleOperationId &&
            (!httpRuntimeGeneration ||
              (currentRuntimeGeneration &&
                httpRuntimeGeneration < currentRuntimeGeneration))
          );
          if (
            durableLifecycleOperationId &&
            !staleCompletedLifecycleSnapshot &&
            !unprovenActiveLifecycleReplacement &&
            !regressedActiveRuntimeSnapshot
          ) {
            this.channelLifecycleOperationById[channel.id] =
              durableLifecycleOperationId;
            if (httpChannel?.status?.id === EWorkerStatus.creating) {
              this.channelInitialCreationOperationById[channel.id] =
                durableLifecycleOperationId;
            }
          }
          if (
            staleCompletedLifecycleSnapshot ||
            unprovenActiveLifecycleReplacement ||
            regressedActiveRuntimeSnapshot
          ) {
            return current ?? channel;
          }
          const currentLifecycleOperationId =
            this.channelLifecycleOperationById[channel.id];
          if (!currentLifecycleOperationId) {
            return channel;
          }
          const initialCreationOperationId =
            this.channelInitialCreationOperationById[channel.id];
          const completedInitialCreationChannel =
            projectCompletedInitialCreationHttpChannel({
              channel,
              httpChannel,
              runtimeGeneration: httpRuntimeGeneration,
              currentLifecycleOperationId,
              initialCreationOperationId,
              durableLifecycleOperationId,
            });
          if (completedInitialCreationChannel) {
            this.channelLifecycleCompletedOperationById[channel.id] =
              currentLifecycleOperationId;
            delete this.channelLifecycleOperationById[channel.id];
            delete this.channelInitialCreationOperationById[channel.id];
            return completedInitialCreationChannel;
          }

          const exactDurableCompletion = Boolean(
            durableCompletedOperationId === currentLifecycleOperationId &&
            httpRuntimeGeneration &&
            durableCompletedRuntimeGeneration === httpRuntimeGeneration &&
            typeof durableCompletedAt === 'string' &&
            Number.isFinite(Date.parse(durableCompletedAt))
          );
          if (exactDurableCompletion) {
            this.channelLifecycleCompletedOperationById[channel.id] =
              currentLifecycleOperationId;
            delete this.channelLifecycleOperationById[channel.id];
            delete this.channelInitialCreationOperationById[channel.id];
            return projectCompletedRecreateHttpChannel({
              channel,
              httpChannel,
              runtimeGeneration: httpRuntimeGeneration,
              completedOperationId: durableCompletedOperationId,
              completedRuntimeGeneration: durableCompletedRuntimeGeneration,
              completedAt: durableCompletedAt,
            });
          }

          // A same-generation HTTP response can have been read before the
          // durable recreate claim became visible (or from a lagging read
          // replica). It is not allowed to release the lifecycle fence. Only
          // the exact durable completion tombstone can release the fence.
          return projectActiveHttpLifecycleChannel(
            channel,
            current,
            httpChannel,
            initialCreationOperationId === currentLifecycleOperationId
          );
        });
        const total = Math.max(
          0,
          data.data.pagings.total - suppressedDeletionLifecycleRows
        );
        const totalPages =
          data.data.pagings.per_page > 0
            ? Math.max(1, Math.ceil(total / data.data.pagings.per_page))
            : 1;
        this.pagings = {
          ...data.data.pagings,
          current_page: Math.min(data.data.pagings.current_page, totalPages),
          total_pages: totalPages,
          count: this.list.length,
          total,
        };

        return {
          ...data.data,
          results: this.list,
          pagings: this.pagings,
        };
      } catch (error) {
        let errorMessage = this.i18n.global.t('worker_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async listWorkerServers(): Promise<ListWorkerServersItemResponse[] | null> {
      try {
        const response =
          await axios.get<IApiResponse<ListWorkerServersResponse>>(
            `/worker/servers`
          );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data.results;
      } catch {
        return null;
      }
    },

    async getWhatsappEmbeddedConfig(): Promise<WorkerWhatsappEmbeddedConfigResponse | null> {
      try {
        const response = await axios.get<
          IApiResponse<WorkerWhatsappEmbeddedConfigResponse>
        >('/worker/whatsapp-embedded/config');

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        this.whatsappEmbeddedConfig = data.data;

        return data.data;
      } catch {
        return null;
      }
    },

    async connectWhatsappEmbedded(
      payload: ConnectWhatsappEmbeddedRequest
    ): Promise<ConnectWhatsappEmbeddedResponse | null> {
      try {
        this.loading = true;

        const response = await axios.post<
          IApiResponse<ConnectWhatsappEmbeddedResponse>
        >('/worker/whatsapp-embedded/connect', payload);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('channel_add_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          data.message ?? this.i18n.global.t('channel_add_success'),
          EColor.success
        );

        return data.data;
      } catch (error) {
        this.loading = false;
        let errorMessage = this.i18n.global.t('channel_add_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },

    async addChannel(
      payload: CreateWorkerRequest,
      options: ConnectionLifecycleDebugRequestOptions = {}
    ): Promise<ICreateWorkerResponse | null> {
      const debugTraceId =
        options.debugTraceId ?? createWebTraceId('web_add_channel');
      try {
        this.loading = true;

        logConnectionLifecycleDebug('web.channel_add.submit', {
          trace_id: debugTraceId,
          layer: 'web',
          worker_type_id: payload.worker_type,
          has_server_id: Boolean(payload.server_id),
        });

        const response = await axios.post<IApiResponse<ICreateWorkerResponse>>(
          `/worker`,
          payload,
          buildConnectionLifecycleDebugConfig(debugTraceId)
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('channel_add_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('channel_add_success'),
          EColor.success
        );

        const result = data.data
          ? {
              ...data.data,
              debug_trace_id: data.data.debug_trace_id ?? debugTraceId,
            }
          : data.data;

        logConnectionLifecycleDebug('web.channel_add.response', {
          trace_id: result?.debug_trace_id ?? debugTraceId,
          layer: 'web',
          worker_id: result?.worker_id,
          account_id: result?.account_id,
          worker_type_id: result?.worker_type_id,
          lifecycle_operation_id: result?.operation_id,
          status: result?.status,
          reason: result?.reason,
        });

        return result;
      } catch (error) {
        let errorMessage = this.i18n.global.t('channel_add_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        logConnectionLifecycleDebug('web.channel_add.error', {
          trace_id: debugTraceId,
          layer: 'web',
          worker_type_id: payload.worker_type,
          reason: errorMessage,
        });

        this.loading = false;

        return null;
      }
    },

    async updateChannel(
      payload: EditWorkerRequest,
      options: ConnectionLifecycleDebugRequestOptions = {}
    ): Promise<ChannelUpdateResult> {
      const debugTraceId =
        options.debugTraceId ?? createWebTraceId('web_edit_channel');
      const channelBeforeRequest = this.list.find(
        (channel) => channel.id === payload.worker_id
      );
      const baseline: ChannelRecreateBaseline = {
        workerTypeId: channelBeforeRequest?.type?.id,
        runtimeGeneration: channelBeforeRequest?.runtime_generation,
        allowProviderChange:
          Boolean(channelBeforeRequest?.type?.id) &&
          channelBeforeRequest?.type?.id !== payload.worker_type,
      };
      try {
        this.loading = true;
        logConnectionLifecycleDebug('web.channel_edit.submit', {
          trace_id: debugTraceId,
          layer: 'web',
          worker_id: payload.worker_id,
          worker_type_id: payload.worker_type,
          has_server_id: Boolean(payload.server_id),
        });

        const response = await axios.patch<
          IApiResponse<boolean | IWorkerLifecycleAck>
        >(
          `/worker/${payload.worker_id}/${payload.name}`,
          {
            worker_type: payload.worker_type,
            server_id: payload.server_id,
            connection_strategy: payload.connection_strategy,
          },
          buildConnectionLifecycleDebugConfig(debugTraceId)
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('channel_edit_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('channel_edit_success'),
          EColor.success
        );

        const result = isWorkerLifecycleAck(data.data)
          ? {
              ...data.data,
              debug_trace_id: data.data.debug_trace_id ?? debugTraceId,
            }
          : true;

        if (typeof result === 'object') {
          this.applyAcceptedRecreateAck(result, baseline);

          if (
            Object.prototype.hasOwnProperty.call(
              result,
              'recreate_available_at'
            )
          ) {
            this.updateChannelRecreateAvailableAt(
              result.worker_id,
              result.recreate_available_at ?? null
            );
          }
        }

        logConnectionLifecycleDebug('web.channel_edit.response', {
          trace_id:
            typeof result === 'object'
              ? (result.debug_trace_id ?? debugTraceId)
              : debugTraceId,
          layer: 'web',
          worker_id: payload.worker_id,
          account_id:
            typeof result === 'object' ? result.account_id : undefined,
          worker_type_id:
            typeof result === 'object'
              ? result.worker_type_id
              : payload.worker_type,
          lifecycle_operation_id:
            typeof result === 'object' ? result.operation_id : undefined,
          status: typeof result === 'object' ? result.status : 'updated',
          reason:
            typeof result === 'object' ? result.reason : 'no_recreate_required',
        });

        return result;
      } catch (error) {
        let errorMessage = this.i18n.global.t('channel_edit_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        logConnectionLifecycleDebug('web.channel_edit.error', {
          trace_id: debugTraceId,
          layer: 'web',
          worker_id: payload.worker_id,
          worker_type_id: payload.worker_type,
          reason: errorMessage,
        });

        this.loading = false;

        return false;
      }
    },

    async viewWhatsappProviderHandoff(
      workerId: string,
      options: WhatsappProviderHandoffRequestOptions = {}
    ): Promise<WhatsappProviderHandoffLookup> {
      const startedAt = Date.now();
      try {
        const response = await axios.get<
          IApiResponse<WhatsappProviderHandoffView>
        >(
          `/worker/${workerId}/provider-handoff/latest`,
          buildConnectionLifecycleDebugConfig(options.debugTraceId, {
            signal: options.signal,
          })
        );
        const data = response.data;

        if (!data.status || !data.data) {
          logConnectionLifecycleDebug('web.provider_handoff.view_empty', {
            trace_id: options.debugTraceId,
            layer: 'web.store',
            worker_id: workerId,
            duration_ms: Date.now() - startedAt,
          });
          return { kind: 'not_found' };
        }

        logConnectionLifecycleDebug('web.provider_handoff.view_success', {
          trace_id: options.debugTraceId,
          layer: 'web.store',
          worker_id: workerId,
          lifecycle_operation_id: data.data.lifecycle_operation_id ?? undefined,
          handoff_id: data.data.handoff_id,
          status: data.data.state,
          duration_ms: Date.now() - startedAt,
        });
        return { kind: 'found', handoff: data.data };
      } catch (error) {
        const status =
          error instanceof AxiosError ? error.response?.status : undefined;
        logConnectionLifecycleDebug('web.provider_handoff.view_error', {
          trace_id: options.debugTraceId,
          layer: 'web.store',
          worker_id: workerId,
          http_status: status,
          code: error instanceof AxiosError ? error.code : undefined,
          duration_ms: Date.now() - startedAt,
        });
        return status === 404 ? { kind: 'not_found' } : { kind: 'unavailable' };
      }
    },

    async resolveWhatsappProviderHandoff(
      workerId: string,
      handoffId: string,
      action: WhatsappProviderHandoffAction,
      options: WhatsappProviderHandoffRequestOptions = {}
    ): Promise<WhatsappProviderHandoffResolution | null> {
      const startedAt = Date.now();
      try {
        const response = await axios.post<
          IApiResponse<WhatsappProviderHandoffResolution>
        >(
          `/worker/${workerId}/provider-handoff/${handoffId}/resolve`,
          { action },
          buildConnectionLifecycleDebugConfig(options.debugTraceId, {
            signal: options.signal,
          })
        );
        const data = response.data;

        if (!data.data) {
          if (!options.silent) {
            this.showSnackbar(
              data.message ?? this.i18n.global.t('channel_edit_error'),
              EColor.error
            );
          }
          return null;
        }

        logConnectionLifecycleDebug('web.provider_handoff.resolve_success', {
          trace_id: options.debugTraceId,
          layer: 'web.store',
          worker_id: workerId,
          lifecycle_operation_id:
            data.data.handoff?.lifecycle_operation_id ?? undefined,
          handoff_id: handoffId,
          action,
          status: data.data.status,
          reason: data.data.reason,
          duration_ms: Date.now() - startedAt,
        });
        return data.data;
      } catch (error) {
        const responseData =
          error instanceof AxiosError
            ? (error.response?.data as
                IApiResponse<WhatsappProviderHandoffResolution> | undefined)
            : undefined;
        if (responseData?.data) {
          return responseData.data;
        }

        if (
          !options.silent &&
          !(error instanceof AxiosError && error.code === 'ERR_CANCELED')
        ) {
          this.showSnackbar(
            responseData?.message ?? this.i18n.global.t('channel_edit_error'),
            EColor.error
          );
        }
        logConnectionLifecycleDebug('web.provider_handoff.resolve_error', {
          trace_id: options.debugTraceId,
          layer: 'web.store',
          worker_id: workerId,
          handoff_id: handoffId,
          action,
          http_status:
            error instanceof AxiosError ? error.response?.status : undefined,
          code: error instanceof AxiosError ? error.code : undefined,
          duration_ms: Date.now() - startedAt,
        });
        return null;
      }
    },

    async getWorkerById(
      workerId: string,
      options: { silent?: boolean } = {}
    ): Promise<ViewWorkerResponse | null> {
      try {
        if (!options.silent) {
          this.loading = true;
        }

        const response = await axios.get<IApiResponse<ViewWorkerResponse>>(
          `/worker/${workerId}`
        );

        if (!options.silent) {
          this.loading = false;
        }

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('worker_view_error');

          if (!options.silent) {
            this.showSnackbar(mensage, EColor.error);
          }

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('worker_view_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        if (!options.silent) {
          this.showSnackbar(errorMessage, EColor.error);
        }

        if (!options.silent) {
          this.loading = false;
        }

        return null;
      }
    },

    async checkChannelOpenConversations(
      channelId: string
    ): Promise<number | null> {
      try {
        const response = await axios.get<IApiResponse<{ count: number }>>(
          `/worker/${channelId}/open-conversations`
        );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data.count;
      } catch {
        return null;
      }
    },

    async deleteChannel(workerId: string): Promise<boolean> {
      try {
        this.loading = true;
        const accountId = this.list.find((item) => item.id === workerId)
          ?.account?.id;

        const response = await axios.delete<IApiResponse<boolean>>(
          `/worker/${workerId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('worker_delete_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('worker_delete_success'),
          EColor.success
        );

        // A successful response is emitted only after the manager has
        // confirmed the durable lifecycle claim and published its immutable
        // deletion operation. Treat that ACK as a local tombstone so this tab
        // never depends on a later Centrifugo delivery to remove the row. The
        // terminal lifecycle event remains an idempotent confirmation for
        // other tabs and clients.
        if (accountId) {
          this.finalizeChannelDeletion(workerId, accountId);
        } else if (!this.list.some((item) => item.id === workerId)) {
          this.channelDeletionTombstones[workerId] = true;
          delete this.providerHandoffSourceRecoveryByWorkerId[workerId];
        } else {
          this.markChannelDeleting(workerId);
        }

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('worker_delete_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async setChannelPlanBlockStatus(
      workerId: string,
      action: 'block' | 'unblock'
    ): Promise<boolean> {
      const isBlock = action === 'block';

      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<boolean>>(
          `/worker/${workerId}/${action}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ??
            this.i18n.global.t(
              isBlock ? 'worker_block_error' : 'worker_unblock_error'
            );

          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          data.message ??
            this.i18n.global.t(
              isBlock ? 'worker_block_success' : 'worker_unblock_success'
            ),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t(
          isBlock ? 'worker_block_error' : 'worker_unblock_error'
        );

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async blockChannel(workerId: string): Promise<boolean> {
      return this.setChannelPlanBlockStatus(workerId, 'block');
    },

    async unblockChannel(workerId: string): Promise<boolean> {
      return this.setChannelPlanBlockStatus(workerId, 'unblock');
    },

    async disconnectWhatsappOfficial(
      workerId: string
    ): Promise<DisconnectWhatsappOfficialResponse | null> {
      try {
        this.loading = true;

        const response = await axios.post<
          IApiResponse<DisconnectWhatsappOfficialResponse>
        >(`/worker/${workerId}/whatsapp-official/disconnect`);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('whatsapp_official_disconnect_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          data.message ??
            this.i18n.global.t(
              data.data.meta_warning
                ? 'whatsapp_official_disconnect_partial_success'
                : 'whatsapp_official_disconnect_success'
            ),
          data.data.meta_warning ? EColor.warning : EColor.success
        );

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t(
          'whatsapp_official_disconnect_error'
        );
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async connectWhatsappOfficial(
      workerId: string,
      payload: ConnectWhatsappOfficialRequest
    ): Promise<ConnectWhatsappOfficialResponse | null> {
      try {
        this.loading = true;

        const response = await axios.post<
          IApiResponse<ConnectWhatsappOfficialResponse>
        >(`/worker/${workerId}/whatsapp-official/connect`, payload);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('whatsapp_official_reconnect_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          data.message ??
            this.i18n.global.t('whatsapp_official_reconnect_success'),
          EColor.success
        );

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t(
          'whatsapp_official_reconnect_error'
        );
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async ensureWhatsappOfficialWebhookSubscription(
      workerId: string,
      payload: EnsureWhatsappOfficialWebhookSubscriptionRequest
    ): Promise<EnsureWhatsappOfficialWebhookSubscriptionResponse | null> {
      try {
        this.loading = true;

        const response = await axios.post<
          IApiResponse<EnsureWhatsappOfficialWebhookSubscriptionResponse>
        >(
          `/worker/${workerId}/whatsapp-official/webhook-subscription/ensure`,
          payload
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('whatsapp_official_webhook_subscription_failed');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          data.message ??
            this.i18n.global.t(
              'whatsapp_official_webhook_subscription_success'
            ),
          EColor.success
        );

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t(
          'whatsapp_official_webhook_subscription_failed'
        );
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async viewWhatsappOfficialHealth(
      workerId: string
    ): Promise<WhatsappOfficialHealthResponse | null> {
      try {
        const response = await axios.get<
          IApiResponse<WhatsappOfficialHealthResponse>
        >(`/worker/${workerId}/whatsapp-official/health`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('meta_health_load_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('meta_health_load_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },

    async requestConnectionQrCode(
      workerId: string,
      options: {
        silent?: boolean;
        timeoutMs?: number;
        debugTraceId?: string;
      } = {}
    ): Promise<IBaileysConnectionState | null> {
      const debugTraceId =
        options.debugTraceId ?? createWebTraceId('web_qr_request');
      try {
        if (!options.silent) {
          this.loading = true;
        }

        const config = buildConnectionLifecycleDebugConfig(
          debugTraceId,
          options.timeoutMs ? { timeout: options.timeoutMs } : {}
        );

        logConnectionLifecycleDebug('web.qr_request.submit', {
          trace_id: debugTraceId,
          layer: 'web',
          worker_id: workerId,
          silent: options.silent === true,
          timeout_ms: options.timeoutMs,
        });

        const response = await axios.post<
          IApiResponse<IBaileysConnectionState>
        >(`/worker/${workerId}/connection/qrcode`, {}, config);

        if (!options.silent) {
          this.loading = false;
        }

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('worker_status_update_error');

          if (!options.silent) {
            this.showSnackbar(message, EColor.error);
          }

          return null;
        }

        const result = data.data
          ? {
              ...data.data,
              debug_trace_id: data.data.debug_trace_id ?? debugTraceId,
            }
          : data.data;

        logConnectionLifecycleDebug('web.qr_request.response', {
          trace_id: result?.debug_trace_id ?? debugTraceId,
          layer: 'web',
          worker_id: result?.worker_id ?? workerId,
          account_id: result?.account_id,
          worker_type_id: result?.worker_type_id,
          connection_attempt_id: result?.connection_attempt_id,
          runtime_generation: result?.runtime_generation,
          status: result?.status,
          code: result?.code,
          reason: result?.reason,
          qrcode: result?.qrcode,
          pairing_code: result?.pairing_code,
          qr_pending: result?.qr_pending === true,
        });

        return result;
      } catch (error) {
        let errorMessage = this.i18n.global.t('worker_status_update_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        if (!options.silent) {
          this.showSnackbar(errorMessage, EColor.error);
        }
        logConnectionLifecycleDebug('web.qr_request.error', {
          trace_id: debugTraceId,
          layer: 'web',
          worker_id: workerId,
          reason: errorMessage,
        });

        if (!options.silent) {
          this.loading = false;
        }

        return null;
      }
    },

    async sendConnectionPasskeyResponse(
      workerId: string,
      input: {
        connection_attempt_id?: string;
        passkey_response: unknown;
      },
      options: {
        silent?: boolean;
        timeoutMs?: number;
        debugTraceId?: string;
      } = {}
    ): Promise<IBaileysConnectionState | null> {
      const debugTraceId =
        options.debugTraceId ?? createWebTraceId('web_passkey_response');
      try {
        const config = buildConnectionLifecycleDebugConfig(
          debugTraceId,
          options.timeoutMs ? { timeout: options.timeoutMs } : {}
        );

        logConnectionLifecycleDebug('web.passkey_response.submit', {
          trace_id: debugTraceId,
          layer: 'web',
          worker_id: workerId,
          connection_attempt_id: input.connection_attempt_id,
          has_passkey_response: input.passkey_response !== null,
        });

        const response = await axios.post<
          IApiResponse<IBaileysConnectionState>
        >(`/worker/${workerId}/connection/passkey-response`, input, config);

        const result = response?.data?.status
          ? (response.data.data ?? null)
          : null;

        logConnectionLifecycleDebug('web.passkey_response.response', {
          trace_id: result?.debug_trace_id ?? debugTraceId,
          layer: 'web',
          worker_id: result?.worker_id ?? workerId,
          account_id: result?.account_id,
          connection_attempt_id: result?.connection_attempt_id,
          status: result?.status,
          code: result?.code,
          has_passkey_confirmation_code: Boolean(
            result?.passkey_confirmation_code
          ),
        });

        return result
          ? {
              ...result,
              debug_trace_id: result.debug_trace_id ?? debugTraceId,
            }
          : null;
      } catch (error) {
        let errorMessage = this.i18n.global.t('worker_status_update_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }
        if (!options.silent) {
          this.showSnackbar(errorMessage, EColor.error);
        }
        logConnectionLifecycleDebug('web.passkey_response.error', {
          trace_id: debugTraceId,
          layer: 'web',
          worker_id: workerId,
          connection_attempt_id: input.connection_attempt_id,
          reason: errorMessage,
        });
        return null;
      }
    },

    async confirmConnectionPasskey(
      workerId: string,
      input: { connection_attempt_id?: string },
      options: {
        silent?: boolean;
        timeoutMs?: number;
        debugTraceId?: string;
      } = {}
    ): Promise<IBaileysConnectionState | null> {
      const debugTraceId =
        options.debugTraceId ?? createWebTraceId('web_passkey_confirm');
      try {
        const response = await axios.post<
          IApiResponse<IBaileysConnectionState>
        >(
          `/worker/${workerId}/connection/passkey-confirmation`,
          input,
          buildConnectionLifecycleDebugConfig(
            debugTraceId,
            options.timeoutMs ? { timeout: options.timeoutMs } : {}
          )
        );

        return response?.data?.status ? (response.data.data ?? null) : null;
      } catch (error) {
        let errorMessage = this.i18n.global.t('worker_status_update_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }
        if (!options.silent) {
          this.showSnackbar(errorMessage, EColor.error);
        }
        return null;
      }
    },

    async resetConnectionChannel(
      workerId: string,
      options: ConnectionLifecycleDebugRequestOptions = {}
    ): Promise<IWorkerLifecycleAck | null> {
      const debugTraceId =
        options.debugTraceId ?? createWebTraceId('web_reset_channel');
      try {
        this.loading = true;
        logConnectionLifecycleDebug('web.channel_reset.submit', {
          trace_id: debugTraceId,
          layer: 'web',
          worker_id: workerId,
        });

        const response = await axios.post<IApiResponse<IWorkerLifecycleAck>>(
          `/worker/${workerId}/connection/reset`,
          {},
          buildConnectionLifecycleDebugConfig(debugTraceId)
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ??
            this.i18n.global.t('worker_connection_reset_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.showSnackbar(
          data?.message ??
            this.i18n.global.t('worker_connection_reset_success'),
          EColor.success
        );

        logConnectionLifecycleDebug('web.channel_reset.response', {
          trace_id: debugTraceId,
          layer: 'web',
          worker_id: workerId,
          status: 'accepted',
        });

        return data.data
          ? {
              ...data.data,
              debug_trace_id: data.data.debug_trace_id ?? debugTraceId,
            }
          : null;
      } catch (error) {
        let errorMessage = this.i18n.global.t('worker_connection_reset_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        logConnectionLifecycleDebug('web.channel_reset.error', {
          trace_id: debugTraceId,
          layer: 'web',
          worker_id: workerId,
          reason: errorMessage,
        });

        this.loading = false;

        return null;
      }
    },

    async disconnectConnectionChannel(
      workerId: string,
      options: ConnectionLifecycleDebugRequestOptions = {}
    ): Promise<DisconnectWorkerConnectionResponse | null> {
      const debugTraceId =
        options.debugTraceId ?? createWebTraceId('web_disconnect_channel');
      try {
        this.loading = true;
        logConnectionLifecycleDebug('web.channel_disconnect.submit', {
          trace_id: debugTraceId,
          layer: 'web',
          worker_id: workerId,
        });

        const response = await axios.delete<
          IApiResponse<DisconnectWorkerConnectionResponse>
        >(
          `/worker/${workerId}/connection`,
          buildConnectionLifecycleDebugConfig(debugTraceId)
        );
        const data = response?.data;
        const result = data?.data;

        if (
          !data?.status ||
          !result ||
          result.worker_id !== workerId ||
          !this.applySessionRemovalTerminal(result)
        ) {
          const message =
            data?.message ??
            this.i18n.global.t('worker_connection_disconnect_error');
          this.showSnackbar(message, EColor.error);
          return null;
        }

        logConnectionLifecycleDebug('web.channel_disconnect.completed', {
          trace_id: result.debug_trace_id ?? debugTraceId,
          layer: 'web',
          worker_id: result.worker_id,
          worker_status_id: result.worker_status_id,
          runtime_generation: result.runtime_generation,
          status: 'session_removed',
        });
        return result;
      } catch (error) {
        let errorMessage = this.i18n.global.t(
          'worker_connection_disconnect_error'
        );
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        logConnectionLifecycleDebug('web.channel_disconnect.error', {
          trace_id: debugTraceId,
          layer: 'web',
          worker_id: workerId,
          reason: errorMessage,
        });
        return null;
      } finally {
        this.loading = false;
      }
    },

    async createExternalConnectionLink(
      workerId: string
    ): Promise<WorkerExternalConnectionLinkResponse | null> {
      try {
        this.loading = true;

        const response = await axios.post<
          IApiResponse<WorkerExternalConnectionLinkResponse>
        >(`/worker/${workerId}/external-connection-link`);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('external_connection_link_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('external_connection_link_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async createSecureConnectionSession(
      workerId: string,
      options: { silent?: boolean; debugTraceId?: string } = {}
    ): Promise<WorkerSecureConnectionSessionResponse | null> {
      const debugTraceId =
        options.debugTraceId ?? createWebTraceId('web_secure_connection');
      try {
        if (!options.silent) {
          this.loading = true;
        }

        const response = await axios.post<
          IApiResponse<WorkerSecureConnectionSessionResponse>
        >(
          `/worker/${workerId}/connection/secure-session`,
          {},
          buildConnectionLifecycleDebugConfig(debugTraceId)
        );

        if (!options.silent) {
          this.loading = false;
        }

        const data = response?.data;
        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('secure_connection_start_error');

          if (!options.silent) {
            this.showSnackbar(message, EColor.error);
          }

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('secure_connection_start_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        if (!options.silent) {
          this.showSnackbar(errorMessage, EColor.error);
        }
        this.loading = false;

        return null;
      }
    },

    async viewSecureConnectionSession(
      workerId: string,
      token: string,
      options: { silent?: boolean } = {}
    ): Promise<WorkerSecureConnectionSessionResponse | null> {
      try {
        const response = await axios.get<
          IApiResponse<WorkerSecureConnectionSessionResponse>
        >(
          `/worker/${workerId}/connection/secure-session/${encodeURIComponent(
            token
          )}`
        );

        const data = response?.data;
        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch (error) {
        if (!options.silent && error instanceof AxiosError) {
          this.showSnackbar(
            error.response?.data?.message ??
              this.i18n.global.t('secure_connection_status_error'),
            EColor.error
          );
        }

        return null;
      }
    },

    async cancelSecureConnectionSession(
      workerId: string,
      token: string
    ): Promise<WorkerSecureConnectionSessionResponse | null> {
      try {
        const response = await axios.post<
          IApiResponse<WorkerSecureConnectionSessionResponse>
        >(
          `/worker/${workerId}/connection/secure-session/${encodeURIComponent(
            token
          )}/cancel`
        );

        return response?.data?.status ? (response.data.data ?? null) : null;
      } catch {
        return null;
      }
    },

    async downloadAuthenticatorInstaller(
      platform: AuthenticatorPlatform
    ): Promise<boolean> {
      await this.getConnectionDownloadArtifacts();
      const url = this.getAuthenticatorInstallerUrl(platform);

      if (!url) {
        this.showSnackbar(
          this.i18n.global.t('download_artifacts_public_url_required'),
          EColor.error
        );
        return false;
      }

      openPublicDownloadUrl(url);
      return true;
    },

    async downloadChromeExtensionPackage(): Promise<boolean> {
      await this.getConnectionDownloadArtifacts();
      const url = this.getChromeExtensionPackageUrl();

      if (!url) {
        this.showSnackbar(
          this.i18n.global.t('download_artifacts_public_url_required'),
          EColor.error
        );
        return false;
      }

      openPublicDownloadUrl(url);
      return true;
    },

    async getConnectionDownloadArtifacts(options?: {
      silent?: boolean;
    }): Promise<DownloadArtifactsResponse | null> {
      if (this.connectionDownloadArtifacts) {
        return this.connectionDownloadArtifacts;
      }

      try {
        const response = await axios.get<
          IApiResponse<DownloadArtifactsResponse>
        >('/worker/connection/download-artifacts');

        const data = response?.data;

        if (!data?.status || !data?.data) {
          if (!options?.silent) {
            this.showSnackbar(
              data?.message ??
                this.i18n.global.t('download_artifacts_connection_load_error'),
              EColor.error
            );
          }

          return null;
        }

        this.connectionDownloadArtifacts = data.data;
        return data.data;
      } catch (error) {
        if (!options?.silent) {
          let errorMessage = this.i18n.global.t(
            'download_artifacts_connection_load_error'
          );
          if (error instanceof AxiosError) {
            errorMessage = error?.response?.data?.message ?? errorMessage;
          }

          this.showSnackbar(errorMessage, EColor.error);
        }

        return null;
      }
    },

    getAuthenticatorInstallerUrl(platform: AuthenticatorPlatform): string {
      const artifact = this.getAuthenticatorInstallerArtifact(platform);
      return artifact?.url?.trim() ?? '';
    },

    getChromeExtensionPackageUrl(): string {
      const environment = connectionDownloadEnvironment();
      const artifact = this.connectionDownloadArtifacts?.artifacts.find(
        (item) => item.artifact_key === `chrome_extension_${environment}_zip`
      );

      return artifact?.url?.trim() ?? '';
    },

    getAuthenticatorInstallerArtifact(
      platform: AuthenticatorPlatform
    ): DownloadArtifactResponse | null {
      const environment = connectionDownloadEnvironment();
      const variantByPlatform: Record<AuthenticatorPlatform, string> = {
        linux: 'deb',
        macos: 'dmg',
        windows: 'exe',
      };
      const artifactKey = `authenticator_${environment}_${platform}_${variantByPlatform[platform]}`;

      return (
        this.connectionDownloadArtifacts?.artifacts.find(
          (artifact) => artifact.artifact_key === artifactKey
        ) ?? null
      );
    },

    async viewExternalConnection(
      token: string
    ): Promise<WorkerExternalConnectionViewResponse | null> {
      try {
        const response = await axios.get<
          IApiResponse<WorkerExternalConnectionViewResponse>
        >(`/worker/external-connection/${encodeURIComponent(token)}`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async requestExternalConnectionQrCode(
      token: string,
      options: { timeoutMs?: number } = {}
    ): Promise<IBaileysConnectionState | null> {
      try {
        const config: AxiosRequestConfig | undefined = options.timeoutMs
          ? { timeout: options.timeoutMs }
          : undefined;

        const response = await axios.post<
          IApiResponse<IBaileysConnectionState>
        >(
          `/worker/external-connection/${encodeURIComponent(token)}/qrcode`,
          {},
          config
        );

        return response?.data?.status ? (response.data.data ?? null) : null;
      } catch {
        return null;
      }
    },

    async sendExternalConnectionPasskeyResponse(
      token: string,
      input: {
        connection_attempt_id?: string;
        passkey_response: unknown;
      },
      options: { timeoutMs?: number } = {}
    ): Promise<IBaileysConnectionState | null> {
      try {
        const config: AxiosRequestConfig | undefined = options.timeoutMs
          ? { timeout: options.timeoutMs }
          : undefined;

        const response = await axios.post<
          IApiResponse<IBaileysConnectionState>
        >(
          `/worker/external-connection/${encodeURIComponent(token)}/passkey-response`,
          input,
          config
        );

        return response?.data?.status ? (response.data.data ?? null) : null;
      } catch {
        return null;
      }
    },

    async confirmExternalConnectionPasskey(
      token: string,
      input: { connection_attempt_id?: string },
      options: { timeoutMs?: number } = {}
    ): Promise<IBaileysConnectionState | null> {
      try {
        const config: AxiosRequestConfig | undefined = options.timeoutMs
          ? { timeout: options.timeoutMs }
          : undefined;

        const response = await axios.post<
          IApiResponse<IBaileysConnectionState>
        >(
          `/worker/external-connection/${encodeURIComponent(token)}/passkey-confirmation`,
          input,
          config
        );

        return response?.data?.status ? (response.data.data ?? null) : null;
      } catch {
        return null;
      }
    },

    async channelLogsConnection(
      channelId: string,
      input: WorkerConnectionLogsQuery
    ): Promise<WorkerConnectionHealthResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<WorkerConnectionHealthResponse>
        >(`/worker/logs/connection/${channelId}`, {
          params: input,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('worker_logs_connection_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('worker_logs_connection_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async recreateChannel(
      workerId: string,
      options: ConnectionLifecycleDebugRequestOptions = {}
    ): Promise<IWorkerLifecycleAck | null> {
      const debugTraceId =
        options.debugTraceId ?? createWebTraceId('web_recreate_channel');
      const channelBeforeRequest = this.list.find(
        (item) => item.id === workerId
      );
      const baseline: ChannelRecreateBaseline = {
        workerTypeId: channelBeforeRequest?.type?.id,
        runtimeGeneration: channelBeforeRequest?.runtime_generation,
      };
      try {
        this.loading = true;
        logConnectionLifecycleDebug('web.channel_recreate.submit', {
          trace_id: debugTraceId,
          layer: 'web',
          worker_id: workerId,
        });

        const response = await axios.patch<IApiResponse<IWorkerLifecycleAck>>(
          `/worker/${workerId}`,
          undefined,
          buildConnectionLifecycleDebugConfig(debugTraceId)
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('worker_recreation_failed');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        if (!data.data || !isWorkerLifecycleAck(data.data)) {
          this.showSnackbar(
            this.i18n.global.t('worker_recreation_failed'),
            EColor.error
          );
          return null;
        }

        const ack: IWorkerLifecycleAck = {
          ...data.data,
          debug_trace_id: data.data.debug_trace_id ?? debugTraceId,
        };
        if (!this.applyAcceptedRecreateAck(ack, baseline)) {
          this.showSnackbar(
            this.i18n.global.t('worker_recreation_failed'),
            EColor.error
          );
          return null;
        }

        if (
          Object.prototype.hasOwnProperty.call(ack, 'recreate_available_at')
        ) {
          this.updateChannelRecreateAvailableAt(
            workerId,
            ack.recreate_available_at ?? null
          );
        }

        logConnectionLifecycleDebug('web.channel_recreate.response', {
          trace_id: ack.debug_trace_id ?? debugTraceId,
          layer: 'web',
          worker_id: ack.worker_id,
          account_id: ack.account_id,
          worker_type_id: ack.worker_type_id,
          lifecycle_operation_id: ack.operation_id,
          status: ack.status,
          reason: ack.reason,
        });

        this.showSnackbar(
          this.i18n.global.t('worker_recreate_success'),
          EColor.success
        );

        return ack;
      } catch (error) {
        let errorMessage = this.i18n.global.t('worker_recreation_failed');
        if (error instanceof AxiosError) {
          const responseData = error.response?.data as
            WorkerRecreateCooldownConflictResponse | undefined;

          if (
            responseData?.data &&
            Object.prototype.hasOwnProperty.call(
              responseData.data,
              'recreate_available_at'
            )
          ) {
            this.updateChannelRecreateAvailableAt(
              workerId,
              responseData.data.recreate_available_at
            );
          }

          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        logConnectionLifecycleDebug('web.channel_recreate.error', {
          trace_id: debugTraceId,
          layer: 'web',
          worker_id: workerId,
          reason: errorMessage,
        });

        this.loading = false;

        return null;
      }
    },

    async fetchWorkerProfileStatus(
      workerId: string
    ): Promise<ProfileStatus[] | null> {
      if (!workerId) return [];

      try {
        this.loading = true;

        const response = await axios.get<IApiResponse<ProfileStatus[]>>(
          `/worker/${workerId}/profile/status`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('profile_status_load_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        this.loading = false;

        let message = this.i18n.global.t('profile_status_load_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    buildProfileStatusFormData(
      workerProfileStatusTypeId: string,
      files?: File[],
      text?: string,
      caption?: string,
      isPermanent: string = 'false',
      visibilityData?: {
        visibility_type?: string;
        contact_group_ids?: string[];
        contact_ids?: string[];
      }
    ): FormData {
      const formData = new FormData();
      formData.append(
        'worker_profile_status_type_id',
        workerProfileStatusTypeId
      );

      if (files?.length) {
        for (const file of files) {
          formData.append('photos', file);
        }
      }

      if (text) {
        formData.append('text', text);
      }

      if (caption) {
        formData.append('caption', caption);
      }

      formData.append('is_permanent', isPermanent);

      if (!visibilityData) {
        return formData;
      }

      if (visibilityData.visibility_type) {
        formData.append('visibility_type', visibilityData.visibility_type);
      }

      if (visibilityData.contact_group_ids?.length) {
        formData.append(
          'contact_group_ids',
          JSON.stringify(visibilityData.contact_group_ids)
        );
      }

      if (visibilityData.contact_ids?.length) {
        formData.append(
          'contact_ids',
          JSON.stringify(visibilityData.contact_ids)
        );
      }

      return formData;
    },

    async uploadWorkerProfileStatus(
      workerId: string,
      workerProfileStatusTypeId: string,
      files?: File[],
      text?: string,
      caption?: string,
      isPermanent: string = 'false',
      visibilityData?: {
        visibility_type?: string;
        contact_group_ids?: string[];
        contact_ids?: string[];
      }
    ): Promise<WorkerProfileStatus[] | null> {
      if (!workerId || !workerProfileStatusTypeId) return null;

      try {
        this.loading = true;

        const formData = this.buildProfileStatusFormData(
          workerProfileStatusTypeId,
          files,
          text,
          caption,
          isPermanent,
          visibilityData
        );

        const config: AxiosRequestConfig<FormData> = {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        };

        const response = await axios.post<IApiResponse<WorkerProfileStatus[]>>(
          `/worker/${workerId}/profile/status`,
          formData,
          config
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('profile_status_upload_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('profile_status_upload_success'),
          EColor.success
        );

        return data.data;
      } catch (error) {
        this.loading = false;

        let message = this.i18n.global.t('profile_status_upload_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchWorkerProfilePhotos(
      workerId: string
    ): Promise<ProfileStatus[] | null> {
      return this.fetchWorkerProfileStatus(workerId);
    },

    async uploadWorkerProfilePhotos(
      workerId: string,
      files: File[],
      isPermanent: boolean = false
    ): Promise<WorkerProfileStatus[] | null> {
      return this.uploadWorkerProfileStatus(
        workerId,
        '019a9d00-0002-7000-8000-000000000002',
        files,
        undefined,
        undefined,
        isPermanent.toString()
      );
    },

    async updateProfileStatusIsPermanent(
      workerProfileStatusId: string,
      isPermanent: boolean
    ): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<null>>(
          `/worker/profile/status/${workerProfileStatusId}`,
          {
            is_permanent: isPermanent,
          }
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('profile_status_update_error');
          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('profile_status_update_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        this.loading = false;

        let message = this.i18n.global.t('profile_status_update_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return false;
      }
    },

    async updateProfileStatusPhotoIsPermanent(
      workerProfileStatusId: string,
      isPermanent: boolean
    ): Promise<boolean> {
      return this.updateProfileStatusIsPermanent(
        workerProfileStatusId,
        isPermanent
      );
    },

    async uploadWorkerProfileInfo(
      workerId: string,
      name?: string | null,
      message?: string | null,
      photo?: File | null,
      removePhoto?: boolean,
      officialProfile?: OfficialWorkerProfileInfoPayload
    ): Promise<WorkerProfileInfo | null> {
      if (!workerId) return null;

      try {
        this.loading = true;

        const formData = new FormData();

        if (name !== undefined && name !== null) {
          formData.append('name', name);
        }

        if (message !== undefined && message !== null) {
          formData.append('message', message);
        }

        if (photo instanceof File) {
          formData.append('photo', photo);
        }

        if (removePhoto) {
          formData.append('remove_photo', 'true');
        }

        if (officialProfile) {
          for (const [key, value] of Object.entries(officialProfile)) {
            if (value !== undefined && value !== null) {
              formData.append(key, value);
            }
          }
        }

        const config: AxiosRequestConfig<FormData> = {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        };

        const response = await axios.post<IApiResponse<WorkerProfileInfo>>(
          `/worker/${workerId}/profile/info`,
          formData,
          config
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('profile_info_upload_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('profile_info_upload_success') ||
            'Informações do perfil salvas com sucesso',
          EColor.success
        );

        return data.data;
      } catch (error) {
        let errorMessage =
          this.i18n.global.t('profile_info_upload_error') ||
          'Erro ao salvar informações do perfil';

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async fetchWorkerProfileInfo(
      workerId: string
    ): Promise<WorkerProfileInfo | null> {
      if (!workerId) return null;

      try {
        this.loading = true;

        const response = await axios.get<IApiResponse<WorkerProfileInfo>>(
          `/worker/${workerId}/profile/info`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          return null;
        }

        return data.data;
      } catch {
        this.loading = false;

        return null;
      }
    },

    async fetchWorkerConfig(
      workerId: string,
      forceRefresh = false
    ): Promise<ViewWorkerConfigResponse | null> {
      if (!workerId) return null;

      if (!forceRefresh && this.workerConfigCache[workerId] !== undefined) {
        return this.workerConfigCache[workerId];
      }

      try {
        const response = await axios.get<
          IApiResponse<ViewWorkerConfigResponse>
        >(`/worker/${workerId}/config`);

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ??
            this.i18n.global.t('channel_general_config_load_error');
          this.showSnackbar(message, EColor.error);

          this.workerConfigCache[workerId] = null;
          return null;
        }

        this.workerConfigCache[workerId] = data.data ?? null;
        return this.workerConfigCache[workerId];
      } catch (error) {
        let message = this.i18n.global.t('channel_general_config_load_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        this.workerConfigCache[workerId] = null;
        return null;
      }
    },

    fetchWorkerConfigForChat(
      workerId: string
    ): Promise<ViewWorkerConfigForChatResponse | null> {
      if (!workerId) return Promise.resolve(null);

      if (this.workerConfigForChatCache[workerId] !== undefined) {
        return Promise.resolve(this.workerConfigForChatCache[workerId]);
      }

      if (workerId in workerConfigForChatPendingModule) {
        return workerConfigForChatPendingModule[workerId];
      }

      const promise = axios
        .get<IApiResponse<ViewWorkerConfigForChatResponse>>(
          `/chat/worker/${workerId}/config`
        )
        .then((response) => {
          const data = response?.data;

          if (!data?.status) {
            const message =
              data?.message ??
              this.i18n.global.t('channel_general_config_load_error');
            this.showSnackbar(message, EColor.error);

            this.workerConfigForChatCache[workerId] = null;
            return null;
          }

          this.workerConfigForChatCache[workerId] = data.data ?? null;
          return this.workerConfigForChatCache[workerId];
        })
        .catch((error) => {
          let message = this.i18n.global.t('channel_general_config_load_error');
          if (error instanceof AxiosError) {
            message = error?.response?.data?.message ?? message;
          }

          this.showSnackbar(message, EColor.error);

          this.workerConfigForChatCache[workerId] = null;
          return null;
        })
        .finally(() => {
          delete workerConfigForChatPendingModule[workerId];
        });

      workerConfigForChatPendingModule[workerId] = promise;
      return promise;
    },

    async updateWorkerConfig(
      workerId: string,
      body: UpdateWorkerConfigRequest
    ): Promise<WorkerConfig | null> {
      if (!workerId) return null;

      try {
        const response = await axios.post<IApiResponse<WorkerConfig>>(
          `/worker/${workerId}/config`,
          body
        );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('channel_general_config_save_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('channel_general_config_save_success'),
          EColor.success
        );

        this.workerConfigCache[workerId] = data.data ?? null;
        delete this.workerConfigForChatCache[workerId];

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('channel_general_config_save_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchTransferProtocolText(workerId: string): Promise<{
      generate_protocol_at_transfer: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<{
            generate_protocol_at_transfer: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/transfer-protocol`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateTransferProtocolText(
      workerId: string,
      text: string | null,
      enabled: boolean
    ): Promise<{
      generate_protocol_at_transfer: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const body: { text?: string; enabled: boolean } = {
          enabled,
        };
        if (text !== null) {
          body.text = text;
        }

        const response = await axios.patch<
          IApiResponse<{
            generate_protocol_at_transfer: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/transfer-protocol`, body);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('transfer_protocol_text_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('transfer_protocol_text_update_success'),
          EColor.success
        );

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('transfer_protocol_text_update_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchTransferProtocolSectorText(workerId: string): Promise<{
      generate_protocol_at_transfer_sector: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<{
            generate_protocol_at_transfer_sector: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/transfer-protocol-sector`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateTransferProtocolSectorText(
      workerId: string,
      text: string | null,
      enabled: boolean
    ): Promise<{
      generate_protocol_at_transfer_sector: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const body: { text?: string; enabled: boolean } = {
          enabled,
        };
        if (text !== null) {
          body.text = text;
        }

        const response = await axios.patch<
          IApiResponse<{
            generate_protocol_at_transfer_sector: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/transfer-protocol-sector`, body);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('transfer_protocol_text_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('transfer_protocol_text_update_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchTransferProtocolSectorAndUserText(workerId: string): Promise<{
      generate_protocol_at_transfer_sector_and_user: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<{
            generate_protocol_at_transfer_sector_and_user: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/transfer-protocol-sector-and-user`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateTransferProtocolSectorAndUserText(
      workerId: string,
      text: string | null,
      enabled: boolean
    ): Promise<{
      generate_protocol_at_transfer_sector_and_user: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const body: { text?: string; enabled: boolean } = {
          enabled,
        };
        if (text !== null) {
          body.text = text;
        }

        const response = await axios.patch<
          IApiResponse<{
            generate_protocol_at_transfer_sector_and_user: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/transfer-protocol-sector-and-user`, body);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('transfer_protocol_text_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('transfer_protocol_text_update_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchStartProtocolText(workerId: string): Promise<{
      generate_protocol_at_start: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<{
            generate_protocol_at_start: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/start-protocol`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateStartProtocolText(
      workerId: string,
      text: string | null,
      enabled: boolean
    ): Promise<{
      generate_protocol_at_start: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const body: { text?: string; enabled: boolean } = {
          enabled,
        };
        if (text !== null) {
          body.text = text;
        }

        const response = await axios.patch<
          IApiResponse<{
            generate_protocol_at_start: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/start-protocol`, body);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('start_protocol_text_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('start_protocol_text_update_success'),
          EColor.success
        );

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('start_protocol_text_update_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchChatbot(workerId: string): Promise<{
      chatbot_id: string | null;
      output_chatbot_id: string | null;
      chatbot_working_hours_enabled: boolean;
      chatbot_working_hours_timezone: string;
      chatbot_working_hours_rules: Array<{
        weekday:
          | 'monday'
          | 'tuesday'
          | 'wednesday'
          | 'thursday'
          | 'friday'
          | 'saturday'
          | 'sunday';
        start_time: string;
        end_time: string;
        chatbot_id: string;
      }>;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<{
            chatbot_id: string | null;
            output_chatbot_id: string | null;
            chatbot_working_hours_enabled: boolean;
            chatbot_working_hours_timezone: string;
            chatbot_working_hours_rules: Array<{
              weekday:
                | 'monday'
                | 'tuesday'
                | 'wednesday'
                | 'thursday'
                | 'friday'
                | 'saturday'
                | 'sunday';
              start_time: string;
              end_time: string;
              chatbot_id: string;
            }>;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/chatbot`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateChatbot(
      workerId: string,
      chatbotId: string | null,
      outputChatbotId: string | null,
      enabled: boolean,
      chatbotWorkingHoursEnabled: boolean,
      chatbotWorkingHoursTimezone: string,
      chatbotWorkingHoursRules: Array<{
        weekday:
          | 'monday'
          | 'tuesday'
          | 'wednesday'
          | 'thursday'
          | 'friday'
          | 'saturday'
          | 'sunday';
        start_time: string;
        end_time: string;
        chatbot_id: string;
      }>
    ): Promise<{
      chatbot_id: string | null;
      output_chatbot_id: string | null;
      chatbot_working_hours_enabled: boolean;
      chatbot_working_hours_timezone: string;
      chatbot_working_hours_rules: Array<{
        weekday:
          | 'monday'
          | 'tuesday'
          | 'wednesday'
          | 'thursday'
          | 'friday'
          | 'saturday'
          | 'sunday';
        start_time: string;
        end_time: string;
        chatbot_id: string;
      }>;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const body: {
          chatbot_id?: string | null;
          output_chatbot_id?: string | null;
          chatbot_working_hours_enabled?: boolean;
          chatbot_working_hours_timezone?: string;
          chatbot_working_hours_rules?: Array<{
            weekday:
              | 'monday'
              | 'tuesday'
              | 'wednesday'
              | 'thursday'
              | 'friday'
              | 'saturday'
              | 'sunday';
            start_time: string;
            end_time: string;
            chatbot_id: string;
          }>;
          enabled: boolean;
        } = {
          enabled,
          chatbot_id: chatbotId,
          output_chatbot_id: outputChatbotId,
          chatbot_working_hours_enabled: chatbotWorkingHoursEnabled,
          chatbot_working_hours_timezone: chatbotWorkingHoursTimezone,
          chatbot_working_hours_rules: chatbotWorkingHoursRules,
        };

        const response = await axios.patch<
          IApiResponse<{
            chatbot_id: string | null;
            output_chatbot_id: string | null;
            chatbot_working_hours_enabled: boolean;
            chatbot_working_hours_timezone: string;
            chatbot_working_hours_rules: Array<{
              weekday:
                | 'monday'
                | 'tuesday'
                | 'wednesday'
                | 'thursday'
                | 'friday'
                | 'saturday'
                | 'sunday';
              start_time: string;
              end_time: string;
              chatbot_id: string;
            }>;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/chatbot`, body);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('chatbot_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('chatbot_update_success'),
          EColor.success
        );

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('chatbot_update_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchAiAgentConfig(workerId: string): Promise<{
      ai_agent_id: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<{
            ai_agent_id: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/ai-agent`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('ai_agent_config_load_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('ai_agent_config_load_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }
        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async updateAiAgentConfig(
      workerId: string,
      aiAgentId: string | null,
      enabled: boolean
    ): Promise<{
      ai_agent_id: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const body: {
          ai_agent_id?: string | null;
          enabled: boolean;
        } = {
          enabled,
          ai_agent_id: aiAgentId,
        };

        const response = await axios.patch<
          IApiResponse<{
            ai_agent_id: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/ai-agent`, body);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('ai_agent_config_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('ai_agent_config_update_success'),
          EColor.success
        );

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('ai_agent_config_update_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async deleteProfileStatus(workerProfileStatusId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<null>>(
          `/worker/profile/status/${workerProfileStatusId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('profile_status_delete_error');
          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('profile_status_delete_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        this.loading = false;

        let message = this.i18n.global.t('profile_status_delete_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return false;
      }
    },

    async fetchSimultaneousAttendance(workerId: string): Promise<{
      simultaneous_attendance: number | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<{
            simultaneous_attendance: number | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/simultaneous-attendance`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateSimultaneousAttendance(
      workerId: string,
      quantity: number | null,
      enabled: boolean
    ): Promise<{
      simultaneous_attendance: number | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const body: { quantity?: number; enabled: boolean } = {
          enabled,
        };
        if (quantity !== null) {
          body.quantity = quantity;
        }

        const response = await axios.patch<
          IApiResponse<{
            simultaneous_attendance: number | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/simultaneous-attendance`, body);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('simultaneous_attendance_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('simultaneous_attendance_update_success'),
          EColor.success
        );

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t(
          'simultaneous_attendance_update_error'
        );
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchTypingSimulation(
      workerId: string
    ): Promise<ViewTypingSimulationResponse | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<ViewTypingSimulationResponse>
        >(`/worker/${workerId}/config/typing-simulation`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateTypingSimulation(
      workerId: string,
      body: UpdateTypingSimulationRequest
    ): Promise<UpdateTypingSimulationResponse | null> {
      if (!workerId) return null;

      try {
        const response = await axios.patch<
          IApiResponse<UpdateTypingSimulationResponse>
        >(`/worker/${workerId}/config/typing-simulation`, body);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('typing_simulation_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('typing_simulation_update_success'),
          EColor.success
        );

        delete this.workerConfigCache[workerId];
        delete this.workerConfigForChatCache[workerId];

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('typing_simulation_update_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchSecurityKey(
      workerId: string
    ): Promise<ViewSecurityKeyResponse | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<IApiResponse<ViewSecurityKeyResponse>>(
          `/worker/${workerId}/config/security-key`
        );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateSecurityKey(
      workerId: string,
      body: UpdateSecurityKeyRequest
    ): Promise<UpdateSecurityKeyResponse | null> {
      if (!workerId) return null;

      try {
        const response = await axios.patch<
          IApiResponse<UpdateSecurityKeyResponse>
        >(`/worker/${workerId}/config/security-key`, body);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('security_key_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('security_key_update_success'),
          EColor.success
        );

        delete this.workerConfigCache[workerId];
        delete this.workerConfigForChatCache[workerId];

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('security_key_update_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchShowMessageOnCall(workerId: string): Promise<{
      show_message_on_call: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<{
            show_message_on_call: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/show-message-on-call`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateShowMessageOnCall(
      workerId: string,
      text: string | null,
      enabled: boolean
    ): Promise<{
      show_message_on_call: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const body: { text?: string; enabled: boolean } = {
          enabled,
        };
        if (text !== null) {
          body.text = text;
        }

        const response = await axios.patch<
          IApiResponse<{
            show_message_on_call: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/show-message-on-call`, body);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('show_message_on_call_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('show_message_on_call_update_success'),
          EColor.success
        );

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('show_message_on_call_update_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchSendMessageOnFinishAttendance(workerId: string): Promise<{
      send_message_on_finish_attendance: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<{
            send_message_on_finish_attendance: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/send-message-on-finish-attendance`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateSendMessageOnFinishAttendance(
      workerId: string,
      text: string | null,
      enabled: boolean
    ): Promise<{
      send_message_on_finish_attendance: string | null;
      enabled: boolean;
    } | null> {
      if (!workerId) return null;

      try {
        const body: { text?: string; enabled: boolean } = {
          enabled,
        };
        if (text !== null) {
          body.text = text;
        }

        const response = await axios.patch<
          IApiResponse<{
            send_message_on_finish_attendance: string | null;
            enabled: boolean;
          }>
        >(`/worker/${workerId}/config/send-message-on-finish-attendance`, body);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t(
              'send_message_on_finish_attendance_update_error'
            );
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t(
            'send_message_on_finish_attendance_update_success'
          ),
          EColor.success
        );

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t(
          'send_message_on_finish_attendance_update_error'
        );
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchAttendanceInactivityAlert(
      workerId: string
    ): Promise<ViewAttendanceInactivityAlertResponse | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<ViewAttendanceInactivityAlertResponse>
        >(`/worker/${workerId}/config/attendance-inactivity-alert`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateAttendanceInactivityAlert(
      workerId: string,
      body: UpdateAttendanceInactivityAlertRequest
    ): Promise<UpdateAttendanceInactivityAlertResponse | null> {
      if (!workerId) return null;

      try {
        const response = await axios.patch<
          IApiResponse<UpdateAttendanceInactivityAlertResponse>
        >(`/worker/${workerId}/config/attendance-inactivity-alert`, body);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('attendance_inactivity_alert_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('attendance_inactivity_alert_update_success'),
          EColor.success
        );

        delete this.workerConfigCache[workerId];
        delete this.workerConfigForChatCache[workerId];

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t(
          'attendance_inactivity_alert_update_error'
        );
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchOperatorReplyPendingAlert(
      workerId: string
    ): Promise<ViewOperatorReplyPendingAlertResponse | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<ViewOperatorReplyPendingAlertResponse>
        >(`/worker/${workerId}/config/operator-reply-pending-alert`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateOperatorReplyPendingAlert(
      workerId: string,
      body: UpdateOperatorReplyPendingAlertRequest
    ): Promise<UpdateOperatorReplyPendingAlertResponse | null> {
      if (!workerId) return null;

      try {
        const response = await axios.patch<
          IApiResponse<UpdateOperatorReplyPendingAlertResponse>
        >(`/worker/${workerId}/config/operator-reply-pending-alert`, body);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('operator_reply_pending_alert_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('operator_reply_pending_alert_update_success'),
          EColor.success
        );

        delete this.workerConfigCache[workerId];
        delete this.workerConfigForChatCache[workerId];

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t(
          'operator_reply_pending_alert_update_error'
        );
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    async fetchOperatorReplyPendingRedistribution(
      workerId: string
    ): Promise<ViewOperatorReplyPendingRedistributionResponse | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<ViewOperatorReplyPendingRedistributionResponse>
        >(`/worker/${workerId}/config/operator-reply-pending-redistribution`);
        const data = response?.data;
        return data?.status && data.data ? data.data : null;
      } catch {
        return null;
      }
    },

    async updateOperatorReplyPendingRedistribution(
      workerId: string,
      body: UpdateOperatorReplyPendingRedistributionRequest
    ): Promise<UpdateOperatorReplyPendingRedistributionResponse | null> {
      if (!workerId) return null;

      try {
        const response = await axios.patch<
          IApiResponse<UpdateOperatorReplyPendingRedistributionResponse>
        >(
          `/worker/${workerId}/config/operator-reply-pending-redistribution`,
          body
        );
        const data = response?.data;
        if (!data?.status || !data.data) {
          this.showSnackbar(
            data?.message ??
              this.i18n.global.t(
                'operator_reply_pending_redistribution_update_error'
              ),
            EColor.error
          );
          return null;
        }

        this.showSnackbar(
          this.i18n.global.t(
            'operator_reply_pending_redistribution_update_success'
          ),
          EColor.success
        );
        delete this.workerConfigCache[workerId];
        delete this.workerConfigForChatCache[workerId];
        return data.data;
      } catch (error) {
        let message = this.i18n.global.t(
          'operator_reply_pending_redistribution_update_error'
        );
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }
        this.showSnackbar(message, EColor.error);
        return null;
      }
    },

    async fetchAttendanceHours(
      workerId: string
    ): Promise<ViewAttendanceHoursResponse | null> {
      if (!workerId) return null;

      try {
        const response = await axios.get<
          IApiResponse<ViewAttendanceHoursResponse>
        >(`/worker/${workerId}/config/attendance-hours`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },

    async updateAttendanceHours(
      workerId: string,
      body: UpdateAttendanceHoursRequest
    ): Promise<UpdateAttendanceHoursResponse | null> {
      if (!workerId) return null;

      try {
        const response = await axios.patch<
          IApiResponse<UpdateAttendanceHoursResponse>
        >(`/worker/${workerId}/config/attendance-hours`, body);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('attendance_hours_update_error');
          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('attendance_hours_update_success'),
          EColor.success
        );

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('attendance_hours_update_error');
        if (error instanceof AxiosError) {
          message = error?.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);

        return null;
      }
    },

    updateStatusChannel(
      input: IBaileysConnectionState,
      canonicalWorkerStatusId?: string | null
    ): boolean {
      const channelDeletion = isChannelDeletionPublication(input);
      if (isSessionRemovalTerminalPublication(input)) {
        const knownChannel = this.list.find(
          (channel) => channel.id === input.worker_id
        );
        if (
          knownChannel?.account?.id &&
          knownChannel.account.id !== input.account_id
        ) {
          return false;
        }
        return this.applySessionRemovalTerminal({
          worker_id: input.worker_id,
          worker_status_id: EWorkerStatus.disponible,
          session_removed: true,
          disconnected_user: true,
          runtime_generation: input.runtime_generation as number,
          container_id: input.container_id ?? null,
          worker_status_observed_at: input.worker_status_observed_at as string,
          ...(input.debug_trace_id
            ? { debug_trace_id: input.debug_trace_id }
            : {}),
        });
      }

      const sessionRemovalObservedAt =
        this.sessionRemovalObservedAtByWorkerId[input.worker_id];
      const sessionRemovalGeneration =
        this.sessionRemovalGenerationByWorkerId[input.worker_id];
      const sessionRemovalFence = evaluateSessionRemovalPublicationFence({
        event: input,
        channelDeletion,
        terminalObservedAt: sessionRemovalObservedAt,
        terminalGeneration: sessionRemovalGeneration,
      });
      if (sessionRemovalFence === 'rejected') return false;
      if (sessionRemovalFence === 'release') {
        delete this.sessionRemovalGenerationByWorkerId[input.worker_id];
      }

      if (hasManagerWorkerLifecycleEnvelope(input)) {
        return this.applyManagerWorkerLifecycleEvent(
          input,
          canonicalWorkerStatusId
        );
      }

      // Only the manager's explicit lifecycle stream may mutate/remove a
      // worker. Provider telemetry can carry similarly named fields and must
      // never be able to create a false-positive deletion.
      const mutatesWorkerLifecycle = input.event_type === 'status';
      if (
        mutatesWorkerLifecycle &&
        input.worker_status_id === EWorkerStatus.delete
      ) {
        const alreadyTombstoned =
          this.channelDeletionTombstones[input.worker_id] === true;
        const deleted = this.finalizeChannelDeletion(
          input.worker_id,
          input.account_id
        );
        logLocalConnectionStatus('web.store.update_status.deleted', {
          layer: 'web.store',
          worker_id: input.worker_id,
          account_id: input.account_id,
          worker_type_id: input.worker_type_id,
          worker_status_id: input.worker_status_id,
          status: input.status,
          code: input.code,
          runtime_generation: input.runtime_generation,
          idempotent: alreadyTombstoned,
        });
        return deleted;
      }

      const index = this.list.findIndex(
        (c) => c.account?.id === input.account_id && c.id === input.worker_id
      );

      if (index === -1) {
        logLocalConnectionStatus('web.store.update_status.not_found', {
          layer: 'web.store',
          worker_id: input.worker_id,
          account_id: input.account_id,
          worker_type_id: input.worker_type_id,
          worker_status_id: input.worker_status_id,
          status: input.status,
          code: input.code,
          session_ready: input.session_ready,
          phone: input.phone,
          connection_attempt_id: input.connection_attempt_id,
          runtime_generation: input.runtime_generation,
        });
        return false;
      }

      const channel = this.list[index];
      if (
        mutatesWorkerLifecycle &&
        input.worker_status_id === EWorkerStatus.deleting
      ) {
        channel.status = {
          id: EWorkerStatus.deleting,
          name: 'deleting',
        };
        logLocalConnectionStatus('web.store.update_status.deleting', {
          layer: 'web.store',
          worker_id: input.worker_id,
          account_id: input.account_id,
          worker_type_id: input.worker_type_id,
          worker_status_id: input.worker_status_id,
          status: input.status,
          code: input.code,
          runtime_generation: input.runtime_generation,
        });
        return true;
      }

      const nativeProjectionDecision = validateNativeRealtimeProjection(
        channel,
        input
      );
      if (!nativeProjectionDecision.accepted) return false;
      const nativeProjection = nativeProjectionDecision.projection;
      const managerPairingReady = isManagerPairingReadyPublication(input);
      const persistedWorkerTypeId = channel.type?.id;

      const realtimeFence = evaluateWhatsappRealtimeStatusFence({
        persistedWorkerTypeId,
        eventWorkerTypeId: input.worker_type_id,
        persistedRuntimeGeneration: channel.runtime_generation,
        eventRuntimeGeneration: input.runtime_generation,
        persistedConnectionStatusOrder: channel.connection_status_order,
        hasValidatedNativeProjection:
          nativeProjection.appliesNativeProjection || managerPairingReady,
      });
      if (!realtimeFence.accepted) {
        logLocalConnectionStatus('web.store.update_status.fence_rejected', {
          layer: 'web.store',
          worker_id: input.worker_id,
          account_id: input.account_id,
          worker_type_id: input.worker_type_id,
          persisted_worker_type_id: persistedWorkerTypeId,
          runtime_generation: input.runtime_generation,
          persisted_runtime_generation: channel.runtime_generation,
          reason: realtimeFence.reason,
        });
        return false;
      }

      if (this.channelLifecycleOperationById[input.worker_id]) {
        logLocalConnectionStatus(
          'web.store.update_status.recreate_waiting_exact_completion',
          {
            layer: 'web.store',
            worker_id: input.worker_id,
            account_id: input.account_id,
            worker_type_id: input.worker_type_id,
            worker_status_id: input.worker_status_id,
            lifecycle_operation_id:
              this.channelLifecycleOperationById[input.worker_id],
            runtime_generation: input.runtime_generation,
            persisted_runtime_generation: channel.runtime_generation,
          }
        );
        return false;
      }
      if (isWeakOnlinePublication(input, nativeProjection)) {
        logLocalConnectionStatus(
          'web.store.update_status.weak_online_rejected',
          {
            layer: 'web.store',
            worker_id: input.worker_id,
            account_id: input.account_id,
            worker_type_id: input.worker_type_id,
            worker_status_id: input.worker_status_id,
            status: input.status,
            code: input.code,
            session_ready: input.session_ready,
            can_send: input.can_send,
            can_receive_runtime: input.can_receive_runtime,
            authenticated: input.authenticated,
            provider_state: input.provider_state,
            degraded_reason: input.degraded_reason,
            phone: input.phone,
            connection_attempt_id: input.connection_attempt_id,
            runtime_generation: input.runtime_generation,
          }
        );
        return false;
      }

      const previous = applyAcceptedRealtimeProjection(
        channel,
        input,
        nativeProjection,
        realtimeFence.runtimeGeneration
      );

      logLocalConnectionStatus('web.store.update_status.applied', {
        layer: 'web.store',
        worker_id: input.worker_id,
        account_id: input.account_id,
        worker_type_id: input.worker_type_id,
        previous_worker_type_id: previous.workerTypeId,
        next_worker_type_id: channel.type?.id ?? null,
        worker_status_id: input.worker_status_id,
        previous_worker_status_id: previous.workerStatusId,
        status: input.status,
        code: input.code,
        session_ready: input.session_ready,
        can_send: input.can_send,
        can_receive_runtime: input.can_receive_runtime,
        authenticated: input.authenticated,
        provider_state: input.provider_state,
        degraded_reason: input.degraded_reason,
        phone: input.phone,
        previous_phone: previous.number,
        next_phone: channel.number ?? null,
        previous_connection_date: previous.connectionDate,
        next_connection_date: channel.connection_date ?? null,
        disconnected_user: input.disconnected_user,
        connection_attempt_id: input.connection_attempt_id,
        runtime_generation: input.runtime_generation,
      });

      return true;
    },
  },
});
