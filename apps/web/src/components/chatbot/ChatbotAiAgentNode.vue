<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { useChatbotStore } from '@/@webcore/stores/chatbot';
import { useI18n } from 'vue-i18n';

interface AiAgentData {
  selectedAiAgent: string | null;
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

const getInitialData = (): AiAgentData => {
  const data = props.data as AiAgentData | undefined;
  const selectedAiAgent = normalizeValue(data?.selectedAiAgent);

  if (data) {
    if (data.selectedAiAgent === undefined) {
      data.selectedAiAgent = selectedAiAgent;
    }
  }

  return {
    selectedAiAgent,
  };
};

const aiAgentData = ref<AiAgentData>(getInitialData());

const aiAgents = ref<Array<{ value: string; title: string }>>([]);
const isLoadingAiAgents = ref(false);

const updateNodeData = () => {
  if (!props.data) {
    return;
  }
  isUpdatingFromProps = true;
  const data = props.data as AiAgentData;
  const newValue = aiAgentData.value.selectedAiAgent;
  if (data.selectedAiAgent !== newValue) {
    data.selectedAiAgent = newValue;
  }
  nextTick(() => {
    isUpdatingFromProps = false;
  });
};

const loadAiAgents = async () => {
  if (isLoadingAiAgents.value) return;

  isLoadingAiAgents.value = true;
  try {
    const response = await chatbotStore.listChatbotAiAgents();

    if (response) {
      aiAgents.value = response.map(
        (agent: { ai_agent_id: string; name: string }) => ({
          value: agent.ai_agent_id,
          title: agent.name,
        })
      );

      if (
        aiAgentData.value.selectedAiAgent &&
        !aiAgents.value.some(
          (a: { value: string; title: string }) =>
            a.value === aiAgentData.value.selectedAiAgent
        )
      ) {
        const selectedAgent = response.find(
          (a: { ai_agent_id: string; name: string }) =>
            a.ai_agent_id === aiAgentData.value.selectedAiAgent
        );
        if (selectedAgent) {
          aiAgents.value.unshift({
            value: selectedAgent.ai_agent_id,
            title: selectedAgent.name,
          });
        } else {
          aiAgents.value.unshift({
            value: aiAgentData.value.selectedAiAgent,
            title: aiAgentData.value.selectedAiAgent,
          });
        }
      }
    }
  } catch (error) {
    console.error('Error loading AI agents:', error);
    aiAgents.value = [];
  } finally {
    isLoadingAiAgents.value = false;
  }
};

onMounted(async () => {
  const savedValue = normalizeValue(
    (props.data as AiAgentData)?.selectedAiAgent
  );

  if (savedValue) {
    aiAgentData.value.selectedAiAgent = savedValue;
  }

  await loadAiAgents();

  if (savedValue) {
    aiAgentData.value.selectedAiAgent = savedValue;
    updateNodeData();
  }
});

let isUpdatingFromProps = false;

watch(
  () => (props.data as AiAgentData)?.selectedAiAgent,
  (newValue) => {
    if (isUpdatingFromProps) {
      return;
    }
    const normalized = normalizeValue(newValue);
    if (normalized !== aiAgentData.value.selectedAiAgent) {
      aiAgentData.value.selectedAiAgent = normalized;
      if (normalized && aiAgents.value.length > 0) {
        const agentExists = aiAgents.value.some(
          (a: { value: string; title: string }) => a.value === normalized
        );
        if (!agentExists) {
          loadAiAgents();
        }
      }
    }
  },
  { flush: 'post' }
);

watch(
  () => aiAgentData.value.selectedAiAgent,
  (newValue, oldValue) => {
    if (newValue !== oldValue) {
      updateNodeData();
    }
  },
  { immediate: false }
);

watch(
  () => aiAgentData.value,
  () => {
    updateNodeData();
  },
  { deep: true }
);

const handleAiAgentChange = (value: any) => {
  aiAgentData.value.selectedAiAgent = value ? String(value) : null;
  updateNodeData();
};

const handleRemove = () => {
  const data = props.data as AiAgentData;
  if (data?.onRemove) {
    data.onRemove();
  }
};
</script>

<template>
  <div class="chatbot-ai-agent-node">
    <Handle type="target" :position="Position.Top" class="handle-target" />
    <Handle type="source" :position="Position.Bottom" class="handle-source" />

    <VCard class="ai-agent-card" elevation="2">
      <VCardTitle
        class="d-flex align-center justify-space-between pa-2 node-drag-handle"
      >
        <div class="d-flex align-center ga-2">
          <VIcon icon="tabler-brain" color="primary" size="20" />
          <span class="text-sm font-weight-medium">{{
            t('chatbot_ai_agent')
          }}</span>
        </div>
        <VIcon
          v-if="(props.data as AiAgentData)?.onRemove"
          icon="tabler-x"
          size="18"
          color="error"
          class="cursor-pointer"
          @click.stop="handleRemove"
        />
      </VCardTitle>

      <VCardText class="pa-3">
        <VLabel class="text-body-2 mb-1"
          >{{ t('chatbot_ai_agent_select') }}:</VLabel
        >
        <AppSelectSearch
          :model-value="aiAgentData.selectedAiAgent"
          :items="aiAgents"
          :placeholder="t('chatbot_ai_agent_placeholder')"
          :loading="isLoadingAiAgents"
          :clearable="true"
          item-value="value"
          item-title="title"
          @update:model-value="handleAiAgentChange"
        />
      </VCardText>
    </VCard>
  </div>
</template>

<style scoped>
.chatbot-ai-agent-node {
  min-width: 350px;
}

.ai-agent-card {
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
