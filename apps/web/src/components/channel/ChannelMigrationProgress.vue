<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWhatsappConnectionStatus } from '@core/common/enums/EWhatsappConnectionStatus';

interface MigrationEndpointPresentation {
  icon: string;
  label: string;
  tone: 'browser' | 'official' | 'socket' | 'stable';
}

const props = withDefaults(
  defineProps<{
    sourceType?: string | null;
    targetType?: string | null;
    sourceServerName?: string | null;
    targetServerName?: string | null;
    liveStatus?: string | null;
    maxDurationMs?: number;
  }>(),
  {
    maxDurationMs: 5 * 60_000,
  }
);

const emit = defineEmits<{
  (event: 'cancel'): void;
  (event: 'timeout'): void;
}>();

const { t } = useI18n();

const channelTypePresentation = (
  type: string | null | undefined,
  fallbackKey: string
): MigrationEndpointPresentation => {
  if (type === EWorkerType.baileys) {
    return {
      icon: 'tabler-plug-connected',
      label: t('unofficial_socket'),
      tone: 'socket',
    };
  }

  if (type === EWorkerType.wwebjs) {
    return {
      icon: 'tabler-browser',
      label: t('unofficial_browser'),
      tone: 'browser',
    };
  }

  if (type === EWorkerType.whatsmeow) {
    return {
      icon: 'tabler-bolt',
      label: t('unofficial_whatsmeow'),
      tone: 'stable',
    };
  }

  if (type === EWorkerType.whatsapp) {
    return {
      icon: 'tabler-brand-whatsapp',
      label: t('whatsapp_official'),
      tone: 'official',
    };
  }

  return {
    icon: 'tabler-plug-connected',
    label: t(fallbackKey),
    tone: 'socket',
  };
};

// The migration route is an immutable operation snapshot. Realtime list
// projections may briefly expose source/target generations in a different
// order, but they must never rewrite what the operator accepted.
const lockedSourceType = shallowRef<string | null>(props.sourceType ?? null);
const lockedTargetType = shallowRef<string | null>(props.targetType ?? null);
const lockedSourceServerName = shallowRef<string | null>(
  props.sourceServerName ?? null
);
const lockedTargetServerName = shallowRef<string | null>(
  props.targetServerName ?? null
);

watch(
  () => props.sourceType,
  (value) => {
    if (!lockedSourceType.value && value) lockedSourceType.value = value;
  }
);
watch(
  () => props.targetType,
  (value) => {
    if (!lockedTargetType.value && value) lockedTargetType.value = value;
  }
);
watch(
  () => props.sourceServerName,
  (value) => {
    if (!lockedSourceServerName.value && value) {
      lockedSourceServerName.value = value;
    }
  }
);
watch(
  () => props.targetServerName,
  (value) => {
    if (!lockedTargetServerName.value && value) {
      lockedTargetServerName.value = value;
    }
  }
);

const source = computed(() =>
  channelTypePresentation(
    lockedSourceType.value,
    'connection_migration_current_connection'
  )
);
const target = computed(() =>
  channelTypePresentation(
    lockedTargetType.value,
    'connection_migration_new_connection'
  )
);
const hasServerChange = computed(
  () =>
    Boolean(lockedSourceServerName.value?.trim()) &&
    Boolean(lockedTargetServerName.value?.trim()) &&
    lockedSourceServerName.value?.trim() !==
      lockedTargetServerName.value?.trim()
);
const routeAriaLabel = computed(() =>
  t('connection_migration_route_aria', {
    source: source.value.label,
    target: target.value.label,
  })
);

const elapsedSeconds = shallowRef(0);
const timeoutEmitted = shallowRef(false);
const hasTimedOut = shallowRef(false);
let timerId: number | null = null;
const startedAt = Date.now();

const maxSeconds = computed(() =>
  Math.max(1, Math.ceil(props.maxDurationMs / 1000))
);
const elapsedProgress = computed(() =>
  Math.min(100, (elapsedSeconds.value / maxSeconds.value) * 100)
);
const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const remainingSeconds = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
};
const elapsedFormatted = computed(() => formatDuration(elapsedSeconds.value));
const limitFormatted = computed(() => formatDuration(maxSeconds.value));

const activityKey = computed(() => {
  if (props.liveStatus === EWhatsappConnectionStatus.handoff) {
    return 'connection_migration_activity_preserving';
  }
  if (
    props.liveStatus === EWhatsappConnectionStatus.initializing ||
    props.liveStatus === EWhatsappConnectionStatus.restoring
  ) {
    return 'connection_migration_activity_preparing';
  }
  if (
    props.liveStatus === EWhatsappConnectionStatus.connecting ||
    props.liveStatus === EWhatsappConnectionStatus.reconnecting
  ) {
    return 'connection_migration_activity_starting_target';
  }
  if (props.liveStatus === EWhatsappConnectionStatus.online) {
    return 'connection_migration_activity_validating';
  }
  return 'connection_migration_activity_queued';
});

const updateElapsed = () => {
  elapsedSeconds.value = Math.min(
    maxSeconds.value,
    Math.floor((Date.now() - startedAt) / 1000)
  );
  if (elapsedSeconds.value >= maxSeconds.value && !timeoutEmitted.value) {
    timeoutEmitted.value = true;
    hasTimedOut.value = true;
    if (timerId !== null) window.clearInterval(timerId);
    timerId = null;
    emit('timeout');
  }
};

onMounted(() => {
  updateElapsed();
  timerId = window.setInterval(updateElapsed, 1_000);
});

onBeforeUnmount(() => {
  if (timerId !== null) window.clearInterval(timerId);
});
</script>

<template>
  <section
    class="migration-progress"
    :class="{ 'migration-progress--timed-out': hasTimedOut }"
    role="status"
    aria-live="polite"
    :aria-label="routeAriaLabel"
    data-testid="channel-migration-progress"
  >
    <header class="migration-progress__header">
      <div class="migration-progress__status">
        <span class="migration-progress__status-dot" aria-hidden="true" />
        {{
          $t(
            hasTimedOut
              ? 'connection_migration_timeout_status'
              : 'connection_migration_status'
          )
        }}
      </div>

      <h2
        class="migration-progress__title"
        data-testid="connection-stage-title"
      >
        {{
          $t(
            hasTimedOut
              ? 'connection_migration_timeout_title'
              : 'connection_migrating_title'
          )
        }}
      </h2>
      <p class="migration-progress__description">
        {{
          $t(
            hasTimedOut
              ? 'connection_migration_timeout_description'
              : 'connection_migration_detailed_description'
          )
        }}
      </p>
    </header>

    <div class="migration-progress__route">
      <article
        class="migration-endpoint migration-endpoint--source"
        data-testid="migration-source"
      >
        <span class="migration-endpoint__eyebrow">
          {{ $t('connection_migration_source') }}
        </span>
        <div
          class="migration-endpoint__icon"
          :class="`migration-endpoint__icon--${source.tone}`"
        >
          <VIcon :icon="source.icon" size="28" />
        </div>
        <strong class="migration-endpoint__label">{{ source.label }}</strong>
        <span class="migration-endpoint__meta">
          {{ $t('connection_migration_session_origin') }}
        </span>
      </article>

      <div class="migration-progress__transfer" aria-hidden="true">
        <div class="migration-progress__rail">
          <span class="migration-progress__runner" />
        </div>
        <div class="migration-progress__shield">
          <VIcon icon="tabler-lock-check" size="24" />
        </div>
      </div>

      <article
        class="migration-endpoint migration-endpoint--target"
        data-testid="migration-target"
      >
        <span class="migration-endpoint__eyebrow">
          {{ $t('connection_migration_destination') }}
        </span>
        <div
          class="migration-endpoint__icon"
          :class="`migration-endpoint__icon--${target.tone}`"
        >
          <VIcon :icon="target.icon" size="28" />
        </div>
        <strong class="migration-endpoint__label">{{ target.label }}</strong>
        <span class="migration-endpoint__meta">
          {{ $t('connection_migration_session_destination') }}
        </span>
      </article>
    </div>

    <div
      v-if="hasServerChange"
      class="migration-progress__server-route"
      data-testid="migration-server-route"
    >
      <VIcon icon="tabler-server" size="20" />
      <span>{{ lockedSourceServerName }}</span>
      <VIcon
        class="migration-progress__server-arrow"
        icon="tabler-arrow-right"
        size="18"
      />
      <span>{{ lockedTargetServerName }}</span>
    </div>

    <div class="migration-progress__telemetry">
      <div class="migration-progress__telemetry-copy">
        <span class="migration-progress__telemetry-icon" aria-hidden="true">
          <VIcon v-if="hasTimedOut" icon="tabler-clock-exclamation" size="20" />
          <VProgressCircular v-else indeterminate size="20" width="2" />
        </span>
        <div>
          <small>{{ $t('connection_migration_realtime_label') }}</small>
          <strong>
            {{
              $t(
                hasTimedOut
                  ? 'connection_migration_timeout_activity'
                  : activityKey
              )
            }}
          </strong>
        </div>
      </div>

      <div class="migration-progress__timer" data-testid="migration-timer">
        <span>
          {{ $t('connection_migration_elapsed') }}
          <strong>{{ elapsedFormatted }}</strong>
        </span>
        <span>
          {{ $t('connection_migration_limit') }}
          <strong>{{ limitFormatted }}</strong>
        </span>
      </div>

      <div class="migration-progress__timer-track" aria-hidden="true">
        <span :style="{ inlineSize: `${elapsedProgress}%` }" />
      </div>
    </div>

    <footer class="migration-progress__safety">
      <div class="migration-progress__safety-icon">
        <VIcon icon="tabler-shield-lock" size="23" />
      </div>
      <div class="migration-progress__safety-copy">
        <strong>{{ $t('connection_migration_session_protected') }}</strong>
        <span>{{ $t('connection_migration_session_protected_note') }}</span>
      </div>
      <div class="migration-progress__activity" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </footer>

    <div class="migration-progress__actions">
      <span>{{ $t('connection_migration_cancel_note') }}</span>
      <VBtn
        class="migration-progress__cancel-action"
        variant="outlined"
        color="primary"
        prepend-icon="tabler-x"
        data-testid="migration-cancel"
        @click="emit('cancel')"
      >
        {{
          $t(
            hasTimedOut
              ? 'connection_migration_choose_action'
              : 'connection_migration_cancel'
          )
        }}
      </VBtn>
    </div>
  </section>
</template>

<style scoped>
.migration-progress {
  --migration-accent: rgb(var(--v-theme-info));
  --migration-ink: rgb(var(--v-theme-on-surface));

  position: relative;
  display: grid;
  overflow: hidden;
  background:
    radial-gradient(
      circle at 50% -10%,
      rgb(var(--v-theme-info), 0.17),
      transparent 43%
    ),
    linear-gradient(
      180deg,
      rgb(var(--v-theme-surface), 1),
      rgb(var(--v-theme-info), 0.035)
    );
  gap: 28px;
  isolation: isolate;
  padding-block: 38px 34px;
  padding-inline: 40px;
}

.migration-progress--timed-out {
  --migration-accent: rgb(var(--v-theme-warning));

  background:
    radial-gradient(
      circle at 50% -10%,
      rgb(var(--v-theme-warning), 0.16),
      transparent 43%
    ),
    linear-gradient(
      180deg,
      rgb(var(--v-theme-surface), 1),
      rgb(var(--v-theme-warning), 0.035)
    );
}

.migration-progress--timed-out .migration-progress__status {
  border-color: rgb(var(--v-theme-warning), 0.25);
  background: rgb(var(--v-theme-warning), 0.1);
}

.migration-progress--timed-out .migration-progress__status-dot::after {
  animation: none;
}

.migration-progress::before {
  position: absolute;
  z-index: -1;
  border: 1px solid rgb(var(--v-theme-info), 0.1);
  border-radius: 50%;
  block-size: 280px;
  /* stylelint-disable-next-line @stylistic/string-quotes -- Prettier normalizes generated content to single quotes. */
  content: '';
  inline-size: 280px;
  inset-block-start: -210px;
  inset-inline-start: calc(50% - 140px);
}

.migration-progress__header {
  margin-inline: auto;
  max-inline-size: 580px;
  text-align: center;
}

.migration-progress__status {
  display: inline-flex;
  align-items: center;
  border: 1px solid rgb(var(--v-theme-info), 0.2);
  border-radius: 999px;
  background: rgb(var(--v-theme-info), 0.08);
  color: var(--migration-accent);
  font-size: 0.72rem;
  font-weight: 750;
  gap: 7px;
  letter-spacing: 0.055em;
  line-height: 1;
  margin-block-end: 13px;
  padding-block: 6px;
  padding-inline: 11px;
  text-transform: uppercase;
}

.migration-progress__status-dot {
  position: relative;
  border-radius: 50%;
  background: currentcolor;
  block-size: 7px;
  inline-size: 7px;
}

.migration-progress__status-dot::after {
  position: absolute;
  border: 1px solid currentcolor;
  border-radius: inherit;
  animation: migration-status-pulse 1.8s ease-out infinite;
  /* stylelint-disable-next-line @stylistic/string-quotes -- Prettier normalizes generated content to single quotes. */
  content: '';
  inset: -4px;
}

.migration-progress__title {
  margin: 0;
  color: var(--migration-ink);
  font-size: clamp(1.35rem, 3vw, 1.75rem);
  font-weight: 760;
  letter-spacing: -0.025em;
  line-height: 1.2;
}

.migration-progress__description {
  color: rgb(var(--v-theme-on-surface), 0.66);
  font-size: 0.93rem;
  line-height: 1.55;
  margin-block: 9px 0;
  margin-inline: auto;
  max-inline-size: 500px;
}

.migration-progress__route {
  display: grid;
  align-items: stretch;
  grid-template-columns: minmax(0, 1fr) 132px minmax(0, 1fr);
}

.migration-endpoint {
  position: relative;
  display: grid;
  align-content: start;
  padding: 20px;
  border: 1px solid rgb(var(--v-border-color), 0.17);
  border-radius: 16px;
  background: rgb(var(--v-theme-surface), 0.92);
  box-shadow: 0 16px 42px rgb(31, 47, 73, 8%);
  gap: 7px;
  min-block-size: 178px;
}

.migration-endpoint--target {
  border-color: rgb(var(--v-theme-info), 0.32);
  box-shadow:
    0 16px 42px rgb(31, 47, 73, 8%),
    inset 0 0 0 1px rgb(var(--v-theme-info), 0.06);
}

.migration-endpoint__eyebrow {
  color: rgb(var(--v-theme-on-surface), 0.48);
  font-size: 0.68rem;
  font-weight: 760;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.migration-endpoint__icon {
  display: grid;
  border-radius: 12px;
  block-size: 52px;
  inline-size: 52px;
  margin-block: 8px 3px;
  place-items: center;
}

.migration-endpoint__icon--socket {
  background: rgb(var(--v-theme-primary), 0.11);
  color: rgb(var(--v-theme-primary));
}

.migration-endpoint__icon--stable {
  background: rgb(var(--v-theme-info), 0.13);
  color: rgb(var(--v-theme-info));
}

.migration-endpoint__icon--browser {
  background: rgb(var(--v-theme-warning), 0.13);
  color: rgb(var(--v-theme-warning));
}

.migration-endpoint__icon--official {
  background: rgb(var(--v-theme-success), 0.13);
  color: rgb(var(--v-theme-success));
}

.migration-endpoint__label {
  overflow: hidden;
  color: var(--migration-ink);
  font-size: 1rem;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.migration-endpoint__meta {
  color: rgb(var(--v-theme-on-surface), 0.55);
  font-size: 0.76rem;
}

.migration-progress__transfer {
  position: relative;
  display: grid;
  place-items: center;
}

.migration-progress__rail {
  position: absolute;
  overflow: hidden;
  border-radius: 999px;
  background: rgb(var(--v-theme-info), 0.14);
  block-size: 3px;
  inline-size: calc(100% - 14px);
}

.migration-progress__runner {
  position: absolute;
  border-radius: inherit;
  animation: migration-runner-horizontal 1.75s ease-in-out infinite;
  /* stylelint-disable-next-line @stylistic/declaration-colon-newline-after -- Keep Prettier's canonical gradient layout. */
  background: linear-gradient(
    90deg,
    transparent,
    rgb(var(--v-theme-info), 0.82),
    transparent
  );
  block-size: 100%;
  inline-size: 42%;
  inset-block-start: 0;
  inset-inline-start: -42%;
}

.migration-progress__shield {
  z-index: 1;
  display: grid;
  border: 5px solid rgb(var(--v-theme-surface));
  border-radius: 50%;
  background: rgb(var(--v-theme-info));
  block-size: 52px;
  box-shadow: 0 10px 24px rgb(var(--v-theme-info), 0.27);
  color: rgb(var(--v-theme-on-info));
  inline-size: 52px;
  place-items: center;
}

.migration-progress__server-route {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed rgb(var(--v-theme-info), 0.26);
  border-radius: 12px;
  background: rgb(var(--v-theme-info), 0.055);
  color: rgb(var(--v-theme-on-surface), 0.7);
  font-size: 0.82rem;
  gap: 9px;
  min-inline-size: 0;
  padding-block: 10px;
  padding-inline: 14px;
}

.migration-progress__server-route span {
  overflow: hidden;
  font-weight: 650;
  max-inline-size: 200px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.migration-progress__server-arrow {
  flex: 0 0 auto;
  color: rgb(var(--v-theme-info));
}

.migration-progress__telemetry {
  display: grid;
  border: 1px solid rgb(var(--v-theme-info), 0.18);
  border-radius: 16px;
  background: rgb(var(--v-theme-surface), 0.82);
  box-shadow: 0 14px 36px rgb(31, 47, 73, 6%);
  gap: 13px;
  grid-template-columns: minmax(0, 1fr) auto;
  padding: 15px 17px 14px;
}

.migration-progress__telemetry-copy {
  display: flex;
  min-inline-size: 0;
  align-items: center;
  gap: 11px;
}

.migration-progress__telemetry-copy div {
  display: grid;
  min-inline-size: 0;
  gap: 2px;
}

.migration-progress__telemetry-copy small {
  color: rgb(var(--v-theme-on-surface), 0.48);
  font-size: 0.66rem;
  font-weight: 760;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.migration-progress__telemetry-copy strong {
  overflow: hidden;
  color: var(--migration-ink);
  font-size: 0.83rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.migration-progress__telemetry-icon {
  display: grid;
  flex: 0 0 38px;
  border-radius: 10px;
  background: rgb(var(--v-theme-info), 0.1);
  block-size: 38px;
  color: rgb(var(--v-theme-info));
  inline-size: 38px;
  place-items: center;
}

.migration-progress__timer {
  display: flex;
  align-items: center;
  color: rgb(var(--v-theme-on-surface), 0.52);
  font-size: 0.7rem;
  gap: 13px;
}

.migration-progress__timer span {
  display: grid;
  gap: 1px;
}

.migration-progress__timer strong {
  color: var(--migration-ink);
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
}

.migration-progress__timer-track {
  overflow: hidden;
  border-radius: 999px;
  background: rgb(var(--v-theme-info), 0.1);
  block-size: 4px;
  grid-column: 1 / -1;
}

.migration-progress__timer-track span {
  display: block;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    rgb(var(--v-theme-info), 0.68),
    rgb(var(--v-theme-info))
  );
  block-size: 100%;
  transition: inline-size 0.7s linear;
}

.migration-progress__safety {
  display: flex;
  align-items: center;
  border: 1px solid rgb(var(--v-theme-success), 0.2);
  border-radius: 14px;
  /* stylelint-disable-next-line @stylistic/declaration-colon-newline-after -- Keep Prettier's canonical gradient layout. */
  background: linear-gradient(
    105deg,
    rgb(var(--v-theme-success), 0.1),
    rgb(var(--v-theme-info), 0.055)
  );
  gap: 12px;
  padding-block: 15px;
  padding-inline: 17px;
}

.migration-progress__safety-icon {
  display: grid;
  flex: 0 0 42px;
  border-radius: 11px;
  background: rgb(var(--v-theme-success), 0.14);
  block-size: 42px;
  color: rgb(var(--v-theme-success));
  place-items: center;
}

.migration-progress__safety-copy {
  display: grid;
  flex: 1 1 auto;
  gap: 2px;
  min-inline-size: 0;
}

.migration-progress__safety-copy strong {
  color: var(--migration-ink);
  font-size: 0.86rem;
}

.migration-progress__safety-copy span {
  color: rgb(var(--v-theme-on-surface), 0.59);
  font-size: 0.76rem;
  line-height: 1.4;
}

.migration-progress__activity {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
}

.migration-progress__activity span {
  border-radius: 999px;
  animation: migration-activity 1.2s ease-in-out infinite;
  background: rgb(var(--v-theme-info));
  block-size: 5px;
  inline-size: 5px;
}

.migration-progress__activity span:nth-child(2) {
  animation-delay: 140ms;
}

.migration-progress__activity span:nth-child(3) {
  animation-delay: 280ms;
}

.migration-progress__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: rgb(var(--v-theme-on-surface), 0.5);
  font-size: 0.72rem;
  gap: 18px;
}

.migration-progress__cancel-action {
  min-block-size: 42px;
  min-inline-size: 168px;
  border-color: rgba(var(--v-theme-primary), 0.34);
  background: rgb(var(--v-theme-surface));
  font-weight: 700;
  letter-spacing: 0;
}

.migration-progress__cancel-action:hover {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.06);
}

@keyframes migration-status-pulse {
  0% {
    opacity: 0.65;
    transform: scale(0.55);
  }

  75%,
  100% {
    opacity: 0;
    transform: scale(1.8);
  }
}

@keyframes migration-runner-horizontal {
  0% {
    transform: translateX(0);
  }

  100% {
    transform: translateX(338%);
  }
}

@keyframes migration-activity {
  0%,
  70%,
  100% {
    opacity: 0.28;
    transform: translateY(0);
  }

  35% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

@media (max-width: 600px) {
  .migration-progress {
    gap: 22px;
    padding-block: 32px 26px;
    padding-inline: 22px;
  }

  .migration-progress__route {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto 72px auto;
  }

  .migration-endpoint {
    min-block-size: 150px;
  }

  .migration-progress__rail {
    block-size: calc(100% - 12px);
    inline-size: 3px;
  }

  .migration-progress__runner {
    animation-name: migration-runner-vertical;
    block-size: 42%;
    inline-size: 100%;
    inset-block-start: -42%;
    inset-inline-start: 0;
  }

  .migration-progress__shield {
    block-size: 48px;
    inline-size: 48px;
  }

  .migration-progress__server-route {
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .migration-progress__telemetry {
    grid-template-columns: 1fr;
  }

  .migration-progress__timer {
    justify-content: space-between;
  }

  .migration-progress__safety {
    align-items: flex-start;
  }

  .migration-progress__activity {
    padding-block-start: 8px;
  }

  .migration-progress__actions {
    align-items: stretch;
    flex-direction: column;
  }
}

@keyframes migration-runner-vertical {
  0% {
    transform: translateY(0);
  }

  100% {
    transform: translateY(338%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .migration-progress__status-dot::after,
  .migration-progress__runner,
  .migration-progress__activity span {
    animation: none;
  }

  .migration-progress__runner {
    inset-block-start: 0;
    inset-inline-start: 29%;
  }
}
</style>
