<script setup lang="ts">
import { computed } from 'vue';
import { EWorkerConnectionStrategy } from '@core/common/enums/EWorkerConnectionStrategy';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    loading?: boolean;
    mode?: 'migration' | 'recreate';
    standardAppearance?: boolean;
  }>(),
  {
    loading: false,
    mode: 'migration',
    standardAppearance: false,
  }
);

const emit = defineEmits<{
  (event: 'update:modelValue', visible: boolean): void;
  (event: 'select', strategy: EWorkerConnectionStrategy): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (visible) => emit('update:modelValue', visible),
});

const presentation = computed(() => {
  if (props.mode === 'recreate') {
    return {
      dialogTestId: 'channel-recreate-strategy-dialog',
      preserveTestId: 'channel-recreate-strategy-preserve',
      icon: 'tabler-refresh',
      eyebrow: 'channel_recreate_strategy_eyebrow',
      title: 'channel_recreate_strategy_title',
      description: 'channel_recreate_strategy_description',
      freshBadge: 'channel_recreate_strategy_fresh_badge',
      freshTitle: 'channel_recreate_strategy_fresh_title',
      freshDescription: 'channel_recreate_strategy_fresh_description',
      freshWarning: 'channel_recreate_strategy_fresh_warning',
      preserveBadge: 'channel_recreate_strategy_preserve_badge',
      preserveTitle: 'channel_recreate_strategy_preserve_title',
      preserveDescription: 'channel_recreate_strategy_preserve_description',
      preserveNote: 'channel_recreate_strategy_preserve_note',
      footer: 'channel_recreate_strategy_footer_note',
    } as const;
  }

  return {
    dialogTestId: 'connection-strategy-dialog',
    preserveTestId: 'connection-strategy-migrate',
    icon: 'tabler-arrows-right-left',
    eyebrow: 'channel_connection_strategy_eyebrow',
    title: 'channel_connection_strategy_title',
    description: 'channel_connection_strategy_description',
    freshBadge: 'channel_connection_strategy_fresh_badge',
    freshTitle: 'channel_connection_strategy_fresh_title',
    freshDescription: 'channel_connection_strategy_fresh_description',
    freshWarning: 'channel_connection_strategy_fresh_warning',
    preserveBadge: 'channel_connection_strategy_migrate_badge',
    preserveTitle: 'channel_connection_strategy_migrate_title',
    preserveDescription: 'channel_connection_strategy_migrate_description',
    preserveNote: 'channel_connection_strategy_migrate_note',
    footer: 'channel_connection_strategy_footer_note',
  } as const;
});
</script>

<template>
  <VDialog v-model="isVisible" :persistent="loading" max-width="760">
    <DialogCloseBtn v-if="!loading" @click="isVisible = false" />

    <VCard
      :class="[
        'connection-strategy-dialog',
        { 'connection-strategy-dialog--standard': standardAppearance },
      ]"
      :data-testid="presentation.dialogTestId"
    >
      <VCardText class="connection-strategy-dialog__body">
        <div class="connection-strategy-dialog__hero">
          <div class="connection-strategy-dialog__icon">
            <VIcon :icon="presentation.icon" size="30" />
          </div>
          <div class="connection-strategy-dialog__hero-copy">
            <p class="connection-strategy-dialog__eyebrow">
              <span />
              {{ $t(presentation.eyebrow) }}
            </p>
            <h2>
              {{ $t(presentation.title) }}
            </h2>
            <p>
              {{ $t(presentation.description) }}
            </p>
          </div>
        </div>

        <VRow class="connection-strategy-dialog__options">
          <VCol cols="12" md="6" class="d-flex">
            <VCard
              variant="outlined"
              class="connection-strategy-option connection-strategy-option--fresh h-100"
              data-testid="connection-strategy-fresh"
              role="button"
              tabindex="0"
              @click="
                !loading && emit('select', EWorkerConnectionStrategy.fresh)
              "
              @keydown.enter="
                !loading && emit('select', EWorkerConnectionStrategy.fresh)
              "
              @keydown.space.prevent="
                !loading && emit('select', EWorkerConnectionStrategy.fresh)
              "
            >
              <VCardText class="connection-strategy-option__body">
                <div class="connection-strategy-option__topline">
                  <div class="connection-strategy-option__icon">
                    <VIcon icon="tabler-plug-connected-x" size="25" />
                  </div>
                  <VChip color="warning" variant="tonal" size="x-small">
                    {{ $t(presentation.freshBadge) }}
                  </VChip>
                </div>
                <h3>
                  {{ $t(presentation.freshTitle) }}
                </h3>
                <p class="connection-strategy-option__description">
                  {{ $t(presentation.freshDescription) }}
                </p>
                <VAlert
                  color="warning"
                  variant="tonal"
                  density="compact"
                  icon="tabler-alert-triangle"
                >
                  {{ $t(presentation.freshWarning) }}
                </VAlert>
                <div class="connection-strategy-option__action">
                  <span>{{ $t('channel_connection_strategy_choose') }}</span>
                  <VIcon icon="tabler-arrow-right" size="18" />
                </div>
              </VCardText>
            </VCard>
          </VCol>

          <VCol cols="12" md="6" class="d-flex">
            <VCard
              variant="outlined"
              class="connection-strategy-option connection-strategy-option--migrate h-100"
              :data-testid="presentation.preserveTestId"
              role="button"
              tabindex="0"
              @click="
                !loading && emit('select', EWorkerConnectionStrategy.migrate)
              "
              @keydown.enter="
                !loading && emit('select', EWorkerConnectionStrategy.migrate)
              "
              @keydown.space.prevent="
                !loading && emit('select', EWorkerConnectionStrategy.migrate)
              "
            >
              <VCardText class="connection-strategy-option__body">
                <div class="connection-strategy-option__topline">
                  <div class="connection-strategy-option__icon">
                    <VIcon icon="tabler-shield-check" size="25" />
                  </div>
                  <VChip color="primary" variant="tonal" size="x-small">
                    {{ $t(presentation.preserveBadge) }}
                  </VChip>
                </div>
                <h3>
                  {{ $t(presentation.preserveTitle) }}
                </h3>
                <p class="connection-strategy-option__description">
                  {{ $t(presentation.preserveDescription) }}
                </p>
                <VAlert
                  color="info"
                  variant="tonal"
                  density="compact"
                  icon="tabler-shield-lock"
                >
                  {{ $t(presentation.preserveNote) }}
                </VAlert>
                <div class="connection-strategy-option__action">
                  <span>{{ $t('channel_connection_strategy_choose') }}</span>
                  <VIcon icon="tabler-arrow-right" size="18" />
                </div>
              </VCardText>
            </VCard>
          </VCol>
        </VRow>

        <div class="connection-strategy-dialog__footer">
          <span>
            <VIcon icon="tabler-info-circle" size="17" />
            {{ $t(presentation.footer) }}
          </span>
          <VBtn
            class="connection-strategy-dialog__cancel-action"
            variant="outlined"
            color="primary"
            prepend-icon="tabler-x"
            :disabled="loading"
            @click="isVisible = false"
          >
            {{ $t('cancel') }}
          </VBtn>
        </div>
      </VCardText>

      <VOverlay
        :model-value="loading"
        contained
        persistent
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="54" />
      </VOverlay>
    </VCard>
  </VDialog>
</template>

<style scoped>
.connection-strategy-dialog {
  overflow: hidden;
  border: 1px solid rgba(var(--v-border-color), 0.14);
  border-radius: 22px;
  box-shadow: 0 32px 90px rgba(24, 39, 75, 0.2);
}

.connection-strategy-dialog--standard {
  border-radius: 6px;
}

.connection-strategy-dialog__body {
  display: grid;
  gap: 24px;
  padding: 30px;
  background:
    radial-gradient(
      circle at 8% 0%,
      rgba(var(--v-theme-primary), 0.11),
      transparent 28%
    ),
    rgb(var(--v-theme-surface));
}

.connection-strategy-dialog__hero {
  display: flex;
  align-items: flex-start;
  gap: 15px;
}

.connection-strategy-dialog__hero-copy {
  display: grid;
  max-inline-size: 620px;
  gap: 5px;
  padding-inline-end: 30px;
}

.connection-strategy-dialog__hero-copy h2,
.connection-strategy-dialog__hero-copy p {
  margin: 0;
}

.connection-strategy-dialog__hero-copy h2 {
  color: rgb(var(--v-theme-on-surface));
  font-size: 1.5rem;
  font-weight: 780;
  letter-spacing: -0.03em;
  line-height: 1.25;
}

.connection-strategy-dialog__hero-copy > p:last-child {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.84rem;
  line-height: 1.55;
}

.connection-strategy-dialog__eyebrow {
  display: flex;
  align-items: center;
  color: rgb(var(--v-theme-primary));
  font-size: 0.68rem;
  font-weight: 800;
  gap: 7px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.connection-strategy-dialog__eyebrow span {
  border-radius: 50%;
  background: currentcolor;
  block-size: 7px;
  box-shadow: 0 0 0 5px rgba(var(--v-theme-primary), 0.1);
  inline-size: 7px;
}

.connection-strategy-dialog__icon,
.connection-strategy-option__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
}

.connection-strategy-dialog__icon {
  width: 54px;
  height: 54px;
  flex: 0 0 54px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.12);
}

.connection-strategy-dialog__options {
  margin: -7px;
}

.connection-strategy-option {
  overflow: hidden;
  border-radius: 17px;
  cursor: pointer;
  inline-size: 100%;
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;
}

.connection-strategy-option:hover,
.connection-strategy-option:focus-visible {
  transform: translateY(-3px);
  box-shadow: 0 20px 42px rgba(20, 35, 65, 0.12);
  outline: none;
}

.connection-strategy-option--fresh:hover,
.connection-strategy-option--fresh:focus-visible {
  border-color: rgb(var(--v-theme-warning));
}

.connection-strategy-option--migrate:hover,
.connection-strategy-option--migrate:focus-visible {
  border-color: rgb(var(--v-theme-primary));
}

.connection-strategy-option__icon {
  width: 48px;
  height: 48px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
}

.connection-strategy-option--fresh .connection-strategy-option__icon {
  color: rgb(var(--v-theme-warning));
  background: rgba(var(--v-theme-warning), 0.12);
}

.connection-strategy-option__body {
  display: grid;
  block-size: 100%;
  gap: 13px;
  padding: 20px;
}

.connection-strategy-option__topline {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.connection-strategy-option h3 {
  margin: 0;
  color: rgb(var(--v-theme-on-surface));
  font-size: 1.05rem;
  font-weight: 750;
}

.connection-strategy-option__description {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.8rem;
  line-height: 1.55;
}

.connection-strategy-option__action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: rgb(var(--v-theme-primary));
  font-size: 0.76rem;
  font-weight: 750;
  margin-block-start: auto;
}

.connection-strategy-option--fresh .connection-strategy-option__action {
  color: rgb(var(--v-theme-warning));
}

.connection-strategy-dialog__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-block-start: 1px solid rgba(var(--v-border-color), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.72rem;
  gap: 16px;
  margin-inline: -30px;
  margin-block-end: -30px;
  padding: 17px 30px 20px;
}

.connection-strategy-dialog__footer > span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.connection-strategy-dialog__cancel-action {
  min-block-size: 42px;
  min-inline-size: 120px;
  border-color: rgba(var(--v-theme-primary), 0.34);
  background: rgb(var(--v-theme-surface));
  font-weight: 700;
  letter-spacing: 0;
}

.connection-strategy-dialog__cancel-action:hover {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.06);
}

@media (max-width: 600px) {
  .connection-strategy-dialog__body {
    padding: 24px 20px;
  }

  .connection-strategy-dialog__footer {
    align-items: stretch;
    flex-direction: column;
    margin-inline: -20px;
    margin-block-end: -24px;
    padding-inline: 20px;
  }

  .connection-strategy-dialog__footer > span {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .connection-strategy-option {
    transition: none;
  }

  .connection-strategy-option:hover,
  .connection-strategy-option:focus-visible {
    transform: none;
  }
}
</style>
