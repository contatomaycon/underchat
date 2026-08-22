<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { useDisplay } from 'vuetify';
import { useI18n } from 'vue-i18n';
import {
  useChannelConnectionHealth,
  type ChannelConnectionHealthScope,
} from '@/composables/useChannelConnectionHealth';
import ConnectionHealthHero from '@/components/channel/connection-health/ConnectionHealthHero.vue';
import ConnectionStabilityChart from '@/components/channel/connection-health/ConnectionStabilityChart.vue';
import ConnectionHealthMetrics from '@/components/channel/connection-health/ConnectionHealthMetrics.vue';
import ConnectionHealthDetails from '@/components/channel/connection-health/ConnectionHealthDetails.vue';
import ConnectionActivity from '@/components/channel/connection-health/ConnectionActivity.vue';
import ConnectionHealthMetricTable from '@/components/channel/connection-health/ConnectionHealthMetricTable.vue';
import type { ConnectionHealthMetricKey } from '@/utils/connectionHealthPresentation';

const props = withDefaults(
  defineProps<{
    channelId: string | null;
    scope?: ChannelConnectionHealthScope;
  }>(),
  { scope: 'worker' }
);

const isVisible = defineModel<boolean>({ required: true });
const { t, locale } = useI18n();
const { smAndDown } = useDisplay();
const selectedMetric = shallowRef<ConnectionHealthMetricKey | null>(null);

const {
  health,
  periodHours,
  isLoading,
  isLoadingMore,
  hasError,
  refresh,
  loadMoreLogs,
} = useChannelConnectionHealth(() => props.channelId, {
  scope: () => props.scope,
});

const periodOptions = computed(() => [
  { value: 24 as const, label: t('connection_health_period_24h') },
  { value: 72 as const, label: t('connection_health_period_3d') },
  { value: 168 as const, label: t('connection_health_period_7d') },
]);

const generatedAtLabel = computed(() => {
  if (!health.value) return '';

  return new Intl.DateTimeFormat(locale.value, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(health.value.generated_at));
});

const toggleMetric = (metric: ConnectionHealthMetricKey): void => {
  selectedMetric.value = selectedMetric.value === metric ? null : metric;
};

watch(
  () => props.channelId,
  () => {
    selectedMetric.value = null;
  }
);
</script>

<template>
  <VDialog
    v-model="isVisible"
    :fullscreen="smAndDown"
    max-width="1220"
    scrollable
    transition="dialog-bottom-transition"
  >
    <VCard class="connection-health-dialog">
      <header class="connection-health-dialog__toolbar">
        <div class="connection-health-dialog__title">
          <span class="connection-health-dialog__title-icon">
            <VIcon icon="tabler-heartbeat" size="21" />
          </span>
          <div>
            <h1>{{ $t('connection_health_title') }}</h1>
            <p>{{ $t('connection_health_subtitle') }}</p>
          </div>
        </div>

        <div class="connection-health-dialog__actions">
          <div
            class="connection-health-dialog__periods"
            role="group"
            :aria-label="$t('connection_health_period')"
          >
            <button
              v-for="option in periodOptions"
              :key="option.value"
              type="button"
              :class="{ 'is-active': periodHours === option.value }"
              @click="periodHours = option.value"
            >
              {{ option.label }}
            </button>
          </div>

          <IconBtn
            :aria-label="$t('refresh')"
            :disabled="isLoading"
            @click="refresh"
          >
            <VIcon
              icon="tabler-refresh"
              :class="{ 'is-spinning': isLoading }"
            />
            <VTooltip activator="parent" location="bottom">
              {{ $t('refresh') }}
            </VTooltip>
          </IconBtn>

          <IconBtn :aria-label="$t('close')" @click="isVisible = false">
            <VIcon icon="tabler-x" />
          </IconBtn>
        </div>
      </header>

      <VCardText class="connection-health-dialog__content">
        <div v-if="isLoading && !health" class="connection-health-skeleton">
          <VSkeletonLoader
            type="image"
            class="connection-health-skeleton__hero"
          />
          <div class="connection-health-skeleton__grid">
            <VSkeletonLoader type="card" />
            <VSkeletonLoader type="card" />
          </div>
          <VSkeletonLoader type="article" />
        </div>

        <div v-else-if="hasError || !health" class="connection-health-error">
          <span class="connection-health-error__icon">
            <VIcon icon="tabler-cloud-off" size="30" />
          </span>
          <h2>{{ $t('connection_health_load_error_title') }}</h2>
          <p>{{ $t('connection_health_load_error_description') }}</p>
          <VBtn
            color="primary"
            variant="tonal"
            prepend-icon="tabler-refresh"
            @click="refresh"
          >
            {{ $t('try_again') }}
          </VBtn>
        </div>

        <div v-else class="connection-health-layout">
          <ConnectionHealthHero :health="health" />

          <div class="connection-health-layout__analytics">
            <ConnectionStabilityChart
              :metrics="health.metrics"
              :timeline="health.timeline"
            />
            <ConnectionHealthMetrics
              :health="health"
              :selected-metric="selectedMetric"
              @select-metric="toggleMetric"
            />
          </div>

          <ConnectionHealthMetricTable
            v-if="selectedMetric"
            :health="health"
            :metric="selectedMetric"
            @close="selectedMetric = null"
          />

          <ConnectionHealthDetails :health="health" />

          <ConnectionActivity
            :events="health.events"
            :logs="health.logs"
            :has-more-logs="health.logs_has_more"
            :is-loading-more="isLoadingMore"
            @load-more="loadMoreLogs"
          />

          <footer class="connection-health-layout__footer">
            <span>
              <VIcon icon="tabler-history" size="16" />
              {{ $t('connection_health_history_source') }}
            </span>
            <span>
              {{
                $t('connection_health_updated_at', {
                  time: generatedAtLabel,
                })
              }}
            </span>
          </footer>
        </div>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style scoped lang="scss">
.connection-health-dialog {
  max-block-size: min(92vh, 60rem);
  border: 1px solid rgba(var(--v-border-color), 0.18);
  border-radius: 1.4rem !important;
  box-shadow: 0 2rem 5rem rgba(24, 36, 52, 0.22) !important;
}

.connection-health-dialog__toolbar {
  position: relative;
  z-index: 5;
  display: flex;
  min-block-size: 5.2rem;
  align-items: center;
  justify-content: space-between;
  gap: 1.25rem;
  padding: 1rem 1.25rem;
  border-block-end: 1px solid rgba(var(--v-border-color), 0.11);
  background: rgba(var(--v-theme-surface), 0.94);
  backdrop-filter: blur(18px);
}

.connection-health-dialog__title,
.connection-health-dialog__actions {
  display: flex;
  align-items: center;
}

.connection-health-dialog__title {
  min-inline-size: 0;
  gap: 0.75rem;
}

.connection-health-dialog__title-icon {
  display: grid;
  flex: 0 0 auto;
  block-size: 2.65rem;
  inline-size: 2.65rem;
  border-radius: 0.85rem;
  background: rgba(var(--v-theme-primary), 0.09);
  color: rgb(var(--v-theme-primary));
  place-items: center;
}

.connection-health-dialog__title h1 {
  font-size: 1rem;
  font-weight: 720;
  letter-spacing: -0.02em;
}

.connection-health-dialog__title p {
  margin: 0.12rem 0 0;
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.69rem;
}

.connection-health-dialog__actions {
  gap: 0.35rem;
}

.connection-health-dialog__periods {
  display: flex;
  gap: 0.2rem;
  margin-inline-end: 0.45rem;
  padding: 0.22rem;
  border: 1px solid rgba(var(--v-border-color), 0.11);
  border-radius: 0.72rem;
  background: rgba(var(--v-theme-on-surface), 0.035);
}

.connection-health-dialog__periods button {
  min-block-size: 2rem;
  padding-inline: 0.72rem;
  border-radius: 0.52rem;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.69rem;
  font-weight: 640;
  transition: 180ms ease;
}

.connection-health-dialog__periods button:hover {
  color: rgb(var(--v-theme-on-surface));
}

.connection-health-dialog__periods button.is-active {
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 0.15rem 0.55rem rgba(26, 43, 64, 0.1);
  color: rgb(var(--v-theme-primary));
}

.connection-health-dialog__actions .is-spinning {
  animation: health-spin 0.9s linear infinite;
}

.connection-health-dialog__content {
  padding: 1.15rem !important;
  background:
    radial-gradient(
      circle at 8% 4%,
      rgba(var(--v-theme-primary), 0.045),
      transparent 22rem
    ),
    rgb(var(--v-theme-background));
}

.connection-health-layout {
  display: grid;
  gap: 1.1rem;
}

.connection-health-layout__analytics {
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(0, 1.85fr) minmax(17rem, 0.75fr);
}

.connection-health-layout__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-inline: 0.25rem;
  color: rgba(var(--v-theme-on-surface), 0.46);
  font-size: 0.65rem;
}

.connection-health-layout__footer span:first-child {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.connection-health-skeleton {
  display: grid;
  gap: 1rem;
}

.connection-health-skeleton__hero {
  overflow: hidden;
  block-size: 9.75rem;
  border-radius: 1.15rem;
}

.connection-health-skeleton__grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: 2fr 1fr;
}

.connection-health-error {
  display: grid;
  min-block-size: 31rem;
  align-content: center;
  justify-items: center;
  gap: 0.55rem;
  padding: 2rem;
  text-align: center;
}

.connection-health-error__icon {
  display: grid;
  block-size: 4.3rem;
  inline-size: 4.3rem;
  margin-block-end: 0.3rem;
  border-radius: 1.25rem;
  background: rgba(var(--v-theme-error), 0.09);
  color: rgb(var(--v-theme-error));
  place-items: center;
}

.connection-health-error h2 {
  font-size: 1rem;
}

.connection-health-error p {
  max-inline-size: 29rem;
  margin: 0 0 0.65rem;
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 0.75rem;
}

@keyframes health-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 960px) {
  .connection-health-layout__analytics {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 700px) {
  .connection-health-dialog {
    max-block-size: 100vh;
    border-radius: 0 !important;
  }

  .connection-health-dialog__toolbar {
    align-items: flex-start;
    flex-direction: column;
    padding: 0.85rem 1rem;
  }

  .connection-health-dialog__actions {
    inline-size: 100%;
  }

  .connection-health-dialog__periods {
    flex: 1;
  }

  .connection-health-dialog__periods button {
    flex: 1;
  }

  .connection-health-layout__footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .connection-health-skeleton__grid {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .connection-health-dialog__periods button {
    transition: none;
  }

  .connection-health-dialog__actions .is-spinning {
    animation-duration: 1.8s;
  }
}
</style>
