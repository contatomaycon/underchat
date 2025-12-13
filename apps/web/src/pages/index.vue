<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
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
const contactsTotal = computed(() => dashboardStore.stats?.contacts.total ?? 0);
const contactsGrowth = computed(
  () => dashboardStore.stats?.contacts.growth ?? 0
);
const chatsActive = computed(() => dashboardStore.conversations?.active ?? 0);
const chatsClosed = computed(() => dashboardStore.conversations?.closed ?? 0);
const chatbotsActive = ref(10);
const chatbotsTotal = ref(12);
const sectorsTotal = ref(15);
const contactGroupsTotal = ref(48);
const messageTemplatesTotal = ref(67);
const labelTemplatesTotal = ref(23);
const rolesTotal = ref(9);

const avgResponseTime = ref('2m 34s');
const avgResolutionTime = ref('15m 42s');
const productivity = ref(87);
const totalAttendances = ref(1245);

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

const contactsGrowthData = computed(() => ({
  labels: [
    t('dashboard_month_jan'),
    t('dashboard_month_feb'),
    t('dashboard_month_mar'),
    t('dashboard_month_apr'),
    t('dashboard_month_may'),
    t('dashboard_month_jun'),
    t('dashboard_month_jul'),
    t('dashboard_month_aug'),
    t('dashboard_month_sep'),
    t('dashboard_month_oct'),
    t('dashboard_month_nov'),
    t('dashboard_month_dec'),
  ],
  datasets: [
    {
      label: t('dashboard_contacts_growth_label'),
      data: [
        2100, 2200, 2300, 2400, 2500, 2600, 2700, 2750, 2800, 2820, 2835, 2847,
      ],
      borderColor: 'rgb(255, 152, 0)',
      backgroundColor: 'rgba(255, 152, 0, 0.1)',
      tension: 0.4,
      fill: true,
    },
  ],
}));

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

const sectorsDistributionData = computed(() => ({
  labels: [
    t('dashboard_sector_service'),
    t('dashboard_sector_sales'),
    t('dashboard_sector_support'),
    t('dashboard_sector_financial'),
    t('dashboard_sector_technical'),
    t('dashboard_sector_others'),
  ],
  datasets: [
    {
      data: [35, 25, 20, 10, 7, 3],
      backgroundColor: [
        'rgba(25, 118, 210, 0.8)',
        'rgba(46, 125, 50, 0.8)',
        'rgba(255, 152, 0, 0.8)',
        'rgba(156, 39, 176, 0.8)',
        'rgba(233, 30, 99, 0.8)',
        'rgba(158, 158, 158, 0.8)',
      ],
      borderWidth: 2,
      borderColor: '#fff',
    },
  ],
}));

const sectorsDistributionOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom' as const,
    },
  },
}));

const channelsStatusData = computed(() => ({
  labels: [t('dashboard_connected'), t('dashboard_disconnected')],
  datasets: [
    {
      data: [
        channelsConnected.value,
        channelsTotal.value - channelsConnected.value,
      ],
      backgroundColor: ['rgba(46, 125, 50, 0.8)', 'rgba(244, 67, 54, 0.8)'],
      borderWidth: 2,
      borderColor: '#fff',
    },
  ],
}));

const channelsStatusOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom' as const,
    },
  },
}));

const attendancePerformanceData = computed(() => ({
  labels: [
    t('dashboard_weekday_mon'),
    t('dashboard_weekday_tue'),
    t('dashboard_weekday_wed'),
    t('dashboard_weekday_thu'),
    t('dashboard_weekday_fri'),
    t('dashboard_weekday_sat'),
    t('dashboard_weekday_sun'),
  ],
  datasets: [
    {
      label: t('dashboard_attendances_completed'),
      data: [185, 210, 195, 225, 240, 150, 120],
      backgroundColor: 'rgba(25, 118, 210, 0.8)',
    },
    {
      label: t('dashboard_daily_goal'),
      data: [200, 200, 200, 200, 200, 200, 200],
      backgroundColor: 'rgba(46, 125, 50, 0.6)',
    },
  ],
}));

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
    data: dashboardStore.stats?.users.sparklineData ?? [0, 0, 0, 0, 0, 0, 0],
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

const chatbotsSeries = computed(() => [
  {
    name: t('dashboard_channels_label'),
    data: dashboardStore.stats?.channels.sparklineData ?? [0, 0, 0, 0, 0, 0, 0],
  },
]);

const chatbotsChartOptions = computed(() => ({
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
    data: dashboardStore.stats?.contacts.sparklineData ?? [0, 0, 0, 0, 0, 0, 0],
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
    colors: [getThemeColor('error')],
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
          color: getThemeColor('error'),
          opacity: 0.7,
        },
        {
          offset: 100,
          color: getThemeColor('error'),
          opacity: 0.5,
        },
      ],
    },
  },
  colors: [getThemeColor('error')],
}));

onMounted(async () => {
  await Promise.all([
    dashboardStore.getDashboardStats(),
    dashboardStore.getDashboardConversations(),
  ]);
});
</script>

<template>
  <div>
    <VRow class="mb-4">
      <VCol cols="12">
        <div class="d-flex align-center justify-space-between flex-wrap gap-4">
          <div>
            <h1 class="text-h4 font-weight-bold">{{ t('dashboard_title') }}</h1>
            <p class="text-body-2 text-medium-emphasis mt-1">
              {{ t('dashboard_subtitle') }}
            </p>
          </div>
          <VChip
            color="success"
            variant="tonal"
            prepend-icon="tabler-circle-check"
          >
            {{ t('dashboard_system_operational') }}
          </VChip>
        </div>
      </VCol>
    </VRow>

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
          :stats="`${channelsConnected}/${channelsTotal}`"
          icon="tabler-robot"
          color="info"
          :height="80"
          :series="chatbotsSeries"
          :chart-options="chatbotsChartOptions"
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
          color="error"
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
              v-if="dashboardStore.loadingStats"
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
            <div style="height: 250px; flex-shrink: 0">
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
            <div class="flex-grow-1" style="min-height: 300px">
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
                <VCard variant="tonal" color="primary" class="h-100">
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
                <VCard variant="tonal" color="success" class="h-100">
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
                <VCard variant="tonal" color="warning" class="h-100">
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
                <VCard variant="tonal" color="info" class="h-100">
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
            <div class="d-flex align-center justify-space-between">
              <div>
                <p class="text-body-2 text-medium-emphasis mb-1">
                  {{ t('dashboard_active_chatbots') }}
                </p>
                <h3 class="text-h4 font-weight-bold">
                  {{ chatbotsActive }}/{{ chatbotsTotal }}
                </h3>
              </div>
              <VAvatar color="success" variant="tonal" size="56">
                <VIcon icon="tabler-message-chatbot" size="28" />
              </VAvatar>
            </div>
          </VCardText>
        </VCard>
      </VCol>
      <VCol cols="12" sm="6" md="3" class="d-flex">
        <VCard class="flex-grow-1 d-flex flex-column">
          <VCardText class="flex-grow-1 d-flex flex-column">
            <div class="d-flex align-center justify-space-between">
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
            <div class="d-flex align-center justify-space-between">
              <div>
                <p class="text-body-2 text-medium-emphasis mb-1">
                  {{ t('dashboard_message_templates') }}
                </p>
                <h3 class="text-h4 font-weight-bold">
                  {{ messageTemplatesTotal }}
                </h3>
              </div>
              <VAvatar color="warning" variant="tonal" size="56">
                <VIcon icon="tabler-file-text" size="28" />
              </VAvatar>
            </div>
          </VCardText>
        </VCard>
      </VCol>
      <VCol cols="12" sm="6" md="3" class="d-flex">
        <VCard class="flex-grow-1 d-flex flex-column">
          <VCardText class="flex-grow-1 d-flex flex-column">
            <div class="d-flex align-center justify-space-between">
              <div>
                <p class="text-body-2 text-medium-emphasis mb-1">
                  {{ t('dashboard_label_templates') }}
                </p>
                <h3 class="text-h4 font-weight-bold">
                  {{ labelTemplatesTotal }}
                </h3>
              </div>
              <VAvatar color="purple" variant="tonal" size="56">
                <VIcon icon="tabler-tags" size="28" />
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
