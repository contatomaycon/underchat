<script setup lang="ts">
import { computed, shallowRef, type DeepReadonly } from 'vue';
import { useI18n } from 'vue-i18n';
import type { WorkerConnectionHealthResponse } from '@core/schema/worker/workerConnectionLogs/response.schema';
import {
  connectionHealthDiagnosticTranslationKey,
  formatConnectionHealthDiagnosticFallback,
} from '@/utils/connectionHealthPresentation';

const props = defineProps<{
  events: DeepReadonly<WorkerConnectionHealthResponse['events']>;
  logs: DeepReadonly<WorkerConnectionHealthResponse['logs']>;
  hasMoreLogs: boolean;
  isLoadingMore: boolean;
}>();

const emit = defineEmits<{
  loadMore: [];
}>();

const { t, te, locale } = useI18n();
const selectedTab = shallowRef<'events' | 'logs'>('events');

const formatDate = (value: string): string =>
  new Intl.DateTimeFormat(locale.value, {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    second: '2-digit',
  }).format(new Date(value));

const statusTone = (status: string): string => {
  if (status === 'online') return 'success';
  if (
    [
      'initializing',
      'restoring',
      'connecting',
      'qr',
      'reconnecting',
      'handoff',
    ].includes(status)
  ) {
    return 'warning';
  }

  return 'error';
};

const statusIcon = (status: string): string => {
  if (status === 'online') return 'tabler-plug-connected';
  if (status === 'qr') return 'tabler-qrcode';
  if (status === 'reconnecting') return 'tabler-refresh-dot';
  if (status === 'error') return 'tabler-alert-triangle';
  return 'tabler-plug-connected-x';
};

const eventCountLabel = computed(() =>
  t('connection_health_event_count', { count: props.events.length })
);

const translateDiagnostic = (value: string): string => {
  const translationKey = connectionHealthDiagnosticTranslationKey(value);
  if (te(translationKey)) return t(translationKey);

  return formatConnectionHealthDiagnosticFallback(value);
};

const translateStatus = (status: string): string => {
  const statusKey = `connection_health_status_${status}`;
  if (te(statusKey)) return t(statusKey);

  return translateDiagnostic(status);
};

const eventDescription = (
  event: DeepReadonly<WorkerConnectionHealthResponse['events'][number]>
): string => {
  const diagnostic = event.reason || event.error_code;
  if (diagnostic) return translateDiagnostic(diagnostic);

  return t(
    event.connected
      ? 'connection_health_event_connected'
      : 'connection_health_event_disconnected'
  );
};
</script>

<template>
  <section class="activity-panel">
    <header class="activity-panel__header">
      <div>
        <span>{{ $t('connection_health_activity') }}</span>
        <h3>{{ $t('connection_health_timeline_title') }}</h3>
      </div>
      <span class="activity-panel__count">{{ eventCountLabel }}</span>
    </header>

    <VTabs
      v-model="selectedTab"
      class="activity-panel__tabs"
      density="compact"
      color="primary"
    >
      <VTab value="events">
        <VIcon icon="tabler-heartbeat" size="17" start />
        {{ $t('connection_health_status_events') }}
      </VTab>
      <VTab value="logs">
        <VIcon icon="tabler-terminal-2" size="17" start />
        {{ $t('connection_health_operational_logs') }}
      </VTab>
    </VTabs>

    <VWindow v-model="selectedTab" class="activity-panel__window">
      <VWindowItem value="events">
        <div v-if="events.length" class="activity-timeline">
          <article
            v-for="event in events"
            :key="event.id"
            class="activity-event"
          >
            <div class="activity-event__rail">
              <span :class="`is-${statusTone(event.status)}`">
                <VIcon :icon="statusIcon(event.status)" size="16" />
              </span>
            </div>

            <div class="activity-event__body">
              <div class="activity-event__topline">
                <strong>{{ translateStatus(event.status) }}</strong>
                <time :datetime="event.observed_at">{{
                  formatDate(event.observed_at)
                }}</time>
              </div>
              <p>{{ eventDescription(event) }}</p>
              <div class="activity-event__badges">
                <span
                  >{{ $t('connection_health_generation_short') }}
                  {{ event.runtime_generation }}</span
                >
                <span v-if="event.code">{{ $t('code') }} {{ event.code }}</span>
              </div>
            </div>
          </article>
        </div>

        <div v-else class="activity-panel__empty">
          <VIcon icon="tabler-plug-off" size="28" />
          <strong>{{ $t('connection_health_no_events_title') }}</strong>
          <p>{{ $t('connection_health_no_events_description') }}</p>
        </div>
      </VWindowItem>

      <VWindowItem value="logs">
        <div v-if="logs.length" class="operational-logs">
          <article
            v-for="(log, index) in logs"
            :key="`${log.date}-${log.code ?? 'log'}-${index}`"
            class="operational-log"
          >
            <time :datetime="log.date">{{ formatDate(log.date) }}</time>
            <div>
              <div class="operational-log__heading">
                <strong>{{
                  log.status
                    ? translateStatus(log.status)
                    : $t('connection_health_log_event')
                }}</strong>
                <span v-if="log.code">{{ log.code }}</span>
              </div>
              <p>
                {{
                  log.message
                    ? translateDiagnostic(log.message)
                    : $t('connection_health_log_without_message')
                }}
              </p>
            </div>
          </article>

          <div v-if="hasMoreLogs" class="operational-logs__more">
            <VBtn
              size="small"
              variant="tonal"
              color="primary"
              :loading="isLoadingMore"
              @click="emit('loadMore')"
            >
              {{ $t('load_more') }}
            </VBtn>
          </div>
        </div>

        <div v-else class="activity-panel__empty">
          <VIcon icon="tabler-terminal-2" size="28" />
          <strong>{{ $t('connection_health_no_logs_title') }}</strong>
          <p>{{ $t('connection_health_no_logs_description') }}</p>
        </div>
      </VWindowItem>
    </VWindow>
  </section>
</template>

<style scoped lang="scss">
.activity-panel {
  overflow: hidden;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 1.15rem;
  background: rgb(var(--v-theme-surface));
}

.activity-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.15rem 1.25rem 0.85rem;
}

.activity-panel__header > div > span {
  color: rgb(var(--v-theme-primary));
  font-size: 0.68rem;
  font-weight: 720;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.activity-panel__header h3 {
  margin-block-start: 0.25rem;
  font-size: 1.04rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.activity-panel__count {
  padding: 0.34rem 0.58rem;
  border-radius: 999px;
  background: rgba(var(--v-theme-primary), 0.07);
  color: rgb(var(--v-theme-primary));
  font-size: 0.66rem;
  font-weight: 650;
}

.activity-panel__tabs {
  padding-inline: 0.75rem;
  border-block: 1px solid rgba(var(--v-border-color), 0.09);
}

.activity-panel__window {
  max-block-size: 24rem;
  overflow-y: auto;
}

.activity-timeline,
.operational-logs {
  padding: 0.5rem 1.25rem 1rem;
}

.activity-event {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: 2rem minmax(0, 1fr);
}

.activity-event__rail {
  position: relative;
  display: flex;
  justify-content: center;
  padding-block-start: 0.85rem;
}

.activity-event:not(:last-child) .activity-event__rail::after {
  position: absolute;
  inset-block-start: 2.8rem;
  inset-block-end: -0.4rem;
  inline-size: 1px;
  background: rgba(var(--v-border-color), 0.14);
  content: '';
}

.activity-event__rail > span {
  position: relative;
  z-index: 1;
  display: grid;
  block-size: 2rem;
  inline-size: 2rem;
  border-radius: 0.65rem;
  background: rgba(var(--v-theme-on-surface), 0.06);
  place-items: center;
}

.activity-event__rail > span.is-success {
  background: rgba(var(--v-theme-success), 0.1);
  color: rgb(var(--v-theme-success));
}

.activity-event__rail > span.is-warning {
  background: rgba(var(--v-theme-warning), 0.11);
  color: rgb(var(--v-theme-warning));
}

.activity-event__rail > span.is-error {
  background: rgba(var(--v-theme-error), 0.09);
  color: rgb(var(--v-theme-error));
}

.activity-event__body {
  padding-block: 0.78rem 0.9rem;
  border-block-end: 1px solid rgba(var(--v-border-color), 0.085);
}

.activity-event__topline,
.operational-log__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.activity-event__topline strong,
.operational-log__heading strong {
  font-size: 0.78rem;
  font-weight: 680;
}

.activity-event__topline time,
.operational-log time {
  color: rgba(var(--v-theme-on-surface), 0.47);
  font-size: 0.64rem;
  white-space: nowrap;
}

.activity-event__body p,
.operational-log p {
  margin-block: 0.3rem 0.48rem;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.72rem;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.activity-event__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.activity-event__badges span,
.operational-log__heading span {
  padding: 0.18rem 0.4rem;
  border-radius: 0.36rem;
  background: rgba(var(--v-theme-on-surface), 0.045);
  color: rgba(var(--v-theme-on-surface), 0.54);
  font-size: 0.59rem;
  font-weight: 620;
}

.operational-log {
  display: grid;
  gap: 1rem;
  grid-template-columns: 7.6rem minmax(0, 1fr);
  padding-block: 0.9rem;
  border-block-end: 1px solid rgba(var(--v-border-color), 0.085);
}

.operational-log p {
  margin-block-end: 0;
}

.operational-logs__more {
  display: flex;
  justify-content: center;
  padding-block-start: 1rem;
}

.activity-panel__empty {
  display: grid;
  min-block-size: 15rem;
  align-content: center;
  justify-items: center;
  gap: 0.42rem;
  padding: 2rem;
  color: rgba(var(--v-theme-on-surface), 0.52);
  text-align: center;
}

.activity-panel__empty strong {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.82rem;
}

.activity-panel__empty p {
  max-inline-size: 26rem;
  margin: 0;
  font-size: 0.71rem;
}

@media (max-width: 560px) {
  .operational-log {
    gap: 0.25rem;
    grid-template-columns: 1fr;
  }
}
</style>
