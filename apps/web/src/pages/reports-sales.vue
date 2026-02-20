<script setup lang="ts">
import { ref, watch, computed, onMounted } from 'vue';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { DataTableHeader } from 'vuetify';
import { useReportSalesStore } from '@/@webcore/stores/reportSales';
import { ListPlanSalesResponse } from '@core/schema/plan/listPlanSales/response.schema';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { EFinancialPermissions } from '@core/common/enums/EPermissions/financial';
import { EPaymentBillingType } from '@core/common/enums/EPaymentBillingType';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EFinancialPermissions.financial_group,
      EFinancialPermissions.financial_view,
    ],
  },
});

const { t } = useI18n();
const reportSalesStore = useReportSalesStore();
useSnackbarCleanup(reportSalesStore);

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
]);

const headers: DataTableHeader<ListPlanSalesResponse>[] = [
  { title: t('account_name'), key: 'account_name' },
  { title: t('plan_name'), key: 'plan_name' },
  { title: t('price'), key: 'price' },
  { title: t('price_old'), key: 'price_old' },
  { title: t('total_revenue'), key: 'total_revenue' },
  { title: t('payment_type'), key: 'payment_billing_type_name' },
  { title: t('cross_sells'), key: 'cross_sells' },
  { title: t('contracted_at'), key: 'contracted_at' },
];

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
});

const selectedPlan = ref<string | null>(null);
const startDate = ref<string | null>(null);
const endDate = ref<string | null>(null);
const selectedPaymentType = ref<string | null>(null);

const plans = ref<Array<{ id: string | null; text: string }>>([]);

const paymentTypes = ref<Array<{ id: string | null; text: string }>>([
  { id: null, text: t('all') },
  { id: EPaymentBillingType.boleto, text: t('payment_billing_type_boleto') },
  {
    id: EPaymentBillingType.credit_card,
    text: t('payment_billing_type_credit_card'),
  },
  {
    id: EPaymentBillingType.debit_card,
    text: t('payment_billing_type_debit_card'),
  },
  { id: EPaymentBillingType.pix, text: t('payment_billing_type_pix') },
  {
    id: EPaymentBillingType.transfer,
    text: t('payment_billing_type_transfer'),
  },
  {
    id: EPaymentBillingType.deposit,
    text: t('payment_billing_type_deposit'),
  },
]);

onMounted(async () => {
  await reportSalesStore.listPlanAll();
  plans.value = [
    { id: null, text: t('all') },
    ...reportSalesStore.listAll.map((plan) => ({
      id: plan.plan_id,
      text: plan.name,
    })),
  ];
  await loadSales();
});

const formatDateForApi = (
  date: string | null,
  isEndDate = false
): string | null => {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  if (isEndDate) {
    d.setHours(23, 59, 59, 999);
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return d.toISOString();
};

const query = computed(() => {
  return {
    plan_id: selectedPlan.value || null,
    start_date: formatDateForApi(startDate.value, false),
    end_date: formatDateForApi(endDate.value, true),
    payment_billing_type_id: selectedPaymentType.value || null,
  };
});

const totalSales = computed(() => {
  return reportSalesStore.listSales.length;
});

const totalRevenue = computed(() => {
  return reportSalesStore.listSales.reduce(
    (sum, item) => sum + Number(item.total_revenue),
    0
  );
});

const loadSales = async () => {
  await reportSalesStore.listPlanSales(query.value);
};

watch([selectedPlan, startDate, endDate, selectedPaymentType], () => {
  loadSales();
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

const showCrossSellsDialog = ref(false);
const selectedPlanCrossSells = ref<ListPlanSalesResponse['cross_sells']>([]);
const selectedPlanName = ref<string>('');
const selectedPlanItem = ref<ListPlanSalesResponse | null>(null);

const openCrossSellsDialog = (item: ListPlanSalesResponse) => {
  selectedPlanCrossSells.value = item.cross_sells;
  selectedPlanName.value = item.plan_name;
  selectedPlanItem.value = item;
  showCrossSellsDialog.value = true;
};

const totalAddonsValue = computed(() => {
  return selectedPlanCrossSells.value.reduce(
    (sum, cs) => sum + Number(cs.total_price),
    0
  );
});

const planRevenueDialog = computed(() => {
  if (!selectedPlanItem.value) return 0;
  return Number(selectedPlanItem.value.price);
});

const totalRevenueDialog = computed(() => {
  return planRevenueDialog.value + totalAddonsValue.value;
});

const getPaymentBillingTypeIcon = (
  typeName: string | null | undefined
): string => {
  if (!typeName) return 'tabler-currency-dollar';
  const iconMap: Record<string, string> = {
    BOLETO: 'tabler-file-invoice',
    CREDIT_CARD: 'tabler-credit-card',
    DEBIT_CARD: 'tabler-credit-card-off',
    PIX: 'tabler-qrcode',
    TRANSFER: 'tabler-transfer',
    DEPOSIT: 'tabler-building-bank',
  };
  return iconMap[typeName] || 'tabler-currency-dollar';
};

const getPaymentBillingTypeLabel = (
  typeName: string | null | undefined
): string => {
  if (!typeName) return '-';
  const translationKey = `payment_billing_type_${typeName.toLowerCase()}`;
  return t(translationKey, typeName);
};
</script>

<template>
  <div>
    <div class="d-flex gap-4 mb-6">
      <VCard class="flex-1">
        <VCardText>
          <div class="d-flex justify-space-between align-center">
            <div>
              <div class="text-body-2 text-medium-emphasis mb-1">
                {{ $t('total_sales') }}
              </div>
              <div class="text-h4 font-weight-bold text-primary">
                {{ totalSales }}
              </div>
            </div>
            <VAvatar color="primary" variant="tonal" size="56">
              <VIcon size="28">tabler-package</VIcon>
            </VAvatar>
          </div>
        </VCardText>
      </VCard>

      <VCard class="flex-1">
        <VCardText>
          <div class="d-flex justify-space-between align-center">
            <div>
              <div class="text-body-2 text-medium-emphasis mb-1">
                {{ $t('total_revenue') }}
              </div>
              <div class="text-h4 font-weight-bold text-success">
                {{
                  new Intl.NumberFormat('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  }).format(totalRevenue)
                }}
              </div>
            </div>
            <VAvatar color="success" variant="tonal" size="56">
              <VIcon size="28">tabler-currency-dollar</VIcon>
            </VAvatar>
          </div>
        </VCardText>
      </VCard>
    </div>

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
            <div class="invoice-list-filter">
              <VLabel class="text-body-2 mb-1">{{ $t('plan') }}:</VLabel>
              <AppSelectSearch
                v-model="selectedPlan"
                :items="plans as any"
                :placeholder="$t('select_plan')"
                :clearable="true"
                item-value="id"
                item-title="text"
              />
            </div>
            <div class="invoice-list-filter">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('payment_type') }}:</VLabel
              >
              <AppSelectSearch
                v-model="selectedPaymentType"
                :items="paymentTypes as any"
                :placeholder="$t('select_payment_type')"
                :clearable="true"
                item-value="id"
                item-title="text"
              />
            </div>
            <div class="invoice-list-filter">
              <VLabel class="text-body-2 mb-1">{{ $t('start_date') }}:</VLabel>
              <AppDateTimePicker
                v-model="startDate"
                :placeholder="$t('select_date')"
              />
            </div>
            <div class="invoice-list-filter">
              <VLabel class="text-body-2 mb-1">{{ $t('end_date') }}:</VLabel>
              <AppDateTimePicker
                v-model="endDate"
                :placeholder="$t('select_date')"
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
            :items="reportSalesStore.listSales"
            :items-length="reportSalesStore.listSales.length"
            :loading="reportSalesStore.loading"
            :sort-by="options.sortBy"
            @update:options="handleTableChange"
            :loading-text="$t('loading_text')"
          >
            <template #item.account_name="{ item }">
              <div class="d-flex flex-column ms-3">
                <span
                  class="d-block font-weight-medium text-high-emphasis text-truncate"
                >
                  {{ item.account_name }}
                </span>
              </div>
            </template>

            <template #item.plan_name="{ item }">
              <div class="d-flex flex-column ms-3">
                <span
                  class="d-block font-weight-medium text-high-emphasis text-truncate"
                >
                  {{ item.plan_name }}
                </span>
              </div>
            </template>

            <template #item.price="{ item }">
              {{
                new Intl.NumberFormat('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                }).format(Number(item.price))
              }}
            </template>

            <template #item.price_old="{ item }">
              <s>{{
                new Intl.NumberFormat('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                }).format(Number(item.price_old))
              }}</s>
            </template>

            <template #item.total_revenue="{ item }">
              <span class="text-success font-weight-medium">
                {{
                  new Intl.NumberFormat('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  }).format(Number(item.total_revenue))
                }}
              </span>
            </template>

            <template #item.payment_billing_type_name="{ item }">
              <div class="d-flex align-center gap-2">
                <VIcon
                  :icon="
                    getPaymentBillingTypeIcon(item.payment_billing_type_name)
                  "
                  size="18"
                  color="primary"
                />
                <span>{{
                  getPaymentBillingTypeLabel(item.payment_billing_type_name)
                }}</span>
              </div>
            </template>

            <template #item.cross_sells="{ item }">
              <div class="d-flex align-center gap-2">
                <VBtn
                  v-if="item.cross_sells.length > 0"
                  size="small"
                  color="primary"
                  variant="outlined"
                  @click="openCrossSellsDialog(item)"
                >
                  {{ $t('view_addons') }} ({{ item.cross_sells.length }})
                </VBtn>
                <span v-else class="text-caption text-medium-emphasis">
                  {{ $t('no_addons') }}
                </span>
              </div>
            </template>

            <template #item.contracted_at="{ item }">
              <span>{{ formatDateTime(item.contracted_at ?? null) }}</span>
            </template>

            <template #no-data>
              {{ $t('no_data_available') }}
            </template>

            <template #bottom>
              <TablePagination
                v-model:page="options.page"
                :items-per-page="options.itemsPerPage"
                :total-items="reportSalesStore.listSales.length"
              />
            </template>
          </VDataTableServer>
        </div>
      </VCardText>
    </VCard>

    <VDialog v-model="showCrossSellsDialog" max-width="700" scrollable>
      <VCard>
        <VCardTitle class="d-flex justify-space-between align-center pa-4">
          <div class="d-flex flex-column">
            <span class="text-body-2 text-medium-emphasis mb-1">
              {{ $t('addons_for_plan') }}
            </span>
            <span class="text-h5 font-weight-bold text-primary">
              {{ selectedPlanName }}
            </span>
          </div>
          <VBtn
            icon
            variant="text"
            size="small"
            @click="showCrossSellsDialog = false"
          >
            <VIcon>tabler-x</VIcon>
          </VBtn>
        </VCardTitle>
        <VDivider />
        <VCardText class="pa-0">
          <div v-if="selectedPlanItem" class="pa-4 bg-surface">
            <div class="d-flex justify-space-between align-center mb-2">
              <span class="text-body-2 text-medium-emphasis">
                {{ $t('plan_revenue') }}
              </span>
              <span class="text-body-1 font-weight-medium">
                {{
                  new Intl.NumberFormat('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  }).format(planRevenueDialog)
                }}
              </span>
            </div>
          </div>

          <div
            v-if="selectedPlanCrossSells.length === 0"
            class="text-center py-8"
          >
            <VIcon size="48" color="disabled" class="mb-2"
              >tabler-package-off</VIcon
            >
            <p class="text-medium-emphasis">{{ $t('no_addons') }}</p>
          </div>
          <div v-else class="addons-list-container">
            <div class="pa-4">
              <h3 class="text-subtitle-1 mb-3">{{ $t('addons_list') }}</h3>
            </div>
            <VList class="pa-0">
              <VListItem
                v-for="crossSell in selectedPlanCrossSells"
                :key="crossSell.plan_cross_sell_id"
                class="px-4 py-3"
              >
                <template #prepend>
                  <VAvatar
                    color="primary"
                    variant="tonal"
                    size="40"
                    class="me-3"
                  >
                    <VIcon>tabler-package</VIcon>
                  </VAvatar>
                </template>
                <VListItemTitle class="font-weight-medium mb-1">
                  {{ crossSell.plan_product_name || $t('unnamed_product') }}
                </VListItemTitle>
                <VListItemSubtitle>
                  <div class="d-flex align-center gap-2 mt-1">
                    <VChip size="small" color="info" variant="tonal">
                      {{ $t('quantity') }}: {{ crossSell.cross_sell_quantity }}
                    </VChip>
                  </div>
                </VListItemSubtitle>
                <template #append>
                  <div class="d-flex flex-column align-end">
                    <span class="text-success font-weight-bold text-body-1">
                      {{
                        new Intl.NumberFormat('pt-BR', {
                          style: 'currency',
                          currency: 'BRL',
                        }).format(Number(crossSell.total_price))
                      }}
                    </span>
                  </div>
                </template>
              </VListItem>
            </VList>
          </div>
        </VCardText>
        <VDivider />
        <VCardText class="pa-4 bg-surface">
          <div class="d-flex flex-column gap-2">
            <div class="d-flex justify-space-between align-center">
              <span class="text-body-2 text-medium-emphasis">
                {{ $t('plan_revenue') }}
              </span>
              <span class="text-body-1">
                {{
                  new Intl.NumberFormat('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  }).format(planRevenueDialog)
                }}
              </span>
            </div>
            <div
              v-if="selectedPlanCrossSells.length > 0"
              class="d-flex justify-space-between align-center"
            >
              <span class="text-body-2 text-medium-emphasis">
                {{ $t('addons_total') }}
              </span>
              <span class="text-body-1">
                {{
                  new Intl.NumberFormat('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  }).format(totalAddonsValue)
                }}
              </span>
            </div>
            <VDivider class="my-1" />
            <div class="d-flex justify-space-between align-center">
              <span class="text-h6 font-weight-bold">{{
                $t('total_revenue')
              }}</span>
              <span class="text-h6 text-success font-weight-bold">
                {{
                  new Intl.NumberFormat('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  }).format(totalRevenueDialog)
                }}
              </span>
            </div>
          </div>
        </VCardText>
        <VDivider />
        <VCardActions class="pa-4">
          <VSpacer />
          <VBtn
            color="primary"
            variant="elevated"
            @click="showCrossSellsDialog = false"
          >
            {{ $t('close') }}
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>
  </div>
</template>

<style lang="scss" scoped>
.invoice-list-filter {
  inline-size: 20rem;
}

.addons-list-container {
  max-height: 240px;
  overflow-y: auto;

  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-track {
    background: rgba(var(--v-theme-surface), 1);
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(var(--v-theme-on-surface), 0.2);
    border-radius: 4px;

    &:hover {
      background: rgba(var(--v-theme-on-surface), 0.3);
    }
  }
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
