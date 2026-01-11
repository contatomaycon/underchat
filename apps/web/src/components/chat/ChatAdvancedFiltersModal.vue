<script lang="ts" setup>
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useChatbotStore } from '@/@webcore/stores/chatbot';
import { useChatStore } from '@/@webcore/stores/chat';
import { ChatbotChatTagResponse } from '@core/schema/chatbot/listChatTags/response.schema';
import { ListChatWorkersResponse } from '@core/schema/chat/listChatWorkers/response.schema';
import { ListChatUsersResponse } from '@core/schema/chat/listChatUsers/response.schema';
import { ListChatSectorsResponse } from '@core/schema/chat/listChatSectors/response.schema';
import AppSelectSearch from '@/components/AppSelectSearch.vue';
import AppDateTimePicker from '@/@webcore/components/app-form-elements/AppDateTimePicker.vue';
import moment from 'moment-timezone';
import { EChatStatus } from '@core/common/enums/EChatStatus';

const { t } = useI18n();

interface Props {
  modelValue: boolean;
  filterStatus?: string | null;
  filterLabel?: string | null;
  filterWorker?: string | null;
  filterUser?: string | null;
  filterSector?: string | null;
  filterName?: string | null;
  filterPhone?: string | null;
  filterProtocol?: string | null;
  filterDateStart?: string | Date | null;
  filterDateEnd?: string | Date | null;
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void;
  (e: 'update:filterStatus', value: string | null): void;
  (e: 'update:filterLabel', value: string | null): void;
  (e: 'update:filterWorker', value: string | null): void;
  (e: 'update:filterUser', value: string | null): void;
  (e: 'update:filterSector', value: string | null): void;
  (e: 'update:filterName', value: string | null): void;
  (e: 'update:filterPhone', value: string | null): void;
  (e: 'update:filterProtocol', value: string | null): void;
  (e: 'update:filterDateStart', value: string | null): void;
  (e: 'update:filterDateEnd', value: string | null): void;
  (e: 'filtersUpdated'): void;
}

const FILTER_STATUS_ALL = '__all__';
const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const chatbotStore = useChatbotStore();
const chatStore = useChatStore();

const isVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const tags = ref<ChatbotChatTagResponse[]>([]);
const isLoadingTags = ref(false);

const workers = ref<ListChatWorkersResponse>([]);
const isLoadingWorkers = ref(false);

const users = ref<ListChatUsersResponse>([]);
const isLoadingUsers = ref(false);

const sectors = ref<ListChatSectorsResponse>([]);
const isLoadingSectors = ref(false);

const filterStatus = ref<string | null>(
  props.filterStatus ?? FILTER_STATUS_ALL
);
const filterLabelTemplateId = ref<string | null>(props.filterLabel ?? null);
const filterWorkerId = ref<string | null>(props.filterWorker ?? null);
const filterUserId = ref<string | null>(props.filterUser ?? null);
const filterSectorId = ref<string | null>(props.filterSector ?? null);
const filterName = ref<string | null>(props.filterName ?? null);
const filterPhone = ref<string | null>(props.filterPhone ?? null);
const filterProtocol = ref<string | null>(props.filterProtocol ?? null);
const filterDateStart = ref<Date | null>(
  props.filterDateStart ? new Date(props.filterDateStart) : null
);
const filterDateEnd = ref<Date | null>(
  props.filterDateEnd ? new Date(props.filterDateEnd) : null
);

const statusOptions = computed(() => [
  { value: FILTER_STATUS_ALL, title: t('all', 'Todos') },
  { value: EChatStatus.queue, title: t('waiting_for_service') },
  { value: EChatStatus.in_chat, title: t('in_service') },
  { value: EChatStatus.ura, title: t('chatbot') },
  { value: EChatStatus.closed, title: t('chat_status_closed', 'Fechado') },
]);

const formatDateForApi = (
  date: Date | string | null,
  isEndDate = false
): string | null => {
  if (!date) return null;

  const BRAZIL_TIMEZONE = 'America/Sao_Paulo';
  let dateMoment: moment.Moment;

  if (date instanceof Date) {
    dateMoment = moment.tz(date, BRAZIL_TIMEZONE);
  } else if (typeof date === 'string' && date.includes('-')) {
    const parts = date.split('-');
    if (parts.length === 3) {
      const year = Number.parseInt(parts[0], 10);
      const month = Number.parseInt(parts[1], 10);
      const day = Number.parseInt(parts[2], 10);
      dateMoment = moment.tz({ year, month: month - 1, day }, BRAZIL_TIMEZONE);
    } else {
      dateMoment = moment.tz(date, BRAZIL_TIMEZONE);
    }
  } else {
    dateMoment = moment.tz(date, BRAZIL_TIMEZONE);
  }

  if (!dateMoment.isValid()) return null;

  if (isEndDate) {
    dateMoment.add(1, 'day').startOf('day');
  } else {
    dateMoment.startOf('day');
  }

  return dateMoment.utc().toISOString();
};

const loadTags = async () => {
  if (isLoadingTags.value) return;

  isLoadingTags.value = true;
  try {
    const result = await chatbotStore.listChatbotTags();
    tags.value = result;
  } catch (error) {
    console.error('Error loading tags:', error);
    tags.value = [];
  } finally {
    isLoadingTags.value = false;
  }
};

const loadWorkers = async () => {
  if (isLoadingWorkers.value) return;

  isLoadingWorkers.value = true;
  try {
    const result = await chatStore.listChatWorkers();
    workers.value = result ?? [];
  } catch (error) {
    console.error('Error loading workers:', error);
    workers.value = [];
  } finally {
    isLoadingWorkers.value = false;
  }
};

const loadUsers = async () => {
  if (isLoadingUsers.value) return;

  isLoadingUsers.value = true;
  try {
    const result = await chatStore.listChatUsers();
    users.value = result ?? [];
  } catch (error) {
    console.error('Error loading users:', error);
    users.value = [];
  } finally {
    isLoadingUsers.value = false;
  }
};

const loadSectors = async () => {
  if (isLoadingSectors.value) return;

  isLoadingSectors.value = true;
  try {
    const result = await chatStore.listChatSectors();
    sectors.value = result ?? [];
  } catch (error) {
    console.error('Error loading sectors:', error);
    sectors.value = [];
  } finally {
    isLoadingSectors.value = false;
  }
};

const isSaving = ref(false);

const handleSave = async () => {
  isSaving.value = true;
  try {
    emit(
      'update:filterStatus',
      filterStatus.value === FILTER_STATUS_ALL ? null : filterStatus.value
    );
    emit('update:filterLabel', filterLabelTemplateId.value);
    emit('update:filterWorker', filterWorkerId.value);
    emit('update:filterUser', filterUserId.value);
    emit('update:filterSector', filterSectorId.value);
    emit('update:filterName', filterName.value);
    emit('update:filterPhone', filterPhone.value);
    emit('update:filterProtocol', filterProtocol.value);
    emit(
      'update:filterDateStart',
      formatDateForApi(filterDateStart.value, false)
    );
    emit('update:filterDateEnd', formatDateForApi(filterDateEnd.value, true));
    isVisible.value = false;
    emit('filtersUpdated');
  } finally {
    isSaving.value = false;
  }
};

watch(isVisible, (visible) => {
  if (visible) {
    loadTags();
    loadWorkers();
    loadUsers();
    loadSectors();
    filterStatus.value = props.filterStatus ?? FILTER_STATUS_ALL;
    filterLabelTemplateId.value = props.filterLabel ?? null;
    filterWorkerId.value = props.filterWorker ?? null;
    filterUserId.value = props.filterUser ?? null;
    filterSectorId.value = props.filterSector ?? null;
    filterName.value = props.filterName ?? null;
    filterPhone.value = props.filterPhone ?? null;
    filterProtocol.value = props.filterProtocol ?? null;
    filterDateStart.value = props.filterDateStart
      ? new Date(props.filterDateStart)
      : null;
    filterDateEnd.value = props.filterDateEnd
      ? new Date(props.filterDateEnd)
      : null;
  }
});

watch(
  () => props.filterStatus,
  (newValue) => {
    filterStatus.value = newValue ?? FILTER_STATUS_ALL;
  }
);

watch(
  () => props.filterLabel,
  (newValue) => {
    filterLabelTemplateId.value = newValue ?? null;
  }
);

watch(
  () => props.filterWorker,
  (newValue) => {
    filterWorkerId.value = newValue ?? null;
  }
);

watch(
  () => props.filterUser,
  (newValue) => {
    filterUserId.value = newValue ?? null;
  }
);

watch(
  () => props.filterSector,
  (newValue) => {
    filterSectorId.value = newValue ?? null;
  }
);

watch(
  () => props.filterPhone,
  (newValue) => {
    filterPhone.value = newValue ?? null;
  }
);

watch(
  () => props.filterProtocol,
  (newValue) => {
    filterProtocol.value = newValue ?? null;
  }
);

watch(
  () => props.filterDateStart,
  (newValue) => {
    filterDateStart.value = newValue ? new Date(newValue) : null;
  }
);

watch(
  () => props.filterDateEnd,
  (newValue) => {
    filterDateEnd.value = newValue ? new Date(newValue) : null;
  }
);
</script>

<template>
  <VDialog v-model="isVisible" max-width="600" persistent>
    <VCard>
      <VCardTitle class="d-flex align-center justify-space-between">
        <span>{{ $t('advanced_filters') }}</span>
        <IconBtn @click="isVisible = false">
          <VIcon>tabler-x</VIcon>
        </IconBtn>
      </VCardTitle>

      <VDivider />

      <VCardText class="pt-6">
        <VRow>
          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1"
              >{{ $t('filter_by_status', 'Filtrar por status') }}:</VLabel
            >
            <AppSelectSearch
              v-model="filterStatus"
              :items="statusOptions"
              :placeholder="$t('select_status_filter', 'Selecione um status')"
              item-value="value"
              item-title="title"
            />
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">{{ $t('filter_by_tag') }}:</VLabel>
            <template v-if="isLoadingTags">
              <VSkeletonLoader type="text" width="100%" height="40" />
            </template>
            <template v-else>
              <AppSelectSearch
                v-model="filterLabelTemplateId"
                :items="
                  tags.map((tag) => ({
                    value: tag.label_template_id,
                    title: tag.label,
                    color: tag.color,
                  }))
                "
                :placeholder="$t('select_tag_filter')"
                clearable
                item-value="value"
                item-title="title"
              >
                <template #item-prepend="{ item }">
                  <VAvatar
                    v-if="item.color"
                    :color="item.color"
                    size="24"
                    class="me-2"
                  />
                </template>
                <template #prepend-inner="{ item }">
                  <VAvatar
                    v-if="item && !Array.isArray(item) && item.color"
                    :color="item.color"
                    size="20"
                    class="me-2"
                  />
                </template>
              </AppSelectSearch>
            </template>
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1"
              >{{ $t('filter_by_sector') }}:</VLabel
            >
            <template v-if="isLoadingSectors">
              <VSkeletonLoader type="text" width="100%" height="40" />
            </template>
            <template v-else>
              <AppSelectSearch
                v-model="filterSectorId"
                :items="
                  sectors.map((sector) => ({
                    value: sector.id,
                    title: sector.name,
                    color: sector.color,
                  }))
                "
                :placeholder="$t('select_sector_filter')"
                clearable
                item-value="value"
                item-title="title"
              >
                <template #item-prepend="{ item }">
                  <VAvatar
                    v-if="item.color"
                    :color="item.color"
                    size="24"
                    class="me-2"
                  />
                </template>
                <template #prepend-inner="{ item }">
                  <VAvatar
                    v-if="item && !Array.isArray(item) && item.color"
                    :color="item.color"
                    size="20"
                    class="me-2"
                  />
                </template>
              </AppSelectSearch>
            </template>
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1"
              >{{ $t('filter_by_channel') }}:</VLabel
            >
            <template v-if="isLoadingWorkers">
              <VSkeletonLoader type="text" width="100%" height="40" />
            </template>
            <template v-else>
              <AppSelectSearch
                v-model="filterWorkerId"
                :items="
                  workers.map((worker) => ({
                    value: worker.id,
                    title: worker.name,
                  }))
                "
                :placeholder="$t('select_channel_filter')"
                clearable
                item-value="value"
                item-title="title"
              />
            </template>
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1"
              >{{ $t('filter_by_attendant') }}:</VLabel
            >
            <template v-if="isLoadingUsers">
              <VSkeletonLoader type="text" width="100%" height="40" />
            </template>
            <template v-else>
              <AppSelectSearch
                v-model="filterUserId"
                :items="
                  users.map((user) => ({
                    value: user.id,
                    title: user.name,
                  }))
                "
                :placeholder="$t('select_attendant_filter')"
                clearable
                item-value="value"
                item-title="title"
              />
            </template>
          </VCol>

          <VCol cols="12" class="mt-6">
            <VDivider />
          </VCol>

          <VCol cols="12">
            <VLabel class="text-body-2 mb-1"
              >{{ $t('filter_by_name') }}:</VLabel
            >
            <AppTextField
              v-model="filterName"
              :placeholder="$t('filter_by_name_placeholder')"
              clearable
            />
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1"
              >{{ $t('filter_by_phone') }}:</VLabel
            >
            <AppTextField
              v-model="filterPhone"
              :placeholder="$t('filter_by_phone_placeholder')"
              clearable
            />
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1"
              >{{ $t('filter_by_protocol') }}:</VLabel
            >
            <AppTextField
              v-model="filterProtocol"
              :placeholder="$t('filter_by_protocol_placeholder')"
              clearable
            />
          </VCol>

          <VCol cols="12" class="mt-6">
            <VDivider />
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1"
              >{{ $t('filter_date_start') }}:</VLabel
            >
            <AppDateTimePicker
              v-model="filterDateStart"
              :placeholder="$t('select_date')"
              clearable
            />
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1"
              >{{ $t('filter_date_end') }}:</VLabel
            >
            <AppDateTimePicker
              v-model="filterDateEnd"
              :placeholder="$t('select_date')"
              clearable
            />
          </VCol>
        </VRow>
      </VCardText>

      <VDivider />

      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn variant="tonal" color="secondary" @click="isVisible = false">
          {{ $t('cancel') }}
        </VBtn>
        <VBtn :loading="isSaving" @click="handleSave">
          {{ $t('filter') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>
