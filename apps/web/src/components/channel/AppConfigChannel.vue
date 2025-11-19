<script lang="ts" setup>
import { useChannelsStore } from '@/@webcore/stores/channels';
import { EColor } from '@core/common/enums/EColor';
import { ProfileStatusPhoto } from '@core/schema/worker/listProfileStatusPhotos/response.schema';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EWorkerPermissions } from '@core/common/enums/EPermissions/worker';
import { can } from '@layouts/plugins/casl';

const channelStore = useChannelsStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  channelId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const MAX_PROFILE_PHOTOS = 30;
const ACCEPTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const ACCEPTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
];
const ACCEPTED_IMAGE_TYPES = `${ACCEPTED_IMAGE_MIME_TYPES.join(',')},${ACCEPTED_IMAGE_EXTENSIONS.join(',')}`;

type PhotoPreview = {
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
const selectedPhotoPreviews = ref<PhotoPreview[]>([]);
const existingPhotos = ref<ProfileStatusPhoto[]>([]);
const isSavingProfileStatus = ref(false);
const isLoadingProfileStatus = ref(false);
const fileInputKey = ref(0);
const previewDialog = ref<{ open: boolean; src: string | null }>({
  open: false,
  src: null,
});
const isPermanent = ref(false);

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

const remainingSlots = computed(
  () =>
    MAX_PROFILE_PHOTOS -
    (existingPhotos.value.length + selectedPhotoPreviews.value.length)
);

const resetPendingSelections = () => {
  selectedPhotoPreviews.value.forEach((preview) => {
    URL.revokeObjectURL(preview.src);
  });
  selectedPhotoPreviews.value = [];
  fileInputKey.value += 1;
};

const fetchProfileStatusPhotos = async () => {
  if (!channelId.value) return;

  try {
    isLoadingProfileStatus.value = true;
    const response = await channelStore.fetchWorkerProfilePhotos(
      channelId.value
    );

    if (response) {
      existingPhotos.value = response;
    }
  } finally {
    isLoadingProfileStatus.value = false;
  }
};

const handleFilesSelected = (files: File[] | File | null) => {
  if (!files) return;

  const normalizedFiles = Array.isArray(files) ? files : [files];

  const sanitizedFiles = normalizedFiles.filter((file) => {
    if (ACCEPTED_IMAGE_MIME_TYPES.includes(file.type)) {
      return true;
    }

    const filename = file.name.toLowerCase();

    return ACCEPTED_IMAGE_EXTENSIONS.some((ext) => filename.endsWith(ext));
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

    selectedPhotoPreviews.value.push({ id, file, src });
  });

  fileInputKey.value += 1;
};

const removePreview = (previewId: string) => {
  const index = selectedPhotoPreviews.value.findIndex(
    (preview) => preview.id === previewId
  );

  if (index === -1) return;

  URL.revokeObjectURL(selectedPhotoPreviews.value[index].src);
  selectedPhotoPreviews.value.splice(index, 1);
};

const saveProfileStatusPhotos = async () => {
  if (!channelId.value) return;

  if (!selectedPhotoPreviews.value.length) {
    channelStore.showSnackbar(
      t('profile_status_no_photos_selected'),
      EColor.warning
    );

    return;
  }

  try {
    isSavingProfileStatus.value = true;

    const response = await channelStore.uploadWorkerProfilePhotos(
      channelId.value,
      selectedPhotoPreviews.value.map((preview) => preview.file),
      isPermanent.value
    );

    if (response) {
      existingPhotos.value = response.map((photo) => ({
        ...photo,
        created_at: '',
      }));
      resetPendingSelections();
    }
  } finally {
    isSavingProfileStatus.value = false;
  }
};

const openPreview = (src: string) => {
  previewDialog.value = {
    open: true,
    src,
  };
};

const closePreview = () => {
  previewDialog.value = {
    open: false,
    src: null,
  };
};

const togglePermanent = async (photo: ProfileStatusPhoto) => {
  if (!channelId.value) return;

  const newIsPermanent = !photo.is_permanent;

  const success = await channelStore.updateProfileStatusPhotoIsPermanent(
    photo.worker_profile_status_id,
    newIsPermanent
  );

  if (success) {
    const index = existingPhotos.value.findIndex(
      (p) => p.worker_profile_status_id === photo.worker_profile_status_id
    );

    if (index !== -1) {
      existingPhotos.value[index] = {
        ...existingPhotos.value[index],
        is_permanent: newIsPermanent,
      };
    }
  }
};

const deletePhoto = async (photo: ProfileStatusPhoto) => {
  if (!channelId.value) return;

  const success = await channelStore.deleteProfileStatusPhoto(
    photo.worker_profile_status_id
  );

  if (success) {
    existingPhotos.value = existingPhotos.value.filter(
      (p) => p.worker_profile_status_id !== photo.worker_profile_status_id
    );
  }
};

watch(isVisible, async (visible) => {
  if (visible) {
    currentTab.value = 'general';
    await fetchProfileStatusPhotos();
  } else {
    resetPendingSelections();
    closePreview();
  }
});

watch(channelId, async (newValue, oldValue) => {
  if (isVisible.value && newValue && newValue !== oldValue) {
    await fetchProfileStatusPhotos();
  }
});

watch(currentTab, async (newTab) => {
  if (newTab === 'profile-status' && isVisible.value && channelId.value) {
    await fetchProfileStatusPhotos();
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

      <VWindow v-model="currentTab">
        <VWindowItem value="general">
          <VCardText class="py-10" />
        </VWindowItem>

        <VWindowItem value="profile-status">
          <VCardText class="d-flex flex-column gap-4 position-relative">
            <VOverlay
              v-model="isLoadingProfileStatus"
              class="align-center justify-center"
              contained
            >
              <VProgressCircular color="primary" indeterminate size="32" />
            </VOverlay>

            <VAlert
              color="warning"
              variant="tonal"
              :text="$t('profile_status_upload_helper')"
              icon="tabler-info-circle"
              class="alert-helper"
            />

            <div>
              <div class="d-flex align-center gap-4 file-input-wrapper">
                <VFileInput
                  :key="fileInputKey"
                  multiple
                  show-size
                  counter
                  chips
                  :accept="ACCEPTED_IMAGE_TYPES"
                  :label="$t('profile_status_upload_button')"
                  class="flex-grow-1"
                  @update:model-value="handleFilesSelected"
                />
                <VTooltip location="top" transition="scale-transition">
                  <template #activator="{ props: tooltipProps }">
                    <VCheckbox
                      v-bind="tooltipProps"
                      v-model="isPermanent"
                      :label="$t('is_permanent')"
                      hide-details
                      density="comfortable"
                      class="permanent-checkbox"
                    />
                  </template>
                  <span>{{ $t('is_permanent_tooltip') }}</span>
                </VTooltip>
              </div>
              <span class="text-caption text-medium-emphasis mt-2">
                {{ $t('profile_status_tab_description') }}
              </span>
            </div>

            <div v-if="selectedPhotoPreviews.length">
              <p class="text-subtitle-2 mb-2">
                {{ $t('profile_status_pending_title') }}
              </p>
              <VRow>
                <VCol
                  v-for="photo in selectedPhotoPreviews"
                  :key="photo.id"
                  cols="12"
                  sm="6"
                  md="4"
                >
                  <VCard class="pa-2 photo-pending-card">
                    <VImg
                      :src="photo.src"
                      aspect-ratio="1"
                      cover
                      class="rounded mb-2"
                    />
                    <div class="d-flex justify-space-between align-center">
                      <span class="text-caption">{{
                        $t('profile_status_preview_label')
                      }}</span>
                      <VBtn
                        icon="tabler-x"
                        variant="text"
                        color="error"
                        size="small"
                        @click="removePreview(photo.id)"
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
                :disabled="!selectedPhotoPreviews.length"
                @click="saveProfileStatusPhotos"
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

              <VRow v-if="existingPhotos.length">
                <VCol
                  v-for="photo in existingPhotos"
                  :key="photo.worker_profile_status_id"
                  cols="6"
                  sm="4"
                  md="3"
                >
                  <div class="photo-container">
                    <VCard
                      class="pa-2 photo-existing-card"
                      @click="openPreview(photo.url)"
                    >
                      <div class="photo-wrapper position-relative">
                        <VImg
                          :src="photo.url"
                          aspect-ratio="1"
                          cover
                          class="rounded"
                        />
                        <div class="photo-actions">
                          <VIcon
                            :icon="
                              photo.is_permanent
                                ? 'tabler-lock'
                                : 'tabler-lock-open'
                            "
                            size="20"
                            class="action-icon permanent-icon"
                            :color="
                              photo.is_permanent ? 'primary' : 'secondary'
                            "
                            @click.stop="togglePermanent(photo)"
                          />
                          <VIcon
                            icon="tabler-trash"
                            size="20"
                            class="action-icon delete-icon"
                            color="error"
                            @click.stop="deletePhoto(photo)"
                          />
                        </div>
                      </div>
                    </VCard>
                    <span class="photo-date">{{
                      formatDate(photo.created_at)
                    }}</span>
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
          </VCardText>
        </VWindowItem>

        <VWindowItem value="profile-info">
          <VCardText class="py-10" />
        </VWindowItem>
      </VWindow>
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
  background-color: rgba(255, 255, 255, 0.95);
  border-radius: 8px;
  padding: 6px;
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

.photo-date {
  font-size: 0.75rem;
  font-style: italic;
  color: rgba(var(--v-theme-on-surface), 0.6);
  text-align: center;
}
</style>
