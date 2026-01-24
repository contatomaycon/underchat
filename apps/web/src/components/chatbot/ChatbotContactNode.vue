<script setup lang="ts">
import { ref, watch } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position, useVueFlow } from '@vue-flow/core';
import { useI18n } from 'vue-i18n';

interface ContactOption {
  id: string;
  text: string;
  required?: boolean;
}

interface ContactData {
  options: ContactOption[];
  onRemove?: () => void;
  onRemoveOption?: (optionId: string) => void;
}

const props = defineProps<NodeProps>();
const { t } = useI18n();
const { updateNodeInternals } = useVueFlow();

const getInitialData = (): ContactData => {
  const data = props.data as ContactData | undefined;
  return {
    options: data?.options ? [...data.options] : [],
  };
};

const contactData = ref<ContactData>(getInitialData());

const buildOptionHandleId = (optionId: string) => {
  return `option-${optionId}-source`;
};

const updateNodeData = () => {
  if (props.data) {
    const data = props.data as ContactData;
    data.options = [...contactData.value.options];
  }
};

const handleRemove = () => {
  const data = props.data as ContactData;
  if (data?.onRemove) {
    data.onRemove();
  }
};

watch(
  () => contactData.value,
  () => {
    updateNodeData();
  },
  { deep: true }
);
</script>

<template>
  <div class="chatbot-contact-node">
    <Handle id="target" type="target" :position="Position.Top" class="handle-target" />

    <VCard class="contact-card" elevation="2">
      <VCardTitle
        class="d-flex align-center justify-space-between pa-2 node-drag-handle"
      >
        <div class="d-flex align-center ga-2">
          <VIcon icon="tabler-users" color="tertiary" size="20" />
          <span class="text-sm font-weight-medium">{{
            t('chatbot_contact')
          }}</span>
        </div>
        <VIcon
          v-if="(props.data as ContactData)?.onRemove"
          icon="tabler-x"
          size="18"
          color="error"
          class="cursor-pointer"
          @click.stop="handleRemove"
        />
      </VCardTitle>

      <VCardText class="pa-3">
        <div v-if="contactData.options.length > 0" class="options-list nodrag">
          <div
            v-for="(option, index) in contactData.options"
            :key="option.id"
            class="option-item nodrag"
          >
            <div class="option-number-wrapper">
              <div class="option-number">
                <span class="option-number-text">{{ index + 1 }}</span>
              </div>
            </div>
            <VTextField
              :id="`option-input-${option.id}`"
              :model-value="option.text"
              :placeholder="t('chatbot_option_placeholder')"
              variant="outlined"
              density="compact"
              class="option-text-field"
              disabled
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
          </div>
        </div>
      </VCardText>
    </VCard>
  </div>
</template>

<style scoped>
.chatbot-contact-node {
  min-width: 350px;
}

.contact-card {
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
  position: relative;
}

.option-number-text {
  transition: opacity 0.2s;
}

.option-text-field {
  flex: 1;
  min-width: 0;
  margin-right: 12px;
}

.option-text-field :deep(input) {
  pointer-events: auto;
}

.option-handle {
  position: absolute;
  right: -12px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
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
</style>
