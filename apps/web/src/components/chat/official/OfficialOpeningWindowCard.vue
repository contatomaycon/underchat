<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import type { IOfficialWhatsappConversationWindowSnapshot } from '@core/common/interfaces/IOfficialWhatsappConversationWindow';

type OpeningWindow = IOfficialWhatsappConversationWindowSnapshot & {
  service_window_started_at?: string | null;
};

interface Props {
  window?: OpeningWindow | null;
  requiresTemplate?: boolean;
  loading?: boolean;
  disabled?: boolean;
  errorMessage?: string | null;
  requestId?: string | null;
}

const props = withDefaults(defineProps<Props>(), {
  window: null,
  requiresTemplate: false,
  loading: false,
  disabled: false,
  errorMessage: null,
  requestId: null,
});
const emit = defineEmits<{
  retry: [];
}>();
const { t, locale } = useI18n();
const now = shallowRef(Date.now());
let clockTimer: ReturnType<typeof setInterval> | null = null;

const state = computed(() => {
  if (props.errorMessage) return 'error';
  if (props.loading && !props.window) return 'loading';
  if (props.window?.state) return props.window.state;
  return props.requiresTemplate ? 'closed' : 'open';
});

const presentation = computed(() => {
  if (state.value === 'open') {
    return {
      color: 'success',
      icon: 'tabler-clock-check',
      eyebrow: t('official_opening_window_open_badge'),
      title: t('official_opening_window_open_title'),
      description: t('official_opening_window_open_description'),
    };
  }
  if (state.value === 'awaiting_contact_reply') {
    return {
      color: 'warning',
      icon: 'tabler-hourglass',
      eyebrow: t('official_opening_window_awaiting_badge'),
      title: t('official_window_awaiting_title'),
      description: t('official_opening_window_awaiting_open_description'),
    };
  }
  if (state.value === 'send_uncertain') {
    return {
      color: 'info',
      icon: 'tabler-cloud-question',
      eyebrow: t('official_opening_window_uncertain_badge'),
      title: t('official_window_uncertain_title'),
      description: t('official_opening_window_uncertain_description'),
    };
  }
  if (state.value === 'closed') {
    return {
      color: 'warning',
      icon: 'tabler-template',
      eyebrow: t('official_opening_window_closed_badge'),
      title: t('official_window_closed_title'),
      description: t('official_opening_window_closed_description'),
    };
  }

  return null;
});

const startedAt = computed(
  () =>
    props.window?.service_window_started_at ??
    props.window?.last_inbound_at ??
    null
);
const awaitingSince = computed(
  () => props.window?.awaiting_contact_reply_since ?? null
);
const awaitingExpiresAt = computed(
  () => props.window?.awaiting_contact_reply_expires_at ?? null
);
const expiresAt = computed(
  () => props.window?.service_window_expires_at ?? null
);

const parseTimestamp = (value: string | null): number | null => {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

const formatDateTime = (value: string | null): string => {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) return t('official_opening_window_not_available');

  try {
    return new Intl.DateTimeFormat(locale.value, {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(timestamp);
  } catch {
    return new Date(timestamp).toLocaleString();
  }
};

const remainingMilliseconds = computed(() => {
  const expirationTimestamp = parseTimestamp(expiresAt.value);
  return expirationTimestamp === null
    ? null
    : Math.max(0, expirationTimestamp - now.value);
});

const remainingLabel = computed(() => {
  if (remainingMilliseconds.value === null) {
    return t('official_opening_window_not_available');
  }
  if (remainingMilliseconds.value === 0) {
    return t('official_opening_window_refreshing');
  }

  const totalMinutes = Math.max(
    1,
    Math.ceil(remainingMilliseconds.value / 60_000)
  );
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0
    ? t('official_opening_window_remaining_hours', { hours, minutes })
    : t('official_opening_window_remaining_minutes', { minutes });
});

const remainingProgress = computed(() => {
  const startTimestamp = parseTimestamp(startedAt.value);
  const expirationTimestamp = parseTimestamp(expiresAt.value);
  if (
    startTimestamp === null ||
    expirationTimestamp === null ||
    expirationTimestamp <= startTimestamp
  ) {
    return 0;
  }

  const duration = expirationTimestamp - startTimestamp;
  const remaining = Math.max(0, expirationTimestamp - now.value);
  return Math.min(100, Math.max(0, (remaining / duration) * 100));
});

onMounted(() => {
  clockTimer = setInterval(() => {
    now.value = Date.now();
  }, 30_000);
});

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer);
});
</script>

<template>
  <section
    class="opening-window-card"
    :class="`opening-window-card--${state}`"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    <template v-if="state === 'loading'">
      <div class="opening-window-card__loading">
        <span class="opening-window-card__sr-only">
          {{ t('official_templates_loading') }}
        </span>
        <VSkeletonLoader type="avatar" width="42" />
        <div class="opening-window-card__loading-copy">
          <VSkeletonLoader type="text" width="42%" />
          <VSkeletonLoader type="text" width="78%" />
        </div>
      </div>
    </template>

    <template v-else-if="state === 'error'">
      <div class="opening-window-card__header">
        <div class="opening-window-card__icon opening-window-card__icon--error">
          <VIcon icon="tabler-cloud-off" size="22" />
        </div>
        <div class="opening-window-card__heading">
          <span class="opening-window-card__eyebrow">
            {{ t('official_opening_window_error_badge') }}
          </span>
          <strong>{{ t('official_opening_window_error_title') }}</strong>
        </div>
      </div>
      <p class="opening-window-card__description">{{ props.errorMessage }}</p>
      <div class="opening-window-card__error-footer">
        <small v-if="props.requestId">
          {{ t('request_id') }}: {{ props.requestId }}
        </small>
        <VBtn
          size="small"
          color="error"
          variant="tonal"
          prepend-icon="tabler-refresh"
          :aria-label="t('official_opening_window_retry')"
          :disabled="props.disabled"
          @click="emit('retry')"
        >
          {{ t('official_opening_window_retry') }}
        </VBtn>
      </div>
    </template>

    <template v-else-if="presentation">
      <div class="opening-window-card__header">
        <div
          class="opening-window-card__icon"
          :class="`opening-window-card__icon--${state}`"
        >
          <VIcon :icon="presentation.icon" size="22" />
        </div>
        <div class="opening-window-card__heading">
          <VChip
            :color="presentation.color"
            variant="tonal"
            size="x-small"
            label
          >
            {{ presentation.eyebrow }}
          </VChip>
          <strong>{{ presentation.title }}</strong>
        </div>
      </div>

      <p class="opening-window-card__description">
        {{ presentation.description }}
      </p>

      <div v-if="state === 'open'" class="opening-window-card__timeline">
        <div class="opening-window-card__metric">
          <span>{{ t('official_opening_window_started_at') }}</span>
          <strong>{{ formatDateTime(startedAt) }}</strong>
        </div>
        <div class="opening-window-card__metric">
          <span>{{ t('official_opening_window_closes_at') }}</span>
          <strong>{{ formatDateTime(expiresAt) }}</strong>
        </div>
        <div class="opening-window-card__remaining">
          <div>
            <span>{{ t('official_opening_window_remaining') }}</span>
            <strong>{{ remainingLabel }}</strong>
          </div>
          <VProgressLinear
            :model-value="remainingProgress"
            color="success"
            bg-color="success"
            bg-opacity="0.12"
            height="6"
            rounded
          />
        </div>
      </div>

      <div
        v-else-if="
          state === 'awaiting_contact_reply' || state === 'send_uncertain'
        "
        class="opening-window-card__awaiting"
      >
        <div class="opening-window-card__awaiting-time">
          <VIcon icon="tabler-lock" size="17" />
          <span>{{
            t(
              state === 'send_uncertain'
                ? 'official_opening_window_uncertain_since'
                : 'official_opening_window_awaiting_since'
            )
          }}</span>
          <strong>{{ formatDateTime(awaitingSince) }}</strong>
        </div>
        <div class="opening-window-card__awaiting-time">
          <VIcon icon="tabler-clock-24" size="17" />
          <span>{{
            t(
              state === 'send_uncertain'
                ? 'official_opening_window_uncertain_until'
                : 'official_opening_window_awaiting_until'
            )
          }}</span>
          <strong>{{ formatDateTime(awaitingExpiresAt) }}</strong>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.opening-window-card {
  --opening-accent: var(--v-theme-warning);

  display: grid;
  gap: 12px;
  padding: 15px;
  border: 1px solid rgba(var(--opening-accent), 0.24);
  border-radius: 12px;
  background:
    linear-gradient(
      135deg,
      rgba(var(--opening-accent), 0.09),
      rgba(var(--v-theme-surface), 0.96) 58%
    ),
    rgb(var(--v-theme-surface));
  box-shadow: 0 8px 22px rgba(var(--v-theme-on-surface), 0.05);
}

.opening-window-card--open {
  --opening-accent: var(--v-theme-success);
}

.opening-window-card--send_uncertain {
  --opening-accent: var(--v-theme-info);
}

.opening-window-card--error {
  --opening-accent: var(--v-theme-error);
}

.opening-window-card__header,
.opening-window-card__loading,
.opening-window-card__error-footer,
.opening-window-card__awaiting-time {
  display: flex;
  align-items: center;
}

.opening-window-card__awaiting-time {
  gap: 7px;
}

.opening-window-card__header,
.opening-window-card__loading {
  gap: 11px;
}

.opening-window-card__icon {
  display: grid;
  flex: 0 0 42px;
  block-size: 42px;
  place-items: center;
  border: 1px solid rgba(var(--opening-accent), 0.22);
  border-radius: 11px;
  background: rgba(var(--opening-accent), 0.12);
  color: rgb(var(--opening-accent));
}

.opening-window-card__heading {
  display: grid;
  gap: 5px;
  min-inline-size: 0;
}

.opening-window-card__heading strong {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.94rem;
  line-height: 1.25;
}

.opening-window-card__eyebrow {
  color: rgb(var(--v-theme-error));
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.opening-window-card__description {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.84rem;
  line-height: 1.48;
}

.opening-window-card__timeline {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}

.opening-window-card__metric,
.opening-window-card__remaining {
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 9px;
  background: rgba(var(--v-theme-surface), 0.64);
}

.opening-window-card__metric span,
.opening-window-card__remaining span {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.7rem;
}

.opening-window-card__metric strong,
.opening-window-card__remaining strong {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.79rem;
  line-height: 1.35;
}

.opening-window-card__remaining {
  grid-column: 1 / -1;
  gap: 8px;
}

.opening-window-card__remaining > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.opening-window-card__awaiting {
  display: grid;
  gap: 8px;
  padding: 9px 10px;
  border-radius: 9px;
  background: rgba(var(--v-theme-warning), 0.1);
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.76rem;
}

.opening-window-card__awaiting strong {
  color: rgb(var(--v-theme-on-surface));
}

.opening-window-card__loading-copy {
  display: grid;
  flex: 1;
  gap: 2px;
}

.opening-window-card__error-footer {
  justify-content: space-between;
  gap: 10px;
}

.opening-window-card__error-footer small {
  color: rgba(var(--v-theme-on-surface), 0.58);
  overflow-wrap: anywhere;
}

.opening-window-card__sr-only {
  position: absolute;
  overflow: hidden;
  inline-size: 1px;
  block-size: 1px;
  padding: 0;
  border: 0;
  margin: -1px;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

@media (max-width: 520px) {
  .opening-window-card__timeline {
    grid-template-columns: 1fr;
  }

  .opening-window-card__remaining {
    grid-column: auto;
  }

  .opening-window-card__error-footer {
    align-items: stretch;
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  .opening-window-card :deep(.v-progress-linear__determinate) {
    transition: none !important;
  }
}
</style>
