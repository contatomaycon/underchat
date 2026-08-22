<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import OutboundWebhookChannelSelect from './OutboundWebhookChannelSelect.vue';
import OutboundWebhookEventSelector from './OutboundWebhookEventSelector.vue';
import VDialogHandler from '@/components/VDialogHandler.vue';
import type {
  OutboundWebhook,
  OutboundWebhookAction,
  OutboundWebhookChannel,
  OutboundWebhookEventGroup,
  OutboundWebhookInput,
  OutboundWebhookSecretReveal,
  OutboundWebhookTestResult,
} from '@/types/outboundWebhooks';

interface Props {
  webhook: OutboundWebhook | null;
  eventGroups: readonly OutboundWebhookEventGroup[];
  availableChannels: readonly OutboundWebhookChannel[];
  isLoadingChannels: boolean;
  hasLoadedChannels: boolean;
  channelsError: string | null;
  secretReveal: OutboundWebhookSecretReveal | null;
  testResult: OutboundWebhookTestResult | null;
  activeAction: OutboundWebhookAction;
  error: string | null;
  success: string | null;
  canUpdateStatus: boolean;
  canRotateSecret: boolean;
}

interface Emits {
  save: [input: OutboundWebhookInput];
  rotateSecret: [webhookId: string];
  sendTest: [webhookId: string];
  setActive: [payload: { webhookId: string; active: boolean }];
  refresh: [webhookId: string];
  clearSecret: [];
  clearFeedback: [];
  retryChannels: [];
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const isOpen = defineModel<boolean>({ required: true });
const { t, locale } = useI18n();

const form = reactive<{
  name: string;
  endpointUrl: string;
  channelId: string | null;
  eventTypes: string[];
}>({
  name: '',
  endpointUrl: '',
  channelId: null,
  eventTypes: [],
});
const attemptedSubmit = shallowRef(false);
const channelIsAvailable = shallowRef(false);
const copiedSecret = shallowRef(false);
const copyError = shallowRef<string | null>(null);
const isRotateConfirmationOpen = shallowRef(false);
let copyTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

const isEditing = computed(() => Boolean(props.webhook));
const dialogTitle = computed(() =>
  isEditing.value
    ? t('outbound_webhook_edit_title')
    : t('outbound_webhook_create_title')
);
const isBusy = computed(() => props.activeAction !== null);
const secretForCurrentWebhook = computed(() => {
  if (!props.secretReveal || !props.webhook) return null;
  return props.secretReveal.webhookId === props.webhook.id
    ? props.secretReveal.secret
    : null;
});

const normalizedInitialEvents = computed(() =>
  [...(props.webhook?.eventTypes ?? [])].sort()
);
const normalizedFormEvents = computed(() => [...form.eventTypes].sort());
const hasUnsavedChanges = computed(() => {
  if (!props.webhook) return true;
  return (
    form.name.trim() !== props.webhook.name ||
    form.endpointUrl.trim() !== props.webhook.endpointUrl ||
    form.channelId !== props.webhook.channelId ||
    JSON.stringify(normalizedFormEvents.value) !==
      JSON.stringify(normalizedInitialEvents.value)
  );
});
const endpointChanged = computed(
  () =>
    Boolean(props.webhook) &&
    form.endpointUrl.trim() !== props.webhook?.endpointUrl
);
const channelChanged = computed(
  () => Boolean(props.webhook) && form.channelId !== props.webhook?.channelId
);

const nameError = computed(() => {
  const name = form.name.trim();
  if (!name) return t('outbound_webhook_name_required');
  if (name.length < 2) return t('outbound_webhook_name_min');
  if (name.length > 200) return t('outbound_webhook_name_max');
  return null;
});

const endpointError = computed(() => {
  const endpoint = form.endpointUrl.trim();
  if (!endpoint) return t('outbound_webhook_url_required');
  if (endpoint.length > 2048) return t('outbound_webhook_url_max');
  try {
    const parsed = new URL(endpoint);
    if (parsed.username || parsed.password) {
      return t('outbound_webhook_url_credentials');
    }
    if (parsed.hash) return t('outbound_webhook_url_fragment');

    const appEnvironment = (
      import.meta.env.APP_ENVIRONMENT ?? ''
    ).toLowerCase();
    const isProduction =
      import.meta.env.PROD || ['prod', 'production'].includes(appEnvironment);
    const allowsLocalhostHttp =
      !isProduction &&
      import.meta.env.OUTBOUND_WEBHOOK_ALLOW_LOCALHOST_HTTP === 'true' &&
      parsed.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);

    if (parsed.protocol !== 'https:' && !allowsLocalhostHttp) {
      return t('outbound_webhook_url_https');
    }
    const effectivePort = Number(
      parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
    );
    if (isProduction && effectivePort !== 443) {
      return t('outbound_webhook_url_port');
    }
    return null;
  } catch {
    return t('outbound_webhook_url_invalid');
  }
});

const eventsError = computed(() =>
  form.eventTypes.length ? null : t('outbound_webhook_events_required')
);
const channelError = computed(() =>
  form.channelId &&
  channelIsAvailable.value &&
  props.hasLoadedChannels &&
  !props.isLoadingChannels &&
  !props.channelsError
    ? null
    : t('outbound_webhook_channel_required')
);
const isFormValid = computed(
  () =>
    !nameError.value &&
    !endpointError.value &&
    !channelError.value &&
    !eventsError.value
);
const canRunCurrentConfiguration = computed(
  () =>
    Boolean(props.webhook) &&
    channelIsAvailable.value &&
    props.hasLoadedChannels &&
    !props.isLoadingChannels &&
    !props.channelsError &&
    !hasUnsavedChanges.value &&
    !isBusy.value
);
const canActivate = computed(
  () =>
    canRunCurrentConfiguration.value &&
    Boolean(props.webhook?.isVerified) &&
    !props.webhook?.isActive
);

const statusColor = computed(() => {
  if (props.webhook?.isActive) return 'success';
  if (props.webhook?.status === 'suspended') return 'error';
  if (props.webhook?.isVerified) return 'info';
  return 'secondary';
});
const statusLabel = computed(() => {
  if (props.webhook?.isActive) return t('outbound_webhook_status_active');
  if (props.webhook?.status === 'suspended') {
    return t('outbound_webhook_status_suspended');
  }
  if (props.webhook?.isVerified) {
    return t('outbound_webhook_status_verified_inactive');
  }
  return t('outbound_webhook_status_unverified');
});

const formatTimestamp = (value: string | null): string => {
  if (!value) return t('outbound_webhook_never');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t('outbound_webhook_never');
  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

const resetForm = () => {
  form.name = props.webhook?.name ?? '';
  form.endpointUrl = props.webhook?.endpointUrl ?? '';
  form.channelId = props.webhook?.channelId ?? null;
  form.eventTypes = [...(props.webhook?.eventTypes ?? [])];
  attemptedSubmit.value = false;
};

const closeDialog = () => {
  isOpen.value = false;
};

const submit = () => {
  attemptedSubmit.value = true;
  if (!isFormValid.value || isBusy.value) return;
  emit('save', {
    name: form.name.trim(),
    endpointUrl: form.endpointUrl.trim(),
    channelId: form.channelId as string,
    eventTypes: [...form.eventTypes],
  });
};

const confirmRotateSecret = () => {
  if (!props.webhook) return;
  emit('rotateSecret', props.webhook.id);
};

const copySecret = async () => {
  if (!secretForCurrentWebhook.value) return;
  copyError.value = null;
  try {
    await globalThis.navigator.clipboard.writeText(
      secretForCurrentWebhook.value
    );
    copiedSecret.value = true;
  } catch {
    copyError.value = t('outbound_webhook_copy_error');
  }

  if (copyTimer) globalThis.clearTimeout(copyTimer);
  copyTimer = globalThis.setTimeout(() => {
    copiedSecret.value = false;
    copyError.value = null;
  }, 2400);
};

watch(
  () => [isOpen.value, props.webhook] as const,
  ([visible]) => {
    if (visible) resetForm();
  },
  { immediate: true }
);

watch(isOpen, (visible) => {
  if (visible) return;
  copiedSecret.value = false;
  copyError.value = null;
  emit('clearSecret');
});

onBeforeUnmount(() => {
  if (copyTimer) globalThis.clearTimeout(copyTimer);
});
</script>

<template>
  <VDialog
    v-model="isOpen"
    max-width="980"
    scrollable
    :persistent="isBusy"
    :aria-label="dialogTitle"
  >
    <VCard class="outbound-form-dialog">
      <VCardTitle class="outbound-form-dialog__header">
        <div class="outbound-form-dialog__heading">
          <span class="outbound-form-dialog__icon" aria-hidden="true">
            <VIcon icon="tabler-route-alt-left" size="22" />
          </span>
          <div>
            <h3 class="outbound-form-dialog__title">
              {{ dialogTitle }}
            </h3>
            <p class="outbound-form-dialog__subtitle">
              {{ $t('outbound_webhook_form_subtitle') }}
            </p>
          </div>
        </div>

        <IconBtn
          :disabled="isBusy"
          :aria-label="$t('close')"
          @click="closeDialog"
        >
          <VIcon icon="tabler-x" />
        </IconBtn>
      </VCardTitle>

      <VDivider />

      <VCardText class="outbound-form-dialog__body">
        <VAlert
          v-if="props.error"
          class="mb-5"
          color="error"
          variant="tonal"
          closable
          @click:close="emit('clearFeedback')"
        >
          {{ props.error }}
        </VAlert>

        <VAlert
          v-if="props.success"
          class="mb-5"
          color="success"
          variant="tonal"
          closable
          @click:close="emit('clearFeedback')"
        >
          {{ props.success }}
        </VAlert>

        <VAlert
          v-if="secretForCurrentWebhook"
          class="secret-reveal mb-5"
          color="warning"
          variant="tonal"
          icon="tabler-key"
          aria-live="polite"
        >
          <div class="secret-reveal__content">
            <div>
              <strong>{{ $t('outbound_webhook_secret_once_title') }}</strong>
              <p>{{ $t('outbound_webhook_secret_once_description') }}</p>
            </div>
            <div class="secret-reveal__value-row">
              <code class="secret-reveal__value">{{
                secretForCurrentWebhook
              }}</code>
              <VBtn
                size="small"
                variant="flat"
                color="warning"
                :prepend-icon="copiedSecret ? 'tabler-check' : 'tabler-copy'"
                @click="copySecret"
              >
                {{
                  copiedSecret
                    ? $t('outbound_webhook_copied')
                    : $t('outbound_webhook_copy_secret')
                }}
              </VBtn>
            </div>
            <span v-if="copyError" class="secret-reveal__error">
              {{ copyError }}
            </span>
          </div>
        </VAlert>

        <form class="outbound-form" @submit.prevent="submit">
          <section class="outbound-form__section">
            <div class="outbound-form__section-heading">
              <span>01</span>
              <div>
                <h4>{{ $t('outbound_webhook_destination_title') }}</h4>
                <p>{{ $t('outbound_webhook_destination_description') }}</p>
              </div>
            </div>

            <div class="outbound-form__fields">
              <AppTextField
                v-model="form.name"
                :label="$t('outbound_webhook_name_label')"
                :placeholder="$t('outbound_webhook_name_placeholder')"
                :error-messages="
                  attemptedSubmit && nameError ? [nameError] : []
                "
                :disabled="isBusy"
                maxlength="200"
                data-testid="outbound-webhook-name"
              />

              <AppTextField
                v-model="form.endpointUrl"
                :label="$t('outbound_webhook_url_label')"
                placeholder="https://hooks.example.com/underchat"
                :error-messages="
                  attemptedSubmit && endpointError ? [endpointError] : []
                "
                :disabled="isBusy"
                inputmode="url"
                data-testid="outbound-webhook-url"
              />
            </div>

            <VAlert
              v-if="endpointChanged"
              class="mt-3"
              color="warning"
              variant="tonal"
              density="compact"
              icon="tabler-shield-exclamation"
            >
              {{ $t('outbound_webhook_url_change_warning') }}
            </VAlert>
          </section>

          <section class="outbound-form__section">
            <div class="outbound-form__section-heading">
              <span>02</span>
              <div>
                <h4>{{ $t('outbound_webhook_channel_title') }}</h4>
                <p>{{ $t('outbound_webhook_channel_description') }}</p>
              </div>
            </div>

            <OutboundWebhookChannelSelect
              v-model="form.channelId"
              :channels="props.availableChannels"
              :current-channel="props.webhook?.channel ?? null"
              :disabled="isBusy"
              :show-validation="attemptedSubmit"
              :is-loading="props.isLoadingChannels"
              :has-loaded="props.hasLoadedChannels"
              :load-error="props.channelsError"
              @validity-change="channelIsAvailable = $event"
              @retry="emit('retryChannels')"
            />

            <VAlert
              v-if="channelChanged"
              color="warning"
              variant="tonal"
              density="compact"
              icon="tabler-shield-exclamation"
            >
              {{ $t('outbound_webhook_channel_change_warning') }}
            </VAlert>
          </section>

          <section class="outbound-form__section">
            <div class="outbound-form__section-heading">
              <span>03</span>
              <div>
                <h4>{{ $t('outbound_webhook_events_title') }}</h4>
                <p>{{ $t('outbound_webhook_events_description') }}</p>
              </div>
            </div>

            <OutboundWebhookEventSelector
              :groups="props.eventGroups"
              :selected-events="form.eventTypes"
              :disabled="isBusy"
              @update:selected-events="form.eventTypes = $event"
            />

            <p
              v-if="attemptedSubmit && eventsError"
              class="outbound-form__field-error"
              role="alert"
            >
              {{ eventsError }}
            </p>
          </section>

          <section v-if="props.webhook" class="outbound-form__section">
            <div class="outbound-form__section-heading">
              <span>04</span>
              <div>
                <h4>{{ $t('outbound_webhook_verification_title') }}</h4>
                <p>{{ $t('outbound_webhook_verification_description') }}</p>
              </div>
            </div>

            <div class="verification-panel">
              <div class="verification-panel__status">
                <div>
                  <span class="verification-panel__label">
                    {{ $t('outbound_webhook_current_status') }}
                  </span>
                  <div class="d-flex align-center flex-wrap gap-2 mt-1">
                    <VChip :color="statusColor" size="small" variant="tonal">
                      {{ statusLabel }}
                    </VChip>
                    <span class="verification-panel__timestamp">
                      {{ $t('outbound_webhook_last_test') }}:
                      {{ formatTimestamp(props.webhook.lastTestedAt) }}
                    </span>
                  </div>
                </div>

                <IconBtn
                  :aria-label="$t('outbound_webhook_refresh')"
                  :disabled="isBusy"
                  @click="emit('refresh', props.webhook.id)"
                >
                  <VIcon icon="tabler-refresh" />
                  <VTooltip location="top" activator="parent">
                    {{ $t('outbound_webhook_refresh') }}
                  </VTooltip>
                </IconBtn>
              </div>

              <VAlert
                v-if="hasUnsavedChanges"
                color="info"
                variant="tonal"
                density="compact"
                icon="tabler-device-floppy"
              >
                {{ $t('outbound_webhook_save_before_test') }}
              </VAlert>

              <VAlert
                v-else-if="props.testResult?.webhookId === props.webhook.id"
                :color="
                  props.testResult.status === 'succeeded'
                    ? 'success'
                    : props.testResult.status === 'failed'
                      ? 'error'
                      : 'info'
                "
                variant="tonal"
                density="compact"
                :icon="
                  props.testResult.status === 'succeeded'
                    ? 'tabler-shield-check'
                    : props.testResult.status === 'failed'
                      ? 'tabler-alert-triangle'
                      : 'tabler-loader-2'
                "
              >
                {{
                  $t(`outbound_webhook_test_status_${props.testResult.status}`)
                }}
              </VAlert>

              <div class="verification-panel__actions">
                <VBtn
                  variant="tonal"
                  color="info"
                  prepend-icon="tabler-send"
                  :loading="props.activeAction === 'test'"
                  :disabled="!canRunCurrentConfiguration"
                  @click="emit('sendTest', props.webhook.id)"
                >
                  {{ $t('outbound_webhook_send_signed_test') }}
                </VBtn>

                <VBtn
                  v-if="props.canUpdateStatus && !props.webhook.isActive"
                  color="success"
                  variant="flat"
                  prepend-icon="tabler-player-play"
                  :loading="props.activeAction === 'activate'"
                  :disabled="!canActivate"
                  @click="
                    emit('setActive', {
                      webhookId: props.webhook.id,
                      active: true,
                    })
                  "
                >
                  {{ $t('outbound_webhook_activate') }}
                </VBtn>

                <VBtn
                  v-else-if="props.canUpdateStatus"
                  color="warning"
                  variant="tonal"
                  prepend-icon="tabler-player-pause"
                  :loading="props.activeAction === 'deactivate'"
                  :disabled="isBusy"
                  @click="
                    emit('setActive', {
                      webhookId: props.webhook.id,
                      active: false,
                    })
                  "
                >
                  {{ $t('outbound_webhook_deactivate') }}
                </VBtn>
              </div>

              <div
                v-if="props.canRotateSecret"
                class="verification-panel__secret-row"
              >
                <div>
                  <strong>{{ $t('outbound_webhook_rotate_secret') }}</strong>
                  <p>{{ $t('outbound_webhook_rotate_secret_description') }}</p>
                </div>
                <VBtn
                  size="small"
                  color="warning"
                  variant="tonal"
                  prepend-icon="tabler-refresh-dot"
                  :disabled="isBusy"
                  @click="isRotateConfirmationOpen = true"
                >
                  {{ $t('outbound_webhook_rotate') }}
                </VBtn>
              </div>

              <VAlert
                v-if="props.canRotateSecret"
                color="warning"
                variant="tonal"
                density="compact"
                icon="tabler-shield-exclamation"
              >
                {{ $t('outbound_webhook_rotate_invalidation_warning') }}
              </VAlert>
            </div>
          </section>
        </form>
      </VCardText>

      <VDivider />

      <VCardActions class="outbound-form-dialog__actions">
        <VBtn
          color="secondary"
          variant="tonal"
          :disabled="isBusy"
          @click="closeDialog"
        >
          {{ $t('cancel') }}
        </VBtn>
        <VBtn
          color="primary"
          variant="flat"
          :loading="
            props.activeAction === 'create' || props.activeAction === 'update'
          "
          :disabled="isBusy || (isEditing && !hasUnsavedChanges)"
          prepend-icon="tabler-device-floppy"
          data-testid="outbound-webhook-save"
          @click="submit"
        >
          {{
            isEditing
              ? $t('outbound_webhook_save_changes')
              : $t('outbound_webhook_create_inactive')
          }}
        </VBtn>
      </VCardActions>
    </VCard>

    <VDialogHandler
      v-if="isRotateConfirmationOpen"
      v-model="isRotateConfirmationOpen"
      :title="$t('outbound_webhook_rotate_confirm_title')"
      :message="$t('outbound_webhook_rotate_confirm_message')"
      :confirm-text="$t('outbound_webhook_rotate')"
      @confirm="confirmRotateSecret"
    />
  </VDialog>
</template>

<style scoped lang="scss">
.outbound-form-dialog {
  border: 1px solid rgb(var(--v-theme-primary), 0.14);
}

.outbound-form-dialog__header,
.outbound-form-dialog__heading,
.outbound-form-dialog__actions {
  display: flex;
  align-items: center;
}

.outbound-form-dialog__header {
  justify-content: space-between;
  gap: 1rem;
  padding-block: 1.1rem;
  padding-inline: 1.4rem;
  white-space: normal;
}

.outbound-form-dialog__heading {
  gap: 0.8rem;
  min-inline-size: 0;
}

.outbound-form-dialog__heading > div {
  min-inline-size: 0;
}

.outbound-form-dialog__icon {
  display: grid;
  flex: 0 0 auto;
  border-radius: 11px;
  background: rgb(var(--v-theme-primary), 0.1);
  block-size: 2.55rem;
  color: rgb(var(--v-theme-primary));
  inline-size: 2.55rem;
  place-items: center;
}

.outbound-form-dialog__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 750;
  letter-spacing: -0.015em;
}

.outbound-form-dialog__subtitle {
  margin-block: 0.18rem 0;
  margin-inline: 0;
  color: rgb(var(--v-theme-on-surface), 0.58);
  font-size: 0.77rem;
  overflow-wrap: anywhere;
}

.outbound-form-dialog__body {
  padding: 1.4rem;
}

.outbound-form {
  display: grid;
  gap: 1.6rem;
}

.outbound-form__section {
  display: grid;
  gap: 1rem;
}

.outbound-form__section-heading {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.outbound-form__section-heading > span {
  display: grid;
  flex: 0 0 auto;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary), 0.1);
  block-size: 1.75rem;
  color: rgb(var(--v-theme-primary));
  font-size: 0.67rem;
  font-weight: 800;
  inline-size: 1.75rem;
  place-items: center;
}

.outbound-form__section-heading h4 {
  margin: 0;
  color: rgb(var(--v-theme-on-surface), 0.88);
  font-size: 0.9rem;
  font-weight: 730;
}

.outbound-form__section-heading p {
  margin-block: 0.2rem 0;
  margin-inline: 0;
  color: rgb(var(--v-theme-on-surface), 0.56);
  font-size: 0.76rem;
  line-height: 1.45;
}

.outbound-form__fields {
  display: grid;
  gap: 0.9rem;
  grid-template-columns: minmax(13rem, 0.7fr) minmax(18rem, 1.3fr);
}

.outbound-form__field-error,
.secret-reveal__error {
  margin: 0;
  color: rgb(var(--v-theme-error));
  font-size: 0.75rem;
}

.secret-reveal__content {
  display: grid;
  gap: 0.75rem;
  inline-size: 100%;
}

.secret-reveal__content p {
  margin-block: 0.25rem 0;
  margin-inline: 0;
  font-size: 0.78rem;
  line-height: 1.5;
}

.secret-reveal__value-row {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.secret-reveal__value {
  overflow: auto;
  flex: 1 1 auto;
  padding: 0.7rem;
  border: 1px solid rgb(var(--v-theme-warning), 0.25);
  border-radius: 9px;
  background: rgb(var(--v-theme-surface), 0.72);
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.75rem;
  white-space: nowrap;
}

.verification-panel {
  display: grid;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid rgb(var(--v-theme-primary), 0.13);
  border-radius: 13px;
  background: rgb(var(--v-theme-primary), 0.025);
}

.verification-panel__status,
.verification-panel__actions,
.verification-panel__secret-row {
  display: flex;
  align-items: center;
}

.verification-panel__status,
.verification-panel__secret-row {
  justify-content: space-between;
  gap: 1rem;
}

.verification-panel__label {
  color: rgb(var(--v-theme-on-surface), 0.58);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.055em;
  text-transform: uppercase;
}

.verification-panel__timestamp {
  color: rgb(var(--v-theme-on-surface), 0.5);
  font-size: 0.72rem;
}

.verification-panel__actions {
  flex-wrap: wrap;
  gap: 0.7rem;
}

.verification-panel__secret-row {
  padding-block-start: 0.85rem;
  border-block-start: 1px solid rgb(var(--v-theme-on-surface), 0.08);
}

.verification-panel__secret-row strong {
  font-size: 0.78rem;
}

.verification-panel__secret-row p {
  margin-block: 0.2rem 0;
  margin-inline: 0;
  color: rgb(var(--v-theme-on-surface), 0.53);
  font-size: 0.72rem;
}

.outbound-form-dialog__actions {
  justify-content: flex-end;
  gap: 0.7rem;
  padding: 1rem 1.4rem;
}

@media (max-width: 699px) {
  .outbound-form__fields {
    grid-template-columns: 1fr;
  }

  .secret-reveal__value-row,
  .verification-panel__status,
  .verification-panel__secret-row {
    align-items: stretch;
    flex-direction: column;
  }

  .secret-reveal__value-row :deep(.v-btn),
  .verification-panel__secret-row :deep(.v-btn) {
    inline-size: 100%;
  }
}
</style>
