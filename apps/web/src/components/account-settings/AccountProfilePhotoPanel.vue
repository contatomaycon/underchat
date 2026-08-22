<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  photoSrc: string | null;
  hasPhoto: boolean;
  loading: boolean;
  hint: string;
}>();

const emit = defineEmits<{
  changePhoto: [];
  deletePhoto: [];
}>();

const { t } = useI18n();

const actionLabel = computed(() =>
  props.hasPhoto ? t('change_photo') : t('upload_new_photo')
);
</script>

<template>
  <aside class="account-profile-panel">
    <div class="account-profile-panel__surface">
      <button
        class="account-profile-panel__avatar-button"
        type="button"
        :aria-label="actionLabel"
        @click="emit('changePhoto')"
      >
        <VAvatar size="128" class="account-profile-panel__avatar">
          <VImg v-if="photoSrc" :src="photoSrc" alt="Avatar" cover />
          <VImg
            v-else
            src="/images/svg/avatar-default.svg"
            alt="Avatar"
            cover
          />
          <span class="account-profile-panel__avatar-overlay">
            <VIcon icon="tabler-camera" size="24" />
          </span>
        </VAvatar>
      </button>

      <div class="account-profile-panel__content">
        <div class="account-profile-panel__eyebrow">
          <VIcon icon="tabler-user-circle" size="18" />
          <span>{{ t('profile_details') }}</span>
        </div>
        <p class="account-profile-panel__hint">
          {{ hint }}
        </p>
      </div>

      <div class="account-profile-panel__actions">
        <VBtn
          class="account-profile-panel__action"
          color="primary"
          variant="flat"
          prepend-icon="tabler-camera-plus"
          @click="emit('changePhoto')"
        >
          {{ actionLabel }}
        </VBtn>
        <VBtn
          v-if="hasPhoto"
          class="account-profile-panel__action"
          color="error"
          variant="tonal"
          prepend-icon="tabler-trash"
          :loading="loading"
          @click="emit('deletePhoto')"
        >
          {{ t('delete') }}
        </VBtn>
      </div>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.account-profile-panel {
  position: sticky;
  top: 96px;
}

.account-profile-panel__surface {
  position: relative;
  overflow: hidden;
  padding: 24px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  background:
    linear-gradient(145deg, rgb(var(--v-theme-primary) / 0.1), transparent 42%),
    rgb(var(--v-theme-surface));
  box-shadow: 0 16px 42px -28px rgb(var(--v-theme-shadow-color) / 0.5);
}

.account-profile-panel__surface::before {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent,
    rgb(var(--v-theme-on-surface) / 0.04),
    transparent
  );
  content: '';
  pointer-events: none;
  transform: translateX(-45%);
}

.account-profile-panel__avatar-button {
  position: relative;
  display: block;
  padding: 0;
  border: 0;
  margin: 0 auto;
  background: transparent;
  cursor: pointer;
}

.account-profile-panel__avatar {
  border: 4px solid rgb(var(--v-theme-surface));
  box-shadow: 0 16px 36px -20px rgb(var(--v-theme-shadow-color) / 0.7);
}

.account-profile-panel__avatar-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 0.46);
  color: white;
  opacity: 0;
  transition: opacity 0.18s ease;
}

.account-profile-panel__avatar-button:hover
  .account-profile-panel__avatar-overlay,
.account-profile-panel__avatar-button:focus-visible
  .account-profile-panel__avatar-overlay {
  opacity: 1;
}

.account-profile-panel__content {
  position: relative;
  margin-block-start: 22px;
  text-align: center;
}

.account-profile-panel__eyebrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: rgba(var(--v-theme-on-surface), var(--v-high-emphasis-opacity));
  font-weight: 700;
}

.account-profile-panel__hint {
  max-width: 250px;
  margin: 10px auto 0;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  font-size: 0.875rem;
  line-height: 1.45;
}

.account-profile-panel__actions {
  position: relative;
  display: grid;
  gap: 10px;
  margin-block-start: 22px;
}

.account-profile-panel__action {
  min-width: 0;
}

@media (max-width: 1279px) {
  .account-profile-panel {
    position: static;
  }

  .account-profile-panel__surface {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 20px;
  }

  .account-profile-panel__avatar-button {
    margin: 0;
  }

  .account-profile-panel__content {
    margin-block-start: 0;
    text-align: start;
  }

  .account-profile-panel__hint {
    margin-inline: 0;
  }

  .account-profile-panel__actions {
    min-width: 180px;
    margin-block-start: 0;
  }
}

@media (max-width: 699px) {
  .account-profile-panel__surface {
    grid-template-columns: 1fr;
    justify-items: center;
    padding: 20px;
    text-align: center;
  }

  .account-profile-panel__content {
    text-align: center;
  }

  .account-profile-panel__hint {
    margin-inline: auto;
  }

  .account-profile-panel__actions {
    width: 100%;
  }
}
</style>
