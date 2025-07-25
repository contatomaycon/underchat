<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { useServerStore } from '@/@webcore/stores/server';
import { EColor } from '@core/common/enums/EColor';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EServerPermissions } from '@core/common/enums/EPermissions/server';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';

const { t } = useI18n();
const serverStore = useServerStore();

const itemsStatus = ref([
  { id: 0, text: t('all') },
  { id: 1, text: t('new') },
  { id: 2, text: t('installing') },
  { id: 3, text: t('online') },
  { id: 4, text: t('error') },
  { id: 5, text: t('offline') },
]);

const isDialogDeleterShow = ref(false);
const serverToDelete = ref<number | null>(null);

const resolveStatusVariant = (status: number) => {
  if (status === 1) return { color: EColor.info, text: t('new') };
  if (status === 2) return { color: EColor.warning, text: t('installing') };
  if (status === 3) return { color: EColor.success, text: t('online') };
  if (status === 4) return { color: EColor.error, text: t('error') };
  if (status === 5) return { color: EColor.error, text: t('offline') };

  return { color: EColor.primary, text: t('unknown') };
};

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

const headers = [
  { title: t('name'), key: 'name' },
  { title: t('status'), key: 'status' },
  { title: t('ssh_ip'), key: 'ssh_ip' },
  { title: t('ssh_port'), key: 'ssh_port' },
  { title: t('created_at'), key: 'created_at' },
  { title: t('actions'), key: 'actions', sortable: false },
];

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
  status: null as number | null,
  search: null as string | null,
});

const debouncedSearch = refDebounced(
  computed(() => options.value.search),
  500
);

const fetchData = async () => {
  await serverStore.listServers({
    page: options.value.page,
    per_page: options.value.itemsPerPage,
    sort_by: options.value.sortBy,
    status: options.value.status,
    search: debouncedSearch.value,
  });
};

const deleteServer = async (serverId: number) => {
  serverToDelete.value = serverId;
  isDialogDeleterShow.value = true;
};

const handleDelete = async () => {
  if (serverToDelete.value) {
    const result = await serverStore.deleteServer(serverToDelete.value);

    if (result) {
      await fetchData();
    }

    serverToDelete.value = null;
  }
};

watch(
  () => [
    options.value.page,
    options.value.itemsPerPage,
    options.value.sortBy,
    options.value.status,
  ],
  fetchData,
  { deep: true }
);

watch(debouncedSearch, fetchData, { immediate: true });

onMounted(async () => {
  await fetchData();
});
</script>

<template>
  <VCard :title="$t('server')" no-padding>
    <VCardText>
      <VRow class="justify-end" dense>
        <VCol cols="6" md="2">
          <VLabel>{{ $t('status') }}:</VLabel>
          <AppAutocomplete
            item-title="text"
            item-value="id"
            :items="itemsStatus"
            v-model="options.status"
            :placeholder="$t('select_state')"
          />
        </VCol>
        <VCol cols="6" md="4">
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
        </VCol>
      </VRow>
    </VCardText>

    <VDataTableServer
      v-model:page="options.page"
      v-model:items-per-page="options.itemsPerPage"
      :headers="headers"
      :items="serverStore.list_servers"
      :items-length="serverStore.pagings.total"
      :loading="serverStore.loading"
      :sort-by="options.sortBy"
      @update:options="(opts) => (options = opts)"
    >
      <template #item.name="{ item }">
        <div class="d-flex flex-column ms-3">
          <span
            class="d-block font-weight-medium text-high-emphasis text-truncate"
            >{{ item.name }}</span
          >
        </div>
      </template>

      <template #item.status="{ item }">
        <VChip :color="resolveStatusVariant(item.status.id).color" size="small">
          {{ resolveStatusVariant(item.status.id).text }}
        </VChip>
      </template>

      <template #item.ssh_port="{ item }">
        <span>{{ item.ssh.ssh_port }}</span>
      </template>

      <template #item.ssh_ip="{ item }">
        <span>{{ item.ssh.ssh_ip }}</span>
      </template>

      <template #item.created_at="{ item }">
        <span>{{ formatDateTime(item.created_at) }}</span>
      </template>

      <template #item.actions="{ item }">
        <div class="d-flex gap-1">
          <IconBtn><VIcon icon="tabler-edit" /></IconBtn>
          <IconBtn
            ><VIcon icon="tabler-trash" @click="deleteServer(item.id)"
          /></IconBtn>
        </div>
      </template>

      <template #no-data>
        {{ $t('no_data_available') }}
      </template>
    </VDataTableServer>

    <VDialogDeleter
      v-model="isDialogDeleterShow"
      :title="$t('delete_server')"
      :message="$t('delete_server_confirmation')"
      @confirm="handleDelete"
    />
  </VCard>
</template>
