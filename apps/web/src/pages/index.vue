<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useTheme } from 'vuetify';
import { useI18n } from 'vue-i18n';
import { hexToRgb } from '@webcore/utils/colorConverter';
import BarChart from '@/@webcore/libs/chartjs/components/BarChart';
import LineChart from '@/@webcore/libs/chartjs/components/LineChart';
import DoughnutChart from '@/@webcore/libs/chartjs/components/DoughnutChart';
import CardStatisticsVertical from '@/@webcore/components/cards/CardStatisticsVertical.vue';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { useDashboardStore } from '@/@webcore/stores/dashboard';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';

const { t } = useI18n();
const channelsStore = useChannelsStore();
const dashboardStore = useDashboardStore();
useSnackbarCleanup(channelsStore);
useSnackbarCleanup(dashboardStore);

const theme = useTheme();

const getThemeColor = (colorName: string): string => {
  const color = theme.current.value.colors[colorName];
  if (!color) return '#000000';
  const rgb = hexToRgb(color);
  return `rgb(${rgb})`;
};

const usersTotal = computed(() => dashboardStore.stats?.users.total ?? 0);
const channelsTotal = computed(() => dashboardStore.stats?.channels.total ?? 0);
const channelsConnected = computed(
  () => dashboardStore.stats?.channels.connected ?? 0
);
const channelsAllowed = computed(
  () => dashboardStore.stats?.channels.allowed ?? 0
);
const contactsTotal = computed(() => dashboardStore.stats?.contacts.total ?? 0);
const contactsGrowth = computed(
  () => dashboardStore.stats?.contacts.growth ?? 0
);
const chatsActive = computed(() => dashboardStore.conversations?.active ?? 0);
const chatbotsActive = computed(
  () => dashboardStore.additional?.chatbots.active ?? 0
);
const chatbotsTotal = computed(
  () => dashboardStore.additional?.chatbots.total ?? 0
);
const contactGroupsTotal = computed(
  () => dashboardStore.additional?.contact_groups ?? 0
);
const messageTemplatesTotal = computed(
  () => dashboardStore.additional?.message_templates ?? 0
);
const labelTemplatesTotal = computed(
  () => dashboardStore.additional?.label_templates ?? 0
);

const avgResponseTime = computed(
  () =>
    dashboardStore.additional?.attendance_metrics?.avg_response_time ?? '0m 0s'
);
const avgResolutionTime = computed(
  () =>
    dashboardStore.additional?.attendance_metrics?.avg_resolution_time ??
    '0m 0s'
);
const productivity = computed(
  () => dashboardStore.additional?.attendance_metrics?.productivity ?? 0
);
const totalAttendances = computed(
  () => dashboardStore.additional?.attendance_metrics?.total_attendances ?? 0
);

const conversationsEvolutionData = computed(() => {
  const evolution = dashboardStore.conversations?.evolution ?? [];
  return {
    labels: evolution.map((item) => item.month),
    datasets: [
      {
        label: t('dashboard_active_conversations_label'),
        data: evolution.map((item) => item.active),
        borderColor: 'rgb(25, 118, 210)',
        backgroundColor: 'rgba(25, 118, 210, 0.1)',
        tension: 0.4,
        fill: true,
      },
      {
        label: t('dashboard_closed_conversations_label'),
        data: evolution.map((item) => item.closed),
        borderColor: 'rgb(46, 125, 50)',
        backgroundColor: 'rgba(46, 125, 50, 0.1)',
        tension: 0.4,
        fill: true,
      },
    ],
  };
});

const conversationsEvolutionOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'top' as const,
    },
    title: {
      display: false,
    },
  },
  scales: {
    y: {
      beginAtZero: true,
      grid: {
        color: 'rgba(0, 0, 0, 0.05)',
      },
    },
    x: {
      grid: {
        display: false,
      },
    },
  },
}));

const contactsGrowthData = computed(() => {
  const growth = dashboardStore.additional?.contacts_growth ?? [];
  return {
    labels: growth.map((item) => item.month),
    datasets: [
      {
        label: t('dashboard_contacts_growth_label'),
        data: growth.map((item) => item.total),
        borderColor: getThemeColor('warning'),
        backgroundColor: getThemeColor('warning'),
        tension: 0.4,
        fill: true,
      },
    ],
  };
});

const contactsGrowthOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: false,
    },
  },
  scales: {
    y: {
      beginAtZero: false,
      grid: {
        color: 'rgba(0, 0, 0, 0.05)',
      },
    },
    x: {
      grid: {
        display: false,
      },
    },
  },
}));

const sectorsDistributionData = computed(() => {
  const sectors = dashboardStore.additional?.sectors_distribution ?? [];
  const colors = [
    'rgba(25, 118, 210, 0.8)',
    'rgba(46, 125, 50, 0.8)',
    'rgba(255, 152, 0, 0.8)',
    'rgba(156, 39, 176, 0.8)',
    'rgba(233, 30, 99, 0.8)',
    'rgba(158, 158, 158, 0.8)',
  ];

  if (sectors.length === 0) {
    return {
      labels: [t('dashboard_no_data')],
      datasets: [
        {
          data: [1],
          backgroundColor: ['rgba(158, 158, 158, 0.8)'],
          borderWidth: 2,
          borderColor: '#fff',
        },
      ],
    };
  }

  return {
    labels: sectors.map((sector) => sector.sector_name),
    datasets: [
      {
        data: sectors.map((sector) => sector.count),
        backgroundColor: sectors.map(
          (_, index) => colors[index % colors.length]
        ),
        borderWidth: 2,
        borderColor: '#fff',
      },
    ],
  };
});

const sectorsDistributionOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom' as const,
    },
  },
}));

const channelsStatusData = computed(() => {
  const connected = channelsConnected.value;
  const disconnected = channelsTotal.value - channelsConnected.value;

  if (channelsTotal.value === 0) {
    return {
      labels: [t('dashboard_no_data')],
      datasets: [
        {
          data: [1],
          backgroundColor: ['rgba(158, 158, 158, 0.8)'],
          borderWidth: 2,
          borderColor: '#fff',
        },
      ],
    };
  }

  return {
    labels: [t('dashboard_connected'), t('dashboard_disconnected')],
    datasets: [
      {
        data: [connected, disconnected],
        backgroundColor: ['rgba(46, 125, 50, 0.8)', 'rgba(244, 67, 54, 0.8)'],
        borderWidth: 2,
        borderColor: '#fff',
      },
    ],
  };
});

const channelsStatusOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom' as const,
    },
  },
}));

const attendancePerformanceData = computed(() => {
  const performance = dashboardStore.additional?.attendance_performance ?? [];
  const dayLabels: Record<string, string> = {
    dom: t('day_sun_short'),
    seg: t('day_mon_short'),
    ter: t('day_tue_short'),
    qua: t('day_wed_short'),
    qui: t('day_thu_short'),
    sex: t('day_fri_short'),
    sáb: t('day_sat_short'),
  };
  const primaryColor = getThemeColor('primary');
  const successColor = getThemeColor('success');
  return {
    labels: performance.map((item) => dayLabels[item.day] || item.day),
    datasets: [
      {
        label: t('dashboard_attendances_performed_label'),
        data: performance.map((item) => item.performed),
        backgroundColor: primaryColor,
        borderColor: primaryColor,
        borderWidth: 1,
      },
      {
        label: t('dashboard_daily_average_label'),
        data: performance.map((item) => item.average),
        backgroundColor: successColor,
        borderColor: successColor,
        borderWidth: 1,
      },
    ],
  };
});

const attendancePerformanceOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'top' as const,
    },
  },
  scales: {
    y: {
      beginAtZero: true,
      grid: {
        color: 'rgba(0, 0, 0, 0.05)',
      },
    },
    x: {
      grid: {
        display: false,
      },
    },
  },
}));

const usersSeries = computed(() => [
  {
    name: t('dashboard_users_label'),
    data: dashboardStore.stats?.users.sparkline_data ?? [0, 0, 0, 0, 0, 0, 0],
  },
]);

const usersChartOptions = computed(() => ({
  chart: {
    type: 'area',
    toolbar: { show: false },
    sparkline: { enabled: true },
  },
  stroke: {
    curve: 'smooth',
    width: 2,
    colors: [getThemeColor('primary')],
  },
  fill: {
    type: 'gradient',
    gradient: {
      shadeIntensity: 0.9,
      opacityFrom: 0.7,
      opacityTo: 0.5,
      stops: [0, 90, 100],
      colorStops: [
        {
          offset: 0,
          color: getThemeColor('primary'),
          opacity: 0.7,
        },
        {
          offset: 100,
          color: getThemeColor('primary'),
          opacity: 0.5,
        },
      ],
    },
  },
  colors: [getThemeColor('primary')],
}));

const channelsSparklineSeries = computed(() => [
  {
    name: t('dashboard_channels_label'),
    data: dashboardStore.stats?.channels.sparkline_data ?? [
      0, 0, 0, 0, 0, 0, 0,
    ],
  },
]);

const channelsSparklineChartOptions = computed(() => ({
  chart: {
    type: 'area',
    toolbar: { show: false },
    sparkline: { enabled: true },
  },
  stroke: {
    curve: 'smooth',
    width: 2,
    colors: [getThemeColor('info')],
  },
  fill: {
    type: 'gradient',
    gradient: {
      shadeIntensity: 0.9,
      opacityFrom: 0.7,
      opacityTo: 0.5,
      stops: [0, 90, 100],
      colorStops: [
        {
          offset: 0,
          color: getThemeColor('info'),
          opacity: 0.7,
        },
        {
          offset: 100,
          color: getThemeColor('info'),
          opacity: 0.5,
        },
      ],
    },
  },
  colors: [getThemeColor('info')],
}));

const contactsSeries = computed(() => [
  {
    name: t('dashboard_contacts_label'),
    data: dashboardStore.stats?.contacts.sparkline_data ?? [
      0, 0, 0, 0, 0, 0, 0,
    ],
  },
]);

const contactsChartOptions = computed(() => ({
  chart: {
    type: 'area',
    toolbar: { show: false },
    sparkline: { enabled: true },
  },
  stroke: {
    curve: 'smooth',
    width: 2,
    colors: [getThemeColor('warning')],
  },
  fill: {
    type: 'gradient',
    gradient: {
      shadeIntensity: 0.9,
      opacityFrom: 0.7,
      opacityTo: 0.5,
      stops: [0, 90, 100],
      colorStops: [
        {
          offset: 0,
          color: getThemeColor('warning'),
          opacity: 0.7,
        },
        {
          offset: 100,
          color: getThemeColor('warning'),
          opacity: 0.5,
        },
      ],
    },
  },
  colors: [getThemeColor('warning')],
}));

const chatsSeries = computed(() => {
  const active = dashboardStore.conversations?.active ?? 0;
  return [
    {
      name: t('dashboard_conversations_label'),
      data: [active, active, active, active, active, active, active],
    },
  ];
});

const chatsChartOptions = computed(() => ({
  chart: {
    type: 'area',
    toolbar: { show: false },
    sparkline: { enabled: true },
  },
  stroke: {
    curve: 'smooth',
    width: 2,
    colors: [getThemeColor('success')],
  },
  fill: {
    type: 'gradient',
    gradient: {
      shadeIntensity: 0.9,
      opacityFrom: 0.7,
      opacityTo: 0.5,
      stops: [0, 90, 100],
      colorStops: [
        {
          offset: 0,
          color: getThemeColor('success'),
          opacity: 0.7,
        },
        {
          offset: 100,
          color: getThemeColor('success'),
          opacity: 0.5,
        },
      ],
    },
  },
  colors: [getThemeColor('success')],
}));

onMounted(async () => {
  await Promise.all([
    dashboardStore.getDashboardStats(),
    dashboardStore.getDashboardConversations(),
    dashboardStore.getDashboardAdditional(),
  ]);
});
</script>

<template>
  <div>
    <VRow class="mb-4">
      <VCol cols="12" sm="6" md="3">
        <VCard v-if="dashboardStore.loadingStats">
          <VCardText>
            <VSkeletonLoader type="text, text, image" />
          </VCardText>
        </VCard>
        <CardStatisticsVertical
          v-else
          :title="t('dashboard_users')"
          :stats="usersTotal.toString()"
          icon="tabler-users"
          color="primary"
          :height="80"
          :series="usersSeries"
          :chart-options="usersChartOptions"
        />
      </VCol>
      <VCol cols="12" sm="6" md="3">
        <VCard v-if="dashboardStore.loadingStats">
          <VCardText>
            <VSkeletonLoader type="text, text, image" />
          </VCardText>
        </VCard>
        <CardStatisticsVertical
          v-else
          :title="t('dashboard_channels')"
          :stats="`${channelsConnected}/${channelsAllowed}`"
          icon="tabler-plug"
          color="info"
          :height="80"
          :series="channelsSparklineSeries"
          :chart-options="channelsSparklineChartOptions"
        />
      </VCol>
      <VCol cols="12" sm="6" md="3">
        <VCard v-if="dashboardStore.loadingStats">
          <VCardText>
            <VSkeletonLoader type="text, text, image" />
          </VCardText>
        </VCard>
        <CardStatisticsVertical
          v-else
          :title="t('dashboard_contacts')"
          :stats="contactsTotal.toLocaleString('pt-BR')"
          icon="tabler-address-book"
          color="warning"
          :height="80"
          :series="contactsSeries"
          :chart-options="contactsChartOptions"
        />
      </VCol>
      <VCol cols="12" sm="6" md="3">
        <VCard v-if="dashboardStore.loadingConversations">
          <VCardText>
            <VSkeletonLoader type="text, text, image" />
          </VCardText>
        </VCard>
        <CardStatisticsVertical
          v-else
          :title="t('dashboard_active_conversations')"
          :stats="chatsActive.toString()"
          icon="tabler-messages"
          color="success"
          :height="80"
          :series="chatsSeries"
          :chart-options="chatsChartOptions"
        />
      </VCol>
    </VRow>

    <VRow class="mb-4 dashboard-row">
      <VCol cols="12" md="8" class="d-flex">
        <VCard class="flex-grow-1 d-flex flex-column">
          <VCardTitle class="d-flex align-center justify-space-between">
            <span>{{ t('dashboard_conversations_evolution') }}</span>
            <VChip size="small" color="primary" variant="tonal">
              {{ t('dashboard_last_12_months') }}
            </VChip>
          </VCardTitle>
          <VCardText class="flex-grow-1 d-flex flex-column">
            <div
              v-if="dashboardStore.loadingConversations"
              class="flex-grow-1"
              style="min-height: 300px"
            >
              <VSkeletonLoader type="image" height="300" />
            </div>
            <div v-else class="flex-grow-1" style="min-height: 300px">
              <LineChart
                :chart-data="conversationsEvolutionData"
                :chart-options="conversationsEvolutionOptions"
                :height="300"
              />
            </div>
          </VCardText>
        </VCard>
      </VCol>
      <VCol cols="12" md="4" class="d-flex">
        <VCard class="flex-grow-1 d-flex flex-column">
          <VCardTitle>{{ t('dashboard_channels_status') }}</VCardTitle>
          <VCardText class="flex-grow-1 d-flex flex-column">
            <div
              v-if="dashboardStore.loadingStats"
              style="height: 300px; flex-shrink: 0"
            >
              <VSkeletonLoader type="image" height="300" />
            </div>
            <div v-else style="height: 300px; flex-shrink: 0">
              <DoughnutChart
                :chart-data="channelsStatusData"
                :chart-options="channelsStatusOptions"
                :height="300"
              />
            </div>
            <div class="mt-4 d-flex flex-column gap-2" style="flex-shrink: 0">
              <div class="d-flex align-center justify-space-between">
                <div class="d-flex align-center gap-2">
                  <VIcon icon="tabler-circle" size="12" color="success" />
                  <span class="text-body-2">{{
                    t('dashboard_connected')
                  }}</span>
                </div>
                <span class="text-body-1 font-weight-medium">
                  {{ channelsConnected }}
                </span>
              </div>
              <div class="d-flex align-center justify-space-between">
                <div class="d-flex align-center gap-2">
                  <VIcon icon="tabler-circle" size="12" color="error" />
                  <span class="text-body-2">{{
                    t('dashboard_disconnected')
                  }}</span>
                </div>
                <span class="text-body-1 font-weight-medium">
                  {{ channelsTotal - channelsConnected }}
                </span>
              </div>
            </div>
          </VCardText>
        </VCard>
      </VCol>
    </VRow>

    <VRow class="mb-4 dashboard-row">
      <VCol cols="12" md="6" class="d-flex">
        <VCard class="flex-grow-1 d-flex flex-column">
          <VCardTitle>{{ t('dashboard_contacts_growth') }}</VCardTitle>
          <VCardText class="flex-grow-1 d-flex flex-column">
            <div
              v-if="dashboardStore.loadingAdditional"
              style="height: 250px; flex-shrink: 0"
            >
              <VSkeletonLoader type="image" height="250" />
            </div>
            <div v-else style="height: 250px; flex-shrink: 0">
              <LineChart
                :chart-data="contactsGrowthData"
                :chart-options="contactsGrowthOptions"
                :height="250"
              />
            </div>
            <div class="mt-4 d-flex align-center gap-4" style="flex-shrink: 0">
              <div>
                <span class="text-body-2 text-medium-emphasis d-block">
                  {{ t('dashboard_total') }}
                </span>
                <span class="text-h6 font-weight-bold">
                  {{ contactsTotal.toLocaleString('pt-BR') }}
                </span>
              </div>
              <VDivider vertical />
              <div>
                <span class="text-body-2 text-medium-emphasis d-block">
                  {{ t('dashboard_growth') }}
                </span>
                <span class="text-h6 font-weight-bold text-success">
                  +{{ contactsGrowth }}
                </span>
              </div>
            </div>
          </VCardText>
        </VCard>
      </VCol>
      <VCol cols="12" md="6" class="d-flex">
        <VCard class="flex-grow-1 d-flex flex-column">
          <VCardTitle>{{ t('dashboard_attendance_performance') }}</VCardTitle>
          <VCardText class="flex-grow-1 d-flex flex-column">
            <div
              v-if="dashboardStore.loadingAdditional"
              style="height: 250px; flex-shrink: 0"
            >
              <VSkeletonLoader type="image" height="250" />
            </div>
            <div v-else style="height: 250px; flex-shrink: 0">
              <BarChart
                :chart-data="attendancePerformanceData"
                :chart-options="attendancePerformanceOptions"
                :height="250"
              />
            </div>
            <div class="mt-4 d-flex align-center gap-4" style="flex-shrink: 0">
              <div>
                <span class="text-body-2 text-medium-emphasis d-block">
                  {{ t('dashboard_total_attendances') }}
                </span>
                <span class="text-h6 font-weight-bold">
                  {{ totalAttendances }}
                </span>
              </div>
              <VDivider vertical />
              <div>
                <span class="text-body-2 text-medium-emphasis d-block">
                  {{ t('dashboard_productivity') }}
                </span>
                <span class="text-h6 font-weight-bold text-success">
                  {{ productivity }}%
                </span>
              </div>
            </div>
          </VCardText>
        </VCard>
      </VCol>
    </VRow>

    <VRow class="mb-4 dashboard-row">
      <VCol cols="12" md="6" class="d-flex">
        <VCard class="flex-grow-1 d-flex flex-column">
          <VCardTitle>{{ t('dashboard_sectors_distribution') }}</VCardTitle>
          <VCardText class="flex-grow-1 d-flex flex-column">
            <div
              v-if="dashboardStore.loadingAdditional"
              class="flex-grow-1"
              style="min-height: 300px"
            >
              <VSkeletonLoader type="image" height="300" />
            </div>
            <div v-else class="flex-grow-1" style="min-height: 300px">
              <DoughnutChart
                :chart-data="sectorsDistributionData"
                :chart-options="sectorsDistributionOptions"
                :height="300"
              />
            </div>
          </VCardText>
        </VCard>
      </VCol>
      <VCol cols="12" md="6" class="d-flex">
        <VCard class="flex-grow-1 d-flex flex-column">
          <VCardTitle>{{ t('dashboard_attendance_metrics') }}</VCardTitle>
          <VCardText class="flex-grow-1">
            <VRow class="h-100">
              <VCol cols="12" sm="6">
                <VCard
                  v-if="dashboardStore.loadingAdditional"
                  flat
                  class="h-100 d-flex align-center justify-center"
                >
                  <VSkeletonLoader type="text, text" />
                </VCard>
                <VCard v-else variant="tonal" color="primary" class="h-100">
                  <VCardText>
                    <div class="d-flex align-center gap-3">
                      <VAvatar color="primary" size="48" variant="tonal">
                        <VIcon icon="tabler-clock" size="24" />
                      </VAvatar>
                      <div>
                        <p class="text-body-2 text-medium-emphasis mb-1">
                          {{ t('dashboard_avg_response_time') }}
                        </p>
                        <h4 class="text-h5 font-weight-bold">
                          {{ avgResponseTime }}
                        </h4>
                      </div>
                    </div>
                  </VCardText>
                </VCard>
              </VCol>
              <VCol cols="12" sm="6">
                <VCard
                  v-if="dashboardStore.loadingAdditional"
                  flat
                  class="h-100 d-flex align-center justify-center"
                >
                  <VSkeletonLoader type="text, text" />
                </VCard>
                <VCard v-else variant="tonal" color="success" class="h-100">
                  <VCardText>
                    <div class="d-flex align-center gap-3">
                      <VAvatar color="success" size="48" variant="tonal">
                        <VIcon icon="tabler-check" size="24" />
                      </VAvatar>
                      <div>
                        <p class="text-body-2 text-medium-emphasis mb-1">
                          {{ t('dashboard_avg_resolution_time') }}
                        </p>
                        <h4 class="text-h5 font-weight-bold">
                          {{ avgResolutionTime }}
                        </h4>
                      </div>
                    </div>
                  </VCardText>
                </VCard>
              </VCol>
              <VCol cols="12" sm="6">
                <VCard
                  v-if="dashboardStore.loadingAdditional"
                  flat
                  class="h-100 d-flex align-center justify-center"
                >
                  <VSkeletonLoader type="text, text" />
                </VCard>
                <VCard v-else variant="tonal" color="warning" class="h-100">
                  <VCardText>
                    <div class="d-flex align-center gap-3">
                      <VAvatar color="warning" size="48" variant="tonal">
                        <VIcon icon="tabler-chart-bar" size="24" />
                      </VAvatar>
                      <div>
                        <p class="text-body-2 text-medium-emphasis mb-1">
                          {{ t('dashboard_total_attendances') }}
                        </p>
                        <h4 class="text-h5 font-weight-bold">
                          {{ totalAttendances }}
                        </h4>
                      </div>
                    </div>
                  </VCardText>
                </VCard>
              </VCol>
              <VCol cols="12" sm="6">
                <VCard
                  v-if="dashboardStore.loadingAdditional"
                  flat
                  class="h-100 d-flex align-center justify-center"
                >
                  <VSkeletonLoader type="text, text" />
                </VCard>
                <VCard v-else variant="tonal" color="info" class="h-100">
                  <VCardText>
                    <div class="d-flex align-center gap-3">
                      <VAvatar color="info" size="48" variant="tonal">
                        <VIcon icon="tabler-trending-up" size="24" />
                      </VAvatar>
                      <div>
                        <p class="text-body-2 text-medium-emphasis mb-1">
                          {{ t('dashboard_productivity') }}
                        </p>
                        <h4 class="text-h5 font-weight-bold">
                          {{ productivity }}%
                        </h4>
                      </div>
                    </div>
                  </VCardText>
                </VCard>
              </VCol>
            </VRow>
          </VCardText>
        </VCard>
      </VCol>
    </VRow>

    <VRow class="dashboard-row">
      <VCol cols="12" sm="6" md="3" class="d-flex">
        <VCard class="flex-grow-1 d-flex flex-column">
          <VCardText class="flex-grow-1 d-flex flex-column">
            <VCard
              v-if="dashboardStore.loadingAdditional"
              flat
              class="flex-grow-1 d-flex align-center justify-center"
            >
              <VSkeletonLoader type="text, text, avatar" />
            </VCard>
            <div
              v-else
              class="d-flex align-center justify-space-between flex-grow-1"
            >
              <div>
                <p class="text-body-2 text-medium-emphasis mb-1">
                  {{ t('dashboard_active_chatbots') }}
                </p>
                <h3 class="text-h4 font-weight-bold">
                  {{ chatbotsActive }}/{{ chatbotsTotal }}
                </h3>
              </div>
              <VAvatar color="success" variant="tonal" size="56">
                <VIcon icon="tabler-robot" size="28" />
              </VAvatar>
            </div>
          </VCardText>
        </VCard>
      </VCol>
      <VCol cols="12" sm="6" md="3" class="d-flex">
        <VCard class="flex-grow-1 d-flex flex-column">
          <VCardText class="flex-grow-1 d-flex flex-column">
            <VCard
              v-if="dashboardStore.loadingAdditional"
              flat
              class="flex-grow-1 d-flex align-center justify-center"
            >
              <VSkeletonLoader type="text, text, avatar" />
            </VCard>
            <div
              v-else
              class="d-flex align-center justify-space-between flex-grow-1"
            >
              <div>
                <p class="text-body-2 text-medium-emphasis mb-1">
                  {{ t('dashboard_contact_groups') }}
                </p>
                <h3 class="text-h4 font-weight-bold">
                  {{ contactGroupsTotal }}
                </h3>
              </div>
              <VAvatar color="info" variant="tonal" size="56">
                <VIcon icon="tabler-users-group" size="28" />
              </VAvatar>
            </div>
          </VCardText>
        </VCard>
      </VCol>
      <VCol cols="12" sm="6" md="3" class="d-flex">
        <VCard class="flex-grow-1 d-flex flex-column">
          <VCardText class="flex-grow-1 d-flex flex-column">
            <VCard
              v-if="dashboardStore.loadingAdditional"
              flat
              class="flex-grow-1 d-flex align-center justify-center"
            >
              <VSkeletonLoader type="text, text, avatar" />
            </VCard>
            <div
              v-else
              class="d-flex align-center justify-space-between flex-grow-1"
            >
              <div>
                <p class="text-body-2 text-medium-emphasis mb-1">
                  {{ t('dashboard_message_templates') }}
                </p>
                <h3 class="text-h4 font-weight-bold">
                  {{ messageTemplatesTotal }}
                </h3>
              </div>
              <VAvatar color="warning" variant="tonal" size="56">
                <VIcon icon="tabler-message" size="28" />
              </VAvatar>
            </div>
          </VCardText>
        </VCard>
      </VCol>
      <VCol cols="12" sm="6" md="3" class="d-flex">
        <VCard class="flex-grow-1 d-flex flex-column">
          <VCardText class="flex-grow-1 d-flex flex-column">
            <VCard
              v-if="dashboardStore.loadingAdditional"
              flat
              class="flex-grow-1 d-flex align-center justify-center"
            >
              <VSkeletonLoader type="text, text, avatar" />
            </VCard>
            <div
              v-else
              class="d-flex align-center justify-space-between flex-grow-1"
            >
              <div>
                <p class="text-body-2 text-medium-emphasis mb-1">
                  {{ t('dashboard_label_templates') }}
                </p>
                <h3 class="text-h4 font-weight-bold">
                  {{ labelTemplatesTotal }}
                </h3>
              </div>
              <VAvatar color="purple" variant="tonal" size="56">
                <VIcon icon="tabler-label" size="28" />
              </VAvatar>
            </div>
          </VCardText>
        </VCard>
      </VCol>
    </VRow>

    <VSnackbar
      v-model="channelsStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="channelsStore.snackbar.color"
    >
      {{ channelsStore.snackbar.message }}
    </VSnackbar>
  </div>
</template>

<style lang="scss" scoped>
:deep(.v-card) {
  transition: all 0.3s ease;
}

:deep(.v-card:hover) {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.dashboard-row {
  .v-col {
    display: flex;
  }

  .v-card {
    width: 100%;
  }
}
</style>
