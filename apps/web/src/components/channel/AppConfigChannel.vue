<script lang="ts" setup>
import { useChannelsStore } from '@/@webcore/stores/channels';
import { EColor } from '@core/common/enums/EColor';
import { IWorkerProfilePhoto } from '@/@webcore/interfaces/IWorkerProfilePhoto';

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
const existingPhotos = ref<IWorkerProfilePhoto[]>([]);
const isSavingProfileStatus = ref(false);
const fileInputKey = ref(0);
const previewDialog = ref<{ open: boolean; src: string | null }>({
  open: false,
  src: null,
});
const isPermanent = ref(false);

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

  const response = await channelStore.fetchWorkerProfilePhotos(channelId.value);

  if (response) {
    existingPhotos.value = response;
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
      selectedPhotoPreviews.value.map((preview) => preview.file)
    );

    if (response) {
      existingPhotos.value = response;
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
  if (
    isVisible.value &&
    newValue &&
    newValue !== oldValue &&
    typeof newValue === 'string'
  ) {
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
        <VTab value="profile-status">{{ $t('profile_status_tab') }}</VTab>
        <VTab value="profile-info">{{ $t('profile_information_tab') }}</VTab>
      </VTabs>

      <VDivider />

      <VWindow v-model="currentTab">
        <VWindowItem value="general">
          <VCardText class="py-10" />
        </VWindowItem>

        <VWindowItem value="profile-status">
          <VCardText class="d-flex flex-column gap-4">
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
                  cols="12"
                  sm="6"
                  md="4"
                >
                  <VCard
                    class="pa-2 photo-existing-card"
                    @click="openPreview(photo.url)"
                  >
                    <VImg
                      :src="photo.url"
                      aspect-ratio="1"
                      cover
                      class="rounded"
                    />
                  </VCard>
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

      <VCardActions class="justify-end">
        <VBtn variant="tonal" color="secondary" @click="closePreview">
          {{ $t('profile_status_close_preview') }}
        </VBtn>
      </VCardActions>
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
</style>
