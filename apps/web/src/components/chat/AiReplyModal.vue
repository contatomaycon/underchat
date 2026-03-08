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
const audioSpeed = ref(1);
const NUM_BARS = 64;
const defaultWaveform = new Array(NUM_BARS).fill(0.3);

const audioProgress = computed(() =>
  audioDuration.value > 0
    ? (audioCurrentTime.value / audioDuration.value) * 100
    : 0
);

const audioSpeedLabel = computed(() => {
  if (audioSpeed.value === 1.5) return '1.5x';
  if (audioSpeed.value === 2) return '2x';
  return '1x';
});

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const displayTime = computed(() => {
  if (audioCurrentTime.value > 0) return formatTime(audioCurrentTime.value);
  if (audioDuration.value > 0) return formatTime(audioDuration.value);
  return '0:00';
});

const cleanupAudioPlayer = () => {
  if (audioPlayer.value) {
    audioPlayer.value.pause();
    audioPlayer.value.src = '';
    audioPlayer.value = null;
  }
  isAudioPlaying.value = false;
  audioCurrentTime.value = 0;
  audioDuration.value = 0;
  audioSpeed.value = 1;
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
    audioPlayer.value.playbackRate = audioSpeed.value;
    audioPlayer.value.play().catch(() => {
      isAudioPlaying.value = false;
    });
  }
};

const toggleAudioSpeed = () => {
  if (audioSpeed.value === 1) audioSpeed.value = 1.5;
  else if (audioSpeed.value === 1.5) audioSpeed.value = 2;
  else audioSpeed.value = 1;

  if (audioPlayer.value) {
    audioPlayer.value.playbackRate = audioSpeed.value;
  }
};

const seekAudio = (event: MouseEvent) => {
  const container = event.currentTarget as HTMLElement;
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const percentage = Math.max(0, Math.min(1, clickX / rect.width));

  const url = generatedResult.value?.audio_url;
  if (!url) return;

  if (!audioPlayer.value) {
    // Create the player if it doesn't exist yet
    toggleAudioPlay();
    if (audioPlayer.value) {
      (audioPlayer.value as HTMLAudioElement).pause();
      isAudioPlaying.value = false;
    }
  }

  const audio = audioPlayer.value;
  if (audio && audio.duration && Number.isFinite(audio.duration)) {
    audio.currentTime = percentage * audio.duration;
    audioCurrentTime.value = audio.currentTime;
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
                class="ai-audio-player d-flex align-center gap-2 pa-2 rounded"
                style="
                  border: 1px solid
                    rgba(var(--v-border-color), var(--v-border-opacity));
                  background-color: rgb(var(--v-theme-surface));
                "
              >
                <button
                  class="ai-audio-speed-btn"
                  @click.stop="toggleAudioSpeed"
                >
                  {{ audioSpeedLabel }}
                </button>
                <VBtn
                  icon
                  size="36"
                  variant="text"
                  color="primary"
                  @click="toggleAudioPlay"
                >
                  <VIcon size="20">{{
                    isAudioPlaying
                      ? 'tabler-player-pause'
                      : 'tabler-player-play'
                  }}</VIcon>
                </VBtn>
                <div
                  class="ai-audio-waveform-container"
                  @click="seekAudio($event)"
                >
                  <div class="ai-audio-waveform">
                    <div
                      v-for="(barValue, index) in defaultWaveform"
                      :key="`ai-bar-${index}`"
                      class="ai-audio-waveform-bar"
                      :class="{
                        'ai-audio-waveform-bar--active':
                          audioProgress >
                          (index / defaultWaveform.length) * 100,
                      }"
                      :style="{
                        height: `${Math.max(8, barValue * 100)}%`,
                      }"
                    ></div>
                  </div>
                  <div
                    class="ai-audio-progress-indicator"
                    :style="{ left: `${audioProgress}%` }"
                  ></div>
                </div>
                <span
                  class="text-caption text-medium-emphasis"
                  style="min-inline-size: 36px; text-align: end"
                >
                  {{ displayTime }}
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

<style lang="scss" scoped>
.ai-audio-speed-btn {
  font-size: 12px;
  font-weight: 600;
  min-width: 36px;
  padding: 2px 6px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.7);
  transition: background 0.2s ease;

  &:hover {
    background: rgba(var(--v-theme-on-surface), 0.14);
  }
}

.ai-audio-waveform-container {
  position: relative;
  flex: 1 1 auto;
  height: 36px;
  display: flex;
  align-items: center;
  overflow: hidden;
  min-width: 100px;
  cursor: pointer;
}

.ai-audio-waveform {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 3px;
  padding: 6px 0;
  z-index: 1;
  height: 100%;
  width: 100%;
}

.ai-audio-waveform-bar {
  flex: 1 1 0;
  min-width: 3px;
  max-width: 4px;
  min-height: 4px;
  background: rgba(var(--v-theme-on-surface), 0.25);
  border-radius: 2px;
  transition:
    background 0.2s ease,
    height 0.1s ease;
}

.ai-audio-waveform-bar--active {
  background: rgb(var(--v-theme-primary));
}

.ai-audio-progress-indicator {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: rgb(var(--v-theme-primary));
  transform: translateX(-50%);
  z-index: 2;
  border-radius: 1px;
}
</style>
