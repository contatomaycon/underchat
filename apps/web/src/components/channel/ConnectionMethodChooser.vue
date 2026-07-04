<script setup lang="ts">
type ConnectionMethod = 'secure' | 'qrcode';

defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  select: [method: ConnectionMethod];
}>();
</script>

<template>
  <div class="connection-method-chooser">
    <div class="connection-method-heading">
      <p class="text-overline text-primary mb-1">
        {{ $t('connection_method_label') }}
      </p>
      <h3 class="text-h5 mb-2">
        {{ $t('connection_method_title') }}
      </h3>
      <p class="text-body-2 text-medium-emphasis mb-0">
        {{ $t('connection_method_description') }}
      </p>
    </div>

    <div class="connection-method-grid">
      <button
        class="connection-method-card connection-method-card--secure"
        type="button"
        :disabled="disabled"
        data-testid="connection-method-secure"
        @click="emit('select', 'secure')"
      >
        <span class="connection-method-icon">
          <VIcon icon="tabler-shield-lock" size="34" />
        </span>
        <span class="connection-method-content">
          <strong>{{ $t('secure_connection_title') }}</strong>
          <small>{{ $t('secure_connection_card_description') }}</small>
        </span>
        <VIcon icon="tabler-arrow-right" size="22" />
      </button>

      <button
        class="connection-method-card"
        type="button"
        :disabled="disabled"
        data-testid="connection-method-qrcode"
        @click="emit('select', 'qrcode')"
      >
        <span class="connection-method-icon">
          <VIcon icon="tabler-qrcode" size="34" />
        </span>
        <span class="connection-method-content">
          <strong>{{ $t('qrcode_connection_title') }}</strong>
          <small>{{ $t('qrcode_connection_card_description') }}</small>
        </span>
        <VIcon icon="tabler-arrow-right" size="22" />
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.connection-method-chooser {
  display: grid;
  gap: 24px;
  padding: 28px;
}

.connection-method-heading {
  max-inline-size: 560px;
}

.connection-method-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.connection-method-card {
  display: grid;
  min-block-size: 164px;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 16px;
  padding: 20px;
  border: 1px solid rgba(var(--v-border-color), 0.18);
  border-radius: 8px;
  background:
    linear-gradient(
      180deg,
      rgba(var(--v-theme-surface), 0.96),
      rgb(var(--v-theme-surface))
    ),
    rgb(var(--v-theme-surface));
  box-shadow: 0 12px 30px rgba(var(--v-theme-on-surface), 0.07);
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  letter-spacing: 0;
  text-align: start;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.connection-method-card:hover:not(:disabled),
.connection-method-card:focus-visible {
  border-color: rgba(var(--v-theme-primary), 0.45);
  box-shadow: 0 18px 38px rgba(var(--v-theme-primary), 0.14);
  transform: translateY(-1px);
}

.connection-method-card:disabled {
  cursor: wait;
  opacity: 0.7;
}

.connection-method-card--secure {
  border-color: rgba(var(--v-theme-success), 0.24);
}

.connection-method-icon {
  display: grid;
  inline-size: 58px;
  block-size: 58px;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}

.connection-method-card--secure .connection-method-icon {
  background: rgba(var(--v-theme-success), 0.12);
  color: rgb(var(--v-theme-success));
}

.connection-method-content {
  display: grid;
  gap: 6px;
}

.connection-method-content strong {
  font-size: 15px;
  line-height: 1.25;
}

.connection-method-content small {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 12px;
  line-height: 1.45;
}

@media (max-width: 680px) {
  .connection-method-chooser {
    padding: 22px;
  }

  .connection-method-grid {
    grid-template-columns: 1fr;
  }
}
</style>
