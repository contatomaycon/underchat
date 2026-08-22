<script setup lang="ts">
import { computed } from 'vue';

type ConnectionMethod = 'chrome_extension' | 'secure' | 'qrcode';

type ConnectionMethodOption = {
  badgeKey: string;
  descriptionKey: string;
  icon: string;
  testId: string;
  titleKey: string;
  tone: 'chrome' | 'primary' | 'secure';
  value: ConnectionMethod;
};

const props = defineProps<{
  disabled?: boolean;
  showChromeExtension?: boolean;
}>();

const emit = defineEmits<{
  select: [method: ConnectionMethod];
}>();

const connectionMethods = computed<ConnectionMethodOption[]>(() => {
  const methods: ConnectionMethodOption[] = [
    {
      badgeKey: 'connection_method_authenticator_badge',
      descriptionKey: 'secure_connection_card_description',
      icon: 'tabler-shield-lock',
      testId: 'connection-method-secure',
      titleKey: 'secure_connection_title',
      tone: 'secure',
      value: 'secure',
    },
    {
      badgeKey: 'connection_method_recommended_badge',
      descriptionKey: 'chrome_extension_connection_card_description',
      icon: 'tabler-brand-chrome',
      testId: 'connection-method-chrome-extension',
      titleKey: 'chrome_extension_connection_title',
      tone: 'chrome',
      value: 'chrome_extension',
    },
    {
      badgeKey: 'connection_method_qrcode_badge',
      descriptionKey: 'qrcode_connection_card_description',
      icon: 'tabler-qrcode',
      testId: 'connection-method-qrcode',
      titleKey: 'qrcode_connection_title',
      tone: 'primary',
      value: 'qrcode',
    },
  ];

  return props.showChromeExtension
    ? methods
    : methods.filter((method) => method.value !== 'chrome_extension');
});
</script>

<template>
  <div class="connection-method-chooser">
    <div class="connection-method-heading">
      <p class="connection-method-eyebrow">
        <span class="connection-method-eyebrow-dot" />
        {{ $t('connection_method_label') }}
      </p>
      <h3 class="connection-method-title">
        {{ $t('connection_method_title') }}
      </h3>
      <p class="connection-method-description">
        {{ $t('connection_method_description') }}
      </p>
    </div>

    <div class="connection-method-grid">
      <button
        v-for="method in connectionMethods"
        :key="method.value"
        class="connection-method-card"
        :data-tone="method.tone"
        type="button"
        :disabled="disabled"
        :data-testid="method.testId"
        @click="emit('select', method.value)"
      >
        <span class="connection-method-card-header">
          <span class="connection-method-icon">
            <VIcon :icon="method.icon" size="30" />
          </span>
          <span class="connection-method-badge">
            {{ $t(method.badgeKey) }}
          </span>
        </span>
        <span class="connection-method-content">
          <strong>{{ $t(method.titleKey) }}</strong>
          <small>{{ $t(method.descriptionKey) }}</small>
        </span>
        <span class="connection-method-footer">
          <span>{{ $t('connection_method_card_action') }}</span>
          <span class="connection-method-arrow">
            <VIcon icon="tabler-arrow-right" size="18" />
          </span>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.connection-method-chooser {
  display: grid;
  gap: 26px;
  padding: 32px;
  background:
    linear-gradient(
      135deg,
      rgba(var(--v-theme-primary), 0.08),
      transparent 34%
    ),
    linear-gradient(
      180deg,
      rgba(var(--v-theme-surface), 0.98),
      rgb(var(--v-theme-surface))
    );
}

.connection-method-heading {
  display: grid;
  max-inline-size: 680px;
  gap: 8px;
}

.connection-method-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: rgb(var(--v-theme-primary));
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.2;
}

.connection-method-eyebrow-dot {
  display: inline-block;
  inline-size: 8px;
  block-size: 8px;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 6px rgba(var(--v-theme-primary), 0.1);
}

.connection-method-title {
  margin: 0;
  color: rgb(var(--v-theme-on-surface));
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.25;
}

.connection-method-description {
  max-inline-size: 620px;
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 14px;
  line-height: 1.6;
}

.connection-method-grid {
  display: grid;
  grid-auto-rows: 1fr;
  grid-template-columns: repeat(auto-fit, minmax(238px, 1fr));
  gap: 16px;
}

.connection-method-card {
  --connection-method-rgb: var(--v-theme-primary);

  position: relative;
  display: grid;
  min-block-size: 236px;
  align-content: space-between;
  gap: 18px;
  overflow: hidden;
  padding: 20px;
  border: 1px solid rgba(var(--v-border-color), 0.18);
  border-radius: 8px;
  background:
    linear-gradient(
      145deg,
      rgba(var(--connection-method-rgb), 0.08),
      transparent 42%
    ),
    linear-gradient(
      180deg,
      rgba(var(--v-theme-surface), 0.98),
      rgb(var(--v-theme-surface))
    ),
    rgb(var(--v-theme-surface));
  box-shadow: 0 18px 44px rgba(var(--v-theme-on-surface), 0.08);
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  letter-spacing: 0;
  text-align: start;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.connection-method-card::before {
  position: absolute;
  inset-block-start: 0;
  inset-inline: 0;
  block-size: 3px;
  background: rgb(var(--connection-method-rgb));
  content: '';
}

.connection-method-card[data-tone='secure'] {
  --connection-method-rgb: var(--v-theme-success);

  border-color: rgba(var(--v-theme-success), 0.26);
}

.connection-method-card[data-tone='chrome'] {
  --connection-method-rgb: var(--v-theme-warning);

  border-color: rgba(var(--v-theme-warning), 0.28);
}

.connection-method-card:hover:not(:disabled),
.connection-method-card:focus-visible {
  border-color: rgba(var(--connection-method-rgb), 0.48);
  box-shadow: 0 22px 52px rgba(var(--connection-method-rgb), 0.18);
  outline: none;
  transform: translateY(-2px);
}

.connection-method-card:disabled {
  cursor: wait;
  opacity: 0.68;
}

.connection-method-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.connection-method-icon {
  display: grid;
  inline-size: 56px;
  block-size: 56px;
  place-items: center;
  border-radius: 8px;
  background:
    linear-gradient(
      145deg,
      rgba(var(--connection-method-rgb), 0.18),
      rgba(var(--connection-method-rgb), 0.07)
    ),
    rgb(var(--v-theme-surface));
  color: rgb(var(--connection-method-rgb));
}

.connection-method-badge {
  max-inline-size: 132px;
  padding: 6px 10px;
  border: 1px solid rgba(var(--connection-method-rgb), 0.22);
  border-radius: 999px;
  background: rgba(var(--connection-method-rgb), 0.08);
  color: rgb(var(--connection-method-rgb));
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
}

.connection-method-content {
  display: grid;
  gap: 8px;
}

.connection-method-content strong {
  color: rgb(var(--v-theme-on-surface));
  font-size: 17px;
  font-weight: 700;
  line-height: 1.28;
}

.connection-method-content small {
  color: rgba(var(--v-theme-on-surface), 0.64);
  font-size: 13px;
  line-height: 1.55;
}

.connection-method-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: rgb(var(--connection-method-rgb));
  font-size: 13px;
  font-weight: 700;
}

.connection-method-arrow {
  display: grid;
  flex: 0 0 auto;
  inline-size: 34px;
  block-size: 34px;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--connection-method-rgb), 0.1);
  transition:
    background 0.18s ease,
    transform 0.18s ease;
}

.connection-method-card:hover:not(:disabled) .connection-method-arrow,
.connection-method-card:focus-visible .connection-method-arrow {
  background: rgba(var(--connection-method-rgb), 0.16);
  transform: translateX(2px);
}

@media (max-width: 680px) {
  .connection-method-chooser {
    gap: 22px;
    padding: 24px;
  }

  .connection-method-grid {
    grid-template-columns: 1fr;
  }

  .connection-method-card {
    min-block-size: 208px;
  }
}

@media (max-width: 420px) {
  .connection-method-chooser {
    padding: 20px;
  }

  .connection-method-title {
    font-size: 21px;
  }

  .connection-method-card {
    padding: 18px;
  }
}
</style>
