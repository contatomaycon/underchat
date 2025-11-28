<script lang="ts" setup>
import { VForm } from 'vuetify/components/VForm';
import { useMessageTemplateStore } from '@/@webcore/stores/messageTemplate';
import { EMessageStatus } from '@core/common/enums/EMessageStatus';
import { EMessageType } from '@core/common/enums/EMessageType';
import { EditMessageTemplateParamsRequest } from '@core/schema/messageTemplate/editMessageTemplate/request.schema';

const messageTemplateStore = useMessageTemplateStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  messageTemplateId: string | null;
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
    value: EMessageType.text,
    title: t('message_type_text'),
  },
  {
    value: EMessageType.image,
    title: t('message_type_image'),
  },
  {
    value: EMessageType.video,
    title: t('message_type_video'),
  },
  {
    value: EMessageType.audio,
    title: t('message_type_audio'),
  },
]);

const itemsStatus = ref([
  { value: EMessageStatus.active, text: t('active') },
  { value: EMessageStatus.inactive, text: t('inactive') },
]);

const messageTemplateId = toRef(props, 'messageTemplateId');
const selectedType = ref<EMessageType>(EMessageType.text);
const message = ref<string | null>(null);
const message_status_id = ref<string | null>(null);
const command = ref<string | null>(null);
const attachmentFile = ref<File | null>(null);
const filePreview = ref<FilePreview | null>(null);
const existingAttachmentUrl = ref<string | null>(null);
const hasNewFile = ref(false);
const fileInputKey = ref(0);
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

const refFormEditMessageTemplate = ref<VForm>();

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
  if (!file) {
    attachmentFile.value = null;
    filePreview.value = null;
    hasNewFile.value = false;
    return;
  }

  if (!isAllowedFile(file)) {
    console.warn(t('invalid_file_message'));
    attachmentFile.value = null;
    filePreview.value = null;
    hasNewFile.value = false;
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    console.warn(t('file_too_large'));
    attachmentFile.value = null;
    filePreview.value = null;
    hasNewFile.value = false;
    return;
  }

  attachmentFile.value = file;
  hasNewFile.value = true;
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

const closePreview = () => {
  if (audioPreviewRef.value) {
    audioPreviewRef.value.pause();
    audioPreviewRef.value.currentTime = 0;
  }
  isAudioPlaying.value = false;
  audioProgress.value = 0;
  audioDuration.value = 0;
  audioCurrentTime.value = 0;
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
  } else {
    audioPreviewRef.value.play();
  }
};

const updateAudioProgress = () => {
  if (!audioPreviewRef.value) return;
  audioCurrentTime.value = audioPreviewRef.value.currentTime;
  audioProgress.value =
    (audioCurrentTime.value / audioDuration.value) * 100 || 0;
};

const updateAudioDuration = () => {
  if (!audioPreviewRef.value) return;
  audioDuration.value = audioPreviewRef.value.duration || 0;
};

const audioTimeDisplay = computed(() => {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  return `${formatTime(audioCurrentTime.value)} / ${formatTime(audioDuration.value)}`;
});

const updateMessageTemplate = async () => {
  const validateForm = await refFormEditMessageTemplate?.value?.validate();
  if (!validateForm?.valid) return;

  if (!messageTemplateId.value || !message_status_id.value) {
    return;
  }

  if (selectedType.value === EMessageType.text && !message.value?.trim()) {
    return;
  }

  // Para tipos imagem/vídeo/áudio o anexo é obrigatório:
  // - Se há novo arquivo, ele precisa estar válido (attachmentFile + preview)
  // - Se não há novo arquivo, precisa existir um anexo já salvo (existingAttachmentUrl)
  if (showFileInput.value) {
    const hasExisting = !!existingAttachmentUrl.value;
    const hasNewValidFile =
      hasNewFile.value && !!attachmentFile.value && !!filePreview.value;

    if (!hasExisting && !hasNewValidFile) {
      return;
    }
  }

  const payload: EditMessageTemplateParamsRequest = {
    message_template_id: messageTemplateId.value,
  };

  const form = new FormData();
  form.append('message', message.value ?? '');
  form.append('command', command.value ?? '');
  form.append('message_status_id', message_status_id.value ?? '');
  form.append('type', selectedType.value);
  if (attachmentFile.value && hasNewFile.value) {
    form.append('attachment_url', attachmentFile.value);
  }

  const result = await messageTemplateStore.updateMessageTemplate(
    payload,
    form as any
  );

  if (result) {
    isVisible.value = false;
    await messageTemplateStore.listMessageTemplate();
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

const resetForm = () => {
  selectedType.value = EMessageType.text;
  message.value = null;
  message_status_id.value = null;
  command.value = null;
  attachmentFile.value = null;
  if (filePreview.value?.src) {
    URL.revokeObjectURL(filePreview.value.src);
  }
  filePreview.value = null;
  existingAttachmentUrl.value = null;
  hasNewFile.value = false;
  fileInputKey.value++;
  refFormEditMessageTemplate.value?.resetValidation();
};

watch(selectedType, () => {
  if (hasNewFile.value) {
    attachmentFile.value = null;
    if (filePreview.value?.src) {
      URL.revokeObjectURL(filePreview.value.src);
    }
    filePreview.value = null;
    hasNewFile.value = false;
    fileInputKey.value++;
  }
});

watch(isVisible, async (visible) => {
  if (visible && messageTemplateId.value) {
    resetForm();
    const messageTemplate = await messageTemplateStore.getMessageTemplateById(
      messageTemplateId.value
    );
    if (messageTemplate) {
      message.value = messageTemplate.message;
      command.value = messageTemplate.command;
      message_status_id.value =
        messageTemplate.message_status?.message_status_id ?? null;
      existingAttachmentUrl.value = messageTemplate?.attachment_url ?? null;
      selectedType.value =
        (messageTemplate.type as EMessageType) || EMessageType.text;
    }
  } else if (!visible) {
    resetForm();
  }
});

onBeforeUnmount(() => {
  if (filePreview.value?.src) {
    URL.revokeObjectURL(filePreview.value.src);
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="messageTemplateStore.loading">
      <VOverlay
        :model-value="messageTemplateStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VForm ref="refFormEditMessageTemplate" @submit.prevent>
      <VCard :title="$t('edit_message_template')">
        <VCardText>
          <VRow>
            <VCol cols="12">
              <VSelect
                v-model="selectedType"
                :items="messageTypeOptions"
                item-title="title"
                item-value="value"
                :label="$t('message_type') + ':'"
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
                :rules="[requiredValidator(message, $t('message_required'))]"
                rows="4"
              />
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
                <div v-if="existingAttachmentUrl && !hasNewFile" class="mt-2">
                  <VChip
                    size="small"
                    variant="tonal"
                    color="primary"
                    class="cursor-pointer"
                    @click="
                      openPreview(
                        existingAttachmentUrl!,
                        message || undefined,
                        selectedType
                      )
                    "
                  >
                    <VIcon start icon="tabler-paperclip" class="mr-1" />
                    {{ $t('click_to_preview') }}
                  </VChip>
                </div>
                <small class="text-caption text-medium-emphasis mt-1 d-block">
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
                  :rules="[requiredValidator(message, $t('message_required'))]"
                  rows="3"
                />
              </VCol>

              <VCol v-if="filePreview" cols="12">
                <p class="text-caption text-medium-emphasis mb-1">
                  {{ $t('preview') }}:
                </p>
                <VCard class="pa-1" style="max-width: 200px">
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
              <AppTextField
                v-model="command"
                :label="$t('shortcut') + ':'"
                :placeholder="$t('shortcut')"
                :rules="[
                  requiredValidator(command, $t('shortcut_required')),
                  noSlashRule,
                ]"
              />
            </VCol>

            <VCol cols="12" md="6">
              <AppSelect
                v-model="message_status_id"
                :items="itemsStatus"
                item-title="text"
                item-value="value"
                :label="$t('message_status') + ':'"
                :placeholder="$t('message_status')"
                :rules="[
                  requiredValidator(
                    message_status_id,
                    $t('message_status_id_required')
                  ),
                ]"
              />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="updateMessageTemplate"> {{ $t('save') }} </VBtn>
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
          {{ $t('cancel') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style scoped>
.audio-preview-container {
  min-height: 120px;
}
</style>
