<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { DataTableHeader } from 'vuetify';
import { EExpenditurePermissions } from '@core/common/enums/EPermissions/expenditure';
import { useExpendituresStore } from '@/@webcore/stores/expenditure';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { ListExpenditureResponse } from '@core/schema/expenditure/listExpenditure/response.schema';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EExpenditurePermissions.expenditure_group,
      EExpenditurePermissions.expenditure_view,
      EExpenditurePermissions.expenditure_create,
      EExpenditurePermissions.expenditure_update,
      EExpenditurePermissions.expenditure_delete,
    ],
  },
});

const permissionsEdit = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EExpenditurePermissions.expenditure_group,
  EExpenditurePermissions.expenditure_update,
];
const permissionsDelete = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EExpenditurePermissions.expenditure_group,
  EExpenditurePermissions.expenditure_delete,
];
const permissionsCreate = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EExpenditurePermissions.expenditure_group,
  EExpenditurePermissions.expenditure_create,
];

const { t } = useI18n();
const expenditureStore = useExpendituresStore();
useSnackbarCleanup(expenditureStore);

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
]);

const isDialogDeleterShow = ref(false);
const expenditureToDelete = ref<string | null>(null);

const isDialogEditExpenditureShow = ref(false);
const isAddExpenditureVisible = ref(false);
const expenditureToEdit = ref<string | null>(null);

const headers: DataTableHeader<ListExpenditureResponse>[] = [
  { title: t('name'), key: 'name' },
  { title: t('description'), key: 'description' },
  { title: t('price'), key: 'price' },
  { title: t('created_at'), key: 'created_at' },
  { title: t('actions'), key: 'actions', sortable: false },
];

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
  search: null as string | null,
});

const debouncedSearch = refDebounced(
  computed(() => options.value.search),
  500
);

const parsePriceFromSearch = (
  search: string | null | undefined
): number | undefined => {
  if (!search) return undefined;

  let cleanValue = search.replaceAll(/[R$\s€£]/gi, '').trim();

  if (!/^[\d.,]+$/.test(cleanValue)) {
    return undefined;
  }

  const parsed = Number.parseFloat(cleanValue.replace(',', '.'));

  return Number.isNaN(parsed) ? undefined : parsed;
};

const query = computed(() => {
  const price = parsePriceFromSearch(debouncedSearch.value);

  return {
    page: options.value.page,
    per_page: options.value.itemsPerPage,
    sort_by: options.value.sortBy,
    search: debouncedSearch.value,
    name: debouncedSearch.value && !price ? debouncedSearch.value : undefined,
    description:
      debouncedSearch.value && !price ? debouncedSearch.value : undefined,
    price: price,
  };
});

const handleTableChange = (o: {
  page: number;
  itemsPerPage: number;
  sortBy: SortRequest[];
}) => {
  options.value.page = o.page;
  options.value.itemsPerPage = o.itemsPerPage;
  options.value.sortBy = o.sortBy;
};

const deleteExpenditure = async (id: string) => {
  expenditureToDelete.value = id;

  isDialogDeleterShow.value = true;
};

const handleDelete = async () => {
  if (!expenditureToDelete.value) return;

  const result = await expenditureStore.deleteExpenditure(
    expenditureToDelete.value
  );
  if (result) {
    await expenditureStore.listExpenditures(query.value);
  }

  expenditureToDelete.value = null;
};

const openEditDialog = (id: string) => {
  expenditureToEdit.value = id;

  isDialogEditExpenditureShow.value = true;
};

const handleExpenditureUpdated = async () => {
  await expenditureStore.listExpenditures(query.value);
};

watch(
  query,
  async (q) => {
    await expenditureStore.listExpenditures(q);
  },
  { immediate: true, deep: true }
);
</script>

<template>
  <div>
    <VCard :title="$t('expenditure')" no-padding>
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
              @click="isAddExpenditureVisible = true"
            >
              {{ $t('add') }}
            </VBtn>
          </div>
          <div class="d-flex align-center flex-wrap gap-4">
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
      </VCardText>

      <VDataTableServer
        v-model:page="options.page"
        v-model:items-per-page="options.itemsPerPage"
        :headers="headers"
        :items="expenditureStore.list"
        :items-length="expenditureStore.pagings.total"
        :loading="expenditureStore.loading"
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

        <template #item.description="{ item }">
          {{ item.description || '-' }}
        </template>

        <template #item.price="{ item }">
          {{
            new Intl.NumberFormat('pt-BR', {
              style: 'currency',
              currency: 'BRL',
            }).format(item.price)
          }}
        </template>

        <template #item.created_at="{ item }">
          <span>{{ formatDateTime(item.created_at ?? null) }}</span>
        </template>

        <template #item.actions="{ item }">
          <div class="d-flex gap-1">
            <IconBtn v-if="$canPermission(permissionsEdit)"
              ><VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('edit_expenditure') }}</span> </VTooltip
              ><VIcon
                icon="tabler-edit"
                @click="openEditDialog(item.expenditure_id)"
            /></IconBtn>

            <IconBtn v-if="$canPermission(permissionsDelete)"
              ><VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('delete_expenditure') }}</span> </VTooltip
              ><VIcon
                icon="tabler-trash"
                @click="deleteExpenditure(item.expenditure_id)"
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
            :total-items="expenditureStore.pagings.total"
          />
        </template>
      </VDataTableServer>

      <VDialogHandler
        v-if="isDialogDeleterShow"
        v-model="isDialogDeleterShow"
        :title="$t('delete_expenditure')"
        :message="$t('delete_expenditure_confirmation')"
        @confirm="handleDelete"
      />

      <AppEditExpenditure
        v-if="isDialogEditExpenditureShow"
        v-model="isDialogEditExpenditureShow"
        :expenditure-id="expenditureToEdit"
        @updated="handleExpenditureUpdated"
      />

      <AppAddExpenditure
        v-if="isAddExpenditureVisible"
        v-model="isAddExpenditureVisible"
      />
    </VCard>

    <VSnackbar
      v-model="expenditureStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="expenditureStore.snackbar.color"
    >
      {{ expenditureStore.snackbar.message }}
    </VSnackbar>
  </div>
</template>

<style lang="scss">
.invoice-list-filter {
  inline-size: 20rem;
}
</style>
