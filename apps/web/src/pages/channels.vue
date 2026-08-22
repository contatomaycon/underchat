<script setup lang="ts">
import { ref, watch, computed, nextTick, shallowRef, onUnmounted } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EColor } from '@core/common/enums/EColor';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { EWorkerPermissions } from '@core/common/enums/EPermissions/worker';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { useDashboardStore } from '@/@webcore/stores/dashboard';
import {
  canonicalSnapshotIncludesPublication,
  useChannelStatusPresentationStore,
  workerChannelStatusPresentationSnapshot,
} from '@/@webcore/stores/channelStatusPresentation';
import { resolveChannelStatusPresentation } from '@/@webcore/utils/channelStatusPresentation';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { getUser } from '@/@webcore/localStorage/user';
import { DataTableHeader } from 'vuetify';
import { ListWorkerResponse } from '@core/schema/worker/listWorker/response.schema';
import type { ViewWorkerResponse } from '@core/schema/worker/viewWorker/response.schema';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import { fetchRecentHistoryAndProcess } from '@/@webcore/centrifugo';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import type { IWhatsappProviderHandoffRecoveryCentrifugo } from '@core/common/interfaces/IWhatsappProviderHandoffRecoveryCentrifugo';
import {
  workerCentrifugoQueue,
  workerProviderHandoffRecoveryCentrifugoQueue,
} from '@core/common/functions/centrifugoQueue';
import { ICreateWorkerResponse } from '@core/common/interfaces/ICreateWorkerResponse';
import { ConnectWhatsappEmbeddedResponse } from '@core/schema/worker/connectWhatsappEmbedded/response.schema';
import { WhatsappOfficialHealthResponse } from '@core/schema/worker/whatsappOfficialHealth/response.schema';
import ChannelOfficialHealthDialog from '@/components/channel/ChannelOfficialHealthDialog.vue';
import ChannelProviderHandoffRecoveryDialog from '@/components/channel/ChannelProviderHandoffRecoveryDialog.vue';
import { useChannelRecreateCooldown } from '@/composables/useChannelRecreateCooldown';
import {
  isSilentWhatsappEmbeddedSignupError,
  useWhatsappEmbeddedSignup,
} from '@/composables/useWhatsappEmbeddedSignup';
import {
  createConnectionLifecycleDebugTraceId,
  isConnectionLifecycleDebugEnabled,
  logConnectionLifecycleDebug,
} from '@/@webcore/utils/connectionLifecycleDebug';
import { logLocalConnectionStatus } from '@/@webcore/utils/localConnectionStatusLog';
import { isWhatsappConnectionOnline } from '@core/common/functions/whatsappConnectionStatus';
import { useResilientCentrifugoSubscription } from '@/composables/useResilientCentrifugoSubscription';
import {
  isWhatsappProviderHandoffTargetOnline,
  useWhatsappProviderHandoffRecovery,
  whatsappProviderToWorkerType,
  workerTypeToWhatsappProvider,
  type WhatsappProviderHandoffMonitorContext,
} from '@/composables/useWhatsappProviderHandoffRecovery';
import { useWhatsappProviderHandoffSourceRecovery } from '@/composables/useWhatsappProviderHandoffSourceRecovery';
import type {
  WhatsappProviderHandoffProvider,
  WhatsappProviderHandoffRecoveryMarker,
} from '@/@webcore/interfaces/IWhatsappProviderHandoff';
import {
  isManagerWorkerRecreateCompletedStatusEvent,
  isManagerWorkerRecreatingStatusEvent,
} from '@core/common/functions/workerLifecycleRealtimeStatus';
import type { DisconnectWorkerConnectionResponse } from '@core/schema/worker/disconnectWorkerConnection/response.schema';
import { EWorkerConnectionStrategy } from '@core/common/enums/EWorkerConnectionStrategy';
import { canViewConnectionHealth } from '@/utils/connectionHealthPresentation';

interface ProviderHandoffResumeCandidate {
  workerId: string;
  marker: WhatsappProviderHandoffRecoveryMarker;
  channel: ListWorkerResponse;
}

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EWorkerPermissions.worker_group,
      EWorkerPermissions.create_worker,
      EWorkerPermissions.update_worker,
      EWorkerPermissions.view_worker,
      EWorkerPermissions.delete_worker,
    ],
  },
});

const permissionsEdit = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EWorkerPermissions.worker_group,
  EWorkerPermissions.update_worker,
];
const permissionsDelete = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EWorkerPermissions.worker_group,
  EWorkerPermissions.delete_worker,
];
const permissionsCreate = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EWorkerPermissions.worker_group,
  EWorkerPermissions.create_worker,
];
const permissionsViewLogs = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EWorkerPermissions.worker_group,
  EWorkerPermissions.view_worker_logs,
];
const permissionsRecreate = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EWorkerPermissions.worker_group,
  EWorkerPermissions.recreate_worker,
];
const permissionsProfileStatus = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EWorkerPermissions.worker_group,
  EWorkerPermissions.profile_status_worker,
];
const permissionsManageOfficialTemplates = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EWorkerPermissions.worker_group,
  EWorkerPermissions.view_worker,
];

const { t } = useI18n();
const channelsStore = useChannelsStore();
const dashboardStore = useDashboardStore();
const channelStatusPresentationStore = useChannelStatusPresentationStore();
useSnackbarCleanup(channelsStore);
const user = getUser();
const { isRecreateCooldownActive, formatRecreateCooldownRemaining } =
  useChannelRecreateCooldown();
const { isLoading: isWhatsappOfficialSignupLoading, startSignup } =
  useWhatsappEmbeddedSignup();

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
]);

const itemsStatus = ref([
  { id: '', text: t('all') },
  { id: EWorkerStatus.disponible, text: t('awaiting_qr_code') },
  { id: EWorkerStatus.offline, text: t('offline') },
  { id: EWorkerStatus.online, text: t('channel_connected') },
  { id: EWorkerStatus.connecting, text: t('connecting') },
  { id: EWorkerStatus.new, text: t('new') },
  { id: EWorkerStatus.creating, text: t('creating') },
  { id: EWorkerStatus.recreating, text: t('recreating') },
  { id: EWorkerStatus.deleting, text: t('deleting') },
  { id: EWorkerStatus.delete, text: t('deletion_pending') },
  { id: EWorkerStatus.error, text: t('error') },
  { id: EWorkerStatus.mismatched, text: t('mismatched') },
  { id: EWorkerStatus.stopped, text: t('stopped') },
  { id: EWorkerStatus.blocked, text: t('blocked_by_plan') },
]);

const itemsType = ref([
  { id: '', text: t('all') },
  { id: EWorkerType.baileys, text: t('unofficial_socket') },
  { id: EWorkerType.wwebjs, text: t('unofficial_browser') },
  { id: EWorkerType.whatsmeow, text: t('unofficial_whatsmeow') },
  { id: EWorkerType.whatsapp, text: t('official') },
]);

const isDialogDeleterShow = ref(false);
const channelToDelete = ref<string | null>(null);
const openConversationsCount = ref<number | null>(null);
const channelPlanBlockAction = ref<{
  channelId: string;
  action: 'block' | 'unblock';
} | null>(null);

const isDialogDisconnectOfficialShow = ref(false);
const channelToDisconnectOfficial = ref<string | null>(null);
const reconnectingWhatsappOfficialId = ref<string | null>(null);
const ensuringWhatsappOfficialWebhookSubscriptionId = ref<string | null>(null);
type DisconnectOfficialProgressResult = 'success' | 'warning' | null;
type DisconnectOfficialProgressStepStatus =
  'pending' | 'running' | 'done' | 'warning';
type DisconnectOfficialProgressStep = {
  key: string;
  text: string;
  status: DisconnectOfficialProgressStepStatus;
};
const isDisconnectOfficialProgressShow = ref(false);
const isDisconnectOfficialRunning = ref(false);
const disconnectOfficialProgressResult =
  ref<DisconnectOfficialProgressResult>(null);
const disconnectOfficialProgressWarning = ref<string | null>(null);

const isDialogRecreatorShow = ref(false);
const channelToRecreate = ref<string | null>(null);

watch(isDialogRecreatorShow, (isOpen) => {
  if (!isOpen) {
    channelToRecreate.value = null;
  }
});

const isDialogEditChannelShow = ref(false);
const isAddChannelVisible = ref(false);
const channelToEdit = ref<string | null>(null);

const channelConnectionChannel = ref<string | null>(null);
const channelConnectionType = ref<string | null>(null);
const channelConnectionSourceType = ref<string | null>(null);
const channelConnectionSourceServerName = shallowRef<string | null>(null);
const channelConnectionTargetServerName = shallowRef<string | null>(null);
const channelConnectionStatus = ref<string | null>(null);
const channelConnectionPhone = ref<string | null>(null);
const channelConnectionDebugTraceId = ref<string | null>(null);
const channelConnectionIsInitialCreation = ref(false);
const channelConnectionIsSessionMigration = ref(false);
const channelConnectionIsDestructiveReset = ref(false);
const channelConnectionLifecycleOperationId = ref<string | null>(null);
const channelConnectionReconciledStatus = ref<string | null>(null);
const isDialogConnectionChannelShow = ref(false);
const channelConnectionDialogKey = ref(0);
const isSessionRemovedDialogShow = ref(false);
const sessionRemovedChannel = shallowRef<{
  id: string;
  name: string;
  type: string | null;
} | null>(null);
const workerStatusOffsets = new Map<string, number>();
const initialCreationLifecycleByWorkerId = new Map<string, string>();
const INITIAL_CREATION_RECONCILIATION_DELAYS_MS = [
  0, 500, 1_000, 1_500, 2_000, 3_000, 4_000, 5_000, 7_000, 8_000,
] as const;

const currentConnectionChannel = computed(() => {
  if (!channelConnectionChannel.value) {
    return null;
  }

  return (
    channelsStore.list.find(
      (channel) => channel.id === channelConnectionChannel.value
    ) ?? null
  );
});

const currentConnectionChannelType = computed(
  () =>
    (channelConnectionIsSessionMigration.value
      ? (channelConnectionType.value ??
        currentConnectionChannel.value?.type?.id)
      : (currentConnectionChannel.value?.type?.id ??
        channelConnectionType.value)) ?? null
);

const currentConnectionChannelStatus = computed(() => {
  if (
    channelConnectionIsInitialCreation.value &&
    channelConnectionStatus.value === EWorkerStatus.creating
  ) {
    return EWorkerStatus.creating;
  }

  return (
    (channelConnectionChannel.value
      ? channelStatusPresentationStore.snapshot(channelConnectionChannel.value)
          ?.workerStatusId
      : null) ??
    channelConnectionReconciledStatus.value ??
    currentConnectionChannel.value?.status?.id ??
    channelConnectionStatus.value ??
    null
  );
});

const currentConnectionChannelPhone = computed(
  () => currentConnectionChannel.value?.number ?? channelConnectionPhone.value
);

const channelConnectionLogs = ref<string | null>(null);
const isDialogConnectionLogsShow = ref(false);

const channelConfig = ref<string | null>(null);
const isDialogConfigChannelShow = ref(false);
const isOfficialHealthDialogOpen = ref(false);
const officialHealthChannel = ref<ListWorkerResponse | null>(null);
const officialHealthData = ref<WhatsappOfficialHealthResponse | null>(null);
const isOfficialHealthLoading = ref(false);

const resolveTypeVariant = (s: string | undefined | null) => {
  if (s === EWorkerType.baileys)
    return { color: EColor.info, text: t('unofficial_socket') };
  if (s === EWorkerType.wwebjs)
    return { color: EColor.info, text: t('unofficial_browser') };
  if (s === EWorkerType.whatsmeow)
    return { color: EColor.info, text: t('unofficial_whatsmeow') };
  if (s === EWorkerType.whatsapp)
    return { color: EColor.success, text: t('official') };

  return { color: EColor.error, text: t('unknown') };
};

const resolveChannelStatusVariant = (channel: ListWorkerResponse) => {
  const snapshot =
    channelStatusPresentationStore.snapshot(channel.id) ??
    workerChannelStatusPresentationSnapshot(channel);

  return resolveChannelStatusPresentation(snapshot, t);
};

const isChannelBlockedByPlan = (channel: ListWorkerResponse): boolean =>
  channel.status?.id === EWorkerStatus.blocked;

const isDialogChannelPlanBlockShow = computed({
  get: () => channelPlanBlockAction.value !== null,
  set: (value: boolean) => {
    if (!value) {
      channelPlanBlockAction.value = null;
    }
  },
});

const channelPlanBlockDialogTitle = computed(() => {
  const action = channelPlanBlockAction.value?.action ?? 'block';

  return `${t(action)} ${t('channel')}`;
});

const channelPlanBlockDialogMessage = computed(() => {
  const action = channelPlanBlockAction.value?.action ?? 'block';

  return t(
    action === 'block'
      ? 'block_channel_confirmation'
      : 'unblock_channel_confirmation'
  );
});

const headers: DataTableHeader<ListWorkerResponse>[] = [
  { title: t('name'), key: 'name' },
  { title: t('number'), key: 'number' },
  { title: t('status'), key: 'status' },
  { title: t('type'), key: 'type' },
  { title: t('connection_date'), key: 'connection_date' },
  { title: t('verification_date'), key: 'last_connection_check_at' },
  { title: t('updated_date'), key: 'updated_at' },
  { title: t('created_at'), key: 'created_at' },
  { title: t('actions'), key: 'actions', sortable: false },
];

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
  status: null as string | null,
  type: null as string | null,
  search: null as string | null,
});

const debouncedSearch = refDebounced(
  computed(() => options.value.search),
  500
);

const query = computed(() => ({
  page: options.value.page,
  per_page: options.value.itemsPerPage,
  sort_by: options.value.sortBy,
  status: options.value.status,
  type: options.value.type,
  search: debouncedSearch.value,
}));

const providerHandoffDialogKey = (
  workerId: string,
  handoffId: string,
  lifecycleOperationId: string
) => `${workerId}:${handoffId}:${lifecycleOperationId}`;
const completedSourceReturnDialogKeys = ref<Set<string>>(new Set());
const markSourceReturnDialogCompleted = (
  context: WhatsappProviderHandoffMonitorContext,
  handoffId: string
) => {
  completedSourceReturnDialogKeys.value = new Set([
    ...completedSourceReturnDialogKeys.value,
    providerHandoffDialogKey(
      context.workerId,
      handoffId,
      context.lifecycleOperationId
    ),
  ]);
};

const providerHandoffSourceRecovery =
  useWhatsappProviderHandoffSourceRecovery();

const providerHandoffRecovery = useWhatsappProviderHandoffRecovery({
  onRecoveryRequired: async (handoff) => {
    isDialogConnectionChannelShow.value = false;
    // Automatic compensation restores the original runtime without writing a
    // successful-recreate tombstone. Keep the unresolved decision dialog, but
    // reconcile the table/banner from the exact durable handoff proof plus an
    // authoritative worker GET so the restored source is presented ONLINE.
    await providerHandoffSourceRecovery.reconcileKnownHandoff(handoff);
  },
  onSourceReturned: async (context, handoff) => {
    await providerHandoffSourceRecovery.reconcileKnownHandoff(handoff);
    markSourceReturnDialogCompleted(context, handoff.handoff_id);
    isDialogConnectionChannelShow.value = false;
    channelConnectionIsInitialCreation.value = false;
    channelConnectionIsSessionMigration.value = false;
    channelConnectionIsDestructiveReset.value = false;
    await channelsStore.listChannels(query.value);
  },
  onTargetReady: async (
    context: WhatsappProviderHandoffMonitorContext,
    { freshSession, requireLiveTarget = false }
  ) => {
    await channelsStore.listChannels(query.value);
    const currentChannel =
      channelsStore.list.find((channel) => channel.id === context.workerId) ??
      (await channelsStore.getWorkerById(context.workerId));

    const targetProvider = workerTypeToWhatsappProvider(
      currentChannel?.type?.id
    );
    const retainedTargetReady = isWhatsappProviderHandoffTargetOnline(
      currentChannel,
      context.targetProvider
    );
    const freshTargetReady =
      currentChannel?.status?.id === EWorkerStatus.disponible &&
      !currentChannel.number &&
      currentChannel.connection_online_acknowledged !== true &&
      !isWhatsappConnectionOnline(
        currentChannel.connection_status ?? undefined
      );
    const targetReady =
      targetProvider === context.targetProvider &&
      (freshSession ? freshTargetReady : retainedTargetReady);
    if (!targetReady) {
      logConnectionLifecycleDebug('web.provider_handoff.target_not_ready', {
        trace_id: context.debugTraceId,
        layer: 'web',
        worker_id: context.workerId,
        worker_type_id: currentChannel?.type?.id,
        lifecycle_operation_id: context.lifecycleOperationId,
        status: currentChannel?.status?.id,
        reason:
          targetProvider !== context.targetProvider
            ? 'target_provider_not_active'
            : freshSession
              ? 'fresh_target_not_available'
              : requireLiveTarget
                ? 'target_connection_not_acknowledged'
                : 'target_completion_waiting_online_projection',
      });
      return false;
    }

    channelConnectionChannel.value = context.workerId;
    channelConnectionType.value = context.targetWorkerType;
    channelConnectionStatus.value =
      currentChannel?.status?.id ?? EWorkerStatus.creating;
    channelConnectionPhone.value = currentChannel?.number ?? null;
    channelConnectionDebugTraceId.value = context.debugTraceId ?? null;
    channelConnectionIsInitialCreation.value = false;
    channelConnectionIsSessionMigration.value = false;
    channelConnectionIsDestructiveReset.value = false;

    if (freshSession) {
      // Force a new AppConnectChannel instance so its initial state is the
      // existing method chooser instead of any state retained by the failed
      // target runtime.
      isDialogConnectionChannelShow.value = false;
      await nextTick();
      isDialogConnectionChannelShow.value = true;
    } else {
      // `retainedTargetReady` proves that the exact target is ONLINE before
      // this flag is released. AppConnectChannel also keeps an internal
      // transition fence so Vue/realtime watcher order can never expose the
      // ordinary method chooser or recreate surface between these screens.
      isDialogConnectionChannelShow.value = true;
    }

    return true;
  },
});

const shouldReconcileConnectionMigration = () =>
  Boolean(
    isDialogConnectionChannelShow.value &&
    channelConnectionChannel.value &&
    channelConnectionLifecycleOperationId.value &&
    (channelConnectionIsSessionMigration.value ||
      channelConnectionIsDestructiveReset.value) &&
    currentConnectionChannelStatus.value === EWorkerStatus.recreating &&
    !providerHandoffRecovery.handoff.value
  );

const reconcileConnectionMigrationTerminalState = async () => {
  const workerId = channelConnectionChannel.value;
  const lifecycleOperationId = channelConnectionLifecycleOperationId.value;
  if (
    !workerId ||
    !lifecycleOperationId ||
    !shouldReconcileConnectionMigration()
  ) {
    return;
  }

  const current = await channelsStore.getWorkerById(workerId);
  if (
    workerId !== channelConnectionChannel.value ||
    lifecycleOperationId !== channelConnectionLifecycleOperationId.value ||
    !shouldReconcileConnectionMigration() ||
    !current ||
    current.status?.id !== EWorkerStatus.error ||
    (current.lifecycle_operation_id !== null &&
      current.lifecycle_operation_id !== undefined)
  ) {
    return;
  }

  // The terminal CAS clears the lifecycle id. Do not let the list-store's
  // in-flight recreate fence keep the modal visually locked on `recreating`.
  // A provider handoff, when present, still owns its richer recovery dialog.
  channelConnectionReconciledStatus.value = EWorkerStatus.error;
  channelConnectionStatus.value = EWorkerStatus.error;
  if (!providerHandoffRecovery.activeContext.value) {
    channelConnectionIsSessionMigration.value = false;
  }
};

const requestMigrationDecision = async (reason: 'cancel' | 'timeout') => {
  const requested = await providerHandoffRecovery.requestDecision(reason);
  if (requested || providerHandoffRecovery.activeContext.value) {
    return;
  }

  // Same-provider/server recreates do not own a provider handoff journal.
  // Reconcile their terminal status and keep the operation screen visible
  // while the server reaches a safe lifecycle boundary.
  await reconcileConnectionMigrationTerminalState();
  channelsStore.showSnackbar(
    t(
      reason === 'timeout'
        ? 'connection_migration_timeout_reconciling'
        : 'connection_migration_cancel_reconciling'
    ),
    EColor.info
  );
};

const isWhatsappProviderHandoffProvider = (
  value: unknown
): value is WhatsappProviderHandoffProvider =>
  value === 'baileys' || value === 'whatsmeow' || value === 'wwebjs';

const isWhatsappProviderHandoffRecoveryTerminalState = (
  value: unknown
): value is IWhatsappProviderHandoffRecoveryCentrifugo['recovery_state'] =>
  value === 'completed' || value === 'blocked' || value === 'cancelled';

const isWhatsappProviderHandoffRecoveryPublication = (
  value: unknown
): value is IWhatsappProviderHandoffRecoveryCentrifugo => {
  if (!value || typeof value !== 'object') return false;
  const publication = value as Record<string, unknown>;
  return (
    publication.event_type === 'whatsapp_provider_handoff_recovery_terminal' &&
    typeof publication.account_id === 'string' &&
    typeof publication.worker_id === 'string' &&
    typeof publication.handoff_id === 'string' &&
    typeof publication.handoff_lifecycle_operation_id === 'string' &&
    typeof publication.recovery_operation_id === 'string' &&
    isWhatsappProviderHandoffRecoveryTerminalState(
      publication.recovery_state
    ) &&
    isWhatsappProviderHandoffProvider(publication.source_provider) &&
    isWhatsappProviderHandoffProvider(publication.target_provider)
  );
};

const providerHandoffResumeCandidate =
  computed<ProviderHandoffResumeCandidate | null>(() => {
    const active = providerHandoffRecovery.activeContext.value;
    for (const channel of channelsStore.list) {
      const marker = channel.provider_handoff_recovery;
      if (
        !marker?.handoff_id ||
        !marker.lifecycle_operation_id ||
        !isWhatsappProviderHandoffProvider(marker.source_provider) ||
        !isWhatsappProviderHandoffProvider(marker.target_provider) ||
        marker.source_provider === marker.target_provider
      ) {
        continue;
      }

      const dialogKey = providerHandoffDialogKey(
        channel.id,
        marker.handoff_id,
        marker.lifecycle_operation_id
      );
      if (completedSourceReturnDialogKeys.value.has(dialogKey)) continue;
      if (
        !active &&
        isWhatsappProviderHandoffTargetOnline(channel, marker.target_provider)
      ) {
        continue;
      }

      return {
        workerId: channel.id,
        marker,
        channel,
      };
    }

    return null;
  });

watch(
  [providerHandoffResumeCandidate, providerHandoffRecovery.activeContext],
  ([candidate, active]) => {
    if (!candidate) return;

    // `provider_handoff_recovery` is intentionally durable enough for
    // recovery/audit. It can therefore outlive the handoff that produced it.
    // Do not issue a `latest` lookup or reopen a failure dialog after F5 when
    // the list itself already proves this exact target is connected.
    if (
      !active &&
      isWhatsappProviderHandoffTargetOnline(
        candidate.channel,
        candidate.marker.target_provider
      )
    ) {
      return;
    }

    const isAlreadyMonitoring =
      active?.workerId === candidate.workerId &&
      active.lifecycleOperationId === candidate.marker.lifecycle_operation_id &&
      active.sourceProvider === candidate.marker.source_provider &&
      active.targetProvider === candidate.marker.target_provider &&
      (!active.handoffId || active.handoffId === candidate.marker.handoff_id);

    // A locally initiated switch owns its lifecycle until it finishes. A list
    // marker may arrive for the same operation, but must never replace it or a
    // different user-initiated operation with stale HTTP state.
    if (isAlreadyMonitoring || active) return;

    providerHandoffRecovery.start({
      workerId: candidate.workerId,
      handoffId: candidate.marker.handoff_id,
      lifecycleOperationId: candidate.marker.lifecycle_operation_id,
      sourceProvider: candidate.marker.source_provider,
      targetProvider: candidate.marker.target_provider,
      targetWorkerType: whatsappProviderToWorkerType(
        candidate.marker.target_provider
      ),
      debugTraceId: isConnectionLifecycleDebugEnabled()
        ? createConnectionLifecycleDebugTraceId('web_handoff_resume')
        : undefined,
      origin: 'resumed',
    });
  },
  { immediate: true }
);

const providerHandoffTerminalStatuses = new Set<string>([
  EWorkerStatus.error,
  EWorkerStatus.online,
  EWorkerStatus.disponible,
]);

const refreshProviderHandoffFromLifecyclePublication = (
  data: IBaileysConnectionState
) => {
  const active = providerHandoffRecovery.activeContext.value;
  if (!active || active.workerId !== data.worker_id) return;

  const belongsToActiveOperation =
    data.lifecycle_operation_id === active.lifecycleOperationId;
  const reachedTerminalState = data.worker_status_id
    ? providerHandoffTerminalStatuses.has(data.worker_status_id)
    : false;
  if (!belongsToActiveOperation && !reachedTerminalState) return;

  // An error can be published just before the durable recovery snapshot is
  // visible. Only successful terminal states may conclusively retire an empty
  // monitor; an error remains passively observable for the next publication.
  const canTreatAbsentHandoffAsTerminal =
    data.worker_status_id === EWorkerStatus.online ||
    data.worker_status_id === EWorkerStatus.disponible;
  const targetReady =
    data.worker_status_id === EWorkerStatus.online &&
    workerTypeToWhatsappProvider(data.worker_type_id) ===
      active.targetProvider &&
    data.connection_online_acknowledged === true &&
    isWhatsappConnectionOnline(data.connection_status);

  // One authoritative lookup per relevant Centrifugo publication gives the
  // dialog its durable capabilities without keeping a background poll alive.
  void providerHandoffRecovery.refresh({
    terminal: canTreatAbsentHandoffAsTerminal,
    targetReady,
    // A terminal publication is authoritative and can race the initial
    // handoff lookup. Coalesce one replay behind that lookup so the progress
    // dialog cannot wait for its five-minute safety timeout after the target
    // is already online. This is event-driven and never installs a poll.
    replayIfInFlight: reachedTerminalState,
  });
};

const refreshProviderHandoffFromTargetProjection = (
  channels: typeof channelsStore.list
) => {
  const active = providerHandoffRecovery.activeContext.value;
  if (!active) return;

  const currentChannel = channels.find(
    (channel) => channel.id === active.workerId
  );
  if (
    !isWhatsappProviderHandoffTargetOnline(
      currentChannel,
      active.targetProvider
    )
  ) {
    return;
  }

  // A lifecycle terminal can be published just before the native ONLINE ACK.
  // The refreshed list is another authoritative projection of the exact
  // target and closes that delivery-order gap without a background poll.
  void providerHandoffRecovery.refresh({
    terminal: true,
    targetReady: true,
    replayIfInFlight: true,
  });
};

const providerHandoffRecoveryPublicationHandler = (data: unknown) => {
  const accountId = user?.account_id;
  if (
    !accountId ||
    !isWhatsappProviderHandoffRecoveryPublication(data) ||
    data.account_id !== accountId ||
    data.source_provider === data.target_provider ||
    data.recovery_operation_id === data.handoff_lifecycle_operation_id
  ) {
    return;
  }

  logConnectionLifecycleDebug(
    'web.provider_handoff.recovery_terminal_received',
    {
      layer: 'web',
      account_id: data.account_id,
      worker_id: data.worker_id,
      handoff_id: data.handoff_id,
      lifecycle_operation_id: data.handoff_lifecycle_operation_id,
      recovery_operation_id: data.recovery_operation_id,
      recovery_state: data.recovery_state,
      source_provider: data.source_provider,
      target_provider: data.target_provider,
    }
  );

  const active = providerHandoffRecovery.activeContext.value;
  const belongsToActiveMonitor = Boolean(
    active &&
    active.workerId === data.worker_id &&
    (!active.handoffId || active.handoffId === data.handoff_id) &&
    active.lifecycleOperationId === data.handoff_lifecycle_operation_id &&
    active.sourceProvider === data.source_provider &&
    active.targetProvider === data.target_provider
  );

  // The passive reconciler owns every visible worker independently. The
  // active dialog also consumes the same durable wakeup, but keeps its own
  // exact monitor fences and queues one replay if an older snapshot is still
  // in flight. Neither path creates a timer or periodic HTTP request.
  void providerHandoffSourceRecovery.refreshFromRecoveryPublication(
    data,
    accountId
  );
  if (belongsToActiveMonitor) {
    void providerHandoffRecovery.refresh({ replayIfInFlight: true });
  }
};

const handleTableChange = (o: {
  page: number;
  itemsPerPage: number;
  sortBy: SortRequest[];
}) => {
  options.value.page = o.page;
  options.value.itemsPerPage = o.itemsPerPage;
  options.value.sortBy = o.sortBy;
};

const deleteChannel = async (id: string) => {
  const count = await channelsStore.checkChannelOpenConversations(id);

  if (count !== null && count > 0) {
    openConversationsCount.value = count;
    channelToDelete.value = id;
    isDialogDeleterShow.value = true;
    return;
  }

  openConversationsCount.value = null;
  channelToDelete.value = id;
  isDialogDeleterShow.value = true;
};

const disconnectWhatsappOfficial = (id: string) => {
  channelToDisconnectOfficial.value = id;
  isDialogDisconnectOfficialShow.value = true;
};

const recreateChannelTooltip = (channel: ListWorkerResponse) => {
  if (!isRecreateCooldownActive(channel)) {
    return t('recreate_channel');
  }

  return t('recreate_channel_available_in', {
    time: formatRecreateCooldownRemaining(channel),
  });
};

const recreateChannel = async (channel: ListWorkerResponse) => {
  if (isChannelBlockedByPlan(channel) || isRecreateCooldownActive(channel)) {
    return;
  }

  channelToRecreate.value = channel.id;
  isDialogRecreatorShow.value = true;
};

const openEditDialog = (id: string) => {
  channelToEdit.value = id;
  isDialogEditChannelShow.value = true;
};

const openConnectionDialog = (channel: ListWorkerResponse) => {
  if (
    channel.type?.id === EWorkerType.whatsapp ||
    isChannelBlockedByPlan(channel)
  ) {
    return;
  }

  const debugTraceId = isConnectionLifecycleDebugEnabled()
    ? createConnectionLifecycleDebugTraceId('web_connection_dialog')
    : undefined;
  channelConnectionChannel.value = channel.id;
  channelConnectionType.value = channel.type?.id ?? null;
  channelConnectionSourceType.value = null;
  channelConnectionStatus.value = channel.status?.id ?? null;
  channelConnectionPhone.value = channel.number ?? null;
  channelConnectionDebugTraceId.value = debugTraceId ?? null;
  channelConnectionIsInitialCreation.value = false;
  channelConnectionIsSessionMigration.value = false;
  channelConnectionIsDestructiveReset.value = false;
  channelConnectionLifecycleOperationId.value = null;
  channelConnectionReconciledStatus.value = null;
  channelConnectionDialogKey.value += 1;
  logConnectionLifecycleDebug('web.connection_dialog.open', {
    trace_id: debugTraceId,
    layer: 'web',
    worker_id: channel.id,
    worker_type_id: channel.type?.id,
    status: channel.status?.id,
  });
  isDialogConnectionChannelShow.value = true;
};

const handleConnectionStarted = (workerId: string): void => {
  channelsStore.releaseSessionRemovalFence(workerId);
  channelStatusPresentationStore.releaseSessionRemovalFence(workerId);
};

const handleSessionRemoved = async (
  result: DisconnectWorkerConnectionResponse
): Promise<void> => {
  const channel = channelsStore.list.find(
    (item) => item.id === result.worker_id
  );
  if (channel && !channelStatusPresentationStore.snapshot(result.worker_id)) {
    channelStatusPresentationStore.hydrateWorkerChannel(channel);
  }
  channelStatusPresentationStore.applySessionRemovalTerminal(result);

  dashboardStore.applyDashboardChannelEffectiveStatus(
    result.worker_id,
    EWorkerStatus.disponible
  );
  dashboardStore.applyOfflineChannelStatusEvent({
    channelId: result.worker_id,
    channelName: channel?.name,
    workerTypeId: channel?.type?.id ?? null,
    statusId: EWorkerStatus.disponible,
    statusName: t('awaiting_qr_code'),
    workerStatusObservedAt: result.worker_status_observed_at,
    connectionStatus: null,
    connectionStatusSourceId: null,
    connectionStatusSequence: null,
    connectionStatusChangedAt: null,
    connectionStatusOrder: null,
    connectionOnlineAcknowledged: false,
    runtimeGeneration: result.runtime_generation,
  });

  sessionRemovedChannel.value = {
    id: result.worker_id,
    name: channel?.name ?? '',
    type: channel?.type?.id ?? currentConnectionChannelType.value,
  };
  isDialogConnectionChannelShow.value = false;
  await nextTick();
  isSessionRemovedDialogShow.value = true;
};

const reconnectRemovedSession = async (): Promise<void> => {
  const channel = sessionRemovedChannel.value;
  if (!channel) return;

  isSessionRemovedDialogShow.value = false;
  channelConnectionChannel.value = channel.id;
  channelConnectionType.value = channel.type;
  channelConnectionSourceType.value = null;
  channelConnectionStatus.value = EWorkerStatus.disponible;
  channelConnectionPhone.value = null;
  channelConnectionDebugTraceId.value = isConnectionLifecycleDebugEnabled()
    ? createConnectionLifecycleDebugTraceId('web_reconnect_removed_session')
    : null;
  channelConnectionIsInitialCreation.value = false;
  channelConnectionIsSessionMigration.value = false;
  channelConnectionIsDestructiveReset.value = false;
  channelConnectionLifecycleOperationId.value = null;
  channelConnectionReconciledStatus.value = EWorkerStatus.disponible;
  channelConnectionDialogKey.value += 1;
  await nextTick();
  isDialogConnectionChannelShow.value = true;
};

const openConnectionLogDialog = (id: string) => {
  channelConnectionLogs.value = id;
  isDialogConnectionLogsShow.value = true;
};

const openConfigDialog = (id: string) => {
  channelConfig.value = id;
  isDialogConfigChannelShow.value = true;
};

const loadWhatsappOfficialHealth = async (
  channel: ListWorkerResponse | null = officialHealthChannel.value
) => {
  if (!channel || isOfficialHealthLoading.value) {
    return;
  }

  isOfficialHealthLoading.value = true;

  try {
    const result = await channelsStore.viewWhatsappOfficialHealth(channel.id);

    if (result) {
      officialHealthData.value = result;
    }
  } finally {
    isOfficialHealthLoading.value = false;
  }
};

const openWhatsappOfficialHealth = async (channel: ListWorkerResponse) => {
  officialHealthChannel.value = channel;
  officialHealthData.value = null;
  isOfficialHealthDialogOpen.value = true;

  await loadWhatsappOfficialHealth(channel);
};

const refreshWhatsappOfficialHealth = () => {
  void loadWhatsappOfficialHealth();
};

const isWhatsappOfficialChannel = (channel: ListWorkerResponse) =>
  channel.type?.id === EWorkerType.whatsapp;

const isWhatsappOfficialOnline = (channel: ListWorkerResponse) =>
  isWhatsappOfficialChannel(channel) &&
  channel.status?.id === EWorkerStatus.online;

const isWhatsappOfficialReconnectable = (channel: ListWorkerResponse) =>
  isWhatsappOfficialChannel(channel) &&
  !isChannelBlockedByPlan(channel) &&
  channel.status?.id !== EWorkerStatus.online;

const isWhatsappOfficialWebhookRepairable = (channel: ListWorkerResponse) =>
  isWhatsappOfficialChannel(channel) &&
  !isChannelBlockedByPlan(channel) &&
  (channel.status?.id === EWorkerStatus.online || Boolean(channel.number));

const canViewConnectionLogs = (channel: ListWorkerResponse) =>
  canViewConnectionHealth(channel);

const disconnectOfficialProgressSteps = computed<
  DisconnectOfficialProgressStep[]
>(() => {
  const isFinished = disconnectOfficialProgressResult.value !== null;

  const steps: DisconnectOfficialProgressStep[] = [
    {
      key: 'underchat',
      text: t('whatsapp_official_disconnect_progress_underchat'),
      status: isDisconnectOfficialRunning.value
        ? 'running'
        : isFinished
          ? 'done'
          : 'pending',
    },
  ];

  if (disconnectOfficialProgressResult.value === 'warning') {
    steps.push({
      key: 'meta',
      text: t('whatsapp_official_disconnect_progress_meta'),
      status: 'warning',
    });
  }

  return steps;
});

const resetDisconnectOfficialProgress = () => {
  isDisconnectOfficialProgressShow.value = false;
  isDisconnectOfficialRunning.value = false;
  disconnectOfficialProgressResult.value = null;
  disconnectOfficialProgressWarning.value = null;
};

const closeDisconnectOfficialProgress = () => {
  if (isDisconnectOfficialRunning.value) {
    return;
  }

  resetDisconnectOfficialProgress();
};

const connectWhatsappOfficial = async (channel: ListWorkerResponse) => {
  if (
    isWhatsappOfficialSignupLoading.value ||
    reconnectingWhatsappOfficialId.value
  ) {
    return;
  }

  reconnectingWhatsappOfficialId.value = channel.id;

  try {
    const config =
      channelsStore.whatsappEmbeddedConfig ??
      (await channelsStore.getWhatsappEmbeddedConfig());

    if (!config?.is_configured) {
      channelsStore.showSnackbar(
        t('whatsapp_embedded_configure_required'),
        EColor.error
      );
      return;
    }

    const signupResult = await startSignup(config);
    const result = await channelsStore.connectWhatsappOfficial(channel.id, {
      code: signupResult.code,
      business_id: signupResult.business_id,
      waba_id: signupResult.waba_id,
      phone_number_id: signupResult.phone_number_id,
    });

    if (!result) {
      return;
    }

    dashboardStore.removeOfflineChannel(channel.id);
    await channelsStore.listChannels(query.value);
  } catch (error) {
    if (isSilentWhatsappEmbeddedSignupError(error)) {
      return;
    }

    const message =
      error instanceof Error && error.message
        ? t(error.message)
        : t('whatsapp_embedded_signup_error');

    channelsStore.showSnackbar(message, EColor.error);
  } finally {
    reconnectingWhatsappOfficialId.value = null;
  }
};

const ensureWhatsappOfficialWebhookSubscription = async (
  channel: ListWorkerResponse
) => {
  if (
    ensuringWhatsappOfficialWebhookSubscriptionId.value ||
    isWhatsappOfficialSignupLoading.value
  ) {
    return;
  }

  ensuringWhatsappOfficialWebhookSubscriptionId.value = channel.id;

  try {
    const config =
      channelsStore.whatsappEmbeddedConfig ??
      (await channelsStore.getWhatsappEmbeddedConfig());

    if (!config?.is_configured) {
      channelsStore.showSnackbar(
        t('whatsapp_embedded_configure_required'),
        EColor.error
      );
      return;
    }

    const signupResult = await startSignup(config);
    const result =
      await channelsStore.ensureWhatsappOfficialWebhookSubscription(
        channel.id,
        {
          code: signupResult.code,
          business_id: signupResult.business_id,
          waba_id: signupResult.waba_id,
          phone_number_id: signupResult.phone_number_id,
        }
      );

    if (result) {
      await channelsStore.listChannels(query.value);

      if (
        isOfficialHealthDialogOpen.value &&
        officialHealthChannel.value?.id === channel.id
      ) {
        await loadWhatsappOfficialHealth(channel);
      }
    }
  } catch (error) {
    if (isSilentWhatsappEmbeddedSignupError(error)) {
      return;
    }

    const message =
      error instanceof Error && error.message
        ? t(error.message)
        : t('whatsapp_embedded_signup_error');

    channelsStore.showSnackbar(message, EColor.error);
  } finally {
    ensuringWhatsappOfficialWebhookSubscriptionId.value = null;
  }
};

const repairWhatsappOfficialHealthWebhook = () => {
  if (!officialHealthChannel.value) {
    return;
  }

  void ensureWhatsappOfficialWebhookSubscription(officialHealthChannel.value);
};

const handleDelete = async () => {
  if (!channelToDelete.value) return;

  const channelId = channelToDelete.value;
  const result = await channelsStore.deleteChannel(channelId);
  if (result) {
    dashboardStore.removeOfflineChannel(channelId);
    await channelsStore.listChannels(query.value);
  }

  channelToDelete.value = null;
  openConversationsCount.value = null;
};

const openChannelPlanBlockDialog = (channel: ListWorkerResponse) => {
  channelPlanBlockAction.value = {
    channelId: channel.id,
    action: isChannelBlockedByPlan(channel) ? 'unblock' : 'block',
  };
};

const handleChannelPlanBlock = async () => {
  if (!channelPlanBlockAction.value) {
    return;
  }

  const { channelId, action } = channelPlanBlockAction.value;
  const result =
    action === 'block'
      ? await channelsStore.blockChannel(channelId)
      : await channelsStore.unblockChannel(channelId);

  if (result) {
    await channelsStore.listChannels(query.value);
  }

  channelPlanBlockAction.value = null;
};

const handleDisconnectWhatsappOfficial = async () => {
  if (!channelToDisconnectOfficial.value) return;

  const channelId = channelToDisconnectOfficial.value;
  isDialogDisconnectOfficialShow.value = false;
  isDisconnectOfficialProgressShow.value = true;
  isDisconnectOfficialRunning.value = true;
  disconnectOfficialProgressResult.value = null;
  disconnectOfficialProgressWarning.value = null;

  const result = await channelsStore.disconnectWhatsappOfficial(channelId);

  if (result?.disconnected) {
    const channel = channelsStore.list.find((item) => item.id === channelId);
    dashboardStore.updateOfflineChannelStatus(
      channelId,
      EWorkerStatus.offline,
      t('offline'),
      channel?.name
    );
    await channelsStore.listChannels(query.value);
  }

  disconnectOfficialProgressWarning.value =
    result?.meta_warning ??
    (!result ? t('whatsapp_official_disconnect_error') : null);
  disconnectOfficialProgressResult.value =
    disconnectOfficialProgressWarning.value ? 'warning' : 'success';
  isDisconnectOfficialRunning.value = false;
  channelToDisconnectOfficial.value = null;
};

const handleRecreate = async (strategy: EWorkerConnectionStrategy) => {
  if (!channelToRecreate.value) return;

  const workerId = channelToRecreate.value;

  const debugTraceId = isConnectionLifecycleDebugEnabled()
    ? createConnectionLifecycleDebugTraceId('web_recreate_confirm')
    : undefined;

  const startsFreshConnection = strategy === EWorkerConnectionStrategy.fresh;
  const ack = startsFreshConnection
    ? await channelsStore.resetConnectionChannel(workerId, {
        debugTraceId,
      })
    : await channelsStore.recreateChannel(workerId, {
        debugTraceId,
      });

  const channel = channelsStore.list.find((item) => item.id === workerId);
  if (ack && channel?.type?.id === ack.worker_type_id) {
    // The HTTP acknowledgement is already durable. Project it through the
    // canonical reducer immediately; realtime is an idempotent confirmation.
    channelStatusPresentationStore.applyAcceptedRecreateAck(ack);
    const snapshot = channelStatusPresentationStore.snapshot(workerId);
    if (
      snapshot?.lifecycleOperationId === ack.operation_id &&
      snapshot.workerStatusId === EWorkerStatus.recreating
    ) {
      dashboardStore.applyDashboardChannelEffectiveStatus(
        workerId,
        EWorkerStatus.recreating
      );
      dashboardStore.applyOfflineChannelStatusEvent({
        channelId: workerId,
        channelName: channel?.name,
        workerTypeId: snapshot.workerTypeId,
        statusId: EWorkerStatus.recreating,
        statusName: t('recreating'),
        workerStatusObservedAt: snapshot.workerStatusObservedAt,
        connectionStatus: snapshot.connectionStatus,
        connectionStatusSourceId: snapshot.connectionStatusSourceId,
        connectionStatusOrder: snapshot.connectionStatusOrder,
        connectionOnlineAcknowledged: false,
        runtimeGeneration: snapshot.runtimeGeneration,
      });
      if (channelConnectionChannel.value === workerId) {
        channelConnectionStatus.value = EWorkerStatus.recreating;
      }
    }
  }

  if (ack && startsFreshConnection) {
    await channelsStore.listChannels(query.value);
    const refreshedChannel = channelsStore.list.find(
      (item) => item.id === workerId
    );

    channelConnectionChannel.value = workerId;
    channelConnectionType.value =
      refreshedChannel?.type?.id ?? ack.worker_type_id ?? null;
    channelConnectionSourceType.value = null;
    channelConnectionSourceServerName.value = null;
    channelConnectionTargetServerName.value = null;
    channelConnectionStatus.value = EWorkerStatus.recreating;
    channelConnectionPhone.value = null;
    channelConnectionDebugTraceId.value = ack.debug_trace_id ?? null;
    channelConnectionIsInitialCreation.value = false;
    channelConnectionIsSessionMigration.value = false;
    channelConnectionIsDestructiveReset.value = true;
    channelConnectionLifecycleOperationId.value = ack.operation_id;
    channelConnectionReconciledStatus.value = null;
    channelConnectionDialogKey.value += 1;
    isDialogConnectionChannelShow.value = true;
  }

  isDialogRecreatorShow.value = false;
  channelToRecreate.value = null;
};

const isInitialCreationLifecycleTerminal = (
  worker: ViewWorkerResponse | null,
  operationId: string
): worker is ViewWorkerResponse => {
  const statusId = worker?.status?.id;
  if (
    !worker ||
    !statusId ||
    (worker.lifecycle_operation_id !== null &&
      worker.lifecycle_operation_id !== undefined) ||
    statusId === EWorkerStatus.new ||
    statusId === EWorkerStatus.creating ||
    statusId === EWorkerStatus.recreating
  ) {
    return false;
  }

  return (
    !worker.recreate_completed_operation_id ||
    worker.recreate_completed_operation_id === operationId
  );
};

const waitForInitialCreationReconciliation = (delayMs: number) =>
  new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });

const reconcileInitialCreationLifecycle = async (
  createdWorker: ICreateWorkerResponse
): Promise<void> => {
  const workerId = createdWorker.worker_id;
  const operationId = createdWorker.operation_id;
  initialCreationLifecycleByWorkerId.set(workerId, operationId);

  for (const delayMs of INITIAL_CREATION_RECONCILIATION_DELAYS_MS) {
    if (delayMs > 0) {
      await waitForInitialCreationReconciliation(delayMs);
    }
    if (initialCreationLifecycleByWorkerId.get(workerId) !== operationId) {
      return;
    }

    const worker = await channelsStore.getWorkerById(workerId, {
      silent: true,
    });
    if (!isInitialCreationLifecycleTerminal(worker, operationId)) {
      continue;
    }

    const terminalApplied = channelsStore.applyInitialCreationTerminal(
      worker,
      operationId
    );
    channelStatusPresentationStore.hydrateWorkerChannel(worker);
    if (!terminalApplied) {
      await channelsStore.listChannels(query.value);
    }
    initialCreationLifecycleByWorkerId.delete(workerId);
    if (
      channelConnectionChannel.value === workerId &&
      channelConnectionLifecycleOperationId.value === operationId
    ) {
      const reconciledChannel = channelsStore.list.find(
        (channel) => channel.id === workerId
      );
      const reconciledStatus =
        reconciledChannel?.status?.id ?? worker.status?.id ?? null;
      channelConnectionStatus.value = reconciledStatus;
      channelConnectionReconciledStatus.value = reconciledStatus;
      channelConnectionLifecycleOperationId.value = null;
      channelConnectionIsInitialCreation.value = false;
    }
    return;
  }

  if (initialCreationLifecycleByWorkerId.get(workerId) === operationId) {
    initialCreationLifecycleByWorkerId.delete(workerId);
    await channelsStore.listChannels(query.value);
  }
};

const handleChannelCreated = async (
  data: ICreateWorkerResponse | ConnectWhatsappEmbeddedResponse
) => {
  if (data.worker_type_id === EWorkerType.whatsapp) {
    await channelsStore.listChannels(query.value);
    return;
  }

  const createdWorker = data as ICreateWorkerResponse;
  channelsStore.applyAcceptedCreateAck(createdWorker);
  channelStatusPresentationStore.applyAcceptedCreateAck(createdWorker);
  channelConnectionChannel.value = createdWorker.worker_id;
  channelConnectionType.value = createdWorker.worker_type_id;
  channelConnectionSourceType.value = null;
  channelConnectionStatus.value =
    createdWorker.worker_status_id ?? EWorkerStatus.creating;
  channelConnectionPhone.value = null;
  channelConnectionDebugTraceId.value = createdWorker.debug_trace_id ?? null;
  channelConnectionIsInitialCreation.value = true;
  channelConnectionIsSessionMigration.value = false;
  channelConnectionIsDestructiveReset.value = false;
  channelConnectionLifecycleOperationId.value = createdWorker.operation_id;
  channelConnectionReconciledStatus.value = null;
  channelConnectionDialogKey.value += 1;
  logConnectionLifecycleDebug('web.connection_dialog.open_after_create', {
    trace_id: createdWorker.debug_trace_id,
    layer: 'web',
    worker_id: createdWorker.worker_id,
    account_id: createdWorker.account_id,
    worker_type_id: createdWorker.worker_type_id,
    lifecycle_operation_id: createdWorker.operation_id,
    status: channelConnectionStatus.value ?? undefined,
  });
  isDialogConnectionChannelShow.value = true;
  void reconcileInitialCreationLifecycle(createdWorker);
};

const handleChannelUpdated = async (data: {
  worker_id: string;
  worker_type?: EWorkerType;
  previous_worker_type?: EWorkerType;
  previous_session_storage?: EWorkerSessionStorage;
  previous_server_id?: string;
  previous_server_name?: string;
  server_id?: string;
  server_name?: string;
  account_id?: string;
  lifecycle_operation_id?: string;
  debug_trace_id?: string;
  connection_strategy?: EWorkerConnectionStrategy;
}) => {
  providerHandoffRecovery.stop();

  if (!data.worker_type) {
    await channelsStore.listChannels(query.value);
    return;
  }

  const sourceProvider = workerTypeToWhatsappProvider(
    data.previous_worker_type
  );
  const targetProvider = workerTypeToWhatsappProvider(data.worker_type);
  const providerChanged =
    Boolean(sourceProvider) &&
    Boolean(targetProvider) &&
    sourceProvider !== targetProvider;
  const serverChanged =
    Boolean(data.previous_server_id) &&
    Boolean(data.server_id) &&
    data.previous_server_id !== data.server_id;
  const startsFreshConnection =
    data.connection_strategy === EWorkerConnectionStrategy.fresh;
  const isSessionMigration =
    !startsFreshConnection &&
    data.previous_session_storage === EWorkerSessionStorage.postgres &&
    Boolean(data.lifecycle_operation_id) &&
    (providerChanged || serverChanged);
  const isDestructiveReset =
    startsFreshConnection ||
    (data.previous_session_storage === EWorkerSessionStorage.legacy_volume &&
      (providerChanged || serverChanged));

  channelConnectionChannel.value = data.worker_id;
  channelConnectionType.value = data.worker_type;
  channelConnectionSourceType.value = data.previous_worker_type ?? null;
  channelConnectionSourceServerName.value = data.previous_server_name ?? null;
  channelConnectionTargetServerName.value = data.server_name ?? null;
  channelConnectionStatus.value = EWorkerStatus.recreating;
  channelConnectionPhone.value = null;
  channelConnectionIsInitialCreation.value = false;
  channelConnectionIsSessionMigration.value = isSessionMigration;
  channelConnectionIsDestructiveReset.value = isDestructiveReset;
  channelConnectionLifecycleOperationId.value =
    data.lifecycle_operation_id ?? null;
  channelConnectionReconciledStatus.value = null;
  channelConnectionDebugTraceId.value =
    data.debug_trace_id ??
    (isConnectionLifecycleDebugEnabled()
      ? createConnectionLifecycleDebugTraceId('web_channel_updated')
      : null);
  logConnectionLifecycleDebug('web.connection_dialog.route_after_update', {
    trace_id: channelConnectionDebugTraceId.value ?? undefined,
    layer: 'web',
    worker_id: data.worker_id,
    account_id: data.account_id,
    worker_type_id: data.worker_type,
    lifecycle_operation_id: data.lifecycle_operation_id,
    status: channelConnectionStatus.value ?? undefined,
    dialog_opened: isDestructiveReset || isSessionMigration,
    session_migration: isSessionMigration,
    connection_strategy: data.connection_strategy,
  });
  // A PostgreSQL provider handoff preserves the existing session and is
  // presented immediately by AppConnectChannel's migration-only view. Its
  // pairing/QR/link surface remains fenced by `canOfferNewConnection=false`;
  // those choices belong only to a destructive reset or a later `freshSession`
  // outcome explicitly returned by the protected-handoff monitor.
  isDialogConnectionChannelShow.value =
    isDestructiveReset || isSessionMigration;

  if (
    isSessionMigration &&
    providerChanged &&
    data.lifecycle_operation_id &&
    sourceProvider &&
    targetProvider
  ) {
    providerHandoffRecovery.start({
      workerId: data.worker_id,
      lifecycleOperationId: data.lifecycle_operation_id,
      sourceProvider,
      targetProvider,
      targetWorkerType: data.worker_type,
      debugTraceId: channelConnectionDebugTraceId.value ?? undefined,
      origin: 'initiated',
    });
  }

  // Opening the informational migration dialog is synchronous with the
  // accepted edit event. This refresh may hydrate the table afterwards, but
  // must never delay first paint of the protected migration state.
  await channelsStore.listChannels(query.value);
};

watch(
  query,
  async (q) => {
    if (providerHandoffRecovery.activeContext.value?.origin === 'resumed') {
      providerHandoffRecovery.stop();
    }
    await channelsStore.listChannels(q);
  },
  { immediate: true, deep: true }
);

watch(
  () => channelsStore.list,
  (channels) => {
    for (const channel of channels) {
      channelStatusPresentationStore.hydrateWorkerChannel(channel);
      const snapshot = channelStatusPresentationStore.snapshot(channel.id);
      if (!snapshot?.workerStatusId) continue;

      dashboardStore.applyDashboardChannelEffectiveStatus(
        channel.id,
        snapshot.workerStatusId,
        snapshot.connectionStatusOrder ?? undefined
      );
      const presentation = resolveChannelStatusPresentation(snapshot, t);
      if (presentation.online) {
        dashboardStore.removeOfflineChannel(channel.id);
        continue;
      }
      dashboardStore.applyOfflineChannelStatusEvent({
        channelId: channel.id,
        channelName: channel.name,
        workerTypeId: snapshot.workerTypeId,
        statusId: snapshot.workerStatusId,
        statusName: channel.status?.name ?? snapshot.workerStatusId,
        workerStatusObservedAt: snapshot.workerStatusObservedAt,
        connectionStatus: snapshot.connectionStatus,
        connectionStatusSourceId: snapshot.connectionStatusSourceId,
        connectionStatusOrder: snapshot.connectionStatusOrder,
        connectionOnlineAcknowledged: snapshot.connectionOnlineAcknowledged,
        runtimeGeneration: snapshot.runtimeGeneration,
      });
    }

    refreshProviderHandoffFromTargetProjection(channels);
  },
  { immediate: true }
);

watch(isDialogDeleterShow, (isOpen) => {
  if (!isOpen) {
    openConversationsCount.value = null;
    channelToDelete.value = null;
  }
});

watch(isDialogDisconnectOfficialShow, (isOpen) => {
  if (!isOpen) {
    channelToDisconnectOfficial.value = null;
  }
});

watch(isDialogConnectionChannelShow, (isOpen) => {
  if (!isOpen) {
    channelConnectionChannel.value = null;
    channelConnectionType.value = null;
    channelConnectionSourceType.value = null;
    channelConnectionSourceServerName.value = null;
    channelConnectionTargetServerName.value = null;
    channelConnectionStatus.value = null;
    channelConnectionPhone.value = null;
    channelConnectionDebugTraceId.value = null;
    channelConnectionIsInitialCreation.value = false;
    channelConnectionIsSessionMigration.value = false;
    channelConnectionIsDestructiveReset.value = false;
    channelConnectionLifecycleOperationId.value = null;
    channelConnectionReconciledStatus.value = null;
  }
});

const shouldProcessWorkerStatusEvent = (
  data: IBaileysConnectionState,
  ctx?: { offset?: number }
): boolean => {
  if (!ctx?.offset) {
    return true;
  }

  const currentOffset = workerStatusOffsets.get(data.worker_id);
  if (currentOffset && ctx.offset <= currentOffset) {
    return false;
  }

  workerStatusOffsets.set(data.worker_id, ctx.offset);
  return true;
};

const workerStatusHandler = (
  data: IBaileysConnectionState,
  ctx?: { offset?: number }
) => {
  logLocalConnectionStatus('web.channels.worker_status.received', {
    layer: 'web.channels',
    worker_id: data.worker_id,
    account_id: data.account_id,
    worker_type_id: data.worker_type_id,
    worker_status_id: data.worker_status_id,
    status: data.status,
    code: data.code,
    session_ready: data.session_ready,
    can_send: data.can_send,
    can_receive_runtime: data.can_receive_runtime,
    authenticated: data.authenticated,
    provider_state: data.provider_state,
    degraded_reason: data.degraded_reason,
    phone: data.phone,
    connection_attempt_id: data.connection_attempt_id,
    runtime_generation: data.runtime_generation,
    offset: ctx?.offset,
  });
  logConnectionLifecycleDebug('web.centrifugo.worker_status_received', {
    trace_id:
      data.debug_trace_id ?? channelConnectionDebugTraceId.value ?? undefined,
    layer: 'web',
    worker_id: data.worker_id,
    account_id: data.account_id,
    worker_type_id: data.worker_type_id,
    connection_attempt_id: data.connection_attempt_id,
    runtime_generation: data.runtime_generation,
    status: data.status,
    code: data.code,
    reason: data.reason,
    qrcode: data.qrcode,
    pairing_code: data.pairing_code,
    offset: ctx?.offset,
  });
  if (!shouldProcessWorkerStatusEvent(data, ctx)) {
    logLocalConnectionStatus('web.channels.worker_status.skipped_offset', {
      layer: 'web.channels',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: data.worker_type_id,
      worker_status_id: data.worker_status_id,
      status: data.status,
      code: data.code,
      offset: ctx?.offset,
    });
    logConnectionLifecycleDebug('web.centrifugo.worker_status_skipped_offset', {
      trace_id:
        data.debug_trace_id ?? channelConnectionDebugTraceId.value ?? undefined,
      layer: 'web',
      worker_id: data.worker_id,
      offset: ctx?.offset,
    });
    return;
  }

  // The shared reducer owns presentation ordering. Run it before the legacy
  // list-store fences, which intentionally reject same-generation lifecycle
  // messages that are now safe only with the exact persisted operation id.
  const presentationAccepted =
    channelStatusPresentationStore.applyRealtimeEvent(data);
  const presentationSnapshot = channelStatusPresentationStore.snapshot(
    data.worker_id
  );
  const terminalDeletion =
    data.event_type === 'status' &&
    data.worker_status_id === EWorkerStatus.delete;
  const presentationObserved =
    presentationAccepted ||
    terminalDeletion ||
    canonicalSnapshotIncludesPublication(presentationSnapshot, data);
  void providerHandoffSourceRecovery.refreshFromLifecyclePublication(data);

  refreshProviderHandoffFromLifecyclePublication(data);
  if (
    data.worker_id === channelConnectionChannel.value &&
    data.worker_status_id === EWorkerStatus.error
  ) {
    void reconcileConnectionMigrationTerminalState();
  }

  if (!presentationObserved) {
    logLocalConnectionStatus(
      'web.channels.worker_status.rejected_by_canonical_projection',
      {
        layer: 'web.channels',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: data.worker_type_id,
        worker_status_id: data.worker_status_id,
        runtime_generation: data.runtime_generation,
        offset: ctx?.offset,
      }
    );
    return;
  }

  // A raw worker event without its durable observation clock can be the same
  // publication already reduced by the other Vue consumer, but it is not
  // sufficiently ordered to rewrite auxiliary row fields (phone/dates) a
  // second time. Mirror the canonical status below and reserve raw mutation
  // for the consumer that accepted it or for an exactly ordered envelope.
  const canMutateRawRow =
    presentationAccepted ||
    terminalDeletion ||
    data.worker_status_observed_at !== undefined ||
    data.connection_status !== undefined ||
    data.lifecycle_operation_id !== undefined;
  const applied = canMutateRawRow
    ? channelsStore.updateStatusChannel(
        data,
        presentationSnapshot?.workerStatusId
      )
    : false;
  if (!applied) {
    logLocalConnectionStatus('web.channels.worker_status.ignored', {
      layer: 'web.channels',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: data.worker_type_id,
      worker_status_id: data.worker_status_id,
      status: data.status,
      code: data.code,
      session_ready: data.session_ready,
      can_send: data.can_send,
      can_receive_runtime: data.can_receive_runtime,
      authenticated: data.authenticated,
      provider_state: data.provider_state,
      degraded_reason: data.degraded_reason,
      phone: data.phone,
      connection_attempt_id: data.connection_attempt_id,
      runtime_generation: data.runtime_generation,
      offset: ctx?.offset,
    });
    logConnectionLifecycleDebug('web.centrifugo.worker_status_ignored', {
      trace_id:
        data.debug_trace_id ?? channelConnectionDebugTraceId.value ?? undefined,
      layer: 'web',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: data.worker_type_id,
      connection_attempt_id: data.connection_attempt_id,
      runtime_generation: data.runtime_generation,
      status: data.status,
      code: data.code,
      worker_status_id: data.worker_status_id,
      session_ready: data.session_ready,
      phone: data.phone,
      reason: data.reason,
      offset: ctx?.offset,
    });
  }

  if (terminalDeletion) {
    dashboardStore.removeDashboardChannelEffectiveStatus(data.worker_id);
    dashboardStore.removeOfflineChannel(data.worker_id);

    if (data.worker_id === channelConnectionChannel.value) {
      isDialogConnectionChannelShow.value = false;
    }

    const rebasedPage = channelsStore.pagings.current_page;
    if (options.value.page !== rebasedPage) {
      // Updating the source query triggers the authoritative refetch through
      // the existing watcher and prevents an empty last page.
      options.value.page = rebasedPage;
    } else {
      // Refill the current server-side page and reconcile its total. The store
      // tombstone filters any response that began before the terminal event.
      void channelsStore.listChannels(query.value);
    }
    return;
  }

  const channel = channelsStore.list.find(
    (item) => item.account?.id === data.account_id && item.id === data.worker_id
  );
  if (channel && presentationSnapshot?.workerStatusId) {
    channel.status = {
      id: presentationSnapshot.workerStatusId,
      name:
        channel.status?.id === presentationSnapshot.workerStatusId
          ? channel.status.name
          : presentationSnapshot.workerStatusId,
    };
    channel.runtime_generation = presentationSnapshot.runtimeGeneration;
    channel.worker_status_observed_at =
      presentationSnapshot.workerStatusObservedAt ?? undefined;
  }
  logLocalConnectionStatus('web.channels.worker_status.applied', {
    layer: 'web.channels',
    worker_id: data.worker_id,
    account_id: data.account_id,
    worker_type_id: data.worker_type_id,
    worker_status_id: data.worker_status_id,
    status: data.status,
    code: data.code,
    session_ready: data.session_ready,
    phone: data.phone,
    list_worker_status_id: channel?.status?.id,
    list_phone: channel?.number ?? null,
    list_connection_date: channel?.connection_date ?? null,
    connection_attempt_id: data.connection_attempt_id,
    runtime_generation: data.runtime_generation,
    offset: ctx?.offset,
  });

  if (channel && isManagerWorkerRecreatingStatusEvent(data)) {
    dashboardStore.applyDashboardChannelEffectiveStatus(
      data.worker_id,
      EWorkerStatus.recreating
    );
    dashboardStore.updateOfflineChannelStatus(
      data.worker_id,
      EWorkerStatus.recreating,
      t('recreating'),
      channel.name
    );
  }
  const isManagerRecreateCompleted =
    isManagerWorkerRecreateCompletedStatusEvent(data);
  if (channel && isManagerRecreateCompleted) {
    const terminalStatusId = presentationSnapshot?.workerStatusId;
    if (
      terminalStatusId === EWorkerStatus.online ||
      terminalStatusId === EWorkerStatus.disponible
    ) {
      dashboardStore.applyDashboardChannelEffectiveStatus(
        data.worker_id,
        terminalStatusId
      );
      if (terminalStatusId === EWorkerStatus.online) {
        dashboardStore.removeOfflineChannel(data.worker_id);
      } else {
        dashboardStore.updateOfflineChannelStatus(
          data.worker_id,
          EWorkerStatus.disponible,
          t('awaiting_qr_code'),
          channel.name
        );
      }
    }
  }

  if (
    isManagerRecreateCompleted &&
    data.worker_id === channelConnectionChannel.value &&
    data.lifecycle_operation_id ===
      channelConnectionLifecycleOperationId.value &&
    presentationSnapshot?.workerStatusId === EWorkerStatus.online &&
    channelConnectionIsSessionMigration.value &&
    !providerHandoffRecovery.activeContext.value
  ) {
    // A same-provider server migration has no provider-handoff journal to
    // drive onTargetReady. Its exact recreate completion is the terminal
    // proof that can replace the protected progress screen with success.
    channelConnectionIsSessionMigration.value = false;
    channelConnectionIsDestructiveReset.value = false;
  }

  if (
    data.worker_id === channelConnectionChannel.value &&
    presentationSnapshot?.workerStatusId
  ) {
    channelConnectionStatus.value = presentationSnapshot.workerStatusId;
  }

  if (
    data.worker_id === channelConnectionChannel.value &&
    data.worker_type_id
  ) {
    channelConnectionType.value = data.worker_type_id;
  }
};

useResilientCentrifugoSubscription({
  channel: () =>
    user?.account_id ? workerCentrifugoQueue(user.account_id) : null,
  handler: workerStatusHandler,
  // ChannelStatusBanner is mounted by the app layout and is the sole recovery
  // cursor owner for this account stream. This route remains a live,
  // idempotent consumer and only reconciles its paginated row details.
  onSubscribed: async () => {
    await channelsStore.listChannels(query.value);
    await reconcileConnectionMigrationTerminalState();
    await providerHandoffSourceRecovery.refreshAll();
    await providerHandoffRecovery.refresh();
  },
  debugContext: () => ({
    account_id: user?.account_id,
    layer: 'web.channels',
  }),
});

useResilientCentrifugoSubscription({
  channel: () =>
    user?.account_id
      ? workerProviderHandoffRecoveryCentrifugoQueue(user.account_id)
      : null,
  handler: providerHandoffRecoveryPublicationHandler,
  acknowledgeRecoveryAfterSubscribed: true,
  onSubscribed: async (channel) => {
    await fetchRecentHistoryAndProcess(
      channel,
      providerHandoffRecoveryPublicationHandler
    );
    // If terminal history was compacted, these existing one-shot reads are
    // the authoritative recovery fallback. They coalesce with any live event
    // flight and never install an HTTP timer.
    await providerHandoffSourceRecovery.refreshAll();
    await providerHandoffRecovery.refresh();
  },
  debugContext: () => ({
    account_id: user?.account_id,
    layer: 'web.channels.provider_handoff_recovery',
  }),
});

onUnmounted(() => {
  initialCreationLifecycleByWorkerId.clear();
});
</script>

<template>
  <div>
    <VCard :title="$t('channels')" no-padding>
      <VCardText>
        <div class="d-flex justify-space-between flex-wrap gap-4">
          <div class="d-flex gap-4 align-center mt-5">
            <div class="d-flex align-center gap-x-2">
              <div>{{ $t('show') }}</div>
              <AppSelect
                :model-value="options.itemsPerPage"
                :items="itemsPerPage"
                @update:model-value="
                  options.itemsPerPage = parseInt($event, 10)
                "
              />
            </div>

            <VBtn
              v-if="$canPermission(permissionsCreate)"
              prepend-icon="tabler-plus"
              @click="isAddChannelVisible = true"
            >
              {{ $t('add') }}
            </VBtn>
          </div>
          <div class="d-flex align-center flex-wrap gap-4">
            <div class="type-filter">
              <VLabel class="text-body-2 mb-1">{{ $t('type') }}:</VLabel>
              <AppSelectSearch
                v-model="options.type"
                :items="itemsType"
                :placeholder="$t('select_type')"
                :clearable="true"
                item-value="id"
                item-title="text"
                @update:modelValue="options.page = 1"
              />
            </div>

            <div class="status-filter">
              <VLabel class="text-body-2 mb-1">{{ $t('status') }}:</VLabel>
              <AppSelectSearch
                v-model="options.status"
                :items="itemsStatus"
                :placeholder="$t('select_state')"
                :clearable="true"
                item-value="id"
                item-title="text"
                @update:modelValue="options.page = 1"
              />
            </div>

            <div class="invoice-list-filter">
              <VLabel class="text-body-2 mb-1">{{ $t('search') }}:</VLabel>
              <AppTextField
                :placeholder="$t('search') + '...'"
                append-inner-icon="tabler-search"
                single-line
                hide-details
                dense
                outlined
                v-model="options.search"
                data-testid="channels-search"
              />
            </div>
          </div>
        </div>

        <VDivider class="my-4" />

        <div>
          <VDataTableServer
            class="data-table"
            v-model:page="options.page"
            v-model:items-per-page="options.itemsPerPage"
            :headers="headers"
            :items="channelsStore.list"
            :items-length="channelsStore.pagings.total"
            :loading="channelsStore.loading"
            :sort-by="options.sortBy"
            @update:options="handleTableChange"
            :loading-text="$t('loading_text')"
          >
            <template #item.name="{ item }">
              <div class="d-flex flex-column ms-3">
                <span
                  class="d-block font-weight-medium text-high-emphasis text-truncate"
                >
                  {{ item.name }}
                </span>
              </div>
            </template>

            <template #item.status="{ item }">
              <VChip
                :color="resolveChannelStatusVariant(item).color"
                size="small"
                :data-testid="`channel-status-${item.id}`"
              >
                {{ resolveChannelStatusVariant(item).text }}
              </VChip>
            </template>

            <template #item.type="{ item }">
              <VChip
                :color="resolveTypeVariant(item?.type?.id).color"
                size="small"
                :data-testid="`channel-type-${item.id}`"
              >
                {{ resolveTypeVariant(item?.type?.id).text }}
              </VChip>
            </template>

            <template #item.server="{ item }">
              <span>{{ item.server?.name ?? '-' }}</span>
            </template>

            <template #item.number="{ item }">
              <span>{{ item.number ? formatPhoneBR(item.number) : '-' }}</span>
            </template>

            <template #item.account="{ item }">
              <span>{{ item.account?.name }}</span>
            </template>

            <template #item.connection_date="{ item }">
              <span>{{
                item.connection_date
                  ? formatDateTime(item.connection_date)
                  : '-'
              }}</span>
            </template>

            <template #item.last_connection_check_at="{ item }">
              <span>{{
                item.last_connection_check_at
                  ? formatDateTime(item.last_connection_check_at)
                  : '-'
              }}</span>
            </template>

            <template #item.updated_at="{ item }">
              <span>{{
                item.updated_at ? formatDateTime(item.updated_at) : '-'
              }}</span>
            </template>

            <template #item.created_at="{ item }">
              <span>{{ formatDateTime(item.created_at) }}</span>
            </template>

            <template #item.actions="{ item }">
              <div class="d-flex gap-1">
                <IconBtn
                  v-if="
                    item.type?.id !== EWorkerType.whatsapp &&
                    item.status?.id !== EWorkerStatus.blocked &&
                    item.status?.id !== EWorkerStatus.stopped &&
                    (EWorkerStatus.disponible === item.status?.id ||
                      EWorkerStatus.online === item.status?.id ||
                      EWorkerStatus.offline === item.status?.id ||
                      EWorkerStatus.mismatched === item.status?.id)
                  "
                  ><VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('connect_channel') }}</span> </VTooltip
                  ><VIcon
                    icon="tabler-plug-connected"
                    :data-testid="`channel-connect-${item.id}`"
                    @click="openConnectionDialog(item)"
                /></IconBtn>

                <IconBtn
                  v-if="
                    isWhatsappOfficialReconnectable(item) &&
                    $canPermission(permissionsCreate)
                  "
                  :disabled="
                    isWhatsappOfficialSignupLoading ||
                    !!reconnectingWhatsappOfficialId
                  "
                  @click="connectWhatsappOfficial(item)"
                >
                  <VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('reconnect_whatsapp_official') }}</span>
                  </VTooltip>
                  <VIcon
                    icon="tabler-plug-connected"
                    :data-testid="`channel-reconnect-official-${item.id}`"
                  />
                </IconBtn>

                <IconBtn
                  v-if="
                    isWhatsappOfficialWebhookRepairable(item) &&
                    $canPermission(permissionsCreate)
                  "
                  :disabled="
                    isWhatsappOfficialSignupLoading ||
                    !!ensuringWhatsappOfficialWebhookSubscriptionId
                  "
                  @click="ensureWhatsappOfficialWebhookSubscription(item)"
                >
                  <VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{
                      $t('repair_whatsapp_official_webhook_subscription')
                    }}</span>
                  </VTooltip>
                  <VProgressCircular
                    v-if="
                      ensuringWhatsappOfficialWebhookSubscriptionId === item.id
                    "
                    indeterminate
                    size="18"
                    width="2"
                  />
                  <VIcon
                    v-else
                    icon="tabler-webhook"
                    :data-testid="`channel-repair-official-webhook-${item.id}`"
                  />
                </IconBtn>

                <IconBtn v-if="$canPermission(permissionsEdit)"
                  ><VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('edit_channel') }}</span> </VTooltip
                  ><VIcon
                    icon="tabler-edit"
                    :data-testid="`channel-edit-${item.id}`"
                    @click="openEditDialog(item.id)"
                /></IconBtn>

                <IconBtn v-if="$canPermission(permissionsProfileStatus)"
                  ><VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('configurations') }}</span> </VTooltip
                  ><VIcon
                    icon="tabler-settings"
                    @click="openConfigDialog(item.id)"
                /></IconBtn>

                <IconBtn
                  v-if="
                    isWhatsappOfficialChannel(item) &&
                    $canPermission(permissionsManageOfficialTemplates)
                  "
                  :disabled="
                    isOfficialHealthLoading &&
                    officialHealthChannel?.id === item.id
                  "
                  @click="openWhatsappOfficialHealth(item)"
                >
                  <VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('view_meta_health') }}</span>
                  </VTooltip>
                  <VProgressCircular
                    v-if="
                      isOfficialHealthLoading &&
                      officialHealthChannel?.id === item.id
                    "
                    indeterminate
                    size="18"
                    width="2"
                  />
                  <VIcon
                    v-else
                    icon="tabler-shield-check"
                    :data-testid="`channel-meta-health-${item.id}`"
                  />
                </IconBtn>

                <IconBtn
                  v-if="
                    isWhatsappOfficialChannel(item) &&
                    item.official_template_manager_url &&
                    $canPermission(permissionsManageOfficialTemplates)
                  "
                  :data-testid="`channel-meta-whatsapp-template-manager-${item.id}`"
                  :href="item.official_template_manager_url"
                  target="_blank"
                  rel="noopener noreferrer"
                  @click.stop
                  ><VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>Gerenciar modelos</span>
                  </VTooltip>
                  <VIcon icon="tabler-file-description" />
                </IconBtn>

                <IconBtn
                  v-if="
                    isWhatsappOfficialOnline(item) &&
                    $canPermission(permissionsDelete)
                  "
                  :disabled="isDisconnectOfficialRunning"
                  @click="disconnectWhatsappOfficial(item.id)"
                  ><VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('disconnect_whatsapp_official') }}</span>
                  </VTooltip>
                  <VIcon
                    icon="tabler-plug-connected-x"
                    :data-testid="`channel-disconnect-official-${item.id}`"
                /></IconBtn>

                <IconBtn
                  v-if="
                    canViewConnectionLogs(item) &&
                    $canPermission(permissionsViewLogs)
                  "
                  :aria-label="$t('connection_health_action')"
                  :data-testid="`channel-connection-health-${item.id}`"
                  @click="openConnectionLogDialog(item.id)"
                  ><VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('connection_health_action') }}</span> </VTooltip
                  ><VIcon icon="tabler-heartbeat"
                /></IconBtn>

                <VTooltip
                  v-if="
                    $canPermission(permissionsRecreate) &&
                    item.type?.id !== EWorkerType.whatsapp &&
                    !isChannelBlockedByPlan(item)
                  "
                  location="top"
                  transition="scale-transition"
                >
                  <template #activator="{ props }">
                    <span v-bind="props" class="channel-action-tooltip-anchor">
                      <IconBtn
                        :disabled="isRecreateCooldownActive(item)"
                        :aria-label="recreateChannelTooltip(item)"
                        :data-testid="`channel-recreate-${item.id}`"
                        @click="recreateChannel(item)"
                      >
                        <VIcon icon="tabler-refresh" />
                      </IconBtn>
                    </span>
                  </template>
                  <span>{{ recreateChannelTooltip(item) }}</span>
                </VTooltip>

                <IconBtn v-if="$canPermission(permissionsEdit)">
                  <VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>
                      {{
                        `${$t(isChannelBlockedByPlan(item) ? 'unblock' : 'block')} ${$t('channel')}`
                      }}
                    </span>
                  </VTooltip>
                  <VIcon
                    :icon="
                      isChannelBlockedByPlan(item)
                        ? 'tabler-lock-open'
                        : 'tabler-lock'
                    "
                    @click="openChannelPlanBlockDialog(item)"
                  />
                </IconBtn>

                <IconBtn v-if="$canPermission(permissionsDelete)"
                  ><VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('delete_channel') }}</span> </VTooltip
                  ><VIcon icon="tabler-trash" @click="deleteChannel(item.id)"
                /></IconBtn>
              </div>
            </template>

            <template #no-data>
              {{ $t('no_data_available') }}
            </template>

            <template #bottom>
              <TablePagination
                v-model:page="options.page"
                :items-per-page="options.itemsPerPage"
                :total-items="channelsStore.pagings.total"
              />
            </template>
          </VDataTableServer>
        </div>
      </VCardText>

      <VDialogHandler
        v-if="isDialogDeleterShow"
        v-model="isDialogDeleterShow"
        :title="$t('delete_channel')"
        :message="
          openConversationsCount && openConversationsCount > 0
            ? $t('channel_delete_has_open_conversations', {
                count: openConversationsCount,
              })
            : $t('delete_channel_confirmation')
        "
        :disable-confirm="
          openConversationsCount !== null && openConversationsCount > 0
        "
        @confirm="handleDelete"
      />

      <VDialogHandler
        v-if="isDialogChannelPlanBlockShow"
        v-model="isDialogChannelPlanBlockShow"
        :title="channelPlanBlockDialogTitle"
        :message="channelPlanBlockDialogMessage"
        @confirm="handleChannelPlanBlock"
      />

      <AppChannelConnectionStrategyDialog
        v-if="isDialogRecreatorShow"
        v-model="isDialogRecreatorShow"
        mode="recreate"
        :loading="channelsStore.loading"
        @select="handleRecreate"
      />

      <VDialogHandler
        v-if="isDialogDisconnectOfficialShow"
        v-model="isDialogDisconnectOfficialShow"
        :title="$t('disconnect_whatsapp_official')"
        :message="$t('disconnect_whatsapp_official_confirmation')"
        @confirm="handleDisconnectWhatsappOfficial"
      />

      <ChannelOfficialHealthDialog
        v-model="isOfficialHealthDialogOpen"
        :channel="officialHealthChannel"
        :health="officialHealthData"
        :loading="isOfficialHealthLoading"
        :can-repair="$canPermission(permissionsCreate)"
        :repair-loading="
          isWhatsappOfficialSignupLoading ||
          ensuringWhatsappOfficialWebhookSubscriptionId ===
            officialHealthChannel?.id
        "
        @refresh="refreshWhatsappOfficialHealth"
        @repair="repairWhatsappOfficialHealthWebhook"
      />

      <VDialog
        v-model="isDisconnectOfficialProgressShow"
        max-width="460"
        persistent
      >
        <VCard class="disconnect-progress-modal">
          <VCardText class="disconnect-progress-content">
            <div class="disconnect-progress-orbit">
              <VProgressCircular
                v-if="isDisconnectOfficialRunning"
                indeterminate
                color="success"
                size="70"
                width="5"
              />
              <VIcon
                v-else
                :icon="
                  disconnectOfficialProgressResult === 'warning'
                    ? 'tabler-alert-triangle'
                    : 'tabler-circle-check'
                "
                :color="
                  disconnectOfficialProgressResult === 'warning'
                    ? 'warning'
                    : 'success'
                "
                size="70"
              />
              <VIcon
                icon="tabler-brand-whatsapp"
                color="success"
                size="28"
                class="disconnect-progress-center-icon"
              />
            </div>

            <div class="disconnect-progress-heading">
              <h3>{{ $t('whatsapp_official_disconnect_progress_title') }}</h3>
              <p>
                {{
                  isDisconnectOfficialRunning
                    ? $t('whatsapp_official_disconnect_progress_underchat')
                    : disconnectOfficialProgressResult === 'warning'
                      ? $t('whatsapp_official_disconnect_progress_warning')
                      : $t('whatsapp_official_disconnect_progress_success')
                }}
              </p>
            </div>

            <div class="disconnect-progress-steps">
              <div
                v-for="step in disconnectOfficialProgressSteps"
                :key="step.key"
                class="disconnect-progress-step"
                :class="`is-${step.status}`"
              >
                <span class="disconnect-progress-step-icon">
                  <VProgressCircular
                    v-if="step.status === 'running'"
                    indeterminate
                    color="success"
                    size="18"
                    width="2"
                  />
                  <VIcon
                    v-else
                    :icon="
                      step.status === 'warning'
                        ? 'tabler-alert-triangle'
                        : step.status === 'done'
                          ? 'tabler-check'
                          : 'tabler-clock'
                    "
                    size="18"
                  />
                </span>
                <span>{{ step.text }}</span>
              </div>
            </div>

            <VAlert
              v-if="disconnectOfficialProgressWarning"
              type="warning"
              variant="tonal"
              density="compact"
              class="disconnect-progress-warning"
            >
              {{ disconnectOfficialProgressWarning }}
            </VAlert>

            <div
              v-if="!isDisconnectOfficialRunning"
              class="disconnect-progress-actions"
            >
              <VBtn color="primary" @click="closeDisconnectOfficialProgress">
                {{ $t('close') }}
              </VBtn>
            </div>
          </VCardText>
        </VCard>
      </VDialog>

      <AppEditChannel
        v-if="isDialogEditChannelShow"
        v-model="isDialogEditChannelShow"
        :channel-id="channelToEdit"
        @updated="handleChannelUpdated"
      />

      <ChannelProviderHandoffRecoveryDialog
        v-if="providerHandoffRecovery.handoff.value"
        :model-value="providerHandoffRecovery.isDialogVisible.value"
        :source-provider="providerHandoffRecovery.handoff.value.source_provider"
        :target-provider="providerHandoffRecovery.handoff.value.target_provider"
        :reference-code="providerHandoffRecovery.handoff.value.handoff_id"
        :error-code="
          providerHandoffRecovery.handoff.value.error_code ??
          providerHandoffRecovery.handoff.value.recovery_error_code
        "
        :recovery-state="providerHandoffRecovery.handoff.value.recovery_state"
        :handoff-state="providerHandoffRecovery.handoff.value.state"
        :decision-reason="providerHandoffRecovery.decisionReason.value"
        :source-revision-preserved="
          providerHandoffRecovery.handoff.value.source_revision_preserved
        "
        :source-runtime-restored="
          providerHandoffRecovery.handoff.value.source_runtime_restored
        "
        :can-return="providerHandoffRecovery.handoff.value.can_return"
        :can-discard="providerHandoffRecovery.handoff.value.can_discard"
        :loading-action="providerHandoffRecovery.loadingAction.value"
        :pending-action="providerHandoffRecovery.pendingAction.value"
        @update:model-value="$event || providerHandoffRecovery.dismissDialog()"
        @return="providerHandoffRecovery.resolve('return')"
        @discard="providerHandoffRecovery.resolve('discard')"
        @retry="providerHandoffRecovery.retry()"
      />

      <AppAddChannel
        v-if="isAddChannelVisible"
        v-model="isAddChannelVisible"
        @created="handleChannelCreated"
      />

      <AppConnectChannel
        v-if="isDialogConnectionChannelShow && user?.account_id"
        :key="channelConnectionDialogKey"
        v-model="isDialogConnectionChannelShow"
        :channel-id="channelConnectionChannel"
        :channel-type="currentConnectionChannelType"
        :migration-source-type="channelConnectionSourceType"
        :migration-source-server-name="channelConnectionSourceServerName"
        :migration-target-server-name="channelConnectionTargetServerName"
        :account-id="user.account_id"
        :initial-status-id="currentConnectionChannelStatus"
        :initial-phone="currentConnectionChannelPhone"
        :initial-connection-status="
          currentConnectionChannel?.connection_status ?? null
        "
        :initial-connection-status-source-id="
          currentConnectionChannel?.connection_status_source_id ?? null
        "
        :initial-connection-status-order="
          currentConnectionChannel?.connection_status_order ?? null
        "
        :initial-connection-online-acknowledged="
          currentConnectionChannel?.connection_online_acknowledged === true
        "
        :is-initial-creation="channelConnectionIsInitialCreation"
        :is-session-migration="channelConnectionIsSessionMigration"
        :is-destructive-reset="channelConnectionIsDestructiveReset"
        :debug-trace-id="channelConnectionDebugTraceId"
        @session-removed="handleSessionRemoved"
        @connection-started="handleConnectionStarted"
        @migration-cancel-requested="requestMigrationDecision('cancel')"
        @migration-timed-out="requestMigrationDecision('timeout')"
      />

      <SessionRemovedDialog
        v-if="isSessionRemovedDialogShow"
        v-model="isSessionRemovedDialogShow"
        @reconnect="reconnectRemovedSession"
      />

      <AppLogsChannel
        v-if="isDialogConnectionLogsShow"
        v-model="isDialogConnectionLogsShow"
        :channel-id="channelConnectionLogs"
      />

      <AppConfigChannel
        v-if="isDialogConfigChannelShow"
        v-model="isDialogConfigChannelShow"
        :channel-id="channelConfig"
      />
    </VCard>

    <VSnackbar
      v-model="channelsStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="channelsStore.snackbar.color"
    >
      {{ channelsStore.snackbar.message }}
    </VSnackbar>
  </div>
</template>

<style lang="scss" scoped>
.status-filter {
  inline-size: 12rem;
}

.type-filter {
  inline-size: 12rem;
}

.invoice-list-filter {
  inline-size: 20rem;
}

.channel-action-tooltip-anchor {
  display: inline-flex;
}

.disconnect-progress-modal {
  border-radius: 8px;
}

.disconnect-progress-content {
  display: grid;
  gap: 1.25rem;
  padding: 2rem;
  text-align: center;
}

.disconnect-progress-orbit {
  position: relative;
  display: grid;
  block-size: 5.25rem;
  inline-size: 5.25rem;
  margin-inline: auto;
  place-items: center;
}

.disconnect-progress-orbit::before {
  position: absolute;
  border: 1px solid rgba(var(--v-theme-success), 0.18);
  border-radius: 50%;
  animation: disconnect-pulse 1.4s ease-out infinite;
  content: '';
  inset: 0.15rem;
}

.disconnect-progress-center-icon {
  position: absolute;
  padding: 0.25rem;
  border-radius: 999px;
  background: rgb(var(--v-theme-surface));
}

.disconnect-progress-heading h3 {
  margin: 0;
  color: rgb(var(--v-theme-on-surface));
  font-size: 1.125rem;
  font-weight: 600;
}

.disconnect-progress-heading p {
  margin: 0.35rem 0 0;
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.875rem;
}

.disconnect-progress-steps {
  display: grid;
  gap: 0.625rem;
  text-align: start;
}

.disconnect-progress-step {
  display: flex;
  align-items: center;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.025);
  color: rgba(var(--v-theme-on-surface), 0.7);
  gap: 0.75rem;
  padding: 0.75rem 0.85rem;
}

.disconnect-progress-step.is-running {
  border-color: rgba(var(--v-theme-success), 0.32);
  background: rgba(var(--v-theme-success), 0.08);
  color: rgb(var(--v-theme-on-surface));
}

.disconnect-progress-step.is-done {
  color: rgb(var(--v-theme-success));
}

.disconnect-progress-step.is-warning {
  border-color: rgba(var(--v-theme-warning), 0.34);
  background: rgba(var(--v-theme-warning), 0.1);
  color: rgb(var(--v-theme-warning));
}

.disconnect-progress-step-icon {
  display: inline-grid;
  block-size: 1.5rem;
  inline-size: 1.5rem;
  place-items: center;
}

.disconnect-progress-warning {
  text-align: start;
}

.disconnect-progress-actions {
  display: flex;
  justify-content: end;
}

@keyframes disconnect-pulse {
  0% {
    opacity: 0.72;
    transform: scale(0.92);
  }

  100% {
    opacity: 0;
    transform: scale(1.22);
  }
}

.data-table {
  :deep(.v-table__wrapper > table > thead) {
    background-color: rgba(var(--v-theme-on-surface), 0.04);
  }

  :deep(.v-table__wrapper > table > thead > tr > th) {
    background-color: transparent;
    color: rgb(var(--v-theme-primary));
    font-weight: 700;
    border-bottom: 1px solid rgba(var(--v-theme-primary), 0.25);
  }

  :deep(
    .v-table__wrapper > table > thead > tr > th .v-data-table-header__content
  ) {
    color: inherit;
  }
}
</style>
