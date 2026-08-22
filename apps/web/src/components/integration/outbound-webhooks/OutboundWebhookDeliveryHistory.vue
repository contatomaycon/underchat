<script setup lang="ts">
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatJsonForDisplay } from '@core/common/functions/jsonDisplay';
import type {
  OutboundWebhook,
  OutboundWebhookAction,
  OutboundWebhookDelivery,
  OutboundWebhookDeliveryDetail,
  OutboundWebhookDeliveryStatus,
} from '@/types/outboundWebhooks';

interface Props {
  webhook: OutboundWebhook | null;
  deliveries: readonly OutboundWebhookDelivery[];
  selectedDelivery: OutboundWebhookDeliveryDetail | null;
  nextCursor: string | null;
  activeAction: OutboundWebhookAction;
  error: string | null;
  success: string | null;
}

interface Emits {
  load: [payload: { webhookId: string; cursor: string | null }];
  viewDelivery: [payload: { webhookId: string; deliveryId: string }];
  redeliver: [payload: { webhookId: string; deliveryId: string }];
  clearFeedback: [];
  closed: [];
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const isOpen = defineModel<boolean>({ required: true });
const { t, locale } = useI18n();

const isLoadingList = computed(() => props.activeAction === 'load-deliveries');
const isLoadingDetail = computed(() => props.activeAction === 'load-delivery');
const canRedeliver = computed(
  () =>
    Boolean(props.webhook?.isActive) &&
    (props.selectedDelivery?.status === 'dead' ||
      props.selectedDelivery?.status === 'suppressed') &&
    !props.selectedDelivery?.isTest
);

const statusColor = (
  status: OutboundWebhookDeliveryStatus
): 'success' | 'error' | 'warning' | 'info' | 'secondary' => {
  if (status === 'succeeded') return 'success';
  if (status === 'dead') return 'error';
  if (status === 'retrying') return 'warning';
  if (status === 'pending' || status === 'leased') return 'info';
  return 'secondary';
};

const statusIcon = (status: OutboundWebhookDeliveryStatus): string => {
  if (status === 'succeeded') return 'tabler-circle-check';
  if (status === 'dead') {
    return 'tabler-alert-circle';
  }
  if (status === 'retrying') return 'tabler-refresh';
  if (status === 'suppressed') return 'tabler-shield-off';
  return 'tabler-clock';
};

const formatTimestamp = (value: string | null): string => {
  if (!value) return t('outbound_webhook_never');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t('outbound_webhook_never');
  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
};

const noContent = computed(() => t('outbound_webhook_delivery_no_content'));
const formattedRequestBody = computed(() =>
  formatJsonForDisplay(props.selectedDelivery?.requestBody, noContent.value)
);
const formattedResponseBody = computed(() =>
  formatJsonForDisplay(props.selectedDelivery?.responseBody, noContent.value)
);
const formattedAttemptHistory = computed(() =>
  formatJsonForDisplay(props.selectedDelivery?.attemptHistory, noContent.value)
);

const closeDialog = () => {
  isOpen.value = false;
};

const reload = () => {
  if (!props.webhook) return;
  emit('load', { webhookId: props.webhook.id, cursor: null });
};

watch(
  () => [isOpen.value, props.webhook?.id] as const,
  ([visible, webhookId]) => {
    if (visible && webhookId) emit('load', { webhookId, cursor: null });
  },
  { immediate: true }
);

watch(isOpen, (visible) => {
  if (!visible) emit('closed');
});
</script>

<template>
  <VDialog
    v-model="isOpen"
    max-width="1120"
    scrollable
    :aria-label="$t('outbound_webhook_history_title')"
  >
    <VCard class="delivery-dialog">
      <VCardTitle class="delivery-dialog__header">
        <div class="delivery-dialog__heading">
          <span class="delivery-dialog__icon" aria-hidden="true">
            <VIcon icon="tabler-history" size="23" />
          </span>
          <div>
            <h3 class="delivery-dialog__title">
              {{ $t('outbound_webhook_history_title') }}
            </h3>
            <p class="delivery-dialog__subtitle">
              {{ props.webhook?.name }} ·
              {{ $t('outbound_webhook_history_retention') }}
            </p>
          </div>
        </div>

        <div class="d-flex align-center gap-1">
          <IconBtn
            :aria-label="$t('outbound_webhook_refresh')"
            :disabled="isLoadingList"
            @click="reload"
          >
            <VIcon icon="tabler-refresh" />
            <VTooltip location="top" activator="parent">
              {{ $t('outbound_webhook_refresh') }}
            </VTooltip>
          </IconBtn>
          <IconBtn :aria-label="$t('close')" @click="closeDialog">
            <VIcon icon="tabler-x" />
          </IconBtn>
        </div>
      </VCardTitle>

      <VDivider />

      <VCardText class="delivery-dialog__body">
        <VAlert
          v-if="props.error"
          class="mb-4"
          color="error"
          variant="tonal"
          closable
          @click:close="emit('clearFeedback')"
        >
          {{ props.error }}
        </VAlert>

        <VAlert
          v-if="props.success"
          class="ma-4"
          color="success"
          variant="tonal"
          closable
          @click:close="emit('clearFeedback')"
        >
          {{ props.success }}
        </VAlert>

        <div class="delivery-layout">
          <section
            class="delivery-list-panel"
            :aria-label="$t('outbound_webhook_delivery_list_aria')"
          >
            <div class="delivery-list-panel__header">
              <strong>{{ $t('outbound_webhook_deliveries') }}</strong>
              <span>{{ props.deliveries.length }}</span>
            </div>

            <div v-if="isLoadingList && !props.deliveries.length" class="pa-3">
              <VSkeletonLoader
                v-for="index in 4"
                :key="index"
                type="list-item-two-line"
              />
            </div>

            <div v-else-if="!props.deliveries.length" class="delivery-empty">
              <VIcon icon="tabler-package-off" size="30" />
              <strong>{{ $t('outbound_webhook_history_empty_title') }}</strong>
              <span>{{
                $t('outbound_webhook_history_empty_description')
              }}</span>
            </div>

            <div v-else class="delivery-list">
              <button
                v-for="delivery in props.deliveries"
                :key="delivery.id"
                type="button"
                class="delivery-list__item"
                :class="{
                  'delivery-list__item--selected':
                    props.selectedDelivery?.id === delivery.id,
                }"
                @click="
                  props.webhook &&
                  emit('viewDelivery', {
                    webhookId: props.webhook.id,
                    deliveryId: delivery.id,
                  })
                "
              >
                <span
                  class="delivery-list__status"
                  :class="`delivery-list__status--${statusColor(delivery.status)}`"
                  aria-hidden="true"
                >
                  <VIcon :icon="statusIcon(delivery.status)" size="17" />
                </span>
                <span class="delivery-list__copy">
                  <span class="delivery-list__topline">
                    <code>{{ delivery.eventType }}</code>
                    <small>{{ formatTimestamp(delivery.createdAt) }}</small>
                  </span>
                  <span class="delivery-list__meta">
                    {{
                      $t(`outbound_webhook_delivery_status_${delivery.status}`)
                    }}
                    ·
                    {{
                      $t('outbound_webhook_attempt_count', {
                        count: delivery.attempts,
                      })
                    }}
                    <template v-if="delivery.responseStatus">
                      · HTTP {{ delivery.responseStatus }}
                    </template>
                  </span>
                </span>
                <VIcon icon="tabler-chevron-right" size="17" />
              </button>

              <VBtn
                v-if="props.nextCursor"
                class="delivery-list__more"
                variant="text"
                size="small"
                :loading="isLoadingList"
                @click="
                  props.webhook &&
                  emit('load', {
                    webhookId: props.webhook.id,
                    cursor: props.nextCursor,
                  })
                "
              >
                {{ $t('outbound_webhook_load_more') }}
              </VBtn>
            </div>
          </section>

          <section
            class="delivery-detail-panel"
            :aria-label="$t('outbound_webhook_delivery_detail_aria')"
          >
            <div v-if="isLoadingDetail" class="pa-5">
              <VSkeletonLoader type="heading, text, paragraph, paragraph" />
            </div>

            <div
              v-else-if="!props.selectedDelivery"
              class="delivery-detail-empty"
            >
              <VIcon icon="tabler-click" size="32" />
              <strong>{{ $t('outbound_webhook_select_delivery') }}</strong>
              <span>{{
                $t('outbound_webhook_select_delivery_description')
              }}</span>
            </div>

            <div v-else class="delivery-detail">
              <div class="delivery-detail__header">
                <div>
                  <span class="delivery-detail__eyebrow">
                    {{ $t('outbound_webhook_delivery_detail') }}
                  </span>
                  <h4>{{ props.selectedDelivery.eventType }}</h4>
                </div>
                <VChip
                  :color="statusColor(props.selectedDelivery.status)"
                  variant="tonal"
                  size="small"
                  :prepend-icon="statusIcon(props.selectedDelivery.status)"
                >
                  {{
                    $t(
                      `outbound_webhook_delivery_status_${props.selectedDelivery.status}`
                    )
                  }}
                </VChip>
              </div>

              <dl class="delivery-detail__facts">
                <div>
                  <dt>{{ $t('outbound_webhook_delivery_id') }}</dt>
                  <dd>{{ props.selectedDelivery.id }}</dd>
                </div>
                <div>
                  <dt>{{ $t('outbound_webhook_delivery_created_at') }}</dt>
                  <dd>
                    {{ formatTimestamp(props.selectedDelivery.createdAt) }}
                  </dd>
                </div>
                <div>
                  <dt>{{ $t('outbound_webhook_delivery_attempts') }}</dt>
                  <dd>{{ props.selectedDelivery.attempts }}</dd>
                </div>
                <div>
                  <dt>HTTP</dt>
                  <dd>{{ props.selectedDelivery.responseStatus ?? '—' }}</dd>
                </div>
              </dl>

              <VAlert
                v-if="props.selectedDelivery.lastError"
                color="error"
                variant="tonal"
                density="compact"
              >
                {{ props.selectedDelivery.lastError }}
              </VAlert>

              <VExpansionPanels
                variant="accordion"
                class="delivery-detail__panels"
              >
                <VExpansionPanel>
                  <VExpansionPanelTitle>
                    {{ $t('outbound_webhook_request_payload') }}
                  </VExpansionPanelTitle>
                  <VExpansionPanelText>
                    <pre>{{ formattedRequestBody }}</pre>
                  </VExpansionPanelText>
                </VExpansionPanel>
                <VExpansionPanel>
                  <VExpansionPanelTitle>
                    {{ $t('outbound_webhook_response') }}
                  </VExpansionPanelTitle>
                  <VExpansionPanelText>
                    <pre>{{ formattedResponseBody }}</pre>
                  </VExpansionPanelText>
                </VExpansionPanel>
                <VExpansionPanel>
                  <VExpansionPanelTitle>
                    {{ $t('outbound_webhook_attempt_history') }}
                  </VExpansionPanelTitle>
                  <VExpansionPanelText>
                    <pre>{{ formattedAttemptHistory }}</pre>
                  </VExpansionPanelText>
                </VExpansionPanel>
              </VExpansionPanels>

              <VAlert
                color="info"
                variant="tonal"
                density="compact"
                icon="tabler-shield-lock"
              >
                {{ $t('outbound_webhook_history_sanitized') }}
              </VAlert>

              <div class="delivery-detail__actions">
                <VBtn
                  color="warning"
                  variant="tonal"
                  prepend-icon="tabler-reload"
                  :loading="props.activeAction === 'redeliver'"
                  :disabled="!canRedeliver || props.activeAction !== null"
                  @click="
                    props.webhook &&
                    emit('redeliver', {
                      webhookId: props.webhook.id,
                      deliveryId: props.selectedDelivery.id,
                    })
                  "
                >
                  {{ $t('outbound_webhook_redeliver') }}
                </VBtn>
              </div>
            </div>
          </section>
        </div>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style scoped lang="scss">
.delivery-dialog {
  overflow: hidden;
}

.delivery-dialog__header,
.delivery-dialog__heading,
.delivery-detail__header,
.delivery-detail__actions {
  display: flex;
  align-items: center;
}

.delivery-dialog__header,
.delivery-detail__header {
  justify-content: space-between;
  gap: 1rem;
}

.delivery-dialog__header {
  padding-block: 1.05rem;
  padding-inline: 1.35rem;
}

.delivery-dialog__heading {
  gap: 0.8rem;
  min-inline-size: 0;
}

.delivery-dialog__icon {
  display: grid;
  flex: 0 0 auto;
  border-radius: 11px;
  background: rgb(var(--v-theme-info), 0.1);
  block-size: 2.55rem;
  color: rgb(var(--v-theme-info));
  inline-size: 2.55rem;
  place-items: center;
}

.delivery-dialog__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 750;
}

.delivery-dialog__subtitle {
  overflow: hidden;
  margin-block: 0.18rem 0;
  margin-inline: 0;
  color: rgb(var(--v-theme-on-surface), 0.55);
  font-size: 0.76rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delivery-dialog__body {
  padding: 0;
}

.delivery-layout {
  display: grid;
  min-block-size: 34rem;
  grid-template-columns: minmax(19rem, 0.82fr) minmax(0, 1.18fr);
}

.delivery-list-panel {
  border-inline-end: 1px solid rgb(var(--v-theme-on-surface), 0.09);
  background: rgb(var(--v-theme-on-surface), 0.018);
}

.delivery-list-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-block: 0.8rem;
  padding-inline: 1rem;
  border-block-end: 1px solid rgb(var(--v-theme-on-surface), 0.08);
  color: rgb(var(--v-theme-on-surface), 0.7);
  font-size: 0.73rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.delivery-list-panel__header span {
  display: grid;
  border-radius: 999px;
  background: rgb(var(--v-theme-primary), 0.1);
  block-size: 1.5rem;
  color: rgb(var(--v-theme-primary));
  font-size: 0.68rem;
  inline-size: 1.5rem;
  place-items: center;
}

.delivery-list {
  display: grid;
}

.delivery-list__item {
  display: grid;
  align-items: center;
  width: 100%;
  padding-block: 0.78rem;
  padding-inline: 0.9rem;
  border: 0;
  border-block-end: 1px solid rgb(var(--v-theme-on-surface), 0.07);
  background: transparent;
  color: inherit;
  cursor: pointer;
  gap: 0.65rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
  text-align: start;
  transition: background 150ms ease;
}

.delivery-list__item:hover,
.delivery-list__item--selected {
  background: rgb(var(--v-theme-primary), 0.065);
}

.delivery-list__item:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}

.delivery-list__status {
  display: grid;
  border-radius: 9px;
  block-size: 2rem;
  inline-size: 2rem;
  place-items: center;
}

.delivery-list__status--success {
  background: rgb(var(--v-theme-success), 0.12);
  color: rgb(var(--v-theme-success));
}

.delivery-list__status--error {
  background: rgb(var(--v-theme-error), 0.11);
  color: rgb(var(--v-theme-error));
}

.delivery-list__status--warning {
  background: rgb(var(--v-theme-warning), 0.12);
  color: rgb(var(--v-theme-warning));
}

.delivery-list__status--info,
.delivery-list__status--secondary {
  background: rgb(var(--v-theme-info), 0.1);
  color: rgb(var(--v-theme-info));
}

.delivery-list__copy,
.delivery-list__topline {
  display: flex;
  min-inline-size: 0;
}

.delivery-list__copy {
  flex-direction: column;
  gap: 0.25rem;
}

.delivery-list__topline {
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
}

.delivery-list__topline code {
  overflow: hidden;
  color: rgb(var(--v-theme-on-surface), 0.83);
  font-size: 0.7rem;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delivery-list__topline small,
.delivery-list__meta {
  color: rgb(var(--v-theme-on-surface), 0.49);
  font-size: 0.65rem;
}

.delivery-list__topline small {
  flex: 0 0 auto;
}

.delivery-list__more {
  margin: 0.65rem;
}

.delivery-empty,
.delivery-detail-empty {
  display: grid;
  color: rgb(var(--v-theme-on-surface), 0.5);
  gap: 0.35rem;
  padding: 3rem 1rem;
  place-items: center;
  text-align: center;
}

.delivery-empty strong,
.delivery-detail-empty strong {
  color: rgb(var(--v-theme-on-surface), 0.76);
  font-size: 0.84rem;
}

.delivery-empty span,
.delivery-detail-empty span {
  font-size: 0.73rem;
}

.delivery-detail-panel {
  min-inline-size: 0;
}

.delivery-detail {
  display: grid;
  gap: 1rem;
  padding: 1.2rem;
}

.delivery-detail__eyebrow {
  color: rgb(var(--v-theme-primary));
  font-size: 0.65rem;
  font-weight: 750;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.delivery-detail__header h4 {
  margin-block: 0.2rem 0;
  margin-inline: 0;
  font-family: monospace;
  font-size: 0.9rem;
}

.delivery-detail__facts {
  display: grid;
  margin: 0;
  gap: 0.65rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.delivery-detail__facts div {
  min-inline-size: 0;
  padding: 0.65rem;
  border: 1px solid rgb(var(--v-theme-on-surface), 0.08);
  border-radius: 9px;
  background: rgb(var(--v-theme-on-surface), 0.02);
}

.delivery-detail__facts dt {
  color: rgb(var(--v-theme-on-surface), 0.47);
  font-size: 0.63rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.delivery-detail__facts dd {
  overflow: hidden;
  margin-block: 0.25rem 0;
  margin-inline: 0;
  color: rgb(var(--v-theme-on-surface), 0.78);
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delivery-detail__panels pre {
  overflow: auto;
  max-block-size: 16rem;
  margin: 0;
  padding: 0.8rem;
  border-radius: 8px;
  background: rgb(var(--v-theme-on-surface), 0.045);
  color: rgb(var(--v-theme-on-surface), 0.78);
  font-size: 0.7rem;
  line-height: 1.55;
  white-space: pre-wrap;
}

.delivery-detail__actions {
  justify-content: flex-end;
}

@media (max-width: 799px) {
  .delivery-layout {
    grid-template-columns: 1fr;
  }

  .delivery-list-panel {
    border-block-end: 1px solid rgb(var(--v-theme-on-surface), 0.09);
    border-inline-end: 0;
  }

  .delivery-list {
    max-block-size: 18rem;
    overflow-y: auto;
  }
}
</style>
