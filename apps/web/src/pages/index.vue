<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useTheme } from 'vuetify';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { hexToRgb } from '@webcore/utils/colorConverter';
import BarChart from '@/@webcore/libs/chartjs/components/BarChart';
import LineChart from '@/@webcore/libs/chartjs/components/LineChart';
import DoughnutChart from '@/@webcore/libs/chartjs/components/DoughnutChart';
import CardStatisticsVertical from '@/@webcore/components/cards/CardStatisticsVertical.vue';
import MetaPartnerMark from '@/components/brand/MetaPartnerMark.vue';
import { useAbility } from '@/plugins/0.casl/composables/useAbility';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { useDashboardStore } from '@/@webcore/stores/dashboard';
import { useReleaseStore } from '@/@webcore/stores/release';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EHomePermissions } from '@core/common/enums/EPermissions/home';
import { EReleasePermissions } from '@core/common/enums/EPermissions/release';
import { EReleaseType } from '@core/common/enums/EReleaseType';

const { t } = useI18n();
const router = useRouter();
const channelsStore = useChannelsStore();
const dashboardStore = useDashboardStore();
const releaseStore = useReleaseStore();
useSnackbarCleanup(channelsStore);
useSnackbarCleanup(dashboardStore);

const ability = useAbility();
const canViewReleases = computed(
  () =>
    ability.can(
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access
    ) ||
    ability.can(
      EGeneralPermissions.full_access_group,
      EGeneralPermissions.full_access_group
    ) ||
    ability.can(
      EReleasePermissions.release_view,
      EReleasePermissions.release_view
    ) ||
    ability.can(
      EReleasePermissions.release_group,
      EReleasePermissions.release_group
    )
);
const canViewHomeDashboard = computed(
  () =>
    ability.can(
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access
    ) ||
    ability.can(
      EGeneralPermissions.full_access_group,
      EGeneralPermissions.full_access_group
    ) ||
    ability.can(EHomePermissions.home_group, EHomePermissions.home_group) ||
    ability.can(
      EHomePermissions.dashboard_view,
      EHomePermissions.dashboard_view
    )
);

const loadingReleaseNotifications = ref(false);

const releaseUnreadCount = computed(
  () => releaseStore.releaseNotificationUnreadCount
);
const releaseNotifications = computed(
  () => releaseStore.releaseNotificationResults
);

const latestUnreadRelease = computed(() => {
  if (releaseUnreadCount.value === 0) return null;
  const unread = releaseNotifications.value.find((r) => !r.viewed);
  return unread ?? null;
});

const dashboardReleaseBannerColor = computed(() => {
  const r = latestUnreadRelease.value;
  if (!r) return 'primary';
  if (r.type === EReleaseType.reminder) return 'error';
  return 'primary';
});

const dashboardUnreadBannerAttention = computed(
  () => !!latestUnreadRelease.value
);

const releaseUnreadLabel = computed(() => {
  const n = releaseUnreadCount.value;
  if (n <= 0) return '';
  return n === 1
    ? t('dashboard_unread_notification')
    : t('dashboard_unread_notifications', { count: n });
});

const openLatestUnreadRelease = () => {
  if (!canViewReleases.value) return;
  const r = latestUnreadRelease.value;
  if (!r) return;
  router.push({ path: '/release', query: { open: r.release_id } });
};

const theme = useTheme();

const getThemeColor = (colorName: string): string => {
  const color = theme.current.value.colors[colorName];
  if (!color) return '#000000';
  const rgb = hexToRgb(String(color));
  return `rgb(${rgb})`;
};

const usersTotal = computed(() => dashboardStore.stats?.users.total ?? 0);
const usersAllowed = computed(() => dashboardStore.stats?.users.allowed ?? 0);
const usersDisplay = computed(
  () => `${usersTotal.value} / ${usersAllowed.value}`
);
const channelsTotal = computed(() => dashboardStore.stats?.channels.total ?? 0);
const channelsConnected = computed(
  () => dashboardStore.stats?.channels.connected ?? 0
);
const channelsAllowed = computed(
  () => dashboardStore.stats?.channels.allowed ?? 0
);
const contactsTotal = computed(() => dashboardStore.stats?.contacts.total ?? 0);
const contactsAllowed = computed(
  () => dashboardStore.stats?.contacts.allowed ?? 0
);
const contactsDisplay = computed(
  () =>
    `${contactsTotal.value.toLocaleString('pt-BR')} / ${contactsAllowed.value.toLocaleString('pt-BR')}`
);
const contactsGrowth = computed(
  () => dashboardStore.stats?.contacts.growth ?? 0
);
const chatsActive = computed(() => dashboardStore.conversations?.active ?? 0);
const chatbotsActive = computed(
  () => dashboardStore.additional?.chatbots.active ?? 0
);
const chatbotsAllowed = computed(
  () => dashboardStore.additional?.chatbots.allowed ?? 0
);
const chatbotsDisplay = computed(
  () => `${chatbotsActive.value} / ${chatbotsAllowed.value}`
);
const chatbotsTotal = computed(
  () => dashboardStore.additional?.chatbots.total ?? 0
);
const schedulesSent = computed(
  () => dashboardStore.additional?.schedules.sent ?? 0
);
const schedulesAllowed = computed(
  () => dashboardStore.additional?.schedules.allowed ?? 0
);
const schedulesDisplay = computed(
  () =>
    `${schedulesSent.value.toLocaleString('pt-BR')} / ${schedulesAllowed.value.toLocaleString('pt-BR')}`
);
const schedulesRenewalDay = computed(
  () => dashboardStore.additional?.schedules.renewal_day ?? null
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

const mobileAppLinks = [
  {
    key: 'ios',
    icon: 'tabler-brand-apple',
    titleKey: 'dashboard_mobile_ios_title',
    href: 'https://apps.apple.com/br/app/underchat-v2/id6760209894',
    badgeSrc:
      'https://tools.applemediaservices.com/api/badges/download-on-the-app-store/black/pt-br?size=250x83',
  },
  {
    key: 'android',
    icon: 'tabler-brand-android',
    titleKey: 'dashboard_mobile_android_title',
    href: 'https://play.google.com/store/apps/details?id=com.underchat.mobile&hl=pt_BR',
    badgeSrc:
      'https://play.google.com/intl/pt_br/badges/static/images/badges/pt-br_badge_web_generic.png',
  },
];

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

  if (canViewReleases.value) {
    loadingReleaseNotifications.value = true;
    try {
      await releaseStore.listReleaseNotifications();
    } finally {
      loadingReleaseNotifications.value = false;
    }
  }
});
</script>

<template>
  <div>
    <VCard
      v-if="canViewReleases && loadingReleaseNotifications"
      variant="tonal"
      color="primary"
      class="mb-4 dashboard-unread-release-banner"
    >
      <VCardText class="d-flex align-center gap-3 py-3">
        <VSkeletonLoader type="avatar" width="40" height="40" />
        <div class="flex-grow-1 min-w-0">
          <VSkeletonLoader type="text" width="150" height="16" class="mb-2" />
          <VSkeletonLoader type="text" width="200" height="20" />
        </div>
        <VSkeletonLoader type="text" width="20" height="20" />
      </VCardText>
    </VCard>
    <VCard
      v-else-if="canViewReleases && latestUnreadRelease"
      variant="tonal"
      :color="dashboardReleaseBannerColor"
      class="mb-4 dashboard-unread-release-banner cursor-pointer"
      :class="{
        'dashboard-unread-release-banner--attention':
          dashboardUnreadBannerAttention,
      }"
      @click="openLatestUnreadRelease"
    >
      <VCardText class="d-flex align-center gap-3 py-3">
        <VAvatar
          :color="dashboardReleaseBannerColor"
          size="40"
          variant="tonal"
          class="dashboard-unread-release-banner__avatar"
        >
          <VIcon icon="tabler-bell" size="22" />
        </VAvatar>
        <div class="flex-grow-1 min-w-0">
          <p class="text-caption text-medium-emphasis mb-0">
            {{ releaseUnreadLabel }}
          </p>
          <p class="text-body-1 font-weight-medium mb-0 text-truncate">
            {{ latestUnreadRelease.title }}
          </p>
        </div>
        <VIcon
          icon="tabler-chevron-right"
          size="20"
          class="text-medium-emphasis"
        />
      </VCardText>
    </VCard>

    <VRow v-if="canViewHomeDashboard" class="mb-4">
      <VCol cols="12" sm="6" md="3">
        <VCard v-if="dashboardStore.loadingStats">
          <VCardText>
            <VSkeletonLoader type="text, text, image" />
          </VCardText>
        </VCard>
        <CardStatisticsVertical
          v-else
          :title="t('dashboard_users')"
          :stats="usersDisplay"
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
          :stats="`${channelsConnected} / ${channelsAllowed}`"
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
          :stats="contactsDisplay"
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
      <VCol cols="12" lg="8" class="d-flex">
        <VCard class="flex-grow-1 mobile-apps-card d-flex flex-column">
          <VCardText class="mobile-apps-card__body">
            <div class="mobile-apps-header">
              <div>
                <p class="text-h6 font-weight-bold mb-1">
                  {{ t('dashboard_mobile_apps_title') }}
                </p>
                <p class="text-body-2 text-medium-emphasis mb-0">
                  {{ t('dashboard_mobile_apps_description') }}
                </p>
              </div>
              <VChip color="primary" variant="tonal" size="small">
                {{ t('dashboard_mobile_apps_chip') }}
              </VChip>
            </div>

            <VRow class="mt-1 mobile-apps-links-row">
              <VCol
                v-for="app in mobileAppLinks"
                :key="app.key"
                cols="12"
                sm="6"
                class="d-flex"
              >
                <VCard variant="tonal" class="mobile-link-card flex-grow-1">
                  <VCardText
                    class="d-flex align-center justify-space-between gap-3 mobile-link-content"
                  >
                    <div class="d-flex align-center gap-3">
                      <VAvatar color="primary" variant="tonal" size="42">
                        <VIcon :icon="app.icon" size="22" />
                      </VAvatar>
                      <div>
                        <p class="text-body-1 font-weight-medium mb-0">
                          {{ t(app.titleKey) }}
                        </p>
                      </div>
                    </div>

                    <a
                      class="mobile-store-link"
                      :href="app.href"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <img
                        class="mobile-store-badge"
                        :class="`mobile-store-badge--${app.key}`"
                        :src="app.badgeSrc"
                        :alt="t(app.titleKey)"
                        loading="lazy"
                      />
                    </a>
                  </VCardText>
                </VCard>
              </VCol>
            </VRow>
          </VCardText>
        </VCard>
      </VCol>
      <VCol cols="12" lg="4" class="d-flex">
        <MetaPartnerMark variant="dashboard" />
      </VCol>
    </VRow>

    <VRow v-if="!canViewHomeDashboard" class="mb-4">
      <VCol cols="12">
        <VCard
          variant="tonal"
          color="surface"
          class="dashboard-limited-view d-flex align-center"
        >
          <VCardText class="text-body-2 text-medium-emphasis">
            {{ t('dashboard_limited_view') }}
          </VCardText>
        </VCard>
      </VCol>
    </VRow>

    <template v-if="canViewHomeDashboard">
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
              <div
                class="mt-4 d-flex align-center gap-4"
                style="flex-shrink: 0"
              >
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
              <div
                class="mt-4 d-flex align-center gap-4"
                style="flex-shrink: 0"
              >
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
        <VCol cols="12" md="3" class="d-flex" style="align-self: stretch">
          <VCard
            class="flex-grow-1 d-flex flex-column w-100"
            style="min-height: 100%"
          >
            <VCardText class="flex-grow-1 d-flex flex-column">
              <VCard
                v-if="dashboardStore.loadingAdditional"
                flat
                class="flex-grow-1 d-flex align-center justify-center"
              >
                <VSkeletonLoader type="text, text, avatar" />
              </VCard>
              <div v-else class="d-flex flex-column flex-grow-1">
                <div class="d-flex align-center justify-space-between mb-2">
                  <div>
                    <p class="text-body-2 text-medium-emphasis mb-1">
                      {{ t('dashboard_schedules') }}
                    </p>
                    <h3 class="text-h4 font-weight-bold">
                      {{ schedulesDisplay }}
                    </h3>
                  </div>
                  <VAvatar color="info" variant="tonal" size="56">
                    <VIcon icon="tabler-calendar" size="28" />
                  </VAvatar>
                </div>
                <div v-if="schedulesRenewalDay" class="mt-auto">
                  <p class="text-caption text-medium-emphasis">
                    {{ t('dashboard_renewal_day') }}: {{ schedulesRenewalDay }}
                  </p>
                </div>
              </div>
            </VCardText>
          </VCard>
        </VCol>
        <VCol cols="12" md="9" class="dashboard-additional-stack">
          <VRow class="dashboard-additional-subrow">
            <VCol cols="12" sm="6" class="d-flex">
              <VCard class="flex-grow-1 d-flex flex-column w-100">
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
                        {{ chatbotsDisplay }}
                      </h3>
                    </div>
                    <VAvatar color="success" variant="tonal" size="56">
                      <VIcon icon="tabler-robot" size="28" />
                    </VAvatar>
                  </div>
                </VCardText>
              </VCard>
            </VCol>
            <VCol cols="12" sm="6" class="d-flex">
              <VCard class="flex-grow-1 d-flex flex-column w-100">
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
          </VRow>
          <VRow class="dashboard-additional-subrow">
            <VCol cols="12" sm="6" class="d-flex">
              <VCard class="flex-grow-1 d-flex flex-column w-100">
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
            <VCol cols="12" sm="6" class="d-flex">
              <VCard class="flex-grow-1 d-flex flex-column w-100">
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
        </VCol>
      </VRow>
    </template>

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

.dashboard-additional-stack {
  flex-direction: column;
}

.dashboard-additional-subrow {
  flex: 1 1 0;
}

.dashboard-limited-view {
  min-height: 84px;
}

.dashboard-unread-release-banner {
  transition:
    box-shadow 0.2s ease,
    transform 0.2s ease;

  &:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    transform: translateY(-1px);
  }
}

.dashboard-unread-release-banner--attention {
  animation: dashboard-release-banner-pulse 2.2s ease-in-out infinite;
}

.dashboard-unread-release-banner__avatar :deep(.v-icon) {
  animation: dashboard-release-banner-bell 2.4s ease-in-out infinite;
  transform-origin: 50% 0%;
}

@keyframes dashboard-release-banner-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(var(--v-theme-on-surface), 0.08);
  }

  50% {
    box-shadow: 0 0 0 8px rgba(var(--v-theme-on-surface), 0.04);
  }
}

@keyframes dashboard-release-banner-bell {
  0%,
  100% {
    transform: rotate(0deg);
  }

  12% {
    transform: rotate(-12deg);
  }

  24% {
    transform: rotate(12deg);
  }

  36% {
    transform: rotate(-8deg);
  }

  48% {
    transform: rotate(8deg);
  }

  60% {
    transform: rotate(0deg);
  }
}

.mobile-apps-card {
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
  background:
    radial-gradient(
      circle at 90% 10%,
      rgba(var(--v-theme-primary), 0.08),
      transparent 35%
    ),
    linear-gradient(
      135deg,
      rgba(var(--v-theme-surface), 1) 0%,
      rgba(var(--v-theme-surface), 0.94) 100%
    );
}

.mobile-apps-card__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
}

.mobile-apps-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.mobile-apps-links-row {
  flex: 1 1 auto;
  align-items: stretch;
}

.mobile-link-card {
  display: flex;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

.mobile-link-content {
  flex: 1 1 auto;
  min-height: clamp(126px, 11vw, 176px);
}

.mobile-store-link {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 210px;
  height: 64px;
  overflow: hidden;
  border-radius: 10px;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.mobile-store-link:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
}

.mobile-store-badge {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.mobile-store-badge--ios {
  width: 170px;
  height: 52px;
}

.mobile-store-badge--android {
  width: 188px;
  height: 52px;
  transform: scale(1.2);
  transform-origin: center;
}

@media (max-width: 600px) {
  .mobile-apps-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .mobile-link-content {
    flex-direction: column;
    align-items: flex-start !important;
    min-height: 136px;
  }

  .mobile-store-badge--ios {
    width: 168px;
    height: 48px;
  }

  .mobile-store-badge--android {
    width: 172px;
    height: 48px;
    transform: scale(1.1);
  }

  .mobile-store-link {
    width: 190px;
    height: 58px;
  }
}
</style>
