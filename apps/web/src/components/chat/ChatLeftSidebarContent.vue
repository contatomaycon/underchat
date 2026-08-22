<script lang="ts" setup>
import {
  nextTick,
  computed,
  ref,
  shallowRef,
  watch,
  onMounted,
  onUnmounted,
} from 'vue';
import { useI18n } from 'vue-i18n';
import { PerfectScrollbar } from 'vue3-perfect-scrollbar';
import ChatQueue from './ChatQueue.vue';
import AppAddContactChat from '@/components/chat/AppAddContactChat.vue';
import AppEditContactChat from '@/components/chat/AppEditContactChat.vue';
import ChatAdvancedFiltersModal from '@/components/chat/ChatAdvancedFiltersModal.vue';
import ChatContactAdvancedFiltersModal from '@/components/chat/ChatContactAdvancedFiltersModal.vue';
import ChatNotificationSettingsDialog from '@/components/chat/ChatNotificationSettingsDialog.vue';
import ChatSortModal from '@/components/chat/ChatSortModal.vue';
import { useChatStore } from '@/@webcore/stores/chat';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { ListChatContactsResponse } from '@core/schema/chat/listContacts/response.schema';
import { MY_CHATS_STATUS } from '@core/schema/chat/listChats/request.schema';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ListChatsResult } from '@core/schema/chat/listChats/response.schema';
import type { IChat } from '@core/common/interfaces/IChat';
import { SearchChatsQuery } from '@core/schema/chat/searchChats/request.schema';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { ViewWorkerConfigForChatResponse } from '@core/schema/chat/viewWorkerConfigForChat/response.schema';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EChatbotPermissions } from '@core/common/enums/EPermissions/chatbot';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { can } from '@layouts/plugins/casl';
import { refDebounced } from '@vueuse/core';
import { EColor } from '@core/common/enums/EColor';
import VDialogHandler from '@/components/VDialogHandler.vue';
import { useTheme } from 'vuetify';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import ContactValidationBadge from '@/components/contact/ContactValidationBadge.vue';
import { CONTACT_VALIDATION_STATUSES } from '@core/common/types/ContactValidationStatus';
import {
  TransferWorker,
  TransferSector,
} from '@core/schema/chat/listTransferOptions/response.schema';
import {
  buildOfficialTemplatePreview,
  buildOfficialTemplateVariablePayload,
  containsUnderchatVariableTag,
  createManualOfficialTemplateVariable,
  createOfficialTemplateOptions,
  createOfficialTemplateVariableValueRecord,
  findOfficialTemplate,
  formatOfficialTemplateLanguage,
  formatOfficialTemplateVariableLabel,
  refreshOfficialTemplateVariableKey,
} from '@/utils/officialTemplate';
import type {
  OfficialTemplateVariable,
  OfficialTemplateVariableValue,
} from '@/utils/officialTemplate';
import type { TransferUserResponse } from '@core/schema/chat/listTransferUsers/response.schema';
import type { TransferSectorUserResponse } from '@core/schema/chat/listTransferSectorUsers/response.schema';
import type { BulkActionChatRequest } from '@core/schema/chat/bulkAction/request.schema';
import type { BulkActionChatResponse } from '@core/schema/chat/bulkAction/response.schema';
import type { ChatNotificationSettingsData } from '@core/schema/chat/notificationSettings/response.schema';
import type { ChatNotificationSettingsRequest } from '@core/schema/chat/notificationSettings/request.schema';
import OfficialOpeningWindowCard from '@/components/chat/official/OfficialOpeningWindowCard.vue';
import OfficialTemplateVariableField from '@/components/chat/official/OfficialTemplateVariableField.vue';
import { useOfficialOpeningContext } from '@/composables/useOfficialOpeningContext';
import { createUnderchatVariableCatalog } from '@/utils/underchatVariableCatalog';
import { isOfficialWindowRefreshConflict } from '@/utils/apiError';

type OpenChatOptions = {
  skipClearSummary?: boolean;
  fallbackChat?: ListChatsResult;
};

const emit = defineEmits<{
  (
    e: 'openChat',
    id: ListChatsResult['chat_id'],
    options?: OpenChatOptions
  ): void;
  (e: 'showUserProfile'): void;
  (e: 'close'): void;
  (e: 'update:search', value: string): void;
}>();

const props = defineProps<{
  isDrawerOpen: boolean;
  search: string;
}>();

const { locale, t } = useI18n();

const chatStore = useChatStore();
const channelsStore = useChannelsStore();
const { global } = useTheme();

const currentPageQueue = ref(1);
const perPageQueue = ref(25);
const currentPageInChat = ref(1);
const perPageInChat = ref(25);

const contactSearchQuery = ref('');
const debouncedContactSearch = refDebounced(contactSearchQuery, 500);
const currentPageContacts = ref(1);
const perPageContacts = ref(50);
const searchQuery = ref('');
const debouncedSearchQuery = refDebounced(searchQuery, 500);
const searchResults = ref<ListChatsResult[]>([]);
const isSearching = ref(false);
const searchPagings = ref({
  current_page: 1,
  total_pages: 1,
  per_page: 20,
  count: 0,
  total: 0,
});
const isAddContactModalOpen = ref(false);
const isLoadingMoreContacts = ref(false);
const accumulatedContacts = ref<ListChatContactsResponse[]>([]);
const contactsTotalPages = ref(1);
const isValidateContactDialogOpen = ref(false);
const contactToValidate = ref<string | null>(null);
const isEditContactModalOpen = ref(false);
const editContactId = ref<string | null>(null);
const isNotificationSettingsDialogOpen = ref(false);
const notificationSettings = ref<ChatNotificationSettingsData | null>(null);
const loadingNotificationSettings = ref(false);
const savingNotificationSettings = ref(false);
const hoveredContactId = ref<string | null>(null);
const editingContactId = ref<string | null>(null);
const validatingContactId = ref<string | null>(null);
const isSelectChannelSectorModalOpen = ref(false);
const selectedContactForChat = ref<ListChatContactsResponse | null>(null);
const selectedWorkerId = ref<string | null>(null);
const selectedSectorId = ref<string | null>(null);
const isOpeningConversation = shallowRef(false);
const isLoadingWorkerConfigForChat = shallowRef(false);
const availableWorkers = ref<TransferWorker[]>([]);
const availableSectors = ref<TransferSector[]>([]);
const workerConfigForChat = ref<ViewWorkerConfigForChatResponse | null>(null);
const isAdvancedFiltersModalOpen = ref(false);
const hasAppliedAdvancedFilters = ref(false);
const isContactAdvancedFiltersModalOpen = ref(false);

type BulkCategory = Extract<
  FilterType,
  'all' | 'in_chat' | 'queue' | 'my_chats' | 'chatbot' | 'scheduled'
>;

type TransferChannelOption = {
  value: string;
  title: string;
  name: string;
  number: string | null;
  isOfficial?: boolean;
};

const isBulkModeEnabled = ref(false);
const bulkSelectAllFiltered = ref(false);
const bulkSelectedChatIds = ref<Set<string>>(new Set());
const isBulkActionRunning = ref(false);
const isBulkTransferDialogOpen = ref(false);
const isBulkCloseDialogOpen = ref(false);
const isBulkSummaryDialogOpen = ref(false);
const bulkSummary = ref<BulkActionChatResponse | null>(null);

const bulkTransferType = ref<'user' | 'sector' | null>(null);
const bulkTransferChannel = ref<string | null>(null);
const bulkTransferUser = ref<string | null>(null);
const bulkTransferSector = ref<string | null>(null);
const bulkTransferSectorUser = ref<string | null>(null);
const bulkTransferAnnotation = ref('');
const bulkTransferKeepInChat = ref(false);
const bulkTransferSendMessageOnTransfer = ref(false);
const bulkTransferChannels = ref<TransferChannelOption[]>([]);
const bulkTransferUsers = ref<
  Array<{
    value: string;
    title: string;
    photo: string | null;
    status: string | null;
  }>
>([]);
const bulkTransferSectors = ref<
  Array<{ value: string; title: string; color: string | null }>
>([]);
const bulkTransferSectorUsers = ref<
  Array<{
    value: string;
    title: string;
    photo: string | null;
    status: string | null;
  }>
>([]);
const isLoadingBulkTransferChannels = ref(false);
const isLoadingBulkTransferUsers = ref(false);
const isLoadingBulkTransferSectors = ref(false);
const isLoadingBulkTransferSectorUsers = ref(false);
const bulkTransferWorkerConfigForChat =
  ref<ViewWorkerConfigForChatResponse | null>(null);
const bulkCloseSendMessageOnFinishAttendance = ref(false);

const contactFilterLabel = ref<string | null>(null);
const contactFilterPhoneDdi = ref<string | null>(null);
const contactFilterPhone = ref<string | null>(null);
const contactFilterName = ref<string | null>(null);
const contactFilterLastName = ref<string | null>(null);
const contactFilterNickname = ref<string | null>(null);
const contactFilterEmail = ref<string | null>(null);
const contactFilterBirthday = ref<string | null>(null);
const contactFilterDocument = ref<string | null>(null);
const contactFilterUserId = ref<string | null>(null);
const contactSortField = ref<string | null>('name');
const contactSortOrder = ref<string | null>('asc');

const isLoadingChatbot = ref(false);
const isLoadingMoreChatbot = ref(false);
const isLoadingScheduled = ref(false);
const isLoadingMoreScheduled = ref(false);

const listClosed = ref<ListChatsResult[]>([]);
const closedPagings = ref({
  current_page: 1,
  total_pages: 1,
  per_page: 50,
  count: 0,
  total: 0,
});
const isLoadingClosed = ref(false);
const allChatsWithFiltersPagings = ref({
  current_page: 1,
  total_pages: 1,
  per_page: 50,
  count: 0,
  total: 0,
});
const isLoadingAllChatsWithFilters = ref(false);
const searchChatsCounts = ref<{
  total: number;
  queue: number;
  in_chat: number;
  chatbot: number;
  schedule?: number;
  closed?: number;
  my_chats: number;
} | null>(null);

const formatChannelNumber = (number?: string | null): string | null => {
  if (!number) return null;
  return formatPhoneBR(number);
};

const availableWorkerOptions = computed(() =>
  availableWorkers.value.map((worker) => {
    const formattedNumber = formatChannelNumber(worker.number ?? null);

    return {
      value: worker.id,
      title: formattedNumber
        ? `${worker.name} (${formattedNumber})`
        : worker.name,
      name: worker.name,
      number: formattedNumber,
      isOfficial:
        worker.is_official === true || worker.type_id === EWorkerType.whatsapp,
    };
  })
);

const selectedOpenConversationWorkerOption = computed(
  () =>
    availableWorkerOptions.value.find(
      (worker) => worker.value === selectedWorkerId.value
    ) ?? null
);
const isSelectedWorkerOfficial = computed(
  () => selectedOpenConversationWorkerOption.value?.isOfficial === true
);
const hasOfficialWorkerAvailable = computed(() =>
  availableWorkerOptions.value.some((worker) => worker.isOfficial === true)
);
const {
  context: officialOpeningContext,
  window: officialOpeningWindow,
  loading: isLoadingOfficialOpeningContext,
  error: officialOpeningError,
  load: loadOfficialOpeningContextForIdentity,
  refresh: refreshOfficialOpeningContext,
  reset: resetOfficialOpeningContext,
} = useOfficialOpeningContext({
  loadContext: (workerId, contactId) =>
    chatStore.viewOfficialOpeningContext(workerId, contactId, { silent: true }),
  loadingErrorMessage: () => t('official_templates_loading_error'),
});
const selectedOfficialTemplateKey = ref<string | null>(null);
const officialTemplateVariableValues = ref<Record<string, string>>({});
const manualOfficialTemplateVariables = ref<OfficialTemplateVariableValue[]>(
  []
);
const openingUnderchatVariables = computed(() =>
  createUnderchatVariableCatalog(t)
);

const officialTemplateOptions = computed(() =>
  createOfficialTemplateOptions(
    officialOpeningContext.value?.templates,
    locale.value
  )
);

const selectedOfficialTemplate = computed(() =>
  findOfficialTemplate(
    officialOpeningContext.value?.templates,
    selectedOfficialTemplateKey.value
  )
);

const selectedOfficialTemplateLanguageLabel = computed(() =>
  selectedOfficialTemplate.value
    ? formatOfficialTemplateLanguage(
        selectedOfficialTemplate.value.language,
        locale.value
      )
    : ''
);

const officialTemplateDetectedVariableRows = computed(
  () => selectedOfficialTemplate.value?.variables ?? []
);

const hasOfficialTemplateDetectedVariables = computed(
  () => officialTemplateDetectedVariableRows.value.length > 0
);

const officialTemplateVariableRows = computed<OfficialTemplateVariable[]>(() =>
  hasOfficialTemplateDetectedVariables.value
    ? officialTemplateDetectedVariableRows.value
    : manualOfficialTemplateVariables.value
);

const areOfficialTemplateVariablesValid = computed(() =>
  officialTemplateVariableRows.value.every((variable) =>
    officialTemplateVariableValues.value[variable.key]?.trim()
  )
);

const requiresOfficialTemplate = computed(
  () =>
    isSelectedWorkerOfficial.value &&
    officialOpeningContext.value?.requires_template === true
);
const isAwaitingOfficialContactReply = computed(
  () =>
    isSelectedWorkerOfficial.value &&
    officialOpeningWindow.value?.state === 'awaiting_contact_reply'
);
const isOfficialSendUncertain = computed(
  () =>
    isSelectedWorkerOfficial.value &&
    officialOpeningWindow.value?.state === 'send_uncertain'
);
const isOfficialOpeningBlocked = computed(
  () => isAwaitingOfficialContactReply.value || isOfficialSendUncertain.value
);

const canShowSectorSelect = computed(
  () =>
    !isSelectedWorkerOfficial.value ||
    (!isOfficialOpeningBlocked.value &&
      (officialOpeningContext.value?.requires_template === false ||
        !!selectedOfficialTemplate.value))
);

const isOfficialOpeningReady = computed(() => {
  if (!isSelectedWorkerOfficial.value) return true;
  if (
    isLoadingOfficialOpeningContext.value ||
    officialOpeningError.value ||
    !officialOpeningContext.value
  ) {
    return false;
  }
  if (isOfficialOpeningBlocked.value) {
    return false;
  }
  if (!requiresOfficialTemplate.value) {
    return true;
  }

  return Boolean(
    selectedOfficialTemplate.value && areOfficialTemplateVariablesValid.value
  );
});

const officialTemplateSelectedVariableValues = computed<
  OfficialTemplateVariableValue[]
>(() =>
  hasOfficialTemplateDetectedVariables.value
    ? buildOfficialTemplateVariablePayload(
        officialTemplateDetectedVariableRows.value,
        officialTemplateVariableValues.value
      )
    : manualOfficialTemplateVariables.value.map((variable) => ({
        key: variable.key,
        component_type: variable.component_type,
        index: variable.index,
        parameter_name: variable.parameter_name ?? null,
        button_index: variable.button_index ?? null,
        value: officialTemplateVariableValues.value[variable.key]?.trim() ?? '',
      }))
);

const selectedOfficialTemplatePreview = computed(() =>
  buildOfficialTemplatePreview(
    selectedOfficialTemplate.value,
    officialTemplateVariableValues.value,
    officialTemplateVariableRows.value
  )
);

const hasOfficialTemplateRuntimeVariables = computed(() =>
  Object.values(officialTemplateVariableValues.value).some((value) =>
    containsUnderchatVariableTag(value)
  )
);

const isOpenConversationFormBusy = computed(
  () => isOpeningConversation.value || isLoadingWorkerConfigForChat.value
);

const openConversationActionLabel = computed(() =>
  isOfficialOpeningBlocked.value
    ? t(
        isOfficialSendUncertain.value
          ? 'official_opening_uncertain_action'
          : 'official_opening_waiting_action'
      )
    : requiresOfficialTemplate.value
      ? t('official_opening_send_and_open')
      : t('open_conversation')
);

const addManualOfficialTemplateVariable = () => {
  const variable = createManualOfficialTemplateVariable(
    manualOfficialTemplateVariables.value.length
  );
  manualOfficialTemplateVariables.value = [
    ...manualOfficialTemplateVariables.value,
    variable,
  ];
  officialTemplateVariableValues.value = {
    ...officialTemplateVariableValues.value,
    [variable.key]: '',
  };
};

const removeManualOfficialTemplateVariable = (index: number) => {
  const variable = manualOfficialTemplateVariables.value[index];
  if (!variable) {
    return;
  }

  const nextValues = { ...officialTemplateVariableValues.value };
  delete nextValues[variable.key];
  officialTemplateVariableValues.value = nextValues;
  manualOfficialTemplateVariables.value =
    manualOfficialTemplateVariables.value.filter(
      (_, itemIndex) => itemIndex !== index
    );
};

const syncManualOfficialTemplateVariable = (index: number) => {
  const variable = manualOfficialTemplateVariables.value[index];
  if (!variable) {
    return;
  }

  const previousKey = variable.key;
  const refreshed = refreshOfficialTemplateVariableKey(variable);
  const previousValue =
    officialTemplateVariableValues.value[previousKey] ?? variable.value ?? '';
  manualOfficialTemplateVariables.value[index] = {
    ...refreshed,
    value: previousValue,
  };

  if (previousKey === refreshed.key) {
    return;
  }

  const nextValues = { ...officialTemplateVariableValues.value };
  delete nextValues[previousKey];
  nextValues[refreshed.key] = previousValue;
  officialTemplateVariableValues.value = nextValues;
};
const isLoadingWorkerConfigs = ref(false);
const isLoadingMoreQueue = ref(false);
const isLoadingMoreInChat = ref(false);
const inChatSectionRef = ref<HTMLElement | null>(null);
const chatScrollContainer = ref<InstanceType<typeof PerfectScrollbar> | null>(
  null
);

const updateScrollbar = async () => {
  await nextTick();
  if (chatScrollContainer.value) {
    const psElement = chatScrollContainer.value.$el as HTMLElement;
    const ps = (chatScrollContainer.value as any).ps;
    if (ps && typeof ps.update === 'function') {
      ps.update();
    } else if (psElement) {
      // Fallback: trigger scroll event to force update
      psElement.dispatchEvent(new Event('scroll'));
    }
  }
};

type FilterType =
  | 'new'
  | 'all'
  | 'in_chat'
  | 'queue'
  | 'chatbot'
  | 'scheduled'
  | 'my_chats'
  | 'closed';

type ChatExtrasSource = Pick<ListChatsResult, 'worker' | 'contact'>;
type RealtimeFilterType = Exclude<FilterType, 'new'>;
type ChatStatusChangedReason = 'new' | 'update';
type ChatStatusChangedDetail = {
  chat: IChat;
  reason?: ChatStatusChangedReason;
};

const REALTIME_FILTER_TYPES: readonly RealtimeFilterType[] = [
  'all',
  'in_chat',
  'queue',
  'my_chats',
  'chatbot',
  'scheduled',
  'closed',
];

const sortChatsByField = (
  chats: ListChatsResult[],
  sortField: string,
  sortOrder: string
): ListChatsResult[] => {
  if (chats.length <= 1) {
    return chats;
  }

  const order = sortOrder === 'asc' ? 'asc' : 'desc';

  return [...chats].sort((a, b) => {
    const aValue = chatStore.getFieldValue(a, sortField);
    const bValue = chatStore.getFieldValue(b, sortField);

    if (aValue === bValue) {
      return 0;
    }

    if (aValue === '' || aValue === null || aValue === undefined) {
      return 1;
    }
    if (bValue === '' || bValue === null || bValue === undefined) {
      return -1;
    }

    let comparison = 0;
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      comparison = aValue.localeCompare(bValue);
    } else if (typeof aValue === 'number' && typeof bValue === 'number') {
      comparison = aValue - bValue;
    } else {
      comparison = String(aValue).localeCompare(String(bValue));
    }

    return order === 'asc' ? comparison : -comparison;
  });
};

const activeFilter = ref<FilterType>('all');
const expandedFilter = ref<FilterType | null>('all');
const hasSearchTerm = computed(() => !!debouncedSearchQuery.value?.trim());
const shouldApplyPerFilterSort = computed(
  () => !hasAppliedAdvancedFilters.value && !hasSearchTerm.value
);
const hiddenRealtimeNewChatIds = ref<Set<string>>(new Set());

const isRealtimeFilterType = (
  filter: FilterType
): filter is RealtimeFilterType => {
  return REALTIME_FILTER_TYPES.includes(filter as RealtimeFilterType);
};

const removeRealtimeHiddenChatsFromList = (
  chats: ListChatsResult[]
): ListChatsResult[] => {
  if (
    !isRealtimeFilterType(activeFilter.value) ||
    !hasActiveFilters.value ||
    hiddenRealtimeNewChatIds.value.size === 0
  ) {
    return chats;
  }

  return chats.filter(
    (chat) => !hiddenRealtimeNewChatIds.value.has(chat.chat_id)
  );
};

const isChatForCurrentUser = (
  chat: ListChatsResult,
  userId: string
): boolean => {
  if (chat.user?.id === userId) {
    return true;
  }

  if (!Array.isArray(chat.secondary_users)) {
    return false;
  }

  return chat.secondary_users.some(
    (secondaryUser) => secondaryUser?.id === userId
  );
};

const PINNABLE_CHAT_STATUSES = new Set<string>([
  EChatStatus.queue,
  EChatStatus.in_chat,
  EChatStatus.ura,
  EChatStatus.ura_output,
  EChatStatus.ura_schedule,
  EChatStatus.ura_webhook,
]);

const isPinnableChat = (chat: ListChatsResult | null | undefined): boolean => {
  return !!chat?.status && PINNABLE_CHAT_STATUSES.has(chat.status);
};

const pinnedChats = computed(() =>
  chatStore.pinnedChats.filter((chat) => isPinnableChat(chat))
);

const pinnedChatIds = computed(
  () => new Set(pinnedChats.value.map((chat) => chat.chat_id))
);

const canShowPinnedChat = computed(() => {
  return !isBulkModeEnabled.value && pinnedChats.value.length > 0;
});

const removePinnedChatFromList = (chats: ListChatsResult[]) => {
  if (!canShowPinnedChat.value) {
    return chats;
  }

  return chats.filter((chat) => !pinnedChatIds.value.has(chat.chat_id));
};

const filteredInChat = computed(() => {
  if (activeFilter.value === 'in_chat') {
    const visibleChats = removePinnedChatFromList(
      removeRealtimeHiddenChatsFromList(chatStore.listInChat)
    );
    if (!shouldApplyPerFilterSort.value) {
      return visibleChats;
    }
    return sortChatsByField(
      visibleChats,
      inChatSortFieldForModal.value,
      inChatSortOrderForModal.value
    );
  }
  if (activeFilter.value === 'all' && !hasActiveFilters.value) {
    const visibleChats = removePinnedChatFromList(
      removeRealtimeHiddenChatsFromList(chatStore.listInChat)
    );
    if (!shouldApplyPerFilterSort.value) {
      return visibleChats;
    }
    return sortChatsByField(
      visibleChats,
      inChatSortFieldForModal.value,
      inChatSortOrderForModal.value
    );
  }
  if (activeFilter.value === 'all' && hasActiveFilters.value) {
    const visibleChats = removePinnedChatFromList(
      removeRealtimeHiddenChatsFromList(chatStore.listInChat)
    );
    if (!shouldApplyPerFilterSort.value) {
      return visibleChats;
    }
    return sortChatsByField(
      visibleChats,
      inChatSortFieldForModal.value,
      inChatSortOrderForModal.value
    );
  }
  return [];
});

const filteredQueue = computed(() => {
  if (activeFilter.value === 'queue') {
    const visibleChats = removePinnedChatFromList(
      removeRealtimeHiddenChatsFromList(chatStore.listQueue)
    );
    if (!shouldApplyPerFilterSort.value) {
      return visibleChats;
    }
    return sortChatsByField(
      visibleChats,
      queueSortFieldForModal.value,
      queueSortOrderForModal.value
    );
  }
  if (activeFilter.value === 'all' && !hasActiveFilters.value) {
    const visibleChats = removePinnedChatFromList(
      removeRealtimeHiddenChatsFromList(chatStore.listQueue)
    );
    if (!shouldApplyPerFilterSort.value) {
      return visibleChats;
    }
    return sortChatsByField(
      visibleChats,
      queueSortFieldForModal.value,
      queueSortOrderForModal.value
    );
  }
  if (activeFilter.value === 'all' && hasActiveFilters.value) {
    const visibleChats = removePinnedChatFromList(
      removeRealtimeHiddenChatsFromList(chatStore.listQueue)
    );
    if (!shouldApplyPerFilterSort.value) {
      return visibleChats;
    }
    return sortChatsByField(
      visibleChats,
      queueSortFieldForModal.value,
      queueSortOrderForModal.value
    );
  }
  return [];
});

const filteredMyChats = computed(() => {
  if (activeFilter.value === 'my_chats') {
    const userId = chatStore.user?.user_id;
    if (!userId) return [];

    if (hasActiveFilters.value) {
      const allChats = [
        ...chatStore.listInChat,
        ...chatStore.listQueue,
        ...chatStore.listChatbot,
        ...chatStore.listScheduled,
        ...chatStore.listClosed,
      ];
      const myChats = allChats.filter((chat) =>
        isChatForCurrentUser(chat, userId)
      );
      const visibleChats = removePinnedChatFromList(
        removeRealtimeHiddenChatsFromList(myChats)
      );
      const sortField = sortMyChatsField.value ?? 'summary.last_message';
      const sortOrder = sortMyChatsOrder.value ?? 'desc';
      if (!shouldApplyPerFilterSort.value) {
        return visibleChats;
      }
      return sortChatsByField(visibleChats, sortField, sortOrder);
    }

    const allChats = [...chatStore.listInChat, ...chatStore.listQueue];
    const myChats = allChats.filter((chat) =>
      isChatForCurrentUser(chat, userId)
    );
    const visibleChats = removePinnedChatFromList(
      removeRealtimeHiddenChatsFromList(myChats)
    );
    const sortField = sortMyChatsField.value ?? 'summary.last_message';
    const sortOrder = sortMyChatsOrder.value ?? 'desc';
    if (!shouldApplyPerFilterSort.value) {
      return visibleChats;
    }
    return sortChatsByField(visibleChats, sortField, sortOrder);
  }
  return [];
});

const hasActiveFilters = computed(() => {
  return !!(
    hasAppliedAdvancedFilters.value ||
    searchQuery.value?.trim() ||
    currentFilterLabelTemplateId.value ||
    currentFilterWorkerId.value ||
    currentFilterUserId.value ||
    currentFilterSectorId.value ||
    currentFilterName.value ||
    currentFilterPhone.value ||
    currentFilterProtocol.value ||
    currentFilterDateStart.value ||
    currentFilterDateEnd.value ||
    currentFilterUnreadConversations.value
  );
});

const filteredChatbot = computed(() => {
  if (
    activeFilter.value === 'all' &&
    hasActiveFilters.value &&
    !hasAppliedAdvancedFilters.value &&
    !hasSearchTerm.value
  ) {
    return removePinnedChatFromList(
      removeRealtimeHiddenChatsFromList(chatStore.listChatbot)
    );
  }
  if (activeFilter.value === 'chatbot') {
    const visibleChats = removePinnedChatFromList(
      removeRealtimeHiddenChatsFromList(chatStore.listChatbot)
    );
    if (!shouldApplyPerFilterSort.value) {
      return visibleChats;
    }
    return sortChatsByField(
      visibleChats,
      sortChatbotField.value ?? 'summary.last_message',
      sortChatbotOrder.value ?? 'desc'
    );
  }
  return [];
});

const showChatbotTitle = computed(() => {
  return (
    activeFilter.value === 'all' &&
    hasActiveFilters.value &&
    !hasAppliedAdvancedFilters.value &&
    !hasSearchTerm.value
  );
});

const filteredClosed = computed(() => {
  if (
    activeFilter.value === 'all' &&
    hasActiveFilters.value &&
    !hasAppliedAdvancedFilters.value &&
    !hasSearchTerm.value
  ) {
    return removePinnedChatFromList(
      removeRealtimeHiddenChatsFromList(chatStore.listClosed)
    );
  }
  if (activeFilter.value === 'closed') {
    return removePinnedChatFromList(
      removeRealtimeHiddenChatsFromList(chatStore.listClosed)
    );
  }
  return [];
});

const filteredScheduled = computed(() => {
  if (
    activeFilter.value === 'all' &&
    hasActiveFilters.value &&
    !hasAppliedAdvancedFilters.value &&
    !hasSearchTerm.value
  ) {
    return removePinnedChatFromList(
      removeRealtimeHiddenChatsFromList(chatStore.listScheduled)
    );
  }
  if (activeFilter.value === 'scheduled') {
    return removePinnedChatFromList(
      removeRealtimeHiddenChatsFromList(chatStore.listScheduled)
    );
  }
  return [];
});

const showScheduledTitle = computed(() => {
  return (
    activeFilter.value === 'all' &&
    hasActiveFilters.value &&
    !hasAppliedAdvancedFilters.value &&
    !hasSearchTerm.value &&
    chatStore.listScheduled.length > 0
  );
});

const showClosedTitle = computed(() => {
  return (
    activeFilter.value === 'all' &&
    hasActiveFilters.value &&
    !hasAppliedAdvancedFilters.value &&
    !hasSearchTerm.value &&
    chatStore.listClosed.length > 0
  );
});

const shouldUseEndpointCounts = computed(() => {
  return hasActiveFilters.value;
});

const allChatsCount = computed(() => {
  if (shouldUseEndpointCounts.value && searchChatsCounts.value) {
    return searchChatsCounts.value.total;
  }
  if (hasActiveFilters.value) {
    return allChatsWithFiltersPagings.value.total || 0;
  }
  return (
    (chatStore.inChatPagings.total || 0) + (chatStore.queuePagings.total || 0)
  );
});

const inChatCount = computed(() => {
  if (shouldUseEndpointCounts.value && searchChatsCounts.value) {
    return searchChatsCounts.value.in_chat;
  }
  if (hasActiveFilters.value) {
    return chatStore.listInChat.length;
  }
  return chatStore.inChatPagings.total || 0;
});

const queueCount = computed(() => {
  if (shouldUseEndpointCounts.value && searchChatsCounts.value) {
    return searchChatsCounts.value.queue;
  }
  if (hasActiveFilters.value) {
    return chatStore.listQueue.length;
  }
  return chatStore.queuePagings.total || 0;
});

const myChatsCount = computed(() => {
  const userId = chatStore.user?.user_id;
  if (!userId) return 0;

  if (shouldUseEndpointCounts.value && searchChatsCounts.value) {
    return searchChatsCounts.value.my_chats;
  }

  if (hasActiveFilters.value) {
    const allChats = [
      ...chatStore.listInChat,
      ...chatStore.listQueue,
      ...chatStore.listChatbot,
      ...chatStore.listScheduled,
      ...chatStore.listClosed,
    ];
    return allChats.filter((chat) => isChatForCurrentUser(chat, userId)).length;
  }

  if (chatStore.myChatsTotal !== null) {
    return chatStore.myChatsTotal;
  }

  const allChats = [...chatStore.listInChat, ...chatStore.listQueue];
  return allChats.filter((chat) => isChatForCurrentUser(chat, userId)).length;
});

const chatbotCount = computed(() => {
  if (shouldUseEndpointCounts.value && searchChatsCounts.value) {
    return searchChatsCounts.value.chatbot;
  }
  if (hasActiveFilters.value) {
    return chatStore.listChatbot.length;
  }
  if (chatStore.chatbotPagings.total > 0) {
    return chatStore.chatbotPagings.total;
  }
  return chatStore.listChatbot.length;
});

const closedCount = computed(() => {
  if (shouldUseEndpointCounts.value && searchChatsCounts.value) {
    return searchChatsCounts.value.closed ?? 0;
  }
  if (hasActiveFilters.value) {
    return chatStore.listClosed.length;
  }
  if (chatStore.closedPagings.total > 0) {
    return chatStore.closedPagings.total;
  }
  return chatStore.listClosed.length;
});

const scheduledCount = computed(() => {
  if (shouldUseEndpointCounts.value && searchChatsCounts.value) {
    return searchChatsCounts.value.schedule ?? 0;
  }
  if (hasActiveFilters.value) {
    return chatStore.listScheduled.length;
  }
  if (chatStore.scheduledPagings.total > 0) {
    return chatStore.scheduledPagings.total;
  }
  return chatStore.listScheduled.length;
});

const bulkSupportedFilters: BulkCategory[] = [
  'all',
  'in_chat',
  'queue',
  'my_chats',
  'chatbot',
  'scheduled',
];

const isBulkModeAvailable = computed(() => {
  return bulkSupportedFilters.includes(activeFilter.value as BulkCategory);
});

const resolveBulkCategory = (): BulkCategory | null => {
  if (!isBulkModeAvailable.value) {
    return null;
  }

  return activeFilter.value as BulkCategory;
};

const resetBulkSelection = () => {
  bulkSelectAllFiltered.value = false;
  bulkSelectedChatIds.value = new Set();
};

const disableBulkMode = () => {
  isBulkModeEnabled.value = false;
  resetBulkSelection();
};

const toggleBulkMode = () => {
  if (!isBulkModeAvailable.value) {
    return;
  }

  if (isBulkModeEnabled.value) {
    disableBulkMode();
    return;
  }

  isBulkModeEnabled.value = true;
  resetBulkSelection();
};

const isBulkSelectableChat = (chat: ListChatsResult): boolean => {
  const category = resolveBulkCategory();
  if (!category) {
    return false;
  }

  const status = chat.status as EChatStatus;

  if (category === 'all') {
    return status === EChatStatus.in_chat || status === EChatStatus.queue;
  }

  if (category === 'in_chat') {
    return status === EChatStatus.in_chat;
  }

  if (category === 'queue') {
    return status === EChatStatus.queue;
  }

  if (category === 'my_chats') {
    const userId = chatStore.user?.user_id;
    if (!userId) return false;

    const isAllowedStatus =
      status === EChatStatus.in_chat || status === EChatStatus.queue;
    if (!isAllowedStatus) {
      return false;
    }

    return isChatForCurrentUser(chat, userId);
  }

  if (category === 'chatbot') {
    return (
      status === EChatStatus.ura ||
      status === EChatStatus.ura_output ||
      status === EChatStatus.ura_webhook
    );
  }

  if (category === 'scheduled') {
    return status === EChatStatus.ura_schedule;
  }

  return false;
};

const isChatBulkSelected = (chatId: string): boolean => {
  return bulkSelectAllFiltered.value || bulkSelectedChatIds.value.has(chatId);
};

const setChatBulkSelected = (chatId: string, selected: boolean): void => {
  const nextSet = new Set(bulkSelectedChatIds.value);

  if (selected) {
    nextSet.add(chatId);
  } else {
    nextSet.delete(chatId);
  }

  bulkSelectedChatIds.value = nextSet;
};

const toggleChatBulkSelected = (chatId: string): void => {
  if (bulkSelectAllFiltered.value) {
    return;
  }

  setChatBulkSelected(chatId, !bulkSelectedChatIds.value.has(chatId));
};

const bulkSelectedCount = computed(() => {
  return bulkSelectedChatIds.value.size;
});

const bulkTargetCount = computed(() => {
  if (!isBulkModeEnabled.value || !isBulkModeAvailable.value) {
    return 0;
  }

  if (bulkSelectAllFiltered.value) {
    const category = resolveBulkCategory();
    if (!category) return 0;

    if (category === 'all') {
      return inChatCount.value + queueCount.value;
    }
    if (category === 'in_chat') {
      return inChatCount.value;
    }
    if (category === 'queue') {
      return queueCount.value;
    }
    if (category === 'my_chats') {
      return myChatsCount.value;
    }
    if (category === 'chatbot') {
      return chatbotCount.value;
    }
    if (category === 'scheduled') {
      return scheduledCount.value;
    }
  }

  return bulkSelectedCount.value;
});

const hasBulkSelection = computed(() => {
  return bulkTargetCount.value > 0;
});

const handleBulkSelectAllFilteredChange = (selected: boolean) => {
  bulkSelectAllFiltered.value = selected;
  if (selected) {
    bulkSelectedChatIds.value = new Set();
  }
};

const handleChatQueueCheckboxChange = (
  chat: ListChatsResult,
  selected: boolean
) => {
  if (!isBulkModeEnabled.value || !isBulkSelectableChat(chat)) {
    return;
  }

  if (bulkSelectAllFiltered.value) {
    return;
  }

  setChatBulkSelected(chat.chat_id, selected);
};

const handleDefaultChatClick = (chat: ListChatsResult) => {
  if (isBulkModeEnabled.value && isBulkSelectableChat(chat)) {
    toggleChatBulkSelected(chat.chat_id);
    return;
  }

  emit('openChat', chat.chat_id, { fallbackChat: chat });
};

const handleQueueCardClick = (chat: ListChatsResult, index: number): void => {
  if (isBulkModeEnabled.value && isBulkSelectableChat(chat)) {
    toggleChatBulkSelected(chat.chat_id);
    return;
  }

  handleQueueClick(chat, index);
};

const getQueueChatOriginalIndex = (chatId: string): number => {
  return chatStore.listQueue.findIndex((chat) => chat.chat_id === chatId);
};

const handlePinnedChatClick = (chat: ListChatsResult): void => {
  emit('openChat', chat.chat_id, { fallbackChat: chat });
};

const handleTogglePinnedChat = async (chat: ListChatsResult) => {
  if (chatStore.isChatPinned(chat.chat_id)) {
    await chatStore.unpinChat(chat.chat_id);
    return;
  }

  await chatStore.pinChat(chat);
};

const resetBulkTransferForm = () => {
  bulkTransferType.value = null;
  bulkTransferChannel.value = null;
  bulkTransferUser.value = null;
  bulkTransferSector.value = null;
  bulkTransferSectorUser.value = null;
  bulkTransferAnnotation.value = '';
  bulkTransferKeepInChat.value = false;
  bulkTransferSendMessageOnTransfer.value = false;
  bulkTransferChannels.value = [];
  bulkTransferUsers.value = [];
  bulkTransferSectors.value = [];
  bulkTransferSectorUsers.value = [];
  bulkTransferWorkerConfigForChat.value = null;
};

const loadBulkTransferChannels = async () => {
  isLoadingBulkTransferChannels.value = true;

  try {
    const options = await chatStore.listTransferOptions();

    bulkTransferChannels.value =
      options?.workers.map((worker) => {
        const formattedNumber = formatChannelNumber(worker.number || null);

        return {
          value: worker.id,
          title: formattedNumber
            ? `${worker.name} (${formattedNumber})`
            : worker.name,
          name: worker.name,
          number: formattedNumber,
        };
      }) ?? [];
  } finally {
    isLoadingBulkTransferChannels.value = false;
  }
};

const loadBulkTransferWorkerConfig = async (channelId?: string | null) => {
  if (!channelId) {
    bulkTransferWorkerConfigForChat.value = null;
    return;
  }

  try {
    const config = await channelsStore.fetchWorkerConfigForChat(channelId);
    bulkTransferWorkerConfigForChat.value = config;
  } catch (error) {
    bulkTransferWorkerConfigForChat.value = null;
  }
};

const loadBulkTransferUsers = async (channelId?: string | null) => {
  if (!channelId) {
    bulkTransferUsers.value = [];
    return;
  }

  isLoadingBulkTransferUsers.value = true;

  try {
    const users: TransferUserResponse[] = await chatStore.listTransferUsers(
      undefined,
      channelId
    );

    bulkTransferUsers.value = users.map((user) => ({
      value: user.id,
      title: user.name,
      photo: user.photo ?? null,
      status: user.status ?? null,
    }));
  } finally {
    isLoadingBulkTransferUsers.value = false;
  }
};

const loadBulkTransferSectors = async () => {
  isLoadingBulkTransferSectors.value = true;

  try {
    const sectors = await chatStore.listTransferSectors();

    bulkTransferSectors.value = sectors.map((sector) => ({
      value: sector.id,
      title: sector.name,
      color: sector.color ?? null,
    }));
  } finally {
    isLoadingBulkTransferSectors.value = false;
  }
};

const loadBulkTransferSectorUsers = async (
  sectorId?: string | null,
  channelId?: string | null
) => {
  if (!sectorId || !channelId) {
    bulkTransferSectorUsers.value = [];
    return;
  }

  isLoadingBulkTransferSectorUsers.value = true;

  try {
    const users: TransferSectorUserResponse[] =
      await chatStore.listTransferSectorUsers(sectorId, undefined, channelId);

    bulkTransferSectorUsers.value = users.map((user) => ({
      value: user.id,
      title: user.name,
      photo: user.photo ?? null,
      status: user.status ?? null,
    }));
  } finally {
    isLoadingBulkTransferSectorUsers.value = false;
  }
};

watch(bulkTransferType, () => {
  bulkTransferUser.value = null;
  bulkTransferSector.value = null;
  bulkTransferSectorUser.value = null;
  bulkTransferSectorUsers.value = [];
});

watch(bulkTransferChannel, async (channelId) => {
  bulkTransferUser.value = null;
  bulkTransferSectorUser.value = null;
  bulkTransferUsers.value = [];
  bulkTransferSectorUsers.value = [];
  bulkTransferWorkerConfigForChat.value = null;
  bulkTransferSendMessageOnTransfer.value = false;

  await loadBulkTransferWorkerConfig(channelId);

  if (!channelId) {
    return;
  }

  await loadBulkTransferUsers(channelId);

  if (bulkTransferSector.value) {
    await loadBulkTransferSectorUsers(bulkTransferSector.value, channelId);
  }
});

watch(bulkTransferSector, (sectorId) => {
  bulkTransferSectorUser.value = null;
  bulkTransferSectorUsers.value = [];

  if (sectorId && bulkTransferChannel.value) {
    loadBulkTransferSectorUsers(sectorId, bulkTransferChannel.value);
  }
});

watch(isBulkTransferDialogOpen, async (isOpen) => {
  if (!isOpen) {
    resetBulkTransferForm();
    return;
  }

  resetBulkTransferForm();
  await Promise.all([loadBulkTransferChannels(), loadBulkTransferSectors()]);
});

watch(isBulkModeEnabled, (enabled) => {
  if (!enabled) {
    isBulkTransferDialogOpen.value = false;
    isBulkCloseDialogOpen.value = false;
  }
});

const showInChatTitle = computed(() => {
  return activeFilter.value === 'all';
});

const showQueueTitle = computed(() => {
  return activeFilter.value === 'all';
});

const expandedFilterText = computed(() => {
  if (!expandedFilter.value) return '';

  const filterTextMap: Record<FilterType, string> = {
    new: chatStore.i18n.global.t('new', 'Novo'),
    all: chatStore.i18n.global.t('all', 'Todos'),
    in_chat: chatStore.i18n.global.t('in_service'),
    queue: chatStore.i18n.global.t('waiting_for_service'),
    my_chats: chatStore.i18n.global.t('my_chats', 'Meus atendimentos'),
    chatbot: chatStore.i18n.global.t('chatbot', 'ChatBot'),
    scheduled: chatStore.i18n.global.t('scheduled', 'Agendamento'),
    closed: chatStore.i18n.global.t('closed', 'Fechado'),
  };

  return filterTextMap[expandedFilter.value] || '';
});

const queueSelectionPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EChatPermissions.chat_group,
  EChatPermissions.pick_queue_chat,
];

const canSelectAnyQueueChat = computed(() => can(queueSelectionPermissions));

const disableSendMessageOnTransferPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EChatPermissions.disable_send_message_on_transfer,
];

const canDisableSendMessageOnTransfer = computed(() =>
  can(disableSendMessageOnTransferPermissions)
);

const shouldShowBulkTransferSendMessageToggle = computed(() => {
  return (
    bulkTransferWorkerConfigForChat.value?.send_message_on_transfer_enabled ===
      true && canDisableSendMessageOnTransfer.value
  );
});

const chatbotFilterPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EChatPermissions.chat_group,
  EChatbotPermissions.chatbot_group,
  EChatbotPermissions.chatbot_access,
  EChatPermissions.view_chatbot_messages,
];

const canViewChatbotTab = computed(() => can(chatbotFilterPermissions));

const isQueueChatSelectable = (index: number): boolean => {
  if (canSelectAnyQueueChat.value) {
    return true;
  }

  return index === 0;
};

const handleQueueClick = (chat: ListChatsResult, index: number): void => {
  if (!isQueueChatSelectable(index)) {
    return;
  }

  emit('openChat', chat.chat_id, { fallbackChat: chat });
};

const handleFilterClick = (filter: FilterType) => {
  if (filter === 'chatbot' && !canViewChatbotTab.value) {
    return;
  }

  if (activeFilter.value === filter && expandedFilter.value === filter) {
    return;
  }

  activeFilter.value = filter;
  expandedFilter.value = filter;

  if (filter === 'all' || filter === 'in_chat' || filter === 'queue') {
    currentPageQueue.value = 1;
    currentPageInChat.value = 1;
    loadChatsByFilter();
  } else if (filter === 'new') {
    currentPageContacts.value = 1;
    accumulatedContacts.value = [];
    loadContacts();
  } else if (filter === 'chatbot') {
    chatStore.chatbotPagings.current_page = 1;
    loadChatbotChats();
  } else if (filter === 'scheduled') {
    chatStore.scheduledPagings.current_page = 1;
    loadScheduledChats();
  } else if (filter === 'closed') {
    chatStore.closedPagings.current_page = 1;
    loadClosedChats();
  } else if (filter === 'my_chats') {
    currentPageQueue.value = 1;
    currentPageInChat.value = 1;
    loadChatsByFilter();
  }
};

const openSortModal = (
  filterType: 'all' | 'in_chat' | 'queue' | 'my_chats' | 'chatbot'
) => {
  sortModalFilterType.value = filterType;

  updateSortValuesFromChatUser();

  if (filterType === 'all') {
    sortModalField.value =
      chatStore.user?.chat_user?.sort_by_chat_order ??
      sortAllInChatField.value ??
      'summary.last_message';
    sortModalOrder.value =
      chatStore.user?.chat_user?.sort_in_chat_order ??
      sortAllInChatOrder.value ??
      'desc';
  } else if (filterType === 'in_chat') {
    sortModalField.value =
      chatStore.user?.chat_user?.sort_by_chat_order ??
      sortInChatField.value ??
      'summary.last_message';
    sortModalOrder.value =
      chatStore.user?.chat_user?.sort_in_chat_order ??
      sortInChatOrder.value ??
      'desc';
  } else if (filterType === 'queue') {
    sortModalField.value =
      chatStore.user?.chat_user?.sort_by_queue_order ??
      sortQueueField.value ??
      'summary.last_message';
    sortModalOrder.value =
      chatStore.user?.chat_user?.sort_queue_order ??
      sortQueueOrder.value ??
      'desc';
  } else if (filterType === 'my_chats') {
    sortModalField.value =
      chatStore.user?.chat_user?.sort_by_my_chats_order ??
      sortMyChatsField.value ??
      'summary.last_message';
    sortModalOrder.value =
      chatStore.user?.chat_user?.sort_my_chats_order ??
      sortMyChatsOrder.value ??
      'desc';
  } else if (filterType === 'chatbot') {
    sortModalField.value =
      chatStore.user?.chat_user?.sort_by_chatbot_order ??
      sortChatbotField.value ??
      'summary.last_message';
    sortModalOrder.value =
      chatStore.user?.chat_user?.sort_chatbot_order ??
      sortChatbotOrder.value ??
      'desc';
  }

  isSortModalOpen.value = true;
};

const handleSortSave = async (status?: 'in_chat' | 'queue') => {
  const filterType = sortModalFilterType.value;
  const updateData: any = {
    notifications: chatStore.user?.chat_user?.notifications ?? false,
  };

  if (filterType === 'all') {
    if (status === 'in_chat') {
      sortAllInChatField.value = sortModalField.value;
      sortAllInChatOrder.value = sortModalOrder.value;
      updateData.sort_by_chat_order = sortModalField.value;
      updateData.sort_in_chat_order = sortModalOrder.value;
    } else if (status === 'queue') {
      sortAllQueueField.value = sortModalField.value;
      sortAllQueueOrder.value = sortModalOrder.value;
      updateData.sort_by_queue_order = sortModalField.value;
      updateData.sort_queue_order = sortModalOrder.value;
    } else {
      sortAllInChatField.value = sortModalField.value;
      sortAllInChatOrder.value = sortModalOrder.value;
      sortAllQueueField.value = sortModalField.value;
      sortAllQueueOrder.value = sortModalOrder.value;
      updateData.sort_by_chat_order = sortModalField.value;
      updateData.sort_in_chat_order = sortModalOrder.value;
      updateData.sort_by_queue_order = sortModalField.value;
      updateData.sort_queue_order = sortModalOrder.value;
    }
  } else if (filterType === 'in_chat') {
    sortInChatField.value = sortModalField.value;
    sortInChatOrder.value = sortModalOrder.value;
    updateData.sort_by_chat_order = sortModalField.value;
    updateData.sort_in_chat_order = sortModalOrder.value;
  } else if (filterType === 'queue') {
    sortQueueField.value = sortModalField.value;
    sortQueueOrder.value = sortModalOrder.value;
    updateData.sort_by_queue_order = sortModalField.value;
    updateData.sort_queue_order = sortModalOrder.value;
  } else if (filterType === 'my_chats') {
    sortMyChatsField.value = sortModalField.value;
    sortMyChatsOrder.value = sortModalOrder.value;
    updateData.sort_by_my_chats_order = sortModalField.value;
    updateData.sort_my_chats_order = sortModalOrder.value;
  } else if (filterType === 'chatbot') {
    sortChatbotField.value = sortModalField.value;
    sortChatbotOrder.value = sortModalOrder.value;
    updateData.sort_by_chatbot_order = sortModalField.value;
    updateData.sort_chatbot_order = sortModalOrder.value;
  }

  await chatStore.updateChatsUser(updateData);

  // Atualiza currentSortField e currentSortOrder para serem usados no endpoint
  currentSortField.value = sortModalField.value;
  currentSortOrder.value = sortModalOrder.value;

  if (activeFilter.value === 'all') {
    currentPageQueue.value = 1;
    currentPageInChat.value = 1;
    loadChatsByFilter();
  } else if (activeFilter.value === 'in_chat') {
    currentPageInChat.value = 1;
    loadChatsByFilter();
  } else if (activeFilter.value === 'queue') {
    currentPageQueue.value = 1;
    loadChatsByFilter();
  } else if (activeFilter.value === 'my_chats') {
    currentPageQueue.value = 1;
    currentPageInChat.value = 1;
    loadChatsByFilter();
  } else if (activeFilter.value === 'chatbot') {
    chatStore.chatbotPagings.current_page = 1;
    loadChatbotChats();
  } else if (activeFilter.value === 'scheduled') {
    chatStore.scheduledPagings.current_page = 1;
    loadScheduledChats();
  }
};

const handleFiltersUpdated = async () => {
  hasAppliedAdvancedFilters.value = true;
  hiddenRealtimeNewChatIds.value.clear();

  if (
    activeFilter.value !== 'all' &&
    activeFilter.value !== 'my_chats' &&
    activeFilter.value !== 'in_chat' &&
    activeFilter.value !== 'queue' &&
    activeFilter.value !== 'chatbot' &&
    activeFilter.value !== 'scheduled' &&
    activeFilter.value !== 'closed'
  ) {
    activeFilter.value = 'all';
    expandedFilter.value = 'all';
  }

  if (activeFilter.value === 'all') {
    currentPageQueue.value = 1;
    currentPageInChat.value = 1;
    chatStore.chatbotPagings.current_page = 1;
    chatStore.scheduledPagings.current_page = 1;
    closedPagings.value.current_page = 1;
    allChatsWithFiltersPagings.value.current_page = 1;
    await loadChatsByFilter();
  } else if (activeFilter.value === 'chatbot') {
    chatStore.chatbotPagings.current_page = 1;
    await loadChatbotChats();
  } else if (activeFilter.value === 'scheduled') {
    chatStore.scheduledPagings.current_page = 1;
    await loadScheduledChats();
  } else if (activeFilter.value === 'closed') {
    closedPagings.value.current_page = 1;
    await loadClosedChats();
  } else {
    currentPageQueue.value = 1;
    currentPageInChat.value = 1;
    await loadChatsByFilter();
  }

  if (
    debouncedSearchQuery.value &&
    debouncedSearchQuery.value.trim().length > 0
  ) {
    await performSearch();
  }
};

const handleClearFilters = async () => {
  searchQuery.value = '';
  currentFilterLabelTemplateId.value = null;
  currentFilterWorkerId.value = null;
  currentFilterUserId.value = null;
  currentFilterSectorId.value = null;
  currentFilterName.value = null;
  currentFilterPhone.value = null;
  currentFilterProtocol.value = null;
  currentFilterDateStart.value = null;
  currentFilterDateEnd.value = null;
  currentFilterUnreadConversations.value = false;
  currentSortField.value = 'summary.last_message';
  currentSortOrder.value = 'desc';
  hasAppliedAdvancedFilters.value = false;
  hiddenRealtimeNewChatIds.value.clear();

  allChatsWithFiltersPagings.value = {
    current_page: 1,
    total_pages: 1,
    per_page: 50,
    count: 0,
    total: 0,
  };

  searchChatsCounts.value = null;

  chatStore.listQueue = [];
  chatStore.listInChat = [];
  chatStore.listChatbot = [];
  chatStore.listScheduled = [];
  listClosed.value = [];
  chatStore.listClosed = [];

  activeFilter.value = 'all';
  expandedFilter.value = 'all';

  currentPageQueue.value = 1;
  currentPageInChat.value = 1;
  chatStore.chatbotPagings.current_page = 1;
  chatStore.scheduledPagings.current_page = 1;
  closedPagings.value.current_page = 1;

  chatStore.activeChat = null;

  await loadChatsByFilter();

  if (
    debouncedSearchQuery.value &&
    debouncedSearchQuery.value.trim().length > 0
  ) {
    await performSearch();
  }

  await nextTick();
  scrollToTop();
};

const clearAdvancedFilters = async () => {
  currentFilterLabelTemplateId.value = null;
  currentFilterWorkerId.value = null;
  currentFilterUserId.value = null;
  currentFilterSectorId.value = null;
  currentFilterName.value = null;
  currentFilterPhone.value = null;
  currentFilterProtocol.value = null;
  currentFilterDateStart.value = null;
  currentFilterDateEnd.value = null;
  currentFilterUnreadConversations.value = false;
  hasAppliedAdvancedFilters.value = false;
  hiddenRealtimeNewChatIds.value.clear();

  await loadChatsByFilter();
};

const loadWorkerConfigs = async (chats: ChatExtrasSource[]) => {
  const workerIds = new Set<string>();

  for (const chat of chats) {
    if (chat.worker?.id) {
      workerIds.add(chat.worker.id);
    }
  }

  if (workerIds.size === 0) {
    return;
  }

  isLoadingWorkerConfigs.value = true;

  try {
    const workerIdsArray = Array.from(workerIds);
    const promises = [];

    for (const workerId of workerIdsArray) {
      promises.push(channelsStore.fetchWorkerConfigForChat(workerId));
    }

    await Promise.all(promises);
  } catch (error) {
    console.error('Error loading worker configs:', error);
  } finally {
    isLoadingWorkerConfigs.value = false;
  }
};

const loadChatContacts = async (chats: ChatExtrasSource[]) => {
  const contactIds = new Set<string>();

  for (const chat of chats) {
    if (chat.contact?.id) {
      contactIds.add(chat.contact.id);
    }
  }

  if (contactIds.size === 0) {
    return;
  }

  const contactIdsToLoad = Array.from(contactIds).filter(
    (contactId) =>
      !Object.prototype.hasOwnProperty.call(chatStore.chatContacts, contactId)
  );

  if (contactIdsToLoad.length === 0) {
    return;
  }

  await chatStore.getChatContactsByIds(contactIdsToLoad);
};

const currentFilterLabelTemplateId = ref<string | null>(null);
const currentFilterWorkerId = ref<string | null>(null);
const currentFilterUserId = ref<string | null>(null);
const currentFilterSectorId = ref<string | null>(null);
const currentFilterName = ref<string | null>(null);
const currentFilterPhone = ref<string | null>(null);
const currentFilterProtocol = ref<string | null>(null);
const currentFilterDateStart = ref<string | null>(null);
const currentFilterDateEnd = ref<string | null>(null);
const currentFilterUnreadConversations = ref(false);
const currentSortField = ref<string | null>('summary.last_message');
const currentSortOrder = ref<string | null>('desc');

watch(hasActiveFilters, (isActive) => {
  if (!isActive) {
    hiddenRealtimeNewChatIds.value.clear();
  }
});

watch(
  [
    activeFilter,
    debouncedSearchQuery,
    hasAppliedAdvancedFilters,
    currentFilterLabelTemplateId,
    currentFilterWorkerId,
    currentFilterUserId,
    currentFilterSectorId,
    currentFilterName,
    currentFilterPhone,
    currentFilterProtocol,
    currentFilterDateStart,
    currentFilterDateEnd,
    currentFilterUnreadConversations,
  ],
  () => {
    resetBulkSelection();
    if (!isBulkModeAvailable.value) {
      isBulkModeEnabled.value = false;
    }
  }
);

const getSortFieldFromChatUser = (
  field:
    | 'sort_by_chat_order'
    | 'sort_by_queue_order'
    | 'sort_by_my_chats_order'
    | 'sort_by_chatbot_order'
): string | null => {
  return chatStore.user?.chat_user?.[field] ?? 'summary.last_message';
};

const getSortOrderFromChatUser = (
  field:
    | 'sort_in_chat_order'
    | 'sort_queue_order'
    | 'sort_my_chats_order'
    | 'sort_chatbot_order'
): string | null => {
  return chatStore.user?.chat_user?.[field] ?? 'desc';
};

const sortInChatField = ref<string | null>(
  getSortFieldFromChatUser('sort_by_chat_order')
);
const sortInChatOrder = ref<string | null>(
  getSortOrderFromChatUser('sort_in_chat_order')
);
const sortQueueField = ref<string | null>(
  getSortFieldFromChatUser('sort_by_queue_order')
);
const sortQueueOrder = ref<string | null>(
  getSortOrderFromChatUser('sort_queue_order')
);
const sortMyChatsField = ref<string | null>(
  getSortFieldFromChatUser('sort_by_my_chats_order')
);
const sortMyChatsOrder = ref<string | null>(
  getSortOrderFromChatUser('sort_my_chats_order')
);
const sortChatbotField = ref<string | null>(
  getSortFieldFromChatUser('sort_by_chatbot_order')
);
const sortChatbotOrder = ref<string | null>(
  getSortOrderFromChatUser('sort_chatbot_order')
);
const sortAllInChatField = ref<string | null>(
  getSortFieldFromChatUser('sort_by_chat_order')
);
const sortAllInChatOrder = ref<string | null>(
  getSortOrderFromChatUser('sort_in_chat_order')
);
const sortAllQueueField = ref<string | null>(
  getSortFieldFromChatUser('sort_by_queue_order')
);
const sortAllQueueOrder = ref<string | null>(
  getSortOrderFromChatUser('sort_queue_order')
);

const updateSortValuesFromChatUser = () => {
  if (!chatStore.user?.chat_user) return;

  const chatUser = chatStore.user.chat_user;

  if (chatUser.sort_by_chat_order) {
    sortInChatField.value = chatUser.sort_by_chat_order;
    sortAllInChatField.value = chatUser.sort_by_chat_order;
    // Atualiza currentSortField com a preferência de "Todos" como padrão
    currentSortField.value = chatUser.sort_by_chat_order;
  }
  if (chatUser.sort_in_chat_order) {
    sortInChatOrder.value = chatUser.sort_in_chat_order;
    sortAllInChatOrder.value = chatUser.sort_in_chat_order;
    // Atualiza currentSortOrder com a preferência de "Todos" como padrão
    currentSortOrder.value = chatUser.sort_in_chat_order;
  }
  if (chatUser.sort_by_queue_order) {
    sortQueueField.value = chatUser.sort_by_queue_order;
    sortAllQueueField.value = chatUser.sort_by_queue_order;
  }
  if (chatUser.sort_queue_order) {
    sortQueueOrder.value = chatUser.sort_queue_order;
    sortAllQueueOrder.value = chatUser.sort_queue_order;
  }
  if (chatUser.sort_by_my_chats_order) {
    sortMyChatsField.value = chatUser.sort_by_my_chats_order;
  }
  if (chatUser.sort_my_chats_order) {
    sortMyChatsOrder.value = chatUser.sort_my_chats_order;
  }
  if (chatUser.sort_by_chatbot_order) {
    sortChatbotField.value = chatUser.sort_by_chatbot_order;
  }
  if (chatUser.sort_chatbot_order) {
    sortChatbotOrder.value = chatUser.sort_chatbot_order;
  }
};

watch(
  () => chatStore.user?.chat_user,
  () => {
    updateSortValuesFromChatUser();
  },
  { deep: true, immediate: true }
);

const inChatSortFieldForModal = computed(
  () =>
    sortInChatField.value ?? sortAllInChatField.value ?? 'summary.last_message'
);

const inChatSortOrderForModal = computed(
  () => sortInChatOrder.value ?? sortAllInChatOrder.value ?? 'desc'
);

const queueSortFieldForModal = computed(
  () =>
    sortQueueField.value ?? sortAllQueueField.value ?? 'summary.last_message'
);

const queueSortOrderForModal = computed(
  () => sortQueueOrder.value ?? sortAllQueueOrder.value ?? 'desc'
);

const isSortModalOpen = ref(false);
const sortModalFilterType = ref<
  'all' | 'in_chat' | 'queue' | 'my_chats' | 'chatbot'
>('all');
const sortModalField = ref<string | null>('summary.last_message');
const sortModalOrder = ref<string | null>('desc');

const normalizePhoneFilterValue = (
  value: string | null | undefined
): string | undefined => {
  if (!value) {
    return undefined;
  }

  const digits = value.replace(/\D+/g, '');
  return digits.length > 0 ? digits : undefined;
};

const isPhoneLikeSearchTerm = (value: string): boolean => {
  const digits = value.replace(/\D+/g, '');
  if (!digits.length) {
    return false;
  }

  const hasOnlyPhoneCharacters = /^[\d\s()+-]+$/.test(value);
  if (!hasOnlyPhoneCharacters) {
    return false;
  }

  const hasExplicitPhoneMask = /[()+]/.test(value);
  return hasExplicitPhoneMask || digits.length >= 8;
};

const normalizeSearchTermForRequest = (
  value: string | null | undefined
): string => {
  const trimmedValue = value?.trim() ?? '';
  if (!trimmedValue) {
    return '';
  }

  if (!isPhoneLikeSearchTerm(trimmedValue)) {
    return trimmedValue;
  }

  return trimmedValue.replace(/\D+/g, '');
};

const getChatUserFilters = () => {
  return {
    filter_label_template_id: currentFilterLabelTemplateId.value ?? undefined,
    filter_worker_id: currentFilterWorkerId.value ?? undefined,
    filter_user_id: currentFilterUserId.value ?? undefined,
    filter_sector_id: currentFilterSectorId.value ?? undefined,
    filter_name: currentFilterName.value ?? undefined,
    filter_phone: normalizePhoneFilterValue(currentFilterPhone.value),
    filter_protocol: currentFilterProtocol.value ?? undefined,
    filter_date_start: currentFilterDateStart.value ?? undefined,
    filter_date_end: currentFilterDateEnd.value ?? undefined,
    filter_unread_conversations:
      currentFilterUnreadConversations.value || undefined,
    sort_field: currentSortField.value ?? undefined,
    sort_order: currentSortOrder.value ?? undefined,
  };
};

const getSearchTerm = () => {
  return normalizeSearchTermForRequest(debouncedSearchQuery.value);
};

const handleFilterPhoneUpdate = (value: string | null) => {
  currentFilterPhone.value = normalizePhoneFilterValue(value) ?? null;
};

const applyCounts = (counts: {
  total: number;
  queue: number;
  in_chat: number;
  chatbot: number;
  schedule?: number;
  closed?: number;
  my_chats: number;
}) => {
  searchChatsCounts.value = counts;
  chatStore.myChatsTotal = counts.my_chats;
  chatStore.queuePagings.total = counts.queue;
  chatStore.inChatPagings.total = counts.in_chat;
  chatStore.chatbotPagings.total = counts.chatbot;
  if (counts.schedule !== undefined) {
    chatStore.scheduledPagings.total = counts.schedule;
  }
  if (counts.closed !== undefined) {
    chatStore.closedPagings.total = counts.closed;
  }
};

let inFlightLoadKey: string | null = null;
let inFlightLoadPromise: Promise<void> | null = null;

const buildLoadKey = (append: boolean): string | null => {
  if (append) {
    return null;
  }

  const base = {
    filter: activeFilter.value,
    hasAppliedAdvancedFilters: hasAppliedAdvancedFilters.value,
    filters: getChatUserFilters(),
    search: getSearchTerm(),
  };

  if (activeFilter.value === 'all' || activeFilter.value === 'my_chats') {
    return JSON.stringify({
      ...base,
      queue: {
        current_page: currentPageQueue.value,
        per_page: perPageQueue.value,
      },
      in_chat: {
        current_page: currentPageInChat.value,
        per_page: perPageInChat.value,
      },
    });
  }

  if (activeFilter.value === 'in_chat') {
    return JSON.stringify({
      ...base,
      in_chat: {
        current_page: currentPageInChat.value,
        per_page: perPageInChat.value,
      },
    });
  }

  if (activeFilter.value === 'queue') {
    return JSON.stringify({
      ...base,
      queue: {
        current_page: currentPageQueue.value,
        per_page: perPageQueue.value,
      },
    });
  }

  if (activeFilter.value === 'chatbot') {
    return JSON.stringify({
      ...base,
      chatbot: {
        current_page: chatStore.chatbotPagings.current_page,
        per_page: chatStore.chatbotPagings.per_page,
      },
    });
  }

  if (activeFilter.value === 'closed') {
    return JSON.stringify({
      ...base,
      closed: {
        current_page: chatStore.closedPagings.current_page,
        per_page: chatStore.closedPagings.per_page,
      },
    });
  }

  if (activeFilter.value === 'scheduled') {
    return JSON.stringify({
      ...base,
      scheduled: {
        current_page: chatStore.scheduledPagings.current_page,
        per_page: chatStore.scheduledPagings.per_page,
      },
    });
  }

  return JSON.stringify(base);
};

type LoadAllChatsSection = 'in_chat' | 'queue';

const loadAllChats = async (append = false, section?: LoadAllChatsSection) => {
  const filters = getChatUserFilters();
  const searchTerm = getSearchTerm();

  if (activeFilter.value === 'my_chats') {
    const response = await chatStore.resolveChatEndpoint(
      MY_CHATS_STATUS,
      filters,
      hasAppliedAdvancedFilters.value,
      {
        current_page: currentPageQueue.value,
        per_page: perPageQueue.value,
      },
      append,
      searchTerm
    );

    if (response.counts) {
      applyCounts(response.counts);
    }

    const allChats = [...chatStore.listQueue, ...chatStore.listInChat];
    await Promise.all([
      loadWorkerConfigs(allChats),
      loadChatContacts(allChats),
    ]);
    return;
  }

  if (!append) {
    const response = await chatStore.resolveChatEndpoint(
      [EChatStatus.in_chat, EChatStatus.queue],
      filters,
      hasAppliedAdvancedFilters.value,
      {
        current_page: 1,
        per_page: perPageInChat.value + perPageQueue.value,
      },
      false,
      searchTerm
    );

    if (response.counts) {
      applyCounts(response.counts);
    }

    const allChats = [...chatStore.listQueue, ...chatStore.listInChat];
    await Promise.all([
      loadWorkerConfigs(allChats),
      loadChatContacts(allChats),
    ]);
    return;
  }

  if (section === 'in_chat') {
    const response = await chatStore.resolveChatEndpoint(
      EChatStatus.in_chat,
      filters,
      hasAppliedAdvancedFilters.value,
      {
        current_page: currentPageInChat.value,
        per_page: perPageInChat.value,
      },
      true,
      searchTerm
    );

    if (response.counts) {
      applyCounts(response.counts);
    }

    await Promise.all([
      loadWorkerConfigs(chatStore.listInChat),
      loadChatContacts(chatStore.listInChat),
    ]);
    return;
  }

  if (section === 'queue') {
    const response = await chatStore.resolveChatEndpoint(
      EChatStatus.queue,
      filters,
      hasAppliedAdvancedFilters.value,
      {
        current_page: currentPageQueue.value,
        per_page: perPageQueue.value,
      },
      true,
      searchTerm
    );

    if (response.counts) {
      applyCounts(response.counts);
    }

    await Promise.all([
      loadWorkerConfigs(chatStore.listQueue),
      loadChatContacts(chatStore.listQueue),
    ]);
    return;
  }

  const allChats = [...chatStore.listQueue, ...chatStore.listInChat];
  await Promise.all([loadWorkerConfigs(allChats), loadChatContacts(allChats)]);
};

const loadInChatChats = async (append = false) => {
  const filters = getChatUserFilters();
  const searchTerm = getSearchTerm();

  const response = await chatStore.resolveChatEndpoint(
    EChatStatus.in_chat,
    filters,
    hasAppliedAdvancedFilters.value,
    {
      current_page: currentPageInChat.value,
      per_page: perPageInChat.value,
    },
    append,
    searchTerm
  );

  if (response.counts) {
    applyCounts(response.counts);
  }

  await Promise.all([
    loadWorkerConfigs(chatStore.listInChat),
    loadChatContacts(chatStore.listInChat),
  ]);
};

const loadMyChats = async (append = false) => {
  await loadAllChats(append);
};

const loadQueueChats = async (append = false) => {
  const filters = getChatUserFilters();
  const searchTerm = getSearchTerm();

  const response = await chatStore.resolveChatEndpoint(
    EChatStatus.queue,
    filters,
    hasAppliedAdvancedFilters.value,
    {
      current_page: currentPageQueue.value,
      per_page: perPageQueue.value,
    },
    append,
    searchTerm
  );

  if (response.counts) {
    applyCounts(response.counts);
  }

  await Promise.all([
    loadWorkerConfigs(chatStore.listQueue),
    loadChatContacts(chatStore.listQueue),
  ]);
};

const loadChatsByFilter = async (
  append = false,
  section?: LoadAllChatsSection
) => {
  const loadKey = buildLoadKey(append);
  if (loadKey && inFlightLoadKey === loadKey && inFlightLoadPromise) {
    return inFlightLoadPromise;
  }

  const runLoad = async () => {
    if (activeFilter.value === 'all') {
      await loadAllChats(append, section);
      return;
    }

    if (activeFilter.value === 'in_chat') {
      await loadInChatChats(append);
      return;
    }

    if (activeFilter.value === 'my_chats') {
      await loadMyChats(append);
      return;
    }

    if (activeFilter.value === 'queue') {
      await loadQueueChats(append);
      return;
    }

    if (activeFilter.value === 'chatbot') {
      await loadChatbotChats(append);
      return;
    }
  };

  if (!loadKey) {
    return runLoad();
  }

  inFlightLoadKey = loadKey;
  const nextPromise = runLoad().finally(() => {
    if (inFlightLoadPromise === nextPromise) {
      inFlightLoadPromise = null;
      inFlightLoadKey = null;
    }
  });
  inFlightLoadPromise = nextPromise;
  return nextPromise;
};

const loadContacts = async (append = false) => {
  if (isLoadingMoreContacts.value) return;

  isLoadingMoreContacts.value = true;

  try {
    const filters: any = {};

    if (contactFilterLabel.value)
      filters.filter_label_template_id = contactFilterLabel.value;
    if (contactFilterPhoneDdi.value)
      filters.filter_phone_ddi = contactFilterPhoneDdi.value;
    if (contactFilterPhone.value)
      filters.filter_phone = contactFilterPhone.value;
    if (contactFilterName.value) filters.filter_name = contactFilterName.value;
    if (contactFilterLastName.value)
      filters.filter_last_name = contactFilterLastName.value;
    if (contactFilterNickname.value)
      filters.filter_nickname = contactFilterNickname.value;
    if (contactFilterEmail.value)
      filters.filter_email = contactFilterEmail.value;
    if (contactFilterBirthday.value)
      filters.filter_birthday = contactFilterBirthday.value;
    if (contactFilterDocument.value)
      filters.filter_document = contactFilterDocument.value;
    if (contactFilterUserId.value)
      filters.filter_user_id = contactFilterUserId.value;
    if (contactSortField.value) filters.sort_field = contactSortField.value;
    if (contactSortOrder.value) filters.sort_order = contactSortOrder.value;

    const hasFilters = Object.keys(filters).length > 0;

    const result = await chatStore.listChatContacts(
      currentPageContacts.value,
      perPageContacts.value,
      debouncedContactSearch.value || undefined,
      hasFilters ? filters : undefined
    );

    if (result) {
      if (append) {
        accumulatedContacts.value.push(...result.results);
      } else {
        accumulatedContacts.value = [...result.results];
      }
      contactsTotalPages.value = result.pagings.total_pages;
    }
  } finally {
    isLoadingMoreContacts.value = false;
    await updateScrollbar();
  }
};

const loadChatbotChats = async (append = false) => {
  if (isLoadingChatbot.value) return;

  isLoadingChatbot.value = true;

  try {
    const filters = getChatUserFilters();
    const searchTerm = getSearchTerm();

    const response = await chatStore.resolveChatEndpoint(
      EChatStatus.ura,
      filters,
      hasAppliedAdvancedFilters.value,
      {
        current_page: chatStore.chatbotPagings.current_page,
        per_page: chatStore.chatbotPagings.per_page,
      },
      append,
      searchTerm
    );

    if (response.counts) {
      applyCounts(response.counts);
    }

    const chatsToProcess = append
      ? chatStore.listChatbot.slice(-chatStore.chatbotPagings.per_page)
      : chatStore.listChatbot;
    await Promise.all([
      loadWorkerConfigs(chatsToProcess),
      loadChatContacts(chatsToProcess),
    ]);
  } finally {
    isLoadingChatbot.value = false;
  }
};

const loadClosedChats = async (append = false) => {
  isLoadingClosed.value = true;

  try {
    const filters = getChatUserFilters();
    const searchTerm = getSearchTerm();

    const response = await chatStore.resolveChatEndpoint(
      EChatStatus.closed,
      filters,
      hasAppliedAdvancedFilters.value,
      {
        current_page: chatStore.closedPagings.current_page || 1,
        per_page: 50,
      },
      append,
      searchTerm
    );

    if (response.counts) {
      applyCounts(response.counts);
    }

    listClosed.value = chatStore.listClosed;
    const chatsToProcess = append
      ? chatStore.listClosed.slice(-50)
      : chatStore.listClosed;
    await Promise.all([
      loadWorkerConfigs(chatsToProcess),
      loadChatContacts(chatsToProcess),
    ]);
  } catch (error) {
    console.error('❌ loadClosedChats - Erro:', error);
  } finally {
    isLoadingClosed.value = false;
  }
};

const loadScheduledChats = async (append = false) => {
  if (append && isLoadingMoreScheduled.value) return;
  if (!append && isLoadingScheduled.value) return;

  if (append) {
    isLoadingMoreScheduled.value = true;
  } else {
    isLoadingScheduled.value = true;
  }

  try {
    const filters = getChatUserFilters();
    const searchTerm = getSearchTerm();

    const response = await chatStore.resolveChatEndpoint(
      EChatStatus.ura_schedule,
      filters,
      hasAppliedAdvancedFilters.value,
      {
        current_page: chatStore.scheduledPagings.current_page || 1,
        per_page: 50,
      },
      append,
      searchTerm
    );

    if (response.counts) {
      applyCounts(response.counts);
    }

    const chatsToProcess = append
      ? chatStore.listScheduled.slice(-50)
      : chatStore.listScheduled;
    await Promise.all([
      loadWorkerConfigs(chatsToProcess),
      loadChatContacts(chatsToProcess),
    ]);
  } finally {
    if (append) {
      isLoadingMoreScheduled.value = false;
    } else {
      isLoadingScheduled.value = false;
    }
  }
};

const FILTERED_REALTIME_REFRESH_DEBOUNCE_MS = 350;
let filteredRealtimeRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
let inFlightFilteredRealtimeRefresh: Promise<void> | null = null;

const refreshFilteredChatsForActiveFilter = async (): Promise<void> => {
  if (!hasActiveFilters.value) {
    return;
  }
  if (!isRealtimeFilterType(activeFilter.value)) {
    return;
  }

  if (inFlightFilteredRealtimeRefresh) {
    return inFlightFilteredRealtimeRefresh;
  }

  const runRefresh = async () => {
    try {
      if (
        activeFilter.value === 'all' &&
        debouncedSearchQuery.value?.trim().length
      ) {
        allChatsWithFiltersPagings.value.current_page = 1;
        await performSearch();
        return;
      }

      if (activeFilter.value === 'all' || activeFilter.value === 'my_chats') {
        currentPageQueue.value = 1;
        currentPageInChat.value = 1;
        await loadChatsByFilter();
        return;
      }

      if (activeFilter.value === 'in_chat') {
        currentPageInChat.value = 1;
        await loadChatsByFilter();
        return;
      }

      if (activeFilter.value === 'queue') {
        currentPageQueue.value = 1;
        await loadChatsByFilter();
        return;
      }

      if (activeFilter.value === 'chatbot') {
        chatStore.chatbotPagings.current_page = 1;
        await loadChatbotChats();
        return;
      }

      if (activeFilter.value === 'scheduled') {
        chatStore.scheduledPagings.current_page = 1;
        await loadScheduledChats();
        return;
      }

      if (activeFilter.value === 'closed') {
        chatStore.closedPagings.current_page = 1;
        closedPagings.value.current_page = 1;
        await loadClosedChats();
        listClosed.value = chatStore.listClosed;
      }
    } finally {
      hiddenRealtimeNewChatIds.value.clear();
    }
  };

  const nextPromise = runRefresh().finally(() => {
    if (inFlightFilteredRealtimeRefresh === nextPromise) {
      inFlightFilteredRealtimeRefresh = null;
    }
  });

  inFlightFilteredRealtimeRefresh = nextPromise;
  return nextPromise;
};

const scheduleFilteredRealtimeRefresh = () => {
  if (!hasActiveFilters.value) {
    return;
  }
  if (!isRealtimeFilterType(activeFilter.value)) {
    return;
  }

  if (filteredRealtimeRefreshTimeout) {
    clearTimeout(filteredRealtimeRefreshTimeout);
  }

  filteredRealtimeRefreshTimeout = setTimeout(() => {
    filteredRealtimeRefreshTimeout = null;
    void refreshFilteredChatsForActiveFilter();
  }, FILTERED_REALTIME_REFRESH_DEBOUNCE_MS);
};

const hasMoreContacts = computed(() => {
  return currentPageContacts.value < contactsTotalPages.value;
});

const hasMoreQueue = computed(() => {
  if (activeFilter.value === 'all' && hasActiveFilters.value) {
    return (
      allChatsWithFiltersPagings.value.current_page <
      allChatsWithFiltersPagings.value.total_pages
    );
  }
  return (
    chatStore.queuePagings.current_page < chatStore.queuePagings.total_pages
  );
});

const hasMoreInChat = computed(() => {
  if (activeFilter.value === 'all' && hasActiveFilters.value) {
    return (
      allChatsWithFiltersPagings.value.current_page <
      allChatsWithFiltersPagings.value.total_pages
    );
  }
  return (
    chatStore.inChatPagings.current_page < chatStore.inChatPagings.total_pages
  );
});

const handleContactScroll = (e: Event) => {
  const target = e.target as HTMLElement;
  if (!target) return;

  const scrollContainer = target.closest('.ps') as HTMLElement;
  if (!scrollContainer) return;

  const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
  const threshold = 100;

  if (
    scrollTop + clientHeight >= scrollHeight - threshold &&
    hasMoreContacts.value &&
    !isLoadingMoreContacts.value
  ) {
    currentPageContacts.value += 1;
    loadContacts(true);
  }
};

const handleChatScroll = async (event?: Event) => {
  let scrollContainer: HTMLElement | null = null;

  if (event?.target) {
    const targetEl = event.target as HTMLElement;
    scrollContainer =
      (targetEl.closest('.ps') as HTMLElement) ||
      (targetEl.closest('.ps__container') as HTMLElement) ||
      targetEl;
  }

  if (!scrollContainer && chatScrollContainer.value) {
    const psElement = chatScrollContainer.value.$el as HTMLElement;
    scrollContainer =
      (psElement.querySelector('.ps') as HTMLElement) ||
      (psElement.querySelector('.ps__container') as HTMLElement) ||
      psElement;
  }

  if (!scrollContainer) return;

  const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
  const threshold = 100;

  if (activeFilter.value === 'all' || activeFilter.value === 'my_chats') {
    if (
      scrollTop + clientHeight >= scrollHeight - threshold &&
      !isLoadingMoreQueue.value &&
      !isLoadingMoreInChat.value &&
      !chatStore.loadingChats &&
      !isLoadingAllChatsWithFilters.value
    ) {
      if (activeFilter.value === 'all' && hasActiveFilters.value) {
        if (searchQuery.value && searchQuery.value.trim().length > 0) {
          const hasMore = hasMoreQueue.value || hasMoreInChat.value;
          if (hasMore) {
            isLoadingMoreQueue.value = true;
            isLoadingMoreInChat.value = true;
            allChatsWithFiltersPagings.value.current_page += 1;
            await performSearch(true);
            isLoadingMoreQueue.value = false;
            isLoadingMoreInChat.value = false;
            await updateScrollbar();
          }
          return;
        }

        const shouldLoadQueue = hasMoreQueue.value;
        const shouldLoadInChat = hasMoreInChat.value;
        const queueSectionOffsetTop = inChatSectionRef.value?.offsetTop ?? 0;
        const scrolledPastInChat =
          scrollTop >= queueSectionOffsetTop - threshold;

        if (scrolledPastInChat && shouldLoadQueue) {
          isLoadingMoreQueue.value = true;
          currentPageQueue.value += 1;
          await loadChatsByFilter(true, 'queue');
          isLoadingMoreQueue.value = false;
          await updateScrollbar();
          return;
        }

        if (!scrolledPastInChat && shouldLoadInChat) {
          isLoadingMoreInChat.value = true;
          currentPageInChat.value += 1;
          await loadChatsByFilter(true, 'in_chat');
          isLoadingMoreInChat.value = false;
          await updateScrollbar();
        }
        return;
      }

      if (activeFilter.value === 'my_chats' && hasActiveFilters.value) {
        const hasMore = hasMoreQueue.value || hasMoreInChat.value;
        if (hasMore) {
          isLoadingMoreQueue.value = true;
          isLoadingMoreInChat.value = true;
          currentPageQueue.value += 1;

          await loadChatsByFilter(true);

          isLoadingMoreQueue.value = false;
          isLoadingMoreInChat.value = false;
          await updateScrollbar();
        }
        return;
      }

      const shouldLoadQueue = hasMoreQueue.value;
      const shouldLoadInChat = hasMoreInChat.value;

      const queueSectionOffsetTop = inChatSectionRef.value?.offsetTop ?? 0;
      const scrolledPastInChat = scrollTop >= queueSectionOffsetTop - threshold;

      if (scrolledPastInChat && shouldLoadQueue) {
        isLoadingMoreQueue.value = true;
        currentPageQueue.value += 1;
        await loadChatsByFilter(true, 'queue');
        isLoadingMoreQueue.value = false;
        await updateScrollbar();
        return;
      }

      if (!scrolledPastInChat && shouldLoadInChat) {
        isLoadingMoreInChat.value = true;
        currentPageInChat.value += 1;
        await loadChatsByFilter(true, 'in_chat');
        isLoadingMoreInChat.value = false;
        await updateScrollbar();
      }
    }
    return;
  }

  if (activeFilter.value === 'in_chat') {
    if (
      scrollTop + clientHeight >= scrollHeight - threshold &&
      hasMoreInChat.value &&
      !isLoadingMoreInChat.value &&
      !chatStore.loadingChats
    ) {
      isLoadingMoreInChat.value = true;
      currentPageInChat.value += 1;
      await loadChatsByFilter(true);
      isLoadingMoreInChat.value = false;
      await updateScrollbar();
    }
    return;
  }

  if (activeFilter.value === 'queue') {
    if (
      scrollTop + clientHeight >= scrollHeight - threshold &&
      hasMoreQueue.value &&
      !isLoadingMoreQueue.value &&
      !chatStore.loadingChats
    ) {
      isLoadingMoreQueue.value = true;
      currentPageQueue.value += 1;
      await loadChatsByFilter(true);
      isLoadingMoreQueue.value = false;
      await updateScrollbar();
    }
    return;
  }

  if (activeFilter.value === 'chatbot') {
    if (
      scrollTop + clientHeight >= scrollHeight - threshold &&
      chatStore.chatbotPagings.current_page <
        chatStore.chatbotPagings.total_pages &&
      !isLoadingChatbot.value
    ) {
      isLoadingMoreChatbot.value = true;
      chatStore.chatbotPagings.current_page += 1;
      try {
        await loadChatbotChats(true);
        await updateScrollbar();
      } finally {
        isLoadingMoreChatbot.value = false;
      }
    }
    return;
  }

  if (activeFilter.value === 'scheduled') {
    if (
      scrollTop + clientHeight >= scrollHeight - threshold &&
      chatStore.scheduledPagings.current_page <
        chatStore.scheduledPagings.total_pages &&
      !isLoadingScheduled.value &&
      !isLoadingMoreScheduled.value
    ) {
      chatStore.scheduledPagings.current_page += 1;
      await loadScheduledChats(true);
      await updateScrollbar();
    }
    return;
  }

  if (activeFilter.value === 'closed') {
    return;
  }
};

const handleClosedScroll = async (event?: Event) => {
  if (activeFilter.value !== 'closed') {
    return;
  }

  let scrollContainer: HTMLElement | null = null;

  if (event?.target) {
    const targetEl = event.target as HTMLElement;
    scrollContainer =
      (targetEl.closest('.ps') as HTMLElement) ||
      (targetEl.closest('.ps__container') as HTMLElement) ||
      targetEl;
  }

  if (!scrollContainer && chatScrollContainer.value) {
    const psElement = chatScrollContainer.value.$el as HTMLElement;
    scrollContainer =
      (psElement.querySelector('.ps') as HTMLElement) ||
      (psElement.querySelector('.ps__container') as HTMLElement) ||
      psElement;
  }

  if (!scrollContainer) {
    return;
  }

  const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
  const threshold = 100;

  const hasMore =
    chatStore.closedPagings.current_page < chatStore.closedPagings.total_pages;

  if (
    scrollTop + clientHeight >= scrollHeight - threshold &&
    hasMore &&
    !isLoadingClosed.value
  ) {
    isLoadingClosed.value = true;
    chatStore.closedPagings.current_page += 1;
    await loadClosedChats(true);
    isLoadingClosed.value = false;
    await updateScrollbar();
  }
};

const handleClosedReachEnd = async () => {
  if (activeFilter.value !== 'closed') {
    return;
  }
  if (isLoadingClosed.value) {
    return;
  }

  const hasMore =
    chatStore.closedPagings.current_page < chatStore.closedPagings.total_pages;

  if (!hasMore) {
    return;
  }

  isLoadingClosed.value = true;
  chatStore.closedPagings.current_page += 1;

  await loadClosedChats(true);

  isLoadingClosed.value = false;
  await updateScrollbar();
};

const handleScheduledReachEnd = async () => {
  if (activeFilter.value !== 'scheduled') {
    return;
  }
  if (isLoadingScheduled.value || isLoadingMoreScheduled.value) {
    return;
  }

  const hasMore =
    chatStore.scheduledPagings.current_page <
    chatStore.scheduledPagings.total_pages;

  if (!hasMore) {
    return;
  }

  chatStore.scheduledPagings.current_page += 1;
  await loadScheduledChats(true);
  await updateScrollbar();
};

const buildBulkActionBasePayload = (): Omit<
  BulkActionChatRequest,
  | 'action'
  | 'selection_mode'
  | 'chat_ids'
  | 'category'
  | 'transfer_payload'
  | 'close_payload'
> => {
  return {
    search: getSearchTerm(),
    has_applied_advanced_filters: hasAppliedAdvancedFilters.value,
    filter_label_template_id: currentFilterLabelTemplateId.value,
    filter_worker_id: currentFilterWorkerId.value,
    filter_user_id: currentFilterUserId.value,
    filter_sector_id: currentFilterSectorId.value,
    filter_name: currentFilterName.value,
    filter_phone: normalizePhoneFilterValue(currentFilterPhone.value) ?? null,
    filter_protocol: currentFilterProtocol.value,
    filter_date_start: currentFilterDateStart.value,
    filter_date_end: currentFilterDateEnd.value,
    filter_unread_conversations: currentFilterUnreadConversations.value,
    sort_field: currentSortField.value,
    sort_order: currentSortOrder.value,
  };
};

const buildBulkSelectionPayload = ():
  | Pick<BulkActionChatRequest, 'selection_mode' | 'chat_ids'>
  | Pick<BulkActionChatRequest, 'selection_mode' | 'category'> => {
  if (bulkSelectAllFiltered.value) {
    const category = resolveBulkCategory();
    if (!category) {
      return {
        selection_mode: 'selected',
        chat_ids: [],
      };
    }

    return {
      selection_mode: 'filtered',
      category,
    };
  }

  return {
    selection_mode: 'selected',
    chat_ids: Array.from(bulkSelectedChatIds.value),
  };
};

const refreshChatsForCurrentFilter = async () => {
  if (debouncedSearchQuery.value?.trim().length) {
    await performSearch();
    return;
  }

  if (
    activeFilter.value === 'all' ||
    activeFilter.value === 'in_chat' ||
    activeFilter.value === 'queue' ||
    activeFilter.value === 'my_chats'
  ) {
    currentPageQueue.value = 1;
    currentPageInChat.value = 1;
    await loadChatsByFilter();
    return;
  }

  if (activeFilter.value === 'chatbot') {
    chatStore.chatbotPagings.current_page = 1;
    await loadChatbotChats();
    return;
  }

  if (activeFilter.value === 'scheduled') {
    chatStore.scheduledPagings.current_page = 1;
    await loadScheduledChats();
  }
};

const openBulkTransferDialog = () => {
  if (!hasBulkSelection.value) {
    chatStore.showSnackbar(
      chatStore.i18n.global.t('bulk_no_selection'),
      EColor.warning
    );
    return;
  }

  isBulkTransferDialogOpen.value = true;
};

const openBulkCloseDialog = () => {
  if (!hasBulkSelection.value) {
    chatStore.showSnackbar(
      chatStore.i18n.global.t('bulk_no_selection'),
      EColor.warning
    );
    return;
  }

  bulkCloseSendMessageOnFinishAttendance.value = false;
  isBulkCloseDialogOpen.value = true;
};

const runBulkTransferAction = async () => {
  if (!hasBulkSelection.value) {
    chatStore.showSnackbar(
      chatStore.i18n.global.t('bulk_no_selection'),
      EColor.warning
    );
    return;
  }

  if (!bulkTransferChannel.value) {
    chatStore.showSnackbar(
      chatStore.i18n.global.t('channel_required'),
      EColor.error
    );
    return;
  }

  if (bulkTransferType.value === 'user' && !bulkTransferUser.value) {
    chatStore.showSnackbar(
      chatStore.i18n.global.t('user_required'),
      EColor.error
    );
    return;
  }

  if (bulkTransferType.value === 'sector' && !bulkTransferSector.value) {
    chatStore.showSnackbar(
      chatStore.i18n.global.t('sector_required'),
      EColor.error
    );
    return;
  }

  const selectedUserId =
    bulkTransferType.value === 'user'
      ? bulkTransferUser.value
      : bulkTransferType.value === 'sector'
        ? bulkTransferSectorUser.value || null
        : null;

  const selectedSectorId =
    bulkTransferType.value === 'sector' ? bulkTransferSector.value : null;

  const payload: BulkActionChatRequest = {
    action: 'transfer',
    ...buildBulkSelectionPayload(),
    ...buildBulkActionBasePayload(),
    transfer_payload: {
      worker_id: bulkTransferChannel.value,
      user_id: selectedUserId ?? undefined,
      sector_id: selectedSectorId ?? undefined,
      annotation: bulkTransferAnnotation.value.trim() || undefined,
      keep_in_chat: bulkTransferKeepInChat.value,
      send_message_on_transfer: shouldShowBulkTransferSendMessageToggle.value
        ? bulkTransferSendMessageOnTransfer.value
        : undefined,
    },
  };

  isBulkActionRunning.value = true;

  try {
    const result = await chatStore.bulkActionChats(payload);
    if (!result) {
      return;
    }

    bulkSummary.value = result;
    isBulkSummaryDialogOpen.value = true;
    isBulkTransferDialogOpen.value = false;
    disableBulkMode();
    await refreshChatsForCurrentFilter();
  } finally {
    isBulkActionRunning.value = false;
  }
};

const runBulkCloseAction = async () => {
  if (!hasBulkSelection.value) {
    chatStore.showSnackbar(
      chatStore.i18n.global.t('bulk_no_selection'),
      EColor.warning
    );
    return;
  }

  const payload: BulkActionChatRequest = {
    action: 'close',
    ...buildBulkSelectionPayload(),
    ...buildBulkActionBasePayload(),
    close_payload: {
      send_message_on_finish_attendance:
        bulkCloseSendMessageOnFinishAttendance.value,
    },
  };

  isBulkActionRunning.value = true;

  try {
    const result = await chatStore.bulkActionChats(payload);
    if (!result) {
      return;
    }

    bulkSummary.value = result;
    isBulkSummaryDialogOpen.value = true;
    isBulkCloseDialogOpen.value = false;
    disableBulkMode();
    await refreshChatsForCurrentFilter();
  } finally {
    isBulkActionRunning.value = false;
  }
};

const handleAddContactModalClose = (isOpen: boolean) => {
  if (!isOpen) {
    currentPageContacts.value = 1;
    accumulatedContacts.value = [];
    loadContacts();
  }
};

const handleValidateContact = (contactId: string, event: Event) => {
  event.stopPropagation();
  contactToValidate.value = contactId;
  validatingContactId.value = contactId;
  isValidateContactDialogOpen.value = true;
};

const handleCancelValidateContact = () => {
  validatingContactId.value = null;
  contactToValidate.value = null;
};

const confirmValidateContact = async () => {
  if (!contactToValidate.value) return;

  const result = await chatStore.validateChatContact(contactToValidate.value);

  if (result) {
    const contactIndex = accumulatedContacts.value.findIndex(
      (c) => c.contact_id === contactToValidate.value
    );
    if (contactIndex !== -1) {
      accumulatedContacts.value[contactIndex] = {
        ...accumulatedContacts.value[contactIndex],
        is_valided: true,
        validation_status: CONTACT_VALIDATION_STATUSES.validated,
      };
    }
  }

  contactToValidate.value = null;
  validatingContactId.value = null;
};

const handleEditContact = (contactId: string, event: Event) => {
  event.stopPropagation();
  editContactId.value = contactId;
  editingContactId.value = contactId;
  isEditContactModalOpen.value = true;
};

const handleEditContactModalClose = (isOpen: boolean) => {
  if (!isOpen) {
    editContactId.value = null;
    editingContactId.value = null;
    currentPageContacts.value = 1;
    accumulatedContacts.value = [];

    loadContacts();
  }
};

watch(debouncedContactSearch, () => {
  currentPageContacts.value = 1;
  accumulatedContacts.value = [];
  loadContacts();
});

const handleContactFiltersUpdated = async () => {
  currentPageContacts.value = 1;
  accumulatedContacts.value = [];
  await loadContacts();
};

const handleClearContactFilters = async () => {
  contactSearchQuery.value = '';
  contactFilterLabel.value = null;
  contactFilterPhoneDdi.value = null;
  contactFilterPhone.value = null;
  contactFilterName.value = null;
  contactFilterLastName.value = null;
  contactFilterNickname.value = null;
  contactFilterEmail.value = null;
  contactFilterBirthday.value = null;
  contactFilterDocument.value = null;
  contactFilterUserId.value = null;
  contactSortField.value = 'name';
  contactSortOrder.value = 'asc';
  currentPageContacts.value = 1;
  accumulatedContacts.value = [];
  await loadContacts();
};

const hasActiveContactFilters = computed(() => {
  return !!(
    contactFilterLabel.value ||
    contactFilterPhoneDdi.value ||
    contactFilterPhone.value ||
    contactFilterName.value ||
    contactFilterLastName.value ||
    contactFilterNickname.value ||
    contactFilterEmail.value ||
    contactFilterBirthday.value ||
    contactFilterDocument.value ||
    contactFilterUserId.value
  );
});

const performSearch = async (append = false) => {
  if (
    !debouncedSearchQuery.value ||
    debouncedSearchQuery.value.trim().length === 0
  ) {
    searchResults.value = [];
    searchPagings.value = {
      current_page: 1,
      total_pages: 1,
      per_page: 20,
      count: 0,
      total: 0,
    };

    if (activeFilter.value === 'all') {
      allChatsWithFiltersPagings.value.current_page = 1;
      await loadChatsByFilter();
    }
    return;
  }

  if (activeFilter.value !== 'all' && !append) {
    activeFilter.value = 'all';
  }

  isSearching.value = true;
  isLoadingAllChatsWithFilters.value = true;

  try {
    const filters = getChatUserFilters();
    const statusSnapshotFence = chatStore.captureChatStatusSnapshotFence();
    const currentPage = append
      ? allChatsWithFiltersPagings.value.current_page
      : 1;

    const request: SearchChatsQuery = {
      current_page: currentPage,
      per_page: 50,
      search: getSearchTerm(),
      filter_label_template_id: filters.filter_label_template_id,
      filter_worker_id: filters.filter_worker_id,
      filter_user_id: filters.filter_user_id,
      filter_sector_id: filters.filter_sector_id,
      filter_name: filters.filter_name,
      filter_phone: filters.filter_phone,
      filter_protocol: filters.filter_protocol,
      filter_date_start: filters.filter_date_start,
      filter_date_end: filters.filter_date_end,
      filter_unread_conversations: filters.filter_unread_conversations,
      sort_field: filters.sort_field,
      sort_order: filters.sort_order,
    };

    const result = await chatStore.searchChats(request);

    if (result) {
      if (append) {
        searchResults.value = [...searchResults.value, ...result.results];
      } else {
        searchResults.value = result.results;
      }
      searchPagings.value = result.pagings;
      allChatsWithFiltersPagings.value = result.pagings;

      if (result.counts) {
        searchChatsCounts.value = result.counts;
      }

      chatStore.updateListsByStatus(
        [
          EChatStatus.queue,
          EChatStatus.in_chat,
          EChatStatus.ura,
          EChatStatus.ura_schedule,
          EChatStatus.closed,
        ],
        result.results,
        append,
        statusSnapshotFence
      );
      listClosed.value = [...chatStore.listClosed];

      chatStore.queuePagings = {
        current_page: allChatsWithFiltersPagings.value.current_page,
        total_pages: allChatsWithFiltersPagings.value.total_pages,
        per_page: allChatsWithFiltersPagings.value.per_page,
        count: chatStore.listQueue.length,
        total: chatStore.listQueue.length,
      };

      chatStore.inChatPagings = {
        current_page: allChatsWithFiltersPagings.value.current_page,
        total_pages: allChatsWithFiltersPagings.value.total_pages,
        per_page: allChatsWithFiltersPagings.value.per_page,
        count: chatStore.listInChat.length,
        total: chatStore.listInChat.length,
      };

      chatStore.chatbotPagings = {
        current_page: allChatsWithFiltersPagings.value.current_page,
        total_pages: allChatsWithFiltersPagings.value.total_pages,
        per_page: allChatsWithFiltersPagings.value.per_page,
        count: chatStore.listChatbot.length,
        total: chatStore.listChatbot.length,
      };

      chatStore.scheduledPagings = {
        current_page: allChatsWithFiltersPagings.value.current_page,
        total_pages: allChatsWithFiltersPagings.value.total_pages,
        per_page: allChatsWithFiltersPagings.value.per_page,
        count: chatStore.listScheduled.length,
        total: chatStore.listScheduled.length,
      };

      closedPagings.value = {
        current_page: allChatsWithFiltersPagings.value.current_page,
        total_pages: allChatsWithFiltersPagings.value.total_pages,
        per_page: allChatsWithFiltersPagings.value.per_page,
        count: listClosed.value.length,
        total: listClosed.value.length,
      };

      const chatsToProcess = append
        ? result.results
        : [
            ...chatStore.listQueue,
            ...chatStore.listInChat,
            ...chatStore.listChatbot,
            ...chatStore.listScheduled,
            ...listClosed.value,
          ];

      await Promise.all([
        loadWorkerConfigs(chatsToProcess),
        loadChatContacts(chatsToProcess),
      ]);
    } else {
      searchResults.value = [];
      searchPagings.value = {
        current_page: 1,
        total_pages: 1,
        per_page: 20,
        count: 0,
        total: 0,
      };
      if (!append) {
        chatStore.listQueue = [];
        chatStore.listInChat = [];
        chatStore.listChatbot = [];
        chatStore.listScheduled = [];
        listClosed.value = [];
        chatStore.listClosed = [];
        searchChatsCounts.value = null;
      }
    }
  } catch {
    searchResults.value = [];
    if (!append) {
      chatStore.listQueue = [];
      chatStore.listInChat = [];
      chatStore.listChatbot = [];
      chatStore.listScheduled = [];
      listClosed.value = [];
      chatStore.listClosed = [];
      searchChatsCounts.value = null;
    }
  } finally {
    isSearching.value = false;
    isLoadingAllChatsWithFilters.value = false;
  }
};

let hasInitializedSearchWatcher = false;
watch(searchQuery, (newValue) => {
  const normalizedValue = normalizeSearchTermForRequest(newValue);
  if (normalizedValue && normalizedValue !== newValue?.trim()) {
    searchQuery.value = normalizedValue;
  }
});

watch(debouncedSearchQuery, (newValue) => {
  if (!hasInitializedSearchWatcher) {
    hasInitializedSearchWatcher = true;
    if (!newValue || newValue.trim().length === 0) {
      return;
    }
  }

  performSearch();
});

watch(
  () => false,
  (hasAccess) => {
    if (!hasAccess && activeFilter.value === 'new') {
      activeFilter.value = 'all';
      expandedFilter.value = 'all';
      loadChatsByFilter();
    }
  }
);

const loadTransferOptions = async () => {
  if (!chatStore.user?.account_id) return;

  availableWorkers.value = [];
  availableSectors.value = [];

  try {
    const result = await chatStore.listTransferOptions();
    if (result) {
      availableWorkers.value = result.workers;
      availableSectors.value = result.sectors;
    }
  } catch (error) {
    console.error('Error loading transfer options:', error);
  }
};

let workerConfigRequestSequence = 0;

const loadWorkerConfigForSelectedWorker = async () => {
  const workerId = selectedWorkerId.value;
  const requestId = ++workerConfigRequestSequence;
  workerConfigForChat.value = null;

  if (!workerId) {
    isLoadingWorkerConfigForChat.value = false;
    return;
  }

  isLoadingWorkerConfigForChat.value = true;

  try {
    const config = await channelsStore.fetchWorkerConfigForChat(workerId);
    if (
      requestId !== workerConfigRequestSequence ||
      selectedWorkerId.value !== workerId
    ) {
      return;
    }
    workerConfigForChat.value = config;
  } catch (error) {
    if (
      requestId !== workerConfigRequestSequence ||
      selectedWorkerId.value !== workerId
    ) {
      return;
    }
    console.error('Error loading worker config:', error);
    workerConfigForChat.value = null;
  } finally {
    if (
      requestId === workerConfigRequestSequence &&
      selectedWorkerId.value === workerId
    ) {
      isLoadingWorkerConfigForChat.value = false;
    }
  }
};

watch(selectedWorkerId, () => {
  loadWorkerConfigForSelectedWorker().catch(() => {});
});

const resetOfficialOpeningState = () => {
  resetOfficialOpeningContext();
  selectedOfficialTemplateKey.value = null;
  officialTemplateVariableValues.value = {};
  manualOfficialTemplateVariables.value = [];
};

const loadOfficialOpeningContext = async () => {
  if (
    !isSelectedWorkerOfficial.value ||
    !selectedWorkerId.value ||
    !selectedContactForChat.value?.contact_id
  ) {
    resetOfficialOpeningState();
    return;
  }

  await loadOfficialOpeningContextForIdentity({
    workerId: selectedWorkerId.value,
    contactId: selectedContactForChat.value.contact_id,
  });
};

watch(selectedWorkerId, () => {
  selectedOfficialTemplateKey.value = null;
  officialTemplateVariableValues.value = {};
  manualOfficialTemplateVariables.value = [];
  selectedSectorId.value = null;
  loadOfficialOpeningContext().catch(() => {});
});

watch(selectedOfficialTemplateKey, () => {
  officialTemplateVariableValues.value =
    createOfficialTemplateVariableValueRecord(
      selectedOfficialTemplate.value?.variables
    );
  manualOfficialTemplateVariables.value = [];
  selectedSectorId.value = null;
});

const userStatus = computed(
  () =>
    (chatStore.user?.chat_user?.status as EChatUserStatus | undefined) ||
    EChatUserStatus.offline
);

const cannotOpenConversation = computed(() => {
  if (!workerConfigForChat.value?.allow_attendance_only_online) return false;
  return userStatus.value !== EChatUserStatus.online;
});

const handleContactClick = async (contact: ListChatContactsResponse) => {
  if (!contact.phone_partial) {
    chatStore.showSnackbar(
      chatStore.i18n.global.t('contact_phone_required'),
      EColor.warning
    );
    return;
  }

  selectedContactForChat.value = contact;
  selectedWorkerId.value = null;
  selectedSectorId.value = null;
  resetOfficialOpeningState();

  await loadTransferOptions();
  if (!contact.is_valided && !hasOfficialWorkerAvailable.value) {
    selectedContactForChat.value = null;
    chatStore.showSnackbar(
      chatStore.i18n.global.t('contact_must_be_validated'),
      EColor.warning
    );
    return;
  }

  if (availableWorkers.value.length === 1) {
    selectedWorkerId.value = availableWorkers.value[0]?.id ?? null;
  }

  isSelectChannelSectorModalOpen.value = true;
};

const handleOpenConversation = async () => {
  if (isOpeningConversation.value || isLoadingWorkerConfigForChat.value) {
    return;
  }

  if (!selectedContactForChat.value || !selectedWorkerId.value) {
    chatStore.showSnackbar(
      chatStore.i18n.global.t('select_channel_required'),
      EColor.warning
    );
    return;
  }

  if (!selectedContactForChat.value.contact_id) {
    chatStore.showSnackbar(
      chatStore.i18n.global.t('contact_not_found'),
      EColor.error
    );
    return;
  }

  if (
    !selectedContactForChat.value.is_valided &&
    !isSelectedWorkerOfficial.value
  ) {
    chatStore.showSnackbar(
      chatStore.i18n.global.t('contact_must_be_validated'),
      EColor.warning
    );
    return;
  }

  if (isSelectedWorkerOfficial.value && !isOfficialOpeningReady.value) {
    chatStore.showSnackbar(
      chatStore.i18n.global.t(
        isOfficialSendUncertain.value
          ? 'official_window_uncertain_description'
          : isAwaitingOfficialContactReply.value
            ? 'official_window_awaiting_description'
            : 'official_template_required_for_opening'
      ),
      EColor.warning
    );
    return;
  }

  const officialTemplatePayload =
    requiresOfficialTemplate.value && selectedOfficialTemplate.value
      ? {
          name: selectedOfficialTemplate.value.name,
          language: selectedOfficialTemplate.value.language,
          variables: officialTemplateSelectedVariableValues.value,
        }
      : null;

  const openingContactId = selectedContactForChat.value.contact_id;
  const openingWorkerId = selectedWorkerId.value;
  const openingSectorId = selectedSectorId.value;
  isOpeningConversation.value = true;

  try {
    const chat = await chatStore.startChatWithContact(
      openingContactId,
      openingWorkerId,
      openingSectorId,
      officialTemplatePayload
    );

    if (!chat) {
      return;
    }

    if (
      selectedContactForChat.value?.contact_id !== openingContactId ||
      selectedWorkerId.value !== openingWorkerId
    ) {
      return;
    }

    const contactIndex = accumulatedContacts.value.findIndex(
      (contact) =>
        contact.contact_id === selectedContactForChat.value?.contact_id
    );
    if (contactIndex >= 0) {
      const currentContact = accumulatedContacts.value[contactIndex];
      accumulatedContacts.value[contactIndex] = {
        ...currentContact,
        is_valided: true,
        validation_status: currentContact.is_valided
          ? currentContact.validation_status
          : CONTACT_VALIDATION_STATUSES.officialOnly,
      };
    }

    isSelectChannelSectorModalOpen.value = false;
    selectedContactForChat.value = null;
    selectedWorkerId.value = null;
    selectedSectorId.value = null;
    resetOfficialOpeningState();

    activeFilter.value = 'in_chat';
    expandedFilter.value = 'in_chat';
    await loadChatsByFilter();

    emit('openChat', chat.chat_id, {
      skipClearSummary: true,
      fallbackChat: chat,
    });
  } catch (error: unknown) {
    if (isOfficialWindowRefreshConflict(error)) {
      selectedOfficialTemplateKey.value = null;
      officialTemplateVariableValues.value = {};
      manualOfficialTemplateVariables.value = [];
      await refreshOfficialOpeningContext();
      chatStore.showSnackbar(
        t('official_opening_window_changed'),
        EColor.warning
      );
      return;
    }
    console.error('Error starting chat with contact:', error);
  } finally {
    isOpeningConversation.value = false;
  }
};

const handleCancelSelectChannelSector = () => {
  if (isOpeningConversation.value) {
    return;
  }

  isSelectChannelSectorModalOpen.value = false;
  selectedContactForChat.value = null;
  selectedWorkerId.value = null;
  selectedSectorId.value = null;
  resetOfficialOpeningState();
};

watch(
  () => chatStore.activeChat?.status,
  (newStatus, oldStatus) => {
    if (newStatus === EChatStatus.in_chat) {
      if (
        (oldStatus === EChatStatus.ura ||
          oldStatus === EChatStatus.ura_output ||
          oldStatus === EChatStatus.ura_webhook) &&
        activeFilter.value === 'chatbot'
      ) {
        activeFilter.value = 'in_chat';
        expandedFilter.value = 'in_chat';
      } else if (
        oldStatus === EChatStatus.ura_schedule &&
        activeFilter.value === 'scheduled'
      ) {
        activeFilter.value = 'in_chat';
        expandedFilter.value = 'in_chat';
      } else if (
        oldStatus === EChatStatus.queue &&
        (activeFilter.value === 'queue' || activeFilter.value === 'all')
      ) {
        if (activeFilter.value === 'queue') {
          activeFilter.value = 'in_chat';
          expandedFilter.value = 'in_chat';
        }
      } else if (
        oldStatus === EChatStatus.closed &&
        activeFilter.value === 'closed'
      ) {
        activeFilter.value = 'in_chat';
        expandedFilter.value = 'in_chat';
      }
    } else if (
      newStatus === EChatStatus.queue &&
      (oldStatus === EChatStatus.ura ||
        oldStatus === EChatStatus.ura_output ||
        oldStatus === EChatStatus.ura_webhook) &&
      activeFilter.value === 'chatbot'
    ) {
      activeFilter.value = 'queue';
      expandedFilter.value = 'queue';
    } else if (
      newStatus === EChatStatus.queue &&
      oldStatus === EChatStatus.ura_schedule &&
      activeFilter.value === 'scheduled'
    ) {
      activeFilter.value = 'queue';
      expandedFilter.value = 'queue';
    }
  }
);

let isHandlingChatStatusChanged = false;
let chatStatusChangedTimeout: ReturnType<typeof setTimeout> | null = null;
const pendingRealtimeChats = new Map<string, ChatExtrasSource>();

const handleChatStatusChanged = async (event: Event) => {
  const detail = (event as CustomEvent<ChatStatusChangedDetail>).detail;
  const reason = detail?.reason ?? 'update';
  if (!detail?.chat || (reason !== 'new' && reason !== 'update')) {
    return;
  }

  if (detail.chat?.chat_id) {
    const incomingChatId = detail.chat.chat_id;
    pendingRealtimeChats.set(incomingChatId, detail.chat);

    if (
      reason === 'new' &&
      isRealtimeFilterType(activeFilter.value) &&
      hasActiveFilters.value &&
      chatStore.activeChat?.chat_id !== incomingChatId
    ) {
      hiddenRealtimeNewChatIds.value.add(incomingChatId);
    }
  }

  if (isHandlingChatStatusChanged) {
    return;
  }

  if (chatStatusChangedTimeout) {
    clearTimeout(chatStatusChangedTimeout);
    chatStatusChangedTimeout = null;
  }

  isHandlingChatStatusChanged = true;

  chatStatusChangedTimeout = setTimeout(async () => {
    try {
      const chatsToLoad = Array.from(pendingRealtimeChats.values());
      pendingRealtimeChats.clear();

      if (chatsToLoad.length === 0) {
        return;
      }

      await Promise.all([
        loadWorkerConfigs(chatsToLoad),
        loadChatContacts(chatsToLoad),
      ]);

      scheduleFilteredRealtimeRefresh();
    } finally {
      isHandlingChatStatusChanged = false;
      chatStatusChangedTimeout = null;
    }
  }, 100);
};

const loadNotificationSettings = async () => {
  loadingNotificationSettings.value = true;
  try {
    const settings = await chatStore.viewNotificationSettings();
    notificationSettings.value = settings ?? notificationSettings.value;
  } finally {
    loadingNotificationSettings.value = false;
  }
};

const openNotificationSettingsDialog = async () => {
  isNotificationSettingsDialogOpen.value = true;

  if (!notificationSettings.value) {
    await loadNotificationSettings();
  }
};

const saveNotificationSettings = async (
  input: ChatNotificationSettingsRequest
) => {
  savingNotificationSettings.value = true;
  try {
    const settings = await chatStore.updateNotificationSettings(input);
    if (settings) {
      notificationSettings.value = settings;
      isNotificationSettingsDialogOpen.value = false;
    }
  } finally {
    savingNotificationSettings.value = false;
  }
};

onMounted(async () => {
  await Promise.all([chatStore.loadPinnedChats(), loadChatsByFilter()]);

  globalThis.addEventListener('chat-status-changed', handleChatStatusChanged);
});

onUnmounted(() => {
  hiddenRealtimeNewChatIds.value.clear();

  if (chatStatusChangedTimeout) {
    clearTimeout(chatStatusChangedTimeout);
    chatStatusChangedTimeout = null;
  }
  if (filteredRealtimeRefreshTimeout) {
    clearTimeout(filteredRealtimeRefreshTimeout);
    filteredRealtimeRefreshTimeout = null;
  }

  globalThis.removeEventListener(
    'chat-status-changed',
    handleChatStatusChanged
  );
});

const scrollToTop = () => {
  if (chatScrollContainer.value) {
    const psElement = chatScrollContainer.value.$el as HTMLElement;
    if (psElement) {
      psElement.scrollTop = 0;
    }
  }
};

defineExpose({
  handleClearFilters,
  clearAdvancedFilters,
  scrollToTop,
  hasAppliedAdvancedFilters,
});
</script>

<template>
  <div class="chat-list-header px-3 py-3">
    <div class="chat-section-label mb-3">
      <div class="d-flex align-center gap-2 min-w-0">
        <VIcon size="19" color="primary">tabler-messages</VIcon>
        <span class="chat-section-label-title">{{ $t('chat') }}</span>
      </div>

      <IconBtn
        class="chat-section-label-action"
        :disabled="loadingNotificationSettings"
        @click="openNotificationSettingsDialog"
      >
        <VIcon size="20" icon="tabler-bell" />
        <VTooltip activator="parent" location="bottom">
          {{ $t('notifications') }}
        </VTooltip>
      </IconBtn>
    </div>

    <div class="d-flex align-center gap-2 w-100">
      <VBadge
        dot
        location="bottom right"
        offset-x="3"
        offset-y="3"
        bordered
        :color="
          resolveAvatarBadgeVariant(
            chatStore.user?.chat_user?.status as EChatUserStatus,
            global.name.value === 'dark'
          )
        "
        class="cursor-pointer"
      >
        <VAvatar
          size="40"
          :variant="!chatStore.user?.info.photo ? 'tonal' : undefined"
          :color="
            !chatStore.user?.info.photo
              ? resolveAvatarBadgeVariant(
                  chatStore.user?.chat_user?.status as EChatUserStatus
                )
              : undefined
          "
          @click="$emit('showUserProfile')"
        >
          <VImg
            v-if="chatStore.user?.info.photo"
            :src="chatStore.user?.info.photo"
          />
          <VImg v-else :src="'/images/svg/avatar-default.svg'" alt="Avatar" />
        </VAvatar>
      </VBadge>

      <AppTextField
        id="search"
        v-model="searchQuery"
        :placeholder="
          $t('search_service_placeholder', 'Pesquisar atendimento...')
        "
        prepend-inner-icon="tabler-search"
        single-line
        hide-details
        dense
        class="flex-grow-1 chat-list-search"
        :loading="isSearching"
      >
        <template #append-inner>
          <VIcon
            v-if="searchQuery && searchQuery.trim().length > 0"
            icon="tabler-x"
            class="cursor-pointer"
            @click="searchQuery = ''"
          />
        </template>
      </AppTextField>

      <VBtn
        icon
        variant="flat"
        class="filter-btn-white"
        @click="isAdvancedFiltersModalOpen = true"
      >
        <VIcon icon="tabler-filter" />
        <VTooltip activator="parent" location="bottom">
          {{ $t('advanced_filters') }}
        </VTooltip>
      </VBtn>

      <IconBtn v-if="hasActiveFilters" @click="handleClearFilters">
        <VIcon icon="tabler-filter-off" class="text-medium-emphasis" />
        <VTooltip activator="parent" location="bottom">
          {{ $t('clear_filters', 'Limpar filtros') }}
        </VTooltip>
      </IconBtn>

      <IconBtn v-if="$vuetify.display.smAndDown" @click="$emit('close')">
        <VIcon icon="tabler-x" class="text-medium-emphasis" />
      </IconBtn>
    </div>
  </div>
  <VDivider />

  <div class="chat-filter-options px-3 py-3">
    <div class="d-flex gap-2 flex-wrap">
      <div class="chat-filter-item flex-grow-1">
        <VBtn
          :variant="activeFilter === 'new' ? 'flat' : 'text'"
          :color="activeFilter === 'new' ? 'primary' : undefined"
          class="chat-filter-btn w-100"
          @click="handleFilterClick('new')"
        >
          <VIcon size="24">tabler-plus</VIcon>
        </VBtn>
      </div>
      <div class="chat-filter-item flex-grow-1">
        <div class="chat-filter-btn-wrapper">
          <VBtn
            :variant="activeFilter === 'all' ? 'flat' : 'text'"
            :color="activeFilter === 'all' ? 'primary' : undefined"
            class="chat-filter-btn w-100"
            @click="handleFilterClick('all')"
          >
            <VIcon size="24">tabler-list</VIcon>
          </VBtn>
          <span
            v-if="allChatsCount > 0"
            class="chat-filter-count-badge"
            :class="{
              'badge-single-digit': allChatsCount.toString().length === 1,
              'badge-double-digit': allChatsCount.toString().length === 2,
              'badge-triple-digit': allChatsCount.toString().length >= 3,
            }"
          >
            {{ allChatsCount }}
          </span>
        </div>
      </div>
      <div class="chat-filter-item flex-grow-1">
        <div class="chat-filter-btn-wrapper">
          <VBtn
            :variant="activeFilter === 'in_chat' ? 'flat' : 'text'"
            :color="activeFilter === 'in_chat' ? 'primary' : undefined"
            class="chat-filter-btn w-100"
            @click="handleFilterClick('in_chat')"
          >
            <VIcon size="24">tabler-message-circle</VIcon>
          </VBtn>
          <span
            v-if="inChatCount > 0"
            class="chat-filter-count-badge"
            :class="{
              'badge-single-digit': inChatCount.toString().length === 1,
              'badge-double-digit': inChatCount.toString().length === 2,
              'badge-triple-digit': inChatCount.toString().length >= 3,
            }"
          >
            {{ inChatCount }}
          </span>
        </div>
      </div>
      <div class="chat-filter-item flex-grow-1">
        <div class="chat-filter-btn-wrapper">
          <VBtn
            :variant="activeFilter === 'my_chats' ? 'flat' : 'text'"
            :color="activeFilter === 'my_chats' ? 'primary' : undefined"
            class="chat-filter-btn w-100"
            @click="handleFilterClick('my_chats')"
          >
            <VIcon size="24">tabler-message-circle-user</VIcon>
          </VBtn>
          <span
            v-if="myChatsCount > 0"
            class="chat-filter-count-badge"
            :class="{
              'badge-single-digit': myChatsCount.toString().length === 1,
              'badge-double-digit': myChatsCount.toString().length === 2,
              'badge-triple-digit': myChatsCount.toString().length >= 3,
            }"
          >
            {{ myChatsCount }}
          </span>
        </div>
      </div>
      <div class="chat-filter-item flex-grow-1">
        <div class="chat-filter-btn-wrapper">
          <VBtn
            :variant="activeFilter === 'queue' ? 'flat' : 'text'"
            :color="activeFilter === 'queue' ? 'primary' : undefined"
            class="chat-filter-btn w-100"
            @click="handleFilterClick('queue')"
          >
            <VIcon size="24">tabler-clock</VIcon>
          </VBtn>
          <span
            v-if="queueCount > 0"
            class="chat-filter-count-badge"
            :class="{
              'badge-single-digit': queueCount.toString().length === 1,
              'badge-double-digit': queueCount.toString().length === 2,
              'badge-triple-digit': queueCount.toString().length >= 3,
            }"
          >
            {{ queueCount }}
          </span>
        </div>
      </div>
      <div v-if="canViewChatbotTab" class="chat-filter-item flex-grow-1">
        <div class="chat-filter-btn-wrapper">
          <VBtn
            :variant="activeFilter === 'chatbot' ? 'flat' : 'text'"
            :color="activeFilter === 'chatbot' ? 'primary' : undefined"
            class="chat-filter-btn w-100"
            @click="handleFilterClick('chatbot')"
          >
            <VIcon size="24">tabler-robot</VIcon>
          </VBtn>
          <span
            v-if="chatbotCount > 0"
            class="chat-filter-count-badge"
            :class="{
              'badge-single-digit': chatbotCount.toString().length === 1,
              'badge-double-digit': chatbotCount.toString().length === 2,
              'badge-triple-digit': chatbotCount.toString().length >= 3,
            }"
          >
            {{ chatbotCount }}
          </span>
        </div>
      </div>
      <div v-if="hasActiveFilters" class="chat-filter-item flex-grow-1">
        <div class="chat-filter-btn-wrapper">
          <VBtn
            :variant="activeFilter === 'scheduled' ? 'flat' : 'text'"
            :color="activeFilter === 'scheduled' ? 'primary' : undefined"
            class="chat-filter-btn w-100"
            @click="handleFilterClick('scheduled')"
          >
            <VIcon size="24">tabler-calendar-time</VIcon>
          </VBtn>
          <span
            v-if="scheduledCount > 0"
            class="chat-filter-count-badge"
            :class="{
              'badge-single-digit': scheduledCount.toString().length === 1,
              'badge-double-digit': scheduledCount.toString().length === 2,
              'badge-triple-digit': scheduledCount.toString().length >= 3,
            }"
          >
            {{ scheduledCount }}
          </span>
        </div>
      </div>
      <div v-if="hasActiveFilters" class="chat-filter-item flex-grow-1">
        <div class="chat-filter-btn-wrapper">
          <VBtn
            :variant="activeFilter === 'closed' ? 'flat' : 'text'"
            :color="activeFilter === 'closed' ? 'primary' : undefined"
            class="chat-filter-btn w-100"
            @click="handleFilterClick('closed')"
          >
            <VIcon size="24">tabler-lock</VIcon>
          </VBtn>
          <span
            v-if="closedCount > 0"
            class="chat-filter-count-badge"
            :class="{
              'badge-single-digit': closedCount.toString().length === 1,
              'badge-double-digit': closedCount.toString().length === 2,
              'badge-triple-digit': closedCount.toString().length >= 3,
            }"
          >
            {{ closedCount }}
          </span>
        </div>
      </div>
    </div>
    <Transition name="expand">
      <div
        v-if="expandedFilter"
        class="chat-filter-expanded-full d-flex align-center justify-space-between"
      >
        <span>{{ expandedFilterText }}</span>
        <div class="chat-filter-expanded-actions d-flex align-center gap-1">
          <IconBtn
            v-if="
              expandedFilter === 'in_chat' ||
              expandedFilter === 'queue' ||
              expandedFilter === 'my_chats' ||
              expandedFilter === 'chatbot'
            "
            size="small"
            variant="text"
            @click="
              openSortModal(
                expandedFilter as 'in_chat' | 'queue' | 'my_chats' | 'chatbot'
              )
            "
          >
            <VIcon size="18">tabler-arrows-sort</VIcon>
            <VTooltip activator="parent" location="top">
              {{ $t('sort', 'Ordenar') }}
            </VTooltip>
          </IconBtn>
          <IconBtn
            v-if="expandedFilter === 'all'"
            size="small"
            variant="text"
            @click="openSortModal('all')"
          >
            <VIcon size="18">tabler-arrows-sort</VIcon>
            <VTooltip activator="parent" location="top">
              {{ $t('sort', 'Ordenar') }}
            </VTooltip>
          </IconBtn>
          <IconBtn
            v-if="isBulkModeAvailable"
            size="small"
            variant="text"
            @click="toggleBulkMode"
          >
            <VIcon size="18">
              {{ isBulkModeEnabled ? 'tabler-square-x' : 'tabler-checkbox' }}
            </VIcon>
            <VTooltip activator="parent" location="top">
              {{
                isBulkModeEnabled
                  ? $t('bulk_mode_exit')
                  : $t('bulk_select_mode', 'Selecionar')
              }}
            </VTooltip>
          </IconBtn>
        </div>
      </div>
    </Transition>

    <Transition name="expand">
      <div
        v-if="isBulkModeEnabled && isBulkModeAvailable"
        class="chat-bulk-toolbar"
      >
        <div class="d-flex align-center justify-space-between gap-2">
          <div class="d-flex align-center gap-2">
            <VCheckboxBtn
              :model-value="bulkSelectAllFiltered"
              density="compact"
              @update:model-value="
                handleBulkSelectAllFilteredChange(Boolean($event))
              "
            />
            <span class="text-body-2">
              {{ $t('bulk_select_all_filtered') }}
            </span>
          </div>
          <VChip size="small" color="primary" variant="tonal">
            {{ $t('bulk_selected_count', { count: bulkTargetCount }) }}
          </VChip>
        </div>

        <div
          v-if="bulkSelectAllFiltered"
          class="text-caption text-medium-emphasis mt-1"
        >
          {{ $t('bulk_selection_filtered_hint') }}
        </div>

        <div class="d-flex gap-2 mt-2">
          <VBtn
            size="small"
            variant="tonal"
            color="primary"
            prepend-icon="tabler-arrows-right-left"
            :disabled="!hasBulkSelection || isBulkActionRunning"
            @click="openBulkTransferDialog"
          >
            {{ $t('bulk_transfer') }}
          </VBtn>
          <VBtn
            size="small"
            variant="tonal"
            color="error"
            prepend-icon="tabler-x"
            :disabled="!hasBulkSelection || isBulkActionRunning"
            @click="openBulkCloseDialog"
          >
            {{ $t('bulk_close') }}
          </VBtn>
        </div>
      </div>
    </Transition>
  </div>

  <VDivider />

  <template v-if="activeFilter === 'new'">
    <div class="px-3 py-3">
      <div class="d-flex align-center gap-2 mb-3">
        <AppTextField
          v-model="contactSearchQuery"
          :placeholder="$t('search') + '...'"
          prepend-inner-icon="tabler-search"
          single-line
          hide-details
          dense
          class="flex-grow-1"
        >
          <template #append-inner>
            <VIcon
              v-if="contactSearchQuery && contactSearchQuery.trim().length > 0"
              icon="tabler-x"
              class="cursor-pointer"
              @click="contactSearchQuery = ''"
            />
          </template>
        </AppTextField>
        <VBtn
          icon
          variant="flat"
          class="me-1 filter-btn-white"
          @click="isContactAdvancedFiltersModalOpen = true"
        >
          <VIcon icon="tabler-filter" />
          <VTooltip activator="parent" location="bottom">
            {{ $t('advanced_filters') }}
          </VTooltip>
        </VBtn>

        <IconBtn
          v-if="hasActiveContactFilters"
          class="me-1"
          @click="handleClearContactFilters"
        >
          <VIcon icon="tabler-filter-off" class="text-medium-emphasis" />
          <VTooltip activator="parent" location="bottom">
            {{ $t('clear_filters', 'Limpar filtros') }}
          </VTooltip>
        </IconBtn>

        <VBtn color="primary" icon @click="isAddContactModalOpen = true">
          <VIcon icon="tabler-plus" />
          <VTooltip activator="parent" location="bottom">
            {{ $t('add') }}
          </VTooltip>
        </VBtn>
      </div>
    </div>

    <VDivider />

    <PerfectScrollbar
      ref="contactScrollContainer"
      :options="{ wheelPropagation: false }"
      @ps-scroll-y="handleContactScroll"
    >
      <ul class="d-flex flex-column gap-y-1 chat-list px-3 py-2 list-none">
        <template
          v-if="isLoadingMoreContacts && accumulatedContacts.length === 0"
        >
          <li
            v-for="i in 5"
            :key="`skeleton-contact-${i}`"
            class="contact-item d-flex align-center gap-3 pa-3"
          >
            <VSkeletonLoader type="avatar" width="40" height="40" />
            <div class="flex-grow-1">
              <VSkeletonLoader
                type="text"
                width="60%"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader type="text" width="40%" height="16" />
            </div>
          </li>
        </template>
        <template v-else>
          <li
            v-for="contact in accumulatedContacts"
            :key="`contact-${contact.contact_id}`"
            class="contact-item d-flex align-center gap-3 pa-3"
            :class="{
              'contact-item--editing':
                editingContactId === contact.contact_id ||
                validatingContactId === contact.contact_id ||
                (isSelectChannelSectorModalOpen &&
                  selectedContactForChat?.contact_id === contact.contact_id),
              'contact-item--not-validated': !contact.is_valided,
              'cursor-pointer': true,
            }"
            @click="handleContactClick(contact)"
            @mouseenter="hoveredContactId = contact.contact_id"
            @mouseleave="hoveredContactId = null"
          >
            <VAvatar
              size="40"
              :variant="!contact.photo ? 'tonal' : undefined"
              color="primary"
            >
              <VImg
                v-if="contact.photo"
                :src="contact.photo"
                :alt="`${contact.name} ${contact.last_name || ''}`"
              />
              <VIcon v-else size="20">tabler-user</VIcon>
            </VAvatar>
            <div class="flex-grow-1">
              <div class="d-flex align-center gap-2">
                <div class="text-body-1 font-weight-medium">
                  {{ contact.name }}
                  {{ contact.last_name || '' }}
                </div>
              </div>
              <div
                v-if="contact.phone_partial"
                class="text-caption text-disabled"
              >
                {{ contact.phone_partial }}
              </div>
            </div>
            <div class="d-flex align-center gap-2">
              <template v-if="hoveredContactId === contact.contact_id">
                <IconBtn
                  v-if="!contact.is_valided"
                  size="small"
                  variant="text"
                  color="primary"
                  class="contact-action-btn"
                  @click.stop="
                    handleValidateContact(contact.contact_id, $event)
                  "
                >
                  <VIcon size="18">tabler-refresh</VIcon>
                  <VTooltip activator="parent" location="top">
                    {{ $t('validate_contact') }}
                  </VTooltip>
                </IconBtn>
                <IconBtn
                  size="small"
                  variant="text"
                  color="primary"
                  class="contact-action-btn"
                  @click.stop="handleEditContact(contact.contact_id, $event)"
                >
                  <VIcon size="18">tabler-edit</VIcon>
                  <VTooltip activator="parent" location="top">
                    {{ $t('edit_contact') }}
                  </VTooltip>
                </IconBtn>
              </template>

              <template v-else>
                <ContactValidationBadge
                  :validation-status="contact.validation_status"
                  :is-validated="contact.is_valided"
                  compact
                  icon-only
                />
              </template>
            </div>
          </li>

          <li
            v-if="
              !accumulatedContacts.length &&
              !chatStore.loading &&
              !isLoadingMoreContacts
            "
            class="no-chat-items-text text-disabled"
          >
            {{ $t('no_contacts_found') }}
          </li>

          <template
            v-if="isLoadingMoreContacts && accumulatedContacts.length > 0"
          >
            <li
              v-for="i in 3"
              :key="`skeleton-contact-more-${i}`"
              class="contact-item d-flex align-center gap-3 pa-3"
            >
              <VSkeletonLoader type="avatar" width="40" height="40" />
              <div class="flex-grow-1">
                <VSkeletonLoader
                  type="text"
                  width="60%"
                  height="20"
                  class="mb-1"
                />
                <VSkeletonLoader type="text" width="40%" height="16" />
              </div>
            </li>
          </template>
        </template>
      </ul>
    </PerfectScrollbar>
  </template>

  <template v-else-if="activeFilter === 'chatbot'">
    <PerfectScrollbar
      :options="{ wheelPropagation: false }"
      @ps-scroll-y="handleChatScroll"
    >
      <ul class="d-flex flex-column gap-y-1 chat-list px-3 py-2 list-none">
        <template
          v-if="
            (isLoadingChatbot || isLoadingWorkerConfigs) &&
            !isLoadingMoreChatbot
          "
        >
          <li
            v-for="i in chatStore.chatbotPagings.per_page"
            :key="`skeleton-chatbot-${i}`"
            class="chat d-flex align-center"
          >
            <VSkeletonLoader type="avatar" width="40" height="40" />
            <div class="flex-grow-1 ms-4 overflow-hidden min-w-0">
              <VSkeletonLoader
                type="text"
                width="60%"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader
                type="text"
                width="40%"
                height="16"
                class="mb-1"
              />
              <VSkeletonLoader type="text" width="50%" height="16" />
            </div>
            <div class="d-flex flex-column align-self-start">
              <VSkeletonLoader
                type="text"
                width="50"
                height="16"
                class="mb-1"
              />
              <VSkeletonLoader type="text" width="20" height="16" />
            </div>
          </li>
        </template>

        <template v-else>
          <ChatQueue
            v-for="pinnedChat in canShowPinnedChat ? pinnedChats : []"
            :key="`pinned-${pinnedChat.chat_id}`"
            :user="pinnedChat"
            is-pinned
            show-pin-action
            :pin-loading="chatStore.pinningChatIds.includes(pinnedChat.chat_id)"
            @toggle-pin="handleTogglePinnedChat(pinnedChat)"
            @click="handlePinnedChatClick(pinnedChat)"
          />

          <ChatQueue
            v-for="chat in filteredChatbot"
            :key="`chatbot-${chat.chat_id}`"
            :user="chat"
            show-chatbot-type-indicator
            :is-pinned="chatStore.isChatPinned(chat.chat_id)"
            :show-pin-action="!isBulkModeEnabled && isPinnableChat(chat)"
            :pin-loading="chatStore.pinningChatIds.includes(chat.chat_id)"
            :show-checkbox="isBulkModeEnabled && isBulkSelectableChat(chat)"
            :checked="isChatBulkSelected(chat.chat_id)"
            :checkbox-disabled="bulkSelectAllFiltered"
            @toggle-pin="handleTogglePinnedChat(chat)"
            @checkbox-change="handleChatQueueCheckboxChange(chat, $event)"
            @click="handleDefaultChatClick(chat)"
          />

          <li
            v-if="!filteredChatbot.length && !canShowPinnedChat"
            class="no-chat-items-text text-disabled"
          >
            {{ $t('no_chat_in_ura') }}
          </li>

          <template v-if="isLoadingMoreChatbot">
            <li
              v-for="i in chatStore.chatbotPagings.per_page"
              :key="`skeleton-chatbot-pagination-${i}`"
              class="chat d-flex align-center"
            >
              <VSkeletonLoader type="avatar" width="40" height="40" />
              <div class="flex-grow-1 ms-4 overflow-hidden min-w-0">
                <VSkeletonLoader
                  type="text"
                  width="60%"
                  height="20"
                  class="mb-1"
                />
                <VSkeletonLoader
                  type="text"
                  width="40%"
                  height="16"
                  class="mb-1"
                />
                <VSkeletonLoader type="text" width="50%" height="16" />
              </div>
              <div class="d-flex flex-column align-self-start">
                <VSkeletonLoader
                  type="text"
                  width="50"
                  height="16"
                  class="mb-1"
                />
                <VSkeletonLoader type="text" width="20" height="16" />
              </div>
            </li>
          </template>
        </template>
      </ul>
    </PerfectScrollbar>
  </template>

  <template v-else-if="activeFilter === 'closed'">
    <PerfectScrollbar
      ref="chatScrollContainer"
      :options="{ wheelPropagation: false }"
      @ps-scroll-y="handleClosedScroll"
      @ps-y-reach-end="handleClosedReachEnd"
    >
      <ul class="d-flex flex-column gap-y-1 chat-list px-3 py-2 list-none">
        <template v-if="isLoadingClosed || isLoadingWorkerConfigs">
          <li
            v-for="i in 5"
            :key="`skeleton-closed-${i}`"
            class="chat d-flex align-center"
          >
            <VSkeletonLoader type="avatar" width="40" height="40" />
            <div class="flex-grow-1 ms-4 overflow-hidden min-w-0">
              <VSkeletonLoader
                type="text"
                width="60%"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader
                type="text"
                width="40%"
                height="16"
                class="mb-1"
              />
              <VSkeletonLoader type="text" width="50%" height="16" />
            </div>
            <div class="d-flex flex-column align-self-start">
              <VSkeletonLoader
                type="text"
                width="50"
                height="16"
                class="mb-1"
              />
              <VSkeletonLoader type="text" width="20" height="16" />
            </div>
          </li>
        </template>

        <template v-else>
          <ChatQueue
            v-for="pinnedChat in canShowPinnedChat ? pinnedChats : []"
            :key="`pinned-${pinnedChat.chat_id}`"
            :user="pinnedChat"
            is-pinned
            show-pin-action
            :pin-loading="chatStore.pinningChatIds.includes(pinnedChat.chat_id)"
            @toggle-pin="handleTogglePinnedChat(pinnedChat)"
            @click="handlePinnedChatClick(pinnedChat)"
          />

          <ChatQueue
            v-for="chat in filteredClosed"
            :key="`closed-${chat.chat_id}`"
            :user="chat"
            :is-pinned="chatStore.isChatPinned(chat.chat_id)"
            :show-pin-action="!isBulkModeEnabled && isPinnableChat(chat)"
            :pin-loading="chatStore.pinningChatIds.includes(chat.chat_id)"
            :show-checkbox="isBulkModeEnabled && isBulkSelectableChat(chat)"
            :checked="isChatBulkSelected(chat.chat_id)"
            :checkbox-disabled="bulkSelectAllFiltered"
            @toggle-pin="handleTogglePinnedChat(chat)"
            @checkbox-change="handleChatQueueCheckboxChange(chat, $event)"
            @click="handleDefaultChatClick(chat)"
          />

          <li
            v-if="!filteredClosed.length && !canShowPinnedChat"
            class="no-chat-items-text text-disabled"
          >
            {{ $t('no_chat_closed') }}
          </li>

          <template v-if="isLoadingClosed">
            <li
              v-for="i in 5"
              :key="`skeleton-closed-pagination-${i}`"
              class="chat d-flex align-center"
            >
              <VSkeletonLoader type="avatar" width="40" height="40" />
              <div class="flex-grow-1 ms-4 overflow-hidden min-w-0">
                <VSkeletonLoader
                  type="text"
                  width="60%"
                  height="20"
                  class="mb-1"
                />
                <VSkeletonLoader
                  type="text"
                  width="40%"
                  height="16"
                  class="mb-1"
                />
                <VSkeletonLoader type="text" width="50%" height="16" />
              </div>
              <div class="d-flex flex-column align-self-start">
                <VSkeletonLoader
                  type="text"
                  width="50"
                  height="16"
                  class="mb-1"
                />
                <VSkeletonLoader type="text" width="20" height="16" />
              </div>
            </li>
          </template>
        </template>
      </ul>
    </PerfectScrollbar>
  </template>

  <template v-else-if="activeFilter === 'scheduled'">
    <PerfectScrollbar
      ref="chatScrollContainer"
      :options="{ wheelPropagation: false }"
      @ps-scroll-y="handleChatScroll"
      @ps-y-reach-end="handleScheduledReachEnd"
    >
      <ul class="d-flex flex-column gap-y-1 chat-list px-3 py-2 list-none">
        <template
          v-if="
            (isLoadingScheduled || isLoadingWorkerConfigs) &&
            !isLoadingMoreScheduled
          "
        >
          <li
            v-for="i in 5"
            :key="`skeleton-scheduled-${i}`"
            class="chat d-flex align-center"
          >
            <VSkeletonLoader type="avatar" width="40" height="40" />
            <div class="flex-grow-1 ms-4 overflow-hidden min-w-0">
              <VSkeletonLoader
                type="text"
                width="60%"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader
                type="text"
                width="40%"
                height="16"
                class="mb-1"
              />
              <VSkeletonLoader type="text" width="50%" height="16" />
            </div>
            <div class="d-flex flex-column align-self-start">
              <VSkeletonLoader
                type="text"
                width="50"
                height="16"
                class="mb-1"
              />
              <VSkeletonLoader type="text" width="20" height="16" />
            </div>
          </li>
        </template>

        <template v-else>
          <ChatQueue
            v-for="pinnedChat in canShowPinnedChat ? pinnedChats : []"
            :key="`pinned-${pinnedChat.chat_id}`"
            :user="pinnedChat"
            is-pinned
            show-pin-action
            :pin-loading="chatStore.pinningChatIds.includes(pinnedChat.chat_id)"
            @toggle-pin="handleTogglePinnedChat(pinnedChat)"
            @click="handlePinnedChatClick(pinnedChat)"
          />

          <ChatQueue
            v-for="chat in filteredScheduled"
            :key="`scheduled-${chat.chat_id}`"
            :user="chat"
            :is-pinned="chatStore.isChatPinned(chat.chat_id)"
            :show-pin-action="!isBulkModeEnabled && isPinnableChat(chat)"
            :pin-loading="chatStore.pinningChatIds.includes(chat.chat_id)"
            :show-checkbox="isBulkModeEnabled && isBulkSelectableChat(chat)"
            :checked="isChatBulkSelected(chat.chat_id)"
            :checkbox-disabled="bulkSelectAllFiltered"
            @toggle-pin="handleTogglePinnedChat(chat)"
            @checkbox-change="handleChatQueueCheckboxChange(chat, $event)"
            @click="handleDefaultChatClick(chat)"
          />

          <li
            v-if="!filteredScheduled.length && !canShowPinnedChat"
            class="no-chat-items-text text-disabled"
          >
            {{ $t('no_chat_scheduled') }}
          </li>

          <template v-if="isLoadingMoreScheduled">
            <li
              v-for="i in 5"
              :key="`skeleton-scheduled-pagination-${i}`"
              class="chat d-flex align-center"
            >
              <VSkeletonLoader type="avatar" width="40" height="40" />
              <div class="flex-grow-1 ms-4 overflow-hidden min-w-0">
                <VSkeletonLoader
                  type="text"
                  width="60%"
                  height="20"
                  class="mb-1"
                />
                <VSkeletonLoader
                  type="text"
                  width="40%"
                  height="16"
                  class="mb-1"
                />
                <VSkeletonLoader type="text" width="50%" height="16" />
              </div>
              <div class="d-flex flex-column align-self-start">
                <VSkeletonLoader
                  type="text"
                  width="50"
                  height="16"
                  class="mb-1"
                />
                <VSkeletonLoader type="text" width="20" height="16" />
              </div>
            </li>
          </template>
        </template>
      </ul>
    </PerfectScrollbar>
  </template>

  <template v-else-if="activeFilter === 'my_chats'">
    <PerfectScrollbar
      ref="chatScrollContainer"
      :options="{ wheelPropagation: false }"
      @ps-scroll-y="handleChatScroll"
    >
      <ul class="d-flex flex-column gap-y-1 chat-list px-3 py-2 list-none">
        <template
          v-if="
            (chatStore.loadingChats || isLoadingWorkerConfigs) &&
            !isLoadingMoreQueue &&
            !isLoadingMoreInChat
          "
        >
          <li
            v-for="i in 5"
            :key="`skeleton-my-chat-${i}`"
            class="chat d-flex align-center"
          >
            <VSkeletonLoader type="avatar" width="40" height="40" />
            <div class="flex-grow-1 ms-4 overflow-hidden min-w-0">
              <VSkeletonLoader
                type="text"
                width="60%"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader
                type="text"
                width="40%"
                height="16"
                class="mb-1"
              />
              <VSkeletonLoader type="text" width="50%" height="16" />
            </div>
            <div class="d-flex flex-column align-self-start">
              <VSkeletonLoader
                type="text"
                width="50"
                height="16"
                class="mb-1"
              />
              <VSkeletonLoader type="text" width="20" height="16" />
            </div>
          </li>
        </template>

        <template v-else>
          <ChatQueue
            v-for="pinnedChat in canShowPinnedChat ? pinnedChats : []"
            :key="`pinned-${pinnedChat.chat_id}`"
            :user="pinnedChat"
            is-pinned
            show-pin-action
            :pin-loading="chatStore.pinningChatIds.includes(pinnedChat.chat_id)"
            @toggle-pin="handleTogglePinnedChat(pinnedChat)"
            @click="handlePinnedChatClick(pinnedChat)"
          />

          <ChatQueue
            v-for="chat in filteredMyChats"
            :key="`my-chat-${chat.chat_id}`"
            :user="chat"
            :is-pinned="chatStore.isChatPinned(chat.chat_id)"
            :show-pin-action="!isBulkModeEnabled && isPinnableChat(chat)"
            :pin-loading="chatStore.pinningChatIds.includes(chat.chat_id)"
            :show-checkbox="isBulkModeEnabled && isBulkSelectableChat(chat)"
            :checked="isChatBulkSelected(chat.chat_id)"
            :checkbox-disabled="bulkSelectAllFiltered"
            @toggle-pin="handleTogglePinnedChat(chat)"
            @checkbox-change="handleChatQueueCheckboxChange(chat, $event)"
            @click="handleDefaultChatClick(chat)"
          />

          <li
            v-if="!filteredMyChats.length && !canShowPinnedChat"
            class="no-chat-items-text text-disabled"
          >
            {{ $t('no_my_chats', 'Nenhum atendimento encontrado') }}
          </li>

          <template
            v-if="
              isLoadingMoreQueue ||
              isLoadingMoreInChat ||
              isLoadingAllChatsWithFilters
            "
          >
            <li
              v-for="i in 5"
              :key="`skeleton-my-chats-pagination-${i}`"
              class="chat d-flex align-center"
            >
              <VSkeletonLoader type="avatar" width="40" height="40" />
              <div class="flex-grow-1 ms-4 overflow-hidden min-w-0">
                <VSkeletonLoader
                  type="text"
                  width="60%"
                  height="20"
                  class="mb-1"
                />
                <VSkeletonLoader
                  type="text"
                  width="40%"
                  height="16"
                  class="mb-1"
                />
                <VSkeletonLoader type="text" width="50%" height="16" />
              </div>
              <div class="d-flex flex-column align-self-start">
                <VSkeletonLoader
                  type="text"
                  width="50"
                  height="16"
                  class="mb-1"
                />
                <VSkeletonLoader type="text" width="20" height="16" />
              </div>
            </li>
          </template>
        </template>
      </ul>
    </PerfectScrollbar>
  </template>

  <template v-else-if="activeFilter === 'in_chat'">
    <PerfectScrollbar
      ref="chatScrollContainer"
      :options="{ wheelPropagation: false }"
      @ps-scroll-y="handleChatScroll"
    >
      <ul class="d-flex flex-column gap-y-1 chat-list px-3 py-2 list-none">
        <template
          v-if="
            (chatStore.loadingChats || isLoadingWorkerConfigs) &&
            !isLoadingMoreInChat
          "
        >
          <li
            v-for="i in 5"
            :key="`skeleton-in-chat-${i}`"
            class="chat d-flex align-center"
          >
            <VSkeletonLoader type="avatar" width="40" height="40" />
            <div class="flex-grow-1 ms-4 overflow-hidden min-w-0">
              <VSkeletonLoader
                type="text"
                width="60%"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader
                type="text"
                width="40%"
                height="16"
                class="mb-1"
              />
              <VSkeletonLoader type="text" width="50%" height="16" />
            </div>
            <div class="d-flex flex-column align-self-start">
              <VSkeletonLoader
                type="text"
                width="50"
                height="16"
                class="mb-1"
              />
              <VSkeletonLoader type="text" width="20" height="16" />
            </div>
          </li>
        </template>
        <template v-else>
          <ChatQueue
            v-for="pinnedChat in canShowPinnedChat ? pinnedChats : []"
            :key="`pinned-${pinnedChat.chat_id}`"
            :user="pinnedChat"
            is-pinned
            show-pin-action
            :pin-loading="chatStore.pinningChatIds.includes(pinnedChat.chat_id)"
            @toggle-pin="handleTogglePinnedChat(pinnedChat)"
            @click="handlePinnedChatClick(pinnedChat)"
          />

          <ChatQueue
            v-for="inChat in filteredInChat"
            :key="`chat-${inChat.chat_id}`"
            :user="inChat"
            :is-pinned="chatStore.isChatPinned(inChat.chat_id)"
            :show-pin-action="!isBulkModeEnabled && isPinnableChat(inChat)"
            :pin-loading="chatStore.pinningChatIds.includes(inChat.chat_id)"
            :show-checkbox="isBulkModeEnabled && isBulkSelectableChat(inChat)"
            :checked="isChatBulkSelected(inChat.chat_id)"
            :checkbox-disabled="bulkSelectAllFiltered"
            @toggle-pin="handleTogglePinnedChat(inChat)"
            @checkbox-change="handleChatQueueCheckboxChange(inChat, $event)"
            @click="handleDefaultChatClick(inChat)"
          />
          <li
            v-if="!filteredInChat.length && !canShowPinnedChat"
            class="no-chat-items-text text-disabled"
          >
            {{ $t('no_chat_in_service') }}
          </li>

          <template v-if="isLoadingMoreInChat">
            <li
              v-for="i in 3"
              :key="`skeleton-in-chat-pagination-${i}`"
              class="chat d-flex align-center"
            >
              <VSkeletonLoader type="avatar" width="40" height="40" />
              <div class="flex-grow-1 ms-4 overflow-hidden min-w-0">
                <VSkeletonLoader
                  type="text"
                  width="60%"
                  height="20"
                  class="mb-1"
                />
                <VSkeletonLoader
                  type="text"
                  width="40%"
                  height="16"
                  class="mb-1"
                />
                <VSkeletonLoader type="text" width="50%" height="16" />
              </div>
              <div class="d-flex flex-column align-self-start">
                <VSkeletonLoader
                  type="text"
                  width="50"
                  height="16"
                  class="mb-1"
                />
                <VSkeletonLoader type="text" width="20" height="16" />
              </div>
            </li>
          </template>
        </template>
      </ul>
    </PerfectScrollbar>
  </template>

  <template v-else-if="activeFilter === 'queue'">
    <PerfectScrollbar
      ref="chatScrollContainer"
      :options="{ wheelPropagation: false }"
      @ps-scroll-y="handleChatScroll"
    >
      <ul class="d-flex flex-column gap-y-1 chat-list px-3 py-2 list-none">
        <template
          v-if="
            (chatStore.loadingChats || isLoadingWorkerConfigs) &&
            !isLoadingMoreQueue
          "
        >
          <li
            v-for="i in 5"
            :key="`skeleton-queue-${i}`"
            class="chat d-flex align-center"
          >
            <VSkeletonLoader type="avatar" width="40" height="40" />
            <div class="flex-grow-1 ms-4 overflow-hidden min-w-0">
              <VSkeletonLoader
                type="text"
                width="60%"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader
                type="text"
                width="40%"
                height="16"
                class="mb-1"
              />
              <VSkeletonLoader type="text" width="50%" height="16" />
            </div>
            <div class="d-flex flex-column align-self-start">
              <VSkeletonLoader
                type="text"
                width="50"
                height="16"
                class="mb-1"
              />
              <VSkeletonLoader type="text" width="20" height="16" />
            </div>
          </li>
        </template>
        <template v-else>
          <ChatQueue
            v-for="pinnedChat in canShowPinnedChat ? pinnedChats : []"
            :key="`pinned-${pinnedChat.chat_id}`"
            :user="pinnedChat"
            is-pinned
            show-pin-action
            :pin-loading="chatStore.pinningChatIds.includes(pinnedChat.chat_id)"
            @toggle-pin="handleTogglePinnedChat(pinnedChat)"
            @click="handlePinnedChatClick(pinnedChat)"
          />

          <ChatQueue
            v-for="queue in filteredQueue"
            :key="`chat-${queue.chat_id}`"
            :user="queue"
            :disabled="
              !isQueueChatSelectable(getQueueChatOriginalIndex(queue.chat_id))
            "
            :is-pinned="chatStore.isChatPinned(queue.chat_id)"
            :show-pin-action="!isBulkModeEnabled && isPinnableChat(queue)"
            :pin-loading="chatStore.pinningChatIds.includes(queue.chat_id)"
            :show-checkbox="isBulkModeEnabled && isBulkSelectableChat(queue)"
            :checked="isChatBulkSelected(queue.chat_id)"
            :checkbox-disabled="bulkSelectAllFiltered"
            @toggle-pin="handleTogglePinnedChat(queue)"
            @checkbox-change="handleChatQueueCheckboxChange(queue, $event)"
            @click="
              handleQueueCardClick(
                queue,
                getQueueChatOriginalIndex(queue.chat_id)
              )
            "
          />
          <li
            v-if="!filteredQueue.length && !canShowPinnedChat"
            class="no-chat-items-text text-disabled"
          >
            {{ $t('no_chat_in_queue') }}
          </li>

          <template v-if="isLoadingMoreQueue">
            <li
              v-for="i in 3"
              :key="`skeleton-queue-pagination-${i}`"
              class="chat d-flex align-center"
            >
              <VSkeletonLoader type="avatar" width="40" height="40" />
              <div class="flex-grow-1 ms-4 overflow-hidden min-w-0">
                <VSkeletonLoader
                  type="text"
                  width="60%"
                  height="20"
                  class="mb-1"
                />
                <VSkeletonLoader
                  type="text"
                  width="40%"
                  height="16"
                  class="mb-1"
                />
                <VSkeletonLoader type="text" width="50%" height="16" />
              </div>
              <div class="d-flex flex-column align-self-start">
                <VSkeletonLoader
                  type="text"
                  width="50"
                  height="16"
                  class="mb-1"
                />
                <VSkeletonLoader type="text" width="20" height="16" />
              </div>
            </li>
          </template>
        </template>
      </ul>
    </PerfectScrollbar>
  </template>

  <PerfectScrollbar
    v-else
    ref="chatScrollContainer"
    :options="{ wheelPropagation: false }"
    @ps-scroll-y="handleChatScroll"
  >
    <ul class="d-flex flex-column gap-y-1 chat-list px-3 py-2 list-none">
      <template
        v-if="
          (chatStore.loadingChats || isLoadingWorkerConfigs) &&
          !isLoadingMoreQueue &&
          !isLoadingMoreInChat
        "
      >
        <li
          v-for="i in 5"
          :key="`skeleton-${i}`"
          class="chat d-flex align-center"
        >
          <VSkeletonLoader type="avatar" width="40" height="40" />
          <div class="flex-grow-1 ms-4 overflow-hidden min-w-0">
            <VSkeletonLoader type="text" width="60%" height="20" class="mb-1" />
            <VSkeletonLoader type="text" width="40%" height="16" class="mb-1" />
            <VSkeletonLoader type="text" width="50%" height="16" />
          </div>
          <div class="d-flex flex-column align-self-start">
            <VSkeletonLoader type="text" width="50" height="16" class="mb-1" />
            <VSkeletonLoader type="text" width="20" height="16" />
          </div>
        </li>
      </template>

      <template v-else>
        <ChatQueue
          v-for="pinnedChat in canShowPinnedChat ? pinnedChats : []"
          :key="`pinned-${pinnedChat.chat_id}`"
          :user="pinnedChat"
          is-pinned
          show-pin-action
          :pin-loading="chatStore.pinningChatIds.includes(pinnedChat.chat_id)"
          @toggle-pin="handleTogglePinnedChat(pinnedChat)"
          @click="handlePinnedChatClick(pinnedChat)"
        />

        <li v-if="showInChatTitle" class="list-none">
          <h5 class="chat-header text-primary text-h5">
            {{ $t('in_service') }}
          </h5>
        </li>

        <ChatQueue
          v-for="inChat in filteredInChat"
          :key="`chat-${inChat.chat_id}`"
          :user="inChat"
          :is-pinned="chatStore.isChatPinned(inChat.chat_id)"
          :show-pin-action="!isBulkModeEnabled && isPinnableChat(inChat)"
          :pin-loading="chatStore.pinningChatIds.includes(inChat.chat_id)"
          :show-checkbox="isBulkModeEnabled && isBulkSelectableChat(inChat)"
          :checked="isChatBulkSelected(inChat.chat_id)"
          :checkbox-disabled="bulkSelectAllFiltered"
          @toggle-pin="handleTogglePinnedChat(inChat)"
          @checkbox-change="handleChatQueueCheckboxChange(inChat, $event)"
          @click="handleDefaultChatClick(inChat)"
        />

        <li
          v-if="
            !filteredInChat.length &&
            !canShowPinnedChat &&
            (activeFilter === 'all' || activeFilter === 'in_chat')
          "
          class="no-chat-items-text text-disabled"
        >
          {{ $t('no_chat_in_service') }}
        </li>

        <li ref="inChatSectionRef" v-if="showQueueTitle" class="list-none pt-2">
          <h5 class="chat-header text-primary text-h5">
            {{ $t('waiting_for_service') }}
          </h5>
        </li>

        <ChatQueue
          v-for="queue in filteredQueue"
          :key="`chat-${queue.chat_id}`"
          :user="queue"
          :disabled="
            !isQueueChatSelectable(getQueueChatOriginalIndex(queue.chat_id))
          "
          :is-pinned="chatStore.isChatPinned(queue.chat_id)"
          :show-pin-action="!isBulkModeEnabled && isPinnableChat(queue)"
          :pin-loading="chatStore.pinningChatIds.includes(queue.chat_id)"
          :show-checkbox="isBulkModeEnabled && isBulkSelectableChat(queue)"
          :checked="isChatBulkSelected(queue.chat_id)"
          :checkbox-disabled="bulkSelectAllFiltered"
          @toggle-pin="handleTogglePinnedChat(queue)"
          @checkbox-change="handleChatQueueCheckboxChange(queue, $event)"
          @click="
            handleQueueCardClick(
              queue,
              getQueueChatOriginalIndex(queue.chat_id)
            )
          "
        />

        <li
          v-if="
            !filteredQueue.length &&
            !canShowPinnedChat &&
            (activeFilter === 'all' || activeFilter === 'queue')
          "
          class="no-chat-items-text text-disabled"
        >
          {{ $t('no_chat_in_queue') }}
        </li>

        <li v-if="showChatbotTitle && canViewChatbotTab" class="list-none pt-2">
          <h5 class="chat-header text-primary text-h5">
            {{ $t('chatbot') }}
          </h5>
        </li>

        <ChatQueue
          v-if="showChatbotTitle && canViewChatbotTab"
          v-for="chatbot in filteredChatbot"
          :key="`chatbot-all-${chatbot.chat_id}`"
          :user="chatbot"
          :is-pinned="chatStore.isChatPinned(chatbot.chat_id)"
          :show-pin-action="!isBulkModeEnabled && isPinnableChat(chatbot)"
          :pin-loading="chatStore.pinningChatIds.includes(chatbot.chat_id)"
          :show-checkbox="isBulkModeEnabled && isBulkSelectableChat(chatbot)"
          :checked="isChatBulkSelected(chatbot.chat_id)"
          :checkbox-disabled="bulkSelectAllFiltered"
          @toggle-pin="handleTogglePinnedChat(chatbot)"
          @checkbox-change="handleChatQueueCheckboxChange(chatbot, $event)"
          @click="handleDefaultChatClick(chatbot)"
        />

        <li
          v-if="
            showChatbotTitle &&
            canViewChatbotTab &&
            !filteredChatbot.length &&
            !canShowPinnedChat &&
            !isLoadingChatbot
          "
          class="no-chat-items-text text-disabled"
        >
          {{ $t('no_chat_in_ura') }}
        </li>

        <li v-if="showClosedTitle" class="list-none pt-2">
          <h5 class="chat-header text-primary text-h5">
            {{ $t('chat_status_closed', 'Fechado') }}
          </h5>
        </li>

        <ChatQueue
          v-if="showClosedTitle"
          v-for="closed in filteredClosed"
          :key="`closed-all-${closed.chat_id}`"
          :user="closed"
          :is-pinned="chatStore.isChatPinned(closed.chat_id)"
          :show-pin-action="!isBulkModeEnabled && isPinnableChat(closed)"
          :pin-loading="chatStore.pinningChatIds.includes(closed.chat_id)"
          :show-checkbox="isBulkModeEnabled && isBulkSelectableChat(closed)"
          :checked="isChatBulkSelected(closed.chat_id)"
          :checkbox-disabled="bulkSelectAllFiltered"
          @toggle-pin="handleTogglePinnedChat(closed)"
          @checkbox-change="handleChatQueueCheckboxChange(closed, $event)"
          @click="handleDefaultChatClick(closed)"
        />

        <li
          v-if="
            showClosedTitle &&
            !filteredClosed.length &&
            !canShowPinnedChat &&
            !isLoadingClosed
          "
          class="no-chat-items-text text-disabled"
        >
          Nenhum chat fechado
        </li>

        <li v-if="showScheduledTitle" class="list-none pt-2">
          <h5 class="chat-header text-primary text-h5">
            {{ $t('scheduled', 'Agendamento') }}
          </h5>
        </li>

        <ChatQueue
          v-if="showScheduledTitle"
          v-for="scheduled in filteredScheduled"
          :key="`scheduled-all-${scheduled.chat_id}`"
          :user="scheduled"
          :is-pinned="chatStore.isChatPinned(scheduled.chat_id)"
          :show-pin-action="!isBulkModeEnabled && isPinnableChat(scheduled)"
          :pin-loading="chatStore.pinningChatIds.includes(scheduled.chat_id)"
          :show-checkbox="isBulkModeEnabled && isBulkSelectableChat(scheduled)"
          :checked="isChatBulkSelected(scheduled.chat_id)"
          :checkbox-disabled="bulkSelectAllFiltered"
          @toggle-pin="handleTogglePinnedChat(scheduled)"
          @checkbox-change="handleChatQueueCheckboxChange(scheduled, $event)"
          @click="handleDefaultChatClick(scheduled)"
        />

        <li
          v-if="
            showScheduledTitle &&
            !filteredScheduled.length &&
            !canShowPinnedChat &&
            !isLoadingScheduled
          "
          class="no-chat-items-text text-disabled"
        >
          {{ $t('no_chat_scheduled') }}
        </li>

        <template
          v-if="
            (isLoadingMoreQueue ||
              isLoadingMoreInChat ||
              isLoadingAllChatsWithFilters) &&
            (activeFilter === 'all' ||
              activeFilter === 'in_chat' ||
              activeFilter === 'queue')
          "
        >
          <li
            v-for="i in 5"
            :key="`skeleton-pagination-${i}`"
            class="chat d-flex align-center"
          >
            <VSkeletonLoader type="avatar" width="40" height="40" />
            <div class="flex-grow-1 ms-4 overflow-hidden min-w-0">
              <VSkeletonLoader
                type="text"
                width="60%"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader
                type="text"
                width="40%"
                height="16"
                class="mb-1"
              />
              <VSkeletonLoader type="text" width="50%" height="16" />
            </div>
            <div class="d-flex flex-column align-self-start">
              <VSkeletonLoader
                type="text"
                width="50"
                height="16"
                class="mb-1"
              />
              <VSkeletonLoader type="text" width="20" height="16" />
            </div>
          </li>
        </template>
      </template>
    </ul>
  </PerfectScrollbar>

  <AppAddContactChat
    v-model="isAddContactModalOpen"
    @update:model-value="handleAddContactModalClose"
  />

  <AppEditContactChat
    v-model="isEditContactModalOpen"
    :contact-id="editContactId"
    @update:model-value="handleEditContactModalClose"
  />

  <VDialogHandler
    v-model="isValidateContactDialogOpen"
    :title="$t('validate_contact')"
    :message="$t('validate_contact_confirmation')"
    @confirm="confirmValidateContact"
    @cancel="handleCancelValidateContact"
  />

  <VDialog
    v-model="isSelectChannelSectorModalOpen"
    max-width="720"
    width="calc(100vw - 24px)"
    persistent
  >
    <VCard
      class="open-conversation-dialog"
      aria-labelledby="open-conversation-dialog-title"
    >
      <VCardTitle class="d-flex align-center justify-space-between">
        <span id="open-conversation-dialog-title">
          {{ $t('select_channel_sector') }}
        </span>
        <IconBtn
          :aria-label="$t('cancel')"
          :disabled="isOpeningConversation"
          @click="handleCancelSelectChannelSector"
        >
          <VIcon>tabler-x</VIcon>
        </IconBtn>
      </VCardTitle>

      <VDivider />

      <VCardText class="open-conversation-dialog__body pt-6">
        <div class="mb-6">
          <VLabel class="text-body-2 mb-1">{{ $t('channel') }} *</VLabel>
          <AppSelectSearch
            v-model="selectedWorkerId"
            :items="availableWorkerOptions"
            :placeholder="$t('select_channel')"
            :disabled="isOpenConversationFormBusy"
            :loading="isLoadingWorkerConfigForChat"
            item-value="value"
            item-title="title"
          />
          <div v-if="selectedOpenConversationWorkerOption" class="mt-2">
            <VChip
              size="small"
              :color="
                selectedOpenConversationWorkerOption.isOfficial
                  ? 'success'
                  : 'primary'
              "
              variant="tonal"
              class="channel-tag"
            >
              <VIcon size="16" class="me-1">
                {{
                  selectedOpenConversationWorkerOption.isOfficial
                    ? 'tabler-brand-whatsapp'
                    : 'tabler-device-mobile'
                }}
              </VIcon>
              {{ selectedOpenConversationWorkerOption.name }}
              <span
                v-if="selectedOpenConversationWorkerOption.number"
                class="ms-1 text-caption"
              >
                ({{ selectedOpenConversationWorkerOption.number }})
              </span>
            </VChip>
          </div>
        </div>

        <div
          v-if="isSelectedWorkerOfficial"
          class="official-opening-panel mb-6"
        >
          <OfficialOpeningWindowCard
            :window="officialOpeningWindow"
            :requires-template="requiresOfficialTemplate"
            :loading="isLoadingOfficialOpeningContext"
            :error-message="officialOpeningError?.message"
            :request-id="officialOpeningError?.requestId"
            :disabled="isOpenConversationFormBusy"
            @retry="refreshOfficialOpeningContext"
          />

          <VAlert
            v-if="
              officialOpeningContext &&
              requiresOfficialTemplate &&
              officialOpeningContext.templates.length === 0
            "
            type="warning"
            variant="tonal"
            density="compact"
          >
            {{ $t('official_templates_empty') }}
          </VAlert>

          <template
            v-else-if="officialOpeningContext && requiresOfficialTemplate"
          >
            <VLabel class="text-body-2 mb-1">
              {{ $t('official_template_model') }} *
            </VLabel>
            <AppSelectSearch
              v-model="selectedOfficialTemplateKey"
              :items="officialTemplateOptions"
              :placeholder="$t('select_official_template')"
              :disabled="isOpenConversationFormBusy"
              item-value="value"
              item-title="title"
            />

            <div v-if="selectedOfficialTemplate" class="mt-4">
              <div class="official-template-chips">
                <VChip size="small" color="success" variant="tonal">
                  <VIcon size="15" class="me-1">tabler-circle-check</VIcon>
                  {{ $t('approved') }}
                </VChip>
                <VChip size="small" color="primary" variant="tonal">
                  <VIcon size="15" class="me-1">tabler-language</VIcon>
                  {{ selectedOfficialTemplateLanguageLabel }}
                </VChip>
                <VChip
                  v-if="selectedOfficialTemplate.category"
                  size="small"
                  color="secondary"
                  variant="tonal"
                >
                  <VIcon size="15" class="me-1">tabler-tag</VIcon>
                  {{ selectedOfficialTemplate.category }}
                </VChip>
              </div>

              <div
                v-if="hasOfficialTemplateDetectedVariables"
                class="official-template-variables"
              >
                <div
                  v-for="variable in officialTemplateVariableRows"
                  :key="variable.key"
                  class="official-template-variable-field"
                >
                  <span class="official-template-variable-label">
                    {{ formatOfficialTemplateVariableLabel(variable) }}
                  </span>
                  <OfficialTemplateVariableField
                    v-model="officialTemplateVariableValues[variable.key]"
                    :variables="openingUnderchatVariables"
                    :disabled="isOpenConversationFormBusy"
                    :placeholder="
                      variable.sample || $t('template_variable_value')
                    "
                    hide-details="auto"
                  />
                </div>
              </div>

              <div v-else class="official-template-manual-variables">
                <div class="official-template-manual-variables-header">
                  <span>{{ $t('chatbot_message_variables_legend') }}</span>
                  <VBtn
                    size="small"
                    variant="outlined"
                    color="primary"
                    :disabled="isOpenConversationFormBusy"
                    @click="addManualOfficialTemplateVariable"
                  >
                    <VIcon icon="tabler-plus" size="16" class="me-1" />
                    {{ $t('add') }}
                  </VBtn>
                </div>

                <div
                  v-for="(
                    variable, variableIndex
                  ) in manualOfficialTemplateVariables"
                  :key="`opening-manual-variable-${variableIndex}`"
                  class="official-template-manual-variable-row"
                >
                  <VSelect
                    v-model="variable.component_type"
                    :items="['HEADER', 'BODY', 'BUTTON']"
                    placeholder="Componente"
                    density="compact"
                    variant="outlined"
                    hide-details
                    :disabled="isOpenConversationFormBusy"
                    @update:model-value="
                      syncManualOfficialTemplateVariable(variableIndex)
                    "
                  />
                  <VTextField
                    v-model.number="variable.index"
                    placeholder="Índice"
                    type="number"
                    density="compact"
                    variant="outlined"
                    hide-details
                    :disabled="isOpenConversationFormBusy"
                    @update:model-value="
                      syncManualOfficialTemplateVariable(variableIndex)
                    "
                  />
                  <OfficialTemplateVariableField
                    v-model="officialTemplateVariableValues[variable.key]"
                    :variables="openingUnderchatVariables"
                    :disabled="isOpenConversationFormBusy"
                    :placeholder="$t('template_variable_value')"
                    hide-details
                  />
                  <VBtn
                    icon
                    size="small"
                    variant="text"
                    color="error"
                    :disabled="isOpenConversationFormBusy"
                    @click.stop="
                      removeManualOfficialTemplateVariable(variableIndex)
                    "
                  >
                    <VIcon icon="tabler-x" size="16" />
                  </VBtn>
                </div>
              </div>

              <div
                v-if="selectedOfficialTemplatePreview"
                class="official-template-preview"
              >
                <div class="official-template-preview-top">
                  <div class="official-template-preview-name">
                    <VIcon size="18">tabler-brand-whatsapp</VIcon>
                    <span>{{ selectedOfficialTemplate.name }}</span>
                  </div>
                  <VChip
                    v-if="hasOfficialTemplateRuntimeVariables"
                    size="x-small"
                    color="info"
                    variant="tonal"
                    prepend-icon="tabler-braces"
                  >
                    {{ $t('official_template_preview_runtime_variables') }}
                  </VChip>
                </div>
                <div class="official-template-bubble">
                  <div
                    v-if="selectedOfficialTemplatePreview.header"
                    class="official-template-header"
                  >
                    {{ selectedOfficialTemplatePreview.header }}
                  </div>
                  <div class="official-template-body">
                    {{ selectedOfficialTemplatePreview.body }}
                  </div>
                  <div
                    v-if="selectedOfficialTemplatePreview.footer"
                    class="official-template-footer"
                  >
                    {{ selectedOfficialTemplatePreview.footer }}
                  </div>
                  <div
                    v-if="selectedOfficialTemplatePreview.buttons.length"
                    class="official-template-buttons"
                  >
                    <div
                      v-for="(
                        button, index
                      ) in selectedOfficialTemplatePreview.buttons"
                      :key="`${button}-${index}`"
                      class="official-template-button"
                    >
                      <VIcon size="15">tabler-click</VIcon>
                      <span>{{ button }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>

        <div v-if="canShowSectorSelect" class="mb-6">
          <VLabel class="text-body-2 mb-1">{{ $t('sector') }}</VLabel>
          <AppSelectSearch
            v-model="selectedSectorId"
            :items="
              availableSectors.map((s) => ({
                value: s.sector_id,
                title: s.name,
                color: s.color,
              }))
            "
            :placeholder="$t('select_sector')"
            :clearable="true"
            :disabled="isOpenConversationFormBusy"
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
          </AppSelectSearch>
        </div>

        <VAlert
          v-if="
            workerConfigForChat?.allow_attendance_only_online &&
            cannotOpenConversation
          "
          type="warning"
          variant="tonal"
          density="compact"
          class="mt-4"
        >
          {{ $t('attendance_only_online_required') }}
        </VAlert>
      </VCardText>

      <VDivider />

      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          :disabled="isOpeningConversation"
          @click="handleCancelSelectChannelSector"
        >
          {{ $t('cancel') }}
        </VBtn>
        <VBtn
          :disabled="
            !selectedWorkerId ||
            isOpenConversationFormBusy ||
            chatStore.loading ||
            cannotOpenConversation ||
            !isOfficialOpeningReady
          "
          :loading="isOpenConversationFormBusy"
          @click="handleOpenConversation"
        >
          {{ openConversationActionLabel }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>

  <ChatContactAdvancedFiltersModal
    v-model="isContactAdvancedFiltersModalOpen"
    :filter-label="contactFilterLabel"
    :filter-phone-ddi="contactFilterPhoneDdi"
    :filter-phone="contactFilterPhone"
    :filter-name="contactFilterName"
    :filter-last-name="contactFilterLastName"
    :filter-nickname="contactFilterNickname"
    :filter-email="contactFilterEmail"
    :filter-birthday="contactFilterBirthday"
    :filter-document="contactFilterDocument"
    :filter-user-id="contactFilterUserId"
    :sort-field="contactSortField"
    :sort-order="contactSortOrder"
    @update:filter-label="contactFilterLabel = $event"
    @update:filter-phone-ddi="contactFilterPhoneDdi = $event"
    @update:filter-phone="contactFilterPhone = $event"
    @update:filter-name="contactFilterName = $event"
    @update:filter-last-name="contactFilterLastName = $event"
    @update:filter-nickname="contactFilterNickname = $event"
    @update:filter-email="contactFilterEmail = $event"
    @update:filter-birthday="contactFilterBirthday = $event"
    @update:filter-document="contactFilterDocument = $event"
    @update:filter-user-id="contactFilterUserId = $event"
    @update:sort-field="contactSortField = $event"
    @update:sort-order="contactSortOrder = $event"
    @filters-updated="handleContactFiltersUpdated"
  />

  <ChatAdvancedFiltersModal
    v-model="isAdvancedFiltersModalOpen"
    :filter-label="currentFilterLabelTemplateId"
    :filter-worker="currentFilterWorkerId"
    :filter-user="currentFilterUserId"
    :filter-sector="currentFilterSectorId"
    :filter-name="currentFilterName"
    :filter-phone="currentFilterPhone"
    :filter-protocol="currentFilterProtocol"
    :filter-date-start="currentFilterDateStart"
    :filter-date-end="currentFilterDateEnd"
    :filter-unread-conversations="currentFilterUnreadConversations"
    :sort-field="currentSortField"
    :sort-order="currentSortOrder"
    @update:filter-label="currentFilterLabelTemplateId = $event"
    @update:filter-worker="currentFilterWorkerId = $event"
    @update:filter-user="currentFilterUserId = $event"
    @update:filter-sector="currentFilterSectorId = $event"
    @update:filter-name="currentFilterName = $event"
    @update:filter-phone="handleFilterPhoneUpdate"
    @update:filter-protocol="currentFilterProtocol = $event"
    @update:filter-date-start="currentFilterDateStart = $event"
    @update:filter-date-end="currentFilterDateEnd = $event"
    @update:filter-unread-conversations="
      currentFilterUnreadConversations = $event
    "
    @update:sort-field="currentSortField = $event"
    @update:sort-order="currentSortOrder = $event"
    @update:model-value="isAdvancedFiltersModalOpen = $event"
    @filters-updated="handleFiltersUpdated"
  />

  <VDialog v-model="isBulkTransferDialogOpen" max-width="620">
    <DialogCloseBtn @click="isBulkTransferDialogOpen = false" />
    <VCard :title="$t('bulk_transfer_dialog_title')">
      <VCardText>
        <VRow>
          <VCol cols="12">
            <VLabel class="text-body-2 mb-1">{{ $t('channel') }} *</VLabel>
            <AppSelectSearch
              v-model="bulkTransferChannel"
              :items="bulkTransferChannels"
              :placeholder="$t('select_channel')"
              :loading="isLoadingBulkTransferChannels"
              item-value="value"
              item-title="title"
            />
          </VCol>

          <VCol cols="12">
            <VLabel class="text-body-2 mb-1">{{ $t('transfer_to') }}:</VLabel>
            <AppSelectSearch
              v-model="bulkTransferType"
              :items="[
                { value: 'user', title: $t('user') },
                { value: 'sector', title: $t('sector') },
              ]"
              :placeholder="$t('transfer_to_placeholder')"
              :clearable="true"
              :disabled="!bulkTransferChannel"
              item-value="value"
              item-title="title"
            />
          </VCol>

          <VCol v-if="bulkTransferType === 'user'" cols="12">
            <VLabel class="text-body-2 mb-1">{{ $t('user') }}:</VLabel>
            <AppSelectSearch
              v-model="bulkTransferUser"
              :items="bulkTransferUsers"
              :placeholder="$t('search') + '...'"
              :loading="isLoadingBulkTransferUsers"
              :disabled="!bulkTransferChannel"
              item-value="value"
              item-title="title"
            />
          </VCol>

          <template v-if="bulkTransferType === 'sector'">
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('sector') }}:</VLabel>
              <AppSelectSearch
                v-model="bulkTransferSector"
                :items="bulkTransferSectors"
                :placeholder="$t('search') + '...'"
                :loading="isLoadingBulkTransferSectors"
                :disabled="!bulkTransferChannel"
                item-value="value"
                item-title="title"
              />
            </VCol>

            <VCol v-if="bulkTransferSector" cols="12">
              <VLabel class="text-body-2 mb-1">
                {{ $t('user') }} ({{ $t('sector') }}):
              </VLabel>
              <AppSelectSearch
                v-model="bulkTransferSectorUser"
                :items="bulkTransferSectorUsers"
                :placeholder="$t('search') + '...'"
                :loading="isLoadingBulkTransferSectorUsers"
                :disabled="!bulkTransferChannel"
                item-value="value"
                item-title="title"
                :clearable="true"
              />
            </VCol>
          </template>

          <VCol cols="12">
            <VCheckbox
              v-model="bulkTransferKeepInChat"
              density="compact"
              hide-details
              :label="$t('keep_in_chat')"
            />
            <div class="text-caption text-medium-emphasis mt-1">
              {{ $t('keep_in_chat_description') }}
            </div>
          </VCol>

          <VCol v-if="shouldShowBulkTransferSendMessageToggle" cols="12">
            <div class="d-flex align-center justify-space-between gap-4">
              <div>
                <div class="text-body-1 font-weight-medium">
                  {{ $t('send_message_on_transfer') }}
                </div>
                <div class="text-body-2 text-medium-emphasis">
                  {{ $t('send_message_on_transfer_description') }}
                </div>
              </div>

              <VSwitch
                v-model="bulkTransferSendMessageOnTransfer"
                color="primary"
                hide-details
                inset
              />
            </div>
          </VCol>

          <VCol cols="12">
            <VLabel class="text-body-2 mb-1">{{ $t('annotation') }}:</VLabel>
            <VTextarea
              v-model="bulkTransferAnnotation"
              :placeholder="$t('write_your_annotation')"
              variant="outlined"
              :maxlength="5000"
              :rows="4"
              :auto-grow="true"
              :max-rows="8"
              counter
            />
          </VCol>
        </VRow>
      </VCardText>
      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          @click="isBulkTransferDialogOpen = false"
        >
          {{ $t('cancel') }}
        </VBtn>
        <VBtn
          color="primary"
          :loading="isBulkActionRunning"
          :disabled="
            !bulkTransferChannel ||
            (bulkTransferType === 'user'
              ? !bulkTransferUser
              : bulkTransferType === 'sector'
                ? !bulkTransferSector
                : false)
          "
          @click="runBulkTransferAction"
        >
          {{ $t('transfer') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>

  <VDialog v-model="isBulkCloseDialogOpen" max-width="520">
    <DialogCloseBtn @click="isBulkCloseDialogOpen = false" />
    <VCard :title="$t('bulk_close_dialog_title')">
      <VCardText>
        <div class="text-body-2 mb-3">
          {{ $t('bulk_target_count', { count: bulkTargetCount }) }}
        </div>
        <div class="d-flex align-center justify-space-between gap-4">
          <div>
            <div class="text-body-1 font-weight-medium">
              {{ $t('close_service_send_message_toggle_title') }}
            </div>
            <div class="text-body-2 text-medium-emphasis">
              {{ $t('close_service_send_message_toggle_description') }}
            </div>
          </div>

          <VSwitch
            v-model="bulkCloseSendMessageOnFinishAttendance"
            color="primary"
            hide-details
            inset
          />
        </div>
      </VCardText>
      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          @click="isBulkCloseDialogOpen = false"
        >
          {{ $t('cancel') }}
        </VBtn>
        <VBtn
          color="error"
          :loading="isBulkActionRunning"
          :disabled="!hasBulkSelection"
          @click="runBulkCloseAction"
        >
          {{ $t('close_service', 'Encerrar atendimento') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>

  <VDialog v-model="isBulkSummaryDialogOpen" max-width="620">
    <VCard :title="$t('bulk_summary_title')">
      <VCardText>
        <div class="d-flex flex-column gap-2">
          <div class="text-body-2">
            {{
              $t('bulk_target_count', {
                count: bulkSummary?.total_targeted || 0,
              })
            }}
          </div>
          <div class="text-body-2 text-success">
            {{
              $t('chat_bulk_action_success', {
                count: bulkSummary?.success_count || 0,
              })
            }}
          </div>
          <div
            v-if="(bulkSummary?.failed_count || 0) > 0"
            class="text-body-2 text-error"
          >
            {{ $t('bulk_failures_label') }}:
            {{ bulkSummary?.failed_count || 0 }}
          </div>
        </div>

        <VList
          v-if="bulkSummary?.failures?.length"
          density="compact"
          class="mt-4 bulk-failures-list"
        >
          <VListItem
            v-for="(failure, index) in bulkSummary.failures"
            :key="`${failure.chat_id || 'unknown'}-${index}`"
            lines="two"
          >
            <template #title>
              {{ failure.chat_id || '-' }}
            </template>
            <template #subtitle>
              {{ failure.message }}
            </template>
          </VListItem>
        </VList>
      </VCardText>
      <VCardText class="d-flex justify-end">
        <VBtn color="primary" @click="isBulkSummaryDialogOpen = false">
          {{ $t('ok', 'OK') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>

  <ChatNotificationSettingsDialog
    v-model="isNotificationSettingsDialogOpen"
    :settings="notificationSettings"
    :loading="loadingNotificationSettings"
    :saving="savingNotificationSettings"
    @save="saveNotificationSettings"
  />

  <ChatSortModal
    v-model="isSortModalOpen"
    :filter-type="sortModalFilterType"
    :sort-field="sortModalField"
    :sort-order="sortModalOrder"
    :in-chat-sort-field="inChatSortFieldForModal"
    :in-chat-sort-order="inChatSortOrderForModal"
    :queue-sort-field="queueSortFieldForModal"
    :queue-sort-order="queueSortOrderForModal"
    @update:sort-field="sortModalField = $event"
    @update:sort-order="sortModalOrder = $event"
    @save="handleSortSave"
  />
</template>

<style lang="scss">
.chat-list {
  --chat-content-spacing-x: 0px;

  padding-block-end: 0.75rem;

  .chat-header {
    margin-block: 0.5rem 0.75rem;
  }

  .chat-header,
  .no-chat-items-text {
    margin-inline: var(--chat-content-spacing-x);
  }
}

.chat-list-search {
  .v-field--focused {
    box-shadow: none !important;
  }
}

.contact-item {
  border-radius: 8px;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    opacity 0.2s ease;
  border: 1px solid transparent;

  &:hover {
    background-color: rgba(var(--v-theme-on-surface), 0.04);
  }

  &--editing {
    background-color: rgba(var(--v-theme-primary), 0.08);
    border-color: rgba(var(--v-theme-primary), 0.3);
  }

  &--not-validated {
    opacity: 0.6;

    &:hover {
      background-color: rgba(var(--v-theme-error), 0.04);
    }
  }
}

.contact-action-btn {
  opacity: 0;
  transition: opacity 0.2s ease;
}

.contact-item:hover .contact-action-btn {
  opacity: 1;
}

.chat-filter-options {
  .chat-filter-item {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-width: 0;
  }

  .chat-filter-btn {
    min-height: 48px;
    border-radius: 8px;
    padding: 8px;
    text-transform: none;
    font-weight: 400;
    min-width: 0;

    .v-btn__content {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  }

  .chat-filter-btn-wrapper {
    position: relative;
    width: 100%;
  }

  .chat-filter-count-badge {
    position: absolute;
    top: 4px;
    right: 4px;
    font-size: 0.65rem;
    height: 16px;
    font-weight: 600;
    line-height: 16px;
    background-color: rgb(var(--v-theme-primary));
    color: rgb(var(--v-theme-on-primary));
    display: inline-flex;
    align-items: center;
    justify-content: center;
    z-index: 1;

    &.badge-single-digit {
      width: 16px;
      min-width: 16px;
      padding: 0;
      border-radius: 50%;
    }

    &.badge-double-digit {
      min-width: 20px;
      padding: 0 5px;
      border-radius: 8px;
    }

    &.badge-triple-digit {
      min-width: 24px;
      padding: 0 6px;
      border-radius: 8px;
    }
  }

  .chat-filter-expanded-full {
    text-align: center;
    padding: 8px 12px;
    font-size: 0.875rem;
    font-weight: 500;
    color: rgb(var(--v-theme-on-surface));
    border-radius: 8px;
    background: rgba(var(--v-theme-primary), 0.08);
    margin-top: 8px;
    width: 100%;
  }

  .chat-filter-expanded-actions {
    margin-inline-start: auto;
    width: auto;
    flex: 0 0 auto;
    justify-content: flex-end;
  }

  .chat-bulk-toolbar {
    margin-top: 8px;
    padding: 10px 12px;
    border-radius: 8px;
    background: rgba(var(--v-theme-primary), 0.06);
    border: 1px solid rgba(var(--v-theme-primary), 0.18);
  }
}

.bulk-failures-list {
  max-height: 240px;
  overflow: auto;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 8px;
}

.official-opening-panel {
  display: grid;
  gap: 12px;
}

.official-template-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.official-template-variables {
  display: grid;
  gap: 10px;
  margin-bottom: 14px;
}

.official-template-variable-field {
  display: grid;
  gap: 4px;
}

.official-template-variable-label {
  color: rgb(var(--v-theme-primary));
  font-size: 0.72rem;
  font-weight: 600;
  line-height: 1.1;
}

.official-template-manual-variables {
  display: grid;
  gap: 10px;
  margin-bottom: 14px;
}

.official-template-manual-variables-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.78rem;
  font-weight: 600;
}

.official-template-manual-variable-row {
  display: grid;
  grid-template-columns: minmax(92px, 0.85fr) 72px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.official-template-preview {
  padding: 10px;
  border: 1px solid rgba(var(--v-theme-success), 0.18);
  border-radius: 10px;
  background: rgba(var(--v-theme-success), 0.08);
}

.official-template-preview-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
  color: rgb(var(--v-theme-success));
  font-size: 0.78rem;
  font-weight: 700;
}

.official-template-preview-name {
  display: flex;
  align-items: center;
  gap: 6px;
}

.official-template-bubble {
  width: min(100%, 430px);
  padding: 10px 12px 8px;
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  box-shadow: 0 6px 18px rgba(var(--v-theme-on-surface), 0.08);
}

.official-template-header {
  margin-bottom: 6px;
  font-size: 0.92rem;
  font-weight: 700;
  white-space: pre-wrap;
}

.official-template-body {
  font-size: 0.9rem;
  line-height: 1.45;
  white-space: pre-wrap;
}

.official-template-footer {
  margin-top: 8px;
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 0.78rem;
  white-space: pre-wrap;
}

.official-template-buttons {
  display: grid;
  gap: 6px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(var(--v-theme-success), 0.12);
}

.official-template-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 30px;
  color: rgb(var(--v-theme-info));
  font-size: 0.86rem;
  font-weight: 600;
}

.open-conversation-dialog {
  max-block-size: calc(100dvh - 24px);
}

.open-conversation-dialog__body {
  overflow-y: auto;
}

@media (max-width: 600px) {
  .official-template-manual-variable-row {
    grid-template-columns: minmax(0, 1fr) 74px auto;
  }

  .official-template-manual-variable-row > :nth-child(3) {
    grid-column: 1 / -1;
    grid-row: 2;
  }
}

.expand-enter-active,
.expand-leave-active {
  transition: all 0.3s ease;
  max-height: 50px;
  overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.filter-btn-white {
  background: rgb(var(--v-theme-surface)) !important;
  border: 1px solid rgba(var(--v-border-color), 0.12) !important;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08) !important;

  .v-icon {
    color: rgba(var(--v-theme-on-surface), 0.7) !important;
  }

  &:hover {
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.12) !important;
    background: rgb(var(--v-theme-primary)) !important;

    .v-icon {
      color: #fff !important;
    }
  }
}

.chat-section-label {
  inline-size: 100%;
  min-height: 40px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border: 1px solid rgba(var(--v-theme-primary), 0.22);
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.06);
}

.chat-section-label-title {
  color: rgb(var(--v-theme-primary));
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-section-label-action {
  flex: 0 0 auto;
  color: rgb(var(--v-theme-primary));
}

.chat-list-header {
  display: flex !important;
  flex-direction: column;
  align-items: stretch !important;
  min-block-size: auto !important;

  .d-flex {
    width: 100%;
  }

  .flex-grow-1 {
    flex: 1 1 0;
    min-width: 0;
  }
}
</style>
