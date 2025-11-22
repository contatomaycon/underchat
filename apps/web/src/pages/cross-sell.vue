<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { DataTableHeader } from 'vuetify';
import { EPlanPermissions } from '@core/common/enums/EPermissions/plan';
import { useCrossSellStore } from '@/@webcore/stores/crossSell';

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
const crossSellStore = useCrossSellStore();

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
]);

const isDialogDeleterShow = ref(false);
const crossSellToDelete = ref<string | null>(null);

const isDialogEditCrossSellShow = ref(false);
const isAddCrossSellVisible = ref(false);
const crossSellToEdit = ref<string | null>(null);

const isLinkAccountVisible = ref(false);
const crossSellToLink = ref<string | null>(null);

const headers: DataTableHeader<any>[] = [
  { title: t('plan_product'), key: 'plan_product' },
  { title: t('quantity'), key: 'quantity' },
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

const deleteCrossSell = async (id: string) => {
  crossSellToDelete.value = id;
  isDialogDeleterShow.value = true;
};

const handleDelete = async () => {
  if (!crossSellToDelete.value) return;

  const result = await crossSellStore.deleteCrossSell(crossSellToDelete.value);
  if (result) {
    await crossSellStore.listCrossSell(query.value);
  }

  crossSellToDelete.value = null;
};

const openEditDialog = (id: string) => {
  crossSellToEdit.value = id;
  isDialogEditCrossSellShow.value = true;
};

const openLinkAccountDialog = (id: string) => {
  crossSellToLink.value = id;
  isLinkAccountVisible.value = true;
};

watch(
  query,
  async (q) => {
    await crossSellStore.listCrossSell(q);
  },
  { immediate: true, deep: true }
);
</script>

<template>
  <div>
    <VCard :title="$t('cross_sell')" no-padding>
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
              @click="isAddCrossSellVisible = true"
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
        :items="crossSellStore.list"
        :items-length="crossSellStore.pagings.total"
        :loading="crossSellStore.loading"
        :sort-by="options.sortBy"
        @update:options="handleTableChange"
        :loading-text="$t('loading_text')"
      >
        <template #item.plan_product="{ item }">
          <span>{{ item.plan_product?.name || '-' }}</span>
        </template>

        <template #item.price="{ item }">
          {{
            new Intl.NumberFormat('pt-BR', {
              style: 'currency',
              currency: 'BRL',
            }).format(item.price ?? 0)
          }}
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
                <span>{{ $t('link_account') }}</span>
              </VTooltip>
              <VIcon
                icon="tabler-link"
                @click="openLinkAccountDialog(item.plan_cross_sell_id)"
              />
            </IconBtn>

            <IconBtn v-if="$canPermission(permissionsEdit)">
              <VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('edit_cross_sell') }}</span>
              </VTooltip>
              <VIcon
                icon="tabler-edit"
                @click="openEditDialog(item.plan_cross_sell_id)"
              />
            </IconBtn>

            <IconBtn v-if="$canPermission(permissionsDelete)">
              <VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('delete_cross_sell') }}</span>
              </VTooltip>
              <VIcon
                icon="tabler-trash"
                @click="deleteCrossSell(item.plan_cross_sell_id)"
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
            :total-items="crossSellStore.pagings.total"
          />
        </template>
      </VDataTableServer>

      <VDialogHandler
        v-if="isDialogDeleterShow"
        v-model="isDialogDeleterShow"
        :title="$t('delete_cross_sell')"
        :message="$t('delete_cross_sell_confirmation')"
        @confirm="handleDelete"
      />

      <AppEditCrossSell
        v-if="isDialogEditCrossSellShow"
        v-model="isDialogEditCrossSellShow"
        :cross-sell-id="crossSellToEdit"
      />

      <AppAddCrossSell
        v-if="isAddCrossSellVisible"
        v-model="isAddCrossSellVisible"
      />

      <AppLinkCrossSellAccount
        v-if="isLinkAccountVisible"
        v-model="isLinkAccountVisible"
        :cross-sell-id="crossSellToLink"
      />
    </VCard>

    <VSnackbar
      v-model="crossSellStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="crossSellStore.snackbar.color"
    >
      {{ crossSellStore.snackbar.message }}
    </VSnackbar>
  </div>
</template>

<style lang="scss">
.invoice-list-filter {
  inline-size: 20rem;
}
</style>
