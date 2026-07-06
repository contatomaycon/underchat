<script setup lang="ts">
import { computed, shallowRef } from 'vue';

type AuthenticatorPlatform = 'linux' | 'macos' | 'windows';

defineProps<{
  disabled?: boolean;
  downloading?: boolean;
}>();

const emit = defineEmits<{
  back: [];
  cancel: [];
  continue: [];
  download: [platform: AuthenticatorPlatform];
}>();

const selectedPlatform = shallowRef<AuthenticatorPlatform | null>(null);

const platforms: {
  descriptionKey: string;
  icon: string;
  labelKey: string;
  value: AuthenticatorPlatform;
}[] = [
  {
    descriptionKey: 'authenticator_install_linux_description',
    icon: 'tabler-brand-ubuntu',
    labelKey: 'authenticator_install_linux',
    value: 'linux',
  },
  {
    descriptionKey: 'authenticator_install_macos_description',
    icon: 'tabler-brand-apple',
    labelKey: 'authenticator_install_macos',
    value: 'macos',
  },
  {
    descriptionKey: 'authenticator_install_windows_description',
    icon: 'tabler-brand-windows',
    labelKey: 'authenticator_install_windows',
    value: 'windows',
  },
];

const selectedPlatformMeta = computed(() =>
  platforms.find((platform) => platform.value === selectedPlatform.value)
);
</script>

<template>
  <div class="authenticator-install-panel">
    <div class="authenticator-install-heading">
      <p class="text-overline text-primary mb-1">
        {{ $t('authenticator_install_label') }}
      </p>
      <h3 class="text-h5 mb-2">
        {{ $t('authenticator_install_title') }}
      </h3>
      <p class="text-body-2 text-medium-emphasis mb-0">
        {{ $t('authenticator_install_description') }}
      </p>
    </div>

    <div class="authenticator-platform-grid">
      <button
        v-for="platform in platforms"
        :key="platform.value"
        class="authenticator-platform-card"
        :class="{
          'authenticator-platform-card--selected':
            selectedPlatform === platform.value,
        }"
        type="button"
        :disabled="disabled || downloading"
        @click="selectedPlatform = platform.value"
      >
        <span class="authenticator-platform-icon">
          <VIcon :icon="platform.icon" size="34" />
        </span>
        <span class="authenticator-platform-content">
          <strong>{{ $t(platform.labelKey) }}</strong>
          <small>{{ $t(platform.descriptionKey) }}</small>
        </span>
        <VIcon
          :icon="
            selectedPlatform === platform.value
              ? 'tabler-circle-check-filled'
              : 'tabler-circle'
          "
          size="22"
        />
      </button>
    </div>

    <div
      v-if="selectedPlatformMeta"
      class="authenticator-download-band"
      data-testid="authenticator-download-band"
    >
      <div class="authenticator-download-copy">
        <strong>{{ $t('authenticator_install_download_title') }}</strong>
        <span>{{ $t('authenticator_install_download_description') }}</span>
      </div>
      <VBtn
        color="primary"
        variant="tonal"
        :loading="downloading"
        :disabled="disabled || downloading"
        data-testid="authenticator-download"
        @click="emit('download', selectedPlatformMeta.value)"
      >
        <VIcon icon="tabler-download" start />
        {{ $t('authenticator_install_download_action') }}
      </VBtn>
    </div>

    <div class="authenticator-install-actions">
      <VBtn variant="tonal" color="secondary" @click="emit('back')">
        <VIcon icon="tabler-arrow-left" start />
        {{ $t('back') }}
      </VBtn>

      <VBtn
        variant="tonal"
        color="error"
        :disabled="disabled || downloading"
        @click="emit('cancel')"
      >
        <VIcon icon="tabler-x" start />
        {{ $t('cancel') }}
      </VBtn>

      <VBtn
        color="primary"
        :disabled="!selectedPlatform || disabled || downloading"
        @click="emit('continue')"
      >
        <VIcon icon="tabler-player-play" start />
        {{ $t('authenticator_install_continue') }}
      </VBtn>
    </div>
  </div>
</template>

<style scoped lang="scss">
.authenticator-install-panel {
  display: grid;
  gap: 22px;
  padding: 28px;
}

.authenticator-install-heading {
  max-inline-size: 620px;
}

.authenticator-platform-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
}

.authenticator-platform-card {
  display: grid;
  min-block-size: 138px;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 15px;
  padding: 18px;
  border: 1px solid rgba(var(--v-border-color), 0.18);
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  letter-spacing: 0;
  text-align: start;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.authenticator-platform-card:hover:not(:disabled),
.authenticator-platform-card:focus-visible,
.authenticator-platform-card--selected {
  border-color: rgba(var(--v-theme-primary), 0.46);
  box-shadow: 0 16px 34px rgba(var(--v-theme-primary), 0.13);
  transform: translateY(-1px);
}

.authenticator-platform-card:disabled {
  cursor: wait;
  opacity: 0.72;
}

.authenticator-platform-icon {
  display: grid;
  inline-size: 58px;
  block-size: 58px;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}

.authenticator-platform-content {
  display: grid;
  gap: 6px;
}

.authenticator-platform-content strong {
  font-size: 15px;
  line-height: 1.25;
}

.authenticator-platform-content small,
.authenticator-download-copy span {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 12px;
  line-height: 1.45;
}

.authenticator-download-band {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px;
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.06);
}

.authenticator-download-copy {
  display: grid;
  gap: 4px;
  min-inline-size: 0;
}

.authenticator-install-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

@media (max-width: 680px) {
  .authenticator-install-panel {
    padding: 22px;
  }

  .authenticator-platform-grid {
    grid-template-columns: 1fr;
  }

  .authenticator-download-band {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
