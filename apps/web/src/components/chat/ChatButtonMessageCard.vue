<script setup lang="ts">
import { computed } from 'vue';
import type { ButtonMessageChat } from '@core/schema/chat/listMessageChats/response.schema';

interface Props {
  buttons?: ButtonMessageChat | null;
  isOutgoing?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  buttons: null,
  isOutgoing: false,
});
const buttonItems = computed(() => props.buttons?.buttons ?? []);
</script>

<template>
  <div
    class="button-message-card"
    :class="{ 'button-message-card--outgoing': props.isOutgoing }"
  >
    <div
      v-if="
        props.buttons?.header || props.buttons?.text || props.buttons?.footer
      "
      class="button-message-card__content"
    >
      <div v-if="props.buttons?.header" class="button-message-card__header">
        {{ props.buttons.header }}
      </div>
      <div v-if="props.buttons?.text" class="button-message-card__text">
        {{ props.buttons.text }}
      </div>
      <div v-if="props.buttons?.footer" class="button-message-card__footer">
        {{ props.buttons.footer }}
      </div>
    </div>

    <div v-if="buttonItems.length" class="button-message-card__actions">
      <div
        v-for="(button, index) in buttonItems"
        :key="`${button.id ?? index}-${button.display_text}`"
        class="button-message-card__action"
      >
        <VIcon size="17" class="button-message-card__action-icon">
          tabler-arrow-back-up
        </VIcon>
        <span class="button-message-card__action-text">
          {{ button.display_text }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.button-message-card {
  overflow: hidden;
  min-width: 210px;
  max-width: min(280px, 72vw);
  border: 1px solid rgba(var(--v-border-color), 0.42);
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.button-message-card--outgoing {
  border-color: rgba(var(--v-theme-success), 0.2);
}

.button-message-card__content {
  padding: 10px 12px 8px;
}

.button-message-card__header {
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-size: 0.82rem;
  font-weight: 700;
  line-height: 1.25;
}

.button-message-card__text {
  color: rgba(var(--v-theme-on-surface), 0.88);
  font-size: 0.88rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
  white-space: pre-line;
}

.button-message-card__header + .button-message-card__text {
  margin-top: 4px;
}

.button-message-card__footer {
  margin-top: 6px;
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 0.72rem;
  line-height: 1.3;
}

.button-message-card__actions {
  border-top: 1px solid rgba(var(--v-border-color), 0.42);
}

.button-message-card__action {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 39px;
  padding: 8px 12px;
  color: rgb(var(--v-theme-primary));
  font-size: 0.84rem;
  font-weight: 600;
  line-height: 1.2;
}

.button-message-card__action + .button-message-card__action {
  border-top: 1px solid rgba(var(--v-border-color), 0.38);
}

.button-message-card__action-icon {
  opacity: 0.82;
}

.button-message-card__action-text {
  overflow: hidden;
  min-width: 0;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
