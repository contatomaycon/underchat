<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EReportConversationHistoryPermissions } from '@core/common/enums/EPermissions/reportConversationHistory';
import { EReportAttendancePermissions } from '@core/common/enums/EPermissions/reportAttendance';
import { useI18n } from 'vue-i18n';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { DataTableHeader } from 'vuetify';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import BarChart from '@/@webcore/libs/chartjs/components/BarChart';
import { refDebounced } from '@vueuse/core';
import { useReportAttendanceStore } from '@/@webcore/stores/reportAttendance';
import axios from '@webcore/axios';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EReportConversationHistoryPermissions.report_conversation_history_group,
      EReportAttendancePermissions.report_attendance_view,
    ],
  },
});

const { t } = useI18n();
const reportAttendanceStore = useReportAttendanceStore();
useSnackbarCleanup(reportAttendanceStore);

// Tipos de relatório
type ReportType = 'queue' | 'analyst' | 'general';
type PeriodType = 'month' | 'week' | 'day' | 'hour';

const reportType = ref<ReportType>('queue');
const periodType = ref<PeriodType>('month');
const startDate = ref<string | null>(null);
const endDate = ref<string | null>(null);

// Dados do relatório
const reportData = computed(() => reportAttendanceStore.list);
const loading = computed(() => reportAttendanceStore.loading);
const chartData = ref<any>(null);
const chartOptions = ref<any>(null);

// Tabela
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
  sortBy: [] as SortRequest[],
});

const searchQuery = ref('');
const searchQueryDebounced = refDebounced(searchQuery, 500);

// Headers da tabela baseados no tipo de relatório
const headers = computed<DataTableHeader[]>(() => {
  const baseHeaders: DataTableHeader[] = [];

  if (reportType.value === 'queue') {
    baseHeaders.push(
      { title: t('period'), key: 'period', sortable: true },
      { title: t('queue'), key: 'queue', sortable: true },
      { title: t('total_attendances'), key: 'total', sortable: true },
      { title: t('total_attendance_time'), key: 'totalTime', sortable: true },
      { title: t('average_wait_time'), key: 'averageWait', sortable: true }
    );
  } else if (reportType.value === 'analyst') {
    baseHeaders.push(
      { title: t('period'), key: 'period', sortable: true },
      { title: t('analyst'), key: 'analyst', sortable: true },
      { title: t('total_attendances'), key: 'total', sortable: true },
      { title: t('total_attendance_time'), key: 'totalTime', sortable: true },
      { title: t('average_wait_time'), key: 'averageWait', sortable: true }
    );
  } else {
    baseHeaders.push(
      { title: t('period'), key: 'period', sortable: true },
      { title: t('total_attendances'), key: 'total', sortable: true },
      { title: t('total_attendance_time'), key: 'totalTime', sortable: true },
      { title: t('average_wait_time'), key: 'averageWait', sortable: true },
      {
        title: t('average_attendance_time'),
        key: 'averageTime',
        sortable: true,
      }
    );
  }

  return baseHeaders;
});

// Dados filtrados para a tabela
const filteredData = computed(() => {
  let data = reportData.value;

  if (searchQueryDebounced.value) {
    const query = searchQueryDebounced.value.toLowerCase();
    data = data.filter((item) => {
      if (reportType.value === 'queue') {
        return (
          item.queue?.toLowerCase().includes(query) ||
          item.period?.toLowerCase().includes(query)
        );
      } else if (reportType.value === 'analyst') {
        return (
          item.analyst?.toLowerCase().includes(query) ||
          item.period?.toLowerCase().includes(query)
        );
      } else {
        return item.period?.toLowerCase().includes(query);
      }
    });
  }

  return data;
});

// Totais
const totals = computed(() => {
  const data = filteredData.value;
  return {
    total: data.reduce((sum, item) => sum + (item.total || 0), 0),
    totalTime: data.reduce((sum, item) => {
      const time = parseTimeToSeconds(item.totalTime || '00:00:00');
      return sum + time;
    }, 0),
    averageWait: data.reduce((sum, item) => {
      const time = parseTimeToSeconds(item.averageWait || '00:00:00');
      return sum + time;
    }, 0),
  };
});

// Função auxiliar para converter tempo em segundos
const parseTimeToSeconds = (timeStr: string): number => {
  const parts = timeStr.split(':');
  if (parts.length === 3) {
    const hours = Number.parseInt(parts[0], 10) || 0;
    const minutes = Number.parseInt(parts[1], 10) || 0;
    const seconds = Number.parseInt(parts[2], 10) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  }
  return 0;
};

// Função auxiliar para formatar segundos em tempo
const formatSecondsToTime = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

// Função para formatar data para exibição
const formatDisplayDate = (dateStr: string | null): string => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  // Usa métodos UTC para evitar problemas de fuso horário
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
};

// Preparar dados do gráfico
const prepareChartData = (data: any[]) => {
  if (!data || data.length === 0) {
    return {
      chartData: {
        labels: [],
        datasets: [],
      },
      chartOptions: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom' as const,
          },
          title: {
            display: true,
            text: getChartTitle(),
          },
        },
        scales: {
          y: {
            beginAtZero: true,
          },
        },
      },
    };
  }

  // Agrupar por período para gráficos com categorias
  if (reportType.value === 'queue' || reportType.value === 'analyst') {
    const periodsMap = new Map<string, Map<string, number>>();
    const categoriesSet = new Set<string>();

    for (const item of data) {
      const period = item.period || '';
      const category =
        reportType.value === 'queue'
          ? item.queue || 'Sem Fila'
          : item.analyst || 'Sem Analista';

      categoriesSet.add(category);

      if (!periodsMap.has(period)) {
        periodsMap.set(period, new Map());
      }

      const periodData = periodsMap.get(period)!;
      periodData.set(category, (periodData.get(category) || 0) + item.total);
    }

    const labels = Array.from(periodsMap.keys()).sort();
    const categories = Array.from(categoriesSet).sort();
    const colors = [
      '#FF6384',
      '#36A2EB',
      '#FFCE56',
      '#4BC0C0',
      '#9966FF',
      '#FF9F40',
    ];

    const datasets = categories.map((category, index) => ({
      label: category,
      data: labels.map((period) => periodsMap.get(period)?.get(category) || 0),
      backgroundColor: colors[index % colors.length],
    }));

    return {
      chartData: {
        labels,
        datasets,
      },
      chartOptions: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom' as const,
          },
          title: {
            display: true,
            text: getChartTitle(),
          },
        },
        scales: {
          y: {
            beginAtZero: true,
          },
        },
      },
    };
  } else {
    // Para relatório geral, apenas mostrar total por período
    const labels = data.map((item) => item.period || '').sort();
    const totals = labels.map((period) => {
      const item = data.find((d) => d.period === period);
      return item?.total || 0;
    });

    return {
      chartData: {
        labels,
        datasets: [
          {
            label: t('total_attendances'),
            data: totals,
            backgroundColor: '#36A2EB',
          },
        ],
      },
      chartOptions: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom' as const,
          },
          title: {
            display: true,
            text: getChartTitle(),
          },
        },
        scales: {
          y: {
            beginAtZero: true,
          },
        },
      },
    };
  }
};

const getChartTitle = (): string => {
  const periodLabels: Record<PeriodType, string> = {
    month: t('month'),
    week: t('week'),
    day: t('day'),
    hour: t('hour'),
  };

  const reportLabels: Record<ReportType, string> = {
    queue: t('attendances_by_queue'),
    analyst: t('attendances_by_analyst'),
    general: t('attendances'),
  };

  return `${reportLabels[reportType.value]} - ${periodLabels[periodType.value]}`;
};

// Função para formatar data para API
const formatDateForApi = (
  date: string | Date | null,
  isEndDate = false
): string | null => {
  if (!date) return null;

  let d: Date;

  if (date instanceof Date) {
    d = new Date(date);
  } else {
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return null;
    d = parsed;
  }

  if (Number.isNaN(d.getTime())) return null;

  // Usa UTC para evitar problemas de fuso horário
  if (isEndDate) {
    d.setUTCHours(23, 59, 59, 999);
  } else {
    d.setUTCHours(0, 0, 0, 0);
  }

  return d.toISOString();
};

// Carregar dados do relatório
const loadReportData = async () => {
  if (!startDate.value || !endDate.value) {
    return;
  }

  const startDateFormatted = formatDateForApi(startDate.value, false);
  const endDateFormatted = formatDateForApi(endDate.value, true);

  if (!startDateFormatted || !endDateFormatted) {
    return;
  }

  try {
    const response = await reportAttendanceStore.listReportAttendance({
      report_type: reportType.value,
      period: periodType.value,
      start_date: startDateFormatted,
      end_date: endDateFormatted,
    });

    if (response) {
      const { chartData: cd, chartOptions: co } = prepareChartData(
        reportData.value
      );
      chartData.value = cd;
      chartOptions.value = co;
    }
  } catch (error) {
    console.error('Erro ao carregar relatório:', error);
  }
};

// Watchers
watch([reportType, periodType, startDate, endDate], () => {
  if (startDate.value && endDate.value) {
    loadReportData();
  }
});

// Função para formatar data para o formato YYYY-MM-DD (formato interno do AppDateTimePicker)
const formatDateForPicker = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Função para baixar PDF
const downloadPdf = async () => {
  if (!startDate.value || !endDate.value) {
    return;
  }

  const startDateFormatted = formatDateForApi(startDate.value, false);
  const endDateFormatted = formatDateForApi(endDate.value, true);

  if (!startDateFormatted || !endDateFormatted) {
    return;
  }

  try {
    const response = await axios.get('/report-attendance/pdf', {
      params: {
        report_type: reportType.value,
        period: periodType.value,
        start_date: startDateFormatted,
        end_date: endDateFormatted,
      },
      responseType: 'blob',
    });

    const blob = new Blob([response.data], { type: 'application/pdf' });
    const url = globalThis.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio-atendimentos-${new Date().toISOString().split('T')[0]}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    globalThis.URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Erro ao baixar PDF:', error);
  }
};

// Inicializar com datas padrão
onMounted(() => {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  endDate.value = formatDateForPicker(today);
  startDate.value = formatDateForPicker(firstDay);
});
</script>

<template>
  <div>
    <VCard :title="$t('attendance_reports')" no-padding>
      <VCardText>
        <!-- Filtros -->
        <div class="d-flex align-center flex-wrap gap-4 mb-6">
          <div class="invoice-list-filter">
            <VLabel>{{ $t('report_type') }}:</VLabel>
            <AppSelect
              v-model="reportType"
              :items="[
                { value: 'queue', title: $t('attendances_by_queue') },
                { value: 'analyst', title: $t('attendances_by_analyst') },
                { value: 'general', title: $t('attendances') },
              ]"
              :placeholder="$t('select_report_type')"
            />
          </div>

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
        </div>

        <!-- Tabs de período -->
        <div class="d-flex align-center gap-4 mb-6">
          <VTabs v-model="periodType" class="flex-grow-1">
            <VTab value="month">
              {{ $t('attendances_by') }} {{ $t('month') }}
            </VTab>
            <VTab value="week">
              {{ $t('attendances_by') }} {{ $t('week') }}
            </VTab>
            <VTab value="day">
              {{ $t('attendances_by') }} {{ $t('day') }}
            </VTab>
            <VTab value="hour">
              {{ $t('attendances_by') }} {{ $t('hour') }}
            </VTab>
          </VTabs>
        </div>

        <!-- Título do relatório -->
        <div class="mb-6" v-if="startDate && endDate">
          <h3 class="text-h5">
            {{ getChartTitle() }} - {{ $t('from') }}
            {{ formatDisplayDate(startDate) }} {{ $t('to') }}
            {{ formatDisplayDate(endDate) }}
          </h3>
        </div>

        <!-- Gráfico -->
        <VCard class="mb-6" v-if="chartData">
          <VCardText>
            <div style="height: 400px">
              <BarChart
                :chart-data="chartData"
                :chart-options="chartOptions"
                :height="400"
              />
            </div>
          </VCardText>
        </VCard>

        <!-- Tabela -->
        <VCard>
          <VCardTitle class="d-flex justify-space-between align-center">
            <span>{{ getChartTitle() }}</span>
            <VBtn
              color="primary"
              variant="outlined"
              prepend-icon="tabler-file-pdf"
              @click="downloadPdf"
              :disabled="!startDate || !endDate || loading"
            >
              {{ $t('download_pdf') }}
            </VBtn>
          </VCardTitle>
          <VCardText>
            <div class="d-flex justify-end align-center mb-4">
              <div class="d-flex align-center gap-4">
                <AppSelect
                  v-model="options.itemsPerPage"
                  :items="itemsPerPage"
                  style="width: 150px"
                />
                <VTextField
                  v-model="searchQuery"
                  :placeholder="$t('search')"
                  prepend-inner-icon="tabler-search"
                  density="compact"
                  style="width: 250px"
                />
              </div>
            </div>

            <VDataTable
              v-model:page="options.page"
              v-model:items-per-page="options.itemsPerPage"
              :headers="headers"
              :items="filteredData"
              :loading="loading"
              :items-length="filteredData.length"
              class="text-no-wrap"
            >
              <template #bottom>
                <TablePagination
                  v-model:page="options.page"
                  :items-per-page="options.itemsPerPage"
                  :total-items="filteredData.length"
                />
              </template>
            </VDataTable>

            <!-- Linha de totais -->
            <VTable class="mt-4">
              <tbody>
                <tr class="font-weight-bold">
                  <td>{{ $t('total') }}</td>
                  <td
                    v-if="reportType === 'queue' || reportType === 'analyst'"
                  ></td>
                  <td>{{ totals.total }}</td>
                  <td>{{ formatSecondsToTime(totals.totalTime) }}</td>
                  <td>{{ formatSecondsToTime(totals.averageWait) }}</td>
                  <td v-if="reportType === 'general'">
                    {{
                      formatSecondsToTime(
                        Math.floor(totals.totalTime / totals.total)
                      )
                    }}
                  </td>
                </tr>
              </tbody>
            </VTable>
          </VCardText>
        </VCard>
      </VCardText>
    </VCard>
  </div>
</template>

<style lang="scss" scoped>
.invoice-list-filter {
  inline-size: 20rem;
}
</style>
