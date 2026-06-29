<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { refDebounced } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import { useDashboardStore } from '@/@webcore/stores/dashboard';
import { useSettingsStore } from '@/@webcore/stores/settings';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { DataTableHeader } from 'vuetify';
import { ListChannelsResponse } from '@core/schema/config/listChannels/response.schema';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import { EColor } from '@core/common/enums/EColor';
import TablePagination from '@/@webcore/components/TablePagination.vue';
import { onMessage, unsubscribe } from '@/@webcore/centrifugo';
import { channelsConfigCentrifugo } from '@core/common/functions/centrifugoQueue';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { IConfigChannelsRecreateAllCompleted } from '@core/common/interfaces/IConfigChannelsRecreateAllCompleted';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { getUser } from '@/@webcore/localStorage/user';
import VDialogHandler from '@/components/VDialogHandler.vue';
import { ChannelsStatisticsResponse } from '@core/schema/config/channelsStatistics/response.schema';

const { t } = useI18n();
const dashboardStore = useDashboardStore();
const settingsStore = useSettingsStore();
useSnackbarCleanup(settingsStore);

const loading = ref(false);
const channels = ref<ListChannelsResponse[]>([]);
const total = ref(0);
const statistics = ref<ChannelsStatisticsResponse | null>(null);

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
]);

const itemsStatus = ref([
  { id: EWorkerStatus.disponible, text: t('disponible') },
  { id: EWorkerStatus.offline, text: t('offline') },
  { id: EWorkerStatus.online, text: t('online') },
  { id: EWorkerStatus.new, text: t('new') },
  { id: EWorkerStatus.creating, text: t('creating') },
  { id: EWorkerStatus.error, text: t('error') },
  { id: EWorkerStatus.mismatched, text: t('mismatched') },
  { id: EWorkerStatus.deleting, text: t('deleting') },
  { id: EWorkerStatus.recreating, text: t('recreating') },
  { id: EWorkerStatus.stopped, text: t('stopped') },
]);

const itemsType = ref([
  { id: EWorkerType.baileys, text: t('unofficial_socket') },
  { id: EWorkerType.wwebjs, text: t('unofficial_browser') },
  { id: EWorkerType.whatsmeow, text: t('unofficial_whatsmeow') },
  { id: EWorkerType.whatsapp, text: t('official') },
]);

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
  if (s === EWorkerStatus.error)
    return { color: EColor.error, text: t('error') };
  if (s === EWorkerStatus.mismatched)
    return { color: EColor.error, text: t('mismatched') };
  if (s === EWorkerStatus.deleting)
    return { color: EColor.error, text: t('deleting') };
  if (s === EWorkerStatus.recreating)
    return { color: EColor.info, text: t('recreating') };
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

const headers: DataTableHeader<ListChannelsResponse>[] = [
  { title: t('name'), key: 'name' },
  { title: t('number'), key: 'number' },
  { title: t('status'), key: 'status' },
  { title: t('type'), key: 'type' },
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

const channelToRecreate = ref<string | null>(null);
const isDialogRecreatorShow = ref(false);
const isDialogRecreateAllShow = ref(false);

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

const recreateChannel = (id: string) => {
  channelToRecreate.value = id;
  isDialogRecreatorShow.value = true;
};

const openEditDialog = (channel: ListChannelsResponse) => {
  channelToEdit.value = channel;
  isDialogEditChannelShow.value = true;
};

const handleRecreate = async () => {
  if (!channelToRecreate.value) return;

  const result = await settingsStore.recreateChannel(channelToRecreate.value);
  if (result) {
    await loadChannels();
  }

  channelToRecreate.value = null;
};

const handleRecreateAll = async () => {
  const result = await settingsStore.recreateChannelsAll({
    status: query.value.status ?? undefined,
    type: query.value.type ?? undefined,
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

const handleChannelUpdated = async () => {
  await loadStatistics();
  await loadChannels();
};

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

  if ('action' in data) {
    const payload = data as IWorkerPayload;

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
  const channelIndex = channels.value.findIndex(
    (ch) => ch.id === connectionState.worker_id
  );

  if (channelIndex !== -1) {
    loadChannels();
  }
};

onMounted(async () => {
  await loadAccounts();
  await loadStatistics();
  await loadChannels();

  await onMessage(
    channelsConfigCentrifugo(),
    (
      data:
        | IBaileysConnectionState
        | IWorkerPayload
        | IConfigChannelsRecreateAllCompleted
    ) => {
      updateChannelFromCentrifugo(data);
    }
  );
});

onUnmounted(async () => {
  await unsubscribe(channelsConfigCentrifugo());
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
                {{ t('online') }}
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
                      {{ t('disponible') }}
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
                label: t('disponible'),
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
                :color="resolveStatusVariant(item.status.id).color"
                size="small"
              >
                {{ resolveStatusVariant(item.status.id).text }}
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

                <IconBtn v-if="item.type?.id !== EWorkerType.whatsapp">
                  <VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('recreate') }}</span>
                  </VTooltip>
                  <VIcon
                    icon="tabler-refresh"
                    @click="recreateChannel(item.id)"
                  />
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

    <VDialogHandler
      v-model="isDialogRecreatorShow"
      :title="$t('recreate') + ' ' + $t('channel')"
      :message="$t('recreate_channel_confirmation')"
      @confirm="handleRecreate"
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
      @updated="handleChannelUpdated"
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
