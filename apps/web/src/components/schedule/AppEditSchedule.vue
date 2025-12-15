<script lang="ts" setup>
import { VForm } from 'vuetify/components/VForm';
import { useScheduleStore } from '@/@webcore/stores/schedule';
import { EScheduleType } from '@core/common/enums/EScheduleType';
import { EScheduleSendTo } from '@core/common/enums/EScheduleSendTo';
import { refDebounced } from '@vueuse/core';
import { EditScheduleParamsRequest } from '@core/schema/schedule/editSchedule/request.schema';

const scheduleStore = useScheduleStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  scheduleId: string | null;
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
    value: EScheduleType.text,
    title: t('message_type_text'),
  },
  {
    value: EScheduleType.image,
    title: t('message_type_image'),
  },
  {
    value: EScheduleType.video,
    title: t('message_type_video'),
  },
  {
    value: EScheduleType.audio,
    title: t('message_type_audio'),
  },
]);

const sendToOptions = computed(() => [
  {
    value: EScheduleSendTo.contacts,
    title: t('contacts'),
  },
  {
    value: EScheduleSendTo.contact_groups,
    title: t('contact_groups'),
  },
  {
    value: EScheduleSendTo.all,
    title: t('all'),
  },
]);

const scheduleId = toRef(props, 'scheduleId');
const selectedType = ref<EScheduleType>(EScheduleType.text);
const message = ref<string | null>(null);
const attachmentFile = ref<File | null>(null);
const filePreview = ref<FilePreview | null>(null);
const existingAttachmentUrl = ref<string | null>(null);
const hasNewFile = ref(false);
const fileInputKey = ref(0);
const fileSizeError = ref<string | null>(null);
const isLoading = ref(false);
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

const refFormEditSchedule = ref<VForm>();

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

  const MAX_FILE_SIZE = 16 * 1024 * 1024;
  if (file.size > MAX_FILE_SIZE) {
    fileSizeError.value = t('file_too_large');
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

const updateSchedule = async () => {
  const validateForm = await refFormEditSchedule?.value?.validate();
  if (!validateForm?.valid) return;

  if (
    !scheduleId.value ||
    !workerId.value ||
    !sendTo.value ||
    !sendDate.value
  ) {
    return;
  }

  if (selectedType.value === EScheduleType.text && !message.value?.trim()) {
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
    const payload: EditScheduleParamsRequest = {
      schedule_id: scheduleId.value,
    };

    const form = new FormData();
    if (workerId.value) {
      form.append('worker_id', workerId.value);
    }
    if (selectedType.value) {
      form.append('type', selectedType.value);
    }
    if (sendTo.value) {
      form.append('send_to', sendTo.value);
    }
    if (sendDate.value) {
      form.append('send_date', sendDate.value);
    }
    if (message.value !== null) {
      form.append('message', message.value);
    }
    if (attachmentFile.value && hasNewFile.value) {
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

    const result = await scheduleStore.updateSchedule(payload, form as any);

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
  existingAttachmentUrl.value = null;
  hasNewFile.value = false;
  fileInputKey.value++;
  refFormEditSchedule.value?.resetValidation();
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

const openFilePreview = () => {
  if (filePreview.value) {
    window.open(filePreview.value.src, '_blank');
  }
};

const openExistingAttachment = () => {
  if (existingAttachmentUrl.value) {
    window.open(existingAttachmentUrl.value, '_blank');
  }
};

watch(selectedType, () => {
  if (hasNewFile.value) {
    attachmentFile.value = null;
    fileSizeError.value = null;
    if (filePreview.value?.src) {
      URL.revokeObjectURL(filePreview.value.src);
    }
    filePreview.value = null;
    hasNewFile.value = false;
    fileInputKey.value++;
  }
});

watch(debouncedContactSearch, () => {
  loadContacts();
});

watch(debouncedContactGroupSearch, () => {
  loadContactGroups();
});

watch(sendTo, (newValue) => {
  if (newValue === EScheduleSendTo.contacts) {
    loadContacts();
  } else if (newValue === EScheduleSendTo.contact_groups) {
    loadContactGroups();
  }
  if (newValue !== EScheduleSendTo.contacts) {
    selectedContactIds.value = [];
  }
  if (newValue !== EScheduleSendTo.contact_groups) {
    selectedContactGroupIds.value = [];
  }
});

watch(
  [isVisible, scheduleId],
  async ([visible, id]) => {
    if (visible && id) {
      resetForm();
      await loadWorkers();
      const schedule = await scheduleStore.getScheduleById(id);
      if (schedule) {
        message.value = schedule.message ?? null;
        workerId.value = schedule.worker.worker_id;
        sendTo.value = schedule.send_to as EScheduleSendTo;
        sendDate.value = schedule.send_date ?? null;
        existingAttachmentUrl.value = schedule?.url ?? null;
        selectedType.value =
          (schedule.type as EScheduleType) || EScheduleType.text;
        if (schedule.contacts && schedule.contacts.length > 0) {
          selectedContactIds.value = schedule.contacts.map((c) => c.contact_id);
          await loadContacts();
        }
        if (schedule.contact_groups && schedule.contact_groups.length > 0) {
          selectedContactGroupIds.value = schedule.contact_groups.map(
            (cg) => cg.contact_group_id
          );
          await loadContactGroups();
        }
      }
    } else if (!visible) {
      resetForm();
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  if (filePreview.value?.src) {
    URL.revokeObjectURL(filePreview.value.src);
  }
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

    <VForm ref="refFormEditSchedule" @submit.prevent>
      <VCard :title="$t('edit_schedule')">
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
                item-value="value"
                item-title="title"
                :clearable="true"
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
                  selectedType === EScheduleType.text
                    ? [requiredValidator(message, $t('message_required'))]
                    : []
                "
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
                <small
                  v-if="fileSizeError"
                  class="text-caption text-error mt-1 d-block"
                >
                  {{ fileSizeError }}
                </small>
                <div v-if="existingAttachmentUrl && !hasNewFile" class="mt-2">
                  <VChip
                    size="small"
                    variant="tonal"
                    color="primary"
                    class="cursor-pointer"
                    @click="openExistingAttachment"
                  >
                    <VIcon start icon="tabler-paperclip" class="mr-1" />
                    {{ $t('click_to_preview') }}
                  </VChip>
                </div>
                <small
                  v-if="!fileSizeError"
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
              </VCol>

              <VCol v-if="filePreview" cols="12">
                <p class="text-caption text-medium-emphasis mb-1">
                  {{ $t('preview') }}:
                </p>
                <VCard
                  class="pa-1 cursor-pointer"
                  style="max-width: 200px"
                  @click="openFilePreview"
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
                item-value="value"
                item-title="title"
                :clearable="true"
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
          <VBtn :loading="isLoading" @click="updateSchedule">
            {{ $t('save') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
