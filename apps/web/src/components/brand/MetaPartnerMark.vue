<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import metaLockupUrl from '@images/brand/meta-lockup-positive-primary.svg?url';

type MetaPartnerVariant = 'dashboard' | 'footer';

const props = withDefaults(
  defineProps<{
    variant?: MetaPartnerVariant;
  }>(),
  {
    variant: 'dashboard',
  }
);

const { t } = useI18n();

const rootClasses = computed(() => [
  'meta-partner-mark',
  `meta-partner-mark--${props.variant}`,
]);
</script>

<template>
  <section v-if="props.variant === 'dashboard'" :class="rootClasses">
    <div class="meta-partner-mark__content">
      <div class="meta-partner-mark__eyebrow">
        <span class="meta-partner-mark__status-dot" aria-hidden="true" />
        <span>{{ t('dashboard_meta_partner_chip_api') }}</span>
      </div>

      <h2 class="meta-partner-mark__title">
        {{ t('meta_partner_label') }}
      </h2>

      <p class="meta-partner-mark__description">
        {{ t('dashboard_meta_partner_description') }}
      </p>

      <div class="meta-partner-mark__chips">
        <span class="meta-partner-mark__chip">
          {{ t('dashboard_meta_partner_chip_connection') }}
        </span>
        <span class="meta-partner-mark__chip">
          {{ t('dashboard_meta_partner_chip_compliance') }}
        </span>
      </div>
    </div>

    <div class="meta-partner-mark__logo-shell">
      <img
        class="meta-partner-mark__logo"
        :src="metaLockupUrl"
        :alt="t('meta_partner_logo_alt')"
      />
    </div>
  </section>

  <div v-else :class="rootClasses">
    <span class="meta-partner-mark__footer-label">
      {{ t('meta_partner_label') }}
    </span>
    <span class="meta-partner-mark__footer-logo-shell">
      <img
        class="meta-partner-mark__footer-logo"
        :src="metaLockupUrl"
        :alt="t('meta_partner_logo_alt')"
      />
    </span>
  </div>
</template>

<style scoped lang="scss">
.meta-partner-mark {
  box-sizing: border-box;
}

.meta-partner-mark--dashboard {
  position: relative;
  display: flex;
  overflow: hidden;
  align-items: stretch;
  justify-content: space-between;
  inline-size: 100%;
  min-block-size: 100%;
  padding: 22px 24px;
  border: 1px solid rgba(var(--v-theme-primary), 0.18);
  border-radius: 8px;
  background:
    linear-gradient(
      120deg,
      rgba(var(--v-theme-primary), 0.08),
      rgba(var(--v-theme-success), 0.05) 52%,
      rgba(var(--v-theme-surface), 1)
    ),
    rgba(var(--v-theme-surface), 1);
  box-shadow: 0 12px 32px rgba(var(--v-theme-on-surface), 0.06);
  flex-direction: column;
  gap: 16px;
}

.meta-partner-mark--dashboard::before {
  position: absolute;
  border-block-start: 1px solid rgba(0, 149, 246, 0.16);
  content: '';
  inset: 18px 22px auto;
}

.meta-partner-mark__content {
  position: relative;
  z-index: 1;
  max-width: none;
}

.meta-partner-mark__eyebrow {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border: 1px solid rgba(var(--v-theme-success), 0.18);
  border-radius: 999px;
  margin-block-end: 8px;
  background: rgba(var(--v-theme-success), 0.09);
  color: rgb(var(--v-theme-success));
  font-size: 0.8125rem;
  font-weight: 600;
  gap: 8px;
  letter-spacing: 0;
}

.meta-partner-mark__status-dot {
  display: block;
  border-radius: 999px;
  background: currentcolor;
  block-size: 8px;
  box-shadow: 0 0 0 4px rgba(var(--v-theme-success), 0.14);
  inline-size: 8px;
}

.meta-partner-mark__title {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.92);
  font-size: clamp(1.25rem, 1.25vw, 1.4375rem);
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.12;
}

.meta-partner-mark__description {
  max-width: 34rem;
  margin: 8px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.9375rem;
  line-height: 1.4;
}

.meta-partner-mark__chips {
  display: flex;
  flex-wrap: wrap;
  margin-block-start: 12px;
  gap: 10px;
}

.meta-partner-mark__chip {
  display: inline-flex;
  align-items: center;
  min-block-size: 32px;
  padding: 6px 12px;
  border: 1px solid rgba(var(--v-theme-primary), 0.14);
  border-radius: 999px;
  background: rgba(var(--v-theme-surface), 0.74);
  color: rgba(var(--v-theme-on-surface), 0.74);
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0;
}

.meta-partner-mark__logo-shell {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-block-size: 72px;
  min-inline-size: 0;
  padding: 14px 18px;
  border: 1px solid rgba(17, 24, 39, 0.08);
  border-radius: 8px;
  background: #fff;
  box-shadow:
    0 14px 28px rgba(17, 24, 39, 0.07),
    inset 0 0 0 1px rgba(255, 255, 255, 0.7);
}

.meta-partner-mark__logo {
  display: block;
  block-size: auto;
  inline-size: min(160px, 64vw);
}

.meta-partner-mark--footer {
  display: inline-flex;
  align-items: center;
  min-block-size: 34px;
  padding: 4px 6px 4px 10px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 8px;
  background: rgba(var(--v-theme-surface), 0.82);
  color: rgba(var(--v-theme-on-surface), 0.68);
  gap: 8px;
}

.meta-partner-mark__footer-label {
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0;
  white-space: nowrap;
}

.meta-partner-mark__footer-logo-shell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 8px;
  border-radius: 6px;
  background: #fff;
}

.meta-partner-mark__footer-logo {
  display: block;
  block-size: auto;
  inline-size: 78px;
}

@media (max-width: 900px) {
  .meta-partner-mark--dashboard {
    padding: 24px;
  }

  .meta-partner-mark__logo-shell {
    min-block-size: 82px;
  }
}

@media (max-width: 600px) {
  .meta-partner-mark--dashboard {
    padding: 20px;
  }

  .meta-partner-mark--dashboard::before {
    inset-inline: 18px;
  }

  .meta-partner-mark__logo-shell {
    padding: 24px;
  }

  .meta-partner-mark__logo {
    inline-size: min(210px, 70vw);
  }
}
</style>
