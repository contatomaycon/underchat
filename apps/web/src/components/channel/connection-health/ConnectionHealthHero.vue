<script setup lang="ts">
import { computed, type DeepReadonly } from 'vue';
import { useI18n } from 'vue-i18n';
import type { WorkerConnectionHealthResponse } from '@core/schema/worker/workerConnectionLogs/response.schema';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import { resolveChannelStatusPresentation } from '@/@webcore/utils/channelStatusPresentation';
import {
  formatConnectionDuration,
  resolveConnectionHealthTone,
} from '@/utils/connectionHealthPresentation';

const props = defineProps<{
  health: DeepReadonly<WorkerConnectionHealthResponse>;
}>();

const { t, locale } = useI18n();

const tone = computed(() => resolveConnectionHealthTone(props.health));
const toneLabel = computed(() => t(`connection_health_tone_${tone.value}`));
const availabilityLabel = computed(() => {
  const value = props.health.metrics.availability_percentage;
  if (value === null) return '—';

  return `${new Intl.NumberFormat(locale.value, {
    minimumFractionDigits: value === 100 ? 0 : 1,
    maximumFractionDigits: 2,
  }).format(value)}%`;
});
const availabilityStyle = computed(() => ({
  '--availability': `${
    Math.max(
      0,
      Math.min(100, props.health.metrics.availability_percentage ?? 0)
    ) * 3.6
  }deg`,
}));
const currentStatusLabel = computed(
  () =>
    resolveChannelStatusPresentation(
      { workerStatusId: props.health.channel.worker_status.id },
      t
    ).text
);
const channelNumberLabel = computed(() =>
  props.health.channel.number
    ? formatPhoneBR(props.health.channel.number)
    : t('connection_health_no_number')
);
const uptimeLabel = computed(() =>
  formatConnectionDuration(
    props.health.metrics.current_uptime_seconds,
    locale.value
  )
);
</script>

<template>
  <section class="health-hero" :class="`health-hero--${tone}`">
    <div class="health-hero__identity">
      <div class="health-hero__provider-icon" aria-hidden="true">
        <VIcon icon="tabler-brand-whatsapp" size="25" />
      </div>

      <div class="health-hero__copy">
        <div class="health-hero__eyebrow">
          <span class="health-hero__live-dot" />
          {{ toneLabel }}
        </div>
        <h2 class="health-hero__title" :title="health.channel.name">
          {{ health.channel.name }}
        </h2>
        <div class="health-hero__meta">
          <span>{{ channelNumberLabel }}</span>
          <span aria-hidden="true">•</span>
          <span>{{ $t('connection_health_secure_connection') }}</span>
          <span aria-hidden="true">•</span>
          <span>{{
            health.channel.server_name || $t('connection_health_no_server')
          }}</span>
        </div>
      </div>
    </div>

    <div class="health-hero__signals">
      <div class="health-hero__signal">
        <span class="health-hero__signal-label">{{
          $t('connection_health_current_status')
        }}</span>
        <strong>{{ currentStatusLabel }}</strong>
      </div>
      <div class="health-hero__signal">
        <span class="health-hero__signal-label">{{
          $t('connection_health_uptime')
        }}</span>
        <strong>{{ uptimeLabel }}</strong>
      </div>
      <div
        class="health-hero__availability"
        :style="availabilityStyle"
        :aria-label="
          $t('connection_health_availability_value', {
            value: availabilityLabel,
          })
        "
      >
        <div class="health-hero__availability-center">
          <strong>{{ availabilityLabel }}</strong>
          <span>{{ $t('connection_health_availability') }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.health-hero {
  --health-accent: 75, 92, 111;

  position: relative;
  display: flex;
  min-block-size: 9.75rem;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  overflow: hidden;
  padding: 1.5rem 1.75rem;
  border: 1px solid rgba(var(--health-accent), 0.2);
  border-radius: 1.25rem;
  background:
    radial-gradient(
      circle at 85% 15%,
      rgba(var(--health-accent), 0.18),
      transparent 34%
    ),
    linear-gradient(
      135deg,
      rgba(var(--health-accent), 0.1),
      rgba(var(--v-theme-surface), 0.96) 48%
    );

  &::after {
    position: absolute;
    inset-block: 0;
    inset-inline-end: 9rem;
    inline-size: 1px;
    background: linear-gradient(
      transparent,
      rgba(var(--health-accent), 0.25),
      transparent
    );
    content: '';
    transform: rotate(18deg);
  }
}

.health-hero--healthy {
  --health-accent: 20, 184, 122;
}

.health-hero--attention {
  --health-accent: 240, 157, 44;
}

.health-hero--critical {
  --health-accent: 228, 82, 94;
}

.health-hero__identity,
.health-hero__signals {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
}

.health-hero__identity {
  min-inline-size: 0;
  gap: 1rem;
}

.health-hero__provider-icon {
  display: grid;
  flex: 0 0 auto;
  block-size: 3.25rem;
  inline-size: 3.25rem;
  border: 1px solid rgba(var(--health-accent), 0.24);
  border-radius: 1rem;
  background: rgba(var(--health-accent), 0.12);
  color: rgb(var(--health-accent));
  place-items: center;
}

.health-hero__copy {
  min-inline-size: 0;
}

.health-hero__eyebrow {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  color: rgb(var(--health-accent));
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.health-hero__live-dot {
  block-size: 0.46rem;
  inline-size: 0.46rem;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 0.28rem rgba(var(--health-accent), 0.13);
}

.health-hero__title {
  overflow: hidden;
  max-inline-size: clamp(12rem, 32vw, 29rem);
  margin-block: 0.3rem 0.22rem;
  font-size: clamp(1.1rem, 1.8vw, 1.45rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.18;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.health-hero__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.82rem;
}

.health-hero__signals {
  justify-content: flex-end;
  gap: clamp(1rem, 2.5vw, 2.25rem);
}

.health-hero__signal {
  display: grid;
  min-inline-size: 5.4rem;
  gap: 0.28rem;
}

.health-hero__signal strong {
  font-size: 0.95rem;
  font-weight: 680;
}

.health-hero__signal-label {
  color: rgba(var(--v-theme-on-surface), 0.54);
  font-size: 0.72rem;
}

.health-hero__availability {
  position: relative;
  display: grid;
  flex: 0 0 auto;
  block-size: 6.15rem;
  inline-size: 6.15rem;
  border-radius: 50%;
  background: conic-gradient(
    rgb(var(--health-accent)) var(--availability),
    rgba(var(--health-accent), 0.14) 0
  );
  place-items: center;
  transform: rotate(-90deg);
}

.health-hero__availability::before {
  position: absolute;
  block-size: 4.95rem;
  inline-size: 4.95rem;
  border-radius: 50%;
  background: rgb(var(--v-theme-surface));
  content: '';
}

.health-hero__availability-center {
  position: relative;
  z-index: 1;
  display: grid;
  text-align: center;
  transform: rotate(90deg);
}

.health-hero__availability-center strong {
  font-size: 1.03rem;
  letter-spacing: -0.03em;
}

.health-hero__availability-center span {
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.6rem;
}

@media (max-width: 760px) {
  .health-hero {
    align-items: flex-start;
    flex-direction: column;
    gap: 1.25rem;
    padding: 1.25rem;
  }

  .health-hero__signals {
    inline-size: 100%;
    justify-content: space-between;
  }

  .health-hero__signal:nth-child(2) {
    display: none;
  }
}
</style>
