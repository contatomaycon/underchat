<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { DataTableHeader } from 'vuetify';
import { EAccountPermissions } from '@core/common/enums/EPermissions/account';
import { useAccountStore } from '@/@webcore/stores/account';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { ListAccountResponse } from '@core/schema/account/listAccount/response.schema';
import { EColor } from '@core/common/enums/EColor';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EAccountPermissions.account_group,
      EAccountPermissions.account_view,
    ],
  },
});

const { t } = useI18n();
const accountStore = useAccountStore();

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
]);

const itemsStatus = computed(() => [
  { id: '', text: t('all') },
  { id: EAccountStatus.active, text: t('active') },
  { id: EAccountStatus.inactive, text: t('inactive') },
]);

const resolvePlanVariant = (planName?: string | null) => {
  if (!planName) {
    return { color: EColor.primary, text: t('unknown') };
  }

  switch (planName.toLowerCase()) {
    case 'ouro':
      return { color: EColor.warning, text: t('ouro') };
    case 'diamante':
      return { color: EColor.info, text: t('diamante') };
    case 'prata':
      return { color: EColor.secondary, text: t('prata') };
    case 'bronze':
      return { color: EColor.error, text: t('bronze') };
    default:
      return { color: EColor.primary, text: planName };
  }
};

const getAccountStatusColor = (
  statusId?: string | null,
  statusName?: string | null
) => {
  if (!statusId && !statusName) {
    return 'error';
  }

  const isActive =
    String(statusId) === String(EAccountStatus.active) ||
    statusName?.toLowerCase() === 'active' ||
    statusName?.toLowerCase() === 'ativo';

  return isActive ? 'success' : 'error';
};

const headers: DataTableHeader<ListAccountResponse>[] = [
  { title: t('name'), key: 'name' },
  { title: t('account_status'), key: 'account_status' },
  { title: t('plan'), key: 'plan' },
  { title: t('price'), key: 'price' },
  { title: t('created_at'), key: 'created_at' },
];

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
  account_status: null as string | null,
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
  account_status: options.value.account_status || undefined,
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

watch(
  query,
  async (q) => {
    await accountStore.listAccount(q);
  },
  { immediate: true, deep: true }
);
</script>

<template>
  <div>
    <VCard :title="$t('clients_report')" no-padding>
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
          </div>
          <div class="d-flex align-center flex-wrap gap-4">
            <div class="status-filter">
              <VLabel>{{ $t('status') }}:</VLabel>
              <AppAutocomplete
                item-title="text"
                item-value="id"
                :items="itemsStatus"
                v-model="options.account_status"
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
        :items="accountStore.list"
        :items-length="accountStore.pagings.total"
        :loading="accountStore.loading"
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

        <template #item.account_status="{ item }">
          <VChip
            :color="
              getAccountStatusColor(
                item.account_status?.id,
                item.account_status?.name
              )
            "
            size="small"
          >
            {{ item.account_status?.name }}
          </VChip>
        </template>

        <template #item.plan="{ item }">
          <VChip
            v-if="item.plan"
            :color="resolvePlanVariant(item.plan?.name).color"
            class="uc-chip"
            size="small"
          >
            {{ resolvePlanVariant(item.plan?.name).text }}
          </VChip>

          <VChip v-else class="uc-chip uc-badge--muted" size="small">-</VChip>
        </template>

        <template #item.price="{ item }">
          {{
            new Intl.NumberFormat('pt-BR', {
              style: 'currency',
              currency: 'BRL',
            }).format(item.plan?.price ?? 0)
          }}
        </template>

        <template #item.created_at="{ item }">
          <span>{{ formatDateTime(item?.created_at ?? null) }}</span>
        </template>

        <template #no-data>
          {{ $t('no_data_available') }}
        </template>

        <template #bottom>
          <TablePagination
            v-model:page="options.page"
            :items-per-page="options.itemsPerPage"
            :total-items="accountStore.pagings.total"
          />
        </template>
      </VDataTableServer>
    </VCard>
  </div>
</template>

<style lang="scss">
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
</style>
