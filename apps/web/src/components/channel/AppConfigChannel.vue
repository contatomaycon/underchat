<script lang="ts" setup>
import { useChannelsStore } from '@/@webcore/stores/channels';
import { EColor } from '@core/common/enums/EColor';
import { ProfileStatus } from '@core/schema/worker/listProfileStatus/response.schema';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EWorkerPermissions } from '@core/common/enums/EPermissions/worker';
import { EWorkerProfileStatusType } from '@core/common/enums/EWorkerProfileStatusType';
import { can } from '@layouts/plugins/casl';

const channelStore = useChannelsStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  channelId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const MAX_PROFILE_STATUS = 30;
const MAX_TEXT_LENGTH = 130;
const ACCEPTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const ACCEPTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
];
const ACCEPTED_VIDEO_EXTENSIONS = [
  '.mp4',
  '.avi',
  '.flv',
  '.mkv',
  '.mov',
  '.3gp',
];
const ACCEPTED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/avi',
  'video/x-flv',
  'video/x-matroska',
  'video/quicktime',
  'video/3gpp',
];
const ACCEPTED_AUDIO_EXTENSIONS = [
  '.mp3',
  '.aac',
  '.m4a',
  '.amr',
  '.ogg',
  '.opus',
];
const ACCEPTED_AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/aac',
  'audio/m4a',
  'audio/x-m4a',
  'audio/amr',
  'audio/amr-wb',
  'audio/ogg',
  'audio/opus',
];
const ACCEPTED_IMAGE_TYPES = `${ACCEPTED_IMAGE_MIME_TYPES.join(',')},${ACCEPTED_IMAGE_EXTENSIONS.join(',')}`;
const ACCEPTED_VIDEO_TYPES = `${ACCEPTED_VIDEO_MIME_TYPES.join(',')},${ACCEPTED_VIDEO_EXTENSIONS.join(',')}`;
const ACCEPTED_AUDIO_TYPES = `${ACCEPTED_AUDIO_MIME_TYPES.join(',')},${ACCEPTED_AUDIO_EXTENSIONS.join(',')}`;

type StatusPreview = {
  id: string;
  file: File;
  src: string;
};

const isVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const channelId = toRef(props, 'channelId');
const currentTab = ref<'general' | 'profile-status' | 'profile-info'>(
  'general'
);
const selectedStatusPreviews = ref<StatusPreview[]>([]);
const existingStatus = ref<ProfileStatus[]>([]);
const isSavingProfileStatus = ref(false);
const isLoadingProfileStatus = ref(false);
const fileInputKey = ref(0);
const previewDialog = ref<{
  open: boolean;
  src: string | null;
  caption: string | null;
  text: string | null;
}>({
  open: false,
  src: null,
  caption: null,
  text: null,
});
const selectedType = ref<EWorkerProfileStatusType>(
  EWorkerProfileStatusType.text
);
const isPermanent = ref<string>('false');
const textContent = ref('');
const caption = ref('');

const statusTypeOptions = computed(() => [
  {
    value: EWorkerProfileStatusType.text,
    title: t('profile_status_type_text'),
  },
  {
    value: EWorkerProfileStatusType.image,
    title: t('profile_status_type_image'),
  },
  {
    value: EWorkerProfileStatusType.video,
    title: t('profile_status_type_video'),
  },
  {
    value: EWorkerProfileStatusType.audio,
    title: t('profile_status_type_audio'),
  },
]);

const isPermanentOptions = [
  { value: 'false', title: 'Temporário' },
  { value: 'true', title: 'Permanente' },
];

const acceptedFileTypes = computed(() => {
  if (selectedType.value === EWorkerProfileStatusType.image) {
    return ACCEPTED_IMAGE_TYPES;
  }
  if (selectedType.value === EWorkerProfileStatusType.video) {
    return ACCEPTED_VIDEO_TYPES;
  }
  if (selectedType.value === EWorkerProfileStatusType.audio) {
    return ACCEPTED_AUDIO_TYPES;
  }
  return '';
});

const showFileInput = computed(() => {
  return [
    EWorkerProfileStatusType.image,
    EWorkerProfileStatusType.video,
    EWorkerProfileStatusType.audio,
  ].includes(selectedType.value);
});

const showTextInput = computed(() => {
  return selectedType.value === EWorkerProfileStatusType.text;
});

const showCaptionInput = computed(() => {
  if (selectedType.value === EWorkerProfileStatusType.text) {
    return false;
  }
  return [
    EWorkerProfileStatusType.image,
    EWorkerProfileStatusType.video,
  ].includes(selectedType.value);
});

const uploadHelperMessage = computed(() => {
  if (selectedType.value === EWorkerProfileStatusType.text) {
    return null;
  }

  if (selectedType.value === EWorkerProfileStatusType.image) {
    return t('profile_status_upload_helper_image');
  }

  if (selectedType.value === EWorkerProfileStatusType.video) {
    return t('profile_status_upload_helper_video');
  }

  if (selectedType.value === EWorkerProfileStatusType.audio) {
    return t('profile_status_upload_helper_audio');
  }

  return null;
});

const permissionsProfileStatus = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EWorkerPermissions.worker_group,
  EWorkerPermissions.profile_status_worker,
];

const canAccessProfileStatus = computed(() => can(permissionsProfileStatus));

const formatDate = (dateString: string): string => {
  if (!dateString) return '';

  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
};

const extractUrlAndCaption = (
  value: string
): { url: string; caption: string | null } => {
  if (value.includes('|')) {
    const [url, ...captionParts] = value.split('|');
    return {
      url: url.trim(),
      caption: captionParts.join('|').trim() || null,
    };
  }
  return { url: value, caption: null };
};

const remainingSlots = computed(() => {
  const existingCount = existingStatus.value.length;
  const pendingCount =
    selectedType.value === EWorkerProfileStatusType.text
      ? textContent.value.trim()
        ? 1
        : 0
      : selectedStatusPreviews.value.length;
  return MAX_PROFILE_STATUS - (existingCount + pendingCount);
});

const resetPendingSelections = () => {
  selectedStatusPreviews.value.forEach((preview) => {
    URL.revokeObjectURL(preview.src);
  });
  selectedStatusPreviews.value = [];
  textContent.value = '';
  caption.value = '';
  isPermanent.value = 'false';
  fileInputKey.value += 1;
};

const fetchProfileStatus = async () => {
  if (!channelId.value) return;

  try {
    isLoadingProfileStatus.value = true;
    const response = await channelStore.fetchWorkerProfileStatus(
      channelId.value
    );

    if (response) {
      existingStatus.value = response;
    }
  } finally {
    isLoadingProfileStatus.value = false;
  }
};

const handleFilesSelected = (files: File[] | File | null) => {
  if (!files) return;

  const normalizedFiles = Array.isArray(files) ? files : [files];

  let allowedMimeTypes: string[] = [];
  let allowedExtensions: string[] = [];

  if (selectedType.value === EWorkerProfileStatusType.image) {
    allowedMimeTypes = ACCEPTED_IMAGE_MIME_TYPES;
    allowedExtensions = ACCEPTED_IMAGE_EXTENSIONS;
  }
  if (selectedType.value === EWorkerProfileStatusType.video) {
    allowedMimeTypes = ACCEPTED_VIDEO_MIME_TYPES;
    allowedExtensions = ACCEPTED_VIDEO_EXTENSIONS;
  }
  if (selectedType.value === EWorkerProfileStatusType.audio) {
    allowedMimeTypes = ACCEPTED_AUDIO_MIME_TYPES;
    allowedExtensions = ACCEPTED_AUDIO_EXTENSIONS;
  }

  const sanitizedFiles = normalizedFiles.filter((file) => {
    if (allowedMimeTypes.includes(file.type)) {
      return true;
    }

    const filename = file.name.toLowerCase();

    return allowedExtensions.some((ext) => filename.endsWith(ext));
  });

  if (!sanitizedFiles.length) {
    return;
  }

  if (remainingSlots.value <= 0) {
    channelStore.showSnackbar(
      t('profile_status_limit_reached'),
      EColor.warning
    );

    return;
  }

  if (sanitizedFiles.length > remainingSlots.value) {
    channelStore.showSnackbar(
      t('profile_status_remaining_photos', {
        count: remainingSlots.value,
      }),
      EColor.warning
    );
  }

  sanitizedFiles.slice(0, remainingSlots.value).forEach((file) => {
    const id = crypto.randomUUID();
    const src = URL.createObjectURL(file);

    selectedStatusPreviews.value.push({ id, file, src });
  });

  fileInputKey.value += 1;
};

const removePreview = (previewId: string) => {
  const index = selectedStatusPreviews.value.findIndex(
    (preview) => preview.id === previewId
  );

  if (index === -1) return;

  URL.revokeObjectURL(selectedStatusPreviews.value[index].src);
  selectedStatusPreviews.value.splice(index, 1);
};

const saveProfileStatus = async () => {
  if (!channelId.value) return;

  if (selectedType.value === EWorkerProfileStatusType.text) {
    if (!textContent.value.trim()) {
      channelStore.showSnackbar(
        t('profile_status_text_required'),
        EColor.warning
      );
      return;
    }
    if (textContent.value.length > MAX_TEXT_LENGTH) {
      channelStore.showSnackbar(
        t('profile_status_text_too_long', { max: MAX_TEXT_LENGTH }),
        EColor.warning
      );
      return;
    }
  }

  if (selectedType.value !== EWorkerProfileStatusType.text) {
    if (!selectedStatusPreviews.value.length) {
      channelStore.showSnackbar(
        t('profile_status_no_photos_selected'),
        EColor.warning
      );
      return;
    }
  }

  if (caption.value.length > MAX_TEXT_LENGTH) {
    channelStore.showSnackbar(
      t('profile_status_caption_too_long', { max: MAX_TEXT_LENGTH }),
      EColor.warning
    );
    return;
  }

  try {
    isSavingProfileStatus.value = true;

    const files = selectedStatusPreviews.value.map((preview) => preview.file);
    const response = await channelStore.uploadWorkerProfileStatus(
      channelId.value,
      selectedType.value,
      files.length > 0 ? files : undefined,
      selectedType.value === EWorkerProfileStatusType.text
        ? textContent.value
        : undefined,
      showCaptionInput.value ? caption.value : undefined,
      isPermanent.value
    );

    if (response) {
      const newStatuses = response.map((status) => ({
        ...status,
        created_at: (status as any).created_at || new Date().toISOString(),
      }));
      existingStatus.value = [...existingStatus.value, ...newStatuses];
      resetPendingSelections();
    }
  } finally {
    isSavingProfileStatus.value = false;
  }
};

const openPreview = (src: string, caption?: string, text?: string) => {
  previewDialog.value = {
    open: true,
    src: text ? null : src,
    caption: caption && caption.trim() ? caption.trim() : null,
    text: text && text.trim() ? text.trim() : null,
  };
};

const closePreview = () => {
  previewDialog.value = {
    open: false,
    src: null,
    caption: null,
    text: null,
  };
};

const togglePermanent = async (status: ProfileStatus) => {
  if (!channelId.value) return;

  const newIsPermanent = !status.is_permanent;

  const success = await channelStore.updateProfileStatusIsPermanent(
    status.worker_profile_status_id,
    newIsPermanent
  );

  if (success) {
    const index = existingStatus.value.findIndex(
      (s) => s.worker_profile_status_id === status.worker_profile_status_id
    );

    if (index !== -1) {
      existingStatus.value[index] = {
        ...existingStatus.value[index],
        is_permanent: newIsPermanent,
      };
    }
  }
};

const deleteStatus = async (status: ProfileStatus) => {
  if (!channelId.value) return;

  const success = await channelStore.deleteProfileStatus(
    status.worker_profile_status_id
  );

  if (success) {
    existingStatus.value = existingStatus.value.filter(
      (s) => s.worker_profile_status_id !== status.worker_profile_status_id
    );
  }
};

watch(isVisible, async (visible) => {
  if (visible) {
    currentTab.value = 'general';
    await fetchProfileStatus();
    return;
  }

  resetPendingSelections();
  closePreview();
});

watch(channelId, async (newValue, oldValue) => {
  if (isVisible.value && newValue && newValue !== oldValue) {
    await fetchProfileStatus();
  }
});

watch(currentTab, async (newTab) => {
  if (newTab === 'profile-status' && isVisible.value && channelId.value) {
    await fetchProfileStatus();
  }
});

onBeforeUnmount(() => {
  resetPendingSelections();
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="960">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="channelStore.loading">
      <VOverlay
        :model-value="channelStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VCard>
      <VCardTitle class="d-flex justify-space-between align-center">
        <span>{{ $t('configurations') }}</span>
        <DialogCloseBtn class="d-none d-sm-flex" @click="isVisible = false" />
      </VCardTitle>

      <VTabs v-model="currentTab" grow>
        <VTab value="general">{{ $t('general_settings') }}</VTab>
        <VTab v-if="canAccessProfileStatus" value="profile-status">{{
          $t('profile_status_tab')
        }}</VTab>
        <VTab value="profile-info">{{ $t('profile_information_tab') }}</VTab>
      </VTabs>

      <VDivider />

      <VCardText class="scrollable-content">
        <VWindow v-model="currentTab">
          <VWindowItem value="general">
            <div class="py-10" />
          </VWindowItem>

          <VWindowItem value="profile-status">
            <div class="d-flex flex-column gap-4 position-relative pa-4">
              <VOverlay
                v-model="isLoadingProfileStatus"
                class="align-center justify-center"
                contained
              >
                <VProgressCircular color="primary" indeterminate size="32" />
              </VOverlay>

              <VAlert
                v-if="uploadHelperMessage"
                color="warning"
                variant="tonal"
                :text="uploadHelperMessage"
                icon="tabler-info-circle"
                class="alert-helper"
              />

              <div class="status-type-wrapper">
                <VSelect
                  v-model="selectedType"
                  :items="statusTypeOptions"
                  item-title="title"
                  item-value="value"
                  :label="$t('profile_status_type')"
                  class="mb-4 mt-2"
                />

                <div v-if="showTextInput" class="mb-4">
                  <VTextarea
                    v-model="textContent"
                    :label="$t('profile_status_text')"
                    :counter="MAX_TEXT_LENGTH"
                    :maxlength="MAX_TEXT_LENGTH"
                    rows="4"
                  />
                </div>

                <div
                  v-if="showFileInput"
                  class="d-flex align-center gap-4 file-input-wrapper mb-4"
                >
                  <VFileInput
                    :key="fileInputKey"
                    multiple
                    show-size
                    counter
                    chips
                    :accept="acceptedFileTypes"
                    :label="$t('profile_status_upload_button')"
                    class="flex-grow-1"
                    @update:model-value="handleFilesSelected"
                  />
                </div>

                <div v-if="showCaptionInput" class="mb-4">
                  <VTextarea
                    v-model="caption"
                    :label="$t('profile_status_caption')"
                    :counter="MAX_TEXT_LENGTH"
                    :maxlength="MAX_TEXT_LENGTH"
                    rows="2"
                  />
                </div>

                <VSelect
                  v-model="isPermanent"
                  :items="isPermanentOptions"
                  item-title="title"
                  item-value="value"
                  :label="$t('is_permanent')"
                  class="mb-4"
                />
              </div>

              <div v-if="showTextInput && textContent">
                <p class="text-subtitle-2 mb-2">
                  {{ $t('profile_status_pending_title') }}
                </p>
                <VCard class="pa-4">
                  <p class="text-body-1">{{ textContent }}</p>
                </VCard>
              </div>

              <div v-if="showFileInput && selectedStatusPreviews.length">
                <p class="text-subtitle-2 mb-2">
                  {{ $t('profile_status_pending_title') }}
                </p>
                <VRow>
                  <VCol
                    v-for="preview in selectedStatusPreviews"
                    :key="preview.id"
                    cols="12"
                    sm="6"
                    md="4"
                  >
                    <VCard class="pa-2 photo-pending-card">
                      <VImg
                        v-if="selectedType === EWorkerProfileStatusType.image"
                        :src="preview.src"
                        aspect-ratio="1"
                        cover
                        class="rounded mb-2 cursor-pointer"
                        @click="
                          openPreview(
                            preview.src,
                            caption && caption.trim() ? caption : undefined
                          )
                        "
                      />
                      <video
                        v-else-if="
                          selectedType === EWorkerProfileStatusType.video
                        "
                        :src="preview.src"
                        class="rounded mb-2 cursor-pointer"
                        style="width: 100%; aspect-ratio: 1; object-fit: cover"
                        controls
                        @click.stop="
                          openPreview(
                            preview.src,
                            caption && caption.trim() ? caption : undefined
                          )
                        "
                      />
                      <div
                        v-else-if="
                          selectedType === EWorkerProfileStatusType.audio
                        "
                        class="d-flex align-center justify-center rounded mb-2"
                        style="
                          width: 100%;
                          aspect-ratio: 1;
                          background: rgba(var(--v-theme-surface-variant), 0.1);
                        "
                      >
                        <VIcon icon="tabler-music" size="48" />
                      </div>
                      <div class="d-flex justify-space-between align-center">
                        <span class="text-caption">{{
                          $t('profile_status_preview_label')
                        }}</span>
                        <VBtn
                          icon="tabler-x"
                          variant="text"
                          color="error"
                          size="small"
                          @click="removePreview(preview.id)"
                        />
                      </div>
                    </VCard>
                  </VCol>
                </VRow>
              </div>

              <div class="d-flex justify-end">
                <VBtn
                  color="primary"
                  :loading="isSavingProfileStatus"
                  :disabled="
                    (showTextInput && !textContent.trim()) ||
                    (showFileInput && !selectedStatusPreviews.length)
                  "
                  @click="saveProfileStatus"
                >
                  {{ $t('profile_status_save') }}
                </VBtn>
              </div>

              <VDivider />

              <div>
                <div class="d-flex justify-space-between align-center mb-2">
                  <p class="text-subtitle-2 mb-0">
                    {{ $t('profile_status_current_gallery') }}
                  </p>
                  <span class="text-caption text-medium-emphasis">
                    {{ $t('profile_status_gallery_subtitle') }}
                  </span>
                </div>

                <VRow v-if="existingStatus.length">
                  <VCol
                    v-for="status in existingStatus"
                    :key="status.worker_profile_status_id"
                    cols="6"
                    sm="4"
                    md="3"
                  >
                    <div class="photo-container">
                      <VCard
                        class="pa-2 photo-existing-card"
                        @click="
                          status.worker_profile_status_type_id ===
                          EWorkerProfileStatusType.text
                            ? openPreview('', undefined, status.value)
                            : openPreview(
                                extractUrlAndCaption(status.value).url,
                                extractUrlAndCaption(status.value).caption ||
                                  undefined
                              )
                        "
                      >
                        <div class="photo-wrapper position-relative">
                          <VImg
                            v-if="
                              status.worker_profile_status_type_id ===
                              EWorkerProfileStatusType.image
                            "
                            :src="extractUrlAndCaption(status.value).url"
                            aspect-ratio="1"
                            cover
                            class="rounded"
                          />
                          <video
                            v-else-if="
                              status.worker_profile_status_type_id ===
                              EWorkerProfileStatusType.video
                            "
                            :src="extractUrlAndCaption(status.value).url"
                            class="rounded"
                            style="
                              width: 100%;
                              aspect-ratio: 1;
                              object-fit: cover;
                            "
                            controls
                          />
                          <div
                            v-else-if="
                              status.worker_profile_status_type_id ===
                              EWorkerProfileStatusType.audio
                            "
                            class="d-flex align-center justify-center rounded"
                            style="
                              width: 100%;
                              aspect-ratio: 1;
                              background: rgba(
                                var(--v-theme-surface-variant),
                                0.1
                              );
                            "
                          >
                            <VIcon icon="tabler-music" size="48" />
                          </div>
                          <div
                            v-else-if="
                              status.worker_profile_status_type_id ===
                              EWorkerProfileStatusType.text
                            "
                            class="d-flex align-center justify-center rounded pa-4"
                            style="
                              width: 100%;
                              aspect-ratio: 1;
                              background: rgba(
                                var(--v-theme-surface-variant),
                                0.1
                              );
                            "
                          >
                            <p class="text-body-2 text-center">
                              {{ status.value }}
                            </p>
                          </div>
                          <div class="photo-actions">
                            <div
                              class="action-icon permanent-icon"
                              :class="{
                                'permanent-active': status.is_permanent,
                              }"
                              @click.stop="togglePermanent(status)"
                            >
                              <VIcon
                                :icon="
                                  status.is_permanent
                                    ? 'tabler-lock'
                                    : 'tabler-lock-open'
                                "
                                size="16"
                                :color="
                                  status.is_permanent ? 'primary' : 'secondary'
                                "
                              />
                            </div>
                            <div
                              class="action-icon delete-icon"
                              @click.stop="deleteStatus(status)"
                            >
                              <VIcon
                                icon="tabler-trash"
                                size="16"
                                color="error"
                              />
                            </div>
                          </div>
                        </div>
                      </VCard>
                      <div class="photo-date-wrapper">
                        <span class="photo-date">{{
                          formatDate(status.created_at)
                        }}</span>
                      </div>
                    </div>
                  </VCol>
                </VRow>

                <VAlert
                  v-else
                  color="primary"
                  variant="tonal"
                  class="empty-gallery-alert"
                  :text="$t('profile_status_no_photos')"
                />
              </div>
            </div>
          </VWindowItem>

          <VWindowItem value="profile-info">
            <div class="py-10" />
          </VWindowItem>
        </VWindow>
      </VCardText>
    </VCard>
  </VDialog>

  <VDialog v-model="previewDialog.open" max-width="520">
    <DialogCloseBtn @click="closePreview" />
    <VCard :title="$t('profile_status_modal_title')">
      <VCardText>
        <VImg
          v-if="previewDialog.src"
          :src="previewDialog.src"
          max-height="420"
          class="rounded"
          contain
        />
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
</template>

<style scoped>
.photo-existing-card {
  cursor: pointer;
  transition: box-shadow 0.2s ease;
}

.photo-existing-card:hover {
  box-shadow: 0 4px 20px rgba(15, 23, 42, 0.15);
}

.photo-pending-card {
  min-height: 220px;
}

.alert-helper {
  font-size: 0.85rem;
  line-height: 1.2rem;
}

.file-input-wrapper {
  flex-wrap: wrap;
  align-items: center;
}

.file-input-wrapper :deep(.v-field) {
  min-height: 48px;
  height: 48px;
}

.file-input-wrapper :deep(.v-field__input) {
  min-height: 48px;
  padding-top: 0;
  padding-bottom: 0;
}

.permanent-checkbox {
  flex-shrink: 0;
  margin-top: 0;
}

.permanent-checkbox :deep(.v-label) {
  font-size: 0.9rem;
}

.empty-gallery-alert {
  color: inherit;
  background-color: rgba(var(--v-theme-primary), 0.12);
}

.photo-container {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.photo-wrapper {
  position: relative;
}

.photo-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 6px;
  z-index: 2;
}

.action-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(255, 255, 255, 0.95);
  border-radius: 50%;
  width: 28px;
  height: 28px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  backdrop-filter: blur(4px);
}

.action-icon:hover {
  background-color: rgba(255, 255, 255, 1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  transform: scale(1.1);
}

.photo-date-wrapper {
  display: flex;
  justify-content: flex-end;
  width: 100%;
}

.photo-date {
  font-size: 0.75rem;
  font-style: italic;
  color: rgba(var(--v-theme-on-surface), 0.6);
  text-align: right;
}

.scrollable-content {
  max-height: 70vh;
  overflow-y: auto;
}

.scrollable-content::-webkit-scrollbar {
  width: 6px;
}

.scrollable-content::-webkit-scrollbar-track {
  background: transparent;
}

.scrollable-content::-webkit-scrollbar-thumb {
  background: rgba(var(--v-theme-on-surface), 0.2);
  border-radius: 3px;
}

.scrollable-content::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--v-theme-on-surface), 0.3);
}

.scrollable-content {
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--v-theme-on-surface), 0.2) transparent;
}

.status-type-wrapper {
  width: 100%;
  min-width: 0;
  overflow: visible;
}

.status-type-wrapper :deep(.v-field) {
  min-width: 0;
  overflow: visible;
}

.status-type-wrapper :deep(.v-field__input) {
  min-width: 0;
  overflow: visible;
}

.status-type-wrapper :deep(.v-select__selection) {
  white-space: normal;
  word-wrap: break-word;
  overflow: visible;
  max-width: 100%;
}

.cursor-pointer {
  cursor: pointer;
}
</style>
