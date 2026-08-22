<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EIntegrationPermissions } from '@core/common/enums/EPermissions/integration';
import { useAbility } from '@/plugins/0.casl/composables/useAbility';
import { normalizeBaseUrl } from '@/@webcore/utils/helpers';
import { useOutboundWebhooks } from '@/composables/integration/useOutboundWebhooks';
import OutboundWebhookFormDialog from '@/components/integration/outbound-webhooks/OutboundWebhookFormDialog.vue';
import OutboundWebhookDeliveryHistory from '@/components/integration/outbound-webhooks/OutboundWebhookDeliveryHistory.vue';
import VDialogHandler from '@/components/VDialogHandler.vue';
import type {
  OutboundWebhook,
  OutboundWebhookInput,
} from '@/types/outboundWebhooks';

const { t, locale } = useI18n();
const ability = useAbility();
const {
  webhooks,
  eventGroups,
  availableChannels,
  deliveries,
  selectedDelivery,
  deliveryNextCursor,
  secretReveal,
  lastTestResult,
  isLoading,
  isLoadingChannels,
  hasLoadedChannels,
  channelsError,
  activeAction,
  error,
  success,
  loadAll,
  loadWebhooks,
  loadWebhook,
  loadAvailableChannels,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  rotateSecret,
  sendSignedTest,
  setActive,
  loadDeliveries,
  loadDelivery,
  redeliver,
  clearFeedback,
  clearSecretReveal,
  clearDeliveryState,
} = useOutboundWebhooks();

const permissionsManage = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EIntegrationPermissions.integration_group,
];
const permissionsUpdateStatus = [
  ...permissionsManage,
  EIntegrationPermissions.integration_status_update,
];
const permissionsRotateSecret = [
  ...permissionsManage,
  EIntegrationPermissions.integration_generate_key,
];

const canManage = computed(() =>
  permissionsManage.some((permission) => ability.can(permission, permission))
);
const canUpdateStatus = computed(() =>
  permissionsUpdateStatus.some((permission) =>
    ability.can(permission, permission)
  )
);
const canRotateSecret = computed(() =>
  permissionsRotateSecret.some((permission) =>
    ability.can(permission, permission)
  )
);
const configuredCount = computed(() => webhooks.value.length);
const activeCount = computed(
  () => webhooks.value.filter((webhook) => webhook.isActive).length
);

const isFormOpen = shallowRef(false);
const isHistoryOpen = shallowRef(false);
const selectedWebhookId = shallowRef<string | null>(null);
const webhookToDeleteId = shallowRef<string | null>(null);

const selectedWebhook = computed(
  () =>
    webhooks.value.find((webhook) => webhook.id === selectedWebhookId.value) ??
    null
);
const webhookToDelete = computed(
  () =>
    webhooks.value.find((webhook) => webhook.id === webhookToDeleteId.value) ??
    null
);
const isDeleteDialogOpen = computed({
  get: () => webhookToDeleteId.value !== null,
  set: (visible: boolean) => {
    if (!visible) webhookToDeleteId.value = null;
  },
});

const docsUrl = computed(() => {
  const configuredUrl = normalizeBaseUrl(import.meta.env.VITE_API_DOCS_URL);
  if (configuredUrl) return `${configuredUrl}/guias/webhooks-saida`;
  if (import.meta.env.DEV && typeof globalThis.location !== 'undefined') {
    const { protocol, hostname } = globalThis.location;
    return `${protocol}//${hostname}:5174/guias/webhooks-saida`;
  }
  return 'https://docs.underchat.com.br/guias/webhooks-saida';
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

const statusColor = (webhook: OutboundWebhook): string => {
  if (webhook.isActive) return 'success';
  if (webhook.status === 'suspended') return 'error';
  if (webhook.isVerified) return 'info';
  return 'secondary';
};

const statusLabel = (webhook: OutboundWebhook): string => {
  if (webhook.isActive) return t('outbound_webhook_status_active');
  if (webhook.status === 'suspended') {
    return t('outbound_webhook_status_suspended');
  }
  if (webhook.isVerified) {
    return t('outbound_webhook_status_verified_inactive');
  }
  return t('outbound_webhook_status_unverified');
};

const visibleEventTypes = (webhook: OutboundWebhook): string[] =>
  webhook.eventTypes.slice(0, 3);

const openCreate = () => {
  clearFeedback();
  clearSecretReveal();
  selectedWebhookId.value = null;
  void loadAvailableChannels();
  isFormOpen.value = true;
};

const openEdit = (webhookId: string) => {
  clearFeedback();
  clearSecretReveal();
  selectedWebhookId.value = webhookId;
  void loadAvailableChannels();
  isFormOpen.value = true;
};

const openHistory = (webhookId: string) => {
  clearFeedback();
  clearDeliveryState();
  selectedWebhookId.value = webhookId;
  isHistoryOpen.value = true;
};

const saveWebhook = async (input: OutboundWebhookInput) => {
  if (selectedWebhook.value) {
    await updateWebhook(selectedWebhook.value.id, input);
    return;
  }

  const created = await createWebhook(input);
  if (created) selectedWebhookId.value = created.id;
};

const handleRotateSecret = async (webhookId: string) => {
  await rotateSecret(webhookId);
};

const handleSetActive = async (payload: {
  webhookId: string;
  active: boolean;
}) => {
  await setActive(payload.webhookId, payload.active);
};

const handleDelete = async () => {
  const webhookId = webhookToDeleteId.value;
  if (!webhookId) return;
  webhookToDeleteId.value = null;
  await deleteWebhook(webhookId);
};

const handleRedelivery = async (payload: {
  webhookId: string;
  deliveryId: string;
}) => {
  const queued = await redeliver(payload.webhookId, payload.deliveryId);
  if (queued) await loadDeliveries(payload.webhookId);
};

watch(
  canManage,
  async (allowed) => {
    if (allowed) await loadAll();
  },
  { immediate: true }
);
</script>

<template>
  <VCard class="outbound-card" data-testid="outbound-webhooks-card">
    <div class="outbound-card__accent" />

    <VCardText class="outbound-card__content">
      <div class="outbound-card__header">
        <div class="outbound-card__heading">
          <div class="outbound-card__icon" aria-hidden="true">
            <VIcon icon="tabler-route-alt-left" size="25" />
          </div>
          <div>
            <div class="d-flex align-center flex-wrap gap-2 mb-1">
              <h2 class="outbound-card__title">
                {{ $t('outbound_webhook_title') }}
              </h2>
              <VChip size="small" color="primary" variant="tonal">
                {{ $t('outbound_webhook_badge') }}
              </VChip>
            </div>
            <p class="outbound-card__subtitle">
              {{ $t('outbound_webhook_description') }}
            </p>
          </div>
        </div>

        <div class="outbound-card__header-actions">
          <VBtn
            tag="a"
            :href="docsUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="outbound-card__docs-link"
            variant="tonal"
            color="primary"
            prepend-icon="tabler-book-2"
            :aria-label="$t('outbound_webhook_docs')"
            data-testid="outbound-webhook-open-docs"
          >
            {{ $t('outbound_webhook_docs') }}
            <VIcon icon="tabler-external-link" end size="17" />
          </VBtn>
          <VBtn
            v-if="canManage"
            color="primary"
            variant="flat"
            prepend-icon="tabler-plus"
            data-testid="new-outbound-webhook"
            @click="openCreate"
          >
            {{ $t('outbound_webhook_new') }}
          </VBtn>
        </div>
      </div>

      <VAlert
        v-if="!canManage"
        class="mt-5"
        color="info"
        variant="tonal"
        icon="tabler-lock"
      >
        <strong>{{ $t('outbound_webhook_permission_title') }}</strong>
        <p class="mb-0 mt-1 text-body-2">
          {{ $t('outbound_webhook_permission_description') }}
        </p>
      </VAlert>

      <template v-else>
        <div
          class="outbound-flow mt-5"
          :aria-label="$t('outbound_webhook_flow_aria')"
        >
          <div class="outbound-flow__step">
            <span>01</span>
            <div>
              <strong>{{ $t('outbound_webhook_flow_create') }}</strong>
              <small>{{ $t('outbound_webhook_flow_create_hint') }}</small>
            </div>
          </div>
          <VIcon icon="tabler-arrow-right" size="17" />
          <div class="outbound-flow__step">
            <span>02</span>
            <div>
              <strong>{{ $t('outbound_webhook_flow_test') }}</strong>
              <small>{{ $t('outbound_webhook_flow_test_hint') }}</small>
            </div>
          </div>
          <VIcon icon="tabler-arrow-right" size="17" />
          <div class="outbound-flow__step">
            <span>03</span>
            <div>
              <strong>{{ $t('outbound_webhook_flow_activate') }}</strong>
              <small>{{ $t('outbound_webhook_flow_activate_hint') }}</small>
            </div>
          </div>
          <div class="outbound-flow__rule">
            <VIcon icon="tabler-shield-check" size="17" />
            {{ $t('outbound_webhook_flow_rule') }}
          </div>
        </div>

        <VAlert
          v-if="error"
          class="mt-5"
          color="error"
          variant="tonal"
          closable
          @click:close="clearFeedback"
        >
          <div
            class="d-flex align-center justify-space-between flex-wrap gap-3"
          >
            <span>{{ error }}</span>
            <VBtn
              size="small"
              variant="text"
              prepend-icon="tabler-refresh"
              @click="loadAll"
            >
              {{ $t('outbound_webhook_try_again') }}
            </VBtn>
          </div>
        </VAlert>

        <VAlert
          v-if="success && !isFormOpen && !isHistoryOpen"
          class="mt-5"
          color="success"
          variant="tonal"
          closable
          @click:close="clearFeedback"
        >
          {{ success }}
        </VAlert>

        <div class="outbound-card__summary mt-5">
          <div>
            <span>{{ $t('outbound_webhook_configured') }}</span>
            <strong>{{ configuredCount }}</strong>
          </div>
          <div>
            <span>{{ $t('outbound_webhook_active_count') }}</span>
            <strong>{{ activeCount }}</strong>
          </div>
          <div class="outbound-card__summary-note">
            <VIcon icon="tabler-clock-shield" size="18" />
            {{ $t('outbound_webhook_history_summary') }}
          </div>
          <IconBtn
            :aria-label="$t('outbound_webhook_refresh')"
            :disabled="isLoading"
            @click="loadWebhooks"
          >
            <VIcon icon="tabler-refresh" />
            <VTooltip location="top" activator="parent">
              {{ $t('outbound_webhook_refresh') }}
            </VTooltip>
          </IconBtn>
        </div>

        <div v-if="isLoading" class="outbound-card__skeleton mt-4">
          <VSkeletonLoader
            v-for="index in 2"
            :key="index"
            type="list-item-avatar-two-line, actions"
          />
        </div>

        <div v-else-if="!webhooks.length" class="outbound-empty mt-4">
          <div class="outbound-empty__icon">
            <VIcon icon="tabler-route-off" size="29" />
          </div>
          <strong>{{ $t('outbound_webhook_empty_title') }}</strong>
          <span>{{ $t('outbound_webhook_empty_description') }}</span>
          <VBtn
            size="small"
            variant="tonal"
            prepend-icon="tabler-plus"
            @click="openCreate"
          >
            {{ $t('outbound_webhook_new') }}
          </VBtn>
        </div>

        <div v-else class="outbound-list mt-4">
          <article
            v-for="webhook in webhooks"
            :key="webhook.id"
            class="outbound-endpoint"
          >
            <div class="outbound-endpoint__identity">
              <span
                class="outbound-endpoint__signal"
                :class="{
                  'outbound-endpoint__signal--active': webhook.isActive,
                }"
                aria-hidden="true"
              />
              <div class="outbound-endpoint__name-wrap">
                <div class="d-flex align-center flex-wrap gap-2">
                  <h3>{{ webhook.name }}</h3>
                  <VChip
                    :color="statusColor(webhook)"
                    size="x-small"
                    variant="tonal"
                  >
                    {{ statusLabel(webhook) }}
                  </VChip>
                </div>
                <code>{{ webhook.endpointUrl }}</code>
              </div>
            </div>

            <div class="outbound-endpoint__channel">
              <span class="outbound-endpoint__label">
                {{ $t('outbound_webhook_channel_label') }}
              </span>
              <div class="outbound-endpoint__channel-value">
                <VIcon
                  :icon="
                    webhook.channel.available
                      ? 'tabler-brand-whatsapp'
                      : 'tabler-plug-off'
                  "
                  :color="webhook.channel.available ? 'primary' : 'warning'"
                  size="17"
                />
                <div>
                  <strong>
                    {{
                      webhook.channel.name ||
                      $t('outbound_webhook_channel_unavailable_short')
                    }}
                  </strong>
                  <small v-if="webhook.channel.number">
                    {{ webhook.channel.number }}
                  </small>
                </div>
                <VChip
                  v-if="!webhook.channel.available"
                  color="warning"
                  size="x-small"
                  variant="tonal"
                >
                  {{ $t('outbound_webhook_channel_unavailable_short') }}
                </VChip>
              </div>
            </div>

            <div class="outbound-endpoint__events">
              <span class="outbound-endpoint__label">
                {{ $t('outbound_webhook_subscriptions') }}
              </span>
              <div class="outbound-endpoint__event-chips">
                <VChip
                  v-for="eventType in visibleEventTypes(webhook)"
                  :key="eventType"
                  size="x-small"
                  variant="outlined"
                >
                  {{ eventType }}
                </VChip>
                <VChip
                  v-if="webhook.eventTypes.length > 3"
                  size="x-small"
                  color="secondary"
                  variant="tonal"
                >
                  +{{ webhook.eventTypes.length - 3 }}
                </VChip>
              </div>
            </div>

            <div class="outbound-endpoint__activity">
              <span class="outbound-endpoint__label">
                {{ $t('outbound_webhook_verified_at') }}
              </span>
              <span>{{ formatTimestamp(webhook.lastTestedAt) }}</span>
            </div>

            <div class="outbound-endpoint__actions">
              <IconBtn
                :aria-label="$t('outbound_webhook_history')"
                @click="openHistory(webhook.id)"
              >
                <VIcon icon="tabler-history" />
                <VTooltip location="top" activator="parent">
                  {{ $t('outbound_webhook_history') }}
                </VTooltip>
              </IconBtn>
              <IconBtn :aria-label="$t('edit')" @click="openEdit(webhook.id)">
                <VIcon icon="tabler-settings" />
                <VTooltip location="top" activator="parent">
                  {{ $t('outbound_webhook_configure') }}
                </VTooltip>
              </IconBtn>
              <IconBtn
                :aria-label="
                  webhook.isActive
                    ? $t('outbound_webhook_deactivate')
                    : $t('outbound_webhook_activate')
                "
                :disabled="
                  !canUpdateStatus ||
                  !webhook.channel.available ||
                  (!webhook.isActive && !webhook.isVerified)
                "
                @click="setActive(webhook.id, !webhook.isActive)"
              >
                <VIcon
                  :icon="
                    webhook.isActive
                      ? 'tabler-toggle-right'
                      : 'tabler-toggle-left'
                  "
                  :color="webhook.isActive ? 'success' : undefined"
                />
                <VTooltip location="top" activator="parent">
                  {{
                    webhook.isActive
                      ? canUpdateStatus
                        ? $t('outbound_webhook_deactivate')
                        : $t('outbound_webhook_status_permission_required')
                      : !webhook.channel.available
                        ? $t('outbound_webhook_channel_unavailable_action')
                        : webhook.isVerified
                          ? canUpdateStatus
                            ? $t('outbound_webhook_activate')
                            : $t('outbound_webhook_status_permission_required')
                          : $t('outbound_webhook_test_before_activate')
                  }}
                </VTooltip>
              </IconBtn>
              <IconBtn
                :aria-label="$t('delete')"
                @click="webhookToDeleteId = webhook.id"
              >
                <VIcon icon="tabler-trash" />
                <VTooltip location="top" activator="parent">
                  {{ $t('delete') }}
                </VTooltip>
              </IconBtn>
            </div>
          </article>
        </div>
      </template>
    </VCardText>

    <OutboundWebhookFormDialog
      v-if="isFormOpen"
      v-model="isFormOpen"
      :webhook="selectedWebhook"
      :event-groups="eventGroups"
      :available-channels="availableChannels"
      :is-loading-channels="isLoadingChannels"
      :has-loaded-channels="hasLoadedChannels"
      :channels-error="channelsError"
      :secret-reveal="secretReveal"
      :test-result="lastTestResult"
      :active-action="activeAction"
      :error="error"
      :success="success"
      :can-update-status="canUpdateStatus"
      :can-rotate-secret="canRotateSecret"
      @save="saveWebhook"
      @rotate-secret="handleRotateSecret"
      @send-test="sendSignedTest"
      @set-active="handleSetActive"
      @refresh="loadWebhook"
      @clear-secret="clearSecretReveal"
      @clear-feedback="clearFeedback"
      @retry-channels="loadAvailableChannels"
    />

    <OutboundWebhookDeliveryHistory
      v-if="isHistoryOpen"
      v-model="isHistoryOpen"
      :webhook="selectedWebhook"
      :deliveries="deliveries"
      :selected-delivery="selectedDelivery"
      :next-cursor="deliveryNextCursor"
      :active-action="activeAction"
      :error="error"
      :success="success"
      @load="loadDeliveries($event.webhookId, $event.cursor)"
      @view-delivery="loadDelivery($event.webhookId, $event.deliveryId)"
      @redeliver="handleRedelivery"
      @clear-feedback="clearFeedback"
      @closed="clearDeliveryState"
    />

    <VDialogHandler
      v-if="isDeleteDialogOpen"
      v-model="isDeleteDialogOpen"
      :title="$t('outbound_webhook_delete_title')"
      :message="
        $t('outbound_webhook_delete_message', {
          name: webhookToDelete?.name ?? '',
        })
      "
      :confirm-text="$t('delete')"
      @confirm="handleDelete"
    />
  </VCard>
</template>

<style scoped lang="scss">
.outbound-card {
  position: relative;
  overflow: hidden;
  border: 1px solid rgb(var(--v-theme-primary), 0.14);
  box-shadow: 0 12px 34px rgb(33, 58, 107, 6%);
}

.outbound-card__accent {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  background: linear-gradient(
    180deg,
    rgb(var(--v-theme-primary)),
    rgb(var(--v-theme-info), 0.35)
  );
  inline-size: 3px;
}

.outbound-card__content {
  padding: 1.75rem;
}

.outbound-card__header,
.outbound-card__heading,
.outbound-card__header-actions,
.outbound-card__summary,
.outbound-endpoint__identity,
.outbound-endpoint__actions {
  display: flex;
  align-items: center;
}

.outbound-card__header {
  justify-content: space-between;
  gap: 1.25rem;
}

.outbound-card__heading {
  gap: 1rem;
  min-inline-size: 0;
}

.outbound-card__header-actions {
  flex: 0 0 auto;
  gap: 0.5rem;
}

.outbound-card__docs-link {
  position: relative;
  z-index: 2;
  pointer-events: auto;
}

.outbound-card__icon {
  display: grid;
  flex: 0 0 auto;
  border: 1px solid rgb(var(--v-theme-primary), 0.2);
  border-radius: 14px;
  background:
    linear-gradient(145deg, rgb(var(--v-theme-primary), 0.14), transparent),
    rgb(var(--v-theme-primary), 0.05);
  block-size: 3.1rem;
  color: rgb(var(--v-theme-primary));
  inline-size: 3.1rem;
  place-items: center;
}

.outbound-card__title {
  margin: 0;
  color: rgb(var(--v-theme-on-surface));
  font-size: 1.18rem;
  font-weight: 720;
  letter-spacing: -0.016em;
}

.outbound-card__subtitle {
  margin: 0;
  color: rgb(var(--v-theme-on-surface), 0.64);
  font-size: 0.9rem;
  line-height: 1.55;
  max-inline-size: 56rem;
}

.outbound-flow {
  display: grid;
  align-items: center;
  padding: 0.95rem;
  border: 1px solid rgb(var(--v-theme-primary), 0.13);
  border-radius: 14px;
  background:
    linear-gradient(105deg, rgb(var(--v-theme-primary), 0.06), transparent 52%),
    rgb(var(--v-theme-on-surface), 0.015);
  gap: 0.7rem;
  grid-template-columns:
    minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr)
    minmax(12rem, 0.75fr);
}

.outbound-flow__step,
.outbound-flow__rule {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.outbound-flow__step > span {
  display: grid;
  flex: 0 0 auto;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary), 0.11);
  block-size: 1.85rem;
  color: rgb(var(--v-theme-primary));
  font-size: 0.68rem;
  font-weight: 800;
  inline-size: 1.85rem;
  place-items: center;
}

.outbound-flow__step > div {
  display: grid;
  min-inline-size: 0;
}

.outbound-flow__step strong {
  color: rgb(var(--v-theme-on-surface), 0.82);
  font-size: 0.77rem;
}

.outbound-flow__step small {
  overflow: hidden;
  color: rgb(var(--v-theme-on-surface), 0.49);
  font-size: 0.66rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.outbound-flow > .v-icon {
  color: rgb(var(--v-theme-on-surface), 0.25);
}

.outbound-flow__rule {
  align-self: stretch;
  padding: 0.65rem;
  border-inline-start: 1px solid rgb(var(--v-theme-primary), 0.13);
  color: rgb(var(--v-theme-on-surface), 0.58);
  font-size: 0.69rem;
  line-height: 1.4;
}

.outbound-card__summary {
  padding-block: 0.75rem;
  padding-inline: 0.9rem;
  border: 1px solid rgb(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background: rgb(var(--v-theme-on-surface), 0.02);
  gap: 1.2rem;
}

.outbound-card__summary > div:not(.outbound-card__summary-note) {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
}

.outbound-card__summary span {
  color: rgb(var(--v-theme-on-surface), 0.52);
  font-size: 0.7rem;
}

.outbound-card__summary strong {
  color: rgb(var(--v-theme-on-surface), 0.85);
  font-size: 0.92rem;
}

.outbound-card__summary-note {
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  justify-content: flex-end;
  color: rgb(var(--v-theme-on-surface), 0.5);
  font-size: 0.69rem;
  gap: 0.4rem;
}

.outbound-list {
  display: grid;
  gap: 0.7rem;
}

.outbound-endpoint {
  display: grid;
  align-items: center;
  padding-block: 0.9rem;
  padding-inline: 1rem;
  border: 1px solid rgb(var(--v-theme-on-surface), 0.09);
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  gap: 1rem;
  grid-template-columns:
    minmax(14rem, 1.2fr) minmax(10rem, 0.8fr) minmax(13rem, 1fr)
    minmax(8rem, 0.65fr) auto;
  transition:
    border-color 160ms ease,
    transform 160ms ease;
}

.outbound-endpoint:hover {
  border-color: rgb(var(--v-theme-primary), 0.22);
  transform: translateY(-1px);
}

.outbound-endpoint__identity {
  min-inline-size: 0;
  gap: 0.75rem;
}

.outbound-endpoint__signal {
  flex: 0 0 auto;
  border-radius: 999px;
  background: rgb(var(--v-theme-secondary));
  block-size: 2.2rem;
  box-shadow: inset 0 0 0 0.65rem rgb(var(--v-theme-surface));
  inline-size: 0.72rem;
}

.outbound-endpoint__signal--active {
  background: rgb(var(--v-theme-success));
  box-shadow:
    inset 0 0 0 0.65rem rgb(var(--v-theme-surface)),
    0 0 0 4px rgb(var(--v-theme-success), 0.08);
}

.outbound-endpoint__name-wrap {
  min-inline-size: 0;
}

.outbound-endpoint__name-wrap h3 {
  overflow: hidden;
  margin: 0;
  color: rgb(var(--v-theme-on-surface), 0.86);
  font-size: 0.84rem;
  font-weight: 720;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.outbound-endpoint__name-wrap code {
  display: block;
  overflow: hidden;
  margin-block-start: 0.32rem;
  color: rgb(var(--v-theme-on-surface), 0.48);
  font-size: 0.67rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.outbound-endpoint__channel,
.outbound-endpoint__events,
.outbound-endpoint__activity {
  display: grid;
  min-inline-size: 0;
  gap: 0.35rem;
}

.outbound-endpoint__channel-value {
  display: flex;
  align-items: center;
  min-inline-size: 0;
  gap: 0.45rem;
}

.outbound-endpoint__channel-value > div {
  display: grid;
  overflow: hidden;
  min-inline-size: 0;
}

.outbound-endpoint__channel-value strong,
.outbound-endpoint__channel-value small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.outbound-endpoint__channel-value strong {
  color: rgb(var(--v-theme-on-surface), 0.76);
  font-size: 0.73rem;
}

.outbound-endpoint__channel-value small {
  color: rgb(var(--v-theme-on-surface), 0.48);
  font-size: 0.65rem;
}

.outbound-endpoint__label {
  color: rgb(var(--v-theme-on-surface), 0.45);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.055em;
  text-transform: uppercase;
}

.outbound-endpoint__event-chips {
  display: flex;
  overflow: hidden;
  gap: 0.3rem;
}

.outbound-endpoint__activity > span:last-child {
  overflow: hidden;
  color: rgb(var(--v-theme-on-surface), 0.68);
  font-size: 0.7rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.outbound-endpoint__actions {
  gap: 0.15rem;
}

.outbound-empty {
  display: grid;
  padding: 2.6rem 1rem;
  border: 1px dashed rgb(var(--v-theme-primary), 0.2);
  border-radius: 14px;
  background: rgb(var(--v-theme-primary), 0.018);
  color: rgb(var(--v-theme-on-surface), 0.54);
  gap: 0.4rem;
  place-items: center;
  text-align: center;
}

.outbound-empty strong {
  color: rgb(var(--v-theme-on-surface), 0.82);
}

.outbound-empty span {
  margin-block-end: 0.4rem;
  font-size: 0.78rem;
}

.outbound-empty__icon {
  display: grid;
  border-radius: 14px;
  background: rgb(var(--v-theme-primary), 0.09);
  block-size: 3.25rem;
  color: rgb(var(--v-theme-primary));
  inline-size: 3.25rem;
  margin-block-end: 0.3rem;
  place-items: center;
}

@media (max-width: 1180px) {
  .outbound-flow {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .outbound-flow > .v-icon {
    display: none;
  }

  .outbound-flow__rule {
    border-block-start: 1px solid rgb(var(--v-theme-primary), 0.13);
    border-inline-start: 0;
    grid-column: 1 / -1;
  }

  .outbound-endpoint {
    grid-template-columns:
      minmax(14rem, 1.1fr) minmax(10rem, 0.75fr) minmax(12rem, 1fr)
      auto;
  }

  .outbound-endpoint__activity {
    display: none;
  }
}

@media (max-width: 799px) {
  .outbound-card__header,
  .outbound-card__heading {
    align-items: flex-start;
  }

  .outbound-card__header {
    flex-direction: column;
  }

  .outbound-card__header-actions {
    inline-size: 100%;
  }

  .outbound-card__header-actions :deep(.v-btn) {
    flex: 1 1 auto;
  }

  .outbound-endpoint {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .outbound-endpoint__channel {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .outbound-endpoint__events {
    grid-column: 1 / -1;
    grid-row: 3;
  }

  .outbound-endpoint__actions {
    grid-column: 2;
    grid-row: 1;
  }
}

@media (max-width: 599px) {
  .outbound-card__content {
    padding: 1.2rem;
  }

  .outbound-card__heading {
    gap: 0.75rem;
  }

  .outbound-card__icon {
    block-size: 2.7rem;
    inline-size: 2.7rem;
  }

  .outbound-card__header-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .outbound-flow {
    grid-template-columns: 1fr;
  }

  .outbound-flow__rule {
    grid-column: auto;
  }

  .outbound-card__summary {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .outbound-card__summary-note {
    flex-basis: 100%;
    justify-content: flex-start;
    order: 3;
  }

  .outbound-endpoint {
    grid-template-columns: minmax(0, 1fr);
  }

  .outbound-endpoint__actions,
  .outbound-endpoint__events {
    grid-column: 1;
  }

  .outbound-endpoint__actions {
    justify-content: flex-end;
    grid-row: 4;
  }
}
</style>
