<script lang="ts" setup>
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useChatStore } from '@/@webcore/stores/chat';
import type { ListMessageResult } from '@core/schema/chat/listMessageChats/response.schema';

const props = defineProps<{
  modelValue: boolean;
  message: ListMessageResult | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const { t } = useI18n();
const chatStore = useChatStore();

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const isTranscribing = ref(false);
const transcription = ref('');
const isCached = ref(false);
const hasError = ref(false);
const copied = ref(false);

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      transcription.value = '';
      isCached.value = false;
      hasError.value = false;
      isTranscribing.value = false;
      copied.value = false;
      startTranscription();
    }
  }
);

const close = () => {
  isOpen.value = false;
};

const startTranscription = async () => {
  if (!props.message || !chatStore.activeChat?.chat_id) return;

  const existingTranscription = props.message.content?.audio?.transcription;
  if (existingTranscription) {
    transcription.value = existingTranscription;
    isCached.value = true;
    return;
  }

  isTranscribing.value = true;
  hasError.value = false;

  const result = await chatStore.transcribeAudio(
    chatStore.activeChat.chat_id,
    props.message.message_id
  );

  isTranscribing.value = false;

  if (result) {
    transcription.value = result.transcription;
    isCached.value = result.cached;
  } else {
    hasError.value = true;
  }
};

const copyToClipboard = async () => {
  if (!transcription.value) return;
  await navigator.clipboard.writeText(transcription.value);
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 2000);
};
</script>

<template>
  <VDialog
    :model-value="isOpen"
    max-width="500"
    :persistent="isTranscribing"
    @update:model-value="isOpen = $event"
  >
    <DialogCloseBtn :disabled="isTranscribing" @click="close" />

    <VCard :title="t('chat_transcribe_title')">
      <VCardText>
        <!-- Loading state -->
        <div v-if="isTranscribing" class="text-center py-4">
          <VProgressCircular indeterminate color="primary" size="48" />
          <p class="text-body-2 text-medium-emphasis mt-3 mb-0">
            {{ t('chat_transcribe_processing') }}
          </p>
        </div>

        <!-- Error state -->
        <VAlert v-else-if="hasError" type="error">
          {{ t('chat_transcribe_error') }}
          <template #append>
            <VBtn variant="tonal" size="small" @click="startTranscription">
              {{ t('chat_transcribe_retry') }}
            </VBtn>
          </template>
        </VAlert>

        <!-- Result -->
        <div v-else-if="transcription">
          <div class="d-flex align-center justify-space-between mb-2">
            <VChip v-if="isCached" size="x-small" color="info" variant="tonal">
              {{ t('chat_transcribe_cached') }}
            </VChip>
            <VSpacer />
            <VBtn
              variant="text"
              size="small"
              :color="copied ? 'success' : 'default'"
              @click="copyToClipboard"
            >
              <VIcon start size="16">{{
                copied ? 'tabler-check' : 'tabler-copy'
              }}</VIcon>
              {{
                copied ? t('chat_transcribe_copied') : t('chat_transcribe_copy')
              }}
            </VBtn>
          </div>
          <div
            class="pa-3 rounded"
            style="
              border: 1px solid
                rgba(var(--v-border-color), var(--v-border-opacity));
              background-color: rgb(var(--v-theme-surface));
            "
          >
            <p
              class="text-body-2 mb-0"
              style="white-space: pre-wrap; word-break: break-word"
            >
              {{ transcription }}
            </p>
          </div>
        </div>
      </VCardText>

      <VCardText class="d-flex justify-end">
        <VBtn variant="tonal" color="secondary" @click="close">
          {{ t('close') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>
