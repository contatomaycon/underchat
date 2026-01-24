<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position, useVueFlow } from '@vue-flow/core';
import { Picker, EmojiIndex } from 'emoji-mart-vue-fast/src';
import data from 'emoji-mart-vue-fast/data/all.json';
import 'emoji-mart-vue-fast/css/emoji-mart.css';
import { useI18n } from 'vue-i18n';

interface SatisfactionOption {
  id: string;
  text: string;
}

interface SatisfactionData {
  title: string;
  message: string;
  options: SatisfactionOption[];
  onRemove?: () => void;
  onRemoveOption?: (optionId: string) => void;
}

const props = defineProps<NodeProps>();
const { t } = useI18n();
const { updateNodeInternals } = useVueFlow();

const getInitialData = (): SatisfactionData => {
  const data = props.data as SatisfactionData | undefined;
  return {
    title: data?.title || '',
    message: data?.message || '',
    options: data?.options ? [...data.options] : [],
  };
};

const satisfactionData = ref<SatisfactionData>(getInitialData());
const emojiIndex = new EmojiIndex(data);
const emojiPickerOpen = ref<Record<string, boolean>>({});
const messageEmojiPickerOpen = ref(false);
const draggedOptionIndex = ref<number | null>(null);
const dragOverOptionIndex = ref<number | null>(null);
const isDraggingOption = ref(false);
const lastOptionPointerDown = ref<HTMLElement | null>(null);

const messageLength = computed(() => satisfactionData.value.message.length);
const maxMessageLength = 500;

const buildOptionHandleId = (optionId: string) => {
  return `option-${optionId}-source`;
};

const updateNodeData = () => {
  if (props.data) {
    const data = props.data as SatisfactionData;
    data.title = satisfactionData.value.title;
    data.message = satisfactionData.value.message;
    data.options = [...satisfactionData.value.options];
  }
};

const addOption = () => {
  const newOption: SatisfactionOption = {
    id: crypto.randomUUID(),
    text: '',
  };
  satisfactionData.value.options.push(newOption);
  updateNodeData();
};

const removeOption = (index: number) => {
  const option = satisfactionData.value.options[index];
  const data = props.data as SatisfactionData;

  if (data?.onRemoveOption && option) {
    data.onRemoveOption(option.id);
  }

  satisfactionData.value.options.splice(index, 1);
  updateNodeData();
};

const updateOption = (index: number, text: string) => {
  satisfactionData.value.options[index].text = text;
  updateNodeData();
};

const onEmojiSelect = (
  emoji: { native?: string; colons?: string },
  optionId: string
) => {
  const index = satisfactionData.value.options.findIndex(
    (opt) => opt.id === optionId
  );
  if (index > -1) {
    const emojiText = emoji.native || emoji.colons || '';
    const currentText = satisfactionData.value.options[index].text || '';
    satisfactionData.value.options[index].text = currentText + emojiText;
    updateNodeData();
    emojiPickerOpen.value[optionId] = false;

    nextTick(() => {
      const textFieldElement = document.querySelector(
        `#option-input-${optionId}`
      );
      if (textFieldElement) {
        const inputElement = textFieldElement.querySelector(
          'input'
        ) as HTMLInputElement;
        if (inputElement) {
          inputElement.focus();
          const newLength = satisfactionData.value.options[index].text.length;
          inputElement.setSelectionRange(newLength, newLength);
        }
      }
    });
  }
};

const onMessageEmojiSelect = (emoji: { native?: string; colons?: string }) => {
  const emojiText = emoji.native || emoji.colons || '';
  const currentMessage = satisfactionData.value.message || '';
  satisfactionData.value.message = currentMessage + emojiText;
  updateNodeData();
  messageEmojiPickerOpen.value = false;

  nextTick(() => {
    const textareaElement = document.querySelector(
      '#message-textarea'
    ) as HTMLTextAreaElement;
    if (textareaElement) {
      textareaElement.focus();
      const newLength = satisfactionData.value.message.length;
      textareaElement.setSelectionRange(newLength, newLength);
    }
  });
};

const handleRemove = () => {
  const data = props.data as SatisfactionData;
  if (data?.onRemove) {
    data.onRemove();
  }
};

const handleDragStart = (event: DragEvent, index: number) => {
  event.stopPropagation();
  event.stopImmediatePropagation();

  const pointerTarget = lastOptionPointerDown.value;
  const target = pointerTarget || (event.target as HTMLElement | null);
  lastOptionPointerDown.value = null;

  if (
    target?.closest('input') ||
    target?.closest('button') ||
    target?.closest('.v-menu') ||
    target?.closest('.vue-flow__handle') ||
    target?.closest('.option-handle')
  ) {
    event.preventDefault();
    return;
  }

  isDraggingOption.value = true;
  draggedOptionIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', index.toString());
  }
};

const handleDragOver = (event: DragEvent, index: number) => {
  event.preventDefault();
  event.stopPropagation();

  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
  if (draggedOptionIndex.value !== null && draggedOptionIndex.value !== index) {
    dragOverOptionIndex.value = index;
  }
};

const handleDragLeave = () => {
  dragOverOptionIndex.value = null;
};

const handleDrop = (event: DragEvent, dropIndex: number) => {
  event.preventDefault();
  event.stopPropagation();

  if (
    draggedOptionIndex.value === null ||
    draggedOptionIndex.value === dropIndex
  ) {
    draggedOptionIndex.value = null;
    dragOverOptionIndex.value = null;
    return;
  }

  const options = [...satisfactionData.value.options];
  const draggedOption = options[draggedOptionIndex.value];

  options.splice(draggedOptionIndex.value, 1);
  options.splice(dropIndex, 0, draggedOption);

  satisfactionData.value.options = options;
  updateNodeData();
  nextTick(() => updateNodeInternals([props.id]));

  draggedOptionIndex.value = null;
  dragOverOptionIndex.value = null;
};

const handleDragEnd = () => {
  draggedOptionIndex.value = null;
  dragOverOptionIndex.value = null;
  isDraggingOption.value = false;
};

const handleMouseDown = (event: MouseEvent) => {
  event.stopPropagation();
  event.stopImmediatePropagation();
};

const handleOptionPointerDown = (event: MouseEvent | TouchEvent) => {
  lastOptionPointerDown.value = event.target as HTMLElement | null;
};

watch(
  () => satisfactionData.value,
  () => {
    updateNodeData();
  },
  { deep: true }
);
</script>

<template>
  <div class="chatbot-satisfaction-node">
    <Handle id="target" type="target" :position="Position.Top" class="handle-target" />

    <VCard class="satisfaction-card" elevation="2">
      <VCardTitle
        class="d-flex align-center justify-space-between pa-2 node-drag-handle"
      >
        <div class="d-flex align-center ga-2">
          <VIcon icon="tabler-star" color="primary" size="20" />
          <span class="text-sm font-weight-medium">{{
            t('chatbot_satisfaction')
          }}</span>
        </div>
        <VIcon
          v-if="(props.data as SatisfactionData)?.onRemove"
          icon="tabler-x"
          size="18"
          color="error"
          class="cursor-pointer"
          @click.stop="handleRemove"
        />
      </VCardTitle>

      <VCardText class="pa-3">
        <VTextField
          v-model="satisfactionData.title"
          :placeholder="t('chatbot_satisfaction_title_placeholder')"
          prepend-inner-icon="tabler-message-circle"
          variant="outlined"
          density="compact"
          class="mb-3"
          hide-details
        />

        <div class="mb-3 message-textarea-wrapper">
          <VTextarea
            id="message-textarea"
            v-model="satisfactionData.message"
            :placeholder="t('chatbot_message_placeholder')"
            variant="outlined"
            density="compact"
            rows="3"
            :counter="maxMessageLength"
            :maxlength="maxMessageLength"
            hide-details
          />
          <div
            class="d-flex align-center justify-space-between message-counter-row"
          >
            <span class="text-caption text-medium-emphasis">
              {{ messageLength }}/{{ maxMessageLength }}
            </span>
            <VMenu
              v-model="messageEmojiPickerOpen"
              location="top start"
              :close-on-content-click="false"
              offset="8"
            >
              <template #activator="{ props: menuProps }">
                <VBtn
                  v-bind="menuProps"
                  icon
                  size="small"
                  variant="text"
                  class="message-emoji-btn"
                >
                  <VIcon size="18" color="primary">tabler-mood-smile</VIcon>
                </VBtn>
              </template>
              <div class="emoji-picker-wrap">
                <Picker
                  :data="emojiIndex"
                  :per-line="8"
                  :show-preview="false"
                  :show-search="true"
                  :show-skin-tones="false"
                  @select="
                    (emoji: { native?: string; colons?: string }) =>
                      onMessageEmojiSelect(emoji)
                  "
                />
              </div>
            </VMenu>
          </div>
        </div>

        <VBtn
          variant="outlined"
          color="primary"
          size="small"
          class="mb-3 w-100"
          @click="addOption"
        >
          <VIcon icon="tabler-plus" size="18" class="me-1" />
          {{ t('chatbot_add_option') }}
        </VBtn>

        <div
          v-if="satisfactionData.options.length > 0"
          class="options-list nodrag"
        >
          <div
            v-for="(option, index) in satisfactionData.options"
            :key="option.id"
            class="option-item nodrag"
            :class="{
              dragging: draggedOptionIndex === index,
              'drag-over': dragOverOptionIndex === index,
            }"
            draggable="true"
            @mousedown.capture="handleOptionPointerDown"
            @touchstart.capture="handleOptionPointerDown"
            @dragstart.stop="handleDragStart($event, index)"
            @dragover.stop="handleDragOver($event, index)"
            @dragleave.stop="handleDragLeave"
            @drop.stop="handleDrop($event, index)"
            @dragend.stop="handleDragEnd"
          >
            <div class="option-number-wrapper">
              <div class="option-number">
                <span class="option-number-text">{{ index + 1 }}</span>
                <VIcon
                  icon="tabler-x"
                  size="16"
                  color="error"
                  class="option-remove-icon"
                  @click.stop="removeOption(index)"
                />
              </div>
            </div>
            <VMenu
              v-model="emojiPickerOpen[option.id]"
              location="top start"
              :close-on-content-click="false"
              offset="8"
            >
              <template #activator="{ props: menuProps }">
                <VBtn
                  v-bind="menuProps"
                  icon
                  size="small"
                  variant="text"
                  class="option-emoji-btn"
                >
                  <VIcon size="18" color="primary">tabler-mood-smile</VIcon>
                </VBtn>
              </template>
              <div class="emoji-picker-wrap">
                <Picker
                  :data="emojiIndex"
                  :per-line="8"
                  :show-preview="false"
                  :show-search="true"
                  :show-skin-tones="false"
                  @select="
                    (emoji: { native?: string; colons?: string }) =>
                      onEmojiSelect(emoji, option.id)
                  "
                />
              </div>
            </VMenu>
            <VTextField
              :id="`option-input-${option.id}`"
              :model-value="option.text"
              @update:model-value="updateOption(index, $event)"
              :placeholder="t('chatbot_option_placeholder')"
              variant="outlined"
              density="compact"
              class="option-text-field"
              hide-details
            />
            <Handle
              :id="buildOptionHandleId(option.id)"
              type="source"
              :position="Position.Right"
              class="option-handle handle-source"
              @mousedown.stop
              @touchstart.stop
            />
            <div class="option-drag-handle" @mousedown.stop="handleMouseDown">
              <VIcon icon="tabler-grip-vertical" size="18" color="primary" />
            </div>
          </div>
        </div>
      </VCardText>
    </VCard>
  </div>
</template>

<style scoped>
.chatbot-satisfaction-node {
  min-width: 350px;
}

.satisfaction-card {
  border-radius: 8px;
}

.option-item {
  padding: 4px 0;
  display: flex;
  align-items: center;
  flex-direction: row;
  gap: 8px;
  margin-bottom: 8px;
  position: relative;
  transition:
    opacity 0.2s,
    transform 0.2s;
  cursor: grab;
  user-select: none;
}

.option-item:active {
  cursor: grabbing;
}

.option-item.dragging {
  opacity: 0.5;
  cursor: grabbing;
}

.option-item.drag-over {
  transform: translateY(4px);
  border-top: 2px solid rgb(var(--v-theme-primary));
  padding-top: 2px;
}

.option-number-wrapper {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.option-number {
  min-width: 28px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgb(var(--v-theme-surface));
  border: 1px solid rgb(var(--v-border-color));
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  color: rgb(var(--v-theme-on-surface));
  position: relative;
}

.option-number-text {
  transition: opacity 0.2s;
}

.option-remove-icon {
  position: absolute;
  opacity: 0;
  transition: opacity 0.2s;
  cursor: pointer;
  pointer-events: none;
}

.option-item:hover .option-number-text {
  opacity: 0;
}

.option-item:hover .option-remove-icon {
  opacity: 1;
  pointer-events: auto;
}

.option-text-field {
  flex: 1;
  min-width: 0;
}

.option-drag-handle {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 4px;
  margin-right: 20px;
  cursor: grab;
}

.option-drag-handle:active {
  cursor: grabbing;
}

.option-emoji-btn {
  flex-shrink: 0;
  min-width: 32px;
  width: 32px;
  height: 32px;
}

.option-handle {
  position: absolute;
  right: -12px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
}

.option-emoji {
  font-size: 18px;
  line-height: 1;
}

.message-emoji-btn {
  flex-shrink: 0;
  min-width: 32px;
  width: 32px;
  height: 32px;
}

.emoji-picker-wrap {
  max-width: 352px;
  max-height: 435px;
  overflow: hidden;
}

.cursor-pointer {
  cursor: pointer;
}

.node-drag-handle {
  cursor: grab;
  user-select: none;
}

.node-drag-handle:active {
  cursor: grabbing;
}

.message-textarea-wrapper {
  :deep(.v-input__details) {
    display: none;
    margin: 0;
    padding: 0;
    min-height: 0;
  }
}

.message-counter-row {
  margin-top: 4px;
}
</style>
