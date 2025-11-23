<script setup lang="ts">
import { ref, watch, computed, onMounted } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { DataTableHeader } from 'vuetify';
import { EPlanPermissions } from '@core/common/enums/EPermissions/plan';
import { usePlanStore } from '@/@webcore/stores/plan';
import { SalesReportItem } from '@core/schema/plan/listSalesReport/response.schema';
import { ListPlanAllResponse } from '@core/schema/plan/listPlanAll/response.schema';

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

const headers: DataTableHeader<SalesReportItem>[] = [
  { title: t('plan_name'), key: 'name' },
  { title: t('price'), key: 'price' },
  { title: t('price_old'), key: 'price_old' },
  { title: t('sold_count'), key: 'sold_count' },
  { title: t('total_revenue'), key: 'total_revenue' },
  { title: t('created_at'), key: 'created_at' },
];

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
  plan_id: null as string | null,
  date_from: null as string | null,
  date_to: null as string | null,
  search: null as string | null,
});

const debouncedSearch = refDebounced(
  computed(() => options.value.search),
  500
);

const salesData = ref<SalesReportItem[]>([]);
const planOptions = ref<ListPlanAllResponse[]>([]);
const totalItems = ref(0);

const loadSalesReport = async () => {
  const request: any = {
    current_page: options.value.page,
    per_page:
      options.value.itemsPerPage === -1 ? 1000 : options.value.itemsPerPage,
    sort_by: options.value.sortBy,
  };

  if (options.value.plan_id) {
    request.plan_id = options.value.plan_id;
  }

  if (options.value.date_from) {
    request.date_from = options.value.date_from;
  }

  if (options.value.date_to) {
    request.date_to = options.value.date_to;
  }

  if (debouncedSearch.value) {
    request.search = debouncedSearch.value;
  }

  const response = await planStore.listSalesReport(request);

  if (response) {
    salesData.value = response.results;
    totalItems.value = response.pagings.total;
  }
};

const loadPlans = async () => {
  const plans = await planStore.listPlanAll();
  if (plans) {
    planOptions.value = plans;
  }
};

watch(
  () => [
    options.value.page,
    options.value.itemsPerPage,
    options.value.plan_id,
    options.value.date_from,
    options.value.date_to,
    debouncedSearch.value,
  ],
  () => {
    options.value.page = 1;
    loadSalesReport();
  },
  { deep: true }
);

onMounted(async () => {
  await loadPlans();
  await loadSalesReport();
});

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
};

const formatCurrencyValue = (value: string | number) => {
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  return formatCurrency(numValue);
};
</script>

<template>
  <div>
    <VCard :title="$t('sales_report')" no-padding>
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
            <div class="plan-filter">
              <VLabel>{{ $t('plan') }}:</VLabel>
              <AppAutocomplete
                item-title="name"
                item-value="plan_id"
                :items="planOptions"
                v-model="options.plan_id"
                :placeholder="$t('select_plan')"
                clearable
              />
            </div>
            <div class="date-filter">
              <VLabel>{{ $t('date_from') }}:</VLabel>
              <AppDateTimePicker
                v-model="options.date_from"
                :placeholder="$t('select_date')"
              />
            </div>
            <div class="date-filter">
              <VLabel>{{ $t('date_to') }}:</VLabel>
              <AppDateTimePicker
                v-model="options.date_to"
                :placeholder="$t('select_date')"
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
        :headers="headers"
        :items="salesData"
        :items-per-page="options.itemsPerPage"
        :page="options.page"
        :items-length="totalItems"
        :loading="planStore.loading"
        class="text-no-wrap"
        @update:page="options.page = $event"
        @update:items-per-page="options.itemsPerPage = $event"
      >
        <template #item.name="{ item }">
          <span class="font-weight-medium">{{ item.name }}</span>
        </template>

        <template #item.price="{ item }">
          {{ formatCurrencyValue(item.price) }}
        </template>

        <template #item.price_old="{ item }">
          <s>{{ formatCurrencyValue(item.price_old) }}</s>
        </template>

        <template #item.sold_count="{ item }">
          <VChip color="primary" size="small">
            {{ item.sold_count }}
          </VChip>
        </template>

        <template #item.total_revenue="{ item }">
          <span class="font-weight-semibold text-success">
            {{ formatCurrencyValue(item.total_revenue) }}
          </span>
        </template>

        <template #item.created_at="{ item }">
          <span>{{ formatDateTime(item.created_at) }}</span>
        </template>

        <template #no-data>
          {{ $t('no_data_available') }}
        </template>

        <template #bottom>
          <TablePagination
            v-model:page="options.page"
            :items-per-page="options.itemsPerPage"
            :total-items="totalItems"
          />
        </template>
      </VDataTableServer>
    </VCard>
  </div>
</template>

<style lang="scss">
.plan-filter {
  inline-size: 15rem;
}

.date-filter {
  inline-size: 12rem;
}

.invoice-list-filter {
  inline-size: 20rem;
}
</style>
