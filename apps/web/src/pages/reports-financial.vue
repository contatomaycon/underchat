<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EFinancialPermissions } from '@core/common/enums/EPermissions/financial';
import { EReportConversationHistoryPermissions } from '@core/common/enums/EPermissions/reportConversationHistory';
import { useI18n } from 'vue-i18n';
import { useFinancialReportStore } from '@/@webcore/stores/financialReport';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EFinancialPermissions.financial_group,
      EFinancialPermissions.financial_view,
      EReportConversationHistoryPermissions.report_conversation_history_group,
      EReportConversationHistoryPermissions.report_conversation_history_view,
    ],
  },
});

const { t } = useI18n();
const financialReportStore = useFinancialReportStore();
useSnackbarCleanup(financialReportStore);

const viewType = ref<'annual' | 'monthly' | 'daily'>('annual');

const startDate = ref<string | null>(null);
const endDate = ref<string | null>(null);
const startYear = ref<number | null>(null);
const endYear = ref<number | null>(null);

const currentYear = new Date().getFullYear();
const years = computed(() => {
  const yearsList = [];
  for (let year = 2020; year <= currentYear + 1; year++) {
    yearsList.push({ value: year, title: year.toString() });
  }
  return yearsList;
});

const parseDateString = (dateStr: string): Date | null => {
  if (!dateStr.includes('/')) {
    return new Date(dateStr);
  }

  const parts = dateStr.split('/');
  if (parts.length !== 3) {
    return new Date(dateStr);
  }

  const day = Number.parseInt(parts[0], 10);
  const month = Number.parseInt(parts[1], 10);
  const year = Number.parseInt(parts[2], 10);

  if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) {
    return new Date(dateStr);
  }

  return new Date(year, month - 1, day);
};

const formatDateForApi = (
  date: string | Date | null,
  isEndDate = false
): string | null => {
  if (!date) return null;

  let d: Date;

  if (date instanceof Date) {
    d = new Date(date);
  } else {
    const parsed = parseDateString(date);
    if (!parsed) return null;
    d = parsed;
  }

  if (Number.isNaN(d.getTime())) return null;

  if (isEndDate) {
    d.setHours(23, 59, 59, 999);
  } else {
    d.setHours(0, 0, 0, 0);
  }

  return d.toISOString();
};

const query = computed(() => {
  if (viewType.value === 'annual') {
    let startDateValue: string | null = null;
    let endDateValue: string | null = null;

    if (startYear.value) {
      const start = new Date(startYear.value, 0, 1);
      start.setHours(0, 0, 0, 0);
      startDateValue = start.toISOString();
    }

    if (endYear.value) {
      const end = new Date(endYear.value, 11, 31);
      end.setHours(23, 59, 59, 999);
      endDateValue = end.toISOString();
    }

    return {
      start_date: startDateValue,
      end_date: endDateValue,
      period: viewType.value,
    };
  }

  return {
    start_date: formatDateForApi(startDate.value, false),
    end_date: formatDateForApi(endDate.value, true),
    period: viewType.value,
  };
});

const annualRevenue = computed(() => {
  return Number(financialReportStore.report?.total_income || '0');
});

const annualExpense = computed(() => {
  return Number(financialReportStore.report?.total_outgoing || '0');
});

const annualNet = computed(() => {
  return Number(financialReportStore.report?.total_net || '0');
});

const monthlyDetails = computed(() => {
  return financialReportStore.report?.monthly_details || [];
});

const dailyDetails = computed(() => {
  return financialReportStore.report?.daily_details || [];
});

const loadFinancialReport = async () => {
  await financialReportStore.listFinancialReport(query.value);
};

watch([viewType, startDate, endDate, startYear, endYear], () => {
  loadFinancialReport();
});

onMounted(async () => {
  await loadFinancialReport();
});
</script>

<template>
  <div>
    <VCard :title="$t('financial_report')" no-padding>
      <VCardText>
        <div class="d-flex align-center gap-4 mb-6">
          <VTabs v-model="viewType" class="flex-grow-1">
            <VTab value="annual">
              {{ $t('annual') }}
            </VTab>
            <VTab value="monthly" prepend-icon="tabler-calendar">
              {{ $t('monthly') }}
            </VTab>
            <VTab value="daily">
              {{ $t('daily') }}
            </VTab>
          </VTabs>
        </div>

        <div class="d-flex align-center flex-wrap gap-4 mb-6">
          <template v-if="viewType === 'annual'">
            <div class="invoice-list-filter">
              <VLabel>{{ $t('start_year') }}:</VLabel>
              <AppSelect
                v-model="startYear"
                :items="years"
                :placeholder="$t('select_year')"
                clearable
              />
            </div>
            <div class="invoice-list-filter">
              <VLabel>{{ $t('end_year') }}:</VLabel>
              <AppSelect
                v-model="endYear"
                :items="years"
                :placeholder="$t('select_year')"
                clearable
              />
            </div>
          </template>

          <template v-else>
            <div class="invoice-list-filter">
              <VLabel>{{ $t('start_date') }}:</VLabel>
              <AppDateTimePicker
                v-model="startDate"
                :placeholder="$t('select_date')"
              />
            </div>
            <div class="invoice-list-filter">
              <VLabel>{{ $t('end_date') }}:</VLabel>
              <AppDateTimePicker
                v-model="endDate"
                :placeholder="$t('select_date')"
              />
            </div>
          </template>
        </div>

        <VWindow v-model="viewType" class="disable-tab-transition">
          <VWindowItem value="annual">
            <div class="d-flex gap-4 flex-wrap mb-6">
              <VCard class="flex-grow-1" min-width="250">
                <VCardText>
                  <div class="d-flex justify-space-between align-center">
                    <div>
                      <div class="text-body-2 text-medium-emphasis mb-1">
                        {{ $t('annual_revenue') }}
                      </div>
                      <div class="text-h5 text-success font-weight-bold">
                        {{
                          new Intl.NumberFormat('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          }).format(annualRevenue)
                        }}
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

              <VCard class="flex-grow-1" min-width="250">
                <VCardText>
                  <div class="d-flex justify-space-between align-center">
                    <div>
                      <div class="text-body-2 text-medium-emphasis mb-1">
                        {{ $t('annual_expense') }}
                      </div>
                      <div class="text-h5 text-error font-weight-bold">
                        {{
                          new Intl.NumberFormat('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          }).format(annualExpense)
                        }}
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

              <VCard class="flex-grow-1" min-width="250">
                <VCardText>
                  <div class="d-flex justify-space-between align-center">
                    <div>
                      <div class="text-body-2 text-medium-emphasis mb-1">
                        {{ $t('annual_net') }}
                      </div>
                      <div
                        class="text-h5 font-weight-bold"
                        :class="annualNet >= 0 ? 'text-success' : 'text-error'"
                      >
                        {{
                          new Intl.NumberFormat('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          }).format(annualNet)
                        }}
                      </div>
                    </div>
                    <VIcon
                      icon="tabler-currency-dollar"
                      size="40"
                      :color="annualNet >= 0 ? 'success' : 'error'"
                    />
                  </div>
                </VCardText>
              </VCard>
            </div>

            <VCard>
              <VCardTitle>{{ $t('annual_detail') }}</VCardTitle>
              <VCardText>
                <VTable>
                  <thead>
                    <tr>
                      <th scope="col" class="text-left">{{ $t('year') }}</th>
                      <th scope="col" class="text-left">{{ $t('income') }}</th>
                      <th scope="col" class="text-left">
                        {{ $t('outgoing') }}
                      </th>
                      <th scope="col" class="text-left">{{ $t('net') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="detail in monthlyDetails" :key="detail.month">
                      <td>{{ detail.month }}</td>
                      <td class="text-success font-weight-medium">
                        {{
                          new Intl.NumberFormat('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          }).format(Number(detail.income))
                        }}
                      </td>
                      <td class="text-error font-weight-medium">
                        {{
                          new Intl.NumberFormat('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          }).format(Number(detail.outgoing))
                        }}
                      </td>
                      <td
                        class="font-weight-medium"
                        :class="
                          Number(detail.net) >= 0
                            ? 'text-success'
                            : 'text-error'
                        "
                      >
                        {{
                          new Intl.NumberFormat('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          }).format(Number(detail.net))
                        }}
                      </td>
                    </tr>
                  </tbody>
                </VTable>
              </VCardText>
            </VCard>
          </VWindowItem>

          <VWindowItem value="monthly">
            <VCard>
              <VCardTitle>{{ $t('monthly_report') }}</VCardTitle>
              <VCardText>
                <VTable>
                  <thead>
                    <tr>
                      <th scope="col" class="text-left">{{ $t('month') }}</th>
                      <th scope="col" class="text-left">{{ $t('income') }}</th>
                      <th scope="col" class="text-left">
                        {{ $t('outgoing') }}
                      </th>
                      <th scope="col" class="text-left">{{ $t('net') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="detail in monthlyDetails" :key="detail.month">
                      <td>{{ detail.month }}</td>
                      <td class="text-success font-weight-medium">
                        {{
                          new Intl.NumberFormat('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          }).format(Number(detail.income))
                        }}
                      </td>
                      <td class="text-error font-weight-medium">
                        {{
                          new Intl.NumberFormat('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          }).format(Number(detail.outgoing))
                        }}
                      </td>
                      <td
                        class="font-weight-medium"
                        :class="
                          Number(detail.net) >= 0
                            ? 'text-success'
                            : 'text-error'
                        "
                      >
                        {{
                          new Intl.NumberFormat('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          }).format(Number(detail.net))
                        }}
                      </td>
                    </tr>
                    <tr v-if="monthlyDetails.length === 0">
                      <td colspan="4" class="text-center text-medium-emphasis">
                        {{ $t('no_data_available') }}
                      </td>
                    </tr>
                  </tbody>
                </VTable>
              </VCardText>
            </VCard>
          </VWindowItem>

          <VWindowItem value="daily">
            <VCard>
              <VCardTitle>{{ $t('daily_report') }}</VCardTitle>
              <VCardText>
                <VTable>
                  <thead>
                    <tr>
                      <th scope="col" class="text-left">Data</th>
                      <th scope="col" class="text-left">{{ $t('income') }}</th>
                      <th scope="col" class="text-left">
                        {{ $t('outgoing') }}
                      </th>
                      <th scope="col" class="text-left">{{ $t('net') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="detail in dailyDetails" :key="detail.date">
                      <td>{{ detail.date }}</td>
                      <td class="text-success font-weight-medium">
                        {{
                          new Intl.NumberFormat('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          }).format(Number(detail.income))
                        }}
                      </td>
                      <td class="text-error font-weight-medium">
                        {{
                          new Intl.NumberFormat('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          }).format(Number(detail.outgoing))
                        }}
                      </td>
                      <td
                        class="font-weight-medium"
                        :class="
                          Number(detail.net) >= 0
                            ? 'text-success'
                            : 'text-error'
                        "
                      >
                        {{
                          new Intl.NumberFormat('pt-BR', {
                            style: 'currency',
                            currency: 'BRL',
                          }).format(Number(detail.net))
                        }}
                      </td>
                    </tr>
                    <tr v-if="dailyDetails.length === 0">
                      <td colspan="4" class="text-center text-medium-emphasis">
                        {{ $t('no_data_available') }}
                      </td>
                    </tr>
                  </tbody>
                </VTable>
              </VCardText>
            </VCard>
          </VWindowItem>
        </VWindow>
      </VCardText>
    </VCard>
  </div>
</template>

<style lang="scss">
.invoice-list-filter {
  inline-size: 20rem;
}
</style>
