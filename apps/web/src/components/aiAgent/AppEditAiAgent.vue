<script lang="ts" setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAiAgentStore } from '@/@webcore/stores/aiAgent';
import { requiredValidator } from '@/@webcore/utils/validators';
import { VForm } from 'vuetify/components/VForm';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { ListAiAgentTypeResponse } from '@core/schema/aiAgent/listAiAgentType/response.schema';
import AppInfoTooltip from '@/components/AppInfoTooltip.vue';

const aiAgentStore = useAiAgentStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  aiAgentId: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
  (e: 'updated'): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const aiAgentId = computed(() => props.aiAgentId);
const aiAgentTypeId = ref<string>('');
const name = ref('');
const baseUrl = ref('');
const apiKey = ref('');
const model = ref('');
const embeddingModel = ref('');
const chunkSize = ref('600');
const chunkOverlap = ref('100');
const status = ref<EAiAgentStatus>(EAiAgentStatus.active);
const isUpdating = ref(false);
const isLoading = ref(false);
const isApiKeyVisible = ref(false);
const refForm = ref<VForm>();
const types = ref<ListAiAgentTypeResponse[]>([]);
const otherTypes = ref<ListAiAgentTypeResponse[]>([]);

const nameRules = computed(() => [
  requiredValidator(name.value, t('name_required')),
]);

const typeRules = computed(() => [
  requiredValidator(aiAgentTypeId.value, t('ai_agent_type_required')),
]);

const loadTypes = async () => {
  const result = await aiAgentStore.listAiAgentTypes();
  if (result) {
    types.value = result;
    otherTypes.value = result.filter(
      (type) =>
        type.ai_agent_type_id !== EAiAgentType.gpt &&
        type.ai_agent_type_id !== EAiAgentType.gemini &&
        type.ai_agent_type_id !== EAiAgentType.deepseek
    );
  }
};

const isGeminiSelected = computed(
  () => aiAgentTypeId.value === EAiAgentType.gemini
);
const isGptSelected = computed(() => aiAgentTypeId.value === EAiAgentType.gpt);
const isDeepSeekSelected = computed(
  () => aiAgentTypeId.value === EAiAgentType.deepseek
);

const geminiChatModels = [
  {
    title: 'gemini-2.5-pro (raciocínio avançado)',
    value: 'gemini-2.5-pro',
  },
  {
    title: 'gemini-2.5-flash (recomendado - mais recente)',
    value: 'gemini-2.5-flash',
  },
  {
    title: 'gemini-2.5-flash-lite (variante menor)',
    value: 'gemini-2.5-flash-lite',
  },
  { title: 'gemini-2.0-flash (2ª geração)', value: 'gemini-2.0-flash' },
  { title: 'gemini-2.0-flash-001 (stable)', value: 'gemini-2.0-flash-001' },
  {
    title: 'gemini-2.0-flash-lite (variante menor)',
    value: 'gemini-2.0-flash-lite',
  },
  {
    title: 'gemini-2.0-flash-lite-001 (stable)',
    value: 'gemini-2.0-flash-lite-001',
  },
];

const geminiEmbeddingModels = [
  {
    title: 'gemini-embedding-001 (recomendado)',
    value: 'gemini-embedding-001',
  },
  { title: 'embedding-001 (legacy)', value: 'embedding-001' },
];

const gptChatModels = [
  { title: 'gpt-5.2 (mais recente)', value: 'gpt-5.2' },
  { title: 'gpt-5.2-pro (mais preciso)', value: 'gpt-5.2-pro' },
  { title: 'gpt-5.1', value: 'gpt-5.1' },
  { title: 'gpt-5-pro', value: 'gpt-5-pro' },
  { title: 'gpt-5', value: 'gpt-5' },
  { title: 'gpt-5-mini (variante menor)', value: 'gpt-5-mini' },
  { title: 'gpt-5-nano (mais econômico)', value: 'gpt-5-nano' },
  { title: 'gpt-4.1', value: 'gpt-4.1' },
  { title: 'gpt-4.1-mini', value: 'gpt-4.1-mini' },
  { title: 'gpt-4.1-nano', value: 'gpt-4.1-nano' },
  { title: 'gpt-4o', value: 'gpt-4o' },
  { title: 'gpt-4o-mini', value: 'gpt-4o-mini' },
  { title: 'gpt-4-turbo (legacy)', value: 'gpt-4-turbo' },
  { title: 'gpt-4 (legacy)', value: 'gpt-4' },
  { title: 'gpt-3.5-turbo (legacy)', value: 'gpt-3.5-turbo' },
];

const gptEmbeddingModels = [
  {
    title: 'text-embedding-3-small (recomendado)',
    value: 'text-embedding-3-small',
  },
  { title: 'text-embedding-3-large', value: 'text-embedding-3-large' },
  { title: 'text-embedding-ada-002 (legacy)', value: 'text-embedding-ada-002' },
];

const deepseekChatModels = [
  { title: 'deepseek-chat (recomendado)', value: 'deepseek-chat' },
  { title: 'deepseek-coder', value: 'deepseek-coder' },
];

const availableChatModels = computed(() => {
  if (isGeminiSelected.value) {
    return geminiChatModels;
  }
  if (isGptSelected.value) {
    return gptChatModels;
  }
  if (isDeepSeekSelected.value) {
    return deepseekChatModels;
  }
  return [];
});

const availableEmbeddingModels = computed(() => {
  if (isGeminiSelected.value) {
    return geminiEmbeddingModels;
  }
  if (isGptSelected.value) {
    return gptEmbeddingModels;
  }
  return [];
});

const shouldUseSelectForModel = computed(
  () =>
    isGeminiSelected.value || isGptSelected.value || isDeepSeekSelected.value
);

const shouldUseSelectForEmbeddingModel = computed(
  () => isGeminiSelected.value || isGptSelected.value
);

const shouldDisableBaseUrl = computed(
  () =>
    isGeminiSelected.value || isGptSelected.value || isDeepSeekSelected.value
);

const apiKeyLink = computed(() => {
  if (isGeminiSelected.value) {
    return 'https://aistudio.google.com/app/apikey?utm_source=chatgpt.com';
  }
  if (isGptSelected.value) {
    return 'https://platform.openai.com/api-keys?utm_source=chatgpt.com';
  }
  if (isDeepSeekSelected.value) {
    return 'https://platform.deepseek.com/api_keys';
  }
  return null;
});

const loadAiAgent = async () => {
  if (!aiAgentId.value) {
    return;
  }

  const result = await aiAgentStore.viewAiAgent(aiAgentId.value);
  if (result) {
    aiAgentTypeId.value = result.ai_agent_type_id;
    name.value = result.name;
    baseUrl.value = result.base_url || '';
    apiKey.value = result.api_key || '';
    model.value = result.model || '';
    embeddingModel.value = result.embedding_model || '';
    chunkSize.value = result.chunk_size || '600';
    chunkOverlap.value = result.chunk_overlap || '100';
    status.value = result.status;
  }
};

watch(aiAgentTypeId, (newTypeId) => {
  if (newTypeId === EAiAgentType.gpt) {
    if (
      !baseUrl.value ||
      baseUrl.value === 'https://generativelanguage.googleapis.com/v1' ||
      baseUrl.value === 'https://api.deepseek.com/v1'
    ) {
      baseUrl.value = 'https://api.openai.com/v1';
    }
    if (!model.value) {
      model.value = 'gpt-4o';
    }
    if (!embeddingModel.value) {
      embeddingModel.value = 'text-embedding-3-small';
    }
    chunkSize.value = '600';
    chunkOverlap.value = '100';
  } else if (newTypeId === EAiAgentType.gemini) {
    if (
      !baseUrl.value ||
      baseUrl.value === 'https://api.openai.com/v1' ||
      baseUrl.value === 'https://api.deepseek.com/v1'
    ) {
      baseUrl.value = 'https://generativelanguage.googleapis.com/v1';
    }
    if (!model.value) {
      model.value = 'gemini-2.5-flash';
    }
    if (!embeddingModel.value) {
      embeddingModel.value = 'gemini-embedding-001';
    }
    chunkSize.value = '600';
    chunkOverlap.value = '100';
  } else if (newTypeId === EAiAgentType.deepseek) {
    if (
      !baseUrl.value ||
      baseUrl.value === 'https://api.openai.com/v1' ||
      baseUrl.value === 'https://generativelanguage.googleapis.com/v1'
    ) {
      baseUrl.value = 'https://api.deepseek.com/v1';
    }
    if (!model.value) {
      model.value = 'deepseek-chat';
    }
    embeddingModel.value = '';
    chunkSize.value = '600';
    chunkOverlap.value = '100';
  } else if (newTypeId && otherTypes.value.length > 0) {
    const selectedType = types.value.find(
      (type) => type.ai_agent_type_id === newTypeId
    );
    if (
      selectedType &&
      selectedType.name.toLowerCase() !== 'gpt' &&
      selectedType.name.toLowerCase() !== 'gemini' &&
      selectedType.name.toLowerCase() !== 'deepseek'
    ) {
      if (!baseUrl.value) {
        baseUrl.value = '';
      }
      if (!embeddingModel.value) {
        embeddingModel.value = '';
      }
      chunkSize.value = '600';
      chunkOverlap.value = '100';
    }
  }
});

watch(
  isVisible,
  async (newVisible) => {
    if (newVisible && aiAgentId.value) {
      isLoading.value = true;
      await nextTick();
      try {
        await loadTypes();
        await loadAiAgent();
      } finally {
        isLoading.value = false;
      }
    } else if (!newVisible) {
      aiAgentTypeId.value = '';
      name.value = '';
      baseUrl.value = '';
      apiKey.value = '';
      model.value = '';
      embeddingModel.value = '';
      chunkSize.value = '600';
      chunkOverlap.value = '100';
      status.value = EAiAgentStatus.active;
      refForm.value?.resetValidation();
      isApiKeyVisible.value = false;
    }
  },
  { immediate: true }
);

watch(aiAgentId, async (newId, oldId) => {
  if (isVisible.value && newId && newId !== oldId) {
    isLoading.value = true;
    await nextTick();
    try {
      await loadTypes();
      await loadAiAgent();
    } finally {
      isLoading.value = false;
    }
  }
});

onMounted(() => {
  loadTypes();
});

const handleUpdateAiAgent = async () => {
  const validateForm = await refForm.value?.validate();
  if (!validateForm?.valid) return;

  if (!aiAgentId.value) return;

  isUpdating.value = true;
  try {
    const result = await aiAgentStore.updateAiAgent(aiAgentId.value, {
      name: name.value.trim(),
      base_url: baseUrl.value.trim() || undefined,
      api_key: apiKey.value.trim() || undefined,
      model: model.value.trim() || undefined,
      embedding_model: embeddingModel.value.trim() || undefined,
      chunk_size: chunkSize.value.trim() || undefined,
      chunk_overlap: chunkOverlap.value.trim() || undefined,
      status: status.value,
    });

    if (result) {
      isVisible.value = false;
      emit('updated');
    }
  } finally {
    isUpdating.value = false;
  }
};
</script>

<template>
  <VDialog v-model="isVisible" max-width="600" persistent>
    <VOverlay
      :model-value="isUpdating || isLoading"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VCard>
      <VCardTitle class="d-flex align-center justify-space-between pa-4">
        <span>{{ $t('edit') }} {{ $t('ai_agent') }}</span>
        <VBtn
          icon
          size="small"
          variant="text"
          @click="isVisible = false"
          :disabled="isUpdating || isLoading"
        >
          <VIcon icon="tabler-x" />
        </VBtn>
      </VCardTitle>
      <VDivider />
      <VCardText class="pa-4">
        <VForm ref="refForm" @submit.prevent="handleUpdateAiAgent">
          <VRow>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('ai_agent_type') }}:</VLabel
              >
              <AppSelectSearch
                v-model="aiAgentTypeId"
                :items="types"
                item-title="name"
                item-value="ai_agent_type_id"
                :placeholder="$t('select_ai_agent_type')"
                :rules="typeRules"
                :disabled="true"
              />
              <VBtn
                v-if="apiKeyLink"
                variant="text"
                size="small"
                class="mt-1 pa-0"
                :href="apiKeyLink"
                target="_blank"
                rel="noopener noreferrer"
              >
                <VIcon icon="tabler-external-link" size="small" class="me-1" />
                {{ $t('generate_api_key') }}
              </VBtn>
            </VCol>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
              <AppTextField
                v-model="name"
                :placeholder="$t('ai_agent_name_placeholder')"
                :rules="nameRules"
                :disabled="isUpdating || isLoading"
                autofocus
              />
            </VCol>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('base_url') }}:</VLabel>
              <AppTextField
                v-model="baseUrl"
                :placeholder="$t('base_url_placeholder')"
                :disabled="isUpdating || isLoading || shouldDisableBaseUrl"
              />
            </VCol>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('api_key') }}:</VLabel>
              <AppTextField
                v-model="apiKey"
                :type="isApiKeyVisible ? 'text' : 'password'"
                :placeholder="$t('api_key_placeholder')"
                :disabled="isUpdating || isLoading"
                :append-inner-icon="
                  isApiKeyVisible ? 'tabler-eye-off' : 'tabler-eye'
                "
                @click:append-inner="isApiKeyVisible = !isApiKeyVisible"
              />
            </VCol>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('model') }}:</VLabel>
              <AppSelectSearch
                v-if="shouldUseSelectForModel"
                v-model="model"
                :items="availableChatModels"
                item-title="title"
                item-value="value"
                :placeholder="$t('model_placeholder')"
                :disabled="isUpdating || isLoading"
              />
              <AppTextField
                v-else
                v-model="model"
                :placeholder="$t('model_placeholder')"
                :disabled="isUpdating || isLoading"
              />
            </VCol>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('embedding_model') }}:</VLabel
              >
              <AppSelectSearch
                v-if="shouldUseSelectForEmbeddingModel"
                v-model="embeddingModel"
                :items="availableEmbeddingModels"
                item-title="title"
                item-value="value"
                :placeholder="$t('embedding_model_placeholder')"
                :disabled="isUpdating || isLoading"
              />
              <AppTextField
                v-else
                v-model="embeddingModel"
                :placeholder="$t('embedding_model_placeholder')"
                :disabled="isUpdating || isLoading"
              />
            </VCol>
            <VCol cols="6">
              <div class="d-flex align-center gap-1 mb-1">
                <VLabel class="text-body-2">{{ $t('chunk_size') }}:</VLabel>
                <AppInfoTooltip
                  :text="$t('chunk_size_info')"
                  :title="$t('chunk_size')"
                />
              </div>
              <AppTextField
                v-model="chunkSize"
                type="number"
                :placeholder="$t('chunk_size_placeholder')"
                :disabled="isUpdating || isLoading"
              />
            </VCol>
            <VCol cols="6">
              <div class="d-flex align-center gap-1 mb-1">
                <VLabel class="text-body-2">{{ $t('chunk_overlap') }}:</VLabel>
                <AppInfoTooltip
                  :text="$t('chunk_overlap_info')"
                  :title="$t('chunk_overlap')"
                />
              </div>
              <AppTextField
                v-model="chunkOverlap"
                type="number"
                :placeholder="$t('chunk_overlap_placeholder')"
                :disabled="isUpdating || isLoading"
              />
            </VCol>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('status') }}:</VLabel>
              <AppSelect
                v-model="status"
                :items="[
                  { title: $t('active'), value: 'active' },
                  { title: $t('inactive'), value: 'inactive' },
                ]"
                :disabled="isUpdating || isLoading"
              />
            </VCol>
          </VRow>
        </VForm>
      </VCardText>
      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          @click="isVisible = false"
          :disabled="isUpdating || isLoading"
        >
          {{ $t('cancel') }}
        </VBtn>
        <VBtn
          color="primary"
          :loading="isUpdating"
          @click="handleUpdateAiAgent"
        >
          {{ $t('save') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>
