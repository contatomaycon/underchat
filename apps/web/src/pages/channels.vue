<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EColor } from '@core/common/enums/EColor';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { EWorkerPermissions } from '@core/common/enums/EPermissions/worker';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { useDashboardStore } from '@/@webcore/stores/dashboard';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { getUser } from '@/@webcore/localStorage/user';
import { DataTableHeader } from 'vuetify';
import { ListWorkerResponse } from '@core/schema/worker/listWorker/response.schema';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import {
  fetchRecentHistoryAndProcess,
  onMessage,
  unsubscribe,
} from '@/@webcore/centrifugo';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { ICreateWorkerResponse } from '@core/common/interfaces/ICreateWorkerResponse';
import { ConnectWhatsappEmbeddedResponse } from '@core/schema/worker/connectWhatsappEmbedded/response.schema';
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

const { t } = useI18n();
const channelsStore = useChannelsStore();
const dashboardStore = useDashboardStore();
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
  { id: EWorkerStatus.disponible, text: t('disponible') },
  { id: EWorkerStatus.offline, text: t('offline') },
  { id: EWorkerStatus.online, text: t('online') },
  { id: EWorkerStatus.new, text: t('new') },
  { id: EWorkerStatus.creating, text: t('creating') },
  { id: EWorkerStatus.error, text: t('error') },
  { id: EWorkerStatus.mismatched, text: t('mismatched') },
  { id: EWorkerStatus.stopped, text: t('stopped') },
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

const isDialogDisconnectOfficialShow = ref(false);
const channelToDisconnectOfficial = ref<string | null>(null);
const reconnectingWhatsappOfficialId = ref<string | null>(null);
type DisconnectOfficialProgressResult = 'success' | 'warning' | null;
type DisconnectOfficialProgressStepStatus =
  'pending' | 'running' | 'done' | 'warning';
const isDisconnectOfficialProgressShow = ref(false);
const isDisconnectOfficialRunning = ref(false);
const disconnectOfficialProgressResult =
  ref<DisconnectOfficialProgressResult>(null);
const disconnectOfficialProgressWarning = ref<string | null>(null);

const isDialogRecreatorShow = ref(false);
const channelToRecreate = ref<string | null>(null);

const isDialogEditChannelShow = ref(false);
const isAddChannelVisible = ref(false);
const channelToEdit = ref<string | null>(null);

const channelConnectionChannel = ref<string | null>(null);
const channelConnectionType = ref<string | null>(null);
const channelConnectionStatus = ref<string | null>(null);
const channelConnectionPhone = ref<string | null>(null);
const channelConnectionDebugTraceId = ref<string | null>(null);
const isDialogConnectionChannelShow = ref(false);
const workerStatusOffsets = new Map<string, number>();

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
    channelConnectionType.value ??
    currentConnectionChannel.value?.type?.id ??
    null
);

const currentConnectionChannelStatus = computed(
  () =>
    channelConnectionStatus.value ??
    currentConnectionChannel.value?.status?.id ??
    null
);

const currentConnectionChannelPhone = computed(
  () => currentConnectionChannel.value?.number ?? channelConnectionPhone.value
);

const channelConnectionLogs = ref<string | null>(null);
const isDialogConnectionLogsShow = ref(false);

const channelConfig = ref<string | null>(null);
const isDialogConfigChannelShow = ref(false);

const resolveStatusVariant = (s: string | undefined | null) => {
  if (s === EWorkerStatus.disponible)
    return { color: EColor.warning, text: t('disponible') };
  if (s === EWorkerStatus.offline)
    return { color: EColor.error, text: t('offline') };
  if (s === EWorkerStatus.online)
    return { color: EColor.success, text: t('online') };
  if (s === EWorkerStatus.new) return { color: EColor.info, text: t('new') };
  if (s === EWorkerStatus.creating)
    return { color: EColor.warning, text: t('creating') };
  if (s === EWorkerStatus.deleting)
    return { color: EColor.error, text: t('deleting') };
  if (s === EWorkerStatus.delete)
    return { color: EColor.info, text: t('delete') };
  if (s === EWorkerStatus.recreating)
    return { color: EColor.info, text: t('recreating') };
  if (s === EWorkerStatus.error)
    return { color: EColor.error, text: t('error') };
  if (s === EWorkerStatus.mismatched)
    return { color: EColor.error, text: t('mismatched') };
  if (s === EWorkerStatus.stopped)
    return { color: EColor.warning, text: t('stopped') };

  return { color: EColor.primary, text: t('unknown') };
};

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
  if (isRecreateCooldownActive(channel)) {
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
  if (channel.type?.id === EWorkerType.whatsapp) {
    return;
  }

  const debugTraceId = isConnectionLifecycleDebugEnabled()
    ? createConnectionLifecycleDebugTraceId('web_connection_dialog')
    : undefined;
  channelConnectionChannel.value = channel.id;
  channelConnectionType.value = channel.type?.id ?? null;
  channelConnectionStatus.value = channel.status?.id ?? null;
  channelConnectionPhone.value = channel.number ?? null;
  channelConnectionDebugTraceId.value = debugTraceId ?? null;
  logConnectionLifecycleDebug('web.connection_dialog.open', {
    trace_id: debugTraceId,
    layer: 'web',
    worker_id: channel.id,
    worker_type_id: channel.type?.id,
    status: channel.status?.id,
  });
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

const isWhatsappOfficialChannel = (channel: ListWorkerResponse) =>
  channel.type?.id === EWorkerType.whatsapp;

const isWhatsappOfficialOnline = (channel: ListWorkerResponse) =>
  isWhatsappOfficialChannel(channel) &&
  channel.status?.id === EWorkerStatus.online;

const isWhatsappOfficialReconnectable = (channel: ListWorkerResponse) =>
  isWhatsappOfficialChannel(channel) &&
  channel.status?.id !== EWorkerStatus.online;

const disconnectOfficialProgressSteps = computed<
  Array<{
    key: string;
    text: string;
    status: DisconnectOfficialProgressStepStatus;
  }>
>(() => {
  const isFinished = disconnectOfficialProgressResult.value !== null;

  return [
    {
      key: 'meta',
      text: t('whatsapp_official_disconnect_progress_meta'),
      status: isDisconnectOfficialRunning.value
        ? 'running'
        : disconnectOfficialProgressResult.value === 'warning'
          ? 'warning'
          : isFinished
            ? 'done'
            : 'pending',
    },
    {
      key: 'underchat',
      text: t('whatsapp_official_disconnect_progress_underchat'),
      status: isFinished ? 'done' : 'pending',
    },
  ];
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

const handleRecreate = async () => {
  if (!channelToRecreate.value) return;

  const debugTraceId = isConnectionLifecycleDebugEnabled()
    ? createConnectionLifecycleDebugTraceId('web_recreate_confirm')
    : undefined;

  await channelsStore.recreateChannel(channelToRecreate.value, {
    debugTraceId,
  });

  channelToRecreate.value = null;
};

const handleChannelCreated = async (
  data: ICreateWorkerResponse | ConnectWhatsappEmbeddedResponse
) => {
  await channelsStore.listChannels(query.value);

  if (data.worker_type_id === EWorkerType.whatsapp) {
    return;
  }

  const createdWorker = data as ICreateWorkerResponse;
  const currentChannel =
    channelsStore.list.find(
      (channel) => channel.id === createdWorker.worker_id
    ) ?? (await channelsStore.getWorkerById(createdWorker.worker_id));

  channelConnectionChannel.value = createdWorker.worker_id;
  channelConnectionType.value =
    currentChannel?.type?.id ?? createdWorker.worker_type_id;
  channelConnectionStatus.value =
    currentChannel?.status?.id ??
    createdWorker.worker_status_id ??
    EWorkerStatus.creating;
  channelConnectionPhone.value = currentChannel?.number ?? null;
  channelConnectionDebugTraceId.value = createdWorker.debug_trace_id ?? null;
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
};

const handleChannelUpdated = async (data: {
  worker_id: string;
  worker_type?: EWorkerType;
  account_id?: string;
  lifecycle_operation_id?: string;
  debug_trace_id?: string;
}) => {
  await channelsStore.listChannels(query.value);

  if (!data.worker_type) {
    return;
  }

  channelConnectionChannel.value = data.worker_id;
  channelConnectionType.value = data.worker_type;
  channelConnectionStatus.value = EWorkerStatus.recreating;
  channelConnectionPhone.value = null;
  channelConnectionDebugTraceId.value =
    data.debug_trace_id ??
    (isConnectionLifecycleDebugEnabled()
      ? createConnectionLifecycleDebugTraceId('web_channel_updated')
      : null);
  logConnectionLifecycleDebug('web.connection_dialog.open_after_update', {
    trace_id: channelConnectionDebugTraceId.value ?? undefined,
    layer: 'web',
    worker_id: data.worker_id,
    account_id: data.account_id,
    worker_type_id: data.worker_type,
    lifecycle_operation_id: data.lifecycle_operation_id,
    status: channelConnectionStatus.value ?? undefined,
  });
  isDialogConnectionChannelShow.value = true;
};

watch(
  query,
  async (q) => {
    await channelsStore.listChannels(q);
  },
  { immediate: true, deep: true }
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
    channelConnectionStatus.value = null;
    channelConnectionPhone.value = null;
    channelConnectionDebugTraceId.value = null;
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

  const applied = channelsStore.updateStatusChannel(data);
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
    return;
  }

  const channel = channelsStore.list.find(
    (item) => item.account?.id === data.account_id && item.id === data.worker_id
  );
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

  if (
    data.worker_id === channelConnectionChannel.value &&
    data.worker_status_id
  ) {
    channelConnectionStatus.value = data.worker_status_id;
  }

  if (
    data.worker_id === channelConnectionChannel.value &&
    data.worker_type_id
  ) {
    channelConnectionType.value = data.worker_type_id;
  }
};

onMounted(async () => {
  if (user?.account_id) {
    const channel = workerCentrifugoQueue(user.account_id);
    await onMessage(channel, workerStatusHandler);
    await fetchRecentHistoryAndProcess(channel, workerStatusHandler);
  }
});

onUnmounted(async () => {
  if (user?.account_id) {
    await unsubscribe(
      workerCentrifugoQueue(user.account_id),
      workerStatusHandler
    );
  }
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
                :color="resolveStatusVariant(item?.status?.id).color"
                size="small"
                :data-testid="`channel-status-${item.id}`"
              >
                {{ resolveStatusVariant(item?.status?.id).text }}
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
              <span>{{ item.server?.name }}</span>
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

                <IconBtn v-if="$canPermission(permissionsViewLogs)"
                  ><VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('worker_logs_connection') }}</span> </VTooltip
                  ><VIcon
                    icon="tabler-logs"
                    @click="openConnectionLogDialog(item.id)"
                /></IconBtn>

                <VTooltip
                  v-if="
                    $canPermission(permissionsRecreate) &&
                    item.type?.id !== EWorkerType.whatsapp
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
        v-if="isDialogRecreatorShow"
        v-model="isDialogRecreatorShow"
        :title="$t('recreate_channel')"
        :message="$t('recreate_channel_confirmation')"
        @confirm="handleRecreate"
      />

      <VDialogHandler
        v-if="isDialogDisconnectOfficialShow"
        v-model="isDialogDisconnectOfficialShow"
        :title="$t('disconnect_whatsapp_official')"
        :message="$t('disconnect_whatsapp_official_confirmation')"
        @confirm="handleDisconnectWhatsappOfficial"
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
                    ? $t('whatsapp_official_disconnect_progress_meta')
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

      <AppAddChannel
        v-if="isAddChannelVisible"
        v-model="isAddChannelVisible"
        @created="handleChannelCreated"
      />

      <AppConnectChannel
        v-if="isDialogConnectionChannelShow && user?.account_id"
        v-model="isDialogConnectionChannelShow"
        :channel-id="channelConnectionChannel"
        :channel-type="currentConnectionChannelType"
        :account-id="user.account_id"
        :initial-status-id="currentConnectionChannelStatus"
        :initial-phone="currentConnectionChannelPhone"
        :debug-trace-id="channelConnectionDebugTraceId"
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
