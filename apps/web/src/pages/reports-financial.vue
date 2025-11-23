<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { DataTableHeader } from 'vuetify';
import { EFinancialPermissions } from '@core/common/enums/EPermissions/financial';
import { useFinancialStore } from '@/@webcore/stores/financial';
import { ListFinancialReportRequest } from '@core/schema/financial/listFinancialReport/request.schema';

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
const financialStore = useFinancialStore();

const viewType = ref<'annual' | 'monthly' | 'daily'>('annual');

const formatCurrency = (value: string | number) => {
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(numValue || 0);
};

const headersDaily: DataTableHeader[] = [
  { title: t('date'), key: 'date' },
  { title: t('income'), key: 'income' },
  { title: t('expense'), key: 'expense' },
  { title: t('net'), key: 'net' },
];

const headersMonthly: DataTableHeader[] = [
  { title: t('month'), key: 'month' },
  { title: t('income'), key: 'income' },
  { title: t('expense'), key: 'expense' },
  { title: t('net'), key: 'net' },
];

const filteredData = computed(() => {
  if (viewType.value === 'daily') {
    return financialStore.dailyReport || [];
  }

  if (viewType.value === 'monthly') {
    return financialStore.monthlyReport || [];
  }

  return [];
});

const totalIncome = computed(() => {
  return filteredData.value.reduce(
    (sum, item) => sum + parseFloat(item.income || '0'),
    0
  );
});

const totalExpense = computed(() => {
  return filteredData.value.reduce(
    (sum, item) => sum + parseFloat(item.expense || '0'),
    0
  );
});

const annualRevenue = computed(() => {
  return parseFloat(financialStore.annualReport?.annual_income || '0');
});

const annualExpense = computed(() => {
  return parseFloat(financialStore.annualReport?.annual_expense || '0');
});

const monthlyBreakdown = computed(() => {
  return financialStore.annualReport?.monthly_breakdown || [];
});

const loadFinancialReport = async () => {
  const request: ListFinancialReportRequest = {
    view_type: viewType.value,
  };

  await financialStore.listFinancialReport(request);
};

watch(viewType, () => {
  loadFinancialReport();
});

onMounted(() => {
  loadFinancialReport();
});
</script>

<template>
  <div>
    <VCard :title="$t('financial_report')" no-padding>
      <VCardText>
        <div class="mb-6">
          <VLabel class="mb-3 d-block text-body-1 font-weight-medium">
            {{ $t('view_type') }}
          </VLabel>
          <VTabs v-model="viewType" class="financial-view-tabs">
            <VTab value="annual">
              <VIcon icon="tabler-calendar-year" class="me-2" />
              {{ $t('annual') }}
            </VTab>
            <VTab value="monthly">
              <VIcon icon="tabler-calendar-month" class="me-2" />
              {{ $t('monthly') }}
            </VTab>
            <VTab value="daily">
              <VIcon icon="tabler-calendar-day" class="me-2" />
              {{ $t('daily') }}
            </VTab>
          </VTabs>
        </div>

        <!-- Annual View -->
        <div v-if="viewType === 'annual'">
          <VRow>
            <VCol cols="12" md="4">
              <VCard>
                <VCardText>
                  <div class="d-flex justify-space-between align-center">
                    <div>
                      <div class="text-body-2 text-medium-emphasis">
                        {{ $t('annual_revenue') }}
                      </div>
                      <div class="text-h4 font-weight-semibold text-success">
                        {{ formatCurrency(annualRevenue) }}
                      </div>
                    </div>
                    <VIcon
                      icon="tabler-currency-dollar"
                      size="40"
                      color="success"
                    />
                  </div>
                </VCardText>
              </VCard>
            </VCol>
            <VCol cols="12" md="4">
              <VCard>
                <VCardText>
                  <div class="d-flex justify-space-between align-center">
                    <div>
                      <div class="text-body-2 text-medium-emphasis">
                        {{ $t('annual_expense') }}
                      </div>
                      <div class="text-h4 font-weight-semibold text-error">
                        {{ formatCurrency(annualExpense) }}
                      </div>
                    </div>
                    <VIcon
                      icon="tabler-currency-dollar"
                      size="40"
                      color="error"
                    />
                  </div>
                </VCardText>
              </VCard>
            </VCol>
            <VCol cols="12" md="4">
              <VCard>
                <VCardText>
                  <div class="d-flex justify-space-between align-center">
                    <div>
                      <div class="text-body-2 text-medium-emphasis">
                        {{ $t('annual_net') }}
                      </div>
                      <div
                        class="text-h4 font-weight-semibold"
                        :class="
                          annualRevenue - annualExpense >= 0
                            ? 'text-success'
                            : 'text-error'
                        "
                      >
                        {{ formatCurrency(annualRevenue - annualExpense) }}
                      </div>
                    </div>
                    <VIcon
                      icon="tabler-currency-dollar"
                      size="40"
                      :color="
                        annualRevenue - annualExpense >= 0 ? 'success' : 'error'
                      "
                    />
                  </div>
                </VCardText>
              </VCard>
            </VCol>
            <VCol cols="12">
              <VCard>
                <VCardTitle>{{ $t('monthly_breakdown') }}</VCardTitle>
                <VCardText>
                  <VTable>
                    <thead>
                      <tr>
                        <th>{{ $t('month') }}</th>
                        <th class="text-end">{{ $t('income') }}</th>
                        <th class="text-end">{{ $t('expense') }}</th>
                        <th class="text-end">{{ $t('net') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="item in monthlyBreakdown" :key="item.month">
                        <td>{{ item.month }}</td>
                        <td class="text-end text-success font-weight-semibold">
                          {{ formatCurrency(item.income) }}
                        </td>
                        <td class="text-end text-error font-weight-semibold">
                          {{ formatCurrency(item.expense) }}
                        </td>
                        <td
                          class="text-end font-weight-semibold"
                          :class="
                            parseFloat(item.income || '0') -
                              parseFloat(item.expense || '0') >=
                            0
                              ? 'text-success'
                              : 'text-error'
                          "
                        >
                          {{ formatCurrency(item.net) }}
                        </td>
                      </tr>
                    </tbody>
                  </VTable>
                </VCardText>
              </VCard>
            </VCol>
          </VRow>
        </div>

        <!-- Monthly View -->
        <div v-if="viewType === 'monthly'">
          <VCard>
            <VCardText>
              <div class="d-flex justify-space-between mb-4">
                <div>
                  <div class="text-body-2 text-medium-emphasis">
                    {{ $t('total_income') }}
                  </div>
                  <div class="text-h5 font-weight-semibold text-success">
                    {{ formatCurrency(totalIncome) }}
                  </div>
                </div>
                <div>
                  <div class="text-body-2 text-medium-emphasis">
                    {{ $t('total_expense') }}
                  </div>
                  <div class="text-h5 font-weight-semibold text-error">
                    {{ formatCurrency(totalExpense) }}
                  </div>
                </div>
                <div>
                  <div class="text-body-2 text-medium-emphasis">
                    {{ $t('net') }}
                  </div>
                  <div
                    class="text-h5 font-weight-semibold"
                    :class="
                      totalIncome - totalExpense >= 0
                        ? 'text-success'
                        : 'text-error'
                    "
                  >
                    {{ formatCurrency(totalIncome - totalExpense) }}
                  </div>
                </div>
              </div>
              <VDataTable
                :headers="headersMonthly"
                :items="filteredData"
                :items-per-page="12"
                :loading="financialStore.loading"
                class="text-no-wrap"
              >
                <template #item.month="{ item }">
                  <span class="font-weight-medium">{{
                    'month' in item ? item.month : ''
                  }}</span>
                </template>
                <template #item.income="{ item }">
                  <span class="text-success font-weight-semibold">
                    {{ formatCurrency(item.income || '0') }}
                  </span>
                </template>
                <template #item.expense="{ item }">
                  <span class="text-error font-weight-semibold">
                    {{ formatCurrency(item.expense || '0') }}
                  </span>
                </template>
                <template #item.net="{ item }">
                  <span
                    :class="
                      parseFloat(item.income || '0') -
                        parseFloat(item.expense || '0') >=
                      0
                        ? 'text-success font-weight-semibold'
                        : 'text-error font-weight-semibold'
                    "
                  >
                    {{ formatCurrency(item.net || '0') }}
                  </span>
                </template>
              </VDataTable>
            </VCardText>
          </VCard>
        </div>

        <!-- Daily View -->
        <div v-if="viewType === 'daily'">
          <VCard>
            <VCardText>
              <div class="d-flex justify-space-between mb-4">
                <div>
                  <div class="text-body-2 text-medium-emphasis">
                    {{ $t('total_income') }}
                  </div>
                  <div class="text-h5 font-weight-semibold text-success">
                    {{ formatCurrency(totalIncome) }}
                  </div>
                </div>
                <div>
                  <div class="text-body-2 text-medium-emphasis">
                    {{ $t('total_expense') }}
                  </div>
                  <div class="text-h5 font-weight-semibold text-error">
                    {{ formatCurrency(totalExpense) }}
                  </div>
                </div>
                <div>
                  <div class="text-body-2 text-medium-emphasis">
                    {{ $t('net') }}
                  </div>
                  <div
                    class="text-h5 font-weight-semibold"
                    :class="
                      totalIncome - totalExpense >= 0
                        ? 'text-success'
                        : 'text-error'
                    "
                  >
                    {{ formatCurrency(totalIncome - totalExpense) }}
                  </div>
                </div>
              </div>
              <VDataTable
                :headers="headersDaily"
                :items="filteredData"
                :items-per-page="10"
                :loading="financialStore.loading"
                class="text-no-wrap"
              >
                <template #item.date="{ item }">
                  {{
                    formatDateTime(
                      'date' in item && item.date ? item.date : null
                    )
                  }}
                </template>
                <template #item.income="{ item }">
                  <span class="text-success font-weight-semibold">
                    {{ formatCurrency(item.income || '0') }}
                  </span>
                </template>
                <template #item.expense="{ item }">
                  <span class="text-error font-weight-semibold">
                    {{ formatCurrency(item.expense || '0') }}
                  </span>
                </template>
                <template #item.net="{ item }">
                  <span
                    :class="
                      parseFloat(item.income || '0') -
                        parseFloat(item.expense || '0') >=
                      0
                        ? 'text-success font-weight-semibold'
                        : 'text-error font-weight-semibold'
                    "
                  >
                    {{ formatCurrency(item.net || '0') }}
                  </span>
                </template>
              </VDataTable>
            </VCardText>
          </VCard>
        </div>
      </VCardText>
    </VCard>
  </div>
</template>

<style lang="scss">
.financial-view-tabs {
  .v-tab {
    min-width: 140px;
    text-transform: none;
    font-weight: 500;
  }
}
</style>
