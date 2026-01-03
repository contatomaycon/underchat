<script lang="ts" setup>
import { useMessageTemplateStore } from '@/@webcore/stores/messageTemplate';
import { EMessageStatus } from '@core/common/enums/EMessageStatus';
import { EMessageType } from '@core/common/enums/EMessageType';
import { VForm } from 'vuetify/components/VForm';

const messageTemplateStore = useMessageTemplateStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

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

const ACCEPTED_IMAGE_TYPES = `${ACCEPTED_IMAGE_MIME_TYPES.join(',')},${ACCEPTED_IMAGE_EXTENSIONS.join(',')}`;
const ACCEPTED_VIDEO_TYPES = `${ACCEPTED_VIDEO_MIME_TYPES.join(',')},${ACCEPTED_VIDEO_EXTENSIONS.join(',')}`;
const ACCEPTED_AUDIO_TYPES = `${ACCEPTED_AUDIO_MIME_TYPES.join(',')},${ACCEPTED_AUDIO_EXTENSIONS.join(',')}`;

type FilePreview = {
  id: string;
  file: File;
  src: string;
};

const messageTypeOptions = computed(() => [
  {
    id: EMessageType.text,
    title: t('message_type_text'),
  },
  {
    id: EMessageType.image,
    title: t('message_type_image'),
  },
  {
    id: EMessageType.video,
    title: t('message_type_video'),
  },
  {
    id: EMessageType.audio,
    title: t('message_type_audio'),
  },
]);

const itemsStatus = ref([
  { value: EMessageStatus.active, text: t('active') },
  { value: EMessageStatus.inactive, text: t('inactive') },
]);

const itemsAutoSend = ref([
  { value: true, text: t('auto_send_yes') },
  { value: false, text: t('auto_send_no') },
]);

const selectedType = ref<EMessageType>(EMessageType.text);
const message = ref<string | null>(null);
const command = ref<string | null>(null);
const message_status_id = ref<string | null>(EMessageStatus.active);
const auto_send = ref<boolean>(false);
const attachmentFile = ref<File | null>(null);
const filePreview = ref<FilePreview | null>(null);
const fileInputKey = ref(0);
const fileSizeError = ref<string | null>(null);
const isLoading = ref(false);
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

const showTextInput = computed(() => {
  return selectedType.value === EMessageType.text;
});

const showFileInput = computed(() => {
  return [EMessageType.image, EMessageType.video, EMessageType.audio].includes(
    selectedType.value
  );
});

const acceptedFileTypes = computed(() => {
  if (selectedType.value === EMessageType.image) {
    return ACCEPTED_IMAGE_TYPES;
  }
  if (selectedType.value === EMessageType.video) {
    return ACCEPTED_VIDEO_TYPES;
  }
  if (selectedType.value === EMessageType.audio) {
    return ACCEPTED_AUDIO_TYPES;
  }
  return '';
});

const refFormAddMessageTemplate = ref<VForm>();

function getExt(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : '';
}

function isAllowedFile(file: File): boolean {
  const ext = getExt(file.name);
  if (selectedType.value === EMessageType.image) {
    return (
      ACCEPTED_IMAGE_EXTENSIONS.includes(`.${ext}`) ||
      ACCEPTED_IMAGE_MIME_TYPES.includes(file.type)
    );
  }
  if (selectedType.value === EMessageType.video) {
    return (
      ACCEPTED_VIDEO_EXTENSIONS.includes(`.${ext}`) ||
      ACCEPTED_VIDEO_MIME_TYPES.includes(file.type)
    );
  }
  if (selectedType.value === EMessageType.audio) {
    return (
      ACCEPTED_AUDIO_EXTENSIONS.includes(`.${ext}`) ||
      ACCEPTED_AUDIO_MIME_TYPES.includes(file.type)
    );
  }
  return false;
}

const onFileChange = (files: File[] | File | null) => {
  const file = Array.isArray(files) ? (files?.[0] ?? null) : files;
  fileSizeError.value = null;

  if (!file) {
    attachmentFile.value = null;
    filePreview.value = null;
    return;
  }

  if (!isAllowedFile(file)) {
    console.warn(t('invalid_file_message'));
    attachmentFile.value = null;
    filePreview.value = null;
    return;
  }

  const MAX_FILE_SIZE = 16 * 1024 * 1024;
  if (file.size > MAX_FILE_SIZE) {
    fileSizeError.value = t('file_too_large');
    attachmentFile.value = null;
    filePreview.value = null;
    return;
  }

  attachmentFile.value = file;
  const previewId = `preview-${Date.now()}`;
  const previewSrc = URL.createObjectURL(file);
  filePreview.value = {
    id: previewId,
    file,
    src: previewSrc,
  };
};

const openPreview = (src: string, caption?: string, type?: EMessageType) => {
  previewDialog.value = {
    open: true,
    src,
    caption: caption && caption.trim() ? caption.trim() : null,
    type: type || selectedType.value,
  };
};

const createDefaultWaveform = (): number[] => {
  return new Array(64).fill(0.3);
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

const openCurrentPreview = () => {
  if (!filePreview.value) return;

  openPreview(
    filePreview.value.src,
    message.value || undefined,
    selectedType.value
  );
};

const addMessageTemplate = async () => {
  const validateForm = await refFormAddMessageTemplate?.value?.validate();
  if (!validateForm?.valid) return;

  if (!message_status_id.value || !command.value) {
    return;
  }

  if (
    selectedType.value === EMessageType.text &&
    (!message.value || !message.value.trim())
  ) {
    return;
  }

  if (showFileInput.value && (!attachmentFile.value || !filePreview.value)) {
    return;
  }

  isLoading.value = true;

  try {
    const form = new FormData();
    form.append('message', message.value ?? '');
    form.append('command', command.value ?? '');
    form.append('message_status_id', message_status_id.value ?? '');
    form.append('type', selectedType.value);
    form.append('auto_send', auto_send.value ? 'true' : 'false');
    if (attachmentFile.value) {
      form.append('attachment_url', attachmentFile.value);
    }

    const result = await messageTemplateStore.addMessageTemplate(form as any);

    if (result) {
      isVisible.value = false;
      await messageTemplateStore.listMessageTemplate();
    }
  } finally {
    isLoading.value = false;
  }
};

const noSlashRule = (value: string) => {
  if (!value) return true;

  if (/[\\/]/.test(value)) {
    return t('command_no_slash');
  }

  if (value.trim() === '.') {
    return t('command_only_dot_not_allowed');
  }

  return true;
};

const availableTags = computed(() => [
  {
    tag: '{{ greeting }}',
    description: t('tag_greeting_description'),
  },
  {
    tag: '{{ name }}',
    description: t('tag_name_description'),
  },
  {
    tag: '{{ protocol }}',
    description: t('tag_protocol_description'),
  },
  {
    tag: '{{ date }}',
    description: t('tag_date_description'),
  },
  {
    tag: '{{ time }}',
    description: t('tag_time_description'),
  },
  {
    tag: '{{ account_name }}',
    description: t('tag_account_name_description'),
  },
  {
    tag: '{{ phone }}',
    description: t('tag_phone_description'),
  },
  {
    tag: '{{ channel_name }}',
    description: t('tag_channel_name_description'),
  },
]);

const resetForm = () => {
  selectedType.value = EMessageType.text;
  message.value = null;
  message_status_id.value = EMessageStatus.active;
  auto_send.value = false;
  command.value = null;
  attachmentFile.value = null;
  fileSizeError.value = null;
  if (filePreview.value?.src) {
    URL.revokeObjectURL(filePreview.value.src);
  }
  filePreview.value = null;
  fileInputKey.value++;
  refFormAddMessageTemplate.value?.resetValidation();
};

watch(selectedType, () => {
  attachmentFile.value = null;
  fileSizeError.value = null;
  if (filePreview.value?.src) {
    URL.revokeObjectURL(filePreview.value.src);
  }
  filePreview.value = null;
  fileInputKey.value++;
  if (selectedType.value === EMessageType.text) {
    message.value = '';
  }
});

onMounted(async () => {
  resetForm();
});

watch(isVisible, (visible) => {
  if (visible) resetForm();
});

onBeforeUnmount(() => {
  if (filePreview.value?.src) {
    URL.revokeObjectURL(filePreview.value.src);
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600" :persistent="isLoading">
    <DialogCloseBtn :disabled="isLoading" @click="isVisible = false" />

    <VOverlay
      :model-value="isLoading"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VForm ref="refFormAddMessageTemplate" @submit.prevent>
      <VCard :title="$t('add_message_template')">
        <VCardText>
          <VRow>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('message_type') }}:</VLabel
              >
              <AppSelectSearch
                v-model="selectedType"
                :items="messageTypeOptions"
                item-value="id"
                item-title="title"
                :clearable="false"
                :rules="[
                  requiredValidator(selectedType, $t('message_type_required')),
                ]"
              />
            </VCol>

            <VCol v-if="showTextInput" cols="12">
              <label class="text-body-2 mb-1" for="message-textarea">
                {{ $t('message') }}:
              </label>
              <VTextarea
                id="message-textarea"
                v-model="message"
                :placeholder="$t('message')"
                :rules="
                  selectedType === EMessageType.text
                    ? [requiredValidator(message, $t('message_required'))]
                    : []
                "
                rows="4"
              />
              <VExpansionPanels variant="accordion" class="mt-2">
                <VExpansionPanel>
                  <VExpansionPanelTitle>
                    <span class="text-caption">{{ $t('available_tags') }}</span>
                  </VExpansionPanelTitle>
                  <VExpansionPanelText>
                    <div class="d-flex flex-column gap-1">
                      <div
                        v-for="tag in availableTags"
                        :key="tag.tag"
                        class="text-caption"
                      >
                        <code>{{ tag.tag }}</code
                        >: {{ tag.description }}
                      </div>
                    </div>
                  </VExpansionPanelText>
                </VExpansionPanel>
              </VExpansionPanels>
            </VCol>

            <template v-if="showFileInput">
              <VCol cols="12">
                <VLabel class="text-body-2 mb-1">{{ $t('file') + ':' }}</VLabel>
                <VFileInput
                  :key="fileInputKey"
                  variant="outlined"
                  density="comfortable"
                  :placeholder="$t('select_file')"
                  :accept="acceptedFileTypes"
                  show-size
                  :chips="!!attachmentFile"
                  :clearable="true"
                  hide-details="auto"
                  :prepend-icon="''"
                  @update:model-value="onFileChange"
                  class="w-100"
                >
                  <template #prepend-inner>
                    <VIcon icon="tabler-upload" />
                  </template>
                </VFileInput>
                <small
                  v-if="fileSizeError"
                  class="text-caption text-error mt-1 d-block"
                >
                  {{ fileSizeError }}
                </small>
                <small
                  v-else
                  class="text-caption text-medium-emphasis mt-1 d-block"
                >
                  <template v-if="selectedType === EMessageType.image">
                    {{ $t('msg_image_pdf_or_audio') }}
                  </template>
                  <template v-else-if="selectedType === EMessageType.video">
                    {{ $t('msg_video_file') }}
                  </template>
                  <template v-else-if="selectedType === EMessageType.audio">
                    {{ $t('msg_audio_file') }}
                  </template>
                </small>
              </VCol>
              <VCol cols="12">
                <label class="text-body-2 mb-1" for="message-caption">
                  {{ $t('message') }}:
                </label>
                <VTextarea
                  id="message-caption"
                  v-model="message"
                  :placeholder="$t('message')"
                  :rules="[]"
                  rows="3"
                />
                <VExpansionPanels variant="accordion" class="mt-2">
                  <VExpansionPanel>
                    <VExpansionPanelTitle>
                      <span class="text-caption">{{
                        $t('available_tags')
                      }}</span>
                    </VExpansionPanelTitle>
                    <VExpansionPanelText>
                      <div class="d-flex flex-column gap-1">
                        <div
                          v-for="tag in availableTags"
                          :key="tag.tag"
                          class="text-caption"
                        >
                          <code>{{ tag.tag }}</code
                          >: {{ tag.description }}
                        </div>
                      </div>
                    </VExpansionPanelText>
                  </VExpansionPanel>
                </VExpansionPanels>
              </VCol>

              <VCol v-if="filePreview" cols="12">
                <p class="text-caption text-medium-emphasis mb-1">
                  {{ $t('preview') }}:
                </p>
                <VCard
                  class="pa-1 cursor-pointer"
                  style="max-width: 200px"
                  @click="openCurrentPreview"
                >
                  <VImg
                    v-if="selectedType === EMessageType.image"
                    :src="filePreview.src"
                    max-width="200"
                    max-height="150"
                    aspect-ratio="4/3"
                    cover
                    class="rounded cursor-pointer"
                    style="object-fit: cover"
                    @click="
                      openPreview(
                        filePreview.src,
                        message || undefined,
                        EMessageType.image
                      )
                    "
                  />
                  <div
                    v-else-if="selectedType === EMessageType.video"
                    class="position-relative rounded cursor-pointer"
                    style="
                      width: 200px;
                      height: 150px;
                      background: rgba(var(--v-theme-surface-variant), 0.1);
                    "
                    @click="
                      openPreview(
                        filePreview.src,
                        message || undefined,
                        EMessageType.video
                      )
                    "
                  >
                    <video
                      :src="filePreview.src"
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
                        size="32"
                        color="white"
                        style="
                          filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.5));
                        "
                      />
                    </div>
                  </div>
                  <div
                    v-else-if="selectedType === EMessageType.audio"
                    class="d-flex align-center gap-2 pa-2"
                    style="
                      background: rgba(var(--v-theme-surface-variant), 0.1);
                      border-radius: 8px;
                      max-width: 200px;
                    "
                    @click="
                      openPreview(
                        filePreview.src,
                        message || undefined,
                        EMessageType.audio
                      )
                    "
                  >
                    <VIcon icon="tabler-music" size="24" />
                    <div class="flex-grow-1" style="min-width: 0">
                      <div class="text-caption text-truncate">
                        {{ filePreview.file.name }}
                      </div>
                      <div
                        class="text-caption text-medium-emphasis"
                        style="font-size: 0.7rem"
                      >
                        {{ $t('click_to_preview') }}
                      </div>
                    </div>
                    <VIcon icon="tabler-player-play-filled" size="20" />
                  </div>
                </VCard>
              </VCol>
            </template>

            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('shortcut') }}:</VLabel>
              <AppTextField
                v-model="command"
                :placeholder="$t('shortcut')"
                :rules="[
                  requiredValidator(command, $t('shortcut_required')),
                  noSlashRule,
                ]"
              />
            </VCol>

            <VCol cols="12" md="6">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('message_status') }}:</VLabel
              >
              <AppSelectSearch
                v-model="message_status_id"
                :items="itemsStatus"
                :placeholder="$t('message_status')"
                :clearable="true"
                item-value="value"
                item-title="text"
              />
            </VCol>

            <VCol cols="12" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('auto_send') }}:</VLabel>
              <AppSelectSearch
                v-model="auto_send"
                :items="itemsAutoSend"
                :placeholder="$t('auto_send')"
                :clearable="false"
                item-value="value"
                item-title="text"
              />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn
            variant="tonal"
            color="secondary"
            :disabled="isLoading"
            @click="isVisible = false"
          >
            {{ $t('cancel') }}
          </VBtn>
          <VBtn :loading="isLoading" @click="addMessageTemplate">
            {{ $t('add') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>

  <!-- Preview Modal -->
  <VDialog v-model="previewDialog.open" max-width="800">
    <DialogCloseBtn @click="closePreview" />
    <VCard :title="$t('preview')">
      <VCardText>
        <VImg
          v-if="previewDialog.src && previewDialog.type === EMessageType.image"
          :src="previewDialog.src"
          max-height="420"
          class="rounded"
          contain
        />
        <video
          v-if="previewDialog.src && previewDialog.type === EMessageType.video"
          :src="previewDialog.src"
          max-height="600"
          class="rounded"
          style="width: 100%"
          controls
        >
          <track kind="captions" />
        </video>
        <div
          v-if="previewDialog.src && previewDialog.type === EMessageType.audio"
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
                      audioProgress > (index / audioWaveformBars.length) * 100,
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
                  isAudioPlaying ? 'tabler-player-pause' : 'tabler-player-play'
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
      <VCardText class="d-flex justify-end">
        <VBtn variant="tonal" color="secondary" @click="closePreview">
          {{ $t('close') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style scoped>
.audio-preview-container {
  width: 100%;
  max-width: 500px;
}

.audio-waveform-container {
  position: relative;
  width: 100%;
  height: 80px;
  display: flex;
  align-items: center;
  overflow: hidden;
  background: rgba(var(--v-theme-surface-variant), 0.1);
  border-radius: 8px;
  padding: 12px;
}

.audio-waveform {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 4px;
  padding: 12px;
  z-index: 1;
  height: 100%;
  width: 100%;
}

.audio-waveform-bar {
  flex: 1;
  min-width: 3px;
  max-width: 4px;
  background: rgba(var(--v-theme-primary), 0.4);
  border-radius: 2px;
  transition: background 0.2s ease;
}

.audio-waveform-bar--active {
  background: rgba(var(--v-theme-primary), 0.8);
}

.audio-progress-indicator {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: rgba(var(--v-theme-primary), 1);
  z-index: 2;
  pointer-events: none;
  transform: translateX(-50%);
}
</style>
