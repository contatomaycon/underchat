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
]);

const isDialogDeleterShow = ref(false);
const channelToDelete = ref<string | null>(null);
const openConversationsCount = ref<number | null>(null);

const isDialogRecreatorShow = ref(false);
const channelToRecreate = ref<string | null>(null);

const isDialogEditChannelShow = ref(false);
const isAddChannelVisible = ref(false);
const channelToEdit = ref<string | null>(null);

const channelConnectionChannel = ref<string | null>(null);
const channelConnectionType = ref<string | null>(null);
const channelConnectionStatus = ref<string | null>(null);
const channelConnectionPhone = ref<string | null>(null);
const isDialogConnectionChannelShow = ref(false);
const workerStatusOffsets = new Map<string, number>();

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

const recreateChannel = async (id: string) => {
  channelToRecreate.value = id;
  isDialogRecreatorShow.value = true;
};

const openEditDialog = (id: string) => {
  channelToEdit.value = id;
  isDialogEditChannelShow.value = true;
};

const openConnectionDialog = (channel: ListWorkerResponse) => {
  channelConnectionChannel.value = channel.id;
  channelConnectionType.value = channel.type?.id ?? null;
  channelConnectionStatus.value = channel.status?.id ?? null;
  channelConnectionPhone.value = channel.number ?? null;
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

const handleRecreate = async () => {
  if (!channelToRecreate.value) return;

  await channelsStore.recreateChannel(channelToRecreate.value);

  channelToRecreate.value = null;
};

const handleChannelCreated = async (data: ICreateWorkerResponse) => {
  await channelsStore.listChannels(query.value);

  const currentChannel =
    channelsStore.list.find((channel) => channel.id === data.worker_id) ??
    (await channelsStore.getWorkerById(data.worker_id));

  channelConnectionChannel.value = data.worker_id;
  channelConnectionType.value = currentChannel?.type?.id ?? data.worker_type_id;
  channelConnectionStatus.value =
    currentChannel?.status?.id ??
    data.worker_status_id ??
    EWorkerStatus.creating;
  channelConnectionPhone.value = currentChannel?.number ?? null;
  isDialogConnectionChannelShow.value = true;
};

const handleChannelUpdated = async (data: {
  worker_id: string;
  worker_type?: EWorkerType;
}) => {
  await channelsStore.listChannels(query.value);

  if (!data.worker_type) {
    return;
  }

  channelConnectionChannel.value = data.worker_id;
  channelConnectionType.value = data.worker_type;
  channelConnectionStatus.value = EWorkerStatus.recreating;
  channelConnectionPhone.value = null;
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

watch(isDialogConnectionChannelShow, (isOpen) => {
  if (!isOpen) {
    channelConnectionChannel.value = null;
    channelConnectionType.value = null;
    channelConnectionStatus.value = null;
    channelConnectionPhone.value = null;
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
  if (!shouldProcessWorkerStatusEvent(data, ctx)) {
    return;
  }

  channelsStore.updateStatusChannel(data);
  if (
    data.worker_id === channelConnectionChannel.value &&
    data.worker_status_id
  ) {
    channelConnectionStatus.value = data.worker_status_id;
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

                <IconBtn v-if="$canPermission(permissionsRecreate)"
                  ><VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('recreate_channel') }}</span> </VTooltip
                  ><VIcon
                    icon="tabler-refresh"
                    @click="recreateChannel(item.id)"
                /></IconBtn>

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
        :channel-type="channelConnectionType"
        :account-id="user.account_id"
        :initial-status-id="channelConnectionStatus"
        :initial-phone="channelConnectionPhone"
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
