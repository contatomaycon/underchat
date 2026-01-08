<script lang="ts" setup>
import { useScheduleStore } from '@/@webcore/stores/schedule';
import { EScheduleType } from '@core/common/enums/EScheduleType';
import { EScheduleSendTo } from '@core/common/enums/EScheduleSendTo';
import { VForm } from 'vuetify/components/VForm';
import { refDebounced } from '@vueuse/core';

const scheduleStore = useScheduleStore();
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
    id: EScheduleType.text,
    title: t('message_type_text'),
  },
  {
    id: EScheduleType.image,
    title: t('message_type_image'),
  },
  {
    id: EScheduleType.video,
    title: t('message_type_video'),
  },
  {
    id: EScheduleType.audio,
    title: t('message_type_audio'),
  },
]);

const sendToOptions = computed(() => [
  {
    id: EScheduleSendTo.contacts,
    title: t('contacts'),
  },
  {
    id: EScheduleSendTo.contact_groups,
    title: t('contact_groups'),
  },
  {
    id: EScheduleSendTo.all,
    title: t('all'),
  },
]);

const selectedType = ref<EScheduleType>(EScheduleType.text);
const message = ref<string | null>(null);
const attachmentFile = ref<File | null>(null);
const filePreview = ref<FilePreview | null>(null);
const fileInputKey = ref(0);
const fileSizeError = ref<string | null>(null);
const isLoading = ref(false);
const previewDialog = ref<{
  open: boolean;
  src: string | null;
  caption: string | null;
  text: string | null;
  type: EScheduleType | null;
}>({
  open: false,
  src: null,
  caption: null,
  text: null,
  type: null,
});
const audioPreviewRef = ref<HTMLAudioElement | null>(null);
const isAudioPlaying = ref(false);
const audioProgress = ref(0);
const audioDuration = ref(0);
const audioCurrentTime = ref(0);
const audioWaveformBars = ref<number[]>([]);
const workerId = ref<string | null>(null);
const sendTo = ref<EScheduleSendTo | null>(null);
const sendDate = ref<string | null>(null);
const selectedContactIds = ref<string[]>([]);
const selectedContactGroupIds = ref<string[]>([]);
const contactSearch = ref('');
const contactGroupSearch = ref('');
const debouncedContactSearch = refDebounced(contactSearch, 500);
const debouncedContactGroupSearch = refDebounced(contactGroupSearch, 500);
const workers = ref<Array<{ worker_id: string; name: string; number: string }>>(
  []
);
const contacts = ref<
  Array<{
    contact_id: string;
    name: string;
    last_name: string | null;
    phone_partial: string | null;
  }>
>([]);
const contactGroups = ref<Array<{ contact_group_id: string; name: string }>>(
  []
);

const showTextInput = computed(() => {
  return selectedType.value === EScheduleType.text;
});

const showFileInput = computed(() => {
  return [
    EScheduleType.image,
    EScheduleType.video,
    EScheduleType.audio,
  ].includes(selectedType.value);
});

const showContactsSelect = computed(() => {
  return sendTo.value === EScheduleSendTo.contacts;
});

const showContactGroupsSelect = computed(() => {
  return sendTo.value === EScheduleSendTo.contact_groups;
});

const acceptedFileTypes = computed(() => {
  if (selectedType.value === EScheduleType.image) {
    return ACCEPTED_IMAGE_TYPES;
  }
  if (selectedType.value === EScheduleType.video) {
    return ACCEPTED_VIDEO_TYPES;
  }
  if (selectedType.value === EScheduleType.audio) {
    return ACCEPTED_AUDIO_TYPES;
  }
  return '';
});

const filteredContacts = computed(() => {
  if (!debouncedContactSearch.value) {
    return contacts.value;
  }
  const query = debouncedContactSearch.value.toLowerCase();
  return contacts.value.filter((contact) => {
    const fullName =
      `${contact.name}${contact.last_name ? ' ' + contact.last_name : ''}`.toLowerCase();
    const phone = contact.phone_partial?.toLowerCase() || '';
    return fullName.includes(query) || phone.includes(query);
  });
});

const filteredContactGroups = computed(() => {
  if (!debouncedContactGroupSearch.value) {
    return contactGroups.value;
  }
  const query = debouncedContactGroupSearch.value.toLowerCase();
  return contactGroups.value.filter((group) =>
    group.name.toLowerCase().includes(query)
  );
});

const refFormAddSchedule = ref<VForm>();

function getExt(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : '';
}

function isAllowedFile(file: File): boolean {
  const ext = getExt(file.name);
  if (selectedType.value === EScheduleType.image) {
    return (
      ACCEPTED_IMAGE_EXTENSIONS.includes(`.${ext}`) ||
      ACCEPTED_IMAGE_MIME_TYPES.includes(file.type)
    );
  }
  if (selectedType.value === EScheduleType.video) {
    return (
      ACCEPTED_VIDEO_EXTENSIONS.includes(`.${ext}`) ||
      ACCEPTED_VIDEO_MIME_TYPES.includes(file.type)
    );
  }
  if (selectedType.value === EScheduleType.audio) {
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

const addSchedule = async () => {
  const validateForm = await refFormAddSchedule?.value?.validate();
  if (!validateForm?.valid) return;

  if (!workerId.value || !sendTo.value || !sendDate.value) {
    return;
  }

  if (
    selectedType.value === EScheduleType.text &&
    (!message.value || !message.value.trim())
  ) {
    return;
  }

  if (showFileInput.value && (!attachmentFile.value || !filePreview.value)) {
    return;
  }

  if (
    sendTo.value === EScheduleSendTo.contacts &&
    selectedContactIds.value.length === 0
  ) {
    return;
  }

  if (
    sendTo.value === EScheduleSendTo.contact_groups &&
    selectedContactGroupIds.value.length === 0
  ) {
    return;
  }

  isLoading.value = true;

  try {
    const form = new FormData();
    form.append('worker_id', workerId.value ?? '');
    form.append('type', selectedType.value);
    form.append('send_to', sendTo.value ?? '');
    form.append('send_date', sendDate.value ?? '');
    if (message.value) {
      form.append('message', message.value);
    }
    if (attachmentFile.value) {
      form.append('url', attachmentFile.value);
    }
    if (selectedContactIds.value.length > 0) {
      form.append('contact_ids', JSON.stringify(selectedContactIds.value));
    }
    if (selectedContactGroupIds.value.length > 0) {
      form.append(
        'contact_group_ids',
        JSON.stringify(selectedContactGroupIds.value)
      );
    }

    const result = await scheduleStore.addSchedule(form as any);

    if (result) {
      isVisible.value = false;
      await scheduleStore.listSchedule();
    }
  } finally {
    isLoading.value = false;
  }
};

const resetForm = () => {
  selectedType.value = EScheduleType.text;
  message.value = null;
  workerId.value = null;
  sendTo.value = null;
  sendDate.value = null;
  selectedContactIds.value = [];
  selectedContactGroupIds.value = [];
  contactSearch.value = '';
  contactGroupSearch.value = '';
  attachmentFile.value = null;
  fileSizeError.value = null;
  if (filePreview.value?.src) {
    URL.revokeObjectURL(filePreview.value.src);
  }
  filePreview.value = null;
  fileInputKey.value++;
  refFormAddSchedule.value?.resetValidation();
};

const loadWorkers = async () => {
  const result = await scheduleStore.listScheduleWorkers();
  if (result) {
    workers.value = result.map((w) => ({
      worker_id: w.worker_id,
      name: w.name,
      number: w.number ?? '',
    }));
  }
};

const loadContacts = async () => {
  const result = await scheduleStore.listScheduleContacts(
    1,
    100,
    debouncedContactSearch.value || undefined
  );
  if (result) {
    contacts.value = result.results.map((c) => ({
      contact_id: c.contact_id,
      name: c.name,
      last_name: c.last_name ?? null,
      phone_partial: c.phone_partial ?? null,
    }));
  }
};

const loadContactGroups = async () => {
  const result = await scheduleStore.listScheduleContactGroups();
  if (result) {
    contactGroups.value = result;
  }
};

const openPreview = (
  src: string | null,
  caption?: string | null,
  text?: string | null,
  type?: EScheduleType
) => {
  previewDialog.value = {
    open: true,
    src: text ? null : src,
    caption: caption && caption.trim() ? caption.trim() : null,
    text: text && text.trim() ? text.trim() : null,
    type: type || null,
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
  audioWaveformBars.value = [];
  previewDialog.value = {
    open: false,
    src: null,
    caption: null,
    text: null,
    type: null,
  };
};

const createDefaultWaveform = (): number[] => {
  return new Array(64).fill(0.3);
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

watch(selectedType, () => {
  attachmentFile.value = null;
  fileSizeError.value = null;
  if (filePreview.value?.src) {
    URL.revokeObjectURL(filePreview.value.src);
  }
  filePreview.value = null;
  fileInputKey.value++;
  if (selectedType.value === EScheduleType.text) {
    message.value = '';
  }
});

watch(debouncedContactSearch, () => {
  if (contactSearch.value) {
    loadContacts();
  }
});

watch(debouncedContactGroupSearch, () => {
  loadContactGroups();
});

watch(selectedContactIds, (newValue, oldValue) => {
  if (newValue.length > (oldValue?.length ?? 0)) {
    contactSearch.value = '';
  }
});

watch(sendTo, (newValue) => {
  if (newValue === EScheduleSendTo.contacts) {
    loadContacts();
  } else if (newValue === EScheduleSendTo.contact_groups) {
    loadContactGroups();
  }
  selectedContactIds.value = [];
  selectedContactGroupIds.value = [];
});

onMounted(async () => {
  await loadWorkers();
  resetForm();
});

watch(isVisible, (visible) => {
  if (visible) {
    resetForm();
    loadWorkers();
  }
});

onBeforeUnmount(() => {
  if (filePreview.value?.src) {
    URL.revokeObjectURL(filePreview.value.src);
  }
  closePreview();
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="700" :persistent="isLoading">
    <DialogCloseBtn :disabled="isLoading" @click="isVisible = false" />

    <VOverlay
      :model-value="isLoading"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VForm ref="refFormAddSchedule" @submit.prevent>
      <VCard :title="$t('add_schedule')">
        <VCardText>
          <VRow>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('channel') }}:</VLabel>
              <AppSelectSearch
                v-model="workerId"
                :items="
                  workers.map((w) => ({
                    id: w.worker_id,
                    title: w.number ? `${w.name} (${w.number})` : w.name,
                  }))
                "
                :placeholder="$t('select_channel')"
                :clearable="false"
                item-value="id"
                item-title="title"
                :rules="[requiredValidator(workerId, $t('channel_required'))]"
              />
            </VCol>

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
              <div class="d-flex align-center justify-space-between mb-1">
                <label class="text-body-2" for="message-textarea">
                  {{ $t('message') }}:
                </label>
                <VBtn
                  v-if="message && message.trim()"
                  size="x-small"
                  variant="text"
                  color="primary"
                  @click="
                    openPreview(
                      null,
                      null,
                      message && message.trim() ? message : null,
                      selectedType
                    )
                  "
                >
                  <VIcon start icon="tabler-eye" size="16" />
                  {{ $t('preview') }}
                </VBtn>
              </div>
              <VTextarea
                id="message-textarea"
                v-model="message"
                :placeholder="$t('message')"
                :rules="
                  selectedType === EScheduleType.text
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
                  <template v-if="selectedType === EScheduleType.image">
                    {{ $t('msg_image_pdf_or_audio') }}
                  </template>
                  <template v-else-if="selectedType === EScheduleType.video">
                    {{ $t('msg_video_file') }}
                  </template>
                  <template v-else-if="selectedType === EScheduleType.audio">
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
                <div class="d-flex align-center gap-2 mb-1">
                  <p class="text-caption text-medium-emphasis mb-0">
                    {{ $t('preview') }}:
                  </p>
                  <VBtn
                    size="x-small"
                    variant="text"
                    color="primary"
                    @click="
                      openPreview(
                        filePreview.src,
                        message && message.trim() ? message : null,
                        null,
                        selectedType
                      )
                    "
                  >
                    <VIcon start icon="tabler-eye" size="16" />
                    {{ $t('preview') }}
                  </VBtn>
                </div>
                <VCard
                  class="pa-1 cursor-pointer"
                  style="max-width: 200px"
                  @click="
                    openPreview(
                      filePreview.src,
                      message && message.trim() ? message : null,
                      null,
                      selectedType
                    )
                  "
                >
                  <VImg
                    v-if="selectedType === EScheduleType.image"
                    :src="filePreview.src"
                    max-width="200"
                    max-height="150"
                    aspect-ratio="4/3"
                    cover
                    class="rounded cursor-pointer"
                    style="object-fit: cover"
                  />
                  <div
                    v-else-if="selectedType === EScheduleType.video"
                    class="position-relative rounded cursor-pointer"
                    style="
                      width: 200px;
                      height: 150px;
                      background: rgba(var(--v-theme-surface-variant), 0.1);
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
                    v-else-if="selectedType === EScheduleType.audio"
                    class="d-flex align-center gap-2 pa-2"
                    style="
                      background: rgba(var(--v-theme-surface-variant), 0.1);
                      border-radius: 8px;
                      max-width: 200px;
                    "
                  >
                    <VIcon icon="tabler-music" size="24" />
                    <div class="flex-grow-1" style="min-width: 0">
                      <div class="text-caption text-truncate">
                        {{ filePreview.file.name }}
                      </div>
                    </div>
                    <VIcon icon="tabler-player-play-filled" size="20" />
                  </div>
                </VCard>
              </VCol>
            </template>

            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('send_to') }}:</VLabel>
              <AppSelectSearch
                v-model="sendTo"
                :items="sendToOptions"
                item-value="id"
                item-title="title"
                :clearable="false"
                :rules="[requiredValidator(sendTo, $t('send_to_required'))]"
              />
            </VCol>

            <VCol v-if="showContactsSelect" cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('contacts') }}:</VLabel>
              <VAutocomplete
                v-model="selectedContactIds"
                :items="filteredContacts"
                :item-title="
                  (item) => {
                    const fullName = `${item.name}${item.last_name ? ' ' + item.last_name : ''}`;
                    return item.phone_partial
                      ? `${fullName} (${item.phone_partial})`
                      : fullName;
                  }
                "
                item-value="contact_id"
                multiple
                chips
                closable-chips
                :search="contactSearch"
                @update:search="contactSearch = $event"
                :rules="[
                  requiredValidator(
                    selectedContactIds.length > 0,
                    $t('contacts_required')
                  ),
                ]"
              />
            </VCol>

            <VCol v-if="showContactGroupsSelect" cols="12">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('contact_groups') }}:</VLabel
              >
              <VAutocomplete
                v-model="selectedContactGroupIds"
                :items="filteredContactGroups"
                item-title="name"
                item-value="contact_group_id"
                multiple
                chips
                closable-chips
                :search="contactGroupSearch"
                @update:search="contactGroupSearch = $event"
                :rules="[
                  requiredValidator(
                    selectedContactGroupIds.length > 0,
                    $t('contact_groups_required')
                  ),
                ]"
              />
            </VCol>

            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('send_date') }}:</VLabel>
              <AppDateTimePicker
                v-model="sendDate"
                :placeholder="$t('send_date')"
                :rules="[requiredValidator(sendDate, $t('send_date_required'))]"
                :config="{
                  enableTime: true,
                  time_24hr: true,
                  dateFormat: 'Y-m-d H:i',
                  altFormat: 'd/m/Y H:i',
                }"
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
          <VBtn :loading="isLoading" @click="addSchedule">
            {{ $t('add') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VForm>

    <VDialog v-model="previewDialog.open" max-width="800">
      <DialogCloseBtn @click="closePreview" />
      <VCard :title="$t('preview')">
        <VCardText>
          <VImg
            v-if="
              previewDialog.src && previewDialog.type === EScheduleType.image
            "
            :src="previewDialog.src"
            max-height="420"
            class="rounded"
            contain
          />
          <video
            v-if="
              previewDialog.src && previewDialog.type === EScheduleType.video
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
              previewDialog.src && previewDialog.type === EScheduleType.audio
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
                    :src="previewDialog.src || undefined"
                    @timeupdate="updateAudioProgress"
                    @loadedmetadata="updateAudioDuration"
                    @play="isAudioPlaying = true"
                    @pause="isAudioPlaying = false"
                    @ended="isAudioPlaying = false"
                  >
                    <track kind="captions" />
                  </audio>
                  <div class="text-caption text-center">
                    {{ audioTimeDisplay }}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div
            v-if="previewDialog.text"
            class="d-flex align-center justify-center pa-8"
            style="min-height: 200px"
          >
            <p class="text-body-1 text-center">
              {{ previewDialog.text }}
            </p>
          </div>
          <div v-if="previewDialog.caption" class="mt-4 text-center">
            <p class="text-body-2 text-medium-emphasis font-italic">
              {{ previewDialog.caption }}
            </p>
          </div>
        </VCardText>
      </VCard>
    </VDialog>
  </VDialog>
</template>

<style lang="scss" scoped>
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
