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
  width: min(100%, 336px);
  min-width: 210px;
  max-width: min(336px, 72vw);
  border: 1px solid rgba(17, 27, 33, 0.08);
  border-radius: 7.5px;
  background: #fff;
  color: #111b21;
  box-shadow: 0 1px 1px rgba(11, 20, 26, 0.08);
}

.button-message-card--outgoing {
  margin-left: auto;
}

.button-message-card__content {
  overflow: hidden;
  background: #fff;
}

.button-message-card__header {
  overflow-wrap: anywhere;
  padding: 10px 12px 3px;
  color: #111b21;
  font-size: 0.88rem;
  font-weight: 700;
  line-height: 1.3;
  white-space: pre-wrap;
}

.button-message-card__text {
  overflow-wrap: anywhere;
  padding: 9px 12px 10px;
  color: #111b21;
  font-size: 0.88rem;
  line-height: 1.38;
  white-space: pre-wrap;
}

.button-message-card__header + .button-message-card__text {
  padding-top: 4px;
}

.button-message-card__footer {
  overflow-wrap: anywhere;
  padding: 7px 12px 9px;
  border-top: 1px solid #e9edef;
  color: #667781;
  font-size: 0.74rem;
  line-height: 1.25;
  white-space: pre-wrap;
}

.button-message-card__actions {
  border-top: 1px solid #e9edef;
}

.button-message-card__action {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 9px 12px;
  background: #fff;
  color: #008069;
  font-size: 0.88rem;
  font-weight: 500;
  line-height: 1.18;
  text-align: center;
}

.button-message-card__action + .button-message-card__action {
  border-top: 1px solid #e9edef;
}

.button-message-card__action-text {
  overflow: hidden;
  min-width: 0;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
