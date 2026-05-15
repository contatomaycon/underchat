<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { DataTableHeader } from 'vuetify';
import { ESectorPermissions } from '@core/common/enums/EPermissions/sector';
import { useSectorsStore } from '@/@webcore/stores/sector';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { ListSectorResponse } from '@core/schema/sector/listSector/response.schema';
import { EColor } from '@core/common/enums/EColor';
import { ESectorStatus } from '@core/common/enums/ESectorStatus';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      ESectorPermissions.sector_group,
      ESectorPermissions.sector_view,
      ESectorPermissions.sector_create,
      ESectorPermissions.sector_update,
      ESectorPermissions.sector_delete,
    ],
  },
});

const permissionsEdit = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ESectorPermissions.sector_group,
  ESectorPermissions.sector_update,
];
const permissionsDelete = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ESectorPermissions.sector_group,
  ESectorPermissions.sector_delete,
];
const permissionsCreate = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ESectorPermissions.sector_group,
  ESectorPermissions.sector_create,
];

const { t } = useI18n();
const sectorStore = useSectorsStore();
useSnackbarCleanup(sectorStore);

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
  { id: ESectorStatus.active, text: t('active') },
  { id: ESectorStatus.inactive, text: t('inactive') },
]);

const isDialogDeleterShow = ref(false);
const sectorToDelete = ref<string | null>(null);

const isDialogEditSectorShow = ref(false);
const isAddSectorVisible = ref(false);
const sectorToEdit = ref<string | null>(null);
const isSectorUsersModalOpen = ref(false);
const sectorToViewUsersId = ref<string | null>(null);
const sectorToViewUsersName = ref<string | null>(null);

const isHexColor = (s: string) => /^#([0-9A-F]{6}|[0-9A-F]{3})$/i.test(s);

const backgroundColor = (s: string): string => {
  if (isHexColor(s)) return s;

  return EColor.primary;
};

const textColor = (s: string): string => {
  const hex = backgroundColor(s);

  if (!isHexColor(hex)) return '#FFFFFF';

  let c = hex.substring(1);
  if (c.length === 3) {
    c = c
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }

  const r = Number.parseInt(c.slice(0, 2), 16);
  const g = Number.parseInt(c.slice(2, 4), 16);
  const b = Number.parseInt(c.slice(4, 6), 16);

  const yiq = (r * 299 + g * 587 + b * 114) / 1000;

  return yiq >= 128 ? '#000000' : '#FFFFFF';
};

const headers: DataTableHeader<ListSectorResponse>[] = [
  { title: t('name'), key: 'name' },
  { title: t('color'), key: 'color' },
  { title: t('created_at'), key: 'created_at' },
  { title: t('actions'), key: 'actions', sortable: false },
];

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
  sector_status: null as string | null,
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
  sector_status: options.value.sector_status,
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

const openSectorUsersModal = (sector: ListSectorResponse) => {
  sectorToViewUsersId.value = sector.sector_id;
  sectorToViewUsersName.value = sector.name;
  isSectorUsersModalOpen.value = true;
};

const handleSectorUpdated = async () => {
  await sectorStore.listSectors(query.value);
};

watch(
  query,
  async (q) => {
    await sectorStore.listSectors(q);
  },
  { immediate: true, deep: true }
);
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
            <div class="status-filter">
              <VLabel class="text-body-2 mb-1">{{ $t('status') }}:</VLabel>
              <AppSelectSearch
                v-model="options.sector_status"
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
          <VDataTableServer
            class="data-table"
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
              <VChip
                v-if="item.sector_status"
                :color="
                  item.sector_status.id === ESectorStatus.active
                    ? 'success'
                    : 'error'
                "
                size="small"
                variant="tonal"
              >
                {{
                  item.sector_status.id === ESectorStatus.active
                    ? $t('active')
                    : $t('inactive')
                }}
              </VChip>
              <span v-else class="text-medium-emphasis">-</span>
            </template>

            <template #item.account="{ item }">
              {{ item.account?.name }}
            </template>

            <template #item.color="{ item }">
              <VChip
                class="uc-chip"
                size="small"
                :style="{
                  backgroundColor: backgroundColor(item.color),
                  color: textColor(item.color),
                }"
              >
                {{ item.color }}
              </VChip>
            </template>

            <template #item.created_at="{ item }">
              <span>{{ formatDateTime(item.created_at) }}</span>
            </template>

            <template #item.actions="{ item }">
              <div class="d-flex gap-1">
                <IconBtn v-if="$canPermission(permissionsEdit)"
                  ><VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('edit_sector') }}</span> </VTooltip
                  ><VIcon
                    icon="tabler-edit"
                    @click="openEditDialog(item.sector_id)"
                /></IconBtn>

                <IconBtn v-if="$canPermission(permissionsDelete)"
                  ><VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('delete_sector') }}</span> </VTooltip
                  ><VIcon
                    icon="tabler-trash"
                    @click="deleteSector(item.sector_id)"
                /></IconBtn>

                <IconBtn>
                  <VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('users') }}</span>
                  </VTooltip>
                  <VIcon
                    icon="tabler-users"
                    @click="openSectorUsersModal(item)"
                  />
                </IconBtn>
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
        </div>
      </VCardText>

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
        @updated="handleSectorUpdated"
      />

      <AppAddSector v-if="isAddSectorVisible" v-model="isAddSectorVisible" />

      <AppSectorUsersModal
        v-model="isSectorUsersModalOpen"
        :sector-id="sectorToViewUsersId"
        :sector-name="sectorToViewUsersName"
      />
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

<style lang="scss" scoped>
.status-filter {
  inline-size: 12rem;
}

.invoice-list-filter {
  inline-size: 20rem;
}

.uc-chip {
  height: 24px;
  min-width: 88px;
  justify-content: center;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
