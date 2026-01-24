<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EReportConversationHistoryPermissions } from '@core/common/enums/EPermissions/reportConversationHistory';
import { EReportAttendancePermissions } from '@core/common/enums/EPermissions/reportAttendance';
import { useI18n } from 'vue-i18n';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { DataTableHeader } from 'vuetify';
import BarChart from '@/@webcore/libs/chartjs/components/BarChart';
import DoughnutChart from '@/@webcore/libs/chartjs/components/DoughnutChart';
import { refDebounced } from '@vueuse/core';
import { useReportSatisfactionStore } from '@/@webcore/stores/reportSatisfaction';
import axios from '@webcore/axios';
import type { ReportSatisfactionResult } from '@core/schema/reportSatisfaction/listReportSatisfaction/response.schema';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EReportConversationHistoryPermissions.report_conversation_history_group,
      EReportAttendancePermissions.report_satisfaction_view,
    ],
  },
});

const { t } = useI18n();
const reportSatisfactionStore = useReportSatisfactionStore();
useSnackbarCleanup(reportSatisfactionStore);

type ReportType = 'general' | 'sector' | 'analyst';
type PeriodType = 'month' | 'week' | 'day' | 'hour';

const reportType = ref<ReportType>('general');
const periodType = ref<PeriodType>('month');
const startDate = ref<string | null>(null);
const endDate = ref<string | null>(null);

const reportData = computed(() => reportSatisfactionStore.list);
const summary = computed(() => reportSatisfactionStore.summary);
const loading = computed(() => reportSatisfactionStore.loading);
const isDownloadingPdf = ref(false);
const chartData = ref<any>(null);
const chartOptions = ref<any>(null);
const chartByQuestionData = ref<any>(null);
const chartByQuestionOptions = ref<any>(null);

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
]);

const options = ref({
  page: 1,
  itemsPerPage: 10,
});

const searchQuery = ref('');
const searchQueryDebounced = refDebounced(searchQuery, 500);

const headers = computed<DataTableHeader[]>(() => {
  const base: DataTableHeader[] = [
    { title: t('period'), key: 'period', sortable: true },
    {
      title: t('report_satisfaction_question'),
      key: 'question',
      sortable: true,
    },
    { title: t('total'), key: 'total', sortable: true },
    {
      title: t('report_satisfaction_by_option'),
      key: 'optionBreakdown',
      sortable: false,
    },
  ];
  if (reportType.value === 'sector') {
    base.splice(1, 0, { title: t('sector'), key: 'sector', sortable: true });
  }
  if (reportType.value === 'analyst') {
    base.splice(1, 0, { title: t('analyst'), key: 'analyst', sortable: true });
  }
  return base;
});

const formatOptionWithPercent = (
  optionText: string,
  count: number,
  total: number
): string => {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return `${optionText} (${count} — ${pct.toFixed(1)}%)`;
};

const tableRows = computed(() => {
  return reportData.value.map((r) => ({
    ...r,
    optionBreakdown: r.option_counts
      .map((o) => formatOptionWithPercent(o.option_text, o.count, r.total))
      .join('; '),
  }));
});

const filteredData = computed(() => {
  let data = tableRows.value;
  const q = searchQueryDebounced.value?.toLowerCase();
  if (!q) return data;
  return data.filter(
    (item) =>
      item.period?.toLowerCase().includes(q) ||
      item.question?.toLowerCase().includes(q) ||
      item.sector?.toLowerCase().includes(q) ||
      item.analyst?.toLowerCase().includes(q) ||
      item.optionBreakdown?.toLowerCase().includes(q)
  );
});

const grandTotal = computed(() =>
  filteredData.value.reduce((s, i) => s + (i.total || 0), 0)
);

const hasDateRange = computed(() => Boolean(startDate.value && endDate.value));

const isEmptyAfterLoad = computed(
  () => !loading.value && hasDateRange.value && reportData.value.length === 0
);

const formatDisplayDate = (dateStr: string | null): string => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${d.getUTCFullYear()}`;
};

const formatDateForApi = (
  date: string | Date | null,
  isEnd = false
): string | null => {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  if (isEnd) d.setUTCHours(23, 59, 59, 999);
  if (!isEnd) d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
};

const formatDateForPicker = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const getChartTitle = (): string => {
  const reportLabels: Record<ReportType, string> = {
    general: t('report_satisfaction_title_general'),
    sector: t('report_satisfaction_title_by_sector'),
    analyst: t('report_satisfaction_title_by_analyst'),
  };
  const periodLabels: Record<PeriodType, string> = {
    month: t('month'),
    week: t('week'),
    day: t('day'),
    hour: t('hour'),
  };
  return `${reportLabels[reportType.value]} (${t('report_satisfaction_by')} ${periodLabels[periodType.value]})`;
};

const prepareCharts = (data: ReportSatisfactionResult[]) => {
  if (!data || data.length === 0) {
    chartData.value = { labels: [], datasets: [] };
    chartOptions.value = {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true } },
    };
    chartByQuestionData.value = { labels: [], datasets: [] };
    chartByQuestionOptions.value = {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true } },
    };
    return;
  }

  const OPTION_COLORS = [
    '#4BC0C0',
    '#36A2EB',
    '#FFCE56',
    '#FF9F40',
    '#FF6384',
    '#9966FF',
    '#E0E0E0',
    '#9E9E9E',
  ];
  const barColors = [
    '#36A2EB',
    '#4BC0C0',
    '#FFCE56',
    '#FF9F40',
    '#9966FF',
    '#FF6384',
    '#E0E0E0',
    '#9E9E9E',
  ];

  if (reportType.value === 'sector' || reportType.value === 'analyst') {
    const key = reportType.value === 'sector' ? 'sector' : 'analyst';
    const mainTitle =
      reportType.value === 'sector'
        ? t('report_satisfaction_quantity_by_sector')
        : t('report_satisfaction_quantity_by_analyst');

    const entitySet = new Set<string>();
    const optionSet = new Set<string>();
    const entityToOption = new Map<string, Map<string, number>>();

    for (const r of data) {
      const entity = (r[key] as string) || '-';
      entitySet.add(entity);
      let optMap = entityToOption.get(entity);
      if (!optMap) {
        optMap = new Map<string, number>();
        entityToOption.set(entity, optMap);
      }
      for (const o of r.option_counts) {
        const txt = o.option_text || '-';
        optionSet.add(txt);
        optMap.set(txt, (optMap.get(txt) || 0) + o.count);
      }
    }

    const mainLabels = Array.from(entitySet).sort((a, b) => a.localeCompare(b));
    const options = Array.from(optionSet).sort((a, b) => a.localeCompare(b));

    const datasets = options.map((opt, i) => ({
      label: opt,
      data: mainLabels.map((e) => entityToOption.get(e)?.get(opt) || 0),
      backgroundColor: OPTION_COLORS[i % OPTION_COLORS.length],
    }));

    chartData.value = { labels: mainLabels, datasets };
    chartOptions.value = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' as const },
        title: { display: true, text: mainTitle },
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true },
      },
    };
  } else {
    const byPeriod = new Map<string, number>();
    for (const r of data) {
      byPeriod.set(r.period, (byPeriod.get(r.period) || 0) + r.total);
    }
    const mainLabels = Array.from(byPeriod.keys()).sort((a, b) =>
      a.localeCompare(b)
    );
    const mainValues = mainLabels.map((p) => byPeriod.get(p) || 0);
    const mainTitle = t('report_satisfaction_responses_by_period');

    chartData.value = {
      labels: mainLabels,
      datasets: [
        {
          label: mainTitle,
          data: mainValues,
          backgroundColor: mainLabels.map(
            (_, i) => barColors[i % barColors.length]
          ),
        },
      ],
    };
    chartOptions.value = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' as const },
        title: { display: true, text: mainTitle },
      },
      scales: { y: { beginAtZero: true } },
    };
  }

  const optionToCount = new Map<string, number>();
  for (const r of data) {
    for (const o of r.option_counts) {
      const txt = o.option_text || '-';
      optionToCount.set(txt, (optionToCount.get(txt) || 0) + o.count);
    }
  }
  const optionEntries = Array.from(optionToCount.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );
  const optionLabels = optionEntries.map(([txt, cnt]) => `${txt} (${cnt})`);
  const optionValues = optionEntries.map(([, cnt]) => cnt);
  const colors = [
    '#4BC0C0',
    '#36A2EB',
    '#FFCE56',
    '#FF9F40',
    '#FF6384',
    '#9966FF',
    '#E0E0E0',
    '#9E9E9E',
  ];

  chartByQuestionData.value = {
    labels: optionLabels,
    datasets: [
      {
        data: optionValues,
        backgroundColor: colors.slice(0, optionLabels.length),
      },
    ],
  };
  chartByQuestionOptions.value = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom' as const },
      title: {
        display: true,
        text: t('report_satisfaction_responses_by_option'),
      },
    },
  };
};

const loadReportData = async () => {
  if (!startDate.value || !endDate.value) return;
  const start = formatDateForApi(startDate.value, false);
  const end = formatDateForApi(endDate.value, true);
  if (!start || !end) return;
  try {
    const res = await reportSatisfactionStore.listReportSatisfaction({
      report_type: reportType.value,
      period: periodType.value,
      start_date: start,
      end_date: end,
    });
    if (res) prepareCharts(reportData.value);
  } catch (e) {
    console.error(e);
  }
};

watch([reportType, periodType, startDate, endDate], () => {
  if (startDate.value && endDate.value) loadReportData();
});

const downloadPdf = async () => {
  if (!startDate.value || !endDate.value) return;
  const start = formatDateForApi(startDate.value, false);
  const end = formatDateForApi(endDate.value, true);
  if (!start || !end) return;
  isDownloadingPdf.value = true;
  try {
    const { data } = await axios.get('/report-satisfaction/pdf', {
      params: {
        report_type: reportType.value,
        period: periodType.value,
        start_date: start,
        end_date: end,
      },
      responseType: 'blob',
    });
    const blob = new Blob([data], { type: 'application/pdf' });
    const url = globalThis.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-satisfacao-${new Date().toISOString().split('T')[0]}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    globalThis.URL.revokeObjectURL(url);
  } catch (e) {
    console.error(e);
  } finally {
    isDownloadingPdf.value = false;
  }
};

onMounted(() => {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  endDate.value = formatDateForPicker(today);
  startDate.value = formatDateForPicker(first);
});
</script>

<template>
  <div>
    <VCard :title="$t('satisfaction_reports')" no-padding>
      <VCardText>
        <VCard variant="tonal" color="default" class="mb-6 report-filters">
          <VCardText>
            <div class="d-flex align-center flex-wrap gap-4 mb-3">
              <div class="report-filters__field">
                <VLabel class="text-body-2 mb-1">{{
                  $t('report_type')
                }}</VLabel>
                <AppSelect
                  v-model="reportType"
                  :items="[
                    {
                      value: 'general',
                      title: $t('report_satisfaction_title_general'),
                    },
                    {
                      value: 'sector',
                      title: $t('report_satisfaction_title_by_sector'),
                    },
                    {
                      value: 'analyst',
                      title: $t('report_satisfaction_title_by_analyst'),
                    },
                  ]"
                  :placeholder="$t('select_report_type')"
                />
              </div>
              <div class="report-filters__field">
                <VLabel class="text-body-2 mb-1">{{ $t('start_date') }}</VLabel>
                <AppDateTimePicker
                  v-model="startDate"
                  :placeholder="$t('select_date')"
                />
              </div>
              <div class="report-filters__field">
                <VLabel class="text-body-2 mb-1">{{ $t('end_date') }}</VLabel>
                <AppDateTimePicker
                  v-model="endDate"
                  :placeholder="$t('select_date')"
                />
              </div>
            </div>
            <div class="d-flex align-center">
              <span class="text-body-2 mr-2">{{ $t('period') }}:</span>
              <VTabs
                v-model="periodType"
                density="compact"
                class="report-filters__tabs"
              >
                <VTab value="month">{{ $t('month') }}</VTab>
                <VTab value="week">{{ $t('week') }}</VTab>
                <VTab value="day">{{ $t('day') }}</VTab>
                <VTab value="hour">{{ $t('hour') }}</VTab>
              </VTabs>
            </div>
          </VCardText>
        </VCard>

        <p v-if="hasDateRange" class="text-body-2 text-medium-emphasis mb-6">
          {{ getChartTitle() }} — {{ $t('from') }}
          {{ formatDisplayDate(startDate) }} {{ $t('to') }}
          {{ formatDisplayDate(endDate) }}
        </p>

        <VRow class="mb-6">
          <VCol cols="12" sm="6" md="3">
            <VCard v-if="loading" variant="tonal" color="default">
              <VCardText>
                <VSkeletonLoader type="text, text" />
              </VCardText>
            </VCard>
            <VCard v-else variant="tonal" color="primary">
              <VCardText>
                <div class="text-body-2">
                  {{ $t('report_satisfaction_total_responses') }}
                </div>
                <div class="text-h4">{{ summary.total_responses }}</div>
              </VCardText>
            </VCard>
          </VCol>
          <VCol cols="12" sm="6" md="3">
            <VCard v-if="loading" variant="tonal" color="default">
              <VCardText>
                <VSkeletonLoader type="text, text" />
              </VCardText>
            </VCard>
            <VCard v-else variant="tonal" color="secondary">
              <VCardText>
                <div class="text-body-2">
                  {{ $t('report_satisfaction_unique_satisfactions') }}
                </div>
                <div class="text-h4">{{ summary.unique_satisfactions }}</div>
              </VCardText>
            </VCard>
          </VCol>
        </VRow>

        <VRow class="mb-6">
          <VCol cols="12" md="7">
            <VCard>
              <VCardText v-if="loading">
                <VSkeletonLoader type="image" height="340" class="rounded" />
              </VCardText>
              <VCardText v-else-if="isEmptyAfterLoad" class="report-empty">
                <div
                  class="d-flex flex-column align-center justify-center py-12"
                >
                  <VIcon
                    icon="tabler-chart-bar-off"
                    size="48"
                    class="text-medium-emphasis mb-3"
                  />
                  <span class="text-body-2 text-medium-emphasis">{{
                    $t('report_satisfaction_no_data')
                  }}</span>
                </div>
              </VCardText>
              <VCardText v-else-if="chartData?.labels?.length">
                <div class="report-chart" style="height: 340px">
                  <BarChart
                    :chart-data="chartData"
                    :chart-options="chartOptions"
                    :height="340"
                  />
                </div>
              </VCardText>
              <VCardText v-else class="report-empty">
                <div
                  class="d-flex flex-column align-center justify-center py-12"
                >
                  <VIcon
                    icon="tabler-chart-bar-off"
                    size="48"
                    class="text-medium-emphasis mb-3"
                  />
                  <span class="text-body-2 text-medium-emphasis">{{
                    $t('report_satisfaction_no_data')
                  }}</span>
                </div>
              </VCardText>
            </VCard>
          </VCol>
          <VCol cols="12" md="5">
            <VCard>
              <VCardText v-if="loading">
                <VSkeletonLoader type="image" height="340" class="rounded" />
              </VCardText>
              <VCardText v-else-if="isEmptyAfterLoad" class="report-empty">
                <div
                  class="d-flex flex-column align-center justify-center py-12"
                >
                  <VIcon
                    icon="tabler-chart-donut"
                    size="48"
                    class="text-medium-emphasis mb-3"
                  />
                  <span class="text-body-2 text-medium-emphasis">{{
                    $t('report_satisfaction_no_data')
                  }}</span>
                </div>
              </VCardText>
              <VCardText v-else-if="chartByQuestionData?.labels?.length">
                <div class="report-chart" style="height: 340px">
                  <DoughnutChart
                    :chart-data="chartByQuestionData"
                    :chart-options="chartByQuestionOptions"
                    :height="340"
                  />
                </div>
              </VCardText>
              <VCardText v-else class="report-empty">
                <div
                  class="d-flex flex-column align-center justify-center py-12"
                >
                  <VIcon
                    icon="tabler-chart-donut"
                    size="48"
                    class="text-medium-emphasis mb-3"
                  />
                  <span class="text-body-2 text-medium-emphasis">{{
                    $t('report_satisfaction_no_data')
                  }}</span>
                </div>
              </VCardText>
            </VCard>
          </VCol>
        </VRow>

        <VCard>
          <VCardTitle
            class="d-flex justify-space-between align-center flex-wrap gap-2"
          >
            <span class="text-h6">{{ getChartTitle() }}</span>
            <VBtn
              color="primary"
              variant="outlined"
              size="small"
              :disabled="!hasDateRange || loading || isDownloadingPdf"
              :loading="isDownloadingPdf"
              @click="downloadPdf"
            >
              <VIcon start size="18" icon="tabler-file-type-pdf" />
              {{ $t('download_pdf') }}
            </VBtn>
          </VCardTitle>
          <VCardText>
            <template v-if="loading">
              <VSkeletonLoader type="heading" class="mb-3" />
              <VSkeletonLoader
                v-for="i in 6"
                :key="i"
                type="list-item"
                class="mb-2"
              />
            </template>
            <template v-else>
              <div class="d-flex justify-end align-center mb-3">
                <div class="d-flex align-center gap-3">
                  <AppSelect
                    v-model="options.itemsPerPage"
                    :items="itemsPerPage"
                    style="width: 140px"
                    density="compact"
                  />
                  <VTextField
                    v-model="searchQuery"
                    :placeholder="$t('search')"
                    prepend-inner-icon="tabler-search"
                    density="compact"
                    style="width: 220px"
                    hide-details
                  />
                </div>
              </div>
              <VDivider class="mb-3" />
              <VDataTable
                class="data-table text-no-wrap"
                v-model:page="options.page"
                v-model:items-per-page="options.itemsPerPage"
                :headers="headers"
                :items="filteredData"
                :items-length="filteredData.length"
                hide-default-footer
              >
                <template #bottom>
                  <TablePagination
                    v-model:page="options.page"
                    :items-per-page="options.itemsPerPage"
                    :total-items="filteredData.length"
                  />
                </template>
              </VDataTable>
              <VTable class="mt-3">
                <tbody>
                  <tr class="font-weight-bold">
                    <td>{{ $t('total') }}</td>
                    <td
                      v-if="reportType === 'sector' || reportType === 'analyst'"
                    ></td>
                    <td></td>
                    <td>{{ grandTotal }}</td>
                    <td></td>
                  </tr>
                </tbody>
              </VTable>
            </template>
          </VCardText>
        </VCard>
      </VCardText>
    </VCard>
  </div>
</template>

<style lang="scss" scoped>
.report-filters__field {
  inline-size: 18rem;
}
.report-filters__tabs {
  flex: 1;
  min-width: 0;
}
.report-empty {
  min-height: 200px;
}
.report-chart {
  position: relative;
  width: 100%;
}
.data-table :deep(.v-table__wrapper > table > thead) {
  background-color: rgba(var(--v-theme-on-surface), 0.04);
}
.data-table :deep(.v-table__wrapper > table > thead > tr > th) {
  background-color: transparent;
  color: rgb(var(--v-theme-primary));
  font-weight: 700;
  border-bottom: 1px solid rgba(var(--v-theme-primary), 0.25);
}
</style>
