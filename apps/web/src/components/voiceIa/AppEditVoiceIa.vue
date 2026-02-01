<script lang="ts" setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useVoiceIaStore } from '@/@webcore/stores/voiceIa';
import { requiredValidator } from '@/@webcore/utils/validators';
import { VForm } from 'vuetify/components/VForm';
import { EVoiceIaStatus } from '@core/common/enums/EVoiceIaStatus';
import {
  ELEVENLABS_MODELS,
  ELEVENLABS_LANGUAGES,
  ELEVENLABS_SPEED_OPTIONS,
  ELEVENLABS_STABILITY_OPTIONS,
  ELEVENLABS_SIMILARITY_OPTIONS,
  ELEVENLABS_STYLE_OPTIONS,
} from './ELEVENLABS_OPTIONS';
import { ELEVENLABS_VOICES_PT_BR } from './ELEVENLABS_VOICES_PT_BR';

const voiceIaStore = useVoiceIaStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  voiceIaId: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
  (e: 'updated'): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const voiceIaIdRef = computed(() => props.voiceIaId);

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
const isUpdating = ref(false);
const isLoading = ref(false);
const isApiKeyVisible = ref(false);
const refForm = ref<VForm>();

const nameRules = computed(() => [
  requiredValidator(name.value, t('name_required')),
]);

const voiceIdRules = computed(() => [
  requiredValidator(voiceId.value, t('voice_ia_voice_required')),
]);

const loadVoiceIa = async () => {
  if (!voiceIaIdRef.value) return;

  isLoading.value = true;
  const data = await voiceIaStore.viewVoiceIa(voiceIaIdRef.value);
  isLoading.value = false;

  if (data) {
    name.value = data.name;
    apiKey.value = data.api_key ?? '';
    voiceId.value = data.voice_id;
    modelId.value = data.model_id;
    languageCode.value =
      data.language_code === 'pt-BR' ? 'pt' : data.language_code;
    speed.value = data.speed;
    stability.value = data.stability;
    similarityBoost.value = data.similarity_boost;
    styleExaggeration.value = data.style_exaggeration;
    status.value = data.status as EVoiceIaStatus;
  }
};

const handleUpdate = async () => {
  const validateForm = await refForm.value?.validate();
  if (!validateForm?.valid || !voiceIaIdRef.value) return;

  isUpdating.value = true;
  try {
    const result = await voiceIaStore.updateVoiceIa(voiceIaIdRef.value, {
      name: name.value.trim(),
      api_key: apiKey.value.trim() || undefined,
      voice_id: voiceId.value,
      model_id: modelId.value,
      speed: speed.value,
      stability: stability.value,
      similarity_boost: similarityBoost.value,
      style_exaggeration: styleExaggeration.value,
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

watch(
  () => [isVisible.value, voiceIaIdRef.value],
  ([visible, id]) => {
    if (visible && id) {
      loadVoiceIa();
    }
  }
);

onMounted(() => {
  if (isVisible.value && voiceIaIdRef.value) {
    loadVoiceIa();
  }
});
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
        <span>{{ $t('edit') }} {{ $t('voice_ia') }}</span>
        <VBtn
          icon
          size="small"
          variant="text"
          @click="isVisible = false"
          :disabled="isUpdating"
        >
          <VIcon icon="tabler-x" />
        </VBtn>
      </VCardTitle>
      <VDivider />
      <VCardText class="pa-4">
        <VForm ref="refForm" @submit.prevent="handleUpdate">
          <VRow>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('voice_ia_type') }}:</VLabel
              >
              <AppTextField model-value="ElevenLabs" disabled />
            </VCol>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
              <AppTextField
                v-model="name"
                :placeholder="$t('voice_ia_name_placeholder')"
                :rules="nameRules"
                :disabled="isUpdating"
                autofocus
              />
            </VCol>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('voice_ia_api_key') }}:</VLabel
              >
              <AppTextField
                v-model="apiKey"
                :type="isApiKeyVisible ? 'text' : 'password'"
                :placeholder="$t('voice_ia_api_key_placeholder')"
                :disabled="isUpdating"
                :append-inner-icon="
                  isApiKeyVisible ? 'tabler-eye-off' : 'tabler-eye'
                "
                @click:append-inner="isApiKeyVisible = !isApiKeyVisible"
              />
            </VCol>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('voice_ia_language') }}:</VLabel
              >
              <AppSelect
                v-model="languageCode"
                :items="ELEVENLABS_LANGUAGES"
                item-title="title"
                item-value="value"
                :disabled="isUpdating"
              />
            </VCol>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('voice_ia_voice') }}:</VLabel
              >
              <AppSelectSearch
                v-model="voiceId"
                :items="ELEVENLABS_VOICES_PT_BR"
                item-title="title"
                item-value="value"
                :placeholder="$t('voice_ia_voice_placeholder')"
                :rules="voiceIdRules"
                :disabled="isUpdating"
              />
            </VCol>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('voice_ia_model') }}:</VLabel
              >
              <AppSelect
                v-model="modelId"
                :items="ELEVENLABS_MODELS"
                item-title="title"
                item-value="value"
                :disabled="isUpdating"
              />
            </VCol>
            <VCol cols="6">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('voice_ia_speed') }}:</VLabel
              >
              <AppSelect
                v-model="speed"
                :items="ELEVENLABS_SPEED_OPTIONS"
                item-title="title"
                item-value="value"
                :disabled="isUpdating"
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
                :disabled="isUpdating"
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
                :disabled="isUpdating"
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
                :disabled="isUpdating"
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
                :disabled="isUpdating"
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
          :disabled="isUpdating"
        >
          {{ $t('cancel') }}
        </VBtn>
        <VBtn color="primary" :loading="isUpdating" @click="handleUpdate">
          {{ $t('save') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>
