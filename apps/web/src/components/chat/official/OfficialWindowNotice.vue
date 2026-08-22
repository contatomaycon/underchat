<script setup lang="ts">
import type { IOfficialWhatsappConversationWindowSnapshot } from '@core/common/interfaces/IOfficialWhatsappConversationWindow';

const props = defineProps<{
  window: IOfficialWhatsappConversationWindowSnapshot | null | undefined;
  canSendTemplate: boolean;
  loading?: boolean;
}>();

const emit = defineEmits<{
  (event: 'send-template'): void;
}>();

const { t } = useI18n();

const notice = computed(() => {
  if (props.window?.state === 'send_uncertain') {
    return {
      color: 'info',
      icon: 'tabler-cloud-question',
      title: t('official_window_uncertain_title'),
      text: t('official_window_uncertain_description'),
      action: false,
    };
  }

  if (props.window?.state === 'awaiting_contact_reply') {
    return {
      color: 'warning',
      icon: 'tabler-lock',
      title: t('official_window_awaiting_title'),
      text: t('official_window_awaiting_description'),
      action: false,
    };
  }

  if (props.window?.state === 'closed') {
    return {
      color: 'error',
      icon: 'tabler-clock-x',
      title: t('official_window_closed_title'),
      text: t('official_window_closed_description'),
      action: true,
    };
  }

  return null;
});
</script>

<template>
  <VAlert
    v-if="notice"
    class="official-window-notice"
    :color="notice.color"
    variant="tonal"
    density="comfortable"
  >
    <template #prepend>
      <VIcon :icon="notice.icon" size="22" />
    </template>

    <div class="official-window-notice__content">
      <div class="official-window-notice__copy">
        <strong>{{ notice.title }}</strong>
        <span>{{ notice.text }}</span>
      </div>

      <VBtn
        v-if="notice.action && canSendTemplate"
        color="primary"
        variant="flat"
        size="small"
        :loading="loading"
        @click.stop="emit('send-template')"
      >
        <VIcon icon="tabler-template" size="16" class="me-1" />
        {{ t('official_window_send_template') }}
      </VBtn>
    </div>
  </VAlert>
</template>

<style scoped>
.official-window-notice {
  border-radius: 8px;
  margin: 8px 12px 10px;
}

.official-window-notice__content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.official-window-notice__copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.official-window-notice__copy span {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.86rem;
  line-height: 1.35;
}

@media (max-width: 600px) {
  .official-window-notice__content {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
