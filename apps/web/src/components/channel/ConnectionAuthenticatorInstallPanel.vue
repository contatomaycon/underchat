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

function detectAuthenticatorPlatform(): AuthenticatorPlatform | null {
  const platform = globalThis.navigator?.platform?.toLowerCase() ?? '';
  const userAgent = globalThis.navigator?.userAgent?.toLowerCase() ?? '';
  const source = `${platform} ${userAgent}`;

  if (source.includes('win')) return 'windows';
  if (source.includes('mac')) return 'macos';
  if (source.includes('linux') || source.includes('x11')) return 'linux';

  return null;
}

const selectedPlatform = shallowRef<AuthenticatorPlatform | null>(
  detectAuthenticatorPlatform()
);

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
      <div class="authenticator-install-mark">
        <VIcon icon="tabler-shield-lock" size="28" />
      </div>
      <div class="authenticator-install-copy">
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
        <span class="authenticator-platform-check">
          <VIcon
            :icon="
              selectedPlatform === platform.value
                ? 'tabler-circle-check-filled'
                : 'tabler-circle'
            "
            size="22"
          />
        </span>

        <span class="authenticator-platform-icon">
          <VIcon :icon="platform.icon" size="32" />
        </span>

        <span class="authenticator-platform-content">
          <strong>{{ $t(platform.labelKey) }}</strong>
          <small>{{ $t(platform.descriptionKey) }}</small>
        </span>
      </button>
    </div>

    <div
      v-if="selectedPlatformMeta"
      class="authenticator-download-band"
      data-testid="authenticator-download-band"
    >
      <div class="authenticator-download-icon">
        <VIcon :icon="selectedPlatformMeta.icon" size="26" />
      </div>
      <div class="authenticator-download-copy">
        <strong>{{ $t('authenticator_install_download_title') }}</strong>
        <span>{{ $t('authenticator_install_download_description') }}</span>
      </div>
      <VBtn
        color="primary"
        variant="flat"
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
      <div class="authenticator-install-secondary-actions">
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
      </div>

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
  gap: 24px;
  padding: 30px;
}

.authenticator-install-heading {
  display: grid;
  max-inline-size: 680px;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 16px;
}

.authenticator-install-mark {
  display: grid;
  block-size: 58px;
  inline-size: 58px;
  place-items: center;
  border: 1px solid rgba(var(--v-theme-primary), 0.18);
  border-radius: 8px;
  background:
    linear-gradient(
      145deg,
      rgba(var(--v-theme-primary), 0.14),
      rgba(var(--v-theme-primary), 0.04)
    ),
    rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-primary));
}

.authenticator-install-copy {
  min-inline-size: 0;
}

.authenticator-platform-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.authenticator-platform-card {
  position: relative;
  display: grid;
  min-block-size: 178px;
  align-content: start;
  gap: 13px;
  padding: 18px 18px 17px;
  border: 1px solid rgba(var(--v-border-color), 0.2);
  border-radius: 8px;
  background:
    linear-gradient(
      180deg,
      rgba(var(--v-theme-surface), 0.98),
      rgba(var(--v-theme-on-surface), 0.018)
    ),
    rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  letter-spacing: 0;
  text-align: start;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.authenticator-platform-card:hover:not(:disabled),
.authenticator-platform-card:focus-visible,
.authenticator-platform-card--selected {
  border-color: rgba(var(--v-theme-primary), 0.5);
  box-shadow: 0 18px 42px rgba(var(--v-theme-primary), 0.14);
  transform: translateY(-1px);
}

.authenticator-platform-card--selected {
  background:
    linear-gradient(
      180deg,
      rgba(var(--v-theme-primary), 0.085),
      rgba(var(--v-theme-primary), 0.025)
    ),
    rgb(var(--v-theme-surface));
}

.authenticator-platform-card:disabled {
  cursor: wait;
  opacity: 0.72;
}

.authenticator-platform-check {
  position: absolute;
  inset-block-start: 14px;
  inset-inline-end: 14px;
  color: rgba(var(--v-theme-on-surface), 0.42);
}

.authenticator-platform-card--selected .authenticator-platform-check {
  color: rgb(var(--v-theme-primary));
}

.authenticator-platform-icon {
  display: grid;
  inline-size: 54px;
  block-size: 54px;
  place-items: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}

.authenticator-platform-content {
  display: grid;
  gap: 7px;
  padding-inline-end: 8px;
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
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 15px;
  padding: 15px;
  border: 1px solid rgba(var(--v-theme-primary), 0.24);
  border-radius: 8px;
  background:
    linear-gradient(
      90deg,
      rgba(var(--v-theme-primary), 0.1),
      rgba(var(--v-theme-primary), 0.035)
    ),
    rgb(var(--v-theme-surface));
}

.authenticator-download-icon {
  display: grid;
  block-size: 44px;
  inline-size: 44px;
  place-items: center;
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-primary));
  box-shadow: inset 0 0 0 1px rgba(var(--v-theme-primary), 0.16);
}

.authenticator-download-copy {
  display: grid;
  gap: 4px;
  min-inline-size: 0;
}

.authenticator-install-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
}

.authenticator-install-secondary-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

@media (max-width: 680px) {
  .authenticator-install-panel {
    padding: 22px;
  }

  .authenticator-install-heading {
    grid-template-columns: 1fr;
  }

  .authenticator-platform-grid {
    grid-template-columns: 1fr;
  }

  .authenticator-download-band {
    grid-template-columns: auto 1fr;
  }

  .authenticator-download-band :deep(.v-btn) {
    grid-column: 1 / -1;
    justify-self: stretch;
  }

  .authenticator-install-actions,
  .authenticator-install-secondary-actions {
    align-items: stretch;
    flex-direction: column-reverse;
  }

  .authenticator-install-actions :deep(.v-btn),
  .authenticator-install-secondary-actions :deep(.v-btn) {
    inline-size: 100%;
  }
}
</style>
