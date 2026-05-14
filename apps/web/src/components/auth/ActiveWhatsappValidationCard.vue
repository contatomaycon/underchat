<script setup lang="ts">
import { computed, ref } from 'vue';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';

type ActiveValidationStatus = 'waiting' | 'validated' | 'rejected';

const props = defineProps<{
  validationText: string;
  whatsappUrl: string;
  targetPhone: string;
  status: ActiveValidationStatus;
  rejectionReason?: string | null;
}>();

const emit = defineEmits<{
  copied: [];
  opened: [];
}>();

const { t } = useI18n();
const copiedTarget = ref<'url' | 'message' | null>(null);

const formattedTargetPhone = computed(() => {
  const formatted = formatPhoneBR(props.targetPhone);
  return formatted || props.targetPhone;
});

const statusColor = computed(() => {
  if (props.status === 'validated') return 'success';
  if (props.status === 'rejected') return 'error';
  return 'primary';
});

const statusClass = computed(() => `active-validation-status--${props.status}`);

const statusIcon = computed(() => {
  if (props.status === 'validated') return 'tabler-circle-check';
  if (props.status === 'rejected') return 'tabler-alert-circle';
  return 'tabler-loader-2';
});

const statusTitle = computed(() => {
  if (props.status === 'validated') {
    return t('active_whatsapp_validation_success');
  }

  if (props.status === 'rejected') {
    return t('active_whatsapp_validation_rejected');
  }

  return t('active_whatsapp_validation_waiting');
});

const statusText = computed(() => {
  if (props.status === 'validated') {
    return t('active_whatsapp_validation_success_description');
  }

  if (props.status === 'rejected') {
    return props.rejectionReason
      ? t(`active_whatsapp_validation_reason_${props.rejectionReason}`)
      : t('active_whatsapp_validation_rejected_description');
  }

  return t('active_whatsapp_validation_waiting_description', {
    phone: formattedTargetPhone.value,
  });
});

const rejectionText = computed(() => {
  if (!props.rejectionReason) return null;
  return t(`active_whatsapp_validation_reason_${props.rejectionReason}`);
});

const waitingStatusTextParts = computed(() => {
  const phonePlaceholder = '__PHONE__';
  const text = t('active_whatsapp_validation_waiting_description', {
    phone: phonePlaceholder,
  });
  const [beforePhone = '', afterPhone = ''] = text.split(phonePlaceholder);

  return {
    beforePhone,
    afterPhone,
  };
});

const copyToClipboard = async (
  value: string,
  target: 'url' | 'message'
): Promise<void> => {
  await navigator.clipboard.writeText(value);
  copiedTarget.value = target;
  emit('copied');
  window.setTimeout(() => {
    if (copiedTarget.value === target) {
      copiedTarget.value = null;
    }
  }, 1800);
};

const openWhatsapp = (): void => {
  window.open(props.whatsappUrl, '_blank', 'noopener,noreferrer');
  emit('opened');
};
</script>

<template>
  <VCard class="active-validation-card" variant="flat">
    <div class="active-validation-status" :class="statusClass">
      <div class="active-validation-status-icon">
        <VProgressCircular
          v-if="status === 'waiting'"
          indeterminate
          :color="statusColor"
          size="34"
          width="4"
        />
        <VIcon v-else :icon="statusIcon" size="30" />
      </div>

      <div class="active-validation-status-copy">
        <div class="active-validation-status-title">
          {{ statusTitle }}
        </div>
        <div v-if="status === 'waiting'" class="active-validation-status-text">
          <span>{{ waitingStatusTextParts.beforePhone }}</span>
          <strong class="active-validation-phone">
            {{ formattedTargetPhone }}
          </strong>
          <span>{{ waitingStatusTextParts.afterPhone }}</span>
        </div>
        <div v-else class="active-validation-status-text">
          {{ statusText }}
        </div>
      </div>
    </div>

    <div
      v-if="status === 'waiting' && rejectionText"
      class="active-validation-retry-alert"
    >
      <VIcon icon="tabler-alert-triangle" size="18" />
      <div>
        <div class="active-validation-retry-title">
          {{ $t('active_whatsapp_validation_rejected') }}
        </div>
        <div class="active-validation-retry-text">
          {{ rejectionText }}
        </div>
      </div>
    </div>

    <div class="active-validation-section">
      <div class="d-flex align-center justify-space-between gap-3 mb-2">
        <div>
          <div class="text-caption text-medium-emphasis">
            {{ $t('active_whatsapp_validation_target') }}
          </div>
          <div class="text-body-1 font-weight-bold active-validation-target">
            {{ formattedTargetPhone }}
          </div>
        </div>
        <VChip color="success" size="small" variant="tonal">
          <VIcon icon="tabler-brand-whatsapp" size="16" start />
          WhatsApp
        </VChip>
      </div>
    </div>

    <div class="active-validation-section">
      <div class="text-caption text-medium-emphasis mb-2">
        {{ $t('active_whatsapp_validation_message') }}
      </div>
      <div class="active-validation-message">
        <code>{{ validationText }}</code>
        <VBtn
          color="secondary"
          variant="tonal"
          icon
          size="small"
          :aria-label="$t('copy')"
          @click="copyToClipboard(validationText, 'message')"
        >
          <VIcon
            :icon="copiedTarget === 'message' ? 'tabler-check' : 'tabler-copy'"
            size="18"
          />
        </VBtn>
      </div>
    </div>

    <div class="active-validation-section">
      <div class="d-flex align-center justify-space-between gap-3 mb-2">
        <span class="text-caption text-medium-emphasis">
          {{ $t('active_whatsapp_validation_url') }}
        </span>
        <VBtn
          color="secondary"
          variant="tonal"
          size="small"
          @click="copyToClipboard(whatsappUrl, 'url')"
        >
          <VIcon
            :icon="copiedTarget === 'url' ? 'tabler-check' : 'tabler-copy'"
            size="18"
            start
          />
          {{ $t('active_whatsapp_validation_copy_link') }}
        </VBtn>
      </div>
      <VTextarea
        :model-value="whatsappUrl"
        readonly
        rows="3"
        auto-grow
        variant="outlined"
        density="compact"
        hide-details
        class="active-validation-url"
      />
    </div>

    <VBtn color="success" block size="large" class="mt-5" @click="openWhatsapp">
      <VIcon icon="tabler-brand-whatsapp" start />
      {{ $t('active_whatsapp_validation_open') }}
    </VBtn>
  </VCard>
</template>

<style scoped>
.active-validation-card {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  padding: 20px;
}

.active-validation-status {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  max-width: 640px;
  margin: 0 auto 24px;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-primary), 0.18);
  border-radius: 8px;
  padding: 18px 20px;
  background:
    linear-gradient(
      135deg,
      rgba(var(--v-theme-primary), 0.1),
      rgba(var(--v-theme-info), 0.12)
    ),
    rgba(var(--v-theme-surface), 1);
  box-shadow: 0 14px 32px rgba(var(--v-theme-primary), 0.1);
}

.active-validation-status::before {
  position: absolute;
  z-index: 1;
  background: rgba(var(--v-theme-primary), 1);
  content: '';
  inset-block: 0;
  inset-inline-start: 0;
  width: 4px;
}

.active-validation-status::after {
  position: absolute;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(var(--v-theme-primary), 0.38),
    transparent
  );
  content: '';
  height: 1px;
  inset-block-start: 0;
  inset-inline: 0;
}

.active-validation-status-icon {
  position: relative;
  display: grid;
  flex: 0 0 52px;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.12);
  box-shadow: inset 0 0 0 1px rgba(var(--v-theme-primary), 0.18);
  color: rgba(var(--v-theme-primary), 1);
  block-size: 52px;
  inline-size: 52px;
}

.active-validation-status-copy {
  max-width: 480px;
  min-width: 0;
}

.active-validation-status-title {
  color: rgba(var(--v-theme-primary), 1);
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.35;
}

.active-validation-status-text {
  margin-top: 4px;
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.875rem;
  line-height: 1.5;
}

.active-validation-phone,
.active-validation-target {
  color: rgba(var(--v-theme-on-surface), 0.88);
  font-weight: 700;
}

.active-validation-retry-alert {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  max-width: 640px;
  margin: -10px auto 22px;
  border: 1px solid rgba(var(--v-theme-error), 0.18);
  border-radius: 8px;
  padding: 11px 14px;
  background: rgba(var(--v-theme-error), 0.06);
  color: rgba(var(--v-theme-error), 1);
}

.active-validation-retry-title {
  font-size: 0.8125rem;
  font-weight: 700;
  line-height: 1.35;
}

.active-validation-retry-text {
  margin-top: 2px;
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.8125rem;
  line-height: 1.45;
}

.active-validation-status--waiting .active-validation-status-icon::after {
  position: absolute;
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
  border-radius: 8px;
  animation: active-validation-pulse 1.6s ease-in-out infinite;
  content: '';
  inset: 7px;
}

.active-validation-status--validated {
  border-color: rgba(var(--v-theme-success), 0.22);
  background:
    linear-gradient(
      135deg,
      rgba(var(--v-theme-success), 0.12),
      rgba(var(--v-theme-primary), 0.07)
    ),
    rgba(var(--v-theme-surface), 1);
  box-shadow: 0 14px 32px rgba(var(--v-theme-success), 0.1);
}

.active-validation-status--validated::before {
  background: rgba(var(--v-theme-success), 1);
}

.active-validation-status--validated .active-validation-status-icon {
  background: rgba(var(--v-theme-success), 0.12);
  box-shadow: inset 0 0 0 1px rgba(var(--v-theme-success), 0.18);
  color: rgba(var(--v-theme-success), 1);
}

.active-validation-status--validated .active-validation-status-title {
  color: rgba(var(--v-theme-success), 1);
}

.active-validation-status--rejected {
  border-color: rgba(var(--v-theme-error), 0.22);
  background:
    linear-gradient(
      135deg,
      rgba(var(--v-theme-error), 0.11),
      rgba(var(--v-theme-surface), 1)
    ),
    rgba(var(--v-theme-surface), 1);
  box-shadow: 0 14px 32px rgba(var(--v-theme-error), 0.09);
}

.active-validation-status--rejected::before {
  background: rgba(var(--v-theme-error), 1);
}

.active-validation-status--rejected .active-validation-status-icon {
  background: rgba(var(--v-theme-error), 0.11);
  box-shadow: inset 0 0 0 1px rgba(var(--v-theme-error), 0.18);
  color: rgba(var(--v-theme-error), 1);
}

.active-validation-status--rejected .active-validation-status-title {
  color: rgba(var(--v-theme-error), 1);
}

.active-validation-section + .active-validation-section {
  margin-top: 18px;
}

.active-validation-message {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  padding: 12px 14px;
  background: rgba(var(--v-theme-surface));
}

.active-validation-message code {
  white-space: normal;
  overflow-wrap: anywhere;
  color: rgba(var(--v-theme-primary), 1);
  font-size: 0.875rem;
  font-weight: 600;
}

.active-validation-url :deep(textarea) {
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
    monospace;
  font-size: 0.8125rem;
  line-height: 1.45;
}

@keyframes active-validation-pulse {
  0%,
  100% {
    opacity: 0.45;
    transform: scale(0.88);
  }

  50% {
    opacity: 1;
    transform: scale(1.08);
  }
}

@media (max-width: 600px) {
  .active-validation-status {
    flex-direction: column;
    padding: 18px;
    text-align: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .active-validation-status--waiting .active-validation-status-icon::after {
    animation: none;
  }
}
</style>
