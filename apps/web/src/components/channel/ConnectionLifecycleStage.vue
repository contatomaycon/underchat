<script setup lang="ts">
import { computed } from 'vue';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import type { WorkerConnectionModalState } from '@core/common/functions/normalizeWorkerConnectionModalState';

type StageTone = 'active' | 'attention' | 'success';
type StepState = 'complete' | 'current' | 'pending';

interface StageStep {
  icon: string;
  labelKey: string;
  state: StepState;
}

const props = defineProps<{
  state: WorkerConnectionModalState;
  titleKey: string;
  descriptionKey: string;
  icon: string;
  loading?: boolean;
  qrCode?: string;
  channelType?: string | null;
  phoneNumber?: string | null;
  qrAttempt?: number;
  qrMaxAttempts?: number;
  secondaryValue?: string | null;
}>();

const { t } = useI18n();

const tone = computed<StageTone>(() => {
  if (props.state === 'connected') return 'success';
  if (props.state === 'disconnected' || props.state === 'phoneUnavailable') {
    return 'attention';
  }
  return 'active';
});

const isQrReady = computed(
  () => props.state === 'qrReady' && Boolean(props.qrCode)
);
const isSuccess = computed(() => props.state === 'connected');
const isAttention = computed(() => tone.value === 'attention');
const showAttempt = computed(
  () =>
    Boolean(props.qrMaxAttempts && props.qrMaxAttempts > 0) &&
    ['qrPreparing', 'qrReady', 'disconnected'].includes(props.state)
);

const channelPresentation = computed(() => {
  if (props.channelType === EWorkerType.baileys) {
    return { icon: 'tabler-plug-connected', label: t('unofficial_socket') };
  }
  if (props.channelType === EWorkerType.wwebjs) {
    return { icon: 'tabler-browser', label: t('unofficial_browser') };
  }
  if (props.channelType === EWorkerType.whatsmeow) {
    return { icon: 'tabler-bolt', label: t('unofficial_whatsmeow') };
  }
  if (props.channelType === EWorkerType.whatsapp) {
    return { icon: 'tabler-brand-whatsapp', label: t('whatsapp_official') };
  }
  return { icon: 'tabler-brand-whatsapp', label: t('channel') };
});

const progressLabel = computed(() => {
  if (isSuccess.value) return t('connection_live_status_ready');
  if (isAttention.value) return t('connection_live_status_attention');
  if (props.state === 'pairingInProgress') {
    return t('connection_live_status_pairing');
  }
  if (props.state === 'qrReady') {
    return t('connection_live_status_waiting_scan');
  }
  return t('connection_live_status_processing');
});

const stageSteps = computed<StageStep[]>(() => {
  if (isSuccess.value) {
    return [
      {
        icon: 'tabler-check',
        labelKey: 'connection_step_session_confirmed',
        state: 'complete',
      },
      {
        icon: 'tabler-shield-check',
        labelKey: 'connection_step_security_validated',
        state: 'complete',
      },
      {
        icon: 'tabler-bolt',
        labelKey: 'connection_step_channel_available',
        state: 'complete',
      },
    ];
  }

  if (isAttention.value) {
    return [
      {
        icon: 'tabler-check',
        labelKey: 'connection_step_channel_prepared',
        state: 'complete',
      },
      {
        icon: 'tabler-alert-triangle',
        labelKey: 'connection_step_action_required',
        state: 'current',
      },
      {
        icon: 'tabler-refresh',
        labelKey: 'connection_step_retry_available',
        state: 'pending',
      },
    ];
  }

  if (props.state === 'pairingInProgress') {
    return [
      {
        icon: 'tabler-qrcode',
        labelKey: 'connection_step_qr_read',
        state: 'complete',
      },
      {
        icon: 'tabler-link',
        labelKey: 'connection_step_pairing',
        state: 'current',
      },
      {
        icon: 'tabler-shield-check',
        labelKey: 'connection_step_final_validation',
        state: 'pending',
      },
    ];
  }

  if (props.state === 'qrReady') {
    return [
      {
        icon: 'tabler-check',
        labelKey: 'connection_step_channel_prepared',
        state: 'complete',
      },
      {
        icon: 'tabler-device-mobile',
        labelKey: 'connection_step_waiting_phone',
        state: 'current',
      },
      {
        icon: 'tabler-link',
        labelKey: 'connection_step_pairing',
        state: 'pending',
      },
    ];
  }

  return [
    {
      icon: 'tabler-check',
      labelKey: 'connection_step_request_received',
      state: 'complete',
    },
    {
      icon: 'tabler-loader-2',
      labelKey: 'connection_step_preparing_environment',
      state: 'current',
    },
    {
      icon: 'tabler-qrcode',
      labelKey: 'connection_step_waiting_qr',
      state: 'pending',
    },
  ];
});
</script>

<template>
  <section
    class="connection-lifecycle"
    :data-tone="tone"
    :data-stage="state"
    role="status"
    aria-live="polite"
    data-testid="connection-lifecycle-stage"
  >
    <header class="connection-lifecycle__header">
      <div class="connection-lifecycle__live">
        <span class="connection-lifecycle__live-dot" aria-hidden="true" />
        {{ progressLabel }}
      </div>

      <div class="connection-lifecycle__channel">
        <VIcon :icon="channelPresentation.icon" size="17" />
        <span>{{ channelPresentation.label }}</span>
      </div>
    </header>

    <div class="connection-lifecycle__body">
      <div class="connection-lifecycle__visual-column">
        <div
          class="connection-lifecycle__visual"
          :class="{
            'connection-lifecycle__visual--qr': isQrReady,
            'connection-lifecycle__visual--loading': loading,
          }"
        >
          <template v-if="isQrReady">
            <span class="connection-lifecycle__qr-corners" aria-hidden="true" />
            <VImg
              :src="qrCode"
              class="connection-lifecycle__qr-image"
              width="238"
              max-width="100%"
              data-testid="connection-qr-image"
            />
            <span class="connection-lifecycle__scan-line" aria-hidden="true" />
          </template>

          <template v-else>
            <span class="connection-lifecycle__orbit" aria-hidden="true">
              <span class="connection-lifecycle__orbit-runner" />
            </span>
            <span class="connection-lifecycle__icon">
              <VIcon :icon="icon" size="54" />
            </span>
            <span
              v-if="isSuccess"
              class="connection-lifecycle__success-pulse"
              aria-hidden="true"
            />
          </template>
        </div>

        <div v-if="showAttempt" class="connection-lifecycle__attempt">
          <span>{{ $t('connection_qr_attempt_label') }}</span>
          <strong>{{ qrAttempt || 1 }}/{{ qrMaxAttempts }}</strong>
        </div>
      </div>

      <div class="connection-lifecycle__content">
        <p class="connection-lifecycle__eyebrow">
          {{ $t('connection_operational_center') }}
        </p>
        <h2
          class="connection-lifecycle__title"
          data-testid="connection-stage-title"
        >
          {{ $t(titleKey) }}
        </h2>
        <p class="connection-lifecycle__description">
          {{ $t(descriptionKey) }}
        </p>

        <div
          v-if="phoneNumber || secondaryValue"
          class="connection-lifecycle__identity"
        >
          <VIcon icon="tabler-device-mobile" size="18" />
          <strong>{{ phoneNumber || secondaryValue }}</strong>
        </div>

        <ol class="connection-lifecycle__steps">
          <li
            v-for="step in stageSteps"
            :key="step.labelKey"
            class="connection-lifecycle__step"
            :data-state="step.state"
          >
            <span class="connection-lifecycle__step-icon">
              <VProgressCircular
                v-if="step.state === 'current' && !isAttention"
                indeterminate
                size="20"
                width="2"
              />
              <VIcon v-else :icon="step.icon" size="17" />
            </span>
            <span>{{ $t(step.labelKey) }}</span>
            <small v-if="step.state === 'current'">
              {{ $t('connection_live_now') }}
            </small>
          </li>
        </ol>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.connection-lifecycle {
  --stage-rgb: var(--v-theme-primary);

  position: relative;
  display: grid;
  overflow: hidden;
  min-block-size: 430px;
  background:
    radial-gradient(
      circle at 8% 5%,
      rgba(var(--stage-rgb), 0.14),
      transparent 30%
    ),
    radial-gradient(
      circle at 96% 96%,
      rgba(var(--v-theme-info), 0.09),
      transparent 34%
    ),
    rgb(var(--v-theme-surface));
  isolation: isolate;
  padding: 26px 30px 30px;
}

.connection-lifecycle::before {
  position: absolute;
  z-index: -1;
  border: 1px solid rgba(var(--stage-rgb), 0.1);
  border-radius: 50%;
  block-size: 260px;
  content: '';
  inline-size: 260px;
  inset-block-start: -192px;
  inset-inline-end: -94px;
}

.connection-lifecycle[data-tone='success'] {
  --stage-rgb: var(--v-theme-success);
}

.connection-lifecycle[data-tone='attention'] {
  --stage-rgb: var(--v-theme-error);
}

.connection-lifecycle__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.connection-lifecycle__live,
.connection-lifecycle__channel {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 750;
  gap: 7px;
}

.connection-lifecycle__live {
  border: 1px solid rgba(var(--stage-rgb), 0.22);
  background: rgba(var(--stage-rgb), 0.08);
  color: rgb(var(--stage-rgb));
  letter-spacing: 0.045em;
  padding: 7px 11px;
  text-transform: uppercase;
}

.connection-lifecycle__live-dot {
  position: relative;
  border-radius: 50%;
  background: currentcolor;
  block-size: 7px;
  inline-size: 7px;
}

.connection-lifecycle__live-dot::after {
  position: absolute;
  border: 1px solid currentcolor;
  border-radius: inherit;
  animation: connection-live-pulse 1.8s ease-out infinite;
  content: '';
  inset: -4px;
}

.connection-lifecycle__channel {
  background: rgba(var(--v-theme-on-surface), 0.055);
  color: rgba(var(--v-theme-on-surface), 0.72);
  padding: 7px 11px;
}

.connection-lifecycle__body {
  display: grid;
  align-items: center;
  gap: clamp(30px, 5vw, 56px);
  grid-template-columns: minmax(220px, 0.82fr) minmax(280px, 1.18fr);
  padding-block-start: 26px;
}

.connection-lifecycle__visual-column {
  display: grid;
  justify-items: center;
  gap: 12px;
}

.connection-lifecycle__visual {
  position: relative;
  display: grid;
  overflow: hidden;
  border: 1px solid rgba(var(--stage-rgb), 0.18);
  border-radius: 30px;
  background:
    linear-gradient(145deg, rgba(var(--stage-rgb), 0.1), transparent 52%),
    rgb(var(--v-theme-surface));
  block-size: 228px;
  box-shadow:
    0 28px 56px rgba(var(--v-theme-on-surface), 0.1),
    inset 0 0 0 10px rgba(var(--stage-rgb), 0.035);
  inline-size: 228px;
  place-items: center;
}

.connection-lifecycle__visual--qr {
  overflow: visible;
  border-radius: 24px;
  background: white;
  block-size: 258px;
  box-shadow:
    0 28px 58px rgba(var(--v-theme-on-surface), 0.13),
    0 0 0 10px rgba(var(--stage-rgb), 0.045);
  inline-size: 258px;
  padding: 10px;
}

.connection-lifecycle__qr-image {
  border-radius: 14px;
}

.connection-lifecycle__qr-corners {
  position: absolute;
  z-index: 2;
  border: solid rgb(var(--stage-rgb));
  border-width: 3px 0 0 3px;
  block-size: 26px;
  inline-size: 26px;
  inset-block-start: -5px;
  inset-inline-start: -5px;
}

.connection-lifecycle__qr-corners::after {
  position: absolute;
  border: solid rgb(var(--stage-rgb));
  border-width: 0 3px 3px 0;
  block-size: 26px;
  content: '';
  inline-size: 26px;
  inset-block-start: 216px;
  inset-inline-start: 216px;
}

.connection-lifecycle__scan-line {
  position: absolute;
  z-index: 3;
  border-radius: 999px;
  animation: connection-qr-scan 2.6s ease-in-out infinite;
  background: linear-gradient(
    90deg,
    transparent,
    rgb(var(--stage-rgb)),
    transparent
  );
  block-size: 2px;
  box-shadow: 0 0 14px rgba(var(--stage-rgb), 0.55);
  inline-size: calc(100% - 34px);
  inset-block-start: 24px;
  inset-inline-start: 17px;
}

.connection-lifecycle__orbit {
  position: absolute;
  border: 1px solid rgba(var(--stage-rgb), 0.16);
  border-radius: 50%;
  block-size: 150px;
  inline-size: 150px;
}

.connection-lifecycle__orbit::before {
  position: absolute;
  border: 1px dashed rgba(var(--stage-rgb), 0.2);
  border-radius: inherit;
  content: '';
  inset: 14px;
}

.connection-lifecycle__orbit-runner {
  position: absolute;
  animation: connection-orbit 2.1s linear infinite;
  inset: -1px;
}

.connection-lifecycle__orbit-runner::before {
  position: absolute;
  border: 3px solid rgb(var(--stage-rgb));
  border-radius: 50%;
  background: rgb(var(--v-theme-surface));
  block-size: 13px;
  box-shadow: 0 0 0 6px rgba(var(--stage-rgb), 0.1);
  content: '';
  inline-size: 13px;
  inset-block-start: -5px;
  inset-inline-start: calc(50% - 6px);
}

.connection-lifecycle__icon {
  z-index: 1;
  display: grid;
  border-radius: 22px;
  background: rgba(var(--stage-rgb), 0.11);
  block-size: 88px;
  color: rgb(var(--stage-rgb));
  inline-size: 88px;
  place-items: center;
}

.connection-lifecycle__success-pulse {
  position: absolute;
  border: 1px solid rgba(var(--stage-rgb), 0.48);
  border-radius: 50%;
  animation: connection-success-pulse 2s ease-out infinite;
  block-size: 122px;
  inline-size: 122px;
}

.connection-lifecycle__attempt {
  display: inline-flex;
  align-items: center;
  border: 1px solid rgba(var(--v-border-color), 0.14);
  border-radius: 999px;
  background: rgba(var(--v-theme-surface), 0.88);
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.76rem;
  gap: 7px;
  padding: 6px 10px;
}

.connection-lifecycle__attempt strong {
  color: rgb(var(--v-theme-on-surface));
}

.connection-lifecycle__content {
  display: grid;
  align-content: center;
  gap: 9px;
}

.connection-lifecycle__eyebrow {
  margin: 0;
  color: rgb(var(--stage-rgb));
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.connection-lifecycle__title {
  margin: 0;
  color: rgb(var(--v-theme-on-surface));
  font-size: clamp(1.45rem, 3vw, 1.9rem);
  font-weight: 780;
  letter-spacing: -0.035em;
  line-height: 1.18;
}

.connection-lifecycle__description {
  max-inline-size: 480px;
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.64);
  font-size: 0.91rem;
  line-height: 1.62;
}

.connection-lifecycle__identity {
  display: inline-flex;
  inline-size: fit-content;
  align-items: center;
  border-radius: 10px;
  background: rgba(var(--stage-rgb), 0.08);
  color: rgb(var(--stage-rgb));
  font-size: 0.82rem;
  gap: 7px;
  margin-block-start: 3px;
  padding: 8px 11px;
}

.connection-lifecycle__steps {
  display: grid;
  gap: 7px;
  list-style: none;
  margin: 13px 0 0;
  padding: 0;
}

.connection-lifecycle__step {
  display: grid;
  align-items: center;
  border: 1px solid rgba(var(--v-border-color), 0.12);
  border-radius: 12px;
  background: rgba(var(--v-theme-surface), 0.72);
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.79rem;
  gap: 10px;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  padding: 9px 11px;
}

.connection-lifecycle__step[data-state='complete'] {
  color: rgba(var(--v-theme-on-surface), 0.72);
}

.connection-lifecycle__step[data-state='current'] {
  border-color: rgba(var(--stage-rgb), 0.25);
  background: rgba(var(--stage-rgb), 0.07);
  color: rgb(var(--v-theme-on-surface));
  font-weight: 680;
}

.connection-lifecycle__step-icon {
  display: grid;
  block-size: 28px;
  border-radius: 8px;
  color: rgb(var(--stage-rgb));
  inline-size: 28px;
  place-items: center;
}

.connection-lifecycle__step small {
  color: rgb(var(--stage-rgb));
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

@keyframes connection-live-pulse {
  0% {
    opacity: 0.65;
    transform: scale(0.55);
  }

  75%,
  100% {
    opacity: 0;
    transform: scale(1.9);
  }
}

@keyframes connection-qr-scan {
  0%,
  100% {
    opacity: 0.2;
    transform: translateY(0);
  }

  50% {
    opacity: 0.9;
    transform: translateY(208px);
  }
}

@keyframes connection-orbit {
  to {
    transform: rotate(1turn);
  }
}

@keyframes connection-success-pulse {
  0% {
    opacity: 0.5;
    transform: scale(0.72);
  }

  100% {
    opacity: 0;
    transform: scale(1.45);
  }
}

@media (max-width: 720px) {
  .connection-lifecycle {
    min-block-size: auto;
    padding: 24px 20px 26px;
  }

  .connection-lifecycle__body {
    gap: 25px;
    grid-template-columns: 1fr;
  }

  .connection-lifecycle__visual {
    block-size: 190px;
    inline-size: 190px;
  }

  .connection-lifecycle__visual--qr {
    block-size: 238px;
    inline-size: 238px;
  }

  .connection-lifecycle__qr-corners::after {
    inset-block-start: 196px;
    inset-inline-start: 196px;
  }

  .connection-lifecycle__content {
    text-align: center;
  }

  .connection-lifecycle__description,
  .connection-lifecycle__identity {
    margin-inline: auto;
  }

  .connection-lifecycle__steps {
    text-align: start;
  }
}

@media (max-width: 430px) {
  .connection-lifecycle__header {
    align-items: flex-start;
    flex-direction: column;
  }

  .connection-lifecycle__live,
  .connection-lifecycle__channel {
    font-size: 0.65rem;
  }

  .connection-lifecycle__step {
    grid-template-columns: 28px minmax(0, 1fr);
  }

  .connection-lifecycle__step small {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .connection-lifecycle__live-dot::after,
  .connection-lifecycle__scan-line,
  .connection-lifecycle__orbit-runner,
  .connection-lifecycle__success-pulse {
    animation: none;
  }
}
</style>
