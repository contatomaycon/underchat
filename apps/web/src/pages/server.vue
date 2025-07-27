<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { refDebounced } from '@vueuse/core';
import { useServerStore } from '@/@webcore/stores/server';
import { EColor } from '@core/common/enums/EColor';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EServerPermissions } from '@core/common/enums/EPermissions/server';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { onMessage, unsubscribe } from '@/@webcore/centrifugo';
import { ECentrifugoChannel } from '@core/common/enums/ECentrifugoChannel';
import { IStatusServerCentrifugo } from '@core/common/interfaces/IStatusServerCentrifugo';
import { EServerStatus } from '@core/common/enums/EServerStatus';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EServerPermissions.server_create,
      EServerPermissions.server_view,
      EServerPermissions.server_edit,
      EServerPermissions.server_delete,
    ],
  },
});

const permissionsReinstall = [
  EGeneralPermissions.full_access,
  EServerPermissions.server_reinstall,
];
const permissionsServerLogsInstall = [
  EGeneralPermissions.full_access,
  EServerPermissions.server_logs_install,
];
const permissionsEdit = [
  EGeneralPermissions.full_access,
  EServerPermissions.server_edit,
];
const permissionsDelete = [
  EGeneralPermissions.full_access,
  EServerPermissions.server_delete,
];
const permissionsCreate = [
  EGeneralPermissions.full_access,
  EServerPermissions.server_create,
];

const { t } = useI18n();
const serverStore = useServerStore();

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
  { id: EServerStatus.new, text: t('new') },
  { id: EServerStatus.installing, text: t('installing') },
  { id: EServerStatus.online, text: t('online') },
  { id: EServerStatus.error, text: t('error') },
  { id: EServerStatus.offline, text: t('offline') },
]);

const isDialogDeleterShow = ref(false);
const serverToDelete = ref<string | null>(null);

const isDialogEditServerShow = ref(false);
const isAddServerVisible = ref(false);
const serverToEdit = ref<string | null>(null);

const isConsoleServerVisible = ref(false);
const serverToConsole = ref<string | null>(null);

const isLogsServerVisible = ref(false);
const serverToLogs = ref<string | null>(null);

const isDialogRefreshServerShow = ref(false);
const serverToRefresh = ref<string | null>(null);

const resolveStatusVariant = (s: string) => {
  if (s === EServerStatus.new) return { color: EColor.info, text: t('new') };
  if (s === EServerStatus.installing)
    return { color: EColor.warning, text: t('installing') };
  if (s === EServerStatus.online)
    return { color: EColor.success, text: t('online') };
  if (s === EServerStatus.error)
    return { color: EColor.error, text: t('error') };
  if (s === EServerStatus.offline)
    return { color: EColor.error, text: t('offline') };

  return { color: EColor.primary, text: t('unknown') };
};

const headers = [
  { title: t('name'), key: 'name' },
  { title: t('status'), key: 'status' },
  { title: t('ssh_ip'), key: 'ssh_ip' },
  { title: t('ssh_port'), key: 'ssh_port' },
  { title: t('web_domain'), key: 'web_domain' },
  { title: t('workers_allowed'), key: 'quantity_workers' },
  { title: t('created_at'), key: 'created_at' },
  { title: t('actions'), key: 'actions', sortable: false },
];

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
  status: null as string | null,
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

const deleteServer = async (id: string) => {
  serverToDelete.value = id;

  isDialogDeleterShow.value = true;
};

const refreshServer = async (id: string) => {
  serverToRefresh.value = id;

  isDialogRefreshServerShow.value = true;
};

const handleDelete = async () => {
  if (!serverToDelete.value) return;

  const result = await serverStore.deleteServer(serverToDelete.value);
  if (result) {
    await serverStore.listServers(query.value);
  }

  serverToDelete.value = null;
};

const handleReinstall = async () => {
  if (!serverToRefresh.value) return;

  await serverStore.reinstallServer(serverToRefresh.value);

  serverToRefresh.value = null;
};

const openEditDialog = (id: string) => {
  serverToEdit.value = id;

  isDialogEditServerShow.value = true;
};

const openConsoleDialog = (id: string) => {
  serverToConsole.value = id;

  isConsoleServerVisible.value = true;
};

const openLogsDialog = (id: string) => {
  serverToLogs.value = id;

  isLogsServerVisible.value = true;
};

watch(
  query,
  async (q) => {
    await serverStore.listServers(q);
  },
  { immediate: true, deep: true }
);

onMounted(() => {
  onMessage(
    ECentrifugoChannel.status_server,
    (data: IStatusServerCentrifugo) => {
      serverStore.updateStatusServer(data.server_id, data.status);
    }
  );
});

onBeforeUnmount(async () => {
  await Promise.all([
    unsubscribe(ECentrifugoChannel.server_ssh),
    unsubscribe(ECentrifugoChannel.status_server),
  ]);
});
</script>

<template>
  <div>
    <VCard :title="$t('server')" no-padding>
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
              @click="isAddServerVisible = true"
            >
              {{ $t('add') }}
            </VBtn>
          </div>
          <div class="d-flex align-center flex-wrap gap-4">
            <div class="server-status-filter">
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
        :items="serverStore.list_servers"
        :items-length="serverStore.pagings.total"
        :loading="serverStore.loading"
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
            :color="resolveStatusVariant(item.status.id).color"
            size="small"
          >
            {{ resolveStatusVariant(item.status.id).text }}
          </VChip>
        </template>

        <template #item.ssh_port="{ item }">
          <span>{{ item.ssh.ssh_port }}</span>
        </template>

        <template #item.ssh_ip="{ item }">
          <span>{{ item.ssh.ssh_ip }}</span>
        </template>

        <template #item.web_domain="{ item }">
          <span>{{ item.web.web_domain }}</span>
        </template>

        <template #item.created_at="{ item }">
          <span>{{ formatDateTime(item.created_at) }}</span>
        </template>

        <template #item.actions="{ item }">
          <div class="d-flex gap-1">
            <IconBtn
              v-if="
                item.status.id !== EServerStatus.installing &&
                $canPermission(permissionsReinstall)
              "
            >
              <VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>
                  {{ $t('reinstall_server') }}
                </span>
              </VTooltip>
              <VIcon icon="tabler-refresh" @click="refreshServer(item.id)"
            /></IconBtn>

            <IconBtn
              v-if="
                item.status.id === EServerStatus.installing &&
                $canPermission(permissionsServerLogsInstall)
              "
            >
              <VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('console_installation') }}</span>
              </VTooltip>
              <VIcon
                icon="tabler-terminal-2"
                @click="openConsoleDialog(item.id)"
            /></IconBtn>

            <IconBtn
              v-if="
                item.status.id !== EServerStatus.installing &&
                $canPermission(permissionsServerLogsInstall)
              "
            >
              <VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('server_logs') }}</span> </VTooltip
              ><VIcon icon="tabler-terminal-2" @click="openLogsDialog(item.id)"
            /></IconBtn>

            <IconBtn v-if="$canPermission(permissionsEdit)"
              ><VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('edit_server') }}</span> </VTooltip
              ><VIcon icon="tabler-edit" @click="openEditDialog(item.id)"
            /></IconBtn>

            <IconBtn v-if="$canPermission(permissionsDelete)"
              ><VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('delete_server') }}</span> </VTooltip
              ><VIcon icon="tabler-trash" @click="deleteServer(item.id)"
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
            :total-items="serverStore.pagings.total"
          />
        </template>
      </VDataTableServer>

      <VDialogHandler
        v-model="isDialogRefreshServerShow"
        :title="$t('reinstall_server')"
        :message="$t('reinstall_server_confirmation')"
        @confirm="handleReinstall"
      />

      <VDialogHandler
        v-model="isDialogDeleterShow"
        :title="$t('delete_server')"
        :message="$t('delete_server_confirmation')"
        @confirm="handleDelete"
      />

      <AppEditServer
        v-model="isDialogEditServerShow"
        :server-id="serverToEdit"
      />

      <AppAddServer v-model="isAddServerVisible" />

      <AppConsoleServer
        v-model="isConsoleServerVisible"
        :server-id="serverToConsole"
      />

      <AppLogsServer v-model="isLogsServerVisible" :server-id="serverToLogs" />
    </VCard>
    <VSnackbar
      v-model="serverStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="serverStore.snackbar.color"
    >
      {{ serverStore.snackbar.message }}
    </VSnackbar>
  </div>
</template>

<style lang="scss">
.server-status-filter {
  inline-size: 12rem;
}

.invoice-list-filter {
  inline-size: 20rem;
}
</style>
