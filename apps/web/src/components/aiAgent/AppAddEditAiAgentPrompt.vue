<script lang="ts" setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAiAgentStore } from '@/@webcore/stores/aiAgent';
import { requiredValidator } from '@/@webcore/utils/validators';
import { VForm } from 'vuetify/components/VForm';
import { EAiAgentPromptType } from '@core/common/enums/EAiAgentPromptType';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';
import { CreateAiAgentPromptRequest } from '@core/schema/aiAgent/createAiAgentPrompt/request.schema';
import { UpdateAiAgentPromptRequest } from '@core/schema/aiAgent/updateAiAgentPrompt/request.schema';

const aiAgentStore = useAiAgentStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  aiAgentId: string | null;
  promptId: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
  (e: 'created'): void;
  (e: 'updated'): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const aiAgentId = computed(() => props.aiAgentId);
const promptId = computed(() => props.promptId);
const isEditMode = computed(() => !!promptId.value);

const promptType = ref<EAiAgentPromptType>(EAiAgentPromptType.text);
const name = ref('');
const value = ref('');
const file = ref<File | null>(null);
const originalFileUrl = ref<string | null>(null);
const hasNewFile = ref(false);
const status = ref<EAiAgentStatus>(EAiAgentStatus.active);
const isSaving = ref(false);
const isLoading = ref(false);
const refForm = ref<VForm>();

const nameRules = computed(() => [
  requiredValidator(name.value, t('name_required')),
]);

const fileRules = computed(() => {
  if (promptType.value === EAiAgentPromptType.file) {
    return [
      (v: File | File[] | null) => {
        if (!v) return t('file_required');
        if (Array.isArray(v)) return v.length > 0 || t('file_required');
        return true;
      },
    ];
  }
  return [];
});

const valueRules = computed(() => {
  if (promptType.value === EAiAgentPromptType.text) {
    return [requiredValidator(value.value, t('value_required'))];
  }
  return [];
});

const isTextType = computed(() => promptType.value === EAiAgentPromptType.text);
const isFileType = computed(() => promptType.value === EAiAgentPromptType.file);

const loadPrompt = async () => {
  if (!promptId.value) return;

  isLoading.value = true;
  try {
    const result = await aiAgentStore.viewAiAgentPrompt(promptId.value);
    if (result) {
      promptType.value = result.ai_agent_prompt_type;
      name.value = result.name;
      value.value = result.value;
      status.value = result.status;

      if (result.ai_agent_prompt_type === EAiAgentPromptType.file) {
        originalFileUrl.value = result.value;
        hasNewFile.value = false;
      }
    }
  } finally {
    isLoading.value = false;
  }
};

const handleFileChange = (files: File[] | File | null) => {
  const selectedFile = Array.isArray(files) ? (files?.[0] ?? null) : files;

  if (selectedFile) {
    file.value = selectedFile;
    hasNewFile.value = true;
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      value.value = content;
    };
    reader.readAsText(selectedFile);
  } else {
    file.value = null;
    hasNewFile.value = false;
    value.value = '';
  }
};

const handleSave = async () => {
  const validateForm = await refForm.value?.validate();
  if (!validateForm?.valid) return;

  if (!aiAgentId.value) return;

  isSaving.value = true;
  try {
    if (isEditMode.value && promptId.value) {
      const updateData: UpdateAiAgentPromptRequest = {
        ai_agent_prompt_type: { value: promptType.value },
        name: { value: name.value.trim() },
        value: isTextType.value ? { value: value.value.trim() } : undefined,
        status: { value: status.value },
      };

      const result = await aiAgentStore.updateAiAgentPrompt(
        promptId.value,
        updateData,
        isFileType.value && hasNewFile.value ? file.value : null
      );

      if (result) {
        isVisible.value = false;
        emit('updated');
      }
    } else {
      const createData: CreateAiAgentPromptRequest = {
        ai_agent_id: { value: aiAgentId.value },
        ai_agent_prompt_type: { value: promptType.value },
        name: { value: name.value.trim() },
        value: isTextType.value ? { value: value.value.trim() } : undefined,
        status: status.value ? { value: status.value } : undefined,
      };

      const result = await aiAgentStore.addAiAgentPrompt(
        createData,
        isFileType.value ? file.value : null
      );

      if (result) {
        isVisible.value = false;
        emit('created');
      }
    }
  } finally {
    isSaving.value = false;
  }
};

watch(promptType, () => {
  if (promptType.value === EAiAgentPromptType.file) {
    value.value = '';
    file.value = null;
    hasNewFile.value = false;
  }
});

watch(isVisible, async (newValue) => {
  if (newValue) {
    if (isEditMode.value) {
      await nextTick();
      await loadPrompt();
    } else {
      promptType.value = EAiAgentPromptType.text;
      name.value = '';
      value.value = '';
      file.value = null;
      originalFileUrl.value = null;
      hasNewFile.value = false;
      status.value = EAiAgentStatus.active;
      refForm.value?.resetValidation();
    }
  }
});

onMounted(() => {
  if (isVisible.value && isEditMode.value) {
    loadPrompt();
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="700" persistent>
    <VOverlay
      :model-value="isSaving || isLoading"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VCard>
      <VCardTitle class="d-flex align-center justify-space-between pa-4">
        <span>
          {{ isEditMode ? $t('edit') : $t('add') }} {{ $t('prompt') }}
        </span>
        <VBtn
          icon
          size="small"
          variant="text"
          @click="isVisible = false"
          :disabled="isSaving || isLoading"
        >
          <VIcon icon="tabler-x" />
        </VBtn>
      </VCardTitle>
      <VDivider />
      <VCardText class="pa-4">
        <VForm ref="refForm" @submit.prevent="handleSave">
          <VRow>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('ai_agent_prompt_type') }}:</VLabel
              >
              <AppSelect
                v-model="promptType"
                :items="[
                  { title: $t('text'), value: EAiAgentPromptType.text },
                  { title: $t('file'), value: EAiAgentPromptType.file },
                ]"
                :disabled="isSaving || isLoading"
              />
            </VCol>

            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
              <AppTextField
                v-model="name"
                :placeholder="$t('prompt_name_placeholder')"
                :rules="nameRules"
                :disabled="isSaving || isLoading"
                autofocus
              />
            </VCol>

            <VCol v-if="isTextType" cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('value') }}:</VLabel>
              <VTextarea
                v-model="value"
                :placeholder="$t('prompt_value_placeholder')"
                :rules="valueRules"
                :disabled="isSaving || isLoading"
                rows="6"
                auto-grow
                variant="outlined"
              />
            </VCol>

            <VCol v-if="isFileType" cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('file') }}:</VLabel>
              <VFileInput
                v-model="file"
                :placeholder="$t('select_file')"
                :rules="fileRules"
                :disabled="isSaving || isLoading"
                show-size
                chips
                clearable
                @update:model-value="handleFileChange"
              />
              <div
                v-if="isEditMode && originalFileUrl && !hasNewFile"
                class="mt-2"
              >
                <a
                  :href="originalFileUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-primary text-decoration-none d-inline-flex align-center gap-1"
                >
                  <VIcon icon="tabler-external-link" size="16" />
                  <span>{{ $t('view_file') }}</span>
                </a>
              </div>
            </VCol>

            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('status') }}:</VLabel>
              <AppSelect
                v-model="status"
                :items="[
                  { title: $t('active'), value: 'active' },
                  { title: $t('inactive'), value: 'inactive' },
                ]"
                :disabled="isSaving || isLoading"
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
          :disabled="isSaving || isLoading"
        >
          {{ $t('cancel') }}
        </VBtn>
        <VBtn color="primary" :loading="isSaving" @click="handleSave">
          {{ isEditMode ? $t('save') : $t('add') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>
