<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  CONTACT_VALIDATION_STATUSES,
  type ContactValidationStatus,
} from '@core/common/types/ContactValidationStatus';

interface Props {
  validationStatus?: ContactValidationStatus | null;
  isValidated?: boolean | null;
  compact?: boolean;
  iconOnly?: boolean;
}

interface StatusPresentation {
  icon: string;
  labelKey: string;
  descriptionKey: string;
}

const props = withDefaults(defineProps<Props>(), {
  validationStatus: null,
  isValidated: false,
  compact: false,
  iconOnly: false,
});

const { t } = useI18n();

const normalizedStatus = computed<ContactValidationStatus>(() => {
  if (props.validationStatus) return props.validationStatus;

  return props.isValidated
    ? CONTACT_VALIDATION_STATUSES.validated
    : CONTACT_VALIDATION_STATUSES.notValidated;
});

const presentations: Record<ContactValidationStatus, StatusPresentation> = {
  [CONTACT_VALIDATION_STATUSES.validated]: {
    icon: 'tabler-shield-check',
    labelKey: 'contact_validation_badge_validated',
    descriptionKey: 'contact_validation_badge_validated_description',
  },
  [CONTACT_VALIDATION_STATUSES.officialOnly]: {
    icon: 'tabler-brand-whatsapp',
    labelKey: 'contact_validation_badge_official_only',
    descriptionKey: 'contact_validation_badge_official_only_description',
  },
  [CONTACT_VALIDATION_STATUSES.notValidated]: {
    icon: 'tabler-alert-circle',
    labelKey: 'contact_validation_badge_not_validated',
    descriptionKey: 'contact_validation_badge_not_validated_description',
  },
};

const presentation = computed(() => presentations[normalizedStatus.value]);
const label = computed(() => t(presentation.value.labelKey));
const description = computed(() => t(presentation.value.descriptionKey));
const accessibleLabel = computed(() => `${label.value}. ${description.value}`);
</script>

<template>
  <VTooltip location="top" :max-width="320" open-delay="180">
    <template #activator="{ props: tooltipProps }">
      <span
        v-bind="tooltipProps"
        class="contact-validation-badge"
        :class="[
          `contact-validation-badge--${normalizedStatus}`,
          {
            'contact-validation-badge--compact': compact,
            'contact-validation-badge--icon-only': iconOnly,
          },
        ]"
        role="img"
        tabindex="0"
        :aria-label="accessibleLabel"
      >
        <span class="contact-validation-badge__icon">
          <VIcon :icon="presentation.icon" />
        </span>
        <span v-if="!iconOnly" class="contact-validation-badge__label">
          {{ label }}
        </span>
      </span>
    </template>

    <div class="contact-validation-tooltip">
      <div class="contact-validation-tooltip__title">{{ label }}</div>
      <div class="contact-validation-tooltip__description">
        {{ description }}
      </div>
    </div>
  </VTooltip>
</template>

<style scoped lang="scss">
.contact-validation-badge {
  --validation-color: 82, 92, 112;
  --validation-ink: #495468;

  position: relative;
  isolation: isolate;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-block-size: 30px;
  padding: 5px 10px 5px 6px;
  overflow: hidden;
  color: var(--validation-ink);
  font-size: 0.75rem;
  font-weight: 650;
  line-height: 1;
  letter-spacing: 0.01em;
  white-space: nowrap;
  cursor: help;
  background:
    linear-gradient(
      135deg,
      rgba(var(--validation-color), 0.16),
      rgba(var(--validation-color), 0.07)
    ),
    rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--validation-color), 0.24);
  border-radius: 9px;
  box-shadow:
    0 1px 1px rgba(15, 23, 42, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.5);
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;
}

.contact-validation-badge::after {
  position: absolute;
  z-index: -1;
  inset: 0 auto 0 0;
  inline-size: 3px;
  content: '';
  background: rgb(var(--validation-color));
  opacity: 0.8;
}

.contact-validation-badge:hover,
.contact-validation-badge:focus-visible {
  border-color: rgba(var(--validation-color), 0.42);
  box-shadow:
    0 4px 14px rgba(var(--validation-color), 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.58);
  transform: translateY(-1px);
}

.contact-validation-badge:focus-visible {
  outline: 2px solid rgba(var(--validation-color), 0.35);
  outline-offset: 2px;
}

.contact-validation-badge--validated {
  --validation-color: 22, 163, 108;
  --validation-ink: #087a50;
}

.contact-validation-badge--official_only {
  --validation-color: 11, 139, 147;
  --validation-ink: #08747b;
}

.contact-validation-badge--not_validated {
  --validation-color: 187, 126, 25;
  --validation-ink: #94630d;
}

.contact-validation-badge--compact {
  min-block-size: 25px;
  gap: 5px;
  padding: 3px 8px 3px 4px;
  font-size: 0.6875rem;
  border-radius: 7px;
}

.contact-validation-badge--icon-only {
  justify-content: center;
  inline-size: 27px;
  min-inline-size: 27px;
  block-size: 27px;
  min-block-size: 27px;
  padding: 0;
  border-radius: 8px;
}

.contact-validation-badge__icon {
  display: inline-grid;
  place-items: center;
  inline-size: 19px;
  block-size: 19px;
  color: rgb(var(--validation-color));
  background: rgba(var(--validation-color), 0.12);
  border-radius: 6px;
}

.contact-validation-badge__icon :deep(.v-icon) {
  font-size: 14px;
}

.contact-validation-badge--compact .contact-validation-badge__icon,
.contact-validation-badge--icon-only .contact-validation-badge__icon {
  inline-size: 17px;
  block-size: 17px;
  border-radius: 5px;
}

.contact-validation-badge--icon-only::after {
  inline-size: 2px;
}

.contact-validation-badge__label {
  transform: translateY(0.25px);
}

.contact-validation-tooltip {
  padding: 3px 2px;
}

.contact-validation-tooltip__title {
  margin-block-end: 3px;
  font-size: 0.8125rem;
  font-weight: 700;
}

.contact-validation-tooltip__description {
  color: rgba(255, 255, 255, 0.82);
  font-size: 0.75rem;
  line-height: 1.45;
}

:global(.v-theme--dark) .contact-validation-badge {
  --validation-ink: rgba(255, 255, 255, 0.88);

  box-shadow:
    0 1px 1px rgba(0, 0, 0, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

@media (prefers-reduced-motion: reduce) {
  .contact-validation-badge {
    transition: none;
  }
}
</style>
