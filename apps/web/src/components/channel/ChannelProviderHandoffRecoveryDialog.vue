<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';

type ProviderHandoffRecoveryState =
  | 'none'
  | 'pending'
  | 'dispatching'
  | 'running'
  | 'completed'
  | 'blocked'
  | 'cancelled';

type HandoffAction = 'return' | 'discard';
type DecisionReason = 'cancel' | 'failure' | 'timeout';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    sourceProvider: string;
    targetProvider: string;
    /** Immutable operation/handoff id shown to support and the user. */
    referenceCode?: string | null;
    /** Technical cause, never used as the user-facing reference by default. */
    errorCode?: string | null;
    recoveryState: ProviderHandoffRecoveryState;
    handoffState?: string | null;
    decisionReason?: DecisionReason;
    sourceRevisionPreserved: boolean;
    sourceRuntimeRestored: boolean;
    canReturn: boolean;
    showReturn?: boolean;
    canDiscard: boolean;
    loadingAction: HandoffAction | null;
    /** A server-accepted, idempotent decision still finishing in the background. */
    pendingAction?: HandoffAction | null;
    standardAppearance?: boolean;
  }>(),
  {
    // Vue boolean props default to false. The recovery flow must expose the
    // safe return choice unless a caller deliberately suppresses it.
    showReturn: true,
    referenceCode: null,
    errorCode: null,
    pendingAction: null,
    handoffState: null,
    decisionReason: 'failure',
    standardAppearance: false,
  }
);

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'return'): void;
  (event: 'discard'): void;
  (event: 'retry'): void;
}>();

const { t } = useI18n();

const isDiscardConfirmationVisible = shallowRef(false);

const isBusy = computed(() => props.loadingAction !== null);
const isResolutionPending = computed(() => props.pendingAction !== null);
const showReturn = computed(() => props.showReturn);
const isForcedDecision = computed(() => props.decisionReason !== 'failure');
const isHandoffStillRunning = computed(
  () => props.handoffState !== null && props.handoffState !== 'failed'
);
const heroPresentation = computed(() => {
  if (props.decisionReason === 'timeout') {
    return {
      icon: 'tabler-clock-exclamation',
      eyebrow: t('provider_handoff_timeout_eyebrow'),
      title: t('provider_handoff_timeout_title'),
      description: t('provider_handoff_timeout_description'),
    };
  }
  if (props.decisionReason === 'cancel') {
    return {
      icon: 'tabler-player-stop',
      eyebrow: t('provider_handoff_cancel_eyebrow'),
      title: t('provider_handoff_cancel_title'),
      description: t('provider_handoff_cancel_description'),
    };
  }
  return {
    icon: 'tabler-shield-x',
    eyebrow: t('provider_handoff_recovery_eyebrow'),
    title: t('provider_handoff_recovery_title'),
    description: t('provider_handoff_recovery_description'),
  };
});
const decisionAvailability = computed(() => {
  // A terminal recovery block must win over a stale accepted action. Otherwise
  // the UI keeps an indefinite restoring spinner even though the server has
  // made the user-facing discard choice safe again.
  if (props.recoveryState === 'blocked') {
    return {
      color: 'warning' as const,
      icon: 'tabler-alert-triangle',
      message: t(
        props.canDiscard
          ? 'provider_handoff_recovery_state_blocked_discard_available'
          : 'provider_handoff_recovery_state_blocked_waiting'
      ),
    };
  }

  // The status chip already communicates a queued decision. Repeating that
  // message in a full-width alert made the pending-return screen needlessly
  // dense and pushed the two decision cards downward. Keep the cards visible
  // (and enable discard as soon as the API says it is safe), without a second
  // progress banner.
  if (props.pendingAction) {
    return null;
  }
  if (!props.canReturn && !props.canDiscard) {
    return {
      color: 'info' as const,
      icon: 'tabler-info-circle',
      message: t('provider_handoff_recovery_choices_checking'),
    };
  }
  if (!props.canReturn) {
    return {
      color: 'info' as const,
      icon: 'tabler-info-circle',
      message: t('provider_handoff_recovery_return_unavailable'),
    };
  }
  if (!props.canDiscard) {
    return {
      color: 'info' as const,
      icon: 'tabler-info-circle',
      message: t('provider_handoff_recovery_discard_unavailable'),
    };
  }
  return null;
});

const operationalStateMarkers = new Set([
  'rolled_back',
  'rollback',
  'completed',
  'cancelled',
  'pending',
  'running',
]);

const isOperationalStateMarker = (value: string): boolean =>
  operationalStateMarkers.has(value.trim().toLowerCase());

const referenceCode = computed(() => {
  const immutableReference = props.referenceCode?.trim();
  if (immutableReference) return immutableReference;

  // Older API snapshots did not carry a dedicated reference. Keep a useful
  // diagnostic fallback, but never render a lifecycle state such as
  // `rolled_back` as if it were a support code.
  const diagnosticCode = props.errorCode?.trim();
  return diagnosticCode && !isOperationalStateMarker(diagnosticCode)
    ? diagnosticCode
    : null;
});

const isVisible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => {
    if (!isBusy.value) {
      emit('update:modelValue', value);
    }
  },
});

const providerLabelKeys: Readonly<Record<string, string>> = {
  baileys: 'unofficial_socket',
  wwebjs: 'unofficial_browser',
  whatsmeow: 'unofficial_whatsmeow',
};

const formatProvider = (provider: string, fallbackLabelKey: string) => {
  const labelKey = providerLabelKeys[provider.trim().toLowerCase()];

  // Provider identifiers are implementation details. The recovery UI must
  // expose the same channel option labels used by the chooser, never a raw
  // provider value returned by the API.
  return labelKey ? t(labelKey) : t(fallbackLabelKey);
};

const sourceProviderLabel = computed(() =>
  formatProvider(props.sourceProvider, 'provider_handoff_recovery_source_label')
);
const targetProviderLabel = computed(() =>
  formatProvider(props.targetProvider, 'provider_handoff_recovery_target_label')
);
const targetStatusLabel = computed(() =>
  t(
    isHandoffStillRunning.value
      ? 'provider_handoff_target_stopping_safely'
      : 'provider_handoff_recovery_target_failed'
  )
);

const recoveryPresentation = computed(() => {
  if (isForcedDecision.value && isHandoffStillRunning.value) {
    return {
      color: 'warning' as const,
      icon: 'tabler-loader-2',
      label: t('provider_handoff_preparing_safe_choices'),
    };
  }

  // Do not let a previously queued return mask a terminal recovery block as
  // an endless loading state. A blocked recovery needs an actionable warning.
  if (props.recoveryState === 'blocked') {
    return {
      color: 'warning' as const,
      icon: 'tabler-alert-triangle',
      label: t('provider_handoff_recovery_state_attention'),
    };
  }

  const activeAction = props.loadingAction ?? props.pendingAction;
  if (activeAction) {
    return {
      color: 'info' as const,
      icon: 'tabler-loader-2',
      label: t(
        activeAction === 'discard'
          ? 'provider_handoff_recovery_state_discarding'
          : 'provider_handoff_recovery_state_restoring'
      ),
    };
  }

  if (props.sourceRuntimeRestored || props.recoveryState === 'completed') {
    return {
      color: 'success' as const,
      icon: 'tabler-circle-check',
      label: t('provider_handoff_recovery_state_restored'),
    };
  }

  if (
    props.recoveryState === 'pending' ||
    props.recoveryState === 'dispatching' ||
    props.recoveryState === 'running'
  ) {
    return {
      color: 'info' as const,
      icon: 'tabler-loader-2',
      label: t('provider_handoff_recovery_state_restoring'),
    };
  }

  return {
    color: 'secondary' as const,
    icon: 'tabler-clock',
    label: t('provider_handoff_recovery_state_waiting'),
  };
});

const protectionPresentation = computed(() => {
  if (props.sourceRevisionPreserved && props.sourceRuntimeRestored) {
    return {
      color: 'success' as const,
      icon: 'tabler-shield-check',
      title: t('provider_handoff_recovery_source_restored_title'),
      description: t('provider_handoff_recovery_source_restored_description', {
        provider: sourceProviderLabel.value,
      }),
    };
  }

  if (props.sourceRevisionPreserved) {
    return {
      color: 'info' as const,
      icon: 'tabler-shield-lock',
      title: t('provider_handoff_recovery_source_preserved_title'),
      description: t('provider_handoff_recovery_source_preserved_description', {
        provider: sourceProviderLabel.value,
      }),
    };
  }

  return {
    color: 'warning' as const,
    icon: 'tabler-shield-exclamation',
    title: t('provider_handoff_recovery_source_attention_title'),
    description: t('provider_handoff_recovery_source_attention_description'),
  };
});

const closeDialog = () => {
  if (!isBusy.value) {
    emit('update:modelValue', false);
  }
};

const handleReturn = () => {
  if (props.canReturn && !isBusy.value) {
    emit('return');
  }
};

const requestDiscard = () => {
  if (props.canDiscard && !isBusy.value) {
    isDiscardConfirmationVisible.value = true;
  }
};

const cancelDiscard = () => {
  if (!isBusy.value) {
    isDiscardConfirmationVisible.value = false;
  }
};

const confirmDiscard = () => {
  if (props.canDiscard && !isBusy.value) {
    emit('discard');
  }
};

const retryPendingResolution = () => {
  if (isResolutionPending.value && !isBusy.value) {
    emit('retry');
  }
};

const handleReturnChoice = () => {
  // A discard has already been accepted as a one-way destructive recovery.
  // Keep its own card available for an idempotent retry, but never render the
  // inverse choice as actionable: the client intentionally does not send a
  // return override after discard has started.
  if (props.pendingAction === 'discard') return;

  if (props.pendingAction === 'return') {
    retryPendingResolution();
    return;
  }
  handleReturn();
};

const handleDiscardChoice = () => {
  if (props.pendingAction === 'discard') {
    retryPendingResolution();
    return;
  }
  requestDiscard();
};

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) {
      isDiscardConfirmationVisible.value = false;
    }
  }
);
</script>

<template>
  <VDialog
    v-model="isVisible"
    :persistent="isBusy"
    max-width="860"
    role="alertdialog"
    aria-labelledby="provider-handoff-recovery-title"
    aria-describedby="provider-handoff-recovery-description"
  >
    <DialogCloseBtn
      v-if="!isBusy"
      data-testid="provider-handoff-recovery-close"
      :aria-label="$t('close')"
      @click="closeDialog"
    />

    <VCard
      :class="[
        'handoff-recovery',
        { 'handoff-recovery--standard': standardAppearance },
      ]"
      data-testid="provider-handoff-recovery-dialog"
    >
      <div class="handoff-recovery__hero">
        <div class="handoff-recovery__hero-icon" aria-hidden="true">
          <VIcon :icon="heroPresentation.icon" size="34" />
        </div>

        <div class="handoff-recovery__hero-copy">
          <p class="handoff-recovery__eyebrow">
            <span class="handoff-recovery__eyebrow-dot" />
            {{ heroPresentation.eyebrow }}
          </p>
          <h2
            id="provider-handoff-recovery-title"
            class="handoff-recovery__title"
          >
            {{ heroPresentation.title }}
          </h2>
          <p
            id="provider-handoff-recovery-description"
            class="handoff-recovery__description"
          >
            {{ heroPresentation.description }}
          </p>
        </div>

        <VChip
          class="handoff-recovery__state"
          :color="recoveryPresentation.color"
          variant="tonal"
          size="small"
          data-testid="provider-handoff-recovery-state"
        >
          <VIcon :icon="recoveryPresentation.icon" size="16" start />
          {{ recoveryPresentation.label }}
        </VChip>
      </div>

      <VCardText class="handoff-recovery__body">
        <section
          class="handoff-recovery__flow"
          :aria-label="$t('provider_handoff_recovery_flow_label')"
        >
          <article
            class="handoff-recovery__provider-card handoff-recovery__provider-card--source"
            data-testid="provider-handoff-source"
          >
            <span class="handoff-recovery__provider-icon" aria-hidden="true">
              <VIcon icon="tabler-database" size="24" />
            </span>
            <span class="handoff-recovery__provider-copy">
              <small>{{ $t('provider_handoff_recovery_source_label') }}</small>
              <strong>{{ sourceProviderLabel }}</strong>
              <span>
                {{
                  sourceRevisionPreserved
                    ? $t('provider_handoff_recovery_source_safe')
                    : $t('provider_handoff_recovery_source_checking')
                }}
              </span>
            </span>
          </article>

          <span class="handoff-recovery__flow-arrow" aria-hidden="true">
            <VIcon icon="tabler-arrow-right" size="24" />
          </span>

          <article
            class="handoff-recovery__provider-card handoff-recovery__provider-card--target"
            data-testid="provider-handoff-target"
          >
            <span class="handoff-recovery__provider-icon" aria-hidden="true">
              <VIcon icon="tabler-plug-connected-x" size="24" />
            </span>
            <span class="handoff-recovery__provider-copy">
              <small>{{ $t('provider_handoff_recovery_target_label') }}</small>
              <strong>{{ targetProviderLabel }}</strong>
              <span>{{ targetStatusLabel }}</span>
            </span>
          </article>
        </section>

        <VAlert
          class="handoff-recovery__protection"
          :color="protectionPresentation.color"
          :icon="protectionPresentation.icon"
          density="compact"
          variant="tonal"
          data-testid="provider-handoff-protection-status"
        >
          <strong class="handoff-recovery__alert-title">
            {{ protectionPresentation.title }}
          </strong>
          <span class="handoff-recovery__alert-description">
            {{ protectionPresentation.description }}
          </span>
        </VAlert>

        <div
          v-if="referenceCode"
          class="handoff-recovery__reference"
          data-testid="provider-handoff-error-code"
        >
          <VIcon icon="tabler-lifebuoy" size="18" aria-hidden="true" />
          <span>{{ $t('provider_handoff_recovery_reference') }}</span>
          <code>{{ referenceCode }}</code>
        </div>

        <div
          v-if="!isDiscardConfirmationVisible"
          class="handoff-recovery__choices"
        >
          <VBtn
            v-if="showReturn"
            class="handoff-recovery__choice"
            color="primary"
            variant="outlined"
            block
            :loading="loadingAction === 'return'"
            :class="{
              'handoff-recovery__choice--pending': pendingAction === 'return',
            }"
            :disabled="
              (!canReturn && pendingAction !== 'return') ||
              pendingAction === 'discard' ||
              isBusy
            "
            data-testid="provider-handoff-return"
            @click="handleReturnChoice"
          >
            <span class="handoff-recovery__choice-icon" aria-hidden="true">
              <VIcon icon="tabler-arrow-back-up" size="24" />
            </span>
            <span class="handoff-recovery__choice-copy">
              <strong>{{
                $t('provider_handoff_recovery_return_title')
              }}</strong>
              <span class="handoff-recovery__choice-description">
                {{ $t('provider_handoff_recovery_return_description') }}
              </span>
            </span>
          </VBtn>

          <VBtn
            class="handoff-recovery__choice"
            color="error"
            variant="outlined"
            block
            :loading="loadingAction === 'discard'"
            :class="{
              'handoff-recovery__choice--pending': pendingAction === 'discard',
            }"
            :disabled="(!canDiscard && pendingAction !== 'discard') || isBusy"
            data-testid="provider-handoff-discard"
            @click="handleDiscardChoice"
          >
            <span
              class="handoff-recovery__choice-icon handoff-recovery__choice-icon--danger"
              aria-hidden="true"
            >
              <VIcon icon="tabler-trash" size="24" />
            </span>
            <span class="handoff-recovery__choice-copy">
              <strong>{{
                $t('provider_handoff_recovery_discard_title')
              }}</strong>
              <span class="handoff-recovery__choice-description">
                {{ $t('provider_handoff_recovery_discard_description') }}
              </span>
            </span>
          </VBtn>
        </div>

        <VAlert
          v-if="decisionAvailability && !isDiscardConfirmationVisible"
          class="handoff-recovery__availability"
          :color="decisionAvailability.color"
          density="compact"
          :icon="decisionAvailability.icon"
          variant="tonal"
          data-testid="provider-handoff-decision-availability"
        >
          {{ decisionAvailability.message }}
        </VAlert>

        <VAlert
          v-if="isDiscardConfirmationVisible"
          class="handoff-recovery__discard-confirmation"
          color="error"
          icon="tabler-alert-hexagon"
          variant="tonal"
          data-testid="provider-handoff-discard-confirmation"
        >
          <strong class="handoff-recovery__alert-title">
            {{ $t('provider_handoff_recovery_discard_confirm_title') }}
          </strong>
          <span class="handoff-recovery__alert-description">
            {{ $t('provider_handoff_recovery_discard_confirm_description') }}
          </span>
        </VAlert>
      </VCardText>

      <VCardActions
        v-if="isDiscardConfirmationVisible"
        class="handoff-recovery__actions justify-end flex-wrap gap-3"
      >
        <template>
          <VBtn
            color="secondary"
            variant="tonal"
            :disabled="isBusy"
            data-testid="provider-handoff-discard-cancel"
            @click="cancelDiscard"
          >
            {{ $t('provider_handoff_recovery_discard_cancel') }}
          </VBtn>

          <VSpacer />

          <VBtn
            color="error"
            prepend-icon="tabler-trash-x"
            :loading="loadingAction === 'discard'"
            :disabled="!canDiscard || isBusy"
            data-testid="provider-handoff-discard-confirm"
            @click="confirmDiscard"
          >
            {{ $t('provider_handoff_recovery_discard_confirm_action') }}
          </VBtn>
        </template>
      </VCardActions>

      <VCardActions
        v-else
        class="handoff-recovery__actions handoff-recovery__actions--default"
      >
        <span class="handoff-recovery__actions-note">
          <VIcon icon="tabler-shield-check" size="17" />
          {{ $t('provider_handoff_safe_decision_note') }}
        </span>
        <VSpacer />
        <VBtn
          class="handoff-recovery__cancel-action"
          color="secondary"
          variant="outlined"
          prepend-icon="tabler-x"
          :disabled="isBusy"
          data-testid="provider-handoff-cancel-decision"
          @click="closeDialog"
        >
          {{ $t('cancel') }}
        </VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>

<style scoped lang="scss">
.handoff-recovery {
  overflow-x: hidden;
  overflow-y: auto;
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 12px;
  box-shadow: 0 28px 80px rgba(var(--v-theme-on-surface), 0.2);
}

.handoff-recovery--standard {
  border-radius: 6px;
}

.handoff-recovery__hero {
  display: grid;
  align-items: start;
  gap: 16px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  padding: 24px 28px 20px;
  background:
    radial-gradient(
      circle at 92% 10%,
      rgba(var(--v-theme-error), 0.14),
      transparent 34%
    ),
    linear-gradient(
      135deg,
      rgba(var(--v-theme-warning), 0.1),
      rgba(var(--v-theme-surface), 0.98) 52%
    );
}

.handoff-recovery__hero-icon {
  display: grid;
  inline-size: 58px;
  block-size: 58px;
  place-items: center;
  border: 1px solid rgba(var(--v-theme-error), 0.2);
  border-radius: 10px;
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
}

.handoff-recovery__hero-copy {
  display: grid;
  gap: 7px;
}

.handoff-recovery__eyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: rgb(var(--v-theme-warning));
  font-size: 12px;
  font-weight: 700;
}

.handoff-recovery__eyebrow-dot {
  inline-size: 8px;
  block-size: 8px;
  border-radius: 50%;
  background: rgb(var(--v-theme-warning));
  box-shadow: 0 0 0 6px rgba(var(--v-theme-warning), 0.1);
}

.handoff-recovery__title {
  margin: 0;
  color: rgb(var(--v-theme-on-surface));
  font-size: 24px;
  font-weight: 750;
  line-height: 1.25;
}

.handoff-recovery__description {
  max-inline-size: 620px;
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 14px;
  line-height: 1.55;
}

.handoff-recovery__state {
  margin-block-start: 2px;
}

.handoff-recovery__body {
  display: grid;
  gap: 16px;
  padding: 22px 28px 18px;
}

.handoff-recovery__flow {
  display: grid;
  align-items: center;
  gap: 14px;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
}

.handoff-recovery__provider-card {
  display: flex;
  min-inline-size: 0;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid rgba(var(--v-border-color), 0.18);
  border-radius: 10px;
  background: rgb(var(--v-theme-surface));
}

.handoff-recovery__provider-card--source {
  border-color: rgba(var(--v-theme-success), 0.28);
  background: linear-gradient(
    135deg,
    rgba(var(--v-theme-success), 0.08),
    rgb(var(--v-theme-surface)) 74%
  );
}

.handoff-recovery__provider-card--target {
  border-color: rgba(var(--v-theme-error), 0.24);
  background: linear-gradient(
    135deg,
    rgba(var(--v-theme-error), 0.08),
    rgb(var(--v-theme-surface)) 74%
  );
}

.handoff-recovery__provider-icon {
  display: grid;
  flex: 0 0 auto;
  inline-size: 44px;
  block-size: 44px;
  place-items: center;
  border-radius: 9px;
  background: rgba(var(--v-theme-success), 0.12);
  color: rgb(var(--v-theme-success));
}

.handoff-recovery__provider-card--target .handoff-recovery__provider-icon {
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
}

.handoff-recovery__provider-copy {
  display: grid;
  min-inline-size: 0;
  gap: 2px;
}

.handoff-recovery__provider-copy small {
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

.handoff-recovery__provider-copy strong {
  overflow: hidden;
  color: rgb(var(--v-theme-on-surface));
  font-size: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.handoff-recovery__provider-copy span {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 12px;
  line-height: 1.4;
}

.handoff-recovery__flow-arrow {
  display: grid;
  inline-size: 38px;
  block-size: 38px;
  place-items: center;
  border-radius: 50%;
  background: rgba(var(--v-theme-warning), 0.1);
  color: rgb(var(--v-theme-warning));
}

.handoff-recovery__protection,
.handoff-recovery__discard-confirmation {
  border-radius: 10px;
}

.handoff-recovery__alert-title,
.handoff-recovery__alert-description {
  display: block;
}

.handoff-recovery__alert-title {
  margin-block-end: 4px;
  color: rgb(var(--v-theme-on-surface));
  font-size: 14px;
}

.handoff-recovery__alert-description {
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 13px;
  line-height: 1.5;
}

.handoff-recovery__reference {
  display: flex;
  min-inline-size: 0;
  align-items: center;
  gap: 8px;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 12px;
}

.handoff-recovery__reference code {
  min-inline-size: 0;
  max-inline-size: 100%;
  overflow: hidden;
  padding: 3px 7px;
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.78);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.handoff-recovery__choices {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.handoff-recovery__choice {
  display: flex;
  min-inline-size: 0;
  min-block-size: 102px;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 12px;
  padding: 14px;
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 9px;
  block-size: auto !important;
  color: rgb(var(--v-theme-on-surface));
  letter-spacing: normal;
  text-align: start;
  text-transform: none;
  white-space: normal;
}

.handoff-recovery__choice :deep(.v-btn__content) {
  display: flex;
  min-inline-size: 0;
  inline-size: 100%;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 12px;
  white-space: normal;
}

.handoff-recovery__choice-copy {
  display: grid;
  flex: 1 1 0;
  min-inline-size: 0;
  overflow: hidden;
  gap: 2px;
  text-align: start;
}

.handoff-recovery__choice-icon {
  display: grid;
  flex: 0 0 auto;
  inline-size: 38px;
  block-size: 38px;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}

.handoff-recovery__choice-icon--danger {
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
}

.handoff-recovery__choice strong {
  display: block;
  max-inline-size: 100%;
  color: rgb(var(--v-theme-on-surface));
  font-size: 14px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.handoff-recovery__choice-description {
  display: -webkit-box;
  max-inline-size: 100%;
  margin: 2px 0 0;
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.handoff-recovery__choice--pending {
  border-style: dashed;
}

.handoff-recovery__actions {
  min-block-size: 78px;
  padding: 14px 30px 22px;
}

.handoff-recovery__actions--default {
  border-block-start: 1px solid rgba(var(--v-border-color), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.018);
}

.handoff-recovery__actions-note {
  display: inline-flex;
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.72rem;
  gap: 7px;
}

.handoff-recovery__actions-note :deep(.v-icon) {
  color: rgb(var(--v-theme-success));
}

.handoff-recovery__cancel-action {
  min-block-size: 42px;
  border-color: rgba(var(--v-theme-on-surface), 0.2);
  border-radius: 9px;
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.76) !important;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0;
  padding-inline: 18px;
  text-transform: none;
}

@media (max-width: 700px) {
  .handoff-recovery__hero {
    grid-template-columns: auto minmax(0, 1fr);
    padding: 22px 20px 18px;
  }

  .handoff-recovery__state {
    grid-column: 1 / -1;
    justify-self: start;
  }

  .handoff-recovery__body {
    gap: 14px;
    padding: 20px 20px 14px;
  }

  .handoff-recovery__flow {
    grid-template-columns: 1fr;
  }

  .handoff-recovery__flow-arrow {
    justify-self: center;
    transform: rotate(90deg);
  }

  .handoff-recovery__choices {
    grid-template-columns: 1fr;
  }

  .handoff-recovery__actions {
    gap: 10px;
    padding: 12px 20px 20px;
  }

  .handoff-recovery__actions :deep(.v-btn) {
    flex: 1 1 100%;
  }

  .handoff-recovery__actions :deep(.v-spacer) {
    display: none;
  }
}
</style>
