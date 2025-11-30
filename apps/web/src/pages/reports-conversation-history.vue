<script setup lang="ts">
import { ref, watch, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import { formatDate } from '@/@webcore/utils/formatters';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { DataTableHeader } from 'vuetify';
import { EReportConversationHistoryPermissions } from '@core/common/enums/EPermissions/reportConversationHistory';
import { useReportConversationHistoryStore } from '@/@webcore/stores/reportConversationHistory';
import { useSectorsStore } from '@/@webcore/stores/sector';
import { useUsersStore } from '@/@webcore/stores/user';
import { useChatStore } from '@/@webcore/stores/chat';
import { ReportConversationHistoryResult } from '@core/schema/reportConversationHistory/listReportConversationHistory/response.schema';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import axios from '@webcore/axios';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import {
  ListMessageResponse,
  ListMessageResult,
} from '@core/schema/chat/listMessageChats/response.schema';
import { ListMessageChatsQuery } from '@core/schema/chat/listMessageChats/request.schema';
import { EMessageType } from '@core/common/enums/EMessageType';
import { isTypeUser } from '@core/common/functions/isTypeUser';
import { EColor } from '@core/common/enums/EColor';
import { refDebounced } from '@vueuse/core';

type ProtocolWithType = {
  protocol: string;
  type: 'T' | 'U' | 'A';
};

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EReportConversationHistoryPermissions.report_conversation_history_group,
      EReportConversationHistoryPermissions.report_conversation_history_view,
    ],
  },
});

const { t } = useI18n();
const router = useRouter();
const reportConversationHistoryStore = useReportConversationHistoryStore();
const sectorsStore = useSectorsStore();
const usersStore = useUsersStore();
const chatStore = useChatStore();

useSnackbarCleanup(reportConversationHistoryStore);

const isConversationModalOpen = ref(false);
const selectedChatId = ref<string | null>(null);
const conversationMessages = ref<ListMessageResult[]>([]);
const loadingMessages = ref(false);
const isProtocolsDialogOpen = ref(false);
const selectedProtocols = ref<string[]>([]);
const selectedProtocolsWithType = ref<ProtocolWithType[]>([]);
const selectedClientForProtocols = ref<string>('');
const selectedChatInfo = ref<ReportConversationHistoryResult | null>(null);
const imageViewerOpen = ref(false);
const imageViewerSrc = ref<string>('');

const openImageViewer = (src: string) => {
  imageViewerSrc.value = src;
  imageViewerOpen.value = true;
};

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
]);

const searchByOptions = ref([
  { value: 'date', title: t('date') },
  { value: 'operator', title: t('operator') },
  { value: 'queue', title: t('queue') },
  { value: 'protocol', title: t('protocol') },
  { value: 'client', title: t('client') },
  { value: 'phone', title: t('phone') },
]);

const headers: DataTableHeader<ReportConversationHistoryResult>[] = [
  { title: t('date'), key: 'date', sortable: true },
  { title: t('protocol'), key: 'protocol', sortable: true },
  { title: t('client'), key: 'client', sortable: true },
  { title: t('phone'), key: 'phone', sortable: false },
  { title: t('operator'), key: 'operator', sortable: false },
  { title: t('queue'), key: 'queue', sortable: false },
  { title: t('channel'), key: 'channel', sortable: false },
  { title: t('view'), key: 'actions', sortable: false, width: '100px' },
];

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
});

const searchBy = ref<
  'date' | 'operator' | 'queue' | 'protocol' | 'client' | 'phone'
>('date');
const startDate = ref<string | null>(null);
const endDate = ref<string | null>(null);
const operatorId = ref<string | null>(null);
const queueId = ref<string | null>(null);
const protocol = ref<string | null>(null);
const clientName = ref<string | null>(null);
const phoneRaw = ref<string | null>(null);

const formatPhone = (value: string | null | undefined): string => {
  if (!value) return '';

  const numbers = value.replaceAll(/\D/g, '').slice(0, 13);

  if (numbers.startsWith('55') && numbers.length > 2) {
    const ddd = numbers.slice(2, 4);
    const rest = numbers.slice(4);

    if (numbers.length <= 4) {
      return `+55 (${ddd}`;
    }
    if (numbers.length <= 6) {
      return `+55 (${ddd}) ${rest}`;
    }
    if (numbers.length <= 10) {
      return `+55 (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    }
    return `+55 (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5, 9)}`;
  }

  if (numbers.length <= 2) {
    return numbers;
  }
  if (numbers.length <= 6) {
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  }
  if (numbers.length <= 10) {
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
  }
  return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
};

const phoneFormatted = computed({
  get: () => formatPhone(phoneRaw.value),
  set: (value: string) => {
    phoneRaw.value = value.replaceAll(/\D/g, '') || null;
  },
});

const phoneDebounced = refDebounced(phoneRaw, 500);

const sectors = ref<Array<{ id: string | null; text: string }>>([]);
const operators = ref<Array<{ id: string | null; text: string }>>([]);

onMounted(async () => {
  const [, allUsers] = await Promise.all([
    sectorsStore.listSectors({ per_page: 200, page: 1, sort_by: [] }),
    usersStore.listAllUsers(),
  ]);

  sectors.value = [
    { id: null, text: t('all') },
    ...sectorsStore.list.map((sector) => ({
      id: sector.sector_id,
      text: sector.name,
    })),
  ];

  operators.value = [
    { id: null, text: t('all') },
    ...(allUsers || [])
      .filter((user) => {
        const name = user?.first_name || user?.last_name;
        return user?.user_id && name;
      })
      .map((user) => {
        let fullName = '';
        if (user.first_name) {
          fullName = user.first_name;
          if (user.last_name) {
            fullName = `${fullName} ${user.last_name}`;
          }
        } else {
          fullName = user.last_name || '';
        }
        return {
          id: String(user.user_id),
          text: String(fullName),
        };
      }),
  ];

  await loadHistory();
});

const formatDateForApi = (
  date: string | null,
  isEndDate = false
): string | null => {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  if (isEndDate) {
    d.setHours(23, 59, 59, 999);
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return d.toISOString();
};

const query = computed(() => {
  const baseQuery: any = {
    current_page: options.value.page,
    per_page:
      options.value.itemsPerPage === -1 ? 100 : options.value.itemsPerPage,
    sort_by: options.value.sortBy,
    search_by: searchBy.value,
  };

  switch (searchBy.value) {
    case 'date':
      baseQuery.start_date = formatDateForApi(startDate.value, false);
      baseQuery.end_date = formatDateForApi(endDate.value, true);
      break;
    case 'operator':
      baseQuery.operator_id = operatorId.value;
      break;
    case 'queue':
      baseQuery.queue_id = queueId.value;
      break;
    case 'protocol':
      baseQuery.protocol = protocol.value;
      break;
    case 'client':
      baseQuery.client_name = clientName.value;
      break;
    case 'phone':
      baseQuery.phone = phoneDebounced.value;
      break;
  }

  return baseQuery;
});

const handleTableChange = (o: {
  page: number;
  itemsPerPage: number;
  sortBy: SortRequest[];
}) => {
  options.value.page = o.page;
  options.value.itemsPerPage = o.itemsPerPage;
  options.value.sortBy = o.sortBy;
};

const loadHistory = async () => {
  await reportConversationHistoryStore.listReportConversationHistory(
    query.value
  );
};

const openConversationModal = async (item: ReportConversationHistoryResult) => {
  selectedChatId.value = item.chat_id;
  selectedChatInfo.value = item;
  isConversationModalOpen.value = true;
  loadingMessages.value = true;
  conversationMessages.value = [];

  try {
    const query: ListMessageChatsQuery = {
      current_page: 1,
      per_page: 200,
    };

    const response = await axios.get<IApiResponse<ListMessageResponse>>(
      `/chat/${item.chat_id}`,
      {
        params: query,
      }
    );

    if (response?.data?.status && response.data?.data) {
      conversationMessages.value = [...response.data.data.results].reverse();
    } else {
      conversationMessages.value = [];
    }
  } catch (error: any) {
    conversationMessages.value = [];

    const errorMessage =
      error?.response?.data?.message ||
      error?.message ||
      t('report_conversation_history_list_error');

    reportConversationHistoryStore.showSnackbar(errorMessage, EColor.error);
  } finally {
    loadingMessages.value = false;
  }
};

const getMessageText = (message: ListMessageResult): string => {
  if (!message.content) return '';
  let text = message.content.message || '';

  const namePrefixRegex = /^\*[^*]+\*:\n\n/;
  text = text.replace(namePrefixRegex, '');

  return text;
};

const getSenderName = (message: ListMessageResult): string => {
  if (isTypeUser(message)) {
    return selectedChatInfo.value?.client || t('client');
  } else {
    return (
      message.user?.name || selectedChatInfo.value?.operator || t('operator')
    );
  }
};

const isOperatorMessage = (message: ListMessageResult): boolean => {
  return !isTypeUser(message);
};

const resolvePhoto = (message: ListMessageResult): string => {
  if (isTypeUser(message)) {
    if (message.content?.contact?.photo) {
      return message.content.contact.photo;
    }
    return '/images/svg/avatar-default.svg';
  }
  if (message.user?.photo) return message.user.photo;
  return '/images/svg/avatar-default.svg';
};

const isPhotoExist = (message: ListMessageResult): boolean => {
  const photo = resolvePhoto(message);
  return Boolean(photo && photo !== '/images/svg/avatar-default.svg');
};

const formatWhatsAppText = (text: string): string => {
  if (!text) return '';

  const escapeHtml = (str: string) => {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  };

  let formatted = escapeHtml(text);

  formatted = formatted.replaceAll(/`([^`]+?)`/g, '<code>$1</code>');
  formatted = formatted.replaceAll(/~([^~]+?)~/g, '<s>$1</s>');
  formatted = formatted.replaceAll(/(?<!_)_([^_\n]+?)_(?!_)/g, '<em>$1</em>');
  formatted = formatted.replaceAll(
    /(?<!\*)\*([^*\n]+?)\*(?!\*)/g,
    '<strong>$1</strong>'
  );

  return formatted;
};

const formatDateSeparator = (dateString: string): string => {
  if (!dateString) return '';

  const date = new Date(dateString);
  const now = new Date();

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const messageDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );

  if (messageDate.getTime() === today.getTime()) {
    return t('today');
  }

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (messageDate.getTime() === yesterday.getTime()) {
    return t('yesterday');
  }

  const diffMs = today.getTime() - messageDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 7 && diffDays > 0) {
    const weekdays = [
      t('sunday'),
      t('monday'),
      t('tuesday'),
      t('wednesday'),
      t('thursday'),
      t('friday'),
      t('saturday'),
    ];
    return weekdays[date.getDay()];
  }

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

const isSameDay = (date1: string, date2: string): boolean => {
  if (!date1 || !date2) return false;

  const d1 = new Date(date1);
  const d2 = new Date(date2);

  return (
    d1.getDate() === d2.getDate() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getFullYear() === d2.getFullYear()
  );
};

type MessageWithSeparator = {
  type: 'message' | 'separator';
  message?: ListMessageResult;
  separatorDate?: string;
  separatorLabel?: string;
};

const messagesWithSeparators = computed<MessageWithSeparator[]>(() => {
  const messages = conversationMessages.value;

  if (messages.length === 0) return [];

  const result: MessageWithSeparator[] = [];
  let lastDate: string | null = null;

  for (const message of messages) {
    const messageDate = message.date;

    if (!lastDate || !isSameDay(messageDate, lastDate)) {
      result.push({
        type: 'separator',
        separatorDate: messageDate,
        separatorLabel: formatDateSeparator(messageDate),
      });
      lastDate = messageDate;
    }

    result.push({
      type: 'message',
      message,
    });
  }

  return result;
});

watch(
  query,
  async () => {
    await loadHistory();
  },
  { deep: true }
);

watch(phoneDebounced, async () => {
  if (searchBy.value === 'phone') {
    await loadHistory();
  }
});

watch(searchBy, () => {
  startDate.value = null;
  endDate.value = null;
  operatorId.value = null;
  queueId.value = null;
  protocol.value = null;
  clientName.value = null;
  phoneRaw.value = null;
});

const getProtocolsList = (item: ReportConversationHistoryResult): string[] => {
  if (
    item.protocols &&
    Array.isArray(item.protocols) &&
    item.protocols.length > 0
  ) {
    return item.protocols;
  }
  if (item.protocol) {
    return [item.protocol];
  }
  return [];
};

const getProtocolsWithTypeList = (
  item: ReportConversationHistoryResult
): ProtocolWithType[] => {
  if (
    item.protocolsWithType &&
    Array.isArray(item.protocolsWithType) &&
    item.protocolsWithType.length > 0
  ) {
    return item.protocolsWithType;
  }
  if (item.protocol) {
    return [{ protocol: item.protocol, type: 'A' }];
  }
  return [];
};

const openProtocolsDialog = (
  item: ReportConversationHistoryResult,
  clientName: string
) => {
  const protocolsWithType = getProtocolsWithTypeList(item);
  if (protocolsWithType.length === 0) return;

  selectedProtocolsWithType.value = protocolsWithType;
  selectedProtocols.value = protocolsWithType.map((p) => p.protocol);
  selectedClientForProtocols.value = clientName;
  isProtocolsDialogOpen.value = true;
};

const getProtocolTypeLabel = (type: 'T' | 'U' | 'A'): string => {
  return type;
};

const getProtocolTypeColor = (type: 'T' | 'U' | 'A'): string => {
  switch (type) {
    case 'T':
      return 'info';
    case 'U':
      return 'warning';
    case 'A':
      return 'success';
    default:
      return 'primary';
  }
};

const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    reportConversationHistoryStore.showSnackbar(
      t('protocol_copied'),
      EColor.success
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : t('error_copying_protocol');
    reportConversationHistoryStore.showSnackbar(errorMessage, EColor.error);
  }
};

const openDocument = (url: string | null | undefined) => {
  if (!url) return;
  window.open(url, '_blank');
};
</script>

<template>
  <div>
    <VCard :title="$t('conversation_history_report')" no-padding>
      <VCardText>
        <!-- Filtros de Pesquisa -->
        <div class="d-flex flex-column gap-4 mb-6">
          <div>
            <VLabel class="mb-2">{{ $t('search_history_by') }}</VLabel>
            <VRadioGroup v-model="searchBy" inline>
              <VRadio
                v-for="option in searchByOptions"
                :key="option.value"
                :label="option.title"
                :value="option.value"
              />
            </VRadioGroup>
          </div>

          <!-- Filtro por Data -->
          <div v-if="searchBy === 'date'" class="d-flex gap-4 align-center">
            <div class="invoice-list-filter">
              <VLabel>{{ $t('start_date') }}:</VLabel>
              <AppDateTimePicker
                v-model="startDate"
                :placeholder="$t('select_date')"
              />
            </div>
            <div class="invoice-list-filter">
              <VLabel>{{ $t('end_date') }}:</VLabel>
              <AppDateTimePicker
                v-model="endDate"
                :placeholder="$t('select_date')"
              />
            </div>
          </div>

          <!-- Filtro por Operador -->
          <div v-if="searchBy === 'operator'" class="invoice-list-filter">
            <VLabel>{{ $t('search_by_operator') }}:</VLabel>
            <AppAutocomplete
              item-title="text"
              item-value="id"
              :items="operators"
              v-model="operatorId"
              :placeholder="$t('search_by_operator')"
            />
          </div>

          <!-- Filtro por Fila -->
          <div v-if="searchBy === 'queue'" class="invoice-list-filter">
            <VLabel>{{ $t('search_by_queue') }}:</VLabel>
            <AppAutocomplete
              item-title="text"
              item-value="id"
              :items="sectors"
              v-model="queueId"
              :placeholder="$t('search_by_queue')"
            />
          </div>

          <!-- Filtro por Protocolo -->
          <div v-if="searchBy === 'protocol'" class="invoice-list-filter">
            <VLabel>{{ $t('search_by_protocol') }}:</VLabel>
            <AppTextField
              v-model="protocol"
              :placeholder="$t('search_by_protocol')"
            />
          </div>

          <!-- Filtro por Cliente -->
          <div v-if="searchBy === 'client'" class="invoice-list-filter">
            <VLabel>{{ $t('search_by_client') }}:</VLabel>
            <AppTextField
              v-model="clientName"
              :placeholder="$t('search_by_client')"
            />
          </div>

          <!-- Filtro por Telefone -->
          <div v-if="searchBy === 'phone'" class="invoice-list-filter">
            <VLabel>{{ $t('search_by_phone') }}:</VLabel>
            <AppTextField
              v-model="phoneFormatted"
              :placeholder="$t('search_by_phone')"
            />
          </div>
        </div>

        <!-- Controles da Tabela -->
        <div class="d-flex justify-space-between flex-wrap gap-4 mb-4">
          <div class="d-flex gap-4 align-center">
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
          </div>
        </div>
      </VCardText>

      <VDataTableServer
        v-model:page="options.page"
        v-model:items-per-page="options.itemsPerPage"
        :headers="headers"
        :items="reportConversationHistoryStore.list"
        :items-length="reportConversationHistoryStore.pagings.total"
        :loading="reportConversationHistoryStore.loading"
        :sort-by="options.sortBy"
        @update:options="handleTableChange"
        :loading-text="$t('loading_text')"
      >
        <template #item.date="{ item }">
          <span>{{ formatDateTime(item.date) }}</span>
        </template>

        <template #item.protocol="{ item }">
          <div class="d-flex align-center justify-space-between w-100">
            <span>{{ item.protocol || '-' }}</span>
            <VBtn
              v-if="getProtocolsList(item).length > 0"
              icon
              size="x-small"
              variant="text"
              color="primary"
              density="compact"
              class="flex-shrink-0"
              @click="openProtocolsDialog(item, item.client)"
            >
              <VTooltip location="top">
                <template #activator="{ props }">
                  <VIcon v-bind="props" size="16">tabler-list</VIcon>
                </template>
                <span>{{ t('view_all_protocols') }}</span>
              </VTooltip>
            </VBtn>
          </div>
        </template>

        <template #item.client="{ item }">
          <span>{{ item.client || '-' }}</span>
        </template>

        <template #item.phone="{ item }">
          <span>{{ item.phone ? formatPhoneBR(item.phone) : '-' }}</span>
        </template>

        <template #item.operator="{ item }">
          <span>{{ item.operator || '-' }}</span>
        </template>

        <template #item.queue="{ item }">
          <span>{{ item.queue || '-' }}</span>
        </template>

        <template #item.channel="{ item }">
          <span>{{ item.channel || '-' }}</span>
        </template>

        <template #item.actions="{ item }">
          <div class="d-flex justify-center">
            <VBtn
              size="x-small"
              color="primary"
              variant="text"
              icon="tabler-eye"
              @click="openConversationModal(item)"
            >
              <VIcon size="18">tabler-eye</VIcon>
            </VBtn>
          </div>
        </template>

        <template #no-data>
          {{ $t('no_data_available') }}
        </template>

        <template #bottom>
          <TablePagination
            v-model:page="options.page"
            :items-per-page="options.itemsPerPage"
            :total-items="reportConversationHistoryStore.pagings.total"
          />
        </template>
      </VDataTableServer>
    </VCard>

    <!-- Modal de Visualização da Conversa -->
    <VDialog v-model="isConversationModalOpen" max-width="900" scrollable>
      <VCard>
        <VCardTitle class="d-flex justify-space-between align-center">
          <div>
            <div class="text-h6">{{ t('conversation_history') }}</div>
            <div
              v-if="selectedChatInfo"
              class="text-caption text-medium-emphasis"
            >
              {{ selectedChatInfo.client }} -
              {{ formatPhoneBR(selectedChatInfo.phone) }}
            </div>
          </div>
          <VBtn icon variant="text" @click="isConversationModalOpen = false">
            <VIcon>tabler-x</VIcon>
          </VBtn>
        </VCardTitle>

        <VDivider />

        <VCardText
          class="pa-0"
          style="
            height: 600px;
            overflow-y: auto;
            background-color: rgb(var(--v-theme-background));
          "
        >
          <div class="chat-log pa-4" style="min-height: 100%">
            <div
              v-if="loadingMessages"
              class="d-flex justify-center align-center"
              style="height: 100%"
            >
              <VProgressCircular indeterminate color="primary" />
            </div>

            <div
              v-else-if="conversationMessages.length === 0"
              class="d-flex justify-center align-center"
              style="height: 100%"
            >
              <div class="text-body-1 text-medium-emphasis">
                {{ t('no_messages_found') }}
              </div>
            </div>

            <div v-else class="d-flex flex-column">
              <template
                v-for="(item, index) in messagesWithSeparators"
                :key="
                  item.type === 'separator'
                    ? `separator-${item.separatorDate}`
                    : `msg-${item.message?.message_id}`
                "
              >
                <div
                  v-if="item.type === 'separator'"
                  class="d-flex justify-center align-center my-4 date-separator-wrapper"
                  style="width: 100%; gap: 8px"
                >
                  <div
                    class="date-separator-line"
                    style="
                      flex: 0.25;
                      height: 1px;
                      background-color: rgba(var(--v-theme-on-surface), 0.12);
                    "
                  ></div>
                  <div
                    class="date-separator"
                    style="
                      font-size: 0.75rem;
                      font-weight: 500;
                      background-color: rgba(var(--v-theme-on-surface), 0.12);
                      color: rgba(var(--v-theme-on-surface), 0.65);
                      padding: 4px 12px;
                      border-radius: 7.5px;
                      display: inline-block;
                      min-width: fit-content;
                      white-space: nowrap;
                    "
                  >
                    {{ item.separatorLabel }}
                  </div>
                  <div
                    class="date-separator-line"
                    style="
                      flex: 0.25;
                      height: 1px;
                      background-color: rgba(var(--v-theme-on-surface), 0.12);
                    "
                  ></div>
                </div>
                <div
                  v-else-if="item.type === 'message' && item.message"
                  class="chat-group d-flex align-start position-relative"
                  :class="[
                    {
                      'flex-row-reverse':
                        !isTypeUser(item.message) &&
                        item.message.content?.type !== EMessageType.system,
                      'justify-center':
                        item.message.content?.type === EMessageType.system,
                      'mb-6':
                        index < messagesWithSeparators.length - 1 &&
                        messagesWithSeparators[index + 1]?.type === 'message',
                    },
                  ]"
                >
                  <div
                    v-if="item.message.content?.type !== EMessageType.system"
                    class="chat-avatar"
                    :class="!isTypeUser(item.message) ? 'ms-4' : 'me-4'"
                  >
                    <VTooltip
                      v-if="
                        !isTypeUser(item.message) && item.message.user?.name
                      "
                      location="top"
                      :text="item.message.user.name"
                    >
                      <template #activator="{ props }">
                        <VAvatar
                          v-bind="props"
                          size="32"
                          :variant="
                            !isPhotoExist(item.message) ? 'tonal' : undefined
                          "
                        >
                          <VImg :src="resolvePhoto(item.message)" />
                        </VAvatar>
                      </template>
                    </VTooltip>
                    <VTooltip
                      v-else-if="
                        isTypeUser(item.message) && getSenderName(item.message)
                      "
                      location="top"
                      :text="getSenderName(item.message)"
                    >
                      <template #activator="{ props }">
                        <VAvatar
                          v-bind="props"
                          size="32"
                          :variant="
                            !isPhotoExist(item.message) ? 'tonal' : undefined
                          "
                        >
                          <VImg :src="resolvePhoto(item.message)" />
                        </VAvatar>
                      </template>
                    </VTooltip>
                    <VAvatar
                      v-else
                      size="32"
                      :variant="
                        !isPhotoExist(item.message) ? 'tonal' : undefined
                      "
                    >
                      <VImg :src="resolvePhoto(item.message)" />
                    </VAvatar>
                  </div>

                  <div
                    class="chat-body d-inline-flex flex-column position-relative"
                    :class="
                      item.message.content?.type === EMessageType.system
                        ? 'align-center'
                        : !isTypeUser(item.message)
                          ? 'align-end'
                          : 'align-start'
                    "
                  >
                    <div
                      class="chat-content-wrapper"
                      :class="
                        !isTypeUser(item.message)
                          ? 'wrapper-operator'
                          : 'wrapper-client'
                      "
                    >
                      <div
                        class="chat-content py-2 px-2 elevation-2"
                        :class="
                          item.message.content?.type === EMessageType.system
                            ? 'chat-center'
                            : isTypeUser(item.message)
                              ? 'chat-left'
                              : 'chat-right'
                        "
                        :style="{
                          backgroundColor:
                            item.message.content?.type ===
                            EMessageType.annotation
                              ? 'rgb(255, 243, 205)'
                              : item.message.content?.type ===
                                  EMessageType.system
                                ? 'rgb(227, 242, 253)'
                                : isTypeUser(item.message)
                                  ? 'rgb(var(--v-theme-surface))'
                                  : 'rgb(217, 253, 211)',
                        }"
                      >
                        <!-- Nome do remetente -->
                        <div
                          v-if="
                            item.message.content?.type !== EMessageType.system
                          "
                          class="text-caption font-weight-medium mb-2"
                          :style="{
                            opacity: 0.8,
                            color: isTypeUser(item.message)
                              ? 'rgb(var(--v-theme-on-surface))'
                              : 'rgb(var(--v-theme-title))',
                          }"
                        >
                          {{ getSenderName(item.message) }}
                        </div>

                        <!-- Imagem -->
                        <div
                          v-if="
                            item.message.content?.type === EMessageType.image &&
                            item.message.content?.image?.url
                          "
                          :class="[
                            'image-bubble',
                            !isTypeUser(item.message)
                              ? 'image-bubble--right'
                              : 'image-bubble--left',
                          ]"
                          class="mb-3"
                          @click="
                            () =>
                              openImageViewer(
                                item.message!.content!.image!.url!
                              )
                          "
                        >
                          <VImg
                            :src="item.message.content.image.url"
                            :aspect-ratio="
                              item.message.content.image.width &&
                              item.message.content.image.height
                                ? item.message.content.image.width /
                                  item.message.content.image.height
                                : undefined
                            "
                            class="image-thumb"
                            width="120"
                            cover
                          />
                          <p
                            v-if="item.message.content.image.caption"
                            class="image-caption mt-3"
                            :style="{
                              color: isTypeUser(item.message)
                                ? 'rgb(var(--v-theme-on-surface))'
                                : 'rgb(var(--v-theme-title))',
                            }"
                          >
                            <span
                              v-html="
                                formatWhatsAppText(
                                  item.message.content.image.caption
                                )
                              "
                            ></span>
                          </p>
                        </div>

                        <!-- Vídeo -->
                        <div
                          v-else-if="
                            item.message.content?.type === EMessageType.video &&
                            item.message.content?.video?.url
                          "
                          class="mb-3"
                        >
                          <div class="d-flex align-center gap-2 mb-3">
                            <VIcon>tabler-video</VIcon>
                            <a
                              :href="item.message.content.video.url"
                              target="_blank"
                              rel="noopener noreferrer"
                              class="text-body-2 text-primary text-decoration-none"
                            >
                              {{ t('video') }} - {{ t('click_to_view') }}
                            </a>
                          </div>
                          <div
                            v-if="item.message.content.video.caption"
                            class="text-body-2"
                            v-html="
                              formatWhatsAppText(
                                item.message.content.video.caption
                              )
                            "
                          ></div>
                        </div>

                        <!-- Áudio -->
                        <div
                          v-else-if="
                            item.message.content?.type === EMessageType.audio &&
                            item.message.content?.audio?.url
                          "
                          class="mb-3"
                        >
                          <div class="d-flex align-center gap-2">
                            <VIcon>tabler-music</VIcon>
                            <a
                              :href="item.message.content.audio.url"
                              target="_blank"
                              rel="noopener noreferrer"
                              class="text-body-2 text-primary text-decoration-none"
                            >
                              {{ t('audio') }} - {{ t('click_to_listen') }}
                            </a>
                          </div>
                        </div>

                        <!-- Sticker -->
                        <div
                          v-else-if="
                            item.message.content?.type ===
                              EMessageType.sticker &&
                            item.message.content?.sticker?.url
                          "
                          class="mb-3"
                        >
                          <img
                            :src="item.message.content.sticker.url"
                            alt="Sticker"
                            style="
                              max-width: 100px;
                              max-height: 100px;
                              object-fit: contain;
                            "
                          />
                        </div>

                        <!-- Documento -->
                        <div
                          v-else-if="
                            item.message.content?.type ===
                              EMessageType.document &&
                            item.message.content?.document?.url
                          "
                          class="mb-3 d-flex align-center gap-2"
                        >
                          <VIcon>tabler-file</VIcon>
                          <div class="flex-grow-1">
                            <div class="text-body-2 font-weight-medium">
                              {{
                                item.message.content.document.name ||
                                t('document')
                              }}
                            </div>
                            <div class="text-caption text-medium-emphasis">
                              {{
                                item.message.content.document.size
                                  ? `${(item.message.content.document.size / 1024).toFixed(2)} KB`
                                  : ''
                              }}
                            </div>
                          </div>
                          <VBtn
                            icon
                            size="small"
                            variant="text"
                            @click="
                              openDocument(item.message?.content?.document?.url)
                            "
                          >
                            <VIcon>tabler-download</VIcon>
                          </VBtn>
                        </div>

                        <!-- Localização -->
                        <div
                          v-else-if="item.message.content?.location"
                          class="mb-3"
                        >
                          <div class="text-body-2 font-weight-medium">
                            📍
                            {{
                              item.message.content.location.name ||
                              t('location')
                            }}
                          </div>
                          <div
                            v-if="item.message.content.location.address"
                            class="text-caption text-medium-emphasis"
                          >
                            {{ item.message.content.location.address }}
                          </div>
                        </div>

                        <!-- Contato -->
                        <div
                          v-else-if="item.message.content?.contact"
                          class="mb-3"
                        >
                          <div class="text-body-2">
                            👤 {{ item.message.content.contact.name }}
                            {{ item.message.content.contact.last_name || '' }}
                          </div>
                          <div
                            v-if="item.message.content.contact.phone"
                            class="text-caption text-medium-emphasis"
                          >
                            {{ item.message.content.contact.phone }}
                          </div>
                        </div>

                        <!-- Texto -->
                        <div
                          v-if="
                            item.message.content?.message &&
                            item.message.content?.type !== EMessageType.image &&
                            item.message.content?.type !== EMessageType.video &&
                            item.message.content?.type !== EMessageType.audio &&
                            item.message.content?.type !==
                              EMessageType.sticker &&
                            item.message.content?.type !==
                              EMessageType.document &&
                            item.message.content?.type !==
                              EMessageType.contact_card
                          "
                          class="d-flex align-end gap-2"
                        >
                          <p
                            class="text-base message-text mb-0 flex-grow-1"
                            :style="{
                              color: isTypeUser(item.message)
                                ? 'rgb(var(--v-theme-on-surface))'
                                : 'rgb(var(--v-theme-title))',
                            }"
                            v-html="
                              formatWhatsAppText(getMessageText(item.message))
                            "
                          ></p>
                          <span
                            class="message-time text-caption"
                            :style="{
                              color: isTypeUser(item.message)
                                ? 'rgba(var(--v-theme-on-surface), 0.6)'
                                : 'rgba(17, 27, 33, 0.6)',
                              flexShrink: 0,
                              whiteSpace: 'nowrap',
                            }"
                          >
                            {{
                              formatDate(item.message.date, {
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false,
                              })
                            }}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </VCardText>
      </VCard>
    </VDialog>

    <!-- Visualizador de Imagens -->
    <VDialog v-model="imageViewerOpen" max-width="900" scrollable>
      <VCard>
        <VCardTitle class="d-flex justify-space-between align-center">
          <span>{{ t('image') }}</span>
          <VBtn icon variant="text" @click="imageViewerOpen = false">
            <VIcon>tabler-x</VIcon>
          </VBtn>
        </VCardTitle>
        <VDivider />
        <VCardText class="pa-4 d-flex justify-center">
          <VImg
            v-if="imageViewerSrc"
            :src="imageViewerSrc"
            max-width="800"
            max-height="600"
            contain
          />
        </VCardText>
      </VCard>
    </VDialog>

    <!-- Dialog de Protocolos -->
    <VDialog v-model="isProtocolsDialogOpen" max-width="500">
      <VCard>
        <VCardTitle class="d-flex justify-space-between align-center">
          <div>
            <div class="text-h6">{{ t('protocols') }}</div>
            <div
              v-if="selectedClientForProtocols"
              class="text-caption text-medium-emphasis"
            >
              {{ selectedClientForProtocols }}
            </div>
          </div>
          <IconBtn @click="isProtocolsDialogOpen = false">
            <VIcon>tabler-x</VIcon>
          </IconBtn>
        </VCardTitle>
        <VDivider />
        <VCardText>
          <VList>
            <VListItem
              v-for="(item, index) in selectedProtocolsWithType"
              :key="index"
              :value="item.protocol"
              class="px-0"
            >
              <template #prepend>
                <VIcon color="primary" class="me-2">tabler-file-text</VIcon>
              </template>
              <VListItemTitle class="flex-grow-1">
                <div class="d-flex align-center justify-space-between w-100">
                  <div class="d-flex align-center gap-2 flex-grow-1">
                    <VChip
                      size="x-small"
                      :color="getProtocolTypeColor(item.type)"
                      variant="tonal"
                      class="font-weight-medium"
                    >
                      {{ item.type }}
                    </VChip>
                    <span class="font-weight-medium">{{ item.protocol }}</span>
                  </div>
                  <VBtn
                    icon
                    size="x-small"
                    variant="text"
                    @click="copyToClipboard(item.protocol)"
                    class="flex-shrink-0"
                  >
                    <VTooltip location="top">
                      <template #activator="{ props }">
                        <VIcon v-bind="props" size="16">tabler-copy</VIcon>
                      </template>
                      <span>{{ t('copy') }}</span>
                    </VTooltip>
                  </VBtn>
                </div>
              </VListItemTitle>
            </VListItem>
          </VList>
        </VCardText>
        <VDivider />
        <VCardText class="pt-2">
          <div
            class="text-caption text-medium-emphasis d-flex flex-column gap-1"
          >
            <div class="d-flex align-center gap-2">
              <VChip
                size="x-small"
                color="info"
                variant="tonal"
                class="font-weight-medium"
              >
                T
              </VChip>
              <span> - {{ t('protocol_type_transfer') }}</span>
            </div>
            <div class="d-flex align-center gap-2">
              <VChip
                size="x-small"
                color="warning"
                variant="tonal"
                class="font-weight-medium"
              >
                U
              </VChip>
              <span> - {{ t('protocol_type_ura') }}</span>
            </div>
            <div class="d-flex align-center gap-2">
              <VChip
                size="x-small"
                color="success"
                variant="tonal"
                class="font-weight-medium"
              >
                A
              </VChip>
              <span> - {{ t('protocol_type_attendance') }}</span>
            </div>
          </div>
        </VCardText>
        <VDivider />
        <VCardActions class="pa-4">
          <VSpacer />
          <VBtn
            color="primary"
            variant="elevated"
            @click="isProtocolsDialogOpen = false"
          >
            {{ t('close') }}
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>
  </div>
</template>

<style lang="scss">
.invoice-list-filter {
  inline-size: 20rem;
}

.chat-log {
  .chat-group {
    overflow: visible !important;
    margin-bottom: 24px !important;
  }

  .chat-avatar {
    flex-shrink: 0;
    margin-right: 12px !important;
    margin-left: 12px !important;
  }

  .chat-body {
    max-inline-size: calc(100% - 6.75rem);
    overflow: visible !important;

    .chat-content-wrapper {
      position: relative;
      display: inline-flex;
      overflow: visible !important;
      max-width: 100%;

      &.wrapper-operator {
        margin-left: auto;
      }

      &.wrapper-client {
        margin-right: auto;
      }
    }

    .chat-content {
      position: relative;
      border-radius: 6px;
      word-wrap: break-word;
      overflow-wrap: break-word;
      padding: 8px 12px !important;

      &.chat-left {
        border-start-end-radius: 6px;
      }

      &.chat-right {
        border-start-start-radius: 6px;
      }

      &.chat-center {
        border-radius: 6px;
        margin: 0 auto;
      }

      .message-meta {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 6px;
        display: flex;
        align-items: flex-end;
        gap: 4px;
        justify-content: flex-end;
        padding-inline: 16px 12px;
        font-size: 0.75rem;
        pointer-events: none;

        .message-meta-content {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 4px;
        }

        .message-meta-row {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .message-time {
          line-height: 1;
        }
      }
    }
  }
}
</style>
