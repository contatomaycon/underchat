<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { Picker, EmojiIndex } from 'emoji-mart-vue-fast/src';
import data from 'emoji-mart-vue-fast/data/all.json';
import 'emoji-mart-vue-fast/css/emoji-mart.css';

interface SatisfactionOption {
  id: string;
  text: string;
}

interface SatisfactionData {
  title: string;
  message: string;
  options: SatisfactionOption[];
  onRemove?: () => void;
}

const props = defineProps<NodeProps>();

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

const messageLength = computed(() => satisfactionData.value.message.length);
const maxMessageLength = 500;

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
    id: `option-${crypto.randomUUID()}`,
    text: '',
  };
  satisfactionData.value.options.push(newOption);
  updateNodeData();
};

const removeOption = (index: number) => {
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
  const index = satisfactionData.value.options.findIndex((opt) => opt.id === optionId);
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
    <Handle type="target" :position="Position.Top" />

    <VCard class="satisfaction-card" elevation="2">
      <VCardTitle
        class="d-flex align-center justify-space-between pa-2 node-drag-handle"
      >
        <div class="d-flex align-center ga-2">
          <VIcon icon="tabler-star" color="primary" size="20" />
          <span class="text-sm font-weight-medium">Satisfação</span>
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
          placeholder="Defina o título da satisfação"
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
            placeholder="Informe a mensagem a ser enviada"
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
          Adicionar Opção
        </VBtn>

        <div v-if="satisfactionData.options.length > 0" class="options-list">
          <div
            v-for="(option, index) in satisfactionData.options"
            :key="option.id"
            class="option-item"
          >
            <div class="option-number-wrapper">
              <div class="option-number">
                {{ index + 1 }}
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
              placeholder="Digite uma opção"
              variant="outlined"
              density="compact"
              class="option-text-field"
              hide-details
            />
            <Handle
              :id="`option-${option.id}-source`"
              type="source"
              :position="Position.Right"
              class="option-handle"
            />
            <div class="option-drag-handle">
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

