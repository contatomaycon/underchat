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
  { id: 0, text: t('all') },
  { id: 1, text: t('new') },
  { id: 2, text: t('installing') },
  { id: 3, text: t('online') },
  { id: 4, text: t('error') },
  { id: 5, text: t('offline') },
]);

const isDialogDeleterShow = ref(false);
const serverToDelete = ref<number | null>(null);
const isDialogEditServerShow = ref(false);
const serverToEdit = ref<number | null>(null);

const resolveStatusVariant = (s: number) => {
  if (s === 1) return { color: EColor.info, text: t('new') };
  if (s === 2) return { color: EColor.warning, text: t('installing') };
  if (s === 3) return { color: EColor.success, text: t('online') };
  if (s === 4) return { color: EColor.error, text: t('error') };
  if (s === 5) return { color: EColor.error, text: t('offline') };

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

const query = computed(() => ({
  page: options.value.page,
  per_page: options.value.itemsPerPage,
  sort_by: options.value.sortBy,
  status: options.value.status,
  search: debouncedSearch.value,
}));

watch(
  query,
  async (q) => {
    await serverStore.listServers(q);
  },
  { immediate: true, deep: true }
);

const handleTableChange = (o: {
  page: number;
  itemsPerPage: number;
  sortBy: SortRequest[];
}) => {
  options.value.page = o.page;
  options.value.itemsPerPage = o.itemsPerPage;
  options.value.sortBy = o.sortBy;
};

const deleteServer = async (id: number) => {
  serverToDelete.value = id;

  isDialogDeleterShow.value = true;
};

const handleDelete = async () => {
  if (!serverToDelete.value) return;

  const result = await serverStore.deleteServer(serverToDelete.value);
  if (result) {
    await serverStore.listServers(query.value);
  }

  serverToDelete.value = null;
};

const openEditDialog = (id: number) => {
  serverToEdit.value = id;

  isDialogEditServerShow.value = true;
};
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

            <VBtn prepend-icon="tabler-plus"> {{ $t('add') }} </VBtn>
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

        <template #item.created_at="{ item }">
          <span>{{ formatDateTime(item.created_at) }}</span>
        </template>

        <template #item.actions="{ item }">
          <div class="d-flex gap-1">
            <IconBtn
              ><VIcon icon="tabler-edit" @click="openEditDialog(item.id)"
            /></IconBtn>
            <IconBtn
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

      <VDialogDeleter
        v-model="isDialogDeleterShow"
        :title="$t('delete_server')"
        :message="$t('delete_server_confirmation')"
        @confirm="handleDelete"
      />

      <AppEditServer
        v-model="isDialogEditServerShow"
        :server-id="serverToEdit"
      />
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
