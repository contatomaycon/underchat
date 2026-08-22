<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, shallowRef } from 'vue';
import { refDebounced, useIntervalFn } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import { useDashboardStore } from '@/@webcore/stores/dashboard';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { useSettingsStore } from '@/@webcore/stores/settings';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { DataTableHeader } from 'vuetify';
import { ListChannelsResponse } from '@core/schema/config/listChannels/response.schema';
import { ViewWorkerResponse } from '@core/schema/worker/viewWorker/response.schema';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import { EColor } from '@core/common/enums/EColor';
import TablePagination from '@/@webcore/components/TablePagination.vue';
import { channelsConfigCentrifugo } from '@core/common/functions/centrifugoQueue';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { IConfigChannelsRecreateAllCompleted } from '@core/common/interfaces/IConfigChannelsRecreateAllCompleted';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { getUser } from '@/@webcore/localStorage/user';
import VDialogHandler from '@/components/VDialogHandler.vue';
import { ChannelsStatisticsResponse } from '@core/schema/config/channelsStatistics/response.schema';
import { supportsWhatsappSessionStorage } from '@core/common/functions/workerSessionStorage';
import SessionStorageBadge from '@/components/channel/SessionStorageBadge.vue';
import { useResilientCentrifugoSubscription } from '@/composables/useResilientCentrifugoSubscription';
import ChannelProviderHandoffRecoveryDialog from '@/components/channel/ChannelProviderHandoffRecoveryDialog.vue';
import {
  isWhatsappProviderHandoffTargetOnline,
  useWhatsappProviderHandoffRecovery,
  workerTypeToWhatsappProvider,
  type WhatsappProviderHandoffMonitorContext,
} from '@/composables/useWhatsappProviderHandoffRecovery';
import { useChannelMigrationRollbackContext } from '@/composables/useChannelMigrationRollbackContext';
import { EWorkerConnectionStrategy } from '@core/common/enums/EWorkerConnectionStrategy';
import LegacySessionMigrationDialog from '@/components/channel/LegacySessionMigrationDialog.vue';
import type { SessionStorageMigrationSummary } from '@core/schema/config/sessionStorageMigration/response.schema';
import { resolveChannelStatusPresentation } from '@/@webcore/utils/channelStatusPresentation';
import { EWorkerRecreatePhase } from '@core/common/enums/EWorkerRecreatePhase';
import AppLogsChannel from '@/components/channel/AppLogsChannel.vue';
import { canViewConnectionHealth } from '@/utils/connectionHealthPresentation';

const { t } = useI18n();
const dashboardStore = useDashboardStore();
const channelsStore = useChannelsStore();
const settingsStore = useSettingsStore();
useSnackbarCleanup(settingsStore);

const loading = ref(false);
const channels = ref<ListChannelsResponse[]>([]);
const total = ref(0);
const statistics = ref<ChannelsStatisticsResponse | null>(null);
const migrationChannel = ref<ListChannelsResponse | null>(null);
const migrationSummary = ref<SessionStorageMigrationSummary | null>(null);
const isMigrationDialogVisible = ref(false);
const migrationLoading = ref(false);
const connectionHealthChannelId = shallowRef<string | null>(null);
const isConnectionHealthDialogVisible = shallowRef(false);

const openConnectionHealthDialog = (channelId: string): void => {
  connectionHealthChannelId.value = channelId;
  isConnectionHealthDialogVisible.value = true;
};

watch(isConnectionHealthDialogVisible, (isVisible) => {
  if (!isVisible) connectionHealthChannelId.value = null;
});

const activeMigrationStates = new Set([
  'queued',
  'capturing',
  'staged',
  'cutting_over',
  'starting',
  'validating',
  'retry_wait',
  'restoring',
]);

const migrationAction = (
  channel: ListChannelsResponse
): 'migrate' | 'follow' | 'cleanup' | null => {
  const migration = channel.session_storage_migration;
  if (migration && activeMigrationStates.has(migration.state)) return 'follow';
  if (migration?.state === 'recovery_required') return 'follow';
  if (
    migration &&
    ['cleanup_pending', 'deleting_volume'].includes(migration.state)
  )
    return 'cleanup';
  if (
    channel.session_storage === EWorkerSessionStorage.legacy_volume &&
    supportsWhatsappSessionStorage(channel.type?.id) &&
    (!migration || migration.state === 'restored')
  )
    return 'migrate';
  return null;
};

const syncMigrationSummary = (
  workerId: string,
  migration: SessionStorageMigrationSummary
) => {
  const channel = channels.value.find((item) => item.id === workerId);
  if (channel) channel.session_storage_migration = migration;
  if (migrationChannel.value?.id === workerId)
    migrationSummary.value = migration;
};

const openMigrationDialog = async (channel: ListChannelsResponse) => {
  migrationChannel.value = channel;
  const action = migrationAction(channel);
  migrationSummary.value =
    action === 'migrate' ? null : channel.session_storage_migration;
  isMigrationDialogVisible.value = true;

  if (action !== 'migrate') {
    const latest = await settingsStore.latestSessionStorageMigration(
      channel.id
    );
    if (latest) syncMigrationSummary(channel.id, latest);
  }
};

const startLegacySessionMigration = async () => {
  if (!migrationChannel.value) return;
  migrationLoading.value = true;
  try {
    const migration = await settingsStore.startSessionStorageMigration(
      migrationChannel.value.id
    );
    if (migration) syncMigrationSummary(migrationChannel.value.id, migration);
  } finally {
    migrationLoading.value = false;
  }
};

const deleteLegacyMigrationVolume = async () => {
  if (!migrationChannel.value || !migrationSummary.value) return;
  migrationLoading.value = true;
  try {
    const migration = await settingsStore.deleteLegacySessionVolume(
      migrationChannel.value.id,
      migrationSummary.value.migration_id
    );
    if (migration) syncMigrationSummary(migrationChannel.value.id, migration);
  } finally {
    migrationLoading.value = false;
  }
};

const refreshOpenMigration = async () => {
  if (
    !isMigrationDialogVisible.value ||
    !migrationChannel.value ||
    !migrationSummary.value ||
    !activeMigrationStates.has(migrationSummary.value.state)
  )
    return;
  const latest = await settingsStore.latestSessionStorageMigration(
    migrationChannel.value.id
  );
  if (latest) syncMigrationSummary(migrationChannel.value.id, latest);
};

const { pause: pauseMigrationRefresh, resume: resumeMigrationRefresh } =
  useIntervalFn(refreshOpenMigration, 3_000, { immediate: false });

watch(isMigrationDialogVisible, (visible) => {
  if (visible) resumeMigrationRefresh();
  else pauseMigrationRefresh();
});

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
]);

const itemsStatus = ref([
  { id: EWorkerStatus.disponible, text: t('awaiting_qr_code') },
  { id: EWorkerStatus.offline, text: t('offline') },
  { id: EWorkerStatus.online, text: t('channel_connected') },
  { id: EWorkerStatus.connecting, text: t('connecting') },
  { id: EWorkerStatus.new, text: t('new') },
  { id: EWorkerStatus.creating, text: t('creating') },
  { id: EWorkerStatus.error, text: t('error') },
  { id: EWorkerStatus.mismatched, text: t('mismatched') },
  { id: EWorkerStatus.deleting, text: t('deleting') },
  { id: EWorkerStatus.recreating, text: t('recreating') },
  { id: EWorkerStatus.delete, text: t('deletion_pending') },
  { id: EWorkerStatus.stopped, text: t('stopped') },
  { id: EWorkerStatus.blocked, text: t('blocked_by_plan') },
]);

const itemsType = ref([
  { id: EWorkerType.baileys, text: t('unofficial_socket') },
  { id: EWorkerType.wwebjs, text: t('unofficial_browser') },
  { id: EWorkerType.whatsmeow, text: t('unofficial_whatsmeow') },
]);

const itemsSessionStorage = [
  {
    id: EWorkerSessionStorage.postgres,
    text: t('session_storage_postgres'),
  },
  {
    id: EWorkerSessionStorage.legacy_volume,
    text: t('session_storage_legacy_volume'),
  },
];

const itemsAccount = ref<Array<{ id: string; text: string }>>([]);
const accountsLoading = ref(false);

const loadAccounts = async () => {
  if (itemsAccount.value.length > 0) return;

  accountsLoading.value = true;
  try {
    const accounts = await settingsStore.getAccounts();
    if (accounts) {
      itemsAccount.value = accounts.map((acc) => ({
        id: acc.account_id,
        text: acc.name,
      }));
    }
  } catch {
  } finally {
    accountsLoading.value = false;
  }
};

const resolveStatusVariant = (channel: ListChannelsResponse) =>
  resolveChannelStatusPresentation(
    {
      workerTypeId: channel.type?.id,
      workerStatusId: channel.status?.id,
      sessionIdentityPresent: Boolean(channel.number?.trim()),
      recreatePhase: channel.recreate_phase,
    },
    t
  );

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

const headers: DataTableHeader<ListChannelsResponse>[] = [
  { title: t('name'), key: 'name' },
  { title: t('number'), key: 'number' },
  { title: t('status'), key: 'status' },
  { title: t('type'), key: 'type' },
  { title: t('session_storage'), key: 'session_storage', sortable: false },
  { title: t('account'), key: 'account' },
  { title: t('server'), key: 'server' },
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
  session_storage: null as EWorkerSessionStorage | null,
  account: null as string | null,
  search: null as string | null,
});

const debouncedSearch = refDebounced(
  computed(() => options.value.search),
  500
);

const query = computed(() => ({
  current_page: options.value.page,
  per_page:
    options.value.itemsPerPage === -1 ? 200 : options.value.itemsPerPage,
  sort_by: options.value.sortBy,
  status: options.value.status || undefined,
  type: options.value.type || undefined,
  session_storage: options.value.session_storage || undefined,
  account: options.value.account || undefined,
  name: debouncedSearch.value || undefined,
  number: debouncedSearch.value || undefined,
}));

const loadChannels = async () => {
  loading.value = true;
  const result = await settingsStore.getChannels(query.value);
  if (result) {
    channels.value = result.results;
    total.value = result.pagings.total;
  }
  loading.value = false;
};

const loadStatistics = async () => {
  const result = await settingsStore.getChannelsStatistics();
  if (result) {
    statistics.value = result;
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

watch(
  query,
  async () => {
    await loadChannels();
  },
  { immediate: true, deep: true }
);

const channelToDelete = ref<string | null>(null);
const isDialogDeleterShow = ref(false);
const openConversationsCount = ref<number | null>(null);
const channelToEdit = ref<ListChannelsResponse | null>(null);
const isDialogEditChannelShow = ref(false);
const connectionChannel = ref<ViewWorkerResponse | null>(null);
const connectionTargetType = ref<EWorkerType | null>(null);
const connectionSourceType = ref<EWorkerType | null>(null);
const connectionSourceServerName = ref<string | null>(null);
const connectionTargetServerName = ref<string | null>(null);
const isDialogConnectionChannelShow = ref(false);
const connectionIsSessionMigration = ref(false);
const connectionIsDestructiveReset = ref(false);
const migrationRollbackContext = useChannelMigrationRollbackContext();
const isLocalMigrationRecoveryVisible = ref(false);
const localMigrationRecoveryAction = ref<'return' | 'discard' | null>(null);

watch(isDialogDeleterShow, (isOpen) => {
  if (!isOpen) {
    openConversationsCount.value = null;
    channelToDelete.value = null;
  }
});

watch(isDialogEditChannelShow, (isOpen) => {
  if (!isOpen) {
    channelToEdit.value = null;
  }
});

watch(isDialogConnectionChannelShow, (isOpen) => {
  if (!isOpen) {
    connectionChannel.value = null;
    connectionTargetType.value = null;
    connectionSourceType.value = null;
    connectionSourceServerName.value = null;
    connectionTargetServerName.value = null;
    connectionIsSessionMigration.value = false;
    connectionIsDestructiveReset.value = false;
  }
});

const channelToRecreate = ref<ListChannelsResponse | null>(null);
const isDialogRecreatorShow = ref(false);
const isDialogRecreateAllShow = ref(false);

watch(isDialogRecreatorShow, (isOpen) => {
  if (!isOpen) {
    channelToRecreate.value = null;
  }
});

const handleDelete = async () => {
  if (!channelToDelete.value) return;

  const channelId = channelToDelete.value;
  const result = await settingsStore.deleteChannel(channelId);
  if (result) {
    dashboardStore.removeOfflineChannel(channelId);
    await loadStatistics();
    await loadChannels();
  }

  channelToDelete.value = null;
  openConversationsCount.value = null;
};

const recreateChannel = (channel: ListChannelsResponse) => {
  channelToRecreate.value = channel;
  isDialogRecreatorShow.value = true;
};

const openEditDialog = (channel: ListChannelsResponse) => {
  channelToEdit.value = channel;
  isDialogEditChannelShow.value = true;
};

const handleRecreate = async (strategy: EWorkerConnectionStrategy) => {
  if (!channelToRecreate.value) return;

  const channel = channelToRecreate.value;
  const result = await settingsStore.recreateChannel(channel.id, strategy);
  if (result) {
    await Promise.all([loadStatistics(), loadChannels()]);

    if (strategy === EWorkerConnectionStrategy.fresh) {
      const currentChannel = await channelsStore.getWorkerById(channel.id);
      if (currentChannel?.account?.id) {
        connectionChannel.value = currentChannel;
        connectionTargetType.value =
          (result.worker_type_id as EWorkerType | undefined) ??
          (currentChannel.type?.id as EWorkerType | undefined) ??
          null;
        connectionSourceType.value = null;
        connectionSourceServerName.value = null;
        connectionTargetServerName.value = null;
        connectionIsSessionMigration.value = false;
        connectionIsDestructiveReset.value = true;
        isDialogConnectionChannelShow.value = false;
        await nextTick();
        isDialogConnectionChannelShow.value = true;
      }
    }
  }

  isDialogRecreatorShow.value = false;
  channelToRecreate.value = null;
};

const handleRecreateAll = async () => {
  const result = await settingsStore.recreateChannelsAll({
    status: query.value.status ?? undefined,
    type: query.value.type ?? undefined,
    session_storage: query.value.session_storage ?? undefined,
    account: query.value.account ?? undefined,
    name: query.value.name ?? undefined,
    number: query.value.number ?? undefined,
  });

  isDialogRecreateAllShow.value = false;

  if (result && !result.enqueued) {
    await loadStatistics();
    await loadChannels();
  }
};

const localMigrationRollback = computed(
  () => migrationRollbackContext.activeContext.value
);
const localMigrationSourceProvider = computed(() => {
  const context = localMigrationRollback.value;
  return context
    ? (workerTypeToWhatsappProvider(context.previousWorkerType) ??
        context.previousWorkerType)
    : '';
});
const localMigrationTargetProvider = computed(() => {
  const context = localMigrationRollback.value;
  if (!context) return '';

  const current = channels.value.find(
    (channel) => channel.id === context.workerId
  );
  return current
    ? (workerTypeToWhatsappProvider(current.type?.id) ?? current.type?.id ?? '')
    : '';
});
const canReturnLocalMigration = computed(
  () =>
    localMigrationRollback.value?.previousSessionStorage ===
    EWorkerSessionStorage.postgres
);

const isAcceptedLifecycleAck = (
  value: unknown
): value is { operation_id: string } =>
  typeof value === 'object' &&
  value !== null &&
  (value as { queued?: unknown }).queued === true &&
  typeof (value as { operation_id?: unknown }).operation_id === 'string';

const isMigrationHealthy = (statusId: string | null | undefined) =>
  statusId === EWorkerStatus.online || statusId === EWorkerStatus.disponible;

async function reconcileLocalMigrationRollback() {
  const context = localMigrationRollback.value;
  if (!context || localMigrationRecoveryAction.value) return;

  const currentChannel = await channelsStore.getWorkerById(context.workerId);
  if (!currentChannel) return;

  const isExactOperation =
    currentChannel.lifecycle_operation_id === context.lifecycleOperationId;
  const isClearedTerminalFailure =
    currentChannel.status?.id === EWorkerStatus.error &&
    (currentChannel.lifecycle_operation_id === null ||
      currentChannel.lifecycle_operation_id === undefined);
  if (!isExactOperation && !isClearedTerminalFailure) {
    if (
      isMigrationHealthy(currentChannel.status?.id) ||
      Boolean(currentChannel.lifecycle_operation_id)
    ) {
      migrationRollbackContext.clear({
        workerId: context.workerId,
        lifecycleOperationId: context.lifecycleOperationId,
      });
      isLocalMigrationRecoveryVisible.value = false;
      if (!providerHandoffRecovery.handoff.value) {
        providerHandoffRecovery.stop();
      }
    }
    return;
  }

  if (currentChannel.status?.id !== EWorkerStatus.error) {
    return;
  }

  // A durable handoff has the stronger source-session proof and owns the
  // recovery dialog. This local context is only the fallback for migrations
  // that do not expose a provider-handoff record.
  if (providerHandoffRecovery.handoff.value) {
    isLocalMigrationRecoveryVisible.value = false;
    return;
  }

  providerHandoffRecovery.stop();
  isLocalMigrationRecoveryVisible.value = true;
}

async function resumeLocalMigrationRollback() {
  const context = migrationRollbackContext.restore();
  if (!context) return;

  const currentChannel = await channelsStore.getWorkerById(context.workerId);
  if (!currentChannel) return;

  const sourceProvider = workerTypeToWhatsappProvider(
    context.previousWorkerType
  );
  const targetProvider = workerTypeToWhatsappProvider(currentChannel.type?.id);
  if (
    sourceProvider &&
    targetProvider &&
    sourceProvider !== targetProvider &&
    isWhatsappProviderHandoffTargetOnline(currentChannel, targetProvider)
  ) {
    // A durable local rollback marker may survive a completed provider
    // migration. The connected target projection is authoritative on reload;
    // do not resurrect its recovery dialog or request the stale handoff.
    migrationRollbackContext.clear({
      workerId: context.workerId,
      lifecycleOperationId: context.lifecycleOperationId,
    });
    isLocalMigrationRecoveryVisible.value = false;
    return;
  }
  if (
    context.previousSessionStorage === EWorkerSessionStorage.postgres &&
    currentChannel.lifecycle_operation_id === context.lifecycleOperationId &&
    sourceProvider &&
    targetProvider &&
    sourceProvider !== targetProvider
  ) {
    providerHandoffRecovery.start({
      workerId: context.workerId,
      lifecycleOperationId: context.lifecycleOperationId,
      sourceProvider,
      targetProvider,
      targetWorkerType: currentChannel.type?.id as EWorkerType,
      origin: 'resumed',
    });
  }

  await reconcileLocalMigrationRollback();
}

async function restoreLocalMigration() {
  const context = localMigrationRollback.value;
  if (!context || !canReturnLocalMigration.value) return;

  localMigrationRecoveryAction.value = 'return';
  try {
    const currentChannel = await channelsStore.getWorkerById(context.workerId);
    if (!currentChannel) return;

    const result = await settingsStore.updateChannel({
      channel_id: context.workerId,
      name: currentChannel.name,
      worker_type: context.previousWorkerType,
      ...(context.previousServerId
        ? { server_id: context.previousServerId }
        : {}),
    });
    if (!result) return;

    if (isAcceptedLifecycleAck(result)) {
      migrationRollbackContext.capture({
        ...context,
        lifecycleOperationId: result.operation_id,
      });
    } else {
      migrationRollbackContext.clear({
        workerId: context.workerId,
        lifecycleOperationId: context.lifecycleOperationId,
      });
    }

    isLocalMigrationRecoveryVisible.value = false;
    await Promise.all([loadStatistics(), loadChannels()]);
    await resumeLocalMigrationRollback();
  } finally {
    localMigrationRecoveryAction.value = null;
  }
}

async function startLocalMigrationFreshSession() {
  const context = localMigrationRollback.value;
  if (!context) return;

  localMigrationRecoveryAction.value = 'discard';
  try {
    const reset = await channelsStore.resetConnectionChannel(context.workerId);
    if (!reset) return;

    migrationRollbackContext.clear({
      workerId: context.workerId,
      lifecycleOperationId: context.lifecycleOperationId,
    });
    isLocalMigrationRecoveryVisible.value = false;

    const currentChannel = await channelsStore.getWorkerById(context.workerId);
    if (currentChannel?.account?.id) {
      connectionChannel.value = currentChannel;
      connectionTargetType.value = currentChannel.type?.id as EWorkerType;
      isDialogConnectionChannelShow.value = false;
      await nextTick();
      isDialogConnectionChannelShow.value = true;
    }

    await Promise.all([loadStatistics(), loadChannels()]);
  } finally {
    localMigrationRecoveryAction.value = null;
  }
}

async function restoreSavedSourceServerAfterProviderReturn(
  handoffContext: WhatsappProviderHandoffMonitorContext
) {
  const context = localMigrationRollback.value;
  if (
    !context ||
    context.workerId !== handoffContext.workerId ||
    context.lifecycleOperationId !== handoffContext.lifecycleOperationId ||
    context.previousSessionStorage !== EWorkerSessionStorage.postgres ||
    !context.previousServerId
  ) {
    return;
  }

  const currentChannel = await channelsStore.getWorkerById(context.workerId);
  if (
    !currentChannel ||
    currentChannel.server?.id === context.previousServerId
  ) {
    migrationRollbackContext.clear({
      workerId: context.workerId,
      lifecycleOperationId: context.lifecycleOperationId,
    });
    return;
  }

  const result = await settingsStore.updateChannel({
    channel_id: context.workerId,
    name: currentChannel.name,
    worker_type: context.previousWorkerType,
    server_id: context.previousServerId,
  });
  if (!result) {
    isLocalMigrationRecoveryVisible.value = true;
    return;
  }

  if (isAcceptedLifecycleAck(result)) {
    migrationRollbackContext.capture({
      ...context,
      lifecycleOperationId: result.operation_id,
    });
    return;
  }

  migrationRollbackContext.clear({
    workerId: context.workerId,
    lifecycleOperationId: context.lifecycleOperationId,
  });
}

const providerHandoffRecovery = useWhatsappProviderHandoffRecovery({
  onRecoveryRequired: async () => {
    isLocalMigrationRecoveryVisible.value = false;
    isDialogConnectionChannelShow.value = false;
  },
  onSourceReturned: async (context) => {
    await restoreSavedSourceServerAfterProviderReturn(context);
    isDialogConnectionChannelShow.value = false;
    connectionChannel.value = null;
    connectionTargetType.value = null;
    await Promise.all([loadStatistics(), loadChannels()]);
  },
  onTargetReady: async (
    context: WhatsappProviderHandoffMonitorContext,
    { freshSession }
  ) => {
    const currentChannel = await channelsStore.getWorkerById(context.workerId);
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
      currentChannel.connection_online_acknowledged !== true;

    if (
      targetProvider !== context.targetProvider ||
      (freshSession ? !freshTargetReady : !retainedTargetReady)
    ) {
      return false;
    }

    migrationRollbackContext.clear({
      workerId: context.workerId,
      lifecycleOperationId: context.lifecycleOperationId,
    });
    isLocalMigrationRecoveryVisible.value = false;

    await Promise.all([loadStatistics(), loadChannels()]);

    if (freshSession) {
      connectionChannel.value = currentChannel;
      connectionTargetType.value = context.targetWorkerType;
      isDialogConnectionChannelShow.value = false;
      await nextTick();
      isDialogConnectionChannelShow.value = true;
    } else {
      // Release the protected projection only after the exact target provider
      // is acknowledged ONLINE. AppConnectChannel keeps a second local fence
      // so reactive watcher ordering cannot expose an intermediate surface.
      connectionChannel.value = currentChannel;
      connectionTargetType.value = context.targetWorkerType;
      connectionIsSessionMigration.value = false;
      connectionIsDestructiveReset.value = false;
      isDialogConnectionChannelShow.value = true;
    }

    return true;
  },
});

const providerHandoffTerminalStatuses = new Set<EWorkerStatus>([
  EWorkerStatus.error,
  EWorkerStatus.online,
  EWorkerStatus.disponible,
]);

const refreshProviderHandoffFromLifecyclePublication = (data: {
  worker_id: string;
  lifecycle_operation_id?: string;
  worker_status_id?: EWorkerStatus;
  worker_type_id?: EWorkerType | string;
  connection_status?: IBaileysConnectionState['connection_status'];
  connection_online_acknowledged?: boolean;
}) => {
  const active = providerHandoffRecovery.activeContext.value;
  if (!active || active.workerId !== data.worker_id) return;

  const belongsToActiveOperation =
    data.lifecycle_operation_id === active.lifecycleOperationId;
  const reachedTerminalState =
    data.worker_status_id !== undefined &&
    providerHandoffTerminalStatuses.has(data.worker_status_id);
  if (!belongsToActiveOperation && !reachedTerminalState) return;

  const canTreatAbsentHandoffAsTerminal =
    data.worker_status_id === EWorkerStatus.online ||
    data.worker_status_id === EWorkerStatus.disponible;
  const targetReady = isWhatsappProviderHandoffTargetOnline(
    {
      type: { id: data.worker_type_id },
      status: { id: data.worker_status_id },
      connection_status: data.connection_status,
      connection_online_acknowledged: data.connection_online_acknowledged,
    },
    active.targetProvider
  );

  void providerHandoffRecovery.refresh({
    terminal: canTreatAbsentHandoffAsTerminal,
    targetReady,
    // Preserve an exact terminal publication that arrives while the initial
    // handoff snapshot is still in flight. The composable coalesces one
    // replay; no timer or background polling is introduced.
    replayIfInFlight: reachedTerminalState,
  });
  if (data.worker_status_id === EWorkerStatus.error) {
    void reconcileLocalMigrationRollback();
  }
};

const refreshProviderHandoffFromTargetProjection = (
  currentChannels: ListChannelsResponse[]
) => {
  const active = providerHandoffRecovery.activeContext.value;
  if (!active) return;

  const currentChannel = currentChannels.find(
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

  // Reconcile the terminal snapshot from the exact connected target shown by
  // the list when the earlier lifecycle publication raced the native ACK.
  void providerHandoffRecovery.refresh({
    terminal: true,
    targetReady: true,
    replayIfInFlight: true,
  });
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
  lifecycle_operation_id?: string;
  debug_trace_id?: string;
  connection_strategy?: EWorkerConnectionStrategy;
}) => {
  await loadStatistics();
  await loadChannels();

  if (!data.worker_type || !data.lifecycle_operation_id) {
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
  const routingChanged = providerChanged || serverChanged;

  if (
    !routingChanged ||
    !data.previous_worker_type ||
    !data.previous_session_storage
  ) {
    return;
  }

  const currentChannel = await channelsStore.getWorkerById(data.worker_id);
  if (currentChannel?.account?.id) {
    isDialogConnectionChannelShow.value = false;
    await nextTick();
    connectionChannel.value = currentChannel;
    connectionTargetType.value = data.worker_type;
    connectionSourceType.value = data.previous_worker_type;
    connectionSourceServerName.value = data.previous_server_name ?? null;
    connectionTargetServerName.value = data.server_name ?? null;
    connectionIsDestructiveReset.value =
      data.connection_strategy === EWorkerConnectionStrategy.fresh ||
      data.previous_session_storage === EWorkerSessionStorage.legacy_volume;
    connectionIsSessionMigration.value =
      !connectionIsDestructiveReset.value &&
      data.previous_session_storage === EWorkerSessionStorage.postgres;
    isDialogConnectionChannelShow.value = true;
  }

  if (data.connection_strategy === EWorkerConnectionStrategy.fresh) {
    migrationRollbackContext.clear({
      workerId: data.worker_id,
      lifecycleOperationId: data.lifecycle_operation_id,
    });
    return;
  }

  migrationRollbackContext.capture({
    workerId: data.worker_id,
    lifecycleOperationId: data.lifecycle_operation_id,
    previousWorkerType: data.previous_worker_type,
    previousServerId: data.previous_server_id,
    previousSessionStorage: data.previous_session_storage,
  });

  if (
    data.previous_session_storage === EWorkerSessionStorage.postgres &&
    providerChanged &&
    sourceProvider &&
    targetProvider
  ) {
    providerHandoffRecovery.start({
      workerId: data.worker_id,
      lifecycleOperationId: data.lifecycle_operation_id,
      sourceProvider,
      targetProvider,
      targetWorkerType: data.worker_type,
      debugTraceId: data.debug_trace_id,
      origin: 'initiated',
    });
  }

  await reconcileLocalMigrationRollback();
};

watch(
  channels,
  (currentChannels) => {
    void reconcileLocalMigrationRollback();
    refreshProviderHandoffFromTargetProjection(currentChannels);
  },
  { deep: true }
);

watch(
  () => providerHandoffRecovery.handoff.value,
  (handoff) => {
    if (handoff) {
      isLocalMigrationRecoveryVisible.value = false;
    }
  }
);

const deleteChannel = async (id: string) => {
  try {
    const count = await settingsStore.checkChannelOpenConversations(id);

    if (count !== null && count > 0) {
      openConversationsCount.value = count;
      channelToDelete.value = id;
      isDialogDeleterShow.value = true;
      return;
    }

    openConversationsCount.value = null;
    channelToDelete.value = id;
    isDialogDeleterShow.value = true;
  } catch {
    openConversationsCount.value = null;
    channelToDelete.value = id;
    isDialogDeleterShow.value = true;
  }
};

const updateChannelFromCentrifugo = (
  data:
    | IBaileysConnectionState
    | IWorkerPayload
    | IConfigChannelsRecreateAllCompleted
    | {
        action: 'session_storage_migration';
        worker_id: string;
        migration: SessionStorageMigrationSummary;
      }
) => {
  if (
    data &&
    typeof data === 'object' &&
    'type' in data &&
    data.type === 'recreate_all_completed'
  ) {
    const payload = data as IConfigChannelsRecreateAllCompleted;
    const user = getUser();
    if (user?.account_id === payload.account_id) {
      settingsStore.showSnackbar(
        t('channels_recreate_all_success', {
          success: payload.success,
          errors: payload.errors,
        }),
        payload.errors > 0 ? EColor.warning : EColor.success
      );
      loadStatistics();
      loadChannels();
    }
    return;
  }

  if (
    'action' in data &&
    data.action === 'session_storage_migration' &&
    'migration' in data
  ) {
    syncMigrationSummary(data.worker_id, data.migration);
    return;
  }

  if ('action' in data) {
    const payload = data as IWorkerPayload;
    refreshProviderHandoffFromLifecyclePublication(payload);

    if (
      payload.action === EWorkerAction.delete ||
      payload.action === EWorkerAction.recreate
    ) {
      loadStatistics();
      loadChannels();
    }
    return;
  }

  const connectionState = data as IBaileysConnectionState;
  refreshProviderHandoffFromLifecyclePublication(connectionState);
  const channelIndex = channels.value.findIndex(
    (ch) => ch.id === connectionState.worker_id
  );

  if (channelIndex !== -1) {
    loadChannels();
    return;
  }

  const selectedStatus = options.value.status;
  const canEnterSelectedStatus =
    connectionState.worker_status_id === selectedStatus ||
    (selectedStatus === EWorkerStatus.connecting &&
      connectionState.worker_status_id === EWorkerStatus.recreating &&
      connectionState.recreate_phase === EWorkerRecreatePhase.connecting);

  if (canEnterSelectedStatus) {
    loadChannels();
  }
};

useResilientCentrifugoSubscription({
  channel: channelsConfigCentrifugo(),
  handler: updateChannelFromCentrifugo,
  acknowledgeRecoveryAfterSubscribed: true,
  onSubscribed: async () => {
    // Publications emitted while the browser was offline may no longer be in
    // the recovery window. Reconcile from the authoritative database every
    // time the subscription becomes healthy again.
    await Promise.all([loadStatistics(), loadChannels()]);
    await reconcileLocalMigrationRollback();
    await providerHandoffRecovery.refresh();
  },
  debugContext: () => ({
    surface: 'config.channels',
  }),
});

onMounted(async () => {
  await loadAccounts();
  await loadStatistics();
  await loadChannels();
  await resumeLocalMigrationRollback();
});
</script>

<template>
  <div>
    <VCard>
      <VCardTitle class="text-h6 pa-6 pb-4">
        {{ $t('channels') }}
      </VCardTitle>

      <VDivider />

      <VCardText>
        <div v-if="statistics" class="statistics-container mb-6">
          <VCard
            class="statistics-card statistics-card-large"
            elevation="2"
            variant="flat"
          >
            <VCardText class="pa-8 d-flex flex-column h-100">
              <div class="d-flex align-center justify-space-between mb-6">
                <div
                  class="statistics-icon-wrapper statistics-icon-wrapper-large"
                  :style="{
                    backgroundColor: `rgb(var(--v-theme-success))`,
                  }"
                >
                  <VIcon icon="tabler-circle-check" size="32" color="white" />
                </div>
                <VChip
                  color="success"
                  size="large"
                  variant="flat"
                  class="font-weight-bold"
                >
                  {{ (statistics as any).online?.percentage ?? 0 }}%
                </VChip>
              </div>

              <div class="text-h5 font-weight-bold mb-2">
                {{ t('channel_connected') }}
              </div>

              <div class="text-h1 font-weight-bold mb-4">
                {{ (statistics as any).online?.total ?? 0 }}
              </div>

              <div class="text-body-2 text-medium-emphasis mb-6">
                {{ t('channels') }}
              </div>

              <VDivider class="mb-6" />

              <div class="d-flex flex-column gap-4 mb-auto">
                <div class="d-flex align-center justify-space-between">
                  <div class="d-flex align-center gap-2">
                    <VIcon
                      icon="tabler-database"
                      size="20"
                      color="success"
                      class="opacity-75"
                    />
                    <span class="text-body-2 text-medium-emphasis">
                      {{ t('total') }}
                    </span>
                  </div>
                  <span class="text-body-1 font-weight-medium">
                    {{ (statistics as any).total ?? 0 }}
                  </span>
                </div>

                <div class="d-flex align-center justify-space-between">
                  <div class="d-flex align-center gap-2">
                    <VIcon
                      icon="tabler-user-check"
                      size="20"
                      color="info"
                      class="opacity-75"
                    />
                    <span class="text-body-2 text-medium-emphasis">
                      {{ t('awaiting_qr_code') }}
                    </span>
                  </div>
                  <span class="text-body-1 font-weight-medium">
                    {{ (statistics as any).disponible?.total ?? 0 }}
                  </span>
                </div>

                <div class="d-flex align-center justify-space-between">
                  <div class="d-flex align-center gap-2">
                    <VIcon
                      icon="tabler-circle-x"
                      size="20"
                      color="error"
                      class="opacity-75"
                    />
                    <span class="text-body-2 text-medium-emphasis">
                      {{ t('offline') }}
                    </span>
                  </div>
                  <span class="text-body-1 font-weight-medium">
                    {{ (statistics as any).offline?.total ?? 0 }}
                  </span>
                </div>
              </div>

              <div
                class="mt-auto pt-4 d-flex align-center justify-center"
                :style="{
                  backgroundColor: `rgba(var(--v-theme-success), 0.1)`,
                  borderRadius: '8px',
                  padding: '12px',
                }"
              >
                <VIcon
                  icon="tabler-trending-up"
                  size="20"
                  color="success"
                  class="mr-2"
                />
                <span class="text-body-2 font-weight-medium text-success">
                  {{ t('active_channels') }}
                </span>
              </div>
            </VCardText>
          </VCard>

          <VCard
            v-for="(stat, index) in [
              {
                key: 'disponible',
                label: t('awaiting_qr_code'),
                color: 'info',
                icon: 'tabler-user-check',
              },
              {
                key: 'new',
                label: t('new'),
                color: 'primary',
                icon: 'tabler-sparkles',
              },
              {
                key: 'offline',
                label: t('offline'),
                color: 'error',
                icon: 'tabler-circle-x',
              },
              {
                key: 'error',
                label: t('error'),
                color: 'error',
                icon: 'tabler-alert-circle',
              },
              {
                key: 'mismatched',
                label: t('mismatched'),
                color: 'warning',
                icon: 'tabler-alert-triangle',
              },
              {
                key: 'stopped',
                label: t('stopped'),
                color: 'warning',
                icon: 'tabler-player-pause',
              },
            ]"
            :key="index"
            class="statistics-card"
            elevation="2"
            variant="flat"
          >
            <VCardText class="pa-5">
              <div class="d-flex flex-column">
                <div class="d-flex align-center mb-3">
                  <div
                    class="statistics-icon-wrapper"
                    :style="{
                      backgroundColor: `rgb(var(--v-theme-${stat.color}))`,
                    }"
                  >
                    <VIcon :icon="stat.icon" size="18" color="white" />
                  </div>
                </div>
                <div class="text-body-1 text-medium-emphasis mb-2">
                  {{ stat.label }}
                </div>
                <div class="text-h4 font-weight-bold mb-4">
                  {{ (statistics as any)[stat.key]?.total ?? 0 }}
                </div>
                <VChip
                  :color="stat.color"
                  size="small"
                  variant="tonal"
                  class="align-self-start"
                >
                  {{ (statistics as any)[stat.key]?.percentage ?? 0 }}%
                </VChip>
              </div>
            </VCardText>
          </VCard>
        </div>

        <VDivider class="mb-4" />

        <div class="d-flex justify-space-between flex-wrap gap-4">
          <div class="d-flex gap-4 align-center">
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
              color="primary"
              variant="elevated"
              @click="isDialogRecreateAllShow = true"
            >
              {{ $t('recreate_all') }}
            </VBtn>
          </div>

          <div class="d-flex align-center flex-wrap gap-4">
            <div class="status-filter">
              <VLabel class="text-body-2 mb-1">{{ $t('account') }}:</VLabel>
              <AppSelectSearch
                v-model="options.account"
                :items="itemsAccount"
                :placeholder="$t('select_account')"
                :clearable="true"
                :loading="accountsLoading"
                item-value="id"
                item-title="text"
                @update:modelValue="options.page = 1"
              />
            </div>

            <div class="status-filter">
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
              <VLabel class="text-body-2 mb-1">
                {{ $t('session_storage') }}:
              </VLabel>
              <AppSelectSearch
                v-model="options.session_storage"
                :items="itemsSessionStorage"
                :placeholder="$t('select_session_storage')"
                :clearable="true"
                item-value="id"
                item-title="text"
                data-testid="config-channels-session-storage-filter"
                option-test-id-prefix="config-channels-session-storage-option"
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
              />
            </div>
          </div>
        </div>

        <VDivider class="my-4" />

        <div>
          <VDataTable
            class="channels-table"
            :headers="headers"
            :items="channels"
            :loading="loading || settingsStore.loading"
            :items-per-page="
              options.itemsPerPage === -1 ? total : options.itemsPerPage
            "
            :page="options.page"
            :server-items-length="total"
            @update:options="handleTableChange"
          >
            <template #item.name="{ item }">
              {{ item.name }}
            </template>

            <template #item.number="{ item }">
              <span v-if="item.number">
                {{ formatPhoneBR(item.number) }}
              </span>
              <span v-else>-</span>
            </template>

            <template #item.status="{ item }">
              <VChip
                v-if="item.status"
                :color="resolveStatusVariant(item).color"
                size="small"
              >
                {{ resolveStatusVariant(item).text }}
              </VChip>
              <span v-else>-</span>
            </template>

            <template #item.type="{ item }">
              <VChip
                v-if="item.type"
                :color="resolveTypeVariant(item.type.id).color"
                size="small"
              >
                {{ resolveTypeVariant(item.type.id).text }}
              </VChip>
              <span v-else>-</span>
            </template>

            <template #item.session_storage="{ item }">
              <SessionStorageBadge
                v-if="supportsWhatsappSessionStorage(item.type?.id)"
                :storage="item.session_storage"
              />
              <span v-else>-</span>
            </template>

            <template #item.account="{ item }">
              <span v-if="item.account">{{ item.account.name }}</span>
              <span v-else>-</span>
            </template>

            <template #item.server="{ item }">
              <span v-if="item.server">{{ item.server.name }}</span>
              <span v-else>-</span>
            </template>

            <template #item.connection_date="{ item }">
              <span v-if="item.connection_date">
                {{ formatDateTime(item.connection_date) }}
              </span>
              <span v-else>-</span>
            </template>

            <template #item.last_connection_check_at="{ item }">
              <span v-if="item.last_connection_check_at">
                {{ formatDateTime(item.last_connection_check_at) }}
              </span>
              <span v-else>-</span>
            </template>

            <template #item.updated_at="{ item }">
              <span v-if="item.updated_at">
                {{ formatDateTime(item.updated_at) }}
              </span>
              <span v-else>-</span>
            </template>

            <template #item.created_at="{ item }">
              <span v-if="item.created_at">
                {{ formatDateTime(item.created_at) }}
              </span>
              <span v-else>-</span>
            </template>

            <template #item.actions="{ item }">
              <div class="d-flex gap-1">
                <IconBtn
                  v-if="migrationAction(item)"
                  color="info"
                  data-testid="config-channel-session-migration-action"
                  @click.stop="openMigrationDialog(item)"
                >
                  <VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>
                      {{
                        migrationAction(item) === 'migrate'
                          ? $t('migrate_session')
                          : migrationAction(item) === 'cleanup'
                            ? $t('delete_legacy_volume')
                            : $t('follow_migration')
                      }}
                    </span>
                  </VTooltip>
                  <VIcon
                    :icon="
                      migrationAction(item) === 'cleanup'
                        ? 'tabler-trash-x'
                        : migrationAction(item) === 'follow'
                          ? 'tabler-progress-check'
                          : 'tabler-database-export'
                    "
                  />
                </IconBtn>

                <IconBtn>
                  <VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('edit_channel') }}</span>
                  </VTooltip>
                  <VIcon icon="tabler-edit" @click="openEditDialog(item)" />
                </IconBtn>

                <IconBtn
                  v-if="canViewConnectionHealth(item)"
                  :aria-label="$t('connection_health_action')"
                  :data-testid="`config-channel-connection-health-${item.id}`"
                  @click.stop="openConnectionHealthDialog(item.id)"
                >
                  <VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('connection_health_action') }}</span>
                  </VTooltip>
                  <VIcon icon="tabler-heartbeat" />
                </IconBtn>

                <IconBtn v-if="item.type?.id !== EWorkerType.whatsapp">
                  <VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('recreate') }}</span>
                  </VTooltip>
                  <VIcon icon="tabler-refresh" @click="recreateChannel(item)" />
                </IconBtn>

                <IconBtn @click.stop="deleteChannel(item.id)">
                  <VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('delete') }}</span>
                  </VTooltip>
                  <VIcon icon="tabler-trash" />
                </IconBtn>
              </div>
            </template>

            <template #bottom>
              <TablePagination
                v-if="options.itemsPerPage !== -1"
                v-model:page="options.page"
                :items-per-page="options.itemsPerPage"
                :total-items="total"
              />
            </template>
          </VDataTable>
        </div>
      </VCardText>
    </VCard>

    <VSnackbar
      v-model="settingsStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="settingsStore.snackbar.color"
    >
      {{ settingsStore.snackbar.message }}
    </VSnackbar>

    <VDialogHandler
      v-model="isDialogDeleterShow"
      :title="$t('delete') + ' ' + $t('channel')"
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

    <AppChannelConnectionStrategyDialog
      v-model="isDialogRecreatorShow"
      mode="recreate"
      :loading="settingsStore.loading"
      standard-appearance
      @select="handleRecreate"
    />

    <VDialogHandler
      v-model="isDialogRecreateAllShow"
      :title="$t('recreate_all')"
      :message="$t('recreate_all_channels_confirmation')"
      @confirm="handleRecreateAll"
    />

    <AppEditConfigChannel
      v-if="isDialogEditChannelShow"
      v-model="isDialogEditChannelShow"
      :channel="channelToEdit"
      standard-appearance
      @updated="handleChannelUpdated"
    />

    <AppLogsChannel
      v-if="isConnectionHealthDialogVisible"
      v-model="isConnectionHealthDialogVisible"
      :channel-id="connectionHealthChannelId"
      scope="config"
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
      standard-appearance
      @update:model-value="$event || providerHandoffRecovery.dismissDialog()"
      @return="providerHandoffRecovery.resolve('return')"
      @discard="providerHandoffRecovery.resolve('discard')"
      @retry="providerHandoffRecovery.retry()"
    />

    <ChannelProviderHandoffRecoveryDialog
      v-else-if="
        isLocalMigrationRecoveryVisible && localMigrationRollback !== null
      "
      :model-value="isLocalMigrationRecoveryVisible"
      :source-provider="localMigrationSourceProvider"
      :target-provider="
        localMigrationTargetProvider || localMigrationSourceProvider
      "
      :reference-code="localMigrationRollback.lifecycleOperationId"
      error-code="migration_lifecycle_failed"
      recovery-state="blocked"
      :source-revision-preserved="
        localMigrationRollback.previousSessionStorage ===
        EWorkerSessionStorage.postgres
      "
      :source-runtime-restored="false"
      :can-return="canReturnLocalMigration"
      :show-return="canReturnLocalMigration"
      :can-discard="true"
      :loading-action="localMigrationRecoveryAction"
      standard-appearance
      @update:model-value="isLocalMigrationRecoveryVisible = $event"
      @return="restoreLocalMigration"
      @discard="startLocalMigrationFreshSession"
    />

    <AppConnectChannel
      v-if="isDialogConnectionChannelShow && connectionChannel?.account?.id"
      v-model="isDialogConnectionChannelShow"
      :channel-id="connectionChannel.id"
      :channel-type="connectionTargetType ?? connectionChannel.type?.id ?? null"
      :migration-source-type="connectionSourceType"
      :migration-source-server-name="connectionSourceServerName"
      :migration-target-server-name="connectionTargetServerName"
      :account-id="connectionChannel.account.id"
      :initial-status-id="connectionChannel.status?.id ?? null"
      :initial-phone="connectionChannel.number"
      :initial-connection-status="connectionChannel.connection_status ?? null"
      :initial-connection-status-source-id="
        connectionChannel.connection_status_source_id ?? null
      "
      :initial-connection-status-order="
        connectionChannel.connection_status_order ?? null
      "
      :initial-connection-online-acknowledged="
        connectionChannel.connection_online_acknowledged === true
      "
      :is-session-migration="connectionIsSessionMigration"
      :is-destructive-reset="connectionIsDestructiveReset"
      standard-appearance
    />

    <LegacySessionMigrationDialog
      v-model="isMigrationDialogVisible"
      :channel="migrationChannel"
      :migration="migrationSummary"
      :loading="migrationLoading"
      @start="startLegacySessionMigration"
      @delete-volume="deleteLegacyMigrationVolume"
      @keep-volume="isMigrationDialogVisible = false"
    />
  </div>
</template>

<style lang="scss" scoped>
.status-filter {
  inline-size: 12rem;
}

.statistics-container {
  display: grid;
  grid-template-columns: 1.5fr 1fr 1fr 1fr;
  grid-auto-rows: minmax(150px, auto);
  gap: 1.5rem;
  align-items: stretch;
}

.statistics-card-large {
  grid-column: 1;
  grid-row: 1 / 3;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.statistics-card-large :deep(.v-card-text) {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.statistics-card:not(.statistics-card-large):nth-child(2) {
  grid-column: 2;
  grid-row: 1;
}

.statistics-card:not(.statistics-card-large):nth-child(3) {
  grid-column: 3;
  grid-row: 1;
}

.statistics-card:not(.statistics-card-large):nth-child(4) {
  grid-column: 4;
  grid-row: 1;
}

.statistics-card:not(.statistics-card-large):nth-child(5) {
  grid-column: 2;
  grid-row: 2;
}

.statistics-card:not(.statistics-card-large):nth-child(6) {
  grid-column: 3;
  grid-row: 2;
}

.statistics-card:not(.statistics-card-large):nth-child(7) {
  grid-column: 4;
  grid-row: 2;
}

.statistics-card {
  transition: all 0.3s ease;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }
}

.statistics-card :deep(.v-card-text) {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.statistics-icon-wrapper {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.statistics-icon-wrapper-large {
  width: 64px;
  height: 64px;
  border-radius: 12px;
}

.invoice-list-filter {
  inline-size: 20rem;
}

.channels-table {
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
