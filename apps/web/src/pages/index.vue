<script setup lang="ts">
import { ref, computed } from 'vue';
import { useTheme } from 'vuetify';
import { hexToRgb } from '@webcore/utils/colorConverter';
import BarChart from '@/@webcore/libs/chartjs/components/BarChart';
import LineChart from '@/@webcore/libs/chartjs/components/LineChart';
import DoughnutChart from '@/@webcore/libs/chartjs/components/DoughnutChart';
import CardStatisticsVertical from '@/@webcore/components/cards/CardStatisticsVertical.vue';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';

const channelsStore = useChannelsStore();
useSnackbarCleanup(channelsStore);

const theme = useTheme();

const getThemeColor = (colorName: string): string => {
  const color = theme.current.value.colors[colorName];
  if (!color) return '#000000';
  const rgb = hexToRgb(color);
  return `rgb(${rgb})`;
};

const usersTotal = ref(156);
const usersActive = ref(142);
const channelsTotal = ref(8);
const channelsConnected = ref(7);
const chatbotsTotal = ref(12);
const chatbotsActive = ref(10);
const contactsTotal = ref(2847);
const contactsGrowth = ref(234);
const chatsActive = ref(892);
const chatsClosed = ref(353);
const sectorsTotal = ref(15);
const contactGroupsTotal = ref(48);
const messageTemplatesTotal = ref(67);
const labelTemplatesTotal = ref(23);
const rolesTotal = ref(9);

const avgResponseTime = ref('2m 34s');
const avgResolutionTime = ref('15m 42s');
const productivity = ref(87);
const totalAttendances = ref(1245);

const conversationsEvolutionData = computed(() => ({
  labels: [
    'Jan',
    'Fev',
    'Mar',
    'Abr',
    'Mai',
    'Jun',
    'Jul',
    'Ago',
    'Set',
    'Out',
    'Nov',
    'Dez',
  ],
  datasets: [
    {
      label: 'Conversas Ativas',
      data: [650, 720, 680, 750, 820, 780, 850, 880, 920, 890, 910, 892],
      borderColor: 'rgb(25, 118, 210)',
      backgroundColor: 'rgba(25, 118, 210, 0.1)',
      tension: 0.4,
      fill: true,
    },
    {
      label: 'Conversas Encerradas',
      data: [280, 310, 290, 320, 350, 330, 360, 370, 380, 360, 355, 353],
      borderColor: 'rgb(46, 125, 50)',
      backgroundColor: 'rgba(46, 125, 50, 0.1)',
      tension: 0.4,
      fill: true,
    },
  ],
}));

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
    'Jan',
    'Fev',
    'Mar',
    'Abr',
    'Mai',
    'Jun',
    'Jul',
    'Ago',
    'Set',
    'Out',
    'Nov',
    'Dez',
  ],
  datasets: [
    {
      label: 'Crescimento de Contatos',
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
    'Atendimento',
    'Vendas',
    'Suporte',
    'Financeiro',
    'Técnico',
    'Outros',
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
  labels: ['Conectados', 'Desconectados'],
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
  labels: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'],
  datasets: [
    {
      label: 'Atendimentos Realizados',
      data: [185, 210, 195, 225, 240, 150, 120],
      backgroundColor: 'rgba(25, 118, 210, 0.8)',
    },
    {
      label: 'Meta Diária',
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
    name: 'Usuários',
    data: [140, 142, 145, 143, 144, 146, 142],
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
    name: 'Chatbots',
    data: [8, 9, 10, 11, 10, 12, 10],
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
    name: 'Contatos',
    data: [2800, 2820, 2830, 2835, 2840, 2845, 2847],
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

const chatsSeries = computed(() => [
  {
    name: 'Conversas',
    data: [850, 870, 880, 890, 885, 895, 892],
  },
]);

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
</script>

<template>
  <div>
    <VRow class="mb-4">
      <VCol cols="12">
        <div class="d-flex align-center justify-space-between flex-wrap gap-4">
          <div>
            <h1 class="text-h4 font-weight-bold">Dashboard</h1>
            <p class="text-body-2 text-medium-emphasis mt-1">
              Visão geral do sistema
            </p>
          </div>
          <VChip
            color="success"
            variant="tonal"
            prepend-icon="tabler-circle-check"
          >
            Sistema Operacional
          </VChip>
        </div>
      </VCol>
    </VRow>

    <VRow class="mb-4">
      <VCol cols="12" sm="6" md="3">
        <CardStatisticsVertical
          title="Usuários"
          :stats="usersTotal.toString()"
          icon="tabler-users"
          color="primary"
          :height="80"
          :series="usersSeries"
          :chart-options="usersChartOptions"
        />
      </VCol>
      <VCol cols="12" sm="6" md="3">
        <CardStatisticsVertical
          title="Canais WhatsApp"
          :stats="`${channelsConnected}/${channelsTotal}`"
          icon="tabler-robot"
          color="info"
          :height="80"
          :series="chatbotsSeries"
          :chart-options="chatbotsChartOptions"
        />
      </VCol>
      <VCol cols="12" sm="6" md="3">
        <CardStatisticsVertical
          title="Contatos"
          :stats="contactsTotal.toLocaleString('pt-BR')"
          icon="tabler-address-book"
          color="warning"
          :height="80"
          :series="contactsSeries"
          :chart-options="contactsChartOptions"
        />
      </VCol>
      <VCol cols="12" sm="6" md="3">
        <CardStatisticsVertical
          title="Conversas Ativas"
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
            <span>Evolução de Conversas</span>
            <VChip size="small" color="primary" variant="tonal">
              Últimos 12 meses
            </VChip>
          </VCardTitle>
          <VCardText class="flex-grow-1 d-flex flex-column">
            <div class="flex-grow-1" style="min-height: 300px">
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
          <VCardTitle>Status dos Canais</VCardTitle>
          <VCardText class="flex-grow-1 d-flex flex-column">
            <div style="height: 300px; flex-shrink: 0">
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
                  <span class="text-body-2">Conectados</span>
                </div>
                <span class="text-body-1 font-weight-medium">
                  {{ channelsConnected }}
                </span>
              </div>
              <div class="d-flex align-center justify-space-between">
                <div class="d-flex align-center gap-2">
                  <VIcon icon="tabler-circle" size="12" color="error" />
                  <span class="text-body-2">Desconectados</span>
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
          <VCardTitle>Crescimento de Contatos</VCardTitle>
          <VCardText class="flex-grow-1 d-flex flex-column">
            <div style="height: 250px; flex-shrink: 0">
              <LineChart
                :chart-data="contactsGrowthData"
                :chart-options="contactsGrowthOptions"
                :height="250"
              />
            </div>
            <div class="mt-4 d-flex align-center gap-4" style="flex-shrink: 0">
              <div>
                <span class="text-body-2 text-medium-emphasis d-block">
                  Total
                </span>
                <span class="text-h6 font-weight-bold">
                  {{ contactsTotal.toLocaleString('pt-BR') }}
                </span>
              </div>
              <VDivider vertical />
              <div>
                <span class="text-body-2 text-medium-emphasis d-block">
                  Crescimento
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
          <VCardTitle>Desempenho de Atendimento</VCardTitle>
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
                  Total de Atendimentos
                </span>
                <span class="text-h6 font-weight-bold">
                  {{ totalAttendances }}
                </span>
              </div>
              <VDivider vertical />
              <div>
                <span class="text-body-2 text-medium-emphasis d-block">
                  Produtividade
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
          <VCardTitle>Distribuição por Setores</VCardTitle>
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
          <VCardTitle>Métricas de Atendimento</VCardTitle>
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
                          Tempo Médio de Resposta
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
                          Tempo Médio de Resolução
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
                          Total de Atendimentos
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
                          Produtividade
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
                  Chatbots Ativos
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
                  Grupos de Contatos
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
                  Templates de Mensagem
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
                  Templates de Label
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
