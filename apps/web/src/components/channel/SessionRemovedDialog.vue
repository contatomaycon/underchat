<script setup lang="ts">
const isVisible = defineModel<boolean>({ required: true });

const emit = defineEmits<{
  (event: 'reconnect'): void;
}>();

const close = (): void => {
  isVisible.value = false;
};
</script>

<template>
  <VDialog
    v-model="isVisible"
    max-width="560"
    aria-labelledby="session-removed-title"
  >
    <DialogCloseBtn @click="close" />

    <VCard
      class="session-removed-card"
      data-testid="session-removed-dialog"
      rounded="xl"
    >
      <VCardText class="session-removed-content">
        <div class="session-removed-header">
          <div class="session-removed-icon" aria-hidden="true">
            <VIcon icon="tabler-plug-connected-x" color="success" size="36" />
          </div>

          <VChip
            class="session-removed-chip"
            color="success"
            size="small"
            variant="tonal"
          >
            <VIcon icon="tabler-circle-check-filled" size="14" start />
            {{ $t('session_removed_dialog_status') }}
          </VChip>
        </div>

        <div>
          <h3
            id="session-removed-title"
            class="text-h5 font-weight-bold mb-2"
            data-testid="session-removed-title"
          >
            {{ $t('session_removed_dialog_title') }}
          </h3>
          <p class="text-body-1 text-medium-emphasis mb-0">
            {{ $t('session_removed_dialog_description') }}
          </p>
        </div>

        <div class="session-removed-next-step">
          <VIcon icon="tabler-arrow-right" color="primary" size="20" />
          <div>
            <div class="text-caption font-weight-bold text-primary mb-1">
              {{ $t('session_removed_dialog_next_step_label') }}
            </div>
            <div class="text-body-2 text-medium-emphasis">
              {{ $t('session_removed_dialog_next_step') }}
            </div>
          </div>
        </div>
      </VCardText>

      <VCardActions class="session-removed-actions">
        <VBtn
          min-width="104"
          size="large"
          variant="text"
          data-testid="session-removed-close"
          @click="close"
        >
          {{ $t('session_removed_close') }}
        </VBtn>
        <VBtn
          color="primary"
          min-width="190"
          size="large"
          variant="elevated"
          data-testid="session-removed-reconnect"
          @click="emit('reconnect')"
        >
          <VIcon icon="tabler-plug-connected" start />
          {{ $t('session_removed_reconnect') }}
        </VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>

<style scoped>
.session-removed-card {
  overflow: hidden;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.session-removed-content {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 2rem 2rem 1.25rem;
}

.session-removed-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.session-removed-icon {
  display: grid;
  width: 4rem;
  height: 4rem;
  place-items: center;
  border: 1px solid rgba(var(--v-theme-success), 0.2);
  border-radius: 1rem;
  background: linear-gradient(
    145deg,
    rgba(var(--v-theme-success), 0.16),
    rgba(var(--v-theme-success), 0.06)
  );
  box-shadow: 0 10px 28px rgba(var(--v-theme-success), 0.12);
}

.session-removed-chip {
  font-weight: 600;
  letter-spacing: 0.01em;
}

.session-removed-next-step {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  padding: 1rem;
  border: 1px solid rgba(var(--v-theme-primary), 0.14);
  border-radius: 0.875rem;
  background: rgba(var(--v-theme-primary), 0.055);
}

.session-removed-actions {
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 0.5rem 2rem 2rem;
}

@media (max-width: 480px) {
  .session-removed-content {
    padding: 1.5rem 1.25rem 1rem;
  }

  .session-removed-actions {
    align-items: stretch;
    flex-direction: column-reverse;
    padding: 0.5rem 1.25rem 1.5rem;
  }

  .session-removed-actions :deep(.v-btn) {
    width: 100%;
  }
}
</style>
