<script lang="ts" setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAiAgentStore } from '@/@webcore/stores/aiAgent';
import { requiredValidator } from '@/@webcore/utils/validators';
import { VForm } from 'vuetify/components/VForm';
import { EAiAgentType } from '@core/common/enums/EAiAgentType';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { ListAiAgentTypeResponse } from '@core/schema/aiAgent/listAiAgentType/response.schema';

const aiAgentStore = useAiAgentStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
  (e: 'created'): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const aiAgentTypeId = ref<string>('');
const name = ref('');
const baseUrl = ref('');
const apiKey = ref('');
const status = ref<EAiAgentStatus>(EAiAgentStatus.active);
const isCreating = ref(false);
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
        type.ai_agent_type_id !== EAiAgentType.gemini
    );
  }
};

watch(aiAgentTypeId, (newTypeId) => {
  if (newTypeId === EAiAgentType.gpt) {
    baseUrl.value = 'https://api.openai.com/v1';
  } else if (newTypeId === EAiAgentType.gemini) {
    baseUrl.value = 'https://generativelanguage.googleapis.com/v1';
  } else if (newTypeId && otherTypes.value.length > 0) {
    const selectedType = types.value.find(
      (type) => type.ai_agent_type_id === newTypeId
    );
    if (
      selectedType &&
      selectedType.name.toLowerCase() !== 'gpt' &&
      selectedType.name.toLowerCase() !== 'gemini'
    ) {
      baseUrl.value = '';
    }
  }
});

watch(isVisible, (newValue) => {
  if (newValue) {
    aiAgentTypeId.value = '';
    name.value = '';
    baseUrl.value = '';
    apiKey.value = '';
    status.value = EAiAgentStatus.active;
    refForm.value?.resetValidation();
    loadTypes();
  }
});

onMounted(() => {
  loadTypes();
});

const handleCreateAiAgent = async () => {
  const validateForm = await refForm.value?.validate();
  if (!validateForm?.valid) return;

  isCreating.value = true;
  try {
    const result = await aiAgentStore.addAiAgent({
      ai_agent_type_id: aiAgentTypeId.value,
      name: name.value.trim(),
      base_url: baseUrl.value.trim() || null,
      api_key: apiKey.value.trim() || null,
      status: status.value,
    });

    if (result) {
      isVisible.value = false;
      emit('created');
    }
  } finally {
    isCreating.value = false;
  }
};
</script>

<template>
  <VDialog v-model="isVisible" max-width="600" persistent>
    <VOverlay
      :model-value="isCreating"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VCard>
      <VCardTitle class="d-flex align-center justify-space-between pa-4">
        <span>{{ $t('add') }} {{ $t('ai_agent') }}</span>
        <VBtn
          icon
          size="small"
          variant="text"
          @click="isVisible = false"
          :disabled="isCreating"
        >
          <VIcon icon="tabler-x" />
        </VBtn>
      </VCardTitle>
      <VDivider />
      <VCardText class="pa-4">
        <VForm ref="refForm" @submit.prevent="handleCreateAiAgent">
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
                :disabled="isCreating"
              />
            </VCol>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
              <AppTextField
                v-model="name"
                :placeholder="$t('ai_agent_name_placeholder')"
                :rules="nameRules"
                :disabled="isCreating"
                autofocus
              />
            </VCol>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('base_url') }}:</VLabel>
              <AppTextField
                v-model="baseUrl"
                :placeholder="$t('base_url_placeholder')"
                :disabled="isCreating"
              />
            </VCol>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('api_key') }}:</VLabel>
              <AppTextField
                v-model="apiKey"
                type="password"
                :placeholder="$t('api_key_placeholder')"
                :disabled="isCreating"
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
                :disabled="isCreating"
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
          :disabled="isCreating"
        >
          {{ $t('cancel') }}
        </VBtn>
        <VBtn
          color="primary"
          :loading="isCreating"
          @click="handleCreateAiAgent"
        >
          {{ $t('add') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>
