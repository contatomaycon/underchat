<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { unsubscribe } from '@/@webcore/centrifugo';
import { ECentrifugoChannel } from '@core/common/enums/ECentrifugoChannel';
import { getAdministrator } from '@/@webcore/localStorage/user';
import { DataTableHeader } from 'vuetify';
import { ESectorPermissions } from '@core/common/enums/EPermissions/sector';
import { useSectorsStore } from '@/@webcore/stores/sector';
import { ListSectorResponse } from '@core/schema/sector/listSector/response.schema';
import { EColor } from '@core/common/enums/EColor';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      ESectorPermissions.sector_list,
      ESectorPermissions.sector_view,
      ESectorPermissions.sector_create,
      ESectorPermissions.sector_edit,
      ESectorPermissions.sector_delete,
    ],
  },
});

const permissionsEdit = [
  EGeneralPermissions.full_access,
  ESectorPermissions.sector_edit,
];
const permissionsDelete = [
  EGeneralPermissions.full_access,
  ESectorPermissions.sector_delete,
];
const permissionsCreate = [
  EGeneralPermissions.full_access,
  ESectorPermissions.sector_create,
];

const { t } = useI18n();
const sectorStore = useSectorsStore();
const isAdministrator = getAdministrator();

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
]);

const isDialogDeleterShow = ref(false);
const sectorToDelete = ref<string | null>(null);

const isDialogEditSectorShow = ref(false);
const isAddSectorVisible = ref(false);
const sectorToEdit = ref<string | null>(null);

const isHexColor = (s: string) => /^#([0-9A-F]{6}|[0-9A-F]{3})$/i.test(s);

const backgroundColor = (s: string): string => {
  if (isHexColor(s)) return s;

  return EColor.primary;
};

const headers: DataTableHeader<ListSectorResponse>[] = [
  { title: t('name'), key: 'name' },
  ...(isAdministrator ? [{ title: t('status'), key: 'status' }] : []),
  ...(isAdministrator ? [{ title: t('account'), key: 'account' }] : []),
  { title: t('color'), key: 'color' },
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

const deleteSector = async (id: string) => {
  sectorToDelete.value = id;

  isDialogDeleterShow.value = true;
};

const handleDelete = async () => {
  if (!sectorToDelete.value) return;

  const result = await sectorStore.deleteSector(sectorToDelete.value);
  if (result) {
    await sectorStore.listSectors(query.value);
  }

  sectorToDelete.value = null;
};

const openEditDialog = (id: string) => {
  sectorToEdit.value = id;

  isDialogEditSectorShow.value = true;
};

watch(
  query,
  async (q) => {
    await sectorStore.listSectors(q);
  },
  { immediate: true, deep: true }
);

onBeforeUnmount(async () => {
  await Promise.all([unsubscribe(ECentrifugoChannel.worker_channel)]);
});
</script>

<template>
  <div>
    <VCard :title="$t('sector')" no-padding>
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
              @click="isAddSectorVisible = true"
            >
              {{ $t('add') }}
            </VBtn>
          </div>
          <div class="d-flex align-center flex-wrap gap-4">
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
        :items="sectorStore.list"
        :items-length="sectorStore.pagings.total"
        :loading="sectorStore.loading"
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
          {{ $t(`${item.sector_status?.name}`) }}
        </template>

        <template #item.account="{ item }">
          {{ item.account?.name }}
        </template>

        <template #item.color="{ item }">
          <VChip
            :style="{ backgroundColor: backgroundColor(item.color) }"
            size="small"
          >
            {{ item.color }}
          </VChip>
        </template>

        <template #item.created_at="{ item }">
          <span>{{ formatDateTime(item.created_at) }}</span>
        </template>

        <template #item.actions="{ item }">
          <div class="d-flex gap-1">
            <IconBtn
              v-if="
                $canPermission(permissionsEdit) &&
                (item.account?.id || isAdministrator)
              "
              ><VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('edit_channel') }}</span> </VTooltip
              ><VIcon
                icon="tabler-edit"
                @click="openEditDialog(item.sector_id)"
            /></IconBtn>

            <IconBtn
              v-if="
                $canPermission(permissionsDelete) &&
                (item.account?.id || isAdministrator)
              "
              ><VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('delete_sector') }}</span> </VTooltip
              ><VIcon icon="tabler-trash" @click="deleteSector(item.sector_id)"
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
            :total-items="sectorStore.pagings.total"
          />
        </template>
      </VDataTableServer>

      <VDialogHandler
        v-if="isDialogDeleterShow"
        v-model="isDialogDeleterShow"
        :title="$t('delete_sector')"
        :message="$t('delete_sector_confirmation')"
        @confirm="handleDelete"
      />

      <AppEditSector
        v-if="isDialogEditSectorShow"
        v-model="isDialogEditSectorShow"
        :sector-id="sectorToEdit"
      />

      <AppAddSector v-if="isAddSectorVisible" v-model="isAddSectorVisible" />
    </VCard>

    <VSnackbar
      v-model="sectorStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="sectorStore.snackbar.color"
    >
      {{ sectorStore.snackbar.message }}
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
