<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ListWorkerResponse } from '@core/schema/worker/listWorker/response.schema';
import type { WhatsappOfficialHealthResponse } from '@core/schema/worker/whatsappOfficialHealth/response.schema';
import { formatDateTime } from '@core/common/functions/formatDateTime';

type Tone = 'success' | 'warning' | 'error' | 'info' | 'primary' | 'secondary';

type MetricCard = {
  key: string;
  label: string;
  value: string;
  caption: string;
  icon: string;
  tone: Tone;
};

type SummaryRow = {
  key: string;
  label: string;
  value: string;
};

type AttentionItem = {
  key: string;
  title: string;
  description: string;
  icon: string;
  tone: Tone;
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

const metaValueTranslationKeys: Record<string, string> = {
  AVAILABLE: 'meta_health_value_available',
  LIMITED: 'meta_health_value_limited',
  BLOCKED: 'meta_health_value_blocked',
  CONNECTED: 'meta_health_value_connected',
  DISCONNECTED: 'meta_health_value_disconnected',
  GREEN: 'meta_health_value_green',
  YELLOW: 'meta_health_value_yellow',
  RED: 'meta_health_value_red',
  VERIFIED: 'meta_health_value_verified',
  NOT_VERIFIED: 'meta_health_value_not_verified',
  PENDING: 'meta_health_value_pending',
  ONBOARDED: 'meta_health_value_onboarded',
  NOT_ONBOARDED: 'meta_health_value_not_onboarded',
  STANDARD: 'meta_health_value_standard',
  CLOUD_API: 'meta_health_value_cloud_api',
  AVAILABLE_WITHOUT_REVIEW: 'meta_health_value_available_without_review',
  TIER_250: 'meta_health_value_tier_250',
  TIER_1K: 'meta_health_value_tier_1000',
  TIER_1000: 'meta_health_value_tier_1000',
  TIER_10K: 'meta_health_value_tier_10000',
  TIER_10000: 'meta_health_value_tier_10000',
  TIER_100K: 'meta_health_value_tier_100000',
  TIER_100000: 'meta_health_value_tier_100000',
  TIER_UNLIMITED: 'meta_health_value_tier_unlimited',
};

const normalizeMetaKey = (value: string | null | undefined) =>
  value?.trim().replaceAll(' ', '_').replaceAll('-', '_').toUpperCase() ?? '';

const translateMetaValue = (
  value: string | number | boolean | null | undefined
) => {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  if (typeof value === 'boolean') {
    return value ? t('yes') : t('no');
  }

  if (typeof value === 'number') {
    return formatNumber(value);
  }

  const translationKey = metaValueTranslationKeys[normalizeMetaKey(value)];

  return translationKey ? t(translationKey) : value;
};

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
  const phoneHealth = phoneNumber.value?.health_status as
    Record<string, unknown> | null | undefined;
  const wabaHealth = waba.value?.health_status as
    Record<string, unknown> | null | undefined;
  const phoneStatus =
    typeof phoneHealth?.can_send_message === 'string'
      ? phoneHealth.can_send_message
      : null;
  const wabaStatus =
    typeof wabaHealth?.can_send_message === 'string'
      ? wabaHealth.can_send_message
      : null;

  return phoneStatus ?? wabaStatus ?? phoneNumber.value?.status ?? null;
});

const normalizedCanSendStatus = computed(() =>
  normalizeMetaKey(canSendStatus.value)
);

const statusPresentation = computed(() => {
  if (
    normalizedCanSendStatus.value === 'AVAILABLE' ||
    normalizedCanSendStatus.value === 'CONNECTED'
  ) {
    return {
      color: 'success' as const,
      icon: 'tabler-circle-check',
      label: t('meta_health_available'),
      title: t('meta_health_status_available_title'),
      description: t('meta_health_status_available_description'),
    };
  }

  if (
    normalizedCanSendStatus.value === 'BLOCKED' ||
    normalizedCanSendStatus.value === 'DISABLED'
  ) {
    return {
      color: 'error' as const,
      icon: 'tabler-ban',
      label: t('meta_health_blocked'),
      title: t('meta_health_status_blocked_title'),
      description: t('meta_health_status_blocked_description'),
    };
  }

  if (normalizedCanSendStatus.value === 'LIMITED') {
    return {
      color: 'warning' as const,
      icon: 'tabler-alert-triangle',
      label: t('meta_health_limited'),
      title: t('meta_health_status_limited_title'),
      description: t('meta_health_status_limited_description'),
    };
  }

  return {
    color: 'secondary' as const,
    icon: 'tabler-help-circle',
    label: t('unknown'),
    title: t('meta_health_status_unknown_title'),
    description: t('meta_health_status_unknown_description'),
  };
});

const hasMessageAnalyticsData = computed(
  () => (messageAnalytics.value?.data_points.length ?? 0) > 0
);

const hasConversationBillingData = computed(
  () => (conversationAnalytics.value?.data_points.length ?? 0) > 0
);

const isBusinessVerified = computed(
  () =>
    normalizeMetaKey(waba.value?.business_verification_status) === 'VERIFIED'
);

const qualityTone = computed<Tone>(() => {
  const quality = normalizeMetaKey(phoneNumber.value?.quality_rating);

  if (quality === 'GREEN') {
    return 'success';
  }

  if (quality === 'YELLOW') {
    return 'warning';
  }

  if (quality === 'RED') {
    return 'error';
  }

  return 'secondary';
});

const metricCards = computed<MetricCard[]>(() => {
  const cards: Array<MetricCard | null> = [
    {
      key: 'open-conversations',
      label: t('meta_health_open_conversations'),
      value: formatNumber(props.health?.local.open_conversations),
      caption: t('meta_health_open_conversations_caption'),
      icon: 'tabler-message-circle',
      tone: 'primary',
    },
    hasMessageAnalyticsData.value
      ? {
          key: 'sent',
          label: t('meta_health_messages_sent'),
          value: formatNumber(messageAnalytics.value?.totals.sent),
          caption: t('meta_health_last_30_days'),
          icon: 'tabler-send',
          tone: 'info',
        }
      : null,
    hasMessageAnalyticsData.value
      ? {
          key: 'delivered',
          label: t('meta_health_messages_delivered'),
          value: formatNumber(messageAnalytics.value?.totals.delivered),
          caption: t('meta_health_last_30_days'),
          icon: 'tabler-checks',
          tone: 'success',
        }
      : null,
    hasConversationBillingData.value
      ? {
          key: 'billing',
          label: t('meta_health_approximate_billing'),
          value: formatCurrency(conversationAnalytics.value?.totals.cost),
          caption: t('meta_health_conversation_analytics_caption'),
          icon: 'tabler-receipt-2',
          tone: 'warning',
        }
      : null,
    phoneNumber.value?.quality_rating
      ? {
          key: 'quality',
          label: t('meta_health_quality'),
          value: translateMetaValue(phoneNumber.value.quality_rating),
          caption: t('meta_health_phone_quality_caption'),
          icon: 'tabler-heartbeat',
          tone: qualityTone.value,
        }
      : null,
    phoneNumber.value?.messaging_limit_tier
      ? {
          key: 'limit',
          label: t('meta_health_message_limit'),
          value: translateMetaValue(phoneNumber.value.messaging_limit_tier),
          caption: t('meta_health_message_limit_caption'),
          icon: 'tabler-gauge',
          tone: 'info',
        }
      : null,
    phoneNumber.value?.is_on_biz_app !== null &&
    phoneNumber.value?.is_on_biz_app !== undefined
      ? {
          key: 'coexistence',
          label: t('meta_health_coexistence'),
          value: phoneNumber.value.is_on_biz_app
            ? t('meta_health_active')
            : t('meta_health_inactive'),
          caption: t('meta_health_coexistence_caption'),
          icon: 'tabler-brand-whatsapp',
          tone: phoneNumber.value.is_on_biz_app ? 'success' : 'secondary',
        }
      : null,
    waba.value?.business_verification_status
      ? {
          key: 'business',
          label: t('meta_health_business_verification'),
          value: translateMetaValue(waba.value.business_verification_status),
          caption: t('meta_health_business_verification_caption'),
          icon: 'tabler-building',
          tone: isBusinessVerified.value ? 'success' : 'warning',
        }
      : null,
  ];

  return cards.filter((card): card is MetricCard => Boolean(card));
});

const metricGridClasses = computed(() => ({
  'is-seven-cards': metricCards.value.length === 7,
  'is-six-cards': metricCards.value.length === 6,
  'is-five-cards': metricCards.value.length === 5,
}));

const addRow = (
  rows: SummaryRow[],
  key: string,
  label: string,
  value: string | null | undefined
) => {
  if (!value || value === '-') {
    return;
  }

  rows.push({ key, label, value });
};

const summaryRows = computed<SummaryRow[]>(() => {
  const rows: SummaryRow[] = [];

  addRow(
    rows,
    'name',
    t('meta_health_account_name'),
    waba.value?.name ?? props.channel?.name ?? null
  );
  addRow(
    rows,
    'number',
    t('meta_health_connected_number'),
    phoneNumber.value?.display_phone_number ?? props.channel?.number ?? null
  );
  addRow(
    rows,
    'send',
    t('meta_health_sending_capacity'),
    translateMetaValue(canSendStatus.value)
  );
  addRow(
    rows,
    'phone-status',
    t('meta_health_phone_status'),
    translateMetaValue(phoneNumber.value?.status)
  );
  addRow(
    rows,
    'quality',
    t('meta_health_quality'),
    translateMetaValue(phoneNumber.value?.quality_rating)
  );
  addRow(
    rows,
    'limit',
    t('meta_health_message_limit'),
    translateMetaValue(phoneNumber.value?.messaging_limit_tier)
  );
  addRow(
    rows,
    'business',
    t('meta_health_business_verification'),
    translateMetaValue(waba.value?.business_verification_status)
  );
  addRow(
    rows,
    'name-status',
    t('meta_health_display_name_status'),
    translateMetaValue(phoneNumber.value?.name_status)
  );
  addRow(
    rows,
    'currency',
    t('meta_health_currency'),
    translateMetaValue(waba.value?.currency)
  );
  addRow(
    rows,
    'platform',
    t('meta_health_platform'),
    translateMetaValue(phoneNumber.value?.platform_type)
  );
  addRow(
    rows,
    'marketing',
    t('meta_health_marketing_messages'),
    translateMetaValue(waba.value?.marketing_messages_onboarding_status)
  );

  return rows;
});

const attentionItems = computed<AttentionItem[]>(() => {
  const items: AttentionItem[] = [];

  if (normalizedCanSendStatus.value === 'BLOCKED') {
    items.push({
      key: 'blocked',
      title: t('meta_health_action_blocked_title'),
      description: t('meta_health_action_blocked_description'),
      icon: 'tabler-ban',
      tone: 'error',
    });
  }

  if (normalizedCanSendStatus.value === 'LIMITED') {
    items.push({
      key: 'limited',
      title: t('meta_health_action_limited_title'),
      description: t('meta_health_action_limited_description'),
      icon: 'tabler-alert-triangle',
      tone: 'warning',
    });
  }

  if (waba.value?.business_verification_status && !isBusinessVerified.value) {
    items.push({
      key: 'business-verification',
      title: t('meta_health_action_verify_business_title'),
      description: t('meta_health_action_verify_business_description'),
      icon: 'tabler-building',
      tone: 'warning',
    });
  }

  const nameStatus = normalizeMetaKey(phoneNumber.value?.name_status);
  if (nameStatus && !['APPROVED', 'AVAILABLE'].includes(nameStatus)) {
    items.push({
      key: 'display-name',
      title: t('meta_health_action_display_name_title'),
      description: t('meta_health_action_display_name_description'),
      icon: 'tabler-id',
      tone: 'info',
    });
  }

  const quality = normalizeMetaKey(phoneNumber.value?.quality_rating);
  if (quality === 'YELLOW' || quality === 'RED') {
    items.push({
      key: 'quality',
      title: t('meta_health_action_quality_title'),
      description: t('meta_health_action_quality_description'),
      icon: 'tabler-heartbeat',
      tone: quality === 'RED' ? 'error' : 'warning',
    });
  }

  if (!items.length && (phoneNumber.value || waba.value)) {
    items.push({
      key: 'ok',
      title: t('meta_health_action_ok_title'),
      description: t('meta_health_action_ok_description'),
      icon: 'tabler-circle-check',
      tone: 'success',
    });
  }

  return items;
});

const visiblePhoneNumbers = computed(() => phoneNumbers.value?.results ?? []);

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
  <VDialog v-model="isVisible" max-width="1040" scrollable>
    <VCard class="meta-health-dialog">
      <div class="meta-health-header">
        <div class="meta-health-title-group">
          <div class="meta-health-icon-shell">
            <VIcon icon="tabler-shield-check" size="30" />
          </div>
          <div>
            <div class="meta-health-kicker">
              {{ $t('meta_health_kicker') }}
            </div>
            <h2 class="meta-health-title">
              {{ channel?.name ?? $t('whatsapp_official') }}
            </h2>
            <p class="meta-health-subtitle">
              {{ statusPresentation.description }}
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
          <div v-for="index in 6" :key="index" class="meta-health-skeleton" />
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
          <section
            class="meta-health-hero"
            :class="`is-${statusPresentation.color}`"
          >
            <div>
              <span class="meta-health-hero-eyebrow">
                {{ $t('meta_health_current_status') }}
              </span>
              <h3>{{ statusPresentation.title }}</h3>
              <p>{{ statusPresentation.description }}</p>
            </div>
            <VIcon :icon="statusPresentation.icon" size="44" />
          </section>

          <div class="meta-health-metrics" :class="metricGridClasses">
            <div
              v-for="card in metricCards"
              :key="card.key"
              class="meta-health-metric"
            >
              <div class="meta-health-metric-icon" :class="`is-${card.tone}`">
                <VIcon :icon="card.icon" size="22" />
              </div>
              <span class="meta-health-metric-label">{{ card.label }}</span>
              <strong class="meta-health-metric-value">{{ card.value }}</strong>
              <span class="meta-health-metric-caption">{{ card.caption }}</span>
            </div>
          </div>

          <div class="meta-health-main-grid">
            <section class="meta-health-panel meta-health-attention-panel">
              <div class="meta-health-section-title">
                <VIcon icon="tabler-bulb" size="20" />
                <div>
                  <span>{{ $t('meta_health_attention_title') }}</span>
                  <small>{{ $t('meta_health_attention_subtitle') }}</small>
                </div>
              </div>

              <div class="meta-health-attention-list">
                <div
                  v-for="item in attentionItems"
                  :key="item.key"
                  class="meta-health-attention-item"
                  :class="`is-${item.tone}`"
                >
                  <div class="meta-health-attention-icon">
                    <VIcon :icon="item.icon" size="22" />
                  </div>
                  <div>
                    <strong>{{ item.title }}</strong>
                    <p>{{ item.description }}</p>
                  </div>
                </div>
              </div>
            </section>

            <section class="meta-health-panel">
              <div class="meta-health-section-title">
                <VIcon icon="tabler-list-details" size="20" />
                <div>
                  <span>{{ $t('meta_health_channel_summary') }}</span>
                  <small>{{
                    $t('meta_health_channel_summary_subtitle')
                  }}</small>
                </div>
              </div>

              <div class="meta-health-summary-grid">
                <div
                  v-for="row in summaryRows"
                  :key="row.key"
                  class="meta-health-summary-row"
                >
                  <span>{{ row.label }}</span>
                  <strong>{{ row.value }}</strong>
                </div>
              </div>
            </section>
          </div>

          <section
            v-if="visiblePhoneNumbers.length"
            class="meta-health-panel meta-health-phone-list-panel"
          >
            <div class="meta-health-section-title">
              <VIcon icon="tabler-phone" size="20" />
              <div>
                <span>{{ $t('meta_health_phone_numbers') }}</span>
                <small>{{ $t('meta_health_phone_numbers_help') }}</small>
              </div>
            </div>

            <div class="meta-health-phone-list">
              <div
                v-for="phone in visiblePhoneNumbers"
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
                  <span>{{ phone.display_phone_number ?? '-' }}</span>
                </div>
                <div class="meta-health-phone-badges">
                  <VChip
                    v-if="phone.id === health.connection.phone_number_id"
                    size="small"
                    variant="tonal"
                    color="primary"
                  >
                    {{ $t('meta_health_current_number') }}
                  </VChip>
                  <VChip
                    v-if="phone.quality_rating"
                    size="small"
                    variant="tonal"
                    :color="
                      normalizeMetaKey(phone.quality_rating) === 'GREEN'
                        ? 'success'
                        : 'warning'
                    "
                  >
                    {{ translateMetaValue(phone.quality_rating) }}
                  </VChip>
                  <VChip
                    v-if="phone.messaging_limit_tier"
                    size="small"
                    variant="tonal"
                    color="info"
                  >
                    {{ translateMetaValue(phone.messaging_limit_tier) }}
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
    linear-gradient(
      135deg,
      rgba(var(--v-theme-primary), 0.13),
      transparent 42%
    ),
    linear-gradient(
      145deg,
      rgba(var(--v-theme-success), 0.09),
      rgba(var(--v-theme-warning), 0.08)
    );
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
  background: rgba(var(--v-theme-surface), 0.9);
  border: 1px solid rgba(var(--v-border-color), 0.18);
  border-radius: 8px;
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.12);
}

.meta-health-kicker,
.meta-health-hero-eyebrow {
  color: rgb(var(--v-theme-primary));
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

.meta-health-title {
  margin: 2px 0;
  color: rgba(var(--v-theme-on-surface), 0.92);
  font-size: clamp(1.15rem, 2vw, 1.55rem);
  font-weight: 800;
  line-height: 1.2;
}

.meta-health-subtitle {
  max-width: 620px;
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
  background: rgba(var(--v-theme-surface), 0.94);
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 8px;
  box-shadow: 0 16px 45px rgba(15, 23, 42, 0.16);
}

.meta-health-skeleton-grid,
.meta-health-metrics {
  display: grid;
  gap: 14px;
}

.meta-health-skeleton-grid {
  grid-template-columns: repeat(auto-fit, minmax(176px, 1fr));
}

.meta-health-metrics {
  grid-template-columns: repeat(12, minmax(0, 1fr));
}

.meta-health-metrics .meta-health-metric {
  grid-column: span 3;
}

.meta-health-metrics.is-seven-cards .meta-health-metric:nth-last-child(-n + 3) {
  grid-column: span 4;
}

.meta-health-metrics.is-six-cards .meta-health-metric {
  grid-column: span 4;
}

.meta-health-metrics.is-five-cards .meta-health-metric {
  grid-column: span 4;
}

.meta-health-metrics.is-five-cards .meta-health-metric:nth-last-child(-n + 2) {
  grid-column: span 6;
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

.meta-health-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 16px;
  padding: 18px;
  border: 1px solid rgba(var(--v-border-color), 0.14);
  border-radius: 8px;
}

.meta-health-hero.is-success {
  color: rgb(var(--v-theme-success));
  background: rgba(var(--v-theme-success), 0.08);
}

.meta-health-hero.is-warning {
  color: rgb(var(--v-theme-warning));
  background: rgba(var(--v-theme-warning), 0.1);
}

.meta-health-hero.is-error {
  color: rgb(var(--v-theme-error));
  background: rgba(var(--v-theme-error), 0.08);
}

.meta-health-hero.is-secondary {
  color: rgba(var(--v-theme-on-surface), 0.72);
  background: rgba(var(--v-theme-surface-variant), 0.18);
}

.meta-health-hero h3 {
  margin: 3px 0;
  color: rgba(var(--v-theme-on-surface), 0.92);
  font-size: 1.12rem;
  font-weight: 800;
}

.meta-health-hero p {
  max-width: 760px;
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.9rem;
  line-height: 1.45;
}

.meta-health-metric {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 144px;
  padding: 16px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.16);
  border-radius: 8px;
}

.meta-health-metric-icon,
.meta-health-attention-icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  border-radius: 8px;
}

.meta-health-metric-icon.is-primary,
.meta-health-attention-item.is-primary .meta-health-attention-icon {
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
}

.meta-health-metric-icon.is-info,
.meta-health-attention-item.is-info .meta-health-attention-icon {
  color: rgb(var(--v-theme-info));
  background: rgba(var(--v-theme-info), 0.12);
}

.meta-health-metric-icon.is-success,
.meta-health-attention-item.is-success .meta-health-attention-icon {
  color: rgb(var(--v-theme-success));
  background: rgba(var(--v-theme-success), 0.12);
}

.meta-health-metric-icon.is-warning,
.meta-health-attention-item.is-warning .meta-health-attention-icon {
  color: rgb(var(--v-theme-warning));
  background: rgba(var(--v-theme-warning), 0.14);
}

.meta-health-metric-icon.is-error,
.meta-health-attention-item.is-error .meta-health-attention-icon {
  color: rgb(var(--v-theme-error));
  background: rgba(var(--v-theme-error), 0.12);
}

.meta-health-metric-icon.is-secondary,
.meta-health-attention-item.is-secondary .meta-health-attention-icon {
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
  font-size: 1.24rem;
  font-weight: 800;
  line-height: 1.2;
  word-break: break-word;
}

.meta-health-main-grid {
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
  align-items: flex-start;
  gap: 9px;
  margin-bottom: 14px;
  color: rgba(var(--v-theme-on-surface), 0.86);
  font-weight: 800;
}

.meta-health-section-title span,
.meta-health-section-title small {
  display: block;
}

.meta-health-section-title small {
  margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.54);
  font-size: 0.76rem;
  font-weight: 500;
  line-height: 1.35;
}

.meta-health-attention-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.meta-health-attention-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  background: rgba(var(--v-theme-surface-variant), 0.13);
  border: 1px solid rgba(var(--v-border-color), 0.12);
  border-radius: 8px;
}

.meta-health-attention-item.is-warning {
  border-color: rgba(var(--v-theme-warning), 0.24);
}

.meta-health-attention-item.is-error {
  border-color: rgba(var(--v-theme-error), 0.24);
}

.meta-health-attention-item.is-success {
  border-color: rgba(var(--v-theme-success), 0.22);
}

.meta-health-attention-item strong {
  display: block;
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-size: 0.94rem;
  line-height: 1.3;
}

.meta-health-attention-item p {
  margin: 4px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.84rem;
  line-height: 1.45;
}

.meta-health-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.meta-health-summary-row {
  min-width: 0;
  padding: 11px 12px;
  background: rgba(var(--v-theme-surface-variant), 0.16);
  border-radius: 8px;
}

.meta-health-summary-row span,
.meta-health-phone-item span {
  display: block;
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 0.76rem;
  line-height: 1.35;
}

.meta-health-summary-row strong,
.meta-health-phone-item strong {
  display: block;
  margin-top: 2px;
  overflow-wrap: anywhere;
  color: rgba(var(--v-theme-on-surface), 0.88);
  font-size: 0.9rem;
  line-height: 1.35;
}

.meta-health-phone-list-panel {
  margin-top: 16px;
}

.meta-health-phone-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 10px;
}

.meta-health-phone-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 12px;
  background: rgba(var(--v-theme-surface-variant), 0.13);
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

  .meta-health-header,
  .meta-health-title-group,
  .meta-health-hero {
    flex-direction: column;
  }

  .meta-health-header-actions {
    justify-content: flex-start;
  }

  .meta-health-main-grid,
  .meta-health-summary-grid {
    grid-template-columns: 1fr;
  }

  .meta-health-metrics .meta-health-metric,
  .meta-health-metrics.is-seven-cards
    .meta-health-metric:nth-last-child(-n + 3),
  .meta-health-metrics.is-six-cards .meta-health-metric,
  .meta-health-metrics.is-five-cards .meta-health-metric,
  .meta-health-metrics.is-five-cards
    .meta-health-metric:nth-last-child(-n + 2) {
    grid-column: span 6;
  }
}

@media (max-width: 520px) {
  .meta-health-header,
  .meta-health-body {
    padding: 16px;
  }

  .meta-health-phone-item {
    flex-direction: column;
    align-items: flex-start;
  }

  .meta-health-metrics,
  .meta-health-skeleton-grid,
  .meta-health-phone-list {
    grid-template-columns: 1fr;
  }

  .meta-health-metrics .meta-health-metric,
  .meta-health-metrics.is-seven-cards
    .meta-health-metric:nth-last-child(-n + 3),
  .meta-health-metrics.is-six-cards .meta-health-metric,
  .meta-health-metrics.is-five-cards .meta-health-metric,
  .meta-health-metrics.is-five-cards
    .meta-health-metric:nth-last-child(-n + 2) {
    grid-column: 1;
  }
}
</style>
