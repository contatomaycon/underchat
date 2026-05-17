<script lang="ts" setup>
import { VForm } from 'vuetify/components/VForm';
import { useRandomMessageStore } from '@/@webcore/stores/randomMessage';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ERandomMessageStatus } from '@core/common/enums/ERandomMessageStatus';

const randomMessageStore = useRandomMessageStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  randomMessageId: string;
  randomMessageItemId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const randomMessageItemId = toRef(props, 'randomMessageItemId');

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
  {
    value: EMessageType.document,
    title: t('message_type_document'),
  },
]);

const itemsStatus = ref([
  { value: ERandomMessageStatus.active, text: t('active') },
  { value: ERandomMessageStatus.inactive, text: t('inactive') },
]);

const selectedType = ref<EMessageType>(EMessageType.text);
const message = ref<string | null>(null);
const status = ref<ERandomMessageStatus>(ERandomMessageStatus.active);
const attachmentFile = ref<File | null>(null);
const filePreview = ref<FilePreview | null>(null);
const existingAttachmentUrl = ref<string | null>(null);
const hasNewFile = ref(false);
const fileInputKey = ref(0);
const fileSizeError = ref<string | null>(null);
const isLoading = ref(false);
const refFormEditRandomMessageItem = ref<VForm>();

const previewDialog = ref<{
  open: boolean;
  src: string | null;
  type: EMessageType | null;
}>({
  open: false,
  src: null,
  type: null,
});

const showTextInput = computed(() => selectedType.value === EMessageType.text);
const showFileInput = computed(() =>
  [
    EMessageType.image,
    EMessageType.video,
    EMessageType.audio,
    EMessageType.document,
  ].includes(selectedType.value)
);

const showMediaMessageInput = computed(() => {
  return showFileInput.value && selectedType.value !== EMessageType.audio;
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

  if (selectedType.value === EMessageType.document) {
    return '*/*';
  }

  return '';
});

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

  if (selectedType.value === EMessageType.document) {
    return true;
  }

  return false;
}

const revokePreview = () => {
  if (filePreview.value?.src) {
    URL.revokeObjectURL(filePreview.value.src);
  }
};

const onFileChange = (files: File[] | File | null) => {
  const file = Array.isArray(files) ? (files?.[0] ?? null) : files;

  fileSizeError.value = null;

  if (!file) {
    attachmentFile.value = null;
    revokePreview();
    filePreview.value = null;
    hasNewFile.value = false;

    return;
  }

  if (!isAllowedFile(file)) {
    attachmentFile.value = null;
    revokePreview();
    filePreview.value = null;
    hasNewFile.value = false;

    return;
  }

  const MAX_FILE_SIZE = 16 * 1024 * 1024;

  if (file.size > MAX_FILE_SIZE) {
    fileSizeError.value = t('file_too_large');
    attachmentFile.value = null;
    revokePreview();
    filePreview.value = null;
    hasNewFile.value = false;

    return;
  }

  attachmentFile.value = file;
  hasNewFile.value = true;
  revokePreview();
  filePreview.value = {
    file,
    src: URL.createObjectURL(file),
  };
};

const openPreview = (src?: string | null) => {
  const target = src || filePreview.value?.src;

  if (!target) return;

  if (selectedType.value === EMessageType.document) {
    window.open(target, '_blank');
    return;
  }

  previewDialog.value = {
    open: true,
    src: target,
    type: selectedType.value,
  };
};

const closePreview = () => {
  previewDialog.value = {
    open: false,
    src: null,
    type: null,
  };
};

const resetForm = () => {
  selectedType.value = EMessageType.text;
  message.value = null;
  status.value = ERandomMessageStatus.active;
  attachmentFile.value = null;
  fileSizeError.value = null;
  revokePreview();
  filePreview.value = null;
  existingAttachmentUrl.value = null;
  hasNewFile.value = false;
  fileInputKey.value += 1;
  refFormEditRandomMessageItem.value?.resetValidation();
};

const updateRandomMessageItem = async () => {
  const validateForm = await refFormEditRandomMessageItem?.value?.validate();

  if (!validateForm?.valid) return;

  if (!randomMessageItemId.value) return;

  if (selectedType.value === EMessageType.text && !message.value?.trim()) {
    return;
  }

  if (showFileInput.value) {
    const hasExisting = !!existingAttachmentUrl.value;
    const hasNewValidFile =
      hasNewFile.value && !!attachmentFile.value && !!filePreview.value;

    if (!hasExisting && !hasNewValidFile) {
      return;
    }
  }

  isLoading.value = true;

  try {
    const payload = {
      random_message_id: props.randomMessageId,
      random_message_item_id: randomMessageItemId.value,
    };

    const form = new FormData();
    const normalizedMessage =
      selectedType.value === EMessageType.audio ? '' : (message.value ?? '');

    form.append('message', normalizedMessage);
    form.append('status', status.value);
    form.append('type', selectedType.value);

    if (attachmentFile.value && hasNewFile.value) {
      form.append('attachment_url', attachmentFile.value);
    }

    const result = await randomMessageStore.updateRandomMessageItem(
      payload,
      form as any
    );

    if (result) {
      isVisible.value = false;
      await randomMessageStore.listRandomMessageItems(props.randomMessageId);
    }
  } finally {
    isLoading.value = false;
  }
};

const availableTags = computed(() => [
  {
    tag: '{{ greeting }}',
    description: t('tag_greeting_description'),
  },
  {
    tag: '{{ nickname }}',
    description: t('tag_nickname_description'),
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

watch(selectedType, () => {
  if (hasNewFile.value) {
    attachmentFile.value = null;
    fileSizeError.value = null;
    revokePreview();
    filePreview.value = null;
    hasNewFile.value = false;
    fileInputKey.value += 1;
  }

  if (selectedType.value === EMessageType.audio) {
    message.value = '';
  }
});

watch(
  [isVisible, randomMessageItemId],
  async ([visible, id]) => {
    if (visible && id) {
      resetForm();

      const randomMessageItem =
        await randomMessageStore.getRandomMessageItemById(
          props.randomMessageId,
          id
        );

      if (randomMessageItem) {
        message.value = randomMessageItem.message;
        status.value = randomMessageItem.status as ERandomMessageStatus;
        selectedType.value =
          (randomMessageItem.type as EMessageType) || EMessageType.text;
        existingAttachmentUrl.value = randomMessageItem.attachment_url ?? null;
      }
    } else if (!visible) {
      resetForm();
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  revokePreview();
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

    <VForm ref="refFormEditRandomMessageItem" @submit.prevent>
      <VCard :title="$t('edit_random_message_item')">
        <VCardText>
          <VRow>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('message_type') }}:</VLabel
              >
              <AppSelectSearch
                v-model="selectedType"
                :items="messageTypeOptions"
                :placeholder="$t('message_type')"
                :clearable="false"
                item-value="value"
                item-title="title"
              />
            </VCol>

            <VCol v-if="showTextInput" cols="12">
              <label class="text-body-2 mb-1" for="random-message-item-text">
                {{ $t('message') }}:
              </label>
              <VTextarea
                id="random-message-item-text"
                v-model="message"
                :placeholder="$t('message')"
                :rules="[requiredValidator(message, $t('message_required'))]"
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
                <div
                  v-if="existingAttachmentUrl && !hasNewFile"
                  class="text-caption mt-2"
                >
                  <VBtn
                    variant="tonal"
                    size="small"
                    @click="openPreview(existingAttachmentUrl)"
                  >
                    {{ $t('click_to_preview') }}
                  </VBtn>
                </div>
              </VCol>

              <VCol v-if="showMediaMessageInput" cols="12">
                <label
                  class="text-body-2 mb-1"
                  for="random-message-item-caption"
                >
                  {{ $t('message') }}:
                </label>
                <VTextarea
                  id="random-message-item-caption"
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
                <VBtn variant="tonal" color="primary" @click="openPreview()">
                  {{ $t('preview') }}
                </VBtn>
              </VCol>
            </template>

            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('status') }}:</VLabel>
              <AppSelectSearch
                v-model="status"
                :items="itemsStatus"
                :placeholder="$t('status')"
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
          <VBtn :loading="isLoading" @click="updateRandomMessageItem">
            {{ $t('save') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>

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

        <audio
          v-if="previewDialog.src && previewDialog.type === EMessageType.audio"
          :src="previewDialog.src"
          controls
          style="width: 100%"
        >
          <track kind="captions" />
        </audio>
      </VCardText>

      <VCardText class="d-flex justify-end">
        <VBtn variant="tonal" color="secondary" @click="closePreview">
          {{ $t('cancel') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>
