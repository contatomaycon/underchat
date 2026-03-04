<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { EMessageType } from '@core/common/enums/EMessageType';
import { useI18n } from 'vue-i18n';
import DialogCloseBtn from '@/@webcore/components/DialogCloseBtn.vue';

interface MessageData {
  messageType:
    | EMessageType.text
    | EMessageType.image
    | EMessageType.audio
    | EMessageType.video
    | EMessageType.document
    | null;
  text: string;
  attachmentFile: File | null;
  attachmentUrl?: string | null;
  attachmentMimetype?: string | null;
  attachmentDuration?: number | null;
  attachmentWidth?: number | null;
  attachmentHeight?: number | null;
  continueType: 'automatic' | 'after_response' | null;
  onRemove?: () => void;
}

const props = defineProps<NodeProps>();
const { t } = useI18n();

const ACCEPTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const ACCEPTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];
const ACCEPTED_VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogg'];
const ACCEPTED_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/ogg'];
const ACCEPTED_AUDIO_EXTENSIONS = [
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.flac',
  '.opus',
];
const ACCEPTED_AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/flac',
  'audio/opus',
];

const MAX_FILE_SIZE = 16 * 1024 * 1024;

const getInitialData = (): MessageData => {
  const data = props.data as MessageData | undefined;
  return {
    messageType: data?.messageType || null,
    text: data?.text || '',
    attachmentFile: data?.attachmentFile || null,
    attachmentUrl: data?.attachmentUrl || null,
    attachmentMimetype: data?.attachmentMimetype || null,
    attachmentDuration: data?.attachmentDuration || null,
    attachmentWidth: data?.attachmentWidth || null,
    attachmentHeight: data?.attachmentHeight || null,
    continueType: data?.continueType || null,
  };
};

const messageData = ref<MessageData>(getInitialData());
const fileInputRef = ref<HTMLInputElement | null>(null);
const filePreview = ref<string | null>(null);
const fileSizeError = ref<string | null>(null);

const previewDialog = ref<{
  open: boolean;
  src: string | null;
  caption: string | null;
  type: EMessageType | null;
}>({
  open: false,
  src: null,
  caption: null,
  type: null,
});

const audioPreviewRef = ref<HTMLAudioElement | null>(null);
const isAudioPlaying = ref(false);
const audioProgress = ref(0);
const audioDuration = ref(0);
const audioCurrentTime = ref(0);
const audioWaveformBars = ref<number[]>([]);

const messageTypeOptions = computed(() => [
  {
    value: EMessageType.text,
    title: t('message_type_text'),
  },
  {
    value: EMessageType.image,
    title: t('message_type_image'),
  },
  {
    value: EMessageType.audio,
    title: t('message_type_audio'),
  },
  {
    value: EMessageType.video,
    title: t('message_type_video'),
  },
  {
    value: EMessageType.document,
    title: t('message_type_document'),
  },
]);

const continueOptions = computed(() => [
  {
    value: 'automatic',
    title: t('chatbot_message_continue_automatic'),
  },
  {
    value: 'after_response',
    title: t('chatbot_message_continue_after_response'),
  },
]);

const maxTextLength = computed(() => {
  return messageData.value.messageType === EMessageType.text ? 2000 : 500;
});

const textLength = computed(() => messageData.value.text.length);

const acceptedFileTypes = computed(() => {
  if (messageData.value.messageType === EMessageType.image) {
    return `${ACCEPTED_IMAGE_MIME_TYPES.join(',')},${ACCEPTED_IMAGE_EXTENSIONS.join(',')}`;
  }
  if (messageData.value.messageType === EMessageType.video) {
    return `${ACCEPTED_VIDEO_MIME_TYPES.join(',')},${ACCEPTED_VIDEO_EXTENSIONS.join(',')}`;
  }
  if (messageData.value.messageType === EMessageType.audio) {
    return `${ACCEPTED_AUDIO_MIME_TYPES.join(',')},${ACCEPTED_AUDIO_EXTENSIONS.join(',')}`;
  }
  if (messageData.value.messageType === EMessageType.document) {
    return '*/*';
  }
  return '';
});

const showAttachment = computed(() => {
  return (
    messageData.value.messageType === EMessageType.image ||
    messageData.value.messageType === EMessageType.audio ||
    messageData.value.messageType === EMessageType.video ||
    messageData.value.messageType === EMessageType.document
  );
});

const attachmentDisplayName = computed(() => {
  if (messageData.value.messageType === EMessageType.image) {
    return t('chatbot_message_image');
  }
  if (messageData.value.messageType === EMessageType.video) {
    return t('chatbot_message_video');
  }
  if (messageData.value.messageType === EMessageType.audio) {
    return t('chatbot_message_audio');
  }
  if (messageData.value.messageType === EMessageType.document) {
    return t('chatbot_message_document');
  }
  return '';
});

const showTextarea = computed(() => {
  return messageData.value.messageType !== null;
});

const updateNodeData = () => {
  if (props.data) {
    const data = props.data as MessageData;
    data.messageType = messageData.value.messageType;
    data.text = messageData.value.text;
    data.attachmentFile = messageData.value.attachmentFile;
    data.attachmentUrl = messageData.value.attachmentUrl;
    data.attachmentMimetype = messageData.value.attachmentMimetype;
    data.attachmentDuration = messageData.value.attachmentDuration;
    data.attachmentWidth = messageData.value.attachmentWidth;
    data.attachmentHeight = messageData.value.attachmentHeight;
    data.continueType = messageData.value.continueType;
  }
};

function getExt(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : '';
}

function isAllowedFile(file: File): boolean {
  const ext = getExt(file.name);
  if (messageData.value.messageType === EMessageType.image) {
    return (
      ACCEPTED_IMAGE_EXTENSIONS.includes(`.${ext}`) ||
      ACCEPTED_IMAGE_MIME_TYPES.includes(file.type)
    );
  }
  if (messageData.value.messageType === EMessageType.video) {
    return (
      ACCEPTED_VIDEO_EXTENSIONS.includes(`.${ext}`) ||
      ACCEPTED_VIDEO_MIME_TYPES.includes(file.type)
    );
  }
  if (messageData.value.messageType === EMessageType.audio) {
    return (
      ACCEPTED_AUDIO_EXTENSIONS.includes(`.${ext}`) ||
      ACCEPTED_AUDIO_MIME_TYPES.includes(file.type)
    );
  }
  if (messageData.value.messageType === EMessageType.document) {
    return true;
  }
  return false;
}

const onFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const files = target.files;
  fileSizeError.value = null;

  if (!files || files.length === 0) {
    messageData.value.attachmentFile = null;
    filePreview.value = null;
    if (fileInputRef.value) {
      fileInputRef.value.value = '';
    }
    return;
  }

  const file = files[0];

  if (!isAllowedFile(file)) {
    fileSizeError.value = t('chatbot_message_invalid_file_format');
    messageData.value.attachmentFile = null;
    filePreview.value = null;
    if (fileInputRef.value) {
      fileInputRef.value.value = '';
    }
    return;
  }

  if (file.size > MAX_FILE_SIZE) {
    fileSizeError.value = t('chatbot_message_file_too_large');
    messageData.value.attachmentFile = null;
    filePreview.value = null;
    if (fileInputRef.value) {
      fileInputRef.value.value = '';
    }
    return;
  }

  messageData.value.attachmentFile = file;
  filePreview.value = URL.createObjectURL(file);
  updateNodeData();
};

const removeFile = () => {
  if (filePreview.value && filePreview.value.startsWith('blob:')) {
    URL.revokeObjectURL(filePreview.value);
  }
  messageData.value.attachmentFile = null;
  messageData.value.attachmentUrl = null;
  messageData.value.attachmentMimetype = null;
  messageData.value.attachmentDuration = null;
  messageData.value.attachmentWidth = null;
  messageData.value.attachmentHeight = null;
  filePreview.value = null;
  fileSizeError.value = null;
  if (fileInputRef.value) {
    fileInputRef.value.value = '';
  }
  updateNodeData();
};

const openPreview = () => {
  if (!filePreview.value || !messageData.value.messageType) return;
  if (messageData.value.messageType === EMessageType.document) return;
  previewDialog.value = {
    open: true,
    src: filePreview.value,
    caption: messageData.value.text || null,
    type: messageData.value.messageType,
  };
  if (messageData.value.messageType === EMessageType.audio) {
    nextTick(() => {
      if (audioPreviewRef.value) {
        audioPreviewRef.value.load();
      }
    });
  }
};

const closePreview = () => {
  if (audioPreviewRef.value) {
    audioPreviewRef.value.pause();
    audioPreviewRef.value.currentTime = 0;
  }
  isAudioPlaying.value = false;
  audioProgress.value = 0;
  audioDuration.value = 0;
  audioCurrentTime.value = 0;
  audioWaveformBars.value = [];
  previewDialog.value = {
    open: false,
    src: null,
    caption: null,
    type: null,
  };
};

const toggleAudioPreview = () => {
  if (!audioPreviewRef.value) return;

  if (isAudioPlaying.value) {
    audioPreviewRef.value.pause();
    return;
  }

  audioPreviewRef.value.play().catch(() => {
    isAudioPlaying.value = false;
  });
};

const updateAudioProgress = () => {
  if (!audioPreviewRef.value) return;
  audioCurrentTime.value = audioPreviewRef.value.currentTime;
  if (audioDuration.value > 0) {
    audioProgress.value =
      (audioPreviewRef.value.currentTime / audioDuration.value) * 100;
  }
};

const updateAudioDuration = () => {
  if (!audioPreviewRef.value) return;
  audioDuration.value = audioPreviewRef.value.duration;
  if (!audioWaveformBars.value.length) {
    audioWaveformBars.value = createDefaultWaveform();
  }
};

const createDefaultWaveform = (): number[] => {
  return new Array(64).fill(0.3);
};

const formatAudioTime = (seconds: number): string => {
  if (!seconds || Number.isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const audioTimeDisplay = computed(() => {
  if (isAudioPlaying.value) {
    return `${formatAudioTime(audioCurrentTime.value)} / ${formatAudioTime(
      audioDuration.value
    )}`;
  }
  return formatAudioTime(audioDuration.value);
});

onUnmounted(() => {
  if (filePreview.value) {
    URL.revokeObjectURL(filePreview.value);
  }
  closePreview();
});

const handleRemove = () => {
  const data = props.data as MessageData;
  if (data?.onRemove) {
    data.onRemove();
  }
};

watch(
  () => (props.data as MessageData)?.attachmentUrl,
  (newUrl) => {
    if (newUrl && !filePreview.value) {
      filePreview.value = newUrl;
    }
    if (!newUrl && filePreview.value && !messageData.value.attachmentFile) {
      filePreview.value = null;
    }
  },
  { immediate: true }
);

watch(
  () => messageData.value.messageType,
  (newType, oldType) => {
    if (oldType !== undefined && oldType !== newType) {
      removeFile();
    }
    updateNodeData();
  }
);

watch(
  () => messageData.value,
  () => {
    updateNodeData();
  },
  { deep: true }
);
</script>

<template>
  <div class="chatbot-message-node">
    <Handle
      id="target"
      type="target"
      :position="Position.Top"
      class="handle-target"
    />
    <Handle
      id="source"
      type="source"
      :position="Position.Bottom"
      class="handle-source"
    />

    <VCard class="message-card" elevation="2">
      <VCardTitle
        class="d-flex align-center justify-space-between pa-2 node-drag-handle"
      >
        <div class="d-flex align-center ga-2">
          <VIcon icon="tabler-message" color="success" size="20" />
          <span class="text-sm font-weight-medium">{{
            t('chatbot_message')
          }}</span>
        </div>
        <VIcon
          v-if="(props.data as MessageData)?.onRemove"
          icon="tabler-x"
          size="18"
          color="error"
          class="cursor-pointer"
          @click.stop="handleRemove"
        />
      </VCardTitle>

      <VCardText class="pa-3">
        <VSelect
          v-model="messageData.messageType"
          :items="messageTypeOptions"
          :label="t('chatbot_message_type')"
          variant="outlined"
          density="compact"
          class="mb-3"
          hide-details
        />

        <div v-if="showAttachment" class="mb-3">
          <VLabel class="mb-1 text-body-2">{{
            t('chatbot_message_attach_file')
          }}</VLabel>
          <input
            ref="fileInputRef"
            type="file"
            :accept="acceptedFileTypes"
            style="display: none"
            @change="onFileChange"
          />
          <div
            v-if="!filePreview && !messageData.attachmentUrl"
            class="d-flex align-center ga-2"
          >
            <VBtn
              variant="outlined"
              color="primary"
              size="small"
              @click="fileInputRef?.click()"
            >
              <VIcon icon="tabler-paperclip" size="18" class="me-1" />
              {{ t('chatbot_message_attach') }}
            </VBtn>
          </div>
          <div
            v-else-if="filePreview || messageData.attachmentUrl"
            class="d-flex flex-column ga-2"
          >
            <div class="d-flex align-center ga-2">
              <span class="text-body-2 text-truncate" style="flex: 1">
                {{ attachmentDisplayName }}
              </span>
              <VBtn
                icon
                size="small"
                variant="text"
                color="error"
                @click="removeFile"
              >
                <VIcon icon="tabler-x" size="18" />
              </VBtn>
            </div>
            <VCard
              v-if="filePreview || messageData.attachmentUrl"
              class="pa-1 cursor-pointer"
              :style="
                messageData.messageType === EMessageType.audio
                  ? 'width: 100%'
                  : 'max-width: 100px'
              "
              @click="openPreview"
            >
              <VImg
                v-if="messageData.messageType === EMessageType.image"
                :src="(filePreview || messageData.attachmentUrl) ?? undefined"
                max-width="100"
                max-height="75"
                aspect-ratio="4/3"
                cover
                class="rounded cursor-pointer"
                style="object-fit: cover"
              />
              <div
                v-else-if="messageData.messageType === EMessageType.video"
                class="position-relative rounded cursor-pointer"
                style="
                  width: 100px;
                  height: 75px;
                  background: rgba(var(--v-theme-surface-variant), 0.1);
                "
              >
                <video
                  :src="(filePreview || messageData.attachmentUrl) ?? undefined"
                  class="rounded"
                  preload="metadata"
                  muted
                  playsinline
                  style="
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    pointer-events: none;
                  "
                >
                  <track kind="captions" />
                </video>
                <div
                  class="position-absolute d-flex align-center justify-center"
                  style="
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    z-index: 1;
                    pointer-events: none;
                  "
                >
                  <VIcon
                    icon="tabler-player-play-filled"
                    size="20"
                    color="white"
                    style="filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.5))"
                  />
                </div>
              </div>
              <div
                v-else-if="messageData.messageType === EMessageType.audio"
                class="d-flex align-center gap-2 pa-2"
                style="
                  background: rgba(var(--v-theme-surface-variant), 0.1);
                  border-radius: 8px;
                  width: 100%;
                "
              >
                <VIcon icon="tabler-music" size="20" class="flex-shrink-0" />
                <div
                  class="flex-grow-1 d-flex align-center gap-1"
                  style="min-width: 0; flex: 1; overflow: hidden"
                >
                  <span
                    class="text-caption text-truncate"
                    style="flex: 0 1 auto"
                  >
                    {{ attachmentDisplayName }}
                  </span>
                  <span
                    class="text-caption text-medium-emphasis"
                    style="
                      font-size: 0.7rem;
                      white-space: nowrap;
                      flex-shrink: 0;
                    "
                  >
                    {{ t('chatbot_message_click_to_preview') }}
                  </span>
                </div>
                <VIcon
                  icon="tabler-player-play-filled"
                  size="18"
                  class="flex-shrink-0"
                />
              </div>
              <div
                v-else-if="messageData.messageType === EMessageType.document"
                class="d-flex align-center gap-2 pa-2"
                style="
                  background: rgba(var(--v-theme-surface-variant), 0.1);
                  border-radius: 8px;
                  width: 100%;
                "
              >
                <VIcon
                  icon="tabler-file-text"
                  size="20"
                  class="flex-shrink-0"
                />
                <div
                  class="flex-grow-1 d-flex align-center gap-1"
                  style="min-width: 0; flex: 1; overflow: hidden"
                >
                  <span
                    class="text-caption text-truncate"
                    style="flex: 0 1 auto"
                  >
                    {{ attachmentDisplayName }}
                  </span>
                </div>
              </div>
            </VCard>
          </div>
          <div v-if="fileSizeError" class="text-caption text-error mt-1">
            {{ fileSizeError }}
          </div>
        </div>

        <div v-if="showTextarea" class="mb-3">
          <VTextarea
            v-model="messageData.text"
            :placeholder="
              messageData.messageType === EMessageType.text
                ? t('chatbot_message_text_placeholder')
                : t('chatbot_message_caption_placeholder')
            "
            variant="outlined"
            density="compact"
            rows="3"
            :counter="maxTextLength"
            :maxlength="maxTextLength"
            hide-details="auto"
          />
        </div>

        <VSelect
          v-model="messageData.continueType"
          :items="continueOptions"
          :label="t('chatbot_message_continue')"
          variant="outlined"
          density="compact"
          hide-details
        />
      </VCardText>
    </VCard>

    <VDialog v-model="previewDialog.open" max-width="800">
      <DialogCloseBtn @click="closePreview" />
      <VCard :title="t('preview')">
        <VCardText>
          <VImg
            v-if="
              previewDialog.src && previewDialog.type === EMessageType.image
            "
            :src="previewDialog.src"
            max-height="420"
            class="rounded"
            contain
          />
          <video
            v-if="
              previewDialog.src && previewDialog.type === EMessageType.video
            "
            :src="previewDialog.src"
            max-height="600"
            class="rounded"
            style="width: 100%"
            controls
          >
            <track kind="captions" />
          </video>
          <div
            v-if="
              previewDialog.src && previewDialog.type === EMessageType.audio
            "
            class="d-flex flex-column align-center pa-6"
          >
            <div class="audio-preview-container w-100">
              <div class="audio-waveform-container mb-4">
                <div class="audio-waveform">
                  <div
                    v-for="(bar, index) in audioWaveformBars"
                    :key="index"
                    class="audio-waveform-bar"
                    :class="{
                      'audio-waveform-bar--active':
                        audioProgress >
                        (index / audioWaveformBars.length) * 100,
                    }"
                    :style="{
                      height: `${Math.max(10, bar * 100)}%`,
                    }"
                  ></div>
                </div>
                <div
                  class="audio-progress-indicator"
                  :style="{
                    left: `${audioProgress}%`,
                  }"
                ></div>
              </div>
              <div class="d-flex align-center justify-center gap-4 w-100">
                <VBtn
                  :icon="
                    isAudioPlaying
                      ? 'tabler-player-pause'
                      : 'tabler-player-play'
                  "
                  variant="flat"
                  color="primary"
                  size="large"
                  @click="toggleAudioPreview"
                />
                <div class="flex-grow-1">
                  <audio
                    ref="audioPreviewRef"
                    :src="previewDialog.src"
                    @timeupdate="updateAudioProgress"
                    @loadedmetadata="updateAudioDuration"
                    @play="isAudioPlaying = true"
                    @pause="isAudioPlaying = false"
                    @ended="isAudioPlaying = false"
                  />
                  <div class="text-caption text-center">
                    {{ audioTimeDisplay }}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-if="previewDialog.caption" class="mt-4 text-center">
            <p class="text-body-2 text-medium-emphasis font-italic">
              {{ previewDialog.caption }}
            </p>
          </div>
        </VCardText>
      </VCard>
    </VDialog>
  </div>
</template>

<style scoped>
.chatbot-message-node {
  min-width: 350px;
}

.message-card {
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

.audio-preview-container {
  max-width: 600px;
}

.audio-waveform-container {
  position: relative;
  width: 100%;
  height: 80px;
  background: rgba(var(--v-theme-surface-variant), 0.1);
  border-radius: 8px;
  overflow: hidden;
}

.audio-waveform {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 100%;
  padding: 0 8px;
}

.audio-waveform-bar {
  flex: 1;
  background: rgba(var(--v-theme-primary), 0.3);
  border-radius: 2px;
  min-height: 10%;
  transition: background 0.2s;
}

.audio-waveform-bar--active {
  background: rgb(var(--v-theme-primary));
}

.audio-progress-indicator {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: rgb(var(--v-theme-primary));
  pointer-events: none;
  z-index: 1;
}
</style>
