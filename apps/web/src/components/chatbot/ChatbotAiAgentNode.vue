<script setup lang="ts">
import { ref, watch, onMounted, nextTick, computed } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position, useVueFlow } from '@vue-flow/core';
import { useChatbotStore } from '@/@webcore/stores/chatbot';
import { useI18n } from 'vue-i18n';

interface AiAgentOption {
  id: string;
  text: string;
  required?: boolean;
}

interface AiAgentData {
  selectedAiAgent: string | null;
  defaultQuestion: string | null;
  continueMessage: string | null;
  options: AiAgentOption[];
  actionAfterInteractions?: boolean | null;
  interactionsQuantity?: number | null;
  humanSupportEnabled?: boolean | null;
  onRemove?: () => void;
  onRemoveOption?: (optionId: string) => void;
  onRemoveInteractionsEdge?: () => void;
  onRemoveHumanSupportEdge?: () => void;
}

const props = defineProps<NodeProps>();
const chatbotStore = useChatbotStore();
const { t } = useI18n();
const { updateNodeInternals } = useVueFlow();

const normalizeValue = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.toString().trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getInitialData = (): AiAgentData => {
  const data = props.data as AiAgentData | undefined;
  const selectedAiAgent = normalizeValue(data?.selectedAiAgent);
  const defaultQuestion = normalizeValue(data?.defaultQuestion) || null;
  const continueMessage =
    normalizeValue(data?.continueMessage) ||
    t('chatbot_ai_agent_continue_option') ||
    null;
  const actionAfterInteractions = data?.actionAfterInteractions ?? true;
  const interactionsQuantity = data?.interactionsQuantity ?? 5;
  const humanSupportEnabled = data?.humanSupportEnabled ?? false;
  const defaultOptions: AiAgentOption[] = [
    {
      id: 'positive-option',
      text: t('chatbot_ai_agent_positive_option'),
      required: true,
    },
    {
      id: 'negative-option',
      text: t('chatbot_ai_agent_negative_option'),
      required: true,
    },
  ];

  let options: AiAgentOption[] = defaultOptions;
  if (
    data?.options &&
    Array.isArray(data.options) &&
    data.options.length === 2
  ) {
    const hasPositiveOption = data.options.some(
      (opt) =>
        opt.text === t('chatbot_ai_agent_positive_option') ||
        opt.id === 'positive-option'
    );
    const hasNegativeOption = data.options.some(
      (opt) =>
        opt.text === t('chatbot_ai_agent_negative_option') ||
        opt.id === 'negative-option'
    );

    if (hasPositiveOption && hasNegativeOption) {
      const mappedOptions: AiAgentOption[] = [];

      for (const opt of data.options) {
        if (
          opt.text === t('chatbot_ai_agent_positive_option') ||
          opt.id === 'positive-option'
        ) {
          mappedOptions.push({
            id: 'positive-option',
            text: t('chatbot_ai_agent_positive_option'),
            required: true,
          });
        } else if (
          opt.text === t('chatbot_ai_agent_negative_option') ||
          opt.id === 'negative-option'
        ) {
          mappedOptions.push({
            id: 'negative-option',
            text: t('chatbot_ai_agent_negative_option'),
            required: true,
          });
        }
      }

      if (mappedOptions.length === 2) {
        options = mappedOptions;
      } else {
        options = defaultOptions;
      }
    } else {
      options = defaultOptions;
    }
  }

  if (data) {
    if (data.selectedAiAgent === undefined) {
      data.selectedAiAgent = selectedAiAgent;
    }
    if (data.defaultQuestion === undefined) {
      data.defaultQuestion = defaultQuestion;
    }
    if (data.continueMessage === undefined) {
      data.continueMessage =
        continueMessage || t('chatbot_ai_agent_continue_option');
    }
    if (data.actionAfterInteractions === undefined) {
      data.actionAfterInteractions = actionAfterInteractions;
    }
    if (data.interactionsQuantity === undefined) {
      data.interactionsQuantity = interactionsQuantity;
    }
    if (data.humanSupportEnabled === undefined) {
      data.humanSupportEnabled = humanSupportEnabled;
    }
    data.options = options;
  }

  return {
    selectedAiAgent,
    defaultQuestion,
    continueMessage,
    options,
    actionAfterInteractions,
    interactionsQuantity,
    humanSupportEnabled,
  };
};

const aiAgentData = ref<AiAgentData>(getInitialData());

const aiAgents = ref<Array<{ value: string; title: string }>>([]);
const isLoadingAiAgents = ref(false);

const onlyDigits = (s: string) => s.replaceAll(/\D+/g, '');

const interactionsQuantityComputed = computed({
  get: () => {
    const value = aiAgentData.value.interactionsQuantity;
    return value !== null && value !== undefined ? String(value) : '5';
  },
  set: (value: string) => {
    const numericValue = onlyDigits(value);
    aiAgentData.value.interactionsQuantity = numericValue
      ? Number(numericValue)
      : 5;
  },
});

const showInteractionsFields = computed(() => {
  return aiAgentData.value.actionAfterInteractions === true;
});

const showHumanSupportHandler = computed(() => {
  return aiAgentData.value.humanSupportEnabled === true;
});

const humanSupportEnabledComputed = computed({
  get: () => {
    return aiAgentData.value.humanSupportEnabled ?? false;
  },
  set: (value: boolean) => {
    aiAgentData.value.humanSupportEnabled = value;
    if (!value && props.data?.onRemoveHumanSupportEdge) {
      props.data.onRemoveHumanSupportEdge();
    }
  },
});

const actionAfterInteractionsComputed = computed({
  get: () => {
    return aiAgentData.value.actionAfterInteractions ?? true;
  },
  set: (value: boolean) => {
    aiAgentData.value.actionAfterInteractions = value;
  },
});

const buildOptionHandleId = (optionId: string) => {
  return `option-${optionId}-source`;
};

const updateNodeData = () => {
  if (!props.data) {
    return;
  }
  isUpdatingFromProps = true;
  const data = props.data as AiAgentData;
  const newSelectedValue = aiAgentData.value.selectedAiAgent;
  const newDefaultQuestion = aiAgentData.value.defaultQuestion;
  const newContinueMessage = aiAgentData.value.continueMessage;
  const newActionAfterInteractions = aiAgentData.value.actionAfterInteractions;
  const newInteractionsQuantity = aiAgentData.value.interactionsQuantity;
  const newHumanSupportEnabled = aiAgentData.value.humanSupportEnabled;
  const newOptions = [...aiAgentData.value.options];

  data.selectedAiAgent = newSelectedValue;
  data.defaultQuestion = newDefaultQuestion;
  data.continueMessage = newContinueMessage;
  data.actionAfterInteractions = newActionAfterInteractions;
  data.interactionsQuantity = newInteractionsQuantity;
  data.humanSupportEnabled = newHumanSupportEnabled;
  data.options = newOptions;

  nextTick(() => {
    isUpdatingFromProps = false;
    updateNodeInternals([props.id]);
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
  const savedSelectedValue = normalizeValue(
    (props.data as AiAgentData)?.selectedAiAgent
  );
  const savedDefaultQuestion = normalizeValue(
    (props.data as AiAgentData)?.defaultQuestion
  );
  const savedContinueMessage = normalizeValue(
    (props.data as AiAgentData)?.continueMessage
  );
  const savedActionAfterInteractions = (props.data as AiAgentData)
    ?.actionAfterInteractions;
  const savedInteractionsQuantity = (props.data as AiAgentData)
    ?.interactionsQuantity;

  if (savedSelectedValue) {
    aiAgentData.value.selectedAiAgent = savedSelectedValue;
  }

  if (savedDefaultQuestion) {
    aiAgentData.value.defaultQuestion = savedDefaultQuestion;
  } else if (
    aiAgentData.value.defaultQuestion === null ||
    aiAgentData.value.defaultQuestion === undefined
  ) {
    aiAgentData.value.defaultQuestion = t('chatbot_ai_agent_default_question');
  }

  if (savedContinueMessage) {
    aiAgentData.value.continueMessage = savedContinueMessage;
  } else if (
    aiAgentData.value.continueMessage === null ||
    aiAgentData.value.continueMessage === undefined
  ) {
    aiAgentData.value.continueMessage = t('chatbot_ai_agent_continue_option');
  }

  if (
    savedActionAfterInteractions !== undefined &&
    savedActionAfterInteractions !== null
  ) {
    aiAgentData.value.actionAfterInteractions = savedActionAfterInteractions;
  } else {
    aiAgentData.value.actionAfterInteractions = true;
  }

  if (
    savedInteractionsQuantity !== undefined &&
    savedInteractionsQuantity !== null
  ) {
    aiAgentData.value.interactionsQuantity = savedInteractionsQuantity;
  } else {
    aiAgentData.value.interactionsQuantity = 5;
  }

  const savedHumanSupportEnabled = (props.data as AiAgentData)
    ?.humanSupportEnabled;

  if (
    savedHumanSupportEnabled !== null &&
    savedHumanSupportEnabled !== undefined
  ) {
    aiAgentData.value.humanSupportEnabled = savedHumanSupportEnabled;
  } else {
    aiAgentData.value.humanSupportEnabled = false;
  }

  if (
    !aiAgentData.value.options ||
    aiAgentData.value.options.length !== 2 ||
    !aiAgentData.value.options.some(
      (opt) =>
        opt.text === t('chatbot_ai_agent_positive_option') ||
        opt.id === 'positive-option'
    ) ||
    !aiAgentData.value.options.some(
      (opt) =>
        opt.text === t('chatbot_ai_agent_negative_option') ||
        opt.id === 'negative-option'
    )
  ) {
    aiAgentData.value.options = [
      {
        id: 'positive-option',
        text: t('chatbot_ai_agent_positive_option'),
        required: true,
      },
      {
        id: 'negative-option',
        text: t('chatbot_ai_agent_negative_option'),
        required: true,
      },
    ];
  }

  await loadAiAgents();

  if (savedSelectedValue) {
    aiAgentData.value.selectedAiAgent = savedSelectedValue;
    updateNodeData();
  } else {
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
  () => (props.data as AiAgentData)?.defaultQuestion,
  (newValue) => {
    if (isUpdatingFromProps) {
      return;
    }
    const normalized = normalizeValue(newValue);
    if (normalized !== aiAgentData.value.defaultQuestion) {
      aiAgentData.value.defaultQuestion = normalized;
    }
  },
  { flush: 'post' }
);

watch(
  () => (props.data as AiAgentData)?.continueMessage,
  (newValue) => {
    if (isUpdatingFromProps) {
      return;
    }
    const normalized = normalizeValue(newValue);
    if (normalized !== aiAgentData.value.continueMessage) {
      aiAgentData.value.continueMessage = normalized;
    }
  },
  { flush: 'post' }
);

watch(
  () => (props.data as AiAgentData)?.actionAfterInteractions,
  (newValue) => {
    if (isUpdatingFromProps) {
      return;
    }
    if (newValue !== aiAgentData.value.actionAfterInteractions) {
      aiAgentData.value.actionAfterInteractions = newValue ?? null;
    }
  },
  { flush: 'post' }
);

watch(
  () => (props.data as AiAgentData)?.interactionsQuantity,
  (newValue) => {
    if (isUpdatingFromProps) {
      return;
    }
    if (newValue !== aiAgentData.value.interactionsQuantity) {
      aiAgentData.value.interactionsQuantity = newValue ?? 5;
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
  () => aiAgentData.value.defaultQuestion,
  (newValue, oldValue) => {
    if (newValue !== oldValue) {
      updateNodeData();
    }
  },
  { immediate: false }
);

watch(
  () => aiAgentData.value.continueMessage,
  (newValue, oldValue) => {
    if (newValue !== oldValue) {
      updateNodeData();
    }
  },
  { immediate: false }
);

watch(
  () => aiAgentData.value.actionAfterInteractions,
  (newValue, oldValue) => {
    if (newValue !== oldValue) {
      if (newValue === false) {
        const data = props.data as AiAgentData;
        const removeInteractionsEdge = data?.onRemoveInteractionsEdge;

        if (removeInteractionsEdge) {
          removeInteractionsEdge();
        }
      }
      updateNodeData();
    }
  },
  { immediate: false }
);

watch(
  () => aiAgentData.value.interactionsQuantity,
  (newValue, oldValue) => {
    if (newValue !== oldValue) {
      updateNodeData();
    }
  },
  { immediate: false }
);

watch(
  () => aiAgentData.value.humanSupportEnabled,
  (newValue, oldValue) => {
    if (newValue !== oldValue) {
      if (newValue === false) {
        const data = props.data as AiAgentData;
        const removeHumanSupportEdge = data?.onRemoveHumanSupportEdge;

        if (removeHumanSupportEdge) {
          removeHumanSupportEdge();
        }
      }
      updateNodeData();
    }
  },
  { immediate: false }
);

watch(
  () => (props.data as AiAgentData)?.humanSupportEnabled,
  (newValue) => {
    if (isUpdatingFromProps) {
      return;
    }
    if (newValue !== aiAgentData.value.humanSupportEnabled) {
      aiAgentData.value.humanSupportEnabled = newValue ?? false;
    }
  },
  { flush: 'post' }
);

watch(
  () => aiAgentData.value.humanSupportEnabled,
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

watch(
  () => (props.data as AiAgentData)?.options,
  (newOptions) => {
    if (isUpdatingFromProps) {
      return;
    }
    if (newOptions && newOptions.length > 0) {
      aiAgentData.value.options = [...newOptions];
    }
  },
  { deep: true, flush: 'post' }
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
    <Handle id="target" type="target" :position="Position.Top" class="handle-target" />

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
        <VLabel class="text-body-2 mb-1">{{
          t('chatbot_ai_agent_select')
        }}</VLabel>
        <AppSelectSearch
          :model-value="aiAgentData.selectedAiAgent"
          :items="aiAgents"
          :placeholder="t('chatbot_ai_agent_placeholder')"
          :loading="isLoadingAiAgents"
          :clearable="true"
          item-value="value"
          item-title="title"
          class="mb-3"
          @update:model-value="handleAiAgentChange"
        />
        <VLabel class="text-body-2 mb-1"
          >{{ t('chatbot_ai_agent_default_question_label') }}:</VLabel
        >
        <VTextField
          v-model="aiAgentData.defaultQuestion"
          :placeholder="t('chatbot_ai_agent_default_question_placeholder')"
          variant="outlined"
          density="compact"
          class="mb-3"
          hide-details="auto"
        />
        <VLabel class="text-body-2 mb-1">{{
          t('chatbot_ai_agent_continue_message_label')
        }}</VLabel>
        <VTextField
          v-model="aiAgentData.continueMessage"
          :placeholder="t('chatbot_ai_agent_continue_message_placeholder')"
          variant="outlined"
          density="compact"
          class="mb-1"
          hide-details="auto"
        />
        <div v-if="aiAgentData.options.length > 0" class="options-list nodrag">
          <div
            v-for="(option, index) in aiAgentData.options"
            :key="option.id"
            class="option-item nodrag"
          >
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
        <VLabel class="text-body-2 mb-1">{{
          t('chatbot_ai_agent_action_after_interactions_label')
        }}</VLabel>
        <AppSelectSearch
          v-model="actionAfterInteractionsComputed"
          :items="[
            { id: true, title: t('yes') },
            { id: false, title: t('no') },
          ]"
          item-value="id"
          item-title="title"
          :clearable="false"
          class="mb-3"
        />
        <div v-if="showInteractionsFields">
          <VLabel class="text-body-2 mb-0">{{
            t('chatbot_ai_agent_interactions_quantity_label')
          }}</VLabel>
          <div class="interactions-quantity-item nodrag">
            <VTextField
              v-model="interactionsQuantityComputed"
              @keydown="
                (e: KeyboardEvent) => {
                  if (
                    !/[0-9]/.test(e.key) &&
                    ![
                      'Backspace',
                      'Delete',
                      'ArrowLeft',
                      'ArrowRight',
                      'Tab',
                    ].includes(e.key)
                  ) {
                    e.preventDefault();
                  }
                }
              "
              @paste.prevent="
                (e: ClipboardEvent) => {
                  const pastedText = e.clipboardData?.getData('text') || '';
                  const numericValue = onlyDigits(pastedText);
                  if (numericValue) {
                    interactionsQuantityComputed = numericValue;
                  }
                }
              "
              variant="outlined"
              density="compact"
              class="interactions-quantity-field"
              hide-details
              inputmode="numeric"
              type="text"
            />
            <Handle
              id="interactions-quantity-source"
              type="source"
              :position="Position.Right"
              class="interactions-handle handle-source"
              @mousedown.stop
              @touchstart.stop
            />
          </div>
        </div>
        <VLabel class="text-body-2 mb-1 mt-2">{{
          t('chatbot_ai_agent_human_support_label')
        }}</VLabel>
        <VLabel
          class="text-caption text-disabled mb-1 human-support-description"
          >{{ t('chatbot_ai_agent_human_support_description') }}</VLabel
        >
        <AppSelectSearch
          v-model="humanSupportEnabledComputed"
          :items="[
            { id: true, title: t('yes') },
            { id: false, title: t('no') },
          ]"
          item-value="id"
          item-title="title"
          :clearable="false"
          class="mb-3"
        />
        <div v-if="showHumanSupportHandler" class="human-support-item nodrag">
          <VTextField
            :model-value="t('chatbot_ai_agent_human_support_placeholder')"
            variant="outlined"
            density="compact"
            class="human-support-field"
            disabled
            hide-details
          />
          <Handle
            id="human-support-source"
            type="source"
            :position="Position.Right"
            class="human-support-handle handle-source"
            @mousedown.stop
            @touchstart.stop
          />
        </div>
        <VLabel class="text-body-2 mb-0 mt-2">{{
          t('chatbot_ai_agent_fallback_label')
        }}</VLabel>
        <VLabel class="text-caption text-disabled mb-1 fallback-description">{{
          t('chatbot_ai_agent_fallback_description')
        }}</VLabel>
        <div class="fallback-item nodrag">
          <VTextField
            :model-value="t('chatbot_ai_agent_fallback_placeholder')"
            variant="outlined"
            density="compact"
            class="fallback-field"
            disabled
            hide-details
          />
          <Handle
            id="fallback-source"
            type="source"
            :position="Position.Right"
            class="fallback-handle handle-source"
            @mousedown.stop
            @touchstart.stop
          />
        </div>
      </VCardText>
    </VCard>
  </div>
</template>

<style scoped>
.chatbot-ai-agent-node {
  width: 350px;
  min-width: 350px;
  max-width: 350px;
}

.ai-agent-card {
  border-radius: 8px;
}

.options-list {
  margin-top: 4px;
}

.option-item {
  padding: 2px 0;
  display: flex;
  align-items: center;
  flex-direction: row;
  gap: 8px;
  margin-bottom: 4px;
  position: relative;
}

.option-item:last-child {
  margin-bottom: 0;
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

.interactions-quantity-item {
  padding: 2px 0;
  display: flex;
  align-items: center;
  flex-direction: row;
  gap: 4px;
  margin-bottom: 8px;
  margin-top: 2px;
  position: relative;
}

.interactions-quantity-field {
  flex: 1;
  min-width: 0;
  margin-right: 12px;
}

.interactions-quantity-field :deep(input) {
  pointer-events: auto;
}

.interactions-handle {
  position: absolute;
  right: -12px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
}

.fallback-item {
  padding: 2px 0;
  display: flex;
  align-items: center;
  flex-direction: row;
  gap: 4px;
  margin-bottom: 8px;
  margin-top: 2px;
  position: relative;
}

.fallback-field {
  flex: 1;
  min-width: 0;
  margin-right: 12px;
}

.fallback-field :deep(input) {
  pointer-events: auto;
}

.fallback-handle {
  position: absolute;
  right: -12px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
}

.fallback-description {
  white-space: normal;
  word-wrap: break-word;
  line-height: 1.4;
}

.human-support-description {
  white-space: normal;
  word-wrap: break-word;
  line-height: 1.4;
}

.human-support-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  position: relative;
}

.human-support-field {
  flex: 1;
}

.human-support-handle {
  position: absolute;
  right: -8px;
  top: 50%;
  transform: translateY(-50%);
}
</style>
