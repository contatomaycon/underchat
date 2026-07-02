<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ListWorkerResponse } from '@core/schema/worker/listWorker/response.schema';
import type { WhatsappOfficialHealthResponse } from '@core/schema/worker/whatsappOfficialHealth/response.schema';
import { formatDateTime } from '@core/common/functions/formatDateTime';

type MetricCard = {
  key: string;
  label: string;
  value: string;
  caption: string;
  icon: string;
  color: string;
  muted?: boolean;
};

type DiagnosticError = {
  code: string | null;
  title: string | null;
  details: string | null;
  solution: string | null;
};

type DiagnosticEntity = {
  key: string;
  source: string;
  entityType: string;
  canSend: string | null;
  additionalInfo: string | null;
  errors: DiagnosticError[];
};

const props = defineProps<{
  modelValue: boolean;
  channel: ListWorkerResponse | null;
  health: WhatsappOfficialHealthResponse | null;
  loading?: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', visible: boolean): void;
  (event: 'refresh'): void;
}>();

const { t, locale } = useI18n();

const isVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const phoneNumber = computed(() => props.health?.phone_number.data ?? null);
const phoneNumbers = computed(() => props.health?.phone_numbers.data ?? null);
const waba = computed(() => props.health?.waba.data ?? null);
const messageAnalytics = computed(
  () => props.health?.analytics.messages.data ?? null
);
const conversationAnalytics = computed(
  () => props.health?.analytics.conversations.data ?? null
);

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
};

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const readString = (
  record: Record<string, unknown> | null,
  key: string
): string | null => {
  const value = record?.[key];
  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return null;
};

const formatMetaValue = (
  value: string | number | boolean | null | undefined
) =>
  value === null || value === undefined || value === ''
    ? '-'
    : String(value).replaceAll('_', ' ');

const formatNumber = (value: number | null | undefined) =>
  new Intl.NumberFormat(String(locale.value)).format(value ?? 0);

const formatCurrency = (value: number | null | undefined) => {
  const currency = waba.value?.currency ?? 'USD';

  return new Intl.NumberFormat(String(locale.value), {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value ?? 0);
};

const canSendStatus = computed(() => {
  const phoneHealth = asRecord(phoneNumber.value?.health_status);
  const wabaHealth = asRecord(waba.value?.health_status);

  return (
    readString(phoneHealth, 'can_send_message') ??
    readString(wabaHealth, 'can_send_message') ??
    phoneNumber.value?.status ??
    null
  );
});

const statusPresentation = computed(() => {
  const status = canSendStatus.value?.toUpperCase();

  if (status === 'AVAILABLE' || status === 'CONNECTED') {
    return {
      color: 'success',
      icon: 'tabler-circle-check',
      label: t('meta_health_available'),
    };
  }

  if (status === 'BLOCKED' || status === 'DISABLED') {
    return {
      color: 'error',
      icon: 'tabler-ban',
      label: t('meta_health_blocked'),
    };
  }

  if (status === 'LIMITED') {
    return {
      color: 'warning',
      icon: 'tabler-alert-triangle',
      label: t('meta_health_limited'),
    };
  }

  return {
    color: 'secondary',
    icon: 'tabler-help-circle',
    label: t('unknown'),
  };
});

const hasConversationBillingData = computed(
  () => (conversationAnalytics.value?.data_points.length ?? 0) > 0
);

const metricCards = computed<MetricCard[]>(() => [
  {
    key: 'open-conversations',
    label: t('meta_health_open_conversations'),
    value: formatNumber(props.health?.local.open_conversations),
    caption: t('meta_health_open_conversations_caption'),
    icon: 'tabler-messages',
    color: 'primary',
  },
  {
    key: 'sent',
    label: t('meta_health_messages_sent'),
    value: formatNumber(messageAnalytics.value?.totals.sent),
    caption: t('meta_health_last_30_days'),
    icon: 'tabler-send',
    color: 'info',
  },
  {
    key: 'delivered',
    label: t('meta_health_messages_delivered'),
    value: formatNumber(messageAnalytics.value?.totals.delivered),
    caption: t('meta_health_last_30_days'),
    icon: 'tabler-checks',
    color: 'success',
  },
  {
    key: 'billing',
    label: t('meta_health_approximate_billing'),
    value: hasConversationBillingData.value
      ? formatCurrency(conversationAnalytics.value?.totals.cost)
      : t('meta_health_no_data_short'),
    caption: hasConversationBillingData.value
      ? t('meta_health_conversation_analytics_caption')
      : t('meta_health_no_billing_data'),
    icon: 'tabler-receipt-2',
    color: hasConversationBillingData.value ? 'warning' : 'secondary',
    muted: !hasConversationBillingData.value,
  },
  {
    key: 'quality',
    label: t('meta_health_quality'),
    value: formatMetaValue(phoneNumber.value?.quality_rating),
    caption: t('meta_health_phone_quality_caption'),
    icon: 'tabler-activity-heartbeat',
    color: 'success',
  },
  {
    key: 'limit',
    label: t('meta_health_message_limit'),
    value: formatMetaValue(phoneNumber.value?.messaging_limit_tier),
    caption: t('meta_health_message_limit_caption'),
    icon: 'tabler-gauge',
    color: 'info',
  },
  {
    key: 'coexistence',
    label: t('meta_health_coexistence'),
    value:
      phoneNumber.value?.is_on_biz_app === true
        ? t('meta_health_active')
        : phoneNumber.value?.is_on_biz_app === false
          ? t('meta_health_inactive')
          : '-',
    caption: t('meta_health_coexistence_caption'),
    icon: 'tabler-brand-whatsapp',
    color:
      phoneNumber.value?.is_on_biz_app === true
        ? 'success'
        : phoneNumber.value?.is_on_biz_app === false
          ? 'warning'
          : 'secondary',
  },
  {
    key: 'business',
    label: t('meta_health_business_verification'),
    value: formatMetaValue(waba.value?.business_verification_status),
    caption: t('meta_health_business_verification_caption'),
    icon: 'tabler-building-check',
    color:
      waba.value?.business_verification_status?.toLowerCase() === 'verified'
        ? 'success'
        : 'warning',
  },
]);

const accountRows = computed(() => [
  {
    label: t('name'),
    value: formatMetaValue(waba.value?.name ?? props.channel?.name),
  },
  {
    label: t('number'),
    value: formatMetaValue(phoneNumber.value?.display_phone_number),
  },
  {
    label: 'WABA ID',
    value: formatMetaValue(props.health?.connection.waba_id),
  },
  {
    label: t('meta_health_phone_number_id'),
    value: formatMetaValue(props.health?.connection.phone_number_id),
  },
  {
    label: t('meta_health_currency'),
    value: formatMetaValue(waba.value?.currency),
  },
  {
    label: t('meta_health_phone_status'),
    value: formatMetaValue(phoneNumber.value?.status),
  },
  {
    label: t('meta_health_throughput'),
    value: formatMetaValue(phoneNumber.value?.throughput_level),
  },
  {
    label: t('meta_health_platform'),
    value: formatMetaValue(phoneNumber.value?.platform_type),
  },
  {
    label: t('meta_health_name_status'),
    value: formatMetaValue(phoneNumber.value?.name_status),
  },
  {
    label: t('meta_health_insights'),
    value:
      waba.value?.is_enabled_for_insights === true
        ? t('yes')
        : waba.value?.is_enabled_for_insights === false
          ? t('no')
          : '-',
  },
  {
    label: t('meta_health_marketing_messages'),
    value: formatMetaValue(waba.value?.marketing_messages_onboarding_status),
  },
  {
    label: t('meta_health_phone_numbers_added'),
    value: phoneNumbers.value ? formatNumber(phoneNumbers.value.total) : '-',
  },
]);

const createDiagnosticError = (value: unknown): DiagnosticError => {
  const record = asRecord(value);

  return {
    code:
      readString(record, 'code') ??
      readString(record, 'error_code') ??
      readString(record, 'error_subcode'),
    title:
      readString(record, 'title') ??
      readString(record, 'message') ??
      readString(record, 'error_description'),
    details:
      readString(record, 'details') ??
      readString(record, 'description') ??
      readString(record, 'additional_info'),
    solution:
      readString(record, 'possible_solution') ?? readString(record, 'solution'),
  };
};

const collectDiagnostics = (
  source: string,
  healthStatus: unknown
): DiagnosticEntity[] => {
  const healthRecord = asRecord(healthStatus);
  const entities = asArray(healthRecord?.entities);

  return entities.map((entity, index) => {
    const record = asRecord(entity);
    const entityType = readString(record, 'entity_type') ?? source;

    return {
      key: `${source}-${entityType}-${index}`,
      source,
      entityType,
      canSend: readString(record, 'can_send_message'),
      additionalInfo: readString(record, 'additional_info'),
      errors: asArray(record?.errors).map(createDiagnosticError),
    };
  });
};

const diagnostics = computed<DiagnosticEntity[]>(() => [
  ...collectDiagnostics(
    t('meta_health_phone_number'),
    phoneNumber.value?.health_status
  ),
  ...collectDiagnostics('WABA', waba.value?.health_status),
]);

const hasSectionErrors = computed(
  () =>
    props.health?.phone_number.error ||
    props.health?.phone_numbers.error ||
    props.health?.waba.error ||
    props.health?.analytics.messages.error ||
    props.health?.analytics.conversations.error
);

const sectionErrors = computed(() =>
  [
    props.health?.phone_numbers.error,
    props.health?.phone_number.error,
    props.health?.waba.error,
    props.health?.analytics.messages.error,
    props.health?.analytics.conversations.error,
  ].filter(Boolean)
);

const formattedPeriod = computed(() => {
  if (!props.health) {
    return '-';
  }

  return `${formatDateTime(props.health.period.start)} - ${formatDateTime(
    props.health.period.end
  )}`;
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="1080" scrollable>
    <VCard class="meta-health-dialog">
      <div class="meta-health-header">
        <div class="meta-health-title-group">
          <div class="meta-health-icon-shell">
            <VIcon icon="tabler-shield-heart" size="30" />
          </div>
          <div>
            <div class="meta-health-kicker">
              {{ $t('meta_health_kicker') }}
            </div>
            <h2 class="meta-health-title">
              {{ channel?.name ?? $t('whatsapp_official') }}
            </h2>
            <p class="meta-health-subtitle">
              {{ $t('meta_health_subtitle') }}
            </p>
          </div>
        </div>

        <div class="meta-health-header-actions">
          <VChip
            :color="statusPresentation.color"
            variant="tonal"
            class="meta-health-status-chip"
          >
            <VIcon :icon="statusPresentation.icon" size="18" start />
            {{ statusPresentation.label }}
          </VChip>
          <VBtn
            icon
            variant="text"
            size="small"
            :disabled="loading"
            @click="emit('refresh')"
          >
            <VIcon icon="tabler-refresh" />
            <VTooltip activator="parent" location="top">
              {{ $t('refresh') }}
            </VTooltip>
          </VBtn>
          <VBtn
            icon
            variant="text"
            size="small"
            :disabled="loading"
            @click="isVisible = false"
          >
            <VIcon icon="tabler-x" />
            <VTooltip activator="parent" location="top">
              {{ $t('close') }}
            </VTooltip>
          </VBtn>
        </div>
      </div>

      <VCardText class="meta-health-body">
        <VOverlay
          :model-value="Boolean(loading)"
          contained
          class="align-center justify-center"
        >
          <div class="meta-health-loading">
            <VProgressCircular color="primary" indeterminate size="46" />
            <span>{{ $t('meta_health_loading') }}</span>
          </div>
        </VOverlay>

        <div v-if="loading && !health" class="meta-health-skeleton-grid">
          <div v-for="index in 8" :key="index" class="meta-health-skeleton" />
        </div>

        <VAlert
          v-else-if="!health"
          type="info"
          variant="tonal"
          class="meta-health-empty"
        >
          {{ $t('meta_health_empty') }}
        </VAlert>

        <template v-else>
          <VAlert
            v-if="health.warnings.length || hasSectionErrors"
            type="warning"
            variant="tonal"
            class="mb-5"
          >
            <div class="meta-health-warning-list">
              <span v-for="warning in health.warnings" :key="warning">
                {{ warning }}
              </span>
              <span
                v-for="error in sectionErrors"
                :key="`${error?.type ?? 'meta'}-${error?.message}`"
              >
                {{ error?.message }}
              </span>
            </div>
          </VAlert>

          <div class="meta-health-metrics">
            <div
              v-for="card in metricCards"
              :key="card.key"
              class="meta-health-metric"
              :class="{ 'is-muted': card.muted }"
            >
              <div class="meta-health-metric-icon" :class="`is-${card.color}`">
                <VIcon :icon="card.icon" size="22" />
              </div>
              <span class="meta-health-metric-label">{{ card.label }}</span>
              <strong class="meta-health-metric-value">{{ card.value }}</strong>
              <span class="meta-health-metric-caption">{{ card.caption }}</span>
            </div>
          </div>

          <div class="meta-health-content-grid">
            <section class="meta-health-panel">
              <div class="meta-health-section-title">
                <VIcon icon="tabler-id" size="20" />
                <span>{{ $t('meta_health_account_snapshot') }}</span>
              </div>

              <div class="meta-health-account-grid">
                <div
                  v-for="row in accountRows"
                  :key="row.label"
                  class="meta-health-account-row"
                >
                  <span>{{ row.label }}</span>
                  <strong>{{ row.value }}</strong>
                </div>
              </div>
            </section>

            <section class="meta-health-panel">
              <div class="meta-health-section-title">
                <VIcon icon="tabler-alert-circle" size="20" />
                <span>{{ $t('meta_health_diagnostics') }}</span>
              </div>

              <div v-if="diagnostics.length" class="meta-health-diagnostics">
                <div
                  v-for="entity in diagnostics"
                  :key="entity.key"
                  class="meta-health-diagnostic"
                >
                  <div class="meta-health-diagnostic-heading">
                    <div>
                      <span class="meta-health-diagnostic-source">
                        {{ entity.source }}
                      </span>
                      <strong>{{ formatMetaValue(entity.entityType) }}</strong>
                    </div>
                    <VChip size="small" variant="tonal" color="secondary">
                      {{ formatMetaValue(entity.canSend) }}
                    </VChip>
                  </div>

                  <p
                    v-if="entity.additionalInfo"
                    class="meta-health-diagnostic-note"
                  >
                    {{ entity.additionalInfo }}
                  </p>

                  <div
                    v-if="entity.errors.length"
                    class="meta-health-error-list"
                  >
                    <div
                      v-for="(error, index) in entity.errors"
                      :key="`${entity.key}-error-${index}`"
                      class="meta-health-error"
                    >
                      <span v-if="error.code" class="meta-health-error-code">
                        #{{ error.code }}
                      </span>
                      <strong>{{
                        error.title ?? $t('meta_health_issue')
                      }}</strong>
                      <p v-if="error.details">{{ error.details }}</p>
                      <p v-if="error.solution">{{ error.solution }}</p>
                    </div>
                  </div>

                  <div v-else class="meta-health-diagnostic-ok">
                    <VIcon icon="tabler-check" size="18" />
                    {{ $t('meta_health_no_issues') }}
                  </div>
                </div>
              </div>

              <div v-else class="meta-health-diagnostic-ok">
                <VIcon icon="tabler-check" size="18" />
                {{ $t('meta_health_no_diagnostics') }}
              </div>
            </section>
          </div>

          <section
            v-if="phoneNumbers?.results.length"
            class="meta-health-panel meta-health-phone-list-panel"
          >
            <div class="meta-health-section-title">
              <VIcon icon="tabler-phone" size="20" />
              <span>{{ $t('meta_health_phone_numbers') }}</span>
            </div>

            <div class="meta-health-phone-list">
              <div
                v-for="phone in phoneNumbers.results"
                :key="phone.id"
                class="meta-health-phone-item"
                :class="{
                  'is-current': phone.id === health.connection.phone_number_id,
                }"
              >
                <div>
                  <strong>{{
                    phone.verified_name ?? $t('meta_health_without_name')
                  }}</strong>
                  <span>{{ phone.display_phone_number ?? phone.id }}</span>
                </div>
                <div class="meta-health-phone-badges">
                  <VChip size="small" variant="tonal" color="success">
                    {{ formatMetaValue(phone.quality_rating) }}
                  </VChip>
                  <VChip size="small" variant="tonal" color="info">
                    {{ formatMetaValue(phone.messaging_limit_tier) }}
                  </VChip>
                </div>
              </div>
            </div>
          </section>

          <div class="meta-health-footer">
            <span>
              {{ $t('meta_health_period') }}:
              <strong>{{ formattedPeriod }}</strong>
            </span>
            <span>
              {{ $t('meta_health_fetched_at') }}:
              <strong>{{ formatDateTime(health.fetched_at) }}</strong>
            </span>
          </div>
        </template>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style scoped>
.meta-health-dialog {
  overflow: hidden;
  border: 1px solid rgba(var(--v-border-color), 0.14);
  border-radius: 8px;
}

.meta-health-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 24px;
  background:
    linear-gradient(135deg, rgba(13, 148, 136, 0.14), transparent 42%),
    linear-gradient(145deg, rgba(37, 99, 235, 0.1), rgba(245, 158, 11, 0.08));
  border-bottom: 1px solid rgba(var(--v-border-color), 0.14);
}

.meta-health-title-group {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}

.meta-health-icon-shell {
  display: grid;
  place-items: center;
  flex: 0 0 54px;
  width: 54px;
  height: 54px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-surface), 0.84);
  border: 1px solid rgba(var(--v-border-color), 0.18);
  border-radius: 8px;
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.12);
}

.meta-health-kicker {
  color: rgb(var(--v-theme-primary));
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

.meta-health-title {
  margin: 2px 0;
  color: rgba(var(--v-theme-on-surface), 0.92);
  font-size: clamp(1.15rem, 2vw, 1.55rem);
  font-weight: 700;
  line-height: 1.2;
}

.meta-health-subtitle {
  max-width: 600px;
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.9rem;
  line-height: 1.45;
}

.meta-health-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.meta-health-status-chip {
  font-weight: 700;
}

.meta-health-body {
  position: relative;
  min-height: 360px;
  padding: 24px;
}

.meta-health-loading {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 18px;
  color: rgba(var(--v-theme-on-surface), 0.78);
  background: rgba(var(--v-theme-surface), 0.92);
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 8px;
  box-shadow: 0 16px 45px rgba(15, 23, 42, 0.16);
}

.meta-health-skeleton-grid,
.meta-health-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 14px;
}

.meta-health-skeleton {
  min-height: 132px;
  overflow: hidden;
  background: linear-gradient(
    90deg,
    rgba(var(--v-border-color), 0.08),
    rgba(var(--v-border-color), 0.18),
    rgba(var(--v-border-color), 0.08)
  );
  border-radius: 8px;
  animation: meta-health-pulse 1.2s ease-in-out infinite;
}

.meta-health-empty {
  margin-block: 32px;
}

.meta-health-warning-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.meta-health-metric {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 150px;
  padding: 16px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 8px;
}

.meta-health-metric.is-muted {
  background: rgba(var(--v-theme-surface-variant), 0.16);
}

.meta-health-metric-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 8px;
}

.meta-health-metric-icon.is-primary {
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
}

.meta-health-metric-icon.is-info {
  color: rgb(var(--v-theme-info));
  background: rgba(var(--v-theme-info), 0.12);
}

.meta-health-metric-icon.is-success {
  color: rgb(var(--v-theme-success));
  background: rgba(var(--v-theme-success), 0.12);
}

.meta-health-metric-icon.is-warning {
  color: rgb(var(--v-theme-warning));
  background: rgba(var(--v-theme-warning), 0.14);
}

.meta-health-metric-icon.is-secondary {
  color: rgba(var(--v-theme-on-surface), 0.58);
  background: rgba(var(--v-theme-surface-variant), 0.42);
}

.meta-health-metric-label,
.meta-health-metric-caption {
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.78rem;
  line-height: 1.35;
}

.meta-health-metric-value {
  color: rgba(var(--v-theme-on-surface), 0.92);
  font-size: 1.25rem;
  line-height: 1.2;
  word-break: break-word;
}

.meta-health-content-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
  gap: 16px;
  margin-top: 16px;
}

.meta-health-panel {
  padding: 18px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 8px;
}

.meta-health-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  color: rgba(var(--v-theme-on-surface), 0.86);
  font-weight: 700;
}

.meta-health-account-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.meta-health-account-row {
  min-width: 0;
  padding: 10px 12px;
  background: rgba(var(--v-theme-surface-variant), 0.18);
  border-radius: 8px;
}

.meta-health-account-row span,
.meta-health-phone-item span,
.meta-health-diagnostic-source {
  display: block;
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 0.76rem;
  line-height: 1.35;
}

.meta-health-account-row strong,
.meta-health-phone-item strong {
  display: block;
  margin-top: 2px;
  overflow-wrap: anywhere;
  color: rgba(var(--v-theme-on-surface), 0.88);
  font-size: 0.9rem;
  line-height: 1.35;
}

.meta-health-diagnostics {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.meta-health-diagnostic {
  padding: 14px;
  background: rgba(var(--v-theme-surface-variant), 0.14);
  border: 1px solid rgba(var(--v-border-color), 0.12);
  border-radius: 8px;
}

.meta-health-diagnostic-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.meta-health-diagnostic-heading strong {
  display: block;
  color: rgba(var(--v-theme-on-surface), 0.9);
  overflow-wrap: anywhere;
}

.meta-health-diagnostic-note {
  margin: 10px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.84rem;
  line-height: 1.45;
}

.meta-health-error-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.meta-health-error {
  padding: 10px 12px;
  background: rgba(var(--v-theme-warning), 0.1);
  border: 1px solid rgba(var(--v-theme-warning), 0.18);
  border-radius: 8px;
}

.meta-health-error-code {
  display: inline-flex;
  margin-bottom: 4px;
  color: rgb(var(--v-theme-warning));
  font-size: 0.76rem;
  font-weight: 700;
}

.meta-health-error strong,
.meta-health-error p {
  display: block;
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.82);
  font-size: 0.84rem;
  line-height: 1.45;
}

.meta-health-diagnostic-ok {
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.86rem;
}

.meta-health-phone-list-panel {
  margin-top: 16px;
}

.meta-health-phone-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 10px;
}

.meta-health-phone-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 12px;
  background: rgba(var(--v-theme-surface-variant), 0.14);
  border: 1px solid rgba(var(--v-border-color), 0.12);
  border-radius: 8px;
}

.meta-health-phone-item.is-current {
  border-color: rgba(var(--v-theme-primary), 0.45);
  box-shadow: inset 3px 0 0 rgb(var(--v-theme-primary));
}

.meta-health-phone-badges {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.meta-health-footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 16px;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.8rem;
}

@keyframes meta-health-pulse {
  0%,
  100% {
    opacity: 0.62;
  }

  50% {
    opacity: 1;
  }
}

@media (max-width: 880px) {
  .meta-health-header,
  .meta-health-title-group,
  .meta-health-header-actions {
    align-items: stretch;
  }

  .meta-health-header {
    flex-direction: column;
  }

  .meta-health-header-actions {
    justify-content: flex-start;
  }

  .meta-health-content-grid,
  .meta-health-account-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 520px) {
  .meta-health-header,
  .meta-health-body {
    padding: 16px;
  }

  .meta-health-title-group,
  .meta-health-phone-item {
    flex-direction: column;
    align-items: flex-start;
  }

  .meta-health-metrics,
  .meta-health-skeleton-grid,
  .meta-health-phone-list {
    grid-template-columns: 1fr;
  }
}
</style>
