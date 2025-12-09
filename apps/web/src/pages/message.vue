<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { DataTableHeader } from 'vuetify';
import { EMessageTemplatePermissions } from '@core/common/enums/EPermissions/messageTemplate';
import { useMessageTemplateStore } from '@/@webcore/stores/messageTemplate';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { EMessageStatus } from '@core/common/enums/EMessageStatus';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ListMessageTemplateResponse } from '@core/schema/messageTemplate/listMessageTemplate/response.schema';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EMessageTemplatePermissions.message_template_group,
      EMessageTemplatePermissions.message_view,
      EMessageTemplatePermissions.message_create,
      EMessageTemplatePermissions.message_update,
      EMessageTemplatePermissions.message_delete,
    ],
  },
});

const permissionsEdit = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EMessageTemplatePermissions.message_template_group,
  EMessageTemplatePermissions.message_update,
];
const permissionsDelete = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EMessageTemplatePermissions.message_template_group,
  EMessageTemplatePermissions.message_delete,
];
const permissionsCreate = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EMessageTemplatePermissions.message_template_group,
  EMessageTemplatePermissions.message_create,
];

const { t } = useI18n();
const messageTemplateStore = useMessageTemplateStore();
useSnackbarCleanup(messageTemplateStore);

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
]);

const itemsStatus = ref([
  { id: '', text: t('all') },
  { id: EMessageStatus.active, text: t('active') },
  { id: EMessageStatus.inactive, text: t('inactive') },
]);

const imageExts = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
const pdfExts = new Set(['pdf']);
const audioExts = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus']);

function getExtFromUrl(url: string | null | undefined): string {
  if (!url) return '';

  const getLastSegment = (value: string) => {
    const clean = value.split(/[?#]/)[0];
    return clean.split('/').findLast((segment) => segment.length > 0) ?? '';
  };

  try {
    const u = new URL(url);
    const last = getLastSegment(u.pathname);
    const i = last.lastIndexOf('.');
    return i >= 0 ? last.slice(i + 1).toLowerCase() : '';
  } catch {
    const last = getLastSegment(url);
    const i = last.lastIndexOf('.');
    return i >= 0 ? last.slice(i + 1).toLowerCase() : '';
  }
}

function getAttachmentIcon(
  url: string | null | undefined,
  type?: string
): string {
  // Se o tipo estiver disponível, use-o diretamente
  if (type === EMessageType.image) return 'tabler-photo';
  if (type === EMessageType.video) return 'tabler-video';
  if (type === EMessageType.audio) return 'tabler-music';

  // Fallback: usa a extensão do arquivo
  const ext = getExtFromUrl(url);

  if (imageExts.has(ext)) return 'tabler-photo';
  if (pdfExts.has(ext)) return 'tabler-file-type-pdf';
  if (audioExts.has(ext)) return 'tabler-music';

  return 'tabler-file';
}

function openAttachment(url: string | null | undefined) {
  if (!url) return;
  window.open(url, '_blank');
}

type AttachmentPreviewType = 'image' | 'video' | 'audio';

const attachmentPreviewDialog = ref<{
  open: boolean;
  src: string | null;
  type: AttachmentPreviewType | null;
}>({
  open: false,
  src: null,
  type: null,
});

const audioPreviewRef = ref<HTMLAudioElement | null>(null);
const isAudioPlaying = ref(false);
const audioProgress = ref(0);
const audioDuration = ref(0);
const audioCurrentTime = ref(0);
const audioWaveformBars = ref<number[]>([]);

const closeAttachmentPreview = () => {
  if (audioPreviewRef.value) {
    audioPreviewRef.value.pause();
    audioPreviewRef.value.currentTime = 0;
  }
  isAudioPlaying.value = false;
  audioProgress.value = 0;
  audioDuration.value = 0;
  audioCurrentTime.value = 0;
  audioWaveformBars.value = [];
  attachmentPreviewDialog.value = {
    open: false,
    src: null,
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

function openAttachmentPreview(item: ListMessageTemplateResponse) {
  const url = item.attachment_url;
  if (!url) return;

  let type: AttachmentPreviewType | null = null;

  if (item.type === EMessageType.image) type = 'image';
  else if (item.type === EMessageType.video) type = 'video';
  else if (item.type === EMessageType.audio) type = 'audio';

  if (!type) {
    const ext = getExtFromUrl(url);
    if (imageExts.has(ext)) type = 'image';
    else if (audioExts.has(ext)) type = 'audio';
  }

  if (!type) {
    openAttachment(url);
    return;
  }

  attachmentPreviewDialog.value = {
    open: true,
    src: url,
    type,
  };
}

const isDialogDeleterShow = ref(false);
const messageTemplateToDelete = ref<string | null>(null);

const isDialogEditMessageTemplateShow = ref(false);
const isAddMessageTemplateVisible = ref(false);
const messageTemplateToEdit = ref<string | null>(null);

const headers: DataTableHeader<ListMessageTemplateResponse>[] = [
  { title: t('message'), key: 'message' },
  { title: t('shortcut'), key: 'command' },
  { title: t('message_status'), key: 'message_status' },
  { title: t('attachment'), key: 'attachment_url' },
  { title: t('created_at'), key: 'created_at' },
  { title: t('actions'), key: 'actions', sortable: false },
];

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
  message_status: null as string | null,
  search: null as string | null,
});

const debouncedSearch = refDebounced(
  computed(() => options.value.search),
  500
);

const query = computed(() => ({
  page: options.value.page,
  per_page: options.value.itemsPerPage,
  sort_by: options.value.sortBy,
  message_status: options.value.message_status,
  search: debouncedSearch.value,
}));

const handleTableChange = (o: {
  page: number;
  itemsPerPage: number;
  sortBy: SortRequest[];
}) => {
  options.value.page = o.page;
  options.value.itemsPerPage = o.itemsPerPage;
  options.value.sortBy = o.sortBy;
};

const deleteMessageTemplate = async (id: string) => {
  messageTemplateToDelete.value = id;

  isDialogDeleterShow.value = true;
};

const handleDelete = async () => {
  if (!messageTemplateToDelete.value) return;

  const result = await messageTemplateStore.deleteMessageTemplate(
    messageTemplateToDelete.value
  );
  if (result) {
    await messageTemplateStore.listMessageTemplate(query.value);
  }

  messageTemplateToDelete.value = null;
};

const openEditDialog = (id: string) => {
  messageTemplateToEdit.value = id;

  isDialogEditMessageTemplateShow.value = true;
};

watch(
  query,
  async (q) => {
    await messageTemplateStore.listMessageTemplate(q);
  },
  { immediate: true, deep: true }
);
</script>

<template>
  <div>
    <VCard :title="$t('messages_template')" no-padding>
      <VCardText>
        <div class="d-flex justify-space-between flex-wrap gap-4">
          <div class="d-flex gap-4 align-center mt-5">
            <div class="d-flex align-center gap-x-2">
              <div>{{ $t('show') }}</div>
              <AppSelect
                :model-value="options.itemsPerPage"
                :items="itemsPerPage"
                @update:model-value="
                  options.itemsPerPage = parseInt($event, 10)
                "
              />
            </div>

            <VBtn
              v-if="$canPermission(permissionsCreate)"
              prepend-icon="tabler-plus"
              @click="isAddMessageTemplateVisible = true"
            >
              {{ $t('add') }}
            </VBtn>
          </div>
          <div class="d-flex align-center flex-wrap gap-4">
            <div class="status-filter">
              <VLabel class="text-body-2 mb-1">{{ $t('status') }}:</VLabel>
              <AppSelectSearch
                v-model="options.message_status"
                :items="itemsStatus"
                :placeholder="$t('select_state')"
                :clearable="true"
                item-value="id"
                item-title="text"
                @update:modelValue="options.page = 1"
              />
            </div>
            <div class="invoice-list-filter">
              <VLabel>{{ $t('search') }}:</VLabel>
              <AppTextField
                :placeholder="$t('search') + '...'"
                append-inner-icon="tabler-search"
                single-line
                hide-details
                dense
                outlined
                v-model="options.search"
              />
            </div>
          </div>
        </div>
      </VCardText>

      <VDataTableServer
        v-model:page="options.page"
        v-model:items-per-page="options.itemsPerPage"
        :headers="headers"
        :items="messageTemplateStore.list"
        :items-length="messageTemplateStore.pagings.total"
        :loading="messageTemplateStore.loading"
        :sort-by="options.sortBy"
        @update:options="handleTableChange"
        :loading-text="$t('loading_text')"
      >
        <template #item.message="{ item }">
          <span class="d-inline-block text-truncate" style="max-width: 350px">
            {{ item.message }}
          </span>
        </template>

        <template #item.command="{ item }">
          {{ item.command }}
        </template>

        <template #item.message_status="{ item }">
          <VChip
            v-if="item.message_status"
            :color="
              item.message_status.message_status_id === EMessageStatus.active
                ? 'success'
                : 'error'
            "
            size="small"
            variant="tonal"
          >
            {{
              item.message_status.message_status_id === EMessageStatus.active
                ? $t('active')
                : $t('inactive')
            }}
          </VChip>
          <span v-else class="text-medium-emphasis">-</span>
        </template>

        <template #item.attachment_url="{ item }">
          <div v-if="item.attachment_url" class="d-flex align-center">
            <IconBtn @click="openAttachmentPreview(item)">
              <VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('click_to_preview') }}</span>
              </VTooltip>
              <VIcon
                :icon="getAttachmentIcon(item.attachment_url, item.type)"
              />
            </IconBtn>
          </div>
          <span v-else class="text-medium-emphasis">-</span>
        </template>

        <template #item.created_at="{ item }">
          <span>{{ formatDateTime(item?.created_at ?? null) }}</span>
        </template>

        <template #item.actions="{ item }">
          <div class="d-flex gap-1">
            <IconBtn
              v-if="
                $canPermission(permissionsEdit) && item?.message_template_id
              "
              ><VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('edit_message_template') }}</span> </VTooltip
              ><VIcon
                icon="tabler-edit"
                @click="openEditDialog(item.message_template_id)"
            /></IconBtn>

            <IconBtn
              v-if="
                $canPermission(permissionsDelete) && item.message_template_id
              "
              ><VTooltip
                location="top"
                transition="scale-transition"
                activator="parent"
              >
                <span>{{ $t('delete_message_template') }}</span> </VTooltip
              ><VIcon
                icon="tabler-trash"
                @click="deleteMessageTemplate(item.message_template_id)"
            /></IconBtn>
          </div>
        </template>

        <template #no-data>
          {{ $t('no_data_available') }}
        </template>

        <template #bottom>
          <TablePagination
            v-model:page="options.page"
            :items-per-page="options.itemsPerPage"
            :total-items="messageTemplateStore.pagings.total"
          />
        </template>
      </VDataTableServer>

      <VDialog v-model="attachmentPreviewDialog.open" max-width="800">
        <DialogCloseBtn @click="closeAttachmentPreview" />
        <VCard :title="$t('preview')">
          <VCardText>
            <VImg
              v-if="
                attachmentPreviewDialog.src &&
                attachmentPreviewDialog.type === 'image'
              "
              :src="attachmentPreviewDialog.src"
              max-height="420"
              class="rounded"
              contain
            />
            <video
              v-if="
                attachmentPreviewDialog.src &&
                attachmentPreviewDialog.type === 'video'
              "
              :src="attachmentPreviewDialog.src"
              max-height="600"
              class="rounded"
              style="width: 100%"
              controls
            >
              <track kind="captions" />
            </video>
            <div
              v-if="
                attachmentPreviewDialog.src &&
                attachmentPreviewDialog.type === 'audio'
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
                      :src="attachmentPreviewDialog.src || undefined"
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
          </VCardText>
          <VCardText class="d-flex justify-end">
            <VBtn
              variant="tonal"
              color="secondary"
              @click="closeAttachmentPreview"
            >
              {{ $t('cancel') }}
            </VBtn>
          </VCardText>
        </VCard>
      </VDialog>

      <VDialogHandler
        v-if="isDialogDeleterShow"
        v-model="isDialogDeleterShow"
        :title="$t('delete_message_template')"
        :message="$t('delete_message_template_confirmation')"
        @confirm="handleDelete"
      />

      <AppEditMessageTemplate
        v-if="isDialogEditMessageTemplateShow"
        v-model="isDialogEditMessageTemplateShow"
        :message-template-id="messageTemplateToEdit"
      />

      <AppAddMessageTemplate
        v-if="isAddMessageTemplateVisible"
        v-model="isAddMessageTemplateVisible"
      />
    </VCard>

    <VSnackbar
      v-model="messageTemplateStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="messageTemplateStore.snackbar.color"
    >
      {{ messageTemplateStore.snackbar.message }}
    </VSnackbar>
  </div>
</template>

<style lang="scss">
.status-filter {
  inline-size: 12rem;
}

.invoice-list-filter {
  inline-size: 20rem;
}

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
