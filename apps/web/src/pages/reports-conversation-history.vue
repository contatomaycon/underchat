<script setup lang="ts">
import { ref, watch, computed, onMounted, nextTick } from 'vue';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { DataTableHeader } from 'vuetify';
import { EReportConversationHistoryPermissions } from '@core/common/enums/EPermissions/reportConversationHistory';
import { useReportConversationHistoryStore } from '@/@webcore/stores/reportConversationHistory';
import { ReportConversationHistoryResult } from '@core/schema/reportConversationHistory/listReportConversationHistory/response.schema';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import axios from '@webcore/axios';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { ListMessageResult } from '@core/schema/chat/listMessageChats/response.schema';
import { ListReportConversationHistoryMessagesResponse } from '@core/schema/reportConversationHistory/listReportConversationHistoryMessages/response.schema';
import { EColor } from '@core/common/enums/EColor';
import { refDebounced } from '@vueuse/core';
import ChatLogViewer from '@/components/chat/ChatLogViewer.vue';
import ChatMediaViewer from '@/components/chat/ChatMediaViewer.vue';
import { MglMap, MglMarker } from 'vue-maplibre-gl';

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
const reportConversationHistoryStore = useReportConversationHistoryStore();

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
const imageViewerCaption = ref<string>('');
const imageViewerKind = ref<'image' | 'video'>('image');
const locationModalOpen = ref(false);
const locationData = ref<{
  latitude: number;
  longitude: number;
  name?: string | null;
  address?: string | null;
} | null>(null);

const handleOpenImage = (src: string, caption?: string) => {
  imageViewerSrc.value = src;
  imageViewerCaption.value = caption || '';
  imageViewerKind.value = 'image';
  imageViewerOpen.value = true;
};

const handleOpenVideo = (src: string, caption?: string) => {
  imageViewerSrc.value = src;
  imageViewerCaption.value = caption || '';
  imageViewerKind.value = 'video';
  imageViewerOpen.value = true;
};

const handleOpenLocation = (data: {
  latitude: number;
  longitude: number;
  name?: string | null;
  address?: string | null;
}) => {
  locationData.value = data;
  locationModalOpen.value = true;
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
  try {
    const [sectorsResponse, usersResponse] = await Promise.all([
      axios.get<IApiResponse<{ sectors: any[] }>>(
        '/report-conversation-history/sectors'
      ),
      axios.get<IApiResponse<{ users: any[] }>>(
        '/report-conversation-history/users'
      ),
    ]);

    sectors.value = [
      { id: null, text: t('all') },
      ...(sectorsResponse?.data?.data?.sectors || []).map((sector: any) => ({
        id: sector.sector_id,
        text: sector.name,
      })),
    ];

    operators.value = [
      { id: null, text: t('all') },
      ...(usersResponse?.data?.data?.users || [])
        .filter((user: any) => {
          const name = user?.first_name || user?.last_name;
          return user?.user_id && name;
        })
        .map((user: any) => {
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
  } catch (error: any) {
    const errorMessage =
      error?.response?.data?.message ||
      error?.message ||
      t('report_conversation_history_list_error');

    reportConversationHistoryStore.showSnackbar(errorMessage, EColor.error);
  }
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

const conversationModalRef = ref<HTMLElement | null>(null);
const conversationScrollRef = ref<HTMLElement | null>(null);

const openConversationModal = async (item: ReportConversationHistoryResult) => {
  selectedChatId.value = item.chat_id;
  selectedChatInfo.value = item;
  loadingMessages.value = true;
  conversationMessages.value = [];
  isConversationModalOpen.value = true;

  try {
    const response = await axios.get<
      IApiResponse<ListReportConversationHistoryMessagesResponse>
    >(`/report-conversation-history/${item.chat_id}/messages`);

    if (response?.data?.status && response.data?.data) {
      conversationMessages.value = response.data.data.messages;
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
    await nextTick();
    setTimeout(() => {
      scrollToBottom();
    }, 600);
  }
};

const scrollToBottom = (retries = 5) => {
  requestAnimationFrame(() => {
    let scrollContainer: HTMLElement | null = null;

    if (conversationScrollRef.value) {
      const element = conversationScrollRef.value as HTMLElement;
      if (element && element.parentElement) {
        scrollContainer = element.parentElement;
      }
    }

    if (!scrollContainer && conversationModalRef.value) {
      const modalElement =
        conversationModalRef.value instanceof HTMLElement
          ? conversationModalRef.value
          : (conversationModalRef.value as any)?.$el;

      if (modalElement) {
        scrollContainer = modalElement.querySelector(
          '.v-card-text'
        ) as HTMLElement;
      }
    }

    if (scrollContainer) {
      const maxScroll =
        scrollContainer.scrollHeight - scrollContainer.clientHeight;
      scrollContainer.scrollTop = maxScroll;

      if (retries > 0 && scrollContainer.scrollTop < maxScroll - 10) {
        setTimeout(() => {
          scrollToBottom(retries - 1);
        }, 300);
      }
    } else if (retries > 0) {
      setTimeout(() => {
        scrollToBottom(retries - 1);
      }, 300);
    }
  });
};

const handleModalOpened = async () => {
  await nextTick();
  setTimeout(() => {
    scrollToBottom();
  }, 800);
};

watch(
  [conversationMessages, loadingMessages],
  async () => {
    if (!loadingMessages.value && conversationMessages.value.length > 0) {
      await nextTick();
      setTimeout(() => {
        scrollToBottom();
      }, 500);
    }
  },
  { deep: true }
);

watch(isConversationModalOpen, async (isOpen) => {
  if (isOpen) {
    await nextTick();
    setTimeout(() => {
      scrollToBottom();
    }, 500);
  }
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
            <VLabel class="text-body-2 mb-1"
              >{{ $t('search_by_operator') }}:</VLabel
            >
            <AppSelectSearch
              v-model="operatorId"
              :items="operators as any"
              :placeholder="$t('search_by_operator')"
              :clearable="true"
              item-value="id"
              item-title="text"
            />
          </div>

          <!-- Filtro por Fila -->
          <div v-if="searchBy === 'queue'" class="invoice-list-filter">
            <VLabel class="text-body-2 mb-1"
              >{{ $t('search_by_queue') }}:</VLabel
            >
            <AppSelectSearch
              v-model="queueId"
              :items="sectors as any"
              :placeholder="$t('search_by_queue')"
              :clearable="true"
              item-value="id"
              item-title="text"
            />
          </div>

          <!-- Filtro por Protocolo -->
          <div v-if="searchBy === 'protocol'" class="invoice-list-filter">
            <VLabel class="text-body-2 mb-1"
              >{{ $t('search_by_protocol') }}:</VLabel
            >
            <AppTextField
              v-model="protocol"
              :placeholder="$t('search_by_protocol')"
            />
          </div>

          <!-- Filtro por Cliente -->
          <div v-if="searchBy === 'client'" class="invoice-list-filter">
            <VLabel class="text-body-2 mb-1"
              >{{ $t('search_by_client') }}:</VLabel
            >
            <AppTextField
              v-model="clientName"
              :placeholder="$t('search_by_client')"
            />
          </div>

          <!-- Filtro por Telefone -->
          <div v-if="searchBy === 'phone'" class="invoice-list-filter">
            <VLabel class="text-body-2 mb-1"
              >{{ $t('search_by_phone') }}:</VLabel
            >
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

        <VDivider class="my-4" />

        <div>
          <VDataTableServer
            class="data-table"
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
        </div>
      </VCardText>
    </VCard>

    <!-- Modal de Visualização da Conversa -->
    <VDialog
      v-model="isConversationModalOpen"
      max-width="900"
      scrollable
      @opened="handleModalOpened"
    >
      <VCard ref="conversationModalRef">
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
          class="pa-0 position-relative"
          style="
            height: 600px;
            overflow-y: auto;
            background-color: rgb(var(--v-theme-background));
          "
        >
          <div
            ref="conversationScrollRef"
            class="pa-4"
            style="min-height: 100%"
          >
            <ChatLogViewer
              :messages="conversationMessages"
              :client-name="selectedChatInfo?.client || ''"
              :operator-name="selectedChatInfo?.operator || ''"
              :client-photo="selectedChatInfo?.photo || null"
              :loading="loadingMessages"
              @open-image="handleOpenImage"
              @open-video="handleOpenVideo"
              @open-location="handleOpenLocation"
            />
          </div>
        </VCardText>
      </VCard>
    </VDialog>

    <ChatMediaViewer
      v-model="imageViewerOpen"
      :src="imageViewerSrc"
      :caption="imageViewerCaption"
      :kind="imageViewerKind"
    />

    <VDialog v-model="locationModalOpen" max-width="600" :scrollable="false">
      <VCard v-if="locationData">
        <VCardTitle class="d-flex align-center justify-space-between">
          <span>{{ t('location') }}</span>
          <VBtn
            icon
            variant="text"
            size="small"
            @click="locationModalOpen = false"
          >
            <VIcon size="20">tabler-x</VIcon>
          </VBtn>
        </VCardTitle>
        <VCardText>
          <div class="location-map-wrapper">
            <MglMap
              :map-style="{
                version: 8,
                sources: {
                  'osm-tiles': {
                    type: 'raster',
                    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                    tileSize: 256,
                    attribution: '&copy; OpenStreetMap contributors',
                  },
                },
                layers: [
                  {
                    id: 'osm-tiles-layer',
                    type: 'raster',
                    source: 'osm-tiles',
                    minzoom: 0,
                    maxzoom: 22,
                  },
                ],
              }"
              :center="
                locationData
                  ? [locationData.longitude, locationData.latitude]
                  : [0, 0]
              "
              :zoom="15"
              :interactive="false"
              :attribution-control="false"
              :navigation-control="false"
              style="width: 100%; height: 400px"
            >
              <MglMarker
                v-if="locationData"
                :coordinates="[locationData.longitude, locationData.latitude]"
                color="#ef4444"
              />
            </MglMap>
          </div>
          <div v-if="locationData.name" class="mt-4">
            <div class="text-body-1 font-weight-medium mb-1">
              {{ locationData.name }}
            </div>
          </div>
          <div v-if="locationData.address" class="mt-2">
            <div class="text-body-2 text-medium-emphasis">
              {{ locationData.address }}
            </div>
          </div>
        </VCardText>
        <VDivider />
        <VCardActions>
          <VSpacer />
          <VBtn
            variant="tonal"
            color="secondary"
            @click="locationModalOpen = false"
          >
            {{ t('close') }}
          </VBtn>
        </VCardActions>
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

<style lang="scss" scoped>
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
