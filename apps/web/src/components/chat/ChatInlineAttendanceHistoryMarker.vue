<script setup lang="ts">
import type { ListChatsResult } from '@core/schema/chat/listChats/response.schema';

defineProps<{
  chat: ListChatsResult;
  dateLabel: string;
  lastInteractionLabel: string;
  loading?: boolean;
  loaded?: boolean;
  expanded?: boolean;
}>();

const emit = defineEmits<{
  toggle: [chat: ListChatsResult];
}>();
</script>

<template>
  <div class="inline-attendance-history-marker">
    <div class="inline-attendance-history-marker__line"></div>

    <VBtn
      class="inline-attendance-history-marker__button"
      variant="tonal"
      color="primary"
      :loading="loading"
      :disabled="loading"
      @click="emit('toggle', chat)"
    >
      <template #prepend>
        <VIcon
          :icon="
            expanded
              ? 'tabler-chevron-up'
              : loaded
                ? 'tabler-chevron-down'
                : 'tabler-history'
          "
          size="18"
        />
      </template>
      <span class="inline-attendance-history-marker__date">
        {{ dateLabel }}
      </span>
      <span class="inline-attendance-history-marker__meta">
        {{ $t('last_interaction') }}: {{ lastInteractionLabel }}
      </span>
    </VBtn>

    <div class="inline-attendance-history-marker__line"></div>
  </div>
</template>

<style scoped>
.inline-attendance-history-marker {
  display: flex;
  align-items: center;
  gap: 10px;
  inline-size: 100%;
  margin-block: 14px;
}

.inline-attendance-history-marker__line {
  flex: 1 1 0;
  block-size: 1px;
  background-color: rgba(var(--v-theme-on-surface), 0.12);
}

.inline-attendance-history-marker__button {
  min-block-size: 38px;
  max-inline-size: min(520px, 86%);
  border-radius: 7px;
  text-transform: none;
}

.inline-attendance-history-marker__button :deep(.v-btn__content) {
  display: flex;
  align-items: center;
  gap: 8px;
  min-inline-size: 0;
}

.inline-attendance-history-marker__date {
  flex: 0 0 auto;
  font-size: 0.78rem;
  font-weight: 600;
  line-height: 1.2;
}

.inline-attendance-history-marker__meta {
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.72rem;
  font-weight: 400;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 700px) {
  .inline-attendance-history-marker__button {
    max-inline-size: 92%;
  }

  .inline-attendance-history-marker__button :deep(.v-btn__content) {
    align-items: flex-start;
    flex-direction: column;
    gap: 2px;
  }

  .inline-attendance-history-marker__meta {
    max-inline-size: 100%;
  }
}
</style>
