<script setup lang="ts">
import { computed, type DeepReadonly } from 'vue';
import { useI18n } from 'vue-i18n';
import type { WorkerConnectionHealthResponse } from '@core/schema/worker/workerConnectionLogs/response.schema';
import {
  buildConnectionHealthMetricRows,
  connectionHealthDiagnosticTranslationKey,
  formatConnectionDuration,
  formatConnectionHealthDiagnosticFallback,
  type ConnectionHealthMetricKey,
} from '@/utils/connectionHealthPresentation';

const props = defineProps<{
  health: DeepReadonly<WorkerConnectionHealthResponse>;
  metric: ConnectionHealthMetricKey;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t, te, locale } = useI18n();

const rows = computed(() =>
  buildConnectionHealthMetricRows(props.health.events, props.metric)
);
const title = computed(() =>
  t(`connection_health_metric_table_${props.metric}`)
);
const total = computed(() => {
  if (props.metric === 'last_downtime') {
    return props.health.metrics.last_downtime_seconds === null ? 0 : 1;
  }

  return props.health.metrics[props.metric];
});
const showEndedAt = computed(
  () => props.metric === 'disconnections' || props.metric === 'last_downtime'
);

const formatDate = (value: string): string =>
  new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(value));

const translateDiagnostic = (value: string): string => {
  const translationKey = connectionHealthDiagnosticTranslationKey(value);
  return te(translationKey)
    ? t(translationKey)
    : formatConnectionHealthDiagnosticFallback(value);
};

const translateStatus = (status: string): string => {
  const translationKey = `connection_health_status_${status}`;
  return te(translationKey) ? t(translationKey) : translateDiagnostic(status);
};

const rowContext = (row: (typeof rows.value)[number]): string => {
  const diagnostic = row.reason || row.errorCode;
  if (diagnostic) return translateDiagnostic(diagnostic);

  return row.status === 'online'
    ? t('connection_health_event_connected')
    : t('connection_health_event_disconnected');
};

const sessionLabel = (row: (typeof rows.value)[number]): string => {
  if (row.authenticated && row.sessionValid === true) {
    return t('connection_health_metric_session_valid');
  }
  if (row.recoverable) return t('connection_health_metric_session_recoverable');
  return t('connection_health_metric_session_unavailable');
};

const statusTone = (status: string): string => {
  if (status === 'online') return 'success';
  if (
    ['initializing', 'restoring', 'connecting', 'qr', 'reconnecting'].includes(
      status
    )
  ) {
    return 'warning';
  }
  return 'error';
};
</script>

<template>
  <section class="metric-table-panel">
    <header class="metric-table-panel__header">
      <div>
        <span>{{ $t('connection_health_metric_table_eyebrow') }}</span>
        <h3>{{ title }}</h3>
        <p>
          {{
            $t('connection_health_metric_table_description', {
              shown: rows.length,
              total,
            })
          }}
        </p>
      </div>
      <IconBtn :aria-label="$t('close')" @click="emit('close')">
        <VIcon icon="tabler-x" />
      </IconBtn>
    </header>

    <div v-if="rows.length" class="metric-table-panel__scroller">
      <table>
        <thead>
          <tr>
            <th>{{ $t('connection_health_metric_occurred_at') }}</th>
            <th v-if="showEndedAt">
              {{ $t('connection_health_metric_ended_at') }}
            </th>
            <th>{{ $t('status') }}</th>
            <th>{{ $t('connection_health_metric_duration') }}</th>
            <th>{{ $t('connection_health_metric_context') }}</th>
            <th>{{ $t('connection_health_metric_session') }}</th>
            <th>{{ $t('connection_health_generation_short') }}</th>
            <th>{{ $t('code') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td>
              <time :datetime="row.observedAt">{{
                formatDate(row.observedAt)
              }}</time>
            </td>
            <td v-if="showEndedAt">
              <time v-if="row.endedAt" :datetime="row.endedAt">
                {{ formatDate(row.endedAt) }}
              </time>
              <span v-else>—</span>
            </td>
            <td>
              <VChip :color="statusTone(row.status)" size="x-small">
                {{ translateStatus(row.status) }}
              </VChip>
            </td>
            <td>{{ formatConnectionDuration(row.durationSeconds, locale) }}</td>
            <td class="metric-table-panel__context">{{ rowContext(row) }}</td>
            <td>{{ sessionLabel(row) }}</td>
            <td>#{{ row.runtimeGeneration }}</td>
            <td>{{ row.code ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="metric-table-panel__empty">
      <VIcon icon="tabler-history" size="28" />
      <strong>{{ $t('connection_health_metric_no_rows_title') }}</strong>
      <p>{{ $t('connection_health_metric_no_rows_description') }}</p>
    </div>
  </section>
</template>

<style scoped lang="scss">
.metric-table-panel {
  overflow: hidden;
  border: 0;
  border-radius: 1.15rem;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 0.6rem 1.8rem rgba(24, 36, 52, 0.08);
}

.metric-table-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.25rem;
  border-block-end: 1px solid rgba(var(--v-border-color), 0.09);
  background: rgba(var(--v-theme-primary), 0.035);
}

.metric-table-panel__header > div > span {
  color: rgb(var(--v-theme-primary));
  font-size: 0.68rem;
  font-weight: 720;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.metric-table-panel__header h3 {
  margin-block-start: 0.2rem;
  font-size: 1rem;
  font-weight: 700;
}

.metric-table-panel__header p {
  margin: 0.2rem 0 0;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.72rem;
}

.metric-table-panel__scroller {
  overflow-x: auto;
}

.metric-table-panel table {
  inline-size: 100%;
  min-inline-size: 66rem;
  border-collapse: collapse;
  font-size: 0.75rem;
}

.metric-table-panel th,
.metric-table-panel td {
  padding: 0.78rem 1rem;
  border-block-end: 1px solid rgba(var(--v-border-color), 0.075);
  text-align: start;
  vertical-align: middle;
}

.metric-table-panel th {
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.65rem;
  font-weight: 720;
  letter-spacing: 0.045em;
  text-transform: uppercase;
  white-space: nowrap;
}

.metric-table-panel tbody tr:last-child td {
  border-block-end: 0;
}

.metric-table-panel tbody tr:hover {
  background: rgba(var(--v-theme-primary), 0.025);
}

.metric-table-panel time,
.metric-table-panel td:not(.metric-table-panel__context) {
  white-space: nowrap;
}

.metric-table-panel__context {
  min-inline-size: 16rem;
  color: rgba(var(--v-theme-on-surface), 0.72);
}

.metric-table-panel__empty {
  display: grid;
  min-block-size: 11rem;
  place-content: center;
  justify-items: center;
  gap: 0.35rem;
  padding: 2rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
  text-align: center;
}

.metric-table-panel__empty strong {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.86rem;
}

.metric-table-panel__empty p {
  max-inline-size: 30rem;
  margin: 0;
  font-size: 0.72rem;
}
</style>
