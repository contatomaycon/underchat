<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { DataTableHeader } from 'vuetify';
import { EPlanPermissions } from '@core/common/enums/EPermissions/plan';
import { usePlanStore } from '@/@webcore/stores/plan';
import { ListPlanResponse } from '@core/schema/plan/listPlan/response.schema';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EPlanPermissions.plan_group,
      EPlanPermissions.plan_view,
    ],
  },
});

const permissionsEdit = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EPlanPermissions.plan_group,
  EPlanPermissions.plan_update,
];
const permissionsDelete = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EPlanPermissions.plan_group,
  EPlanPermissions.plan_delete,
];
const permissionsCreate = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EPlanPermissions.plan_group,
  EPlanPermissions.plan_create,
];

const { t } = useI18n();
const planStore = usePlanStore();

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
]);

const isDialogDeleterShow = ref(false);
const planToDelete = ref<string | null>(null);

const isDialogEditPlanShow = ref(false);
const isAddPlanVisible = ref(false);
const planToEdit = ref<string | null>(null);

const isAddPlanItemVisible = ref(false);
const planToAddItem = ref<string | null>(null);

const headers: DataTableHeader<ListPlanResponse>[] = [
  { title: t('name'), key: 'name' },
  { title: t('price'), key: 'price' },
  { title: t('price_old'), key: 'price_old' },
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

const deletePlan = async (id: string) => {
  planToDelete.value = id;
  isDialogDeleterShow.value = true;
};

const handleDelete = async () => {
  if (!planToDelete.value) return;

  const result = await planStore.deletePlan(planToDelete.value);
  if (result) {
    await planStore.listPlan(query.value);
  }

  planToDelete.value = null;
};

const openEditDialog = (id: string) => {
  planToEdit.value = id;
  isDialogEditPlanShow.value = true;
};

const openAddItemDialog = (id: string) => {
  planToAddItem.value = id;
  isAddPlanItemVisible.value = true;
};

watch(
  query,
  async (q) => {
    await planStore.listPlan(q);
  },
  { immediate: true, deep: true }
);
</script>

<template>
  <div>
    <VCard :title="$t('plans')" no-padding>
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
              @click="isAddPlanVisible = true"
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
        :items="planStore.list"
        :items-length="planStore.pagings.total"
        :loading="planStore.loading"
        :sort-by="options.sortBy"
        @update:options="handleTableChange"
        :loading-text="$t('loading_text')"
      >
        <template #item.price="{ item }">
          {{
            new Intl.NumberFormat('pt-BR', {
              style: 'currency',
              currency: 'BRL',
            }).format(item.price ?? 0)
          }}
        </template>

        <template #item.price_old="{ item }">
          <s>{{
            new Intl.NumberFormat('pt-BR', {
              style: 'currency',
              currency: 'BRL',
            }).format(item.price_old ?? 0)
          }}</s>
        </template>

        <template #item.created_at="{ item }">
          <span>{{ formatDateTime(item.created_at ?? null) }}</span>
        </template>

        <template #item.actions="{ item }">
          <div class="d-flex gap-1">
            <IconBtn v-if="$canPermission(permissionsCreate)">
              <VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('add_plan_item') }}</span>
              </VTooltip>
              <VIcon
                icon="tabler-plus"
                @click="openAddItemDialog(item.plan_id)"
              />
            </IconBtn>

            <IconBtn v-if="$canPermission(permissionsEdit)">
              <VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('edit_plan') }}</span>
              </VTooltip>
              <VIcon icon="tabler-edit" @click="openEditDialog(item.plan_id)" />
            </IconBtn>

            <IconBtn v-if="$canPermission(permissionsDelete)">
              <VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('delete_plan') }}</span>
              </VTooltip>
              <VIcon icon="tabler-trash" @click="deletePlan(item.plan_id)" />
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
            :total-items="planStore.pagings.total"
          />
        </template>
      </VDataTableServer>

      <VDialogHandler
        v-if="isDialogDeleterShow"
        v-model="isDialogDeleterShow"
        :title="$t('delete_plan')"
        :message="$t('delete_plan_confirmation')"
        @confirm="handleDelete"
      />

      <AppEditPlan
        v-if="isDialogEditPlanShow"
        v-model="isDialogEditPlanShow"
        :plan-id="planToEdit"
      />

      <AppAddPlan v-if="isAddPlanVisible" v-model="isAddPlanVisible" />

      <AppAddPlanItem
        v-if="isAddPlanItemVisible"
        v-model="isAddPlanItemVisible"
        :plan-id="planToAddItem"
      />
    </VCard>

    <VSnackbar
      v-model="planStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="planStore.snackbar.color"
    >
      {{ planStore.snackbar.message }}
    </VSnackbar>
  </div>
</template>

<style lang="scss">
.invoice-list-filter {
  inline-size: 20rem;
}
</style>
