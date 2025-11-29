<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';

interface MenuOption {
  id: string;
  text: string;
}

interface MenuData {
  title: string;
  message: string;
  options: MenuOption[];
  onRemove?: () => void;
}

const props = defineProps<NodeProps>();

const getInitialData = (): MenuData => {
  const data = props.data as MenuData | undefined;
  return {
    title: data?.title || '',
    message: data?.message || '',
    options: data?.options ? [...data.options] : [],
  };
};

const menuData = ref<MenuData>(getInitialData());

const messageLength = computed(() => menuData.value.message.length);
const maxMessageLength = 500;

const updateNodeData = () => {
  if (props.data) {
    const data = props.data as MenuData;
    data.title = menuData.value.title;
    data.message = menuData.value.message;
    data.options = [...menuData.value.options];
  }
};

const addOption = () => {
  const newOption: MenuOption = {
    id: `option-${Date.now()}-${Math.random()}`,
    text: '',
  };
  menuData.value.options.push(newOption);
  updateNodeData();
};

const removeOption = (index: number) => {
  menuData.value.options.splice(index, 1);
  updateNodeData();
};

const updateOption = (index: number, text: string) => {
  menuData.value.options[index].text = text;
  updateNodeData();
};

const handleRemove = () => {
  const data = props.data as MenuData;
  if (data?.onRemove) {
    data.onRemove();
  }
};

watch(
  () => menuData.value,
  () => {
    updateNodeData();
  },
  { deep: true }
);
</script>

<template>
  <div class="chatbot-menu-node">
    <Handle type="target" :position="Position.Top" />
    <Handle type="target" :position="Position.Right" />
    <Handle type="target" :position="Position.Bottom" />
    <Handle type="target" :position="Position.Left" />
    <Handle type="source" :position="Position.Top" />
    <Handle type="source" :position="Position.Right" />
    <Handle type="source" :position="Position.Bottom" />
    <Handle type="source" :position="Position.Left" />

    <VCard class="menu-card" elevation="2">
      <VCardTitle class="d-flex align-center justify-space-between pa-2">
        <div class="d-flex align-center ga-2">
          <VIcon icon="tabler-menu-2" color="primary" size="20" />
          <span class="text-sm font-weight-medium">Menu</span>
        </div>
        <VIcon
          v-if="(props.data as MenuData)?.onRemove"
          icon="tabler-x"
          size="18"
          color="error"
          class="cursor-pointer"
          @click="handleRemove"
        />
      </VCardTitle>

      <VCardText class="pa-3">
        <!-- Título do Menu -->
        <VTextField
          v-model="menuData.title"
          placeholder="Defina o título do menu"
          prepend-inner-icon="tabler-message-circle"
          variant="outlined"
          density="compact"
          class="mb-3"
          hide-details
        />

        <!-- Mensagem -->
        <VTextarea
          v-model="menuData.message"
          placeholder="Informe a mensagem a ser enviada"
          variant="outlined"
          density="compact"
          rows="3"
          :counter="maxMessageLength"
          :maxlength="maxMessageLength"
          class="mb-3"
          hide-details="auto"
        >
          <template #append>
            <span class="text-caption text-medium-emphasis">
              {{ messageLength }}/{{ maxMessageLength }}
            </span>
          </template>
        </VTextarea>

        <!-- Botão Adicionar Opção -->
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

        <!-- Lista de Opções -->
        <div v-if="menuData.options.length > 0" class="options-list">
          <div
            v-for="(option, index) in menuData.options"
            :key="option.id"
            class="option-item"
          >
            <div class="option-number-wrapper">
              <div class="option-number">
                {{ index + 1 }}
              </div>
            </div>
            <VTextField
              :model-value="option.text"
              @update:model-value="updateOption(index, $event)"
              placeholder="Digite uma opção"
              variant="outlined"
              density="compact"
              class="option-text-field"
              hide-details
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
.chatbot-menu-node {
  min-width: 350px;
}

.menu-card {
  border-radius: 8px;
}

.option-item {
  padding: 4px 0;
  display: flex;
  align-items: center;
  flex-direction: row;
  gap: 8px;
  margin-bottom: 8px;
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
}

.option-drag-handle {
  cursor: grab;
  display: flex;
  align-items: center;
  padding: 4px;
}

.option-drag-handle:active {
  cursor: grabbing;
}

.cursor-pointer {
  cursor: pointer;
}
</style>
