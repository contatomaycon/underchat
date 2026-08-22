<script lang="ts" setup>
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useVoiceIaStore } from '@/@webcore/stores/voiceIa';
import { requiredValidator } from '@/@webcore/utils/validators';
import { VForm } from 'vuetify/components/VForm';
import { EVoiceIaStatus } from '@core/common/enums/EVoiceIaStatus';
import { EVoiceIaType } from '@core/common/enums/EVoiceIaType';
import {
  ELEVENLABS_MODELS,
  ELEVENLABS_LANGUAGES,
  ELEVENLABS_SPEED_OPTIONS,
  ELEVENLABS_STABILITY_OPTIONS,
  ELEVENLABS_SIMILARITY_OPTIONS,
  ELEVENLABS_STYLE_OPTIONS,
} from './ELEVENLABS_OPTIONS';
import { ELEVENLABS_VOICES_PT_BR } from './ELEVENLABS_VOICES_PT_BR';
import { GPT_VOICES, GPT_TTS_MODELS } from './GPT_OPTIONS';
import { GEMINI_VOICES, GEMINI_TTS_MODELS } from './GEMINI_OPTIONS';

const voiceIaStore = useVoiceIaStore();
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

const voiceIaType = ref<EVoiceIaType>(EVoiceIaType.eleven_labs);
const name = ref('');
const apiKey = ref('');
const voiceId = ref('');
const modelId = ref('eleven_multilingual_v2');
const languageCode = ref('pt');
const speed = ref('1');
const stability = ref('0.5');
const similarityBoost = ref('0.75');
const styleExaggeration = ref('0');
const status = ref<EVoiceIaStatus>(EVoiceIaStatus.active);

const isGpt = computed(() => voiceIaType.value === EVoiceIaType.gpt);
const isGemini = computed(() => voiceIaType.value === EVoiceIaType.gemini);
const isElevenLabs = computed(
  () => voiceIaType.value === EVoiceIaType.eleven_labs
);

const voiceIaTypeItems = computed(() => [
  { title: t('voice_ia_type_eleven_labs'), value: EVoiceIaType.eleven_labs },
  { title: t('voice_ia_type_gpt'), value: EVoiceIaType.gpt },
  { title: t('voice_ia_type_gemini'), value: EVoiceIaType.gemini },
]);

const modelIdItems = computed(() => {
  if (isGpt.value) return GPT_TTS_MODELS;
  if (isGemini.value) return GEMINI_TTS_MODELS;
  return ELEVENLABS_MODELS;
});

const isCreating = ref(false);
const refForm = ref<VForm>();

const nameRules = computed(() => [
  requiredValidator(name.value, t('name_required')),
]);

const apiKeyRules = computed(() => [
  requiredValidator(apiKey.value, t('voice_ia_api_key_required')),
]);

const voiceIdRules = computed(() => [
  requiredValidator(voiceId.value, t('voice_ia_voice_required')),
]);

const handleCreate = async () => {
  const validateForm = await refForm.value?.validate();
  if (!validateForm?.valid) return;

  isCreating.value = true;
  try {
    const payload = {
      name: name.value.trim(),
      api_key: apiKey.value.trim(),
      voice_ia_type: voiceIaType.value,
      voice_id: voiceId.value,
      model_id: modelId.value,
      status: status.value,
    };
    if (isElevenLabs.value) {
      Object.assign(payload, {
        speed: speed.value,
        stability: stability.value,
        similarity_boost: similarityBoost.value,
        style_exaggeration: styleExaggeration.value,
      });
    }
    const result = await voiceIaStore.addVoiceIa(payload);

    if (result) {
      isVisible.value = false;
      emit('created');
    }
  } finally {
    isCreating.value = false;
  }
};

const resetForm = () => {
  voiceIaType.value = EVoiceIaType.eleven_labs;
  name.value = '';
  apiKey.value = '';
  voiceId.value = '';
  modelId.value = 'eleven_multilingual_v2';
  languageCode.value = 'pt';
  speed.value = '1';
  stability.value = '0.5';
  similarityBoost.value = '0.75';
  styleExaggeration.value = '0';
  status.value = EVoiceIaStatus.active;
  refForm.value?.resetValidation();
};

watch(voiceIaType, (newType) => {
  if (newType === EVoiceIaType.gpt) {
    voiceId.value = 'alloy';
    modelId.value = 'tts-1';
    return;
  }
  if (newType === EVoiceIaType.gemini) {
    voiceId.value = 'Kore';
    modelId.value = 'gemini-3.1-flash-tts-preview';
    return;
  }
  voiceId.value = '';
  modelId.value = 'eleven_multilingual_v2';
});

watch(isVisible, (newValue) => {
  if (newValue) {
    resetForm();
  }
});
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
        <span>{{ $t('add') }} {{ $t('voice_ia') }}</span>
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
        <VForm ref="refForm" @submit.prevent="handleCreate">
          <VRow>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('voice_ia_type') }}:</VLabel
              >
              <AppSelect
                v-model="voiceIaType"
                :items="voiceIaTypeItems"
                item-title="title"
                item-value="value"
                :disabled="isCreating"
              />
            </VCol>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
              <AppTextField
                v-model="name"
                :placeholder="$t('voice_ia_name_placeholder')"
                :rules="nameRules"
                :disabled="isCreating"
                autofocus
              />
            </VCol>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('voice_ia_api_key') }}:</VLabel
              >
              <AppTextField
                v-model="apiKey"
                type="password"
                :placeholder="$t('voice_ia_api_key_placeholder')"
                :rules="apiKeyRules"
                :disabled="isCreating"
              />
            </VCol>
            <VCol v-if="isElevenLabs" cols="12">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('voice_ia_language') }}:</VLabel
              >
              <AppSelect
                v-model="languageCode"
                :items="ELEVENLABS_LANGUAGES"
                item-title="title"
                item-value="value"
                :disabled="isCreating"
              />
            </VCol>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('voice_ia_voice') }}:</VLabel
              >
              <AppSelectSearch
                v-if="isElevenLabs"
                v-model="voiceId"
                :items="ELEVENLABS_VOICES_PT_BR"
                item-title="title"
                item-value="value"
                :placeholder="$t('voice_ia_voice_placeholder')"
                :rules="voiceIdRules"
                :disabled="isCreating"
              />
              <AppSelect
                v-else-if="isGpt"
                v-model="voiceId"
                :items="GPT_VOICES"
                item-title="title"
                item-value="value"
                :placeholder="$t('voice_ia_voice_placeholder')"
                :rules="voiceIdRules"
                :disabled="isCreating"
              />
              <AppSelect
                v-else
                v-model="voiceId"
                :items="GEMINI_VOICES"
                item-title="title"
                item-value="value"
                :placeholder="$t('voice_ia_voice_placeholder')"
                :rules="voiceIdRules"
                :disabled="isCreating"
              />
            </VCol>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('voice_ia_model') }}:</VLabel
              >
              <AppSelect
                v-model="modelId"
                :items="modelIdItems"
                item-title="title"
                item-value="value"
                :disabled="isCreating"
              />
            </VCol>
            <template v-if="isElevenLabs">
              <VCol cols="6">
                <VLabel class="text-body-2 mb-1"
                  >{{ $t('voice_ia_speed') }}:</VLabel
                >
                <AppSelect
                  v-model="speed"
                  :items="ELEVENLABS_SPEED_OPTIONS"
                  item-title="title"
                  item-value="value"
                  :disabled="isCreating"
                />
              </VCol>
              <VCol cols="6">
                <VLabel class="text-body-2 mb-1"
                  >{{ $t('voice_ia_stability') }}:</VLabel
                >
                <AppSelect
                  v-model="stability"
                  :items="ELEVENLABS_STABILITY_OPTIONS"
                  item-title="title"
                  item-value="value"
                  :disabled="isCreating"
                />
              </VCol>
              <VCol cols="6">
                <VLabel class="text-body-2 mb-1"
                  >{{ $t('voice_ia_similarity') }}:</VLabel
                >
                <AppSelect
                  v-model="similarityBoost"
                  :items="ELEVENLABS_SIMILARITY_OPTIONS"
                  item-title="title"
                  item-value="value"
                  :disabled="isCreating"
                />
              </VCol>
              <VCol cols="6">
                <VLabel class="text-body-2 mb-1"
                  >{{ $t('voice_ia_style_exaggeration') }}:</VLabel
                >
                <AppSelect
                  v-model="styleExaggeration"
                  :items="ELEVENLABS_STYLE_OPTIONS"
                  item-title="title"
                  item-value="value"
                  :disabled="isCreating"
                />
              </VCol>
            </template>
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
        <VBtn color="primary" :loading="isCreating" @click="handleCreate">
          {{ $t('add') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>
