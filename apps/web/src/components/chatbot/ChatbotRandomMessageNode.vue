<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { useChatbotStore } from '@/@webcore/stores/chatbot';
import { useI18n } from 'vue-i18n';

interface RandomMessageNodeData {
  selectedRandomMessage: string | null;
  continueType: 'automatic' | 'after_response' | null;
  onRemove?: () => void;
}

const props = defineProps<NodeProps>();
const chatbotStore = useChatbotStore();
const { t } = useI18n();

const normalizeValue = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.toString().trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getInitialData = (): RandomMessageNodeData => {
  const data = props.data as RandomMessageNodeData | undefined;

  return {
    selectedRandomMessage: normalizeValue(data?.selectedRandomMessage),
    continueType: data?.continueType ?? null,
  };
};

const randomMessageNodeData = ref<RandomMessageNodeData>(getInitialData());
const randomMessages = ref<Array<{ value: string; title: string }>>([]);
const isLoadingRandomMessages = ref(false);

const continueOptions = computed(() => [
  {
    value: 'automatic',
    title: t('chatbot_message_continue_automatic'),
  },
  {
    value: 'after_response',
    title: t('chatbot_message_continue_after_response'),
  },
]);

const updateNodeData = () => {
  if (!props.data) {
    return;
  }

  const data = props.data as RandomMessageNodeData;
  data.selectedRandomMessage =
    randomMessageNodeData.value.selectedRandomMessage;
  data.continueType = randomMessageNodeData.value.continueType;
};

const loadRandomMessages = async () => {
  if (isLoadingRandomMessages.value) {
    return;
  }

  isLoadingRandomMessages.value = true;

  try {
    const response = await chatbotStore.listChatbotRandomMessages();

    randomMessages.value = response.map((item) => ({
      value: item.random_message_id,
      title: item.name,
    }));

    if (
      randomMessageNodeData.value.selectedRandomMessage &&
      !randomMessages.value.some(
        (item) =>
          item.value === randomMessageNodeData.value.selectedRandomMessage
      )
    ) {
      randomMessages.value.unshift({
        value: randomMessageNodeData.value.selectedRandomMessage,
        title: randomMessageNodeData.value.selectedRandomMessage,
      });
    }
  } catch (error) {
    console.error('Error loading random messages:', error);
    randomMessages.value = [];
  } finally {
    isLoadingRandomMessages.value = false;
  }
};

const handleRemove = () => {
  const data = props.data as RandomMessageNodeData;
  if (data?.onRemove) {
    data.onRemove();
  }
};

watch(
  () => randomMessageNodeData.value,
  () => {
    updateNodeData();
  },
  { deep: true }
);

onMounted(() => {
  loadRandomMessages();
});
</script>

<template>
  <div class="chatbot-random-message-node">
    <Handle
      id="target"
      type="target"
      :position="Position.Top"
      class="handle-target"
    />
    <Handle
      id="source"
      type="source"
      :position="Position.Bottom"
      class="handle-source"
    />

    <VCard class="random-message-card" elevation="2">
      <VCardTitle
        class="d-flex align-center justify-space-between pa-2 node-drag-handle"
      >
        <div class="d-flex align-center ga-2">
          <VIcon icon="tabler-message-2" color="randomMessage" size="20" />
          <span class="text-sm font-weight-medium">{{
            t('chatbot_random_message_node_title')
          }}</span>
        </div>
        <VIcon
          v-if="(props.data as RandomMessageNodeData)?.onRemove"
          icon="tabler-x"
          size="18"
          color="error"
          class="cursor-pointer"
          @click.stop="handleRemove"
        />
      </VCardTitle>

      <VCardText class="pa-3">
        <VLabel class="text-body-2 mb-1">{{
          t('chatbot_random_message_select')
        }}</VLabel>
        <AppSelectSearch
          v-model="randomMessageNodeData.selectedRandomMessage"
          :items="randomMessages"
          :placeholder="t('chatbot_random_message_placeholder')"
          :loading="isLoadingRandomMessages"
          :clearable="true"
          item-value="value"
          item-title="title"
          class="mb-3"
          @select="loadRandomMessages()"
        />

        <VSelect
          v-model="randomMessageNodeData.continueType"
          :items="continueOptions"
          :label="t('chatbot_message_continue')"
          variant="outlined"
          density="compact"
          hide-details
        />
      </VCardText>
    </VCard>
  </div>
</template>

<style scoped>
.chatbot-random-message-node {
  min-width: 360px;
}

.random-message-card {
  border-radius: 8px;
}

.node-drag-handle {
  cursor: grab;
  user-select: none;
}

.node-drag-handle:active {
  cursor: grabbing;
}

.cursor-pointer {
  cursor: pointer;
}
</style>
