<script setup lang="ts">
import { computed, type DeepReadonly } from 'vue';
import { useI18n } from 'vue-i18n';
import VueApexCharts from 'vue3-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type { WorkerConnectionHealthResponse } from '@core/schema/worker/workerConnectionLogs/response.schema';

const props = defineProps<{
  metrics: DeepReadonly<WorkerConnectionHealthResponse['metrics']>;
  timeline: DeepReadonly<WorkerConnectionHealthResponse['timeline']>;
}>();

const { t, locale } = useI18n();

const hasObservedData = computed(() =>
  props.timeline.some((point) => point.availability_percentage !== null)
);

const series = computed(() => [
  {
    name: t('connection_health_availability'),
    data: props.timeline.map((point) => ({
      x: new Date(point.started_at).getTime(),
      y: point.availability_percentage,
      events: point.event_count,
    })),
  },
]);

const chartOptions = computed<ApexOptions>(() => ({
  chart: {
    animations: { enabled: true, speed: 420 },
    background: 'transparent',
    fontFamily: 'Public Sans, sans-serif',
    parentHeightOffset: 0,
    toolbar: { show: false },
    zoom: { enabled: false },
  },
  colors: ['#14b87a'],
  dataLabels: { enabled: false },
  fill: {
    opacity: 0.92,
    type: 'gradient',
    gradient: {
      opacityFrom: 0.95,
      opacityTo: 0.55,
      shadeIntensity: 0.25,
      stops: [0, 100],
      type: 'vertical',
    },
  },
  grid: {
    borderColor: 'rgba(var(--v-theme-on-surface), 0.09)',
    padding: { bottom: -4, left: 6, right: 6, top: 4 },
    strokeDashArray: 5,
  },
  plotOptions: {
    bar: {
      borderRadius: 3,
      columnWidth: props.metrics.period_hours === 168 ? '82%' : '68%',
    },
  },
  states: {
    active: { filter: { type: 'none' } },
    hover: { filter: { type: 'lighten', value: 0.08 } },
  },
  stroke: { show: false },
  tooltip: {
    x: {
      formatter: (value: number) =>
        new Intl.DateTimeFormat(locale.value, {
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          month: 'short',
        }).format(new Date(value)),
    },
    y: {
      formatter: (value: number) =>
        `${new Intl.NumberFormat(locale.value, {
          maximumFractionDigits: 2,
        }).format(value)}%`,
    },
  },
  xaxis: {
    axisBorder: { show: false },
    axisTicks: { show: false },
    labels: {
      datetimeUTC: false,
      hideOverlappingLabels: true,
      style: {
        colors: 'rgba(var(--v-theme-on-surface), 0.5)',
        fontSize: '11px',
      },
    },
    tickAmount: props.metrics.period_hours === 24 ? 6 : 8,
    type: 'datetime',
  },
  yaxis: {
    max: 100,
    min: 0,
    tickAmount: 4,
    labels: {
      formatter: (value: number) => `${Math.round(value)}%`,
      style: {
        colors: 'rgba(var(--v-theme-on-surface), 0.5)',
        fontSize: '11px',
      },
    },
  },
}));
</script>

<template>
  <section class="stability-panel">
    <header class="stability-panel__header">
      <div>
        <span class="stability-panel__eyebrow">{{
          $t('connection_health_history')
        }}</span>
        <h3>{{ $t('connection_health_stability_title') }}</h3>
        <p>{{ $t('connection_health_stability_description') }}</p>
      </div>

      <div class="stability-panel__legend" aria-hidden="true">
        <span />
        {{ $t('connection_health_online_per_hour') }}
      </div>
    </header>

    <div v-if="hasObservedData" class="stability-panel__chart">
      <VueApexCharts
        :key="metrics.period_hours"
        type="bar"
        height="270"
        :options="chartOptions"
        :series="series"
      />
    </div>

    <div v-else class="stability-panel__empty">
      <span class="stability-panel__empty-icon">
        <VIcon icon="tabler-chart-bar-off" size="24" />
      </span>
      <strong>{{ $t('connection_health_no_history_title') }}</strong>
      <p>{{ $t('connection_health_no_history_description') }}</p>
    </div>
  </section>
</template>

<style scoped lang="scss">
.stability-panel {
  min-block-size: 23.5rem;
  padding: 1.35rem 1.35rem 0.85rem;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 1.15rem;
  background: rgb(var(--v-theme-surface));
}

.stability-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.stability-panel__eyebrow {
  color: rgb(var(--v-theme-primary));
  font-size: 0.68rem;
  font-weight: 720;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.stability-panel__header h3 {
  margin-block: 0.3rem 0.18rem;
  font-size: 1.06rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.stability-panel__header p,
.stability-panel__empty p {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.78rem;
}

.stability-panel__legend {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.42rem;
  margin-block-start: 0.22rem;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.72rem;
}

.stability-panel__legend span {
  block-size: 0.48rem;
  inline-size: 0.48rem;
  border-radius: 0.16rem;
  background: #14b87a;
}

.stability-panel__chart {
  margin-block-start: 0.45rem;
  margin-inline: -0.45rem;
}

.stability-panel__empty {
  display: grid;
  min-block-size: 16.5rem;
  align-content: center;
  justify-items: center;
  gap: 0.42rem;
  text-align: center;
}

.stability-panel__empty-icon {
  display: grid;
  block-size: 3rem;
  inline-size: 3rem;
  margin-block-end: 0.25rem;
  border-radius: 0.9rem;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
  place-items: center;
}

@media (max-width: 640px) {
  .stability-panel__header {
    display: block;
  }

  .stability-panel__legend {
    margin-block-start: 0.8rem;
  }
}
</style>
