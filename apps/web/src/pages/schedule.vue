<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { formatDate } from '@core/common/functions/formatDate';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { DataTableHeader } from 'vuetify';
import { ESchedulePermissions } from '@core/common/enums/EPermissions/schedule';
import { useScheduleStore } from '@/@webcore/stores/schedule';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { EScheduleType } from '@core/common/enums/EScheduleType';
import { EScheduleSendTo } from '@core/common/enums/EScheduleSendTo';
import { EScheduleStatus } from '@core/common/enums/EScheduleStatus';
import { ListScheduleResponse } from '@core/schema/schedule/listSchedule/response.schema';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      ESchedulePermissions.schedule_group,
      ESchedulePermissions.schedule_view,
      ESchedulePermissions.schedule_create,
      ESchedulePermissions.schedule_update,
      ESchedulePermissions.schedule_delete,
    ],
  },
});

const permissionsEdit = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ESchedulePermissions.schedule_group,
  ESchedulePermissions.schedule_update,
];
const permissionsDelete = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ESchedulePermissions.schedule_group,
  ESchedulePermissions.schedule_delete,
];
const permissionsCreate = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ESchedulePermissions.schedule_group,
  ESchedulePermissions.schedule_create,
];

const { t } = useI18n();
const scheduleStore = useScheduleStore();
useSnackbarCleanup(scheduleStore);

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
]);

const itemsType = computed(() => [
  { id: '', text: t('all_types') },
  { id: EScheduleType.text, text: t('message_type_text') },
  { id: EScheduleType.image, text: t('message_type_image') },
  { id: EScheduleType.video, text: t('message_type_video') },
  { id: EScheduleType.audio, text: t('message_type_audio') },
  { id: EScheduleType.chatbot, text: t('message_type_chatbot') },
]);

const itemsSendTo = computed(() => [
  { id: '', text: t('all_types') },
  { id: EScheduleSendTo.contacts, text: t('contacts') },
  { id: EScheduleSendTo.contact_groups, text: t('contact_groups') },
  { id: EScheduleSendTo.all, text: t('all') },
]);

const imageExts = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
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
  if (type === EScheduleType.image) return 'tabler-photo';
  if (type === EScheduleType.video) return 'tabler-video';
  if (type === EScheduleType.audio) return 'tabler-music';

  const ext = getExtFromUrl(url);

  if (imageExts.has(ext)) return 'tabler-photo';
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

function openAttachmentPreview(item: ListScheduleResponse) {
  const url = item.url;
  if (!url) return;

  let type: AttachmentPreviewType | null = null;

  if (item.type === EScheduleType.image) type = 'image';
  else if (item.type === EScheduleType.video) type = 'video';
  else if (item.type === EScheduleType.audio) type = 'audio';

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

const getTypeLabel = (type: string): string => {
  if (type === EScheduleType.text) return t('message_type_text');
  if (type === EScheduleType.image) return t('message_type_image');
  if (type === EScheduleType.video) return t('message_type_video');
  if (type === EScheduleType.audio) return t('message_type_audio');
  if (type === EScheduleType.chatbot) return t('message_type_chatbot');
  return type;
};

const getTypeColor = (type: string): string => {
  if (type === EScheduleType.text) return 'info';
  if (type === EScheduleType.image) return 'success';
  if (type === EScheduleType.video) return 'secondary';
  if (type === EScheduleType.audio) return 'warning';
  if (type === EScheduleType.chatbot) return 'teal';
  return 'default';
};

const getSendToLabel = (sendTo: string): string => {
  if (sendTo === EScheduleSendTo.contacts) return t('contacts');
  if (sendTo === EScheduleSendTo.contact_groups) return t('contact_groups');
  if (sendTo === EScheduleSendTo.all) return t('all');
  return sendTo;
};

const getStatusLabel = (status: string): string => {
  if (status === EScheduleStatus.pending) return t('pending');
  if (status === EScheduleStatus.processing) return t('processing');
  if (status === EScheduleStatus.sent) return t('sent');
  if (status === EScheduleStatus.failed) return t('failed');
  if (status === EScheduleStatus.limit_exhausted) return t('limit_exhausted');
  if (status === EScheduleStatus.ignored) return t('ignored');
  return status;
};

const getStatusColor = (status: string): string => {
  if (status === EScheduleStatus.pending) return 'warning';
  if (status === EScheduleStatus.processing) return 'info';
  if (status === EScheduleStatus.sent) return 'success';
  if (status === EScheduleStatus.failed) return 'error';
  if (status === EScheduleStatus.limit_exhausted) return 'error';
  if (status === EScheduleStatus.ignored) return 'warning';
  return 'default';
};

const isDialogDeleterShow = ref(false);
const scheduleToDelete = ref<string | null>(null);

const isDialogEditScheduleShow = ref(false);
const isAddScheduleVisible = ref(false);
const scheduleToEdit = ref<string | null>(null);
const isViewMessagesDialogShow = ref(false);
const scheduleToView = ref<string | null>(null);

const headers: DataTableHeader<ListScheduleResponse>[] = [
  { title: t('worker'), key: 'worker' },
  { title: t('type'), key: 'type' },
  { title: t('chatbot'), key: 'chatbot_name' },
  { title: t('send_to'), key: 'send_to' },
  { title: t('message'), key: 'message' },
  { title: t('attachment'), key: 'url' },
  { title: t('send_date'), key: 'send_date' },
  { title: t('status'), key: 'status' },
  { title: t('created_at'), key: 'created_at' },
  { title: t('actions'), key: 'actions', sortable: false },
];

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
  type: null as string | null,
  send_to: null as string | null,
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
  type: options.value.type,
  send_to: options.value.send_to,
  search: debouncedSearch.value || undefined,
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

const deleteSchedule = async (id: string) => {
  scheduleToDelete.value = id;

  isDialogDeleterShow.value = true;
};

const handleDelete = async () => {
  if (!scheduleToDelete.value) return;

  const result = await scheduleStore.deleteSchedule(scheduleToDelete.value);
  if (result) {
    await scheduleStore.listSchedule(query.value);
  }

  scheduleToDelete.value = null;
};

const openEditDialog = (id: string) => {
  scheduleToEdit.value = id;

  isDialogEditScheduleShow.value = true;
};

const openViewMessagesDialog = (id: string) => {
  scheduleToView.value = id;
  isViewMessagesDialogShow.value = true;
};

watch(
  query,
  async (q) => {
    await scheduleStore.listSchedule(q);
  },
  { immediate: true, deep: true }
);
</script>

<template>
  <div>
    <VCard :title="$t('schedules')" no-padding>
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
              @click="isAddScheduleVisible = true"
            >
              {{ $t('add') }}
            </VBtn>
          </div>
          <div class="d-flex align-center flex-wrap gap-4">
            <div class="type-filter">
              <VLabel class="text-body-2 mb-1">{{ $t('type') }}:</VLabel>
              <AppSelectSearch
                v-model="options.type"
                :items="itemsType"
                :placeholder="$t('select_type')"
                :clearable="true"
                item-value="id"
                item-title="text"
                @update:modelValue="options.page = 1"
              />
            </div>
            <div class="send-to-filter">
              <VLabel class="text-body-2 mb-1">{{ $t('send_to') }}:</VLabel>
              <AppSelectSearch
                v-model="options.send_to"
                :items="itemsSendTo"
                :placeholder="$t('select_send_to')"
                :clearable="true"
                item-value="id"
                item-title="text"
                @update:modelValue="options.page = 1"
              />
            </div>
            <div class="invoice-list-filter">
              <VLabel class="text-body-2 mb-1">{{ $t('search') }}:</VLabel>
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

        <VDivider class="my-4" />

        <div>
          <VDataTableServer
            class="data-table"
            v-model:page="options.page"
            v-model:items-per-page="options.itemsPerPage"
            :headers="headers"
            :items="scheduleStore.list"
            :items-length="scheduleStore.pagings.total"
            :loading="scheduleStore.loading"
            :sort-by="options.sortBy"
            @update:options="handleTableChange"
            :loading-text="$t('loading_text')"
          >
            <template #item.worker="{ item }">
              {{ item.worker.name }}
            </template>

            <template #item.type="{ item }">
              <VChip
                :color="getTypeColor(item.type)"
                size="small"
                variant="tonal"
              >
                {{ getTypeLabel(item.type) }}
              </VChip>
            </template>

            <template #item.chatbot_name="{ item }">
              <span v-if="item.chatbot_name">{{ item.chatbot_name }}</span>
              <span v-else class="text-medium-emphasis">-</span>
            </template>

            <template #item.send_to="{ item }">
              {{ getSendToLabel(item.send_to) }}
            </template>

            <template #item.message="{ item }">
              <span
                v-if="item.message"
                class="d-inline-block text-truncate"
                style="max-width: 350px"
              >
                {{ item.message }}
              </span>
              <span v-else class="text-medium-emphasis">-</span>
            </template>

            <template #item.url="{ item }">
              <div v-if="item.url" class="d-flex align-center">
                <IconBtn @click="openAttachmentPreview(item)">
                  <VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('click_to_preview') }}</span>
                  </VTooltip>
                  <VIcon :icon="getAttachmentIcon(item.url, item.type)" />
                </IconBtn>
              </div>
              <span v-else class="text-medium-emphasis">-</span>
            </template>

            <template #item.send_date="{ item }">
              <span>{{ formatDateTime(item?.send_date ?? null) }}</span>
            </template>

            <template #item.status="{ item }">
              <VChip
                v-if="item.status"
                :color="getStatusColor(item.status)"
                size="small"
                variant="tonal"
              >
                {{ getStatusLabel(item.status) }}
              </VChip>
              <span v-else class="text-medium-emphasis">-</span>
            </template>

            <template #item.created_at="{ item }">
              <span>{{ formatDate(item?.created_at ?? null) }}</span>
            </template>

            <template #item.actions="{ item }">
              <div class="d-flex gap-1">
                <IconBtn
                  v-if="$canPermission(permissionsEdit) && item?.schedule_id"
                  ><VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('edit_schedule') }}</span> </VTooltip
                  ><VIcon
                    icon="tabler-edit"
                    @click="openEditDialog(item.schedule_id)"
                /></IconBtn>

                <IconBtn v-if="item.schedule_id"
                  ><VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('view') }}</span> </VTooltip
                  ><VIcon
                    icon="tabler-eye"
                    @click="openViewMessagesDialog(item.schedule_id)"
                /></IconBtn>

                <IconBtn
                  v-if="$canPermission(permissionsDelete) && item.schedule_id"
                  ><VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('delete_schedule') }}</span> </VTooltip
                  ><VIcon
                    icon="tabler-trash"
                    @click="deleteSchedule(item.schedule_id)"
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
                :total-items="scheduleStore.pagings.total"
              />
            </template>
          </VDataTableServer>
        </div>
      </VCardText>

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
        :title="$t('delete_schedule')"
        :message="$t('delete_schedule_confirmation')"
        @confirm="handleDelete"
      />

      <AppEditSchedule
        v-if="isDialogEditScheduleShow"
        v-model="isDialogEditScheduleShow"
        :schedule-id="scheduleToEdit"
      />

      <AppAddSchedule
        v-if="isAddScheduleVisible"
        v-model="isAddScheduleVisible"
      />

      <AppViewScheduleMessages
        v-if="isViewMessagesDialogShow"
        v-model="isViewMessagesDialogShow"
        :schedule-id="scheduleToView"
      />
    </VCard>

    <VSnackbar
      v-model="scheduleStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="scheduleStore.snackbar.color"
    >
      {{ scheduleStore.snackbar.message }}
    </VSnackbar>
  </div>
</template>

<style lang="scss" scoped>
.type-filter {
  inline-size: 12rem;
}

.send-to-filter {
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

.data-table {
  :deep(.v-table__wrapper > table > thead) {
    background-color: rgba(var(--v-theme-on-surface), 0.04);
  }

  :deep(.v-table__wrapper > table > thead > tr > th) {
    background-color: transparent;
    color: rgb(var(--v-theme-primary));
    font-weight: 700;
    border-bottom: 1px solid rgba(var(--v-theme-primary), 0.25);
  }

  :deep(
    .v-table__wrapper > table > thead > tr > th .v-data-table-header__content
  ) {
    color: inherit;
  }
}
</style>
