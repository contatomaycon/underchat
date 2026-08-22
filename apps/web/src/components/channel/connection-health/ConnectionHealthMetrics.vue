<script setup lang="ts">
import { computed, type DeepReadonly } from 'vue';
import { useI18n } from 'vue-i18n';
import type { WorkerConnectionHealthResponse } from '@core/schema/worker/workerConnectionLogs/response.schema';
import {
  formatConnectionDuration,
  type ConnectionHealthMetricKey,
} from '@/utils/connectionHealthPresentation';

const props = defineProps<{
  health: DeepReadonly<WorkerConnectionHealthResponse>;
  selectedMetric: ConnectionHealthMetricKey | null;
}>();

const emit = defineEmits<{
  selectMetric: [metric: ConnectionHealthMetricKey];
}>();

const { t, locale } = useI18n();

const formattedNumber = (value: number): string =>
  new Intl.NumberFormat(locale.value).format(value);

const metricItems = computed(() => [
  {
    key: 'disconnections' as const,
    icon: 'tabler-plug-connected-x',
    label: t('connection_health_disconnections'),
    value: formattedNumber(props.health.metrics.disconnections),
    note: t('connection_health_in_selected_period'),
    tone: props.health.metrics.disconnections > 0 ? 'warning' : 'success',
  },
  {
    key: 'reconnections' as const,
    icon: 'tabler-refresh-dot',
    label: t('connection_health_reconnections'),
    value: formattedNumber(props.health.metrics.reconnections),
    note: t('connection_health_automatic_recoveries'),
    tone: 'primary',
  },
  {
    key: 'status_changes' as const,
    icon: 'tabler-transfer',
    label: t('connection_health_status_changes'),
    value: formattedNumber(props.health.metrics.status_changes),
    note: t('connection_health_observed_events'),
    tone: 'info',
  },
  {
    key: 'last_downtime' as const,
    icon: 'tabler-clock-x',
    label: t('connection_health_last_downtime'),
    value: formatConnectionDuration(
      props.health.metrics.last_downtime_seconds,
      locale.value
    ),
    note: t('connection_health_completed_outage'),
    tone:
      props.health.metrics.last_downtime_seconds === null
        ? 'success'
        : 'warning',
  },
]);
</script>

<template>
  <aside class="metrics-panel">
    <div class="metrics-panel__heading">
      <span>{{ $t('connection_health_period_summary') }}</span>
      <VIcon icon="tabler-heartbeat" size="20" />
    </div>

    <div class="metrics-panel__list">
      <button
        v-for="metric in metricItems"
        :key="metric.key"
        type="button"
        class="metrics-panel__item"
        :class="{ 'is-selected': selectedMetric === metric.key }"
        :aria-pressed="selectedMetric === metric.key"
        @click="emit('selectMetric', metric.key)"
      >
        <span class="metrics-panel__icon" :class="`is-${metric.tone}`">
          <VIcon :icon="metric.icon" size="19" />
        </span>
        <div class="metrics-panel__copy">
          <span>{{ metric.label }}</span>
          <small>{{ metric.note }}</small>
        </div>
        <strong>{{ metric.value }}</strong>
        <VIcon icon="tabler-chevron-right" size="17" />
      </button>
    </div>

    <div class="metrics-panel__observation">
      <VIcon icon="tabler-clock-check" size="18" />
      <div>
        <strong>{{ $t('connection_health_observed_time') }}</strong>
        <span>
          {{
            formatConnectionDuration(health.metrics.observed_seconds, locale)
          }}
          {{ $t('connection_health_of_window') }}
        </span>
      </div>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.metrics-panel {
  display: flex;
  min-block-size: 23.5rem;
  flex-direction: column;
  padding: 1.25rem;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 1.15rem;
  background:
    linear-gradient(
      180deg,
      rgba(var(--v-theme-primary), 0.035),
      transparent 38%
    ),
    rgb(var(--v-theme-surface));
}

.metrics-panel__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-block-end: 0.9rem;
  border-block-end: 1px solid rgba(var(--v-border-color), 0.1);
  font-size: 0.82rem;
  font-weight: 680;
}

.metrics-panel__heading .v-icon {
  color: rgb(var(--v-theme-primary));
}

.metrics-panel__list {
  display: grid;
  flex: 1;
  align-content: start;
  gap: 0.16rem;
}

.metrics-panel__item {
  display: grid;
  inline-size: 100%;
  align-items: center;
  gap: 0.75rem;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  padding: 0.82rem 0.5rem;
  appearance: none;
  border: 0 !important;
  border-radius: 0.72rem;
  background: transparent;
  box-shadow: none !important;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: start;
  transition:
    background-color 160ms ease,
    transform 160ms ease;
}

.metrics-panel__item:hover,
.metrics-panel__item:focus-visible,
.metrics-panel__item.is-selected {
  background: rgba(var(--v-theme-primary), 0.055);
}

.metrics-panel__item:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px rgba(var(--v-theme-primary), 0.3) !important;
}

.metrics-panel__item.is-selected > .v-icon {
  color: rgb(var(--v-theme-primary));
  transform: rotate(90deg);
}

.metrics-panel__item > .v-icon {
  color: rgba(var(--v-theme-on-surface), 0.36);
  transition: transform 160ms ease;
}

.metrics-panel__icon {
  display: grid;
  block-size: 2.25rem;
  inline-size: 2.25rem;
  border-radius: 0.7rem;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
  place-items: center;
}

.metrics-panel__icon.is-success {
  background: rgba(var(--v-theme-success), 0.09);
  color: rgb(var(--v-theme-success));
}

.metrics-panel__icon.is-warning {
  background: rgba(var(--v-theme-warning), 0.1);
  color: rgb(var(--v-theme-warning));
}

.metrics-panel__icon.is-info {
  background: rgba(var(--v-theme-info), 0.09);
  color: rgb(var(--v-theme-info));
}

.metrics-panel__copy {
  display: grid;
  min-inline-size: 0;
  gap: 0.08rem;
  font-size: 0.77rem;
  font-weight: 610;
}

.metrics-panel__copy small {
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.66rem;
  font-weight: 450;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metrics-panel__item > strong {
  font-size: 0.98rem;
  font-weight: 720;
  letter-spacing: -0.02em;
}

.metrics-panel__observation {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  margin-block-start: 0.85rem;
  padding: 0.8rem;
  border-radius: 0.8rem;
  background: rgba(var(--v-theme-primary), 0.065);
  color: rgb(var(--v-theme-primary));
}

.metrics-panel__observation div {
  display: grid;
  gap: 0.08rem;
}

.metrics-panel__observation strong {
  font-size: 0.71rem;
}

.metrics-panel__observation span {
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 0.66rem;
}
</style>
