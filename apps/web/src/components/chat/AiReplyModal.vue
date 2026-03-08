<script lang="ts" setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { useChatStore } from '@/@webcore/stores/chat';
import type { ListMessageResult } from '@core/schema/chat/listMessageChats/response.schema';
import type { GenerateAiReplyResponse } from '@core/schema/chat/generateAiReply/response.schema';

const props = defineProps<{
  modelValue: boolean;
  message: ListMessageResult | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  send: [text: string, audioUrl?: string, audioDuration?: number];
}>();

const { t } = useI18n();
const chatStore = useChatStore();

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const responseType = ref<'text' | 'audio'>('text');
const instructions = ref('');
const isGenerating = ref(false);
const generatedResult = ref<GenerateAiReplyResponse | null>(null);
const hasError = ref(false);

// Audio player state
const audioPlayer = ref<HTMLAudioElement | null>(null);
const isAudioPlaying = ref(false);
const audioCurrentTime = ref(0);
const audioDuration = ref(0);

const audioProgress = computed(() =>
  audioDuration.value > 0
    ? (audioCurrentTime.value / audioDuration.value) * 100
    : 0
);

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const cleanupAudioPlayer = () => {
  if (audioPlayer.value) {
    audioPlayer.value.pause();
    audioPlayer.value.src = '';
    audioPlayer.value = null;
  }
  isAudioPlaying.value = false;
  audioCurrentTime.value = 0;
  audioDuration.value = 0;
};

const toggleAudioPlay = () => {
  const url = generatedResult.value?.audio_url;
  if (!url) return;

  if (!audioPlayer.value) {
    const audio = new Audio(url);
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => {
      audioDuration.value = audio.duration || 0;
    });
    audio.addEventListener('timeupdate', () => {
      audioCurrentTime.value = audio.currentTime || 0;
    });
    audio.addEventListener('play', () => {
      isAudioPlaying.value = true;
    });
    audio.addEventListener('pause', () => {
      isAudioPlaying.value = false;
    });
    audio.addEventListener('ended', () => {
      isAudioPlaying.value = false;
      audioCurrentTime.value = 0;
    });
    audioPlayer.value = audio;
  }

  if (isAudioPlaying.value) {
    audioPlayer.value.pause();
  } else {
    audioPlayer.value.play().catch(() => {
      isAudioPlaying.value = false;
    });
  }
};

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      responseType.value = 'text';
      instructions.value = '';
      generatedResult.value = null;
      hasError.value = false;
      isGenerating.value = false;
      cleanupAudioPlayer();
    } else {
      cleanupAudioPlayer();
    }
  }
);

onBeforeUnmount(() => {
  cleanupAudioPlayer();
});

const close = () => {
  isOpen.value = false;
};

const generate = async () => {
  if (!props.message || !chatStore.activeChat?.chat_id) return;

  isGenerating.value = true;
  hasError.value = false;
  generatedResult.value = null;

  const result = await chatStore.generateAiReply(
    chatStore.activeChat.chat_id,
    props.message.message_id,
    responseType.value,
    instructions.value.trim() || undefined
  );

  isGenerating.value = false;

  if (result) {
    generatedResult.value = result;
  } else {
    hasError.value = true;
  }
};

const send = () => {
  if (!generatedResult.value) return;
  emit(
    'send',
    generatedResult.value.text,
    generatedResult.value.audio_url ?? undefined,
    generatedResult.value.audio_duration ?? undefined
  );
  close();
};

const messagePreview = computed(() => {
  if (!props.message) return '';
  const content = props.message.content;
  if (content?.message) return content.message;
  if (content?.type === 'audio')
    return `🎤 ${t('chat_ai_reply_audio_message')}`;
  if (content?.type === 'image')
    return `📷 ${t('chat_ai_reply_image_message')}`;
  if (content?.type === 'document')
    return `📄 ${t('chat_ai_reply_document_message')}`;
  return t('chat_ai_reply_message');
});
</script>

<template>
  <VDialog
    :model-value="isOpen"
    max-width="600"
    :persistent="isGenerating"
    @update:model-value="isOpen = $event"
  >
    <DialogCloseBtn :disabled="isGenerating" @click="close" />

    <VCard :title="t('chat_ai_reply_title')">
      <VCardText>
        <!-- Original message preview -->
        <div
          class="mb-4 pa-3 rounded"
          style="
            border: 1px solid
              rgba(var(--v-border-color), var(--v-border-opacity));
            background-color: rgb(var(--v-theme-surface));
          "
        >
          <span class="text-caption text-medium-emphasis">{{
            t('chat_ai_reply_reference_message')
          }}</span>
          <p class="text-body-2 mt-1 mb-0" style="word-break: break-word">
            {{ messagePreview }}
          </p>
        </div>

        <!-- Response type selector -->
        <VSelect
          v-model="responseType"
          :label="t('chat_ai_reply_response_type')"
          :items="[
            { title: t('chat_ai_reply_type_text'), value: 'text' },
            { title: t('chat_ai_reply_type_audio'), value: 'audio' },
          ]"
          :disabled="isGenerating || !!generatedResult"
          density="comfortable"
          class="mb-4"
        />

        <!-- Optional instructions -->
        <VTextarea
          v-model="instructions"
          :label="t('chat_ai_reply_instructions')"
          :placeholder="t('chat_ai_reply_instructions_placeholder')"
          :disabled="isGenerating"
          rows="2"
          auto-grow
          class="mb-4"
        />

        <!-- Generate / Cancel buttons -->
        <div v-if="!generatedResult" class="d-flex justify-end gap-3">
          <VBtn
            variant="tonal"
            color="secondary"
            :disabled="isGenerating"
            @click="close"
          >
            {{ t('cancel') }}
          </VBtn>
          <VBtn color="primary" :loading="isGenerating" @click="generate">
            <VIcon start>tabler-robot</VIcon>
            {{ t('chat_ai_reply_generate') }}
          </VBtn>
        </div>

        <!-- Loading state -->
        <div v-if="isGenerating" class="text-center mt-3">
          <VProgressLinear indeterminate color="primary" class="mb-2" />
          <span class="text-body-2 text-medium-emphasis">{{
            t('chat_ai_reply_generating')
          }}</span>
        </div>

        <!-- Error state -->
        <VAlert v-if="hasError && !isGenerating" type="error" class="mt-3">
          {{ t('chat_ai_reply_error') }}
        </VAlert>

        <!-- Result preview -->
        <div v-if="generatedResult" class="mt-4">
          <span class="text-caption text-medium-emphasis d-block mb-2">{{
            t('chat_ai_reply_preview')
          }}</span>
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
              {{ generatedResult.text }}
            </p>
            <div v-if="generatedResult.audio_url" class="mt-3">
              <div
                class="d-flex align-center gap-2 pa-2 rounded"
                style="
                  border: 1px solid
                    rgba(var(--v-border-color), var(--v-border-opacity));
                  background-color: rgb(var(--v-theme-surface));
                "
              >
                <VBtn
                  icon
                  size="36"
                  variant="tonal"
                  color="primary"
                  @click="toggleAudioPlay"
                >
                  <VIcon size="20">{{
                    isAudioPlaying
                      ? 'tabler-player-pause'
                      : 'tabler-player-play'
                  }}</VIcon>
                </VBtn>
                <div class="flex-1">
                  <VProgressLinear
                    :model-value="audioProgress"
                    color="primary"
                    rounded
                    height="6"
                  />
                </div>
                <span
                  class="text-caption text-medium-emphasis"
                  style="min-inline-size: 36px; text-align: end"
                >
                  {{
                    audioDuration > 0 ? formatTime(audioCurrentTime) : '0:00'
                  }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </VCardText>

      <VCardText
        v-if="generatedResult"
        class="d-flex justify-end flex-wrap gap-2"
      >
        <VBtn variant="tonal" color="secondary" @click="close">
          {{ t('cancel') }}
        </VBtn>
        <VBtn
          variant="tonal"
          color="warning"
          @click="
            generatedResult = null;
            hasError = false;
          "
        >
          <VIcon start>tabler-refresh</VIcon>
          {{ t('chat_ai_reply_regenerate') }}
        </VBtn>
        <VBtn color="primary" @click="send">
          <VIcon start>tabler-send</VIcon>
          {{ t('chat_ai_reply_send') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>
