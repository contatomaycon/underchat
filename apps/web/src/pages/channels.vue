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
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { getAdministrator } from '@/@webcore/localStorage/user';
import { DataTableHeader } from 'vuetify';
import { ListWorkerResponse } from '@core/schema/worker/listWorker/response.schema';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EWorkerPermissions.create_worker,
      EWorkerPermissions.update_worker,
      EWorkerPermissions.view_worker,
      EWorkerPermissions.delete_worker,
    ],
  },
});

const permissionsEdit = [
  EGeneralPermissions.full_access,
  EWorkerPermissions.update_worker,
];
const permissionsDelete = [
  EGeneralPermissions.full_access,
  EWorkerPermissions.delete_worker,
];
const permissionsCreate = [
  EGeneralPermissions.full_access,
  EWorkerPermissions.create_worker,
];
const permissionsViewLogs = [
  EGeneralPermissions.full_access,
  EWorkerPermissions.view_worker_logs,
];
const permissionsRecreate = [
  EGeneralPermissions.full_access,
  EWorkerPermissions.recreate_worker,
];

const { t } = useI18n();
const channelsStore = useChannelsStore();
const isAdministrator = getAdministrator();

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
  { id: EWorkerStatus.deleting, text: t('deleting') },
  { id: EWorkerStatus.recreating, text: t('recreating') },
  { id: EWorkerStatus.error, text: t('error') },
]);

const itemsType = ref([
  { id: '', text: t('all') },
  { id: EWorkerType.baileys, text: t('unofficial') },
]);

const isDialogDeleterShow = ref(false);
const channelToDelete = ref<string | null>(null);

const isDialogRecreatorShow = ref(false);
const channelToRecreate = ref<string | null>(null);

const isDialogEditChannelShow = ref(false);
const isAddChannelVisible = ref(false);
const channelToEdit = ref<string | null>(null);

const channelConnectionChannel = ref<string | null>(null);
const isDialogConnectionChannelShow = ref(false);

const channelConnectionLogs = ref<string | null>(null);
const isDialogConnectionLogsShow = ref(false);

const resolveStatusVariant = (s: string | undefined | null) => {
  if (s === EWorkerStatus.disponible)
    return { color: EColor.warning, text: t('disponible') };
  if (s === EWorkerStatus.offline)
    return { color: EColor.error, text: t('offline') };
  if (s === EWorkerStatus.online)
    return { color: EColor.success, text: t('online') };
  if (s === EWorkerStatus.new) return { color: EColor.info, text: t('new') };
  if (s === EWorkerStatus.deleting)
    return { color: EColor.error, text: t('deleting') };
  if (s === EWorkerStatus.recreating)
    return { color: EColor.info, text: t('recreating') };
  if (s === EWorkerStatus.error)
    return { color: EColor.error, text: t('error') };

  return { color: EColor.primary, text: t('unknown') };
};

const resolveTypeVariant = (s: string | undefined | null) => {
  if (s === EWorkerType.baileys)
    return { color: EColor.info, text: t('unofficial') };
  if (s === EWorkerType.whatsapp)
    return { color: EColor.success, text: t('official') };

  return { color: EColor.error, text: t('unknown') };
};

const headers: DataTableHeader<ListWorkerResponse>[] = [
  { title: t('name'), key: 'name' },
  { title: t('number'), key: 'number' },
  { title: t('status'), key: 'status' },
  { title: t('type'), key: 'type' },
  ...(isAdministrator ? [{ title: t('server'), key: 'server' }] : []),
  ...(isAdministrator ? [{ title: t('account'), key: 'account' }] : []),
  { title: t('connection_date'), key: 'connection_date' },
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

const openConnectionDialog = (id: string) => {
  channelConnectionChannel.value = id;
  isDialogConnectionChannelShow.value = true;
};

const openConnectionLogDialog = (id: string) => {
  channelConnectionLogs.value = id;
  isDialogConnectionLogsShow.value = true;
};

const handleDelete = async () => {
  if (!channelToDelete.value) return;

  const result = await channelsStore.deleteChannel(channelToDelete.value);
  if (result) {
    await channelsStore.listChannels(query.value);
  }

  channelToDelete.value = null;
};

const handleRecreate = async () => {
  if (!channelToRecreate.value) return;

  await channelsStore.recreateChannel(channelToRecreate.value);

  channelToRecreate.value = null;
};

watch(
  query,
  async (q) => {
    await channelsStore.listChannels(q);
  },
  { immediate: true, deep: true }
);
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
              <VLabel>{{ $t('type') }}:</VLabel>
              <AppAutocomplete
                item-title="text"
                item-value="id"
                :items="itemsType"
                v-model="options.type"
                :placeholder="$t('select_type')"
              />
            </div>

            <div class="status-filter">
              <VLabel>{{ $t('status') }}:</VLabel>
              <AppAutocomplete
                item-title="text"
                item-value="id"
                :items="itemsStatus"
                v-model="options.status"
                :placeholder="$t('select_state')"
              />
            </div>

            <div class="invoice-list-filter">
              <VLabel>{{ $t('search') }}:</VLabel>
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
      </VCardText>

      <VDataTableServer
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
          >
            {{ resolveStatusVariant(item?.status?.id).text }}
          </VChip>
        </template>

        <template #item.type="{ item }">
          <VChip :color="resolveTypeVariant(item?.type?.id).color" size="small">
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
            item.connection_date ? formatDateTime(item.connection_date) : '-'
          }}</span>
        </template>

        <template #item.created_at="{ item }">
          <span>{{ formatDateTime(item.created_at) }}</span>
        </template>

        <template #item.actions="{ item }">
          <div class="d-flex gap-1">
            <IconBtn
              ><VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('connect_channel') }}</span> </VTooltip
              ><VIcon
                icon="tabler-plug-connected"
                @click="openConnectionDialog(item.id)"
            /></IconBtn>

            <IconBtn v-if="$canPermission(permissionsEdit)"
              ><VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('edit_channel') }}</span> </VTooltip
              ><VIcon icon="tabler-edit" @click="openEditDialog(item.id)"
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
              ><VIcon icon="tabler-refresh" @click="recreateChannel(item.id)"
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

      <VDialogHandler
        v-if="isDialogDeleterShow"
        v-model="isDialogDeleterShow"
        :title="$t('delete_channel')"
        :message="$t('delete_channel_confirmation')"
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
      />

      <AppAddChannel v-if="isAddChannelVisible" v-model="isAddChannelVisible" />

      <AppConnectChannel
        v-if="isDialogConnectionChannelShow"
        v-model="isDialogConnectionChannelShow"
        :channel-id="channelConnectionChannel"
      />

      <AppLogsChannel
        v-if="isDialogConnectionLogsShow"
        v-model="isDialogConnectionLogsShow"
        :channel-id="channelConnectionLogs"
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

<style lang="scss">
.status-filter {
  inline-size: 12rem;
}

.type-filter {
  inline-size: 12rem;
}

.invoice-list-filter {
  inline-size: 20rem;
}
</style>
