<script lang="ts" setup>
import { ref, watch, computed } from 'vue';
import { useScheduleStore } from '@/@webcore/stores/schedule';
import { EScheduleType } from '@core/common/enums/EScheduleType';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import { ScheduleMessageResult } from '@core/schema/schedule/listScheduleMessages/response.schema';
import { DataTableHeader } from 'vuetify';

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

const messages = ref<ScheduleMessageResult[]>([]);
const isLoading = ref(false);
const pagings = ref({
  total: 0,
  per_page: 50,
  current_page: 1,
  last_page: 1,
});

const options = ref({
  page: 1,
  itemsPerPage: 50,
});

const headers: DataTableHeader<ScheduleMessageResult>[] = [
  { title: t('contact'), key: 'contact' },
  { title: t('channel'), key: 'worker' },
  { title: t('chatbot'), key: 'chatbot_name' },
  { title: t('message'), key: 'message' },
  { title: t('status'), key: 'status' },
  { title: t('send_date'), key: 'send_date' },
];

const getContactName = (item: ScheduleMessageResult): string => {
  if (item.contact?.name) {
    return item.contact.name;
  }
  return '-';
};

const formatBrazilianPhoneWithDdi = (
  cleanPhone: string,
  cleanDdi: string
): string | null => {
  if (cleanDdi !== '55' || cleanPhone.length < 10) {
    return null;
  }

  const ddd = cleanPhone.slice(0, 2);
  const number = cleanPhone.slice(2);

  if (number.length === 8) {
    return `+55 (${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;
  }

  if (number.length === 9) {
    return `+55 (${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`;
  }

  return null;
};

const formatPhoneWithDdi = (cleanPhone: string, cleanDdi: string): string => {
  const fullPhone = `${cleanDdi}${cleanPhone}`;
  const formatted = formatPhoneBR(fullPhone);

  if (formatted !== fullPhone && formatted !== cleanPhone) {
    return formatted;
  }

  const brazilianFormatted = formatBrazilianPhoneWithDdi(cleanPhone, cleanDdi);
  if (brazilianFormatted) {
    return brazilianFormatted;
  }

  return `+${cleanDdi} ${cleanPhone}`;
};

const formatPhoneWithoutDdi = (cleanPhone: string): string => {
  if (cleanPhone.length < 10) {
    return '';
  }

  const formatted = formatPhoneBR(cleanPhone);
  if (formatted !== cleanPhone) {
    return formatted;
  }

  if (cleanPhone.length === 10) {
    return `(${cleanPhone.slice(0, 2)}) ${cleanPhone.slice(2, 6)}-${cleanPhone.slice(6)}`;
  }

  if (cleanPhone.length === 11) {
    return `(${cleanPhone.slice(0, 2)}) ${cleanPhone.slice(2, 7)}-${cleanPhone.slice(7)}`;
  }

  return '';
};

const formatPhoneNumber = (phone: string, ddi?: string | null): string => {
  if (!phone) {
    return '-';
  }

  const cleanPhone = phone.replaceAll(/\D/g, '');

  if (ddi) {
    const cleanDdi = ddi.replaceAll(/\D/g, '');
    return formatPhoneWithDdi(cleanPhone, cleanDdi);
  }

  const formatted = formatPhoneWithoutDdi(cleanPhone);
  return formatted || phone;
};

const getContactPhone = (item: ScheduleMessageResult): string => {
  if (!item.contact?.phone) {
    return '-';
  }

  return formatPhoneNumber(item.contact.phone, item.contact.phone_ddi);
};

const getWorkerName = (item: ScheduleMessageResult): string => {
  return item.worker?.name || '-';
};

const getChatbotName = (item: ScheduleMessageResult): string => {
  return item.chatbot_name || '-';
};

const getMessageTypeLabel = (type: string | null | undefined): string => {
  if (!type) {
    return '';
  }

  if (type === EScheduleType.text) {
    return `[${t('message_type_text')}]`;
  }

  if (type === EScheduleType.image) {
    return `[${t('message_type_image')}]`;
  }

  if (type === EScheduleType.video) {
    return `[${t('message_type_video')}]`;
  }

  if (type === EScheduleType.audio) {
    return `[${t('message_type_audio')}]`;
  }

  return '';
};

const getStatusLabel = (status: string): string => {
  if (status === 'sent') return t('sent');
  if (status === 'failed') return t('failed');
  if (status === 'pending') return t('pending');
  if (status === 'processing') return t('processing');
  if (status === 'processed') return t('processed');
  if (status === 'limit_exhausted') return t('limit_exhausted');
  if (status === 'ignored') return t('ignored');
  return status;
};

const getStatusColor = (status: string): string => {
  if (status === 'sent') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'pending') return 'warning';
  if (status === 'processing') return 'info';
  if (status === 'processed') return 'success';
  if (status === 'limit_exhausted') return 'error';
  if (status === 'ignored') return 'warning';
  return 'default';
};

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

const logDialog = ref<{
  open: boolean;
  log: any;
}>({
  open: false,
  log: null,
});

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
  previewDialog.value = {
    open: false,
    src: null,
    caption: null,
    text: null,
    type: null,
  };
};

const openLog = (log: any) => {
  logDialog.value = {
    open: true,
    log,
  };
};

const closeLog = () => {
  logDialog.value = {
    open: false,
    log: null,
  };
};

const formatLog = (log: any): string => {
  if (!log) {
    return '';
  }

  try {
    return JSON.stringify(log, null, 2);
  } catch {
    return String(log);
  }
};

const loadMessages = async () => {
  if (!props.scheduleId) return;

  isLoading.value = true;

  const result = await scheduleStore.listScheduleMessages(
    props.scheduleId,
    options.value.page,
    options.value.itemsPerPage
  );

  isLoading.value = false;

  if (result) {
    messages.value = result.results;
    pagings.value = {
      total: result.pagings.total,
      per_page: result.pagings.per_page,
      current_page: result.pagings.current_page,
      last_page: result.pagings.total_pages,
    };
  }
};

const handleTableChange = (o: { page: number; itemsPerPage: number }) => {
  options.value.page = o.page;
  options.value.itemsPerPage = o.itemsPerPage;
};

watch(
  [isVisible, () => props.scheduleId],
  async ([visible, id]) => {
    if (visible && id) {
      await loadMessages();
    } else if (!visible) {
      messages.value = [];
      options.value.page = 1;
    }
  },
  { immediate: true }
);

watch(
  options,
  () => {
    if (isVisible.value) {
      loadMessages();
    }
  },
  { deep: true }
);
</script>

<template>
  <VDialog v-model="isVisible" max-width="1200" :persistent="isLoading">
    <DialogCloseBtn :disabled="isLoading" @click="isVisible = false" />

    <VOverlay
      :model-value="isLoading"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VCard :title="$t('schedule_messages')">
      <VCardText>
        <VDataTableServer
          class="data-table"
          v-model:page="options.page"
          v-model:items-per-page="options.itemsPerPage"
          :headers="headers"
          :items="messages"
          :items-length="pagings.total"
          :loading="isLoading"
          @update:options="handleTableChange"
          :loading-text="$t('loading_text')"
        >
          <template #item.contact="{ item }">
            <div>
              <div class="text-body-2">{{ getContactName(item) }}</div>
              <div class="text-caption text-medium-emphasis">
                {{ getContactPhone(item) }}
              </div>
            </div>
          </template>

          <template #item.worker="{ item }">
            {{ getWorkerName(item) }}
          </template>

          <template #item.chatbot_name="{ item }">
            {{ getChatbotName(item) }}
          </template>

          <template #item.message="{ item }">
            <div class="d-flex align-center gap-2">
              <span class="text-medium-emphasis">
                {{ item.url || item.message ? getMessageTypeLabel(item.type) : '-' }}
              </span>
              <VBtn
                v-if="item.url || item.message"
                size="x-small"
                variant="text"
                color="primary"
                icon="tabler-eye"
                @click="
                  openPreview(
                    item.url ?? null,
                    item.type === EScheduleType.text
                      ? null
                      : (item.message ?? null),
                    item.type === EScheduleType.text
                      ? (item.message ?? null)
                      : null,
                    item.type as EScheduleType
                  )
                "
              />
            </div>
          </template>

          <template #item.status="{ item }">
            <div class="d-flex align-center gap-2">
              <VChip
                v-if="item.status"
                :color="getStatusColor(item.status)"
                size="small"
                variant="tonal"
              >
                {{ getStatusLabel(item.status) }}
              </VChip>
              <span v-else class="text-medium-emphasis">-</span>
              <VBtn
                v-if="item.send_log"
                size="x-small"
                variant="text"
                color="primary"
                icon="tabler-file-text"
                @click="openLog(item.send_log)"
              />
            </div>
          </template>

          <template #item.send_date="{ item }">
            <span>{{ formatDateTime(item.send_date ?? null) }}</span>
          </template>

          <template #no-data>
            {{ $t('no_data_available') }}
          </template>

          <template #bottom>
            <TablePagination
              v-model:page="options.page"
              :items-per-page="options.itemsPerPage"
              :total-items="pagings.total"
            />
          </template>
        </VDataTableServer>
      </VCardText>

      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          :disabled="isLoading"
          @click="isVisible = false"
        >
          {{ $t('close') }}
        </VBtn>
      </VCardText>
    </VCard>

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
            <audio
              :src="previewDialog.src || undefined"
              controls
              style="width: 100%"
            >
              <track kind="captions" />
            </audio>
          </div>
          <div
            v-if="previewDialog.text"
            class="d-flex align-center justify-center pa-8"
            style="min-height: 200px"
          >
            <p
              class="text-body-1 text-center"
              style="white-space: pre-wrap; word-break: break-word"
            >
              {{ previewDialog.text }}
            </p>
          </div>
          <div v-if="previewDialog.caption" class="mt-4 text-center">
            <p
              class="text-body-2 text-medium-emphasis font-italic"
              style="white-space: pre-wrap; word-break: break-word"
            >
              {{ previewDialog.caption }}
            </p>
          </div>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="closePreview">
            {{ $t('close') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VDialog>

    <VDialog v-model="logDialog.open" max-width="800">
      <DialogCloseBtn @click="closeLog" />
      <VCard :title="$t('send_log')">
        <VCardText>
          <VTextarea
            :model-value="formatLog(logDialog.log)"
            readonly
            auto-grow
            rows="15"
            variant="outlined"
            class="font-monospace"
            style="font-size: 0.875rem"
          />
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="closeLog">
            {{ $t('close') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VDialog>
  </VDialog>
</template>

<style lang="scss" scoped>
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
