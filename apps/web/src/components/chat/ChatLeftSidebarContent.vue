<script lang="ts" setup>
import { nextTick, computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { PerfectScrollbar } from 'vue3-perfect-scrollbar';
import ChatQueue from './ChatQueue.vue';
import AppAddContactChat from '@/components/chat/AppAddContactChat.vue';
import AppEditContactChat from '@/components/chat/AppEditContactChat.vue';
import ChatAdvancedFiltersModal from '@/components/chat/ChatAdvancedFiltersModal.vue';
import ChatContactAdvancedFiltersModal from '@/components/chat/ChatContactAdvancedFiltersModal.vue';
import ChatSortModal from '@/components/chat/ChatSortModal.vue';
import { useChatStore } from '@/@webcore/stores/chat';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { ListChatContactsResponse } from '@core/schema/chat/listContacts/response.schema';
import { ListChatsQuery } from '@core/schema/chat/listChats/request.schema';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ListChatsResult } from '@core/schema/chat/listChats/response.schema';
import type { IChat } from '@core/common/interfaces/IChat';
import { SearchChatsQuery } from '@core/schema/chat/searchChats/request.schema';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { ViewWorkerConfigForChatResponse } from '@core/schema/chat/viewWorkerConfigForChat/response.schema';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { can } from '@layouts/plugins/casl';
import { refDebounced } from '@vueuse/core';
import { EColor } from '@core/common/enums/EColor';
import VDialogHandler from '@/components/VDialogHandler.vue';
import { useTheme } from 'vuetify';
import {
  TransferWorker,
  TransferSector,
} from '@core/schema/chat/listTransferOptions/response.schema';

type OpenChatOptions = {
  skipClearSummary?: boolean;
};

const emit = defineEmits<{
  (e: 'openChat', id: ListChatsResult['chat_id'], options?: OpenChatOptions): void;
  (e: 'showUserProfile'): void;
  (e: 'close'): void;
  (e: 'update:search', value: string): void;
}>();

const props = defineProps<{
  isDrawerOpen: boolean;
  search: string;
}>();

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
const hoveredContactId = ref<string | null>(null);
const editingContactId = ref<string | null>(null);
const validatingContactId = ref<string | null>(null);
const isSelectChannelSectorModalOpen = ref(false);
const selectedContactForChat = ref<ListChatContactsResponse | null>(null);
const selectedWorkerId = ref<string | null>(null);
const selectedSectorId = ref<string | null>(null);
const availableWorkers = ref<TransferWorker[]>([]);
const availableSectors = ref<TransferSector[]>([]);
const workerConfigForChat = ref<ViewWorkerConfigForChatResponse | null>(null);
const isAdvancedFiltersModalOpen = ref(false);
const hasAppliedAdvancedFilters = ref(false);
const isContactAdvancedFiltersModalOpen = ref(false);

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
  closed?: number;
  my_chats: number;
} | null>(null);
const isLoadingWorkerConfigs = ref(false);
const isLoadingMoreQueue = ref(false);
const isLoadingMoreInChat = ref(false);
const chatScrollContainer = ref<InstanceType<typeof PerfectScrollbar> | null>(
  null
);

type FilterType =
  | 'new'
  | 'all'
  | 'in_chat'
  | 'queue'
  | 'chatbot'
  | 'my_chats'
  | 'closed';

type ChatExtrasSource = Pick<ListChatsResult, 'worker' | 'contact'>;

const activeFilter = ref<FilterType>('all');
const expandedFilter = ref<FilterType | null>('all');

const filteredInChat = computed(() => {
  if (activeFilter.value === 'in_chat') {
    return chatStore.listInChat;
  }
  if (activeFilter.value === 'all' && !hasActiveFilters.value) {
    return chatStore.listInChat;
  }
  if (activeFilter.value === 'all' && hasActiveFilters.value) {
    return chatStore.listInChat;
  }
  return [];
});

const filteredQueue = computed(() => {
  if (activeFilter.value === 'queue') {
    return chatStore.listQueue;
  }
  if (activeFilter.value === 'all' && !hasActiveFilters.value) {
    return chatStore.listQueue;
  }
  if (activeFilter.value === 'all' && hasActiveFilters.value) {
    return chatStore.listQueue;
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
        ...chatStore.listClosed,
      ];
      return allChats.filter((chat) => chat.user?.id === userId);
    }

    const allChats = [...chatStore.listInChat, ...chatStore.listQueue];
    return allChats.filter((chat) => chat.user?.id === userId);
  }
  return [];
});

const hasActiveFilters = computed(() => {
  return !!(
    hasAppliedAdvancedFilters.value ||
    searchQuery.value?.trim() ||
    currentFilterStatus.value ||
    currentFilterLabelTemplateId.value ||
    currentFilterWorkerId.value ||
    currentFilterUserId.value ||
    currentFilterSectorId.value ||
    currentFilterName.value ||
    currentFilterPhone.value ||
    currentFilterProtocol.value ||
    currentFilterDateStart.value ||
    currentFilterDateEnd.value
  );
});

const filteredChatbot = computed(() => {
  if (
    activeFilter.value === 'all' &&
    hasActiveFilters.value &&
    !hasAppliedAdvancedFilters.value
  ) {
    return chatStore.listChatbot;
  }
  if (activeFilter.value === 'chatbot') {
    return chatStore.listChatbot;
  }
  return [];
});

const showChatbotTitle = computed(() => {
  return (
    activeFilter.value === 'all' &&
    hasActiveFilters.value &&
    !hasAppliedAdvancedFilters.value
  );
});

const filteredClosed = computed(() => {
  if (
    activeFilter.value === 'all' &&
    hasActiveFilters.value &&
    !hasAppliedAdvancedFilters.value
  ) {
    return chatStore.listClosed;
  }
  return [];
});

const showClosedTitle = computed(() => {
  return (
    activeFilter.value === 'all' &&
    hasActiveFilters.value &&
    !hasAppliedAdvancedFilters.value &&
    chatStore.listClosed.length > 0
  );
});

const shouldUseEndpointCounts = computed(() => {
  return hasActiveFilters.value || activeFilter.value === 'my_chats';
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
      ...chatStore.listClosed,
    ];
    return allChats.filter((chat) => chat.user?.id === userId).length;
  }

  if (chatStore.myChatsTotal !== null) {
    return chatStore.myChatsTotal;
  }

  const allChats = [...chatStore.listInChat, ...chatStore.listQueue];
  return allChats.filter((chat) => chat.user?.id === userId).length;
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

const chatbotFilterPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EChatPermissions.chat_group,
  EChatPermissions.view_chatbot_messages,
];

const canViewChatbotTab = computed(() => can(chatbotFilterPermissions));

const isQueueChatSelectable = (index: number): boolean => {
  if (canSelectAnyQueueChat.value) {
    return true;
  }

  return index === 0;
};

const handleQueueClick = (
  chatId: ListChatsResult['chat_id'],
  index: number
): void => {
  if (!isQueueChatSelectable(index)) {
    return;
  }

  emit('openChat', chatId);
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
  }
};

const handleFiltersUpdated = async () => {
  hasAppliedAdvancedFilters.value = true;

  if (
    activeFilter.value !== 'all' &&
    activeFilter.value !== 'my_chats' &&
    activeFilter.value !== 'in_chat' &&
    activeFilter.value !== 'queue' &&
    activeFilter.value !== 'chatbot' &&
    activeFilter.value !== 'closed'
  ) {
    activeFilter.value = 'all';
    expandedFilter.value = 'all';
  }

  if (activeFilter.value === 'all') {
    currentPageQueue.value = 1;
    currentPageInChat.value = 1;
    chatStore.chatbotPagings.current_page = 1;
    closedPagings.value.current_page = 1;
    allChatsWithFiltersPagings.value.current_page = 1;
    await loadChatsByFilter();
  } else if (activeFilter.value === 'chatbot') {
    chatStore.chatbotPagings.current_page = 1;
    await loadChatbotChats();
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
  currentFilterStatus.value = null;
  currentFilterLabelTemplateId.value = null;
  currentFilterWorkerId.value = null;
  currentFilterUserId.value = null;
  currentFilterSectorId.value = null;
  currentFilterName.value = null;
  currentFilterPhone.value = null;
  currentFilterProtocol.value = null;
  currentFilterDateStart.value = null;
  currentFilterDateEnd.value = null;
  currentSortField.value = 'summary.last_message';
  currentSortOrder.value = 'desc';
  hasAppliedAdvancedFilters.value = false;

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
  listClosed.value = [];
  chatStore.listClosed = [];

  activeFilter.value = 'all';
  expandedFilter.value = 'all';

  currentPageQueue.value = 1;
  currentPageInChat.value = 1;
  chatStore.chatbotPagings.current_page = 1;
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
    (contactId) => !chatStore.chatContacts[contactId]
  );

  if (contactIdsToLoad.length === 0) {
    return;
  }

  await chatStore.getChatContactsByIds(contactIdsToLoad);
};

const currentFilterStatus = ref<string | null>(null);
const currentFilterLabelTemplateId = ref<string | null>(null);
const currentFilterWorkerId = ref<string | null>(null);
const currentFilterUserId = ref<string | null>(null);
const currentFilterSectorId = ref<string | null>(null);
const currentFilterName = ref<string | null>(null);
const currentFilterPhone = ref<string | null>(null);
const currentFilterProtocol = ref<string | null>(null);
const currentFilterDateStart = ref<string | null>(null);
const currentFilterDateEnd = ref<string | null>(null);
const currentSortField = ref<string | null>('summary.last_message');
const currentSortOrder = ref<string | null>('desc');

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
  }
  if (chatUser.sort_in_chat_order) {
    sortInChatOrder.value = chatUser.sort_in_chat_order;
    sortAllInChatOrder.value = chatUser.sort_in_chat_order;
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

const getChatUserFilters = () => {
  return {
    filter_status: currentFilterStatus.value ?? undefined,
    filter_label_template_id: currentFilterLabelTemplateId.value ?? undefined,
    filter_worker_id: currentFilterWorkerId.value ?? undefined,
    filter_user_id: currentFilterUserId.value ?? undefined,
    filter_sector_id: currentFilterSectorId.value ?? undefined,
    filter_name: currentFilterName.value ?? undefined,
    filter_phone: currentFilterPhone.value ?? undefined,
    filter_protocol: currentFilterProtocol.value ?? undefined,
    filter_date_start: currentFilterDateStart.value ?? undefined,
    filter_date_end: currentFilterDateEnd.value ?? undefined,
    sort_field: currentSortField.value ?? undefined,
    sort_order: currentSortOrder.value ?? undefined,
  };
};

const getSearchTerm = () => {
  return debouncedSearchQuery.value?.trim() || '';
};

const applyCounts = (counts: {
  total: number;
  queue: number;
  in_chat: number;
  chatbot: number;
  closed?: number;
  my_chats: number;
}) => {
  searchChatsCounts.value = counts;
  chatStore.myChatsTotal = counts.my_chats;
  chatStore.queuePagings.total = counts.queue;
  chatStore.inChatPagings.total = counts.in_chat;
  chatStore.chatbotPagings.total = counts.chatbot;
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

  return JSON.stringify(base);
};

const loadAllChats = async (append = false) => {
  const filters = getChatUserFilters();
  const searchTerm = getSearchTerm();

  const shouldUseCombinedSearch =
    activeFilter.value === 'my_chats' &&
    (hasAppliedAdvancedFilters.value || searchTerm);

  if (shouldUseCombinedSearch) {
    const response = await chatStore.resolveChatEndpoint(
      [EChatStatus.queue, EChatStatus.in_chat],
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

  const [inChatResponse, queueResponse] = await Promise.all([
    chatStore.resolveChatEndpoint(
      EChatStatus.in_chat,
      filters,
      hasAppliedAdvancedFilters.value,
      {
        current_page: currentPageInChat.value,
        per_page: perPageInChat.value,
      },
      append,
      searchTerm
    ),
    chatStore.resolveChatEndpoint(
      EChatStatus.queue,
      filters,
      hasAppliedAdvancedFilters.value,
      {
        current_page: currentPageQueue.value,
        per_page: perPageQueue.value,
      },
      append,
      searchTerm
    ),
  ]);

  if (inChatResponse.counts || queueResponse.counts) {
    const queueCount =
      queueResponse.counts?.queue ?? inChatResponse.counts?.queue ?? 0;
    const inChatCount =
      inChatResponse.counts?.in_chat ?? queueResponse.counts?.in_chat ?? 0;
    const combinedCounts = {
      total:
        inChatResponse.counts?.total ??
        queueResponse.counts?.total ??
        queueCount + inChatCount,
      queue: queueCount,
      in_chat: inChatCount,
      chatbot:
        inChatResponse.counts?.chatbot ?? queueResponse.counts?.chatbot ?? 0,
      closed: inChatResponse.counts?.closed ?? queueResponse.counts?.closed,
      my_chats:
        inChatResponse.counts?.my_chats ?? queueResponse.counts?.my_chats ?? 0,
    };
    applyCounts(combinedCounts);
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

const loadChatsByFilter = async (append = false) => {
  const loadKey = buildLoadKey(append);
  if (loadKey && inFlightLoadKey === loadKey && inFlightLoadPromise) {
    return inFlightLoadPromise;
  }

  const runLoad = async () => {
    if (activeFilter.value === 'all') {
      await loadAllChats(append);
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
        const hasMore = hasMoreQueue.value || hasMoreInChat.value;
        if (hasMore) {
          isLoadingMoreQueue.value = true;
          isLoadingMoreInChat.value = true;
          allChatsWithFiltersPagings.value.current_page += 1;

          if (searchQuery.value && searchQuery.value.trim().length > 0) {
            await performSearch(true);
          } else {
            await loadChatsByFilter(true);
          }

          isLoadingMoreQueue.value = false;
          isLoadingMoreInChat.value = false;
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
        }
        return;
      }

      const shouldLoadQueue = hasMoreQueue.value;
      const shouldLoadInChat = hasMoreInChat.value;

      if (shouldLoadQueue || shouldLoadInChat) {
        if (shouldLoadQueue) {
          isLoadingMoreQueue.value = true;
          currentPageQueue.value += 1;
        }

        if (shouldLoadInChat) {
          isLoadingMoreInChat.value = true;
          currentPageInChat.value += 1;
        }

        await loadChatsByFilter(true);

        isLoadingMoreQueue.value = false;
        isLoadingMoreInChat.value = false;
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
      isLoadingChatbot.value = true;
      chatStore.chatbotPagings.current_page += 1;
      await loadChatbotChats(true);
      isLoadingChatbot.value = false;
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
    const currentPage = append
      ? allChatsWithFiltersPagings.value.current_page
      : 1;

    const request: SearchChatsQuery = {
      current_page: currentPage,
      per_page: 50,
      search: debouncedSearchQuery.value.trim(),
      filter_status: filters.filter_status,
      filter_label_template_id: filters.filter_label_template_id,
      filter_worker_id: filters.filter_worker_id,
      filter_user_id: filters.filter_user_id,
      filter_sector_id: filters.filter_sector_id,
      filter_name: filters.filter_name,
      filter_phone: filters.filter_phone,
      filter_protocol: filters.filter_protocol,
      filter_date_start: filters.filter_date_start,
      filter_date_end: filters.filter_date_end,
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

      const queueChats: ListChatsResult[] = [];
      const inChatChats: ListChatsResult[] = [];
      const chatbotChats: ListChatsResult[] = [];
      const closedChats: ListChatsResult[] = [];

      for (const chat of result.results) {
        if (chat.status === EChatStatus.queue) {
          queueChats.push(chat);
        } else if (chat.status === EChatStatus.in_chat) {
          inChatChats.push(chat);
        } else if (chat.status === EChatStatus.ura) {
          chatbotChats.push(chat);
        } else if (chat.status === EChatStatus.closed) {
          closedChats.push(chat);
        }
      }

      if (append) {
        chatStore.listQueue.push(...queueChats);
        chatStore.listInChat.push(...inChatChats);
        chatStore.listChatbot.push(...chatbotChats);
        listClosed.value.push(...closedChats);
        chatStore.listClosed.push(...closedChats);
      } else {
        chatStore.listQueue = queueChats;
        chatStore.listInChat = inChatChats;
        chatStore.listChatbot = chatbotChats;
        listClosed.value = closedChats;
        chatStore.listClosed = closedChats;
      }

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

const loadWorkerConfigForSelectedWorker = async () => {
  if (!selectedWorkerId.value) {
    workerConfigForChat.value = null;
    return;
  }

  try {
    const config = await channelsStore.fetchWorkerConfigForChat(
      selectedWorkerId.value
    );
    workerConfigForChat.value = config;
  } catch (error) {
    console.error('Error loading worker config:', error);
    workerConfigForChat.value = null;
  }
};

watch(selectedWorkerId, () => {
  loadWorkerConfigForSelectedWorker().catch(() => {});
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

  if (!contact.is_valided) {
    chatStore.showSnackbar(
      chatStore.i18n.global.t('contact_must_be_validated'),
      EColor.warning
    );
    return;
  }

  selectedContactForChat.value = contact;
  selectedWorkerId.value = null;
  selectedSectorId.value = null;

  await loadTransferOptions();

  isSelectChannelSectorModalOpen.value = true;
};

const handleOpenConversation = async () => {
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

  try {
    const chat = await chatStore.startChatWithContact(
      selectedContactForChat.value.contact_id,
      selectedWorkerId.value,
      selectedSectorId.value
    );

    if (!chat) {
      return;
    }

    isSelectChannelSectorModalOpen.value = false;
    selectedContactForChat.value = null;
    selectedWorkerId.value = null;
    selectedSectorId.value = null;

    activeFilter.value = 'in_chat';
    expandedFilter.value = 'in_chat';
    await loadChatsByFilter();

    emit('openChat', chat.chat_id, { skipClearSummary: true });
  } catch (error: any) {
    console.error('Error starting chat with contact:', error);
  }
};

const handleCancelSelectChannelSector = () => {
  isSelectChannelSectorModalOpen.value = false;
  selectedContactForChat.value = null;
  selectedWorkerId.value = null;
  selectedSectorId.value = null;
};

watch(
  () => chatStore.activeChat?.status,
  (newStatus, oldStatus) => {
    if (newStatus === EChatStatus.in_chat) {
      if (oldStatus === EChatStatus.ura && activeFilter.value === 'chatbot') {
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
      }
    }
  }
);

let isHandlingChatStatusChanged = false;
let chatStatusChangedTimeout: ReturnType<typeof setTimeout> | null = null;
const pendingNewChats = new Map<string, ChatExtrasSource>();

const handleChatStatusChanged = async (event: Event) => {
  const detail = (event as CustomEvent<{ chat: IChat; reason?: string }>)
    .detail;
  if (!detail || detail.reason !== 'new') {
    return;
  }

  if (detail.chat?.chat_id) {
    pendingNewChats.set(detail.chat.chat_id, detail.chat);
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
      const chatsToLoad = Array.from(pendingNewChats.values());
      pendingNewChats.clear();

      if (chatsToLoad.length === 0) {
        return;
      }

      await Promise.all([
        loadWorkerConfigs(chatsToLoad),
        loadChatContacts(chatsToLoad),
      ]);
    } finally {
      isHandlingChatStatusChanged = false;
      chatStatusChangedTimeout = null;
    }
  }, 100);
};

onMounted(async () => {
  await loadChatsByFilter();

  globalThis.addEventListener('chat-status-changed', handleChatStatusChanged);
});

onUnmounted(() => {
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
  scrollToTop,
  hasAppliedAdvancedFilters,
});
</script>

<template>
  <div class="chat-list-header px-3 py-3">
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
              'cursor-pointer': contact.is_valided,
              'cursor-not-allowed': !contact.is_valided,
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
                <VChip
                  v-if="contact.is_valided"
                  size="x-small"
                  color="success"
                  variant="flat"
                  class="contact-validation-chip contact-validation-chip--validated"
                >
                  <VIcon size="10" class="me-0">tabler-check</VIcon>
                </VChip>
                <VChip
                  v-else
                  size="x-small"
                  color="error"
                  variant="flat"
                  class="contact-validation-chip contact-validation-chip--not-validated"
                >
                  <VIcon size="10" class="me-0">tabler-x</VIcon>
                </VChip>
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
        <template v-if="isLoadingChatbot || isLoadingWorkerConfigs">
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
            v-for="chat in chatStore.listChatbot"
            :key="`chatbot-${chat.chat_id}`"
            :user="chat"
            @click="$emit('openChat', chat.chat_id)"
          />

          <li
            v-if="!chatStore.listChatbot.length"
            class="no-chat-items-text text-disabled"
          >
            {{ $t('no_chat_in_ura') }}
          </li>

          <template v-if="isLoadingChatbot">
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
            v-for="chat in chatStore.listClosed"
            :key="`closed-${chat.chat_id}`"
            :user="chat"
            @click="$emit('openChat', chat.chat_id)"
          />

          <li
            v-if="!chatStore.listClosed.length"
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

  <template v-else-if="activeFilter === 'my_chats'">
    <PerfectScrollbar
      ref="chatScrollContainer"
      :options="{ wheelPropagation: false }"
      @ps-scroll-y="handleChatScroll"
    >
      <ul class="d-flex flex-column gap-y-1 chat-list px-3 py-2 list-none">
        <template v-if="chatStore.loadingChats || isLoadingWorkerConfigs">
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
            v-for="chat in filteredMyChats"
            :key="`my-chat-${chat.chat_id}`"
            :user="chat"
            @click="$emit('openChat', chat.chat_id)"
          />

          <li
            v-if="!filteredMyChats.length"
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
        <template v-if="chatStore.loadingChats || isLoadingWorkerConfigs">
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
            v-for="inChat in filteredInChat"
            :key="`chat-${inChat.chat_id}`"
            :user="inChat"
            @click="$emit('openChat', inChat.chat_id)"
          />
          <li
            v-if="!filteredInChat.length"
            class="no-chat-items-text text-disabled"
          >
            {{ $t('no_chat_in_service') }}
          </li>
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
        <template v-if="chatStore.loadingChats || isLoadingWorkerConfigs">
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
            v-for="(queue, index) in filteredQueue"
            :key="`chat-${queue.chat_id}`"
            :user="queue"
            :disabled="!isQueueChatSelectable(index)"
            @click="handleQueueClick(queue.chat_id, index)"
          />
          <li
            v-if="!filteredQueue.length"
            class="no-chat-items-text text-disabled"
          >
            {{ $t('no_chat_in_queue') }}
          </li>
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
      <template v-if="chatStore.loadingChats || isLoadingWorkerConfigs">
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
        <li v-if="showInChatTitle" class="list-none">
          <h5 class="chat-header text-primary text-h5">
            {{ $t('in_service') }}
          </h5>
        </li>

        <ChatQueue
          v-for="inChat in filteredInChat"
          :key="`chat-${inChat.chat_id}`"
          :user="inChat"
          @click="$emit('openChat', inChat.chat_id)"
        />

        <li
          v-if="
            !filteredInChat.length &&
            (activeFilter === 'all' || activeFilter === 'in_chat')
          "
          class="no-chat-items-text text-disabled"
        >
          {{ $t('no_chat_in_service') }}
        </li>

        <li v-if="showQueueTitle" class="list-none pt-2">
          <h5 class="chat-header text-primary text-h5">
            {{ $t('waiting_for_service') }}
          </h5>
        </li>

        <ChatQueue
          v-for="(queue, index) in filteredQueue"
          :key="`chat-${queue.chat_id}`"
          :user="queue"
          :disabled="!isQueueChatSelectable(index)"
          @click="handleQueueClick(queue.chat_id, index)"
        />

        <li
          v-if="
            !filteredQueue.length &&
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
          @click="$emit('openChat', chatbot.chat_id)"
        />

        <li
          v-if="
            showChatbotTitle &&
            canViewChatbotTab &&
            !filteredChatbot.length &&
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
          @click="$emit('openChat', closed.chat_id)"
        />

        <li
          v-if="showClosedTitle && !filteredClosed.length && !isLoadingClosed"
          class="no-chat-items-text text-disabled"
        >
          Nenhum chat fechado
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

  <VDialog v-model="isSelectChannelSectorModalOpen" max-width="600" persistent>
    <VCard>
      <VCardTitle class="d-flex align-center justify-space-between">
        <span>{{ $t('select_channel_sector') }}</span>
        <IconBtn @click="handleCancelSelectChannelSector">
          <VIcon>tabler-x</VIcon>
        </IconBtn>
      </VCardTitle>

      <VDivider />

      <VCardText class="pt-6">
        <div class="mb-6">
          <VLabel class="text-body-2 mb-1">{{ $t('channel') }} *</VLabel>
          <AppSelectSearch
            v-model="selectedWorkerId"
            :items="
              availableWorkers.map((w) => ({
                value: w.id,
                title: w.number ? `${w.name} (${w.number})` : w.name,
                name: w.name,
                number: w.number,
              }))
            "
            :placeholder="$t('select_channel')"
            item-value="value"
            item-title="title"
          />
          <div v-if="selectedWorkerId" class="mt-2">
            <VChip
              size="small"
              color="primary"
              variant="tonal"
              class="channel-tag"
            >
              <VIcon size="16" class="me-1">tabler-device-mobile</VIcon>
              {{
                availableWorkers.find(
                  (w: TransferWorker) => w.id === selectedWorkerId
                )?.name
              }}
              <span
                v-if="
                  availableWorkers.find((w) => w.id === selectedWorkerId)
                    ?.number
                "
                class="ms-1 text-caption"
              >
                ({{
                  availableWorkers.find((w) => w.id === selectedWorkerId)
                    ?.number
                }})
              </span>
            </VChip>
          </div>
        </div>

        <div class="mb-6">
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
          @click="handleCancelSelectChannelSector"
        >
          {{ $t('cancel') }}
        </VBtn>
        <VBtn
          :disabled="
            !selectedWorkerId || chatStore.loading || cannotOpenConversation
          "
          :loading="chatStore.loading"
          @click="handleOpenConversation"
        >
          {{ $t('open_conversation') }}
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
    :filter-status="currentFilterStatus"
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
    :sort-field="currentSortField"
    :sort-order="currentSortOrder"
    @update:filter-status="currentFilterStatus = $event"
    @update:filter-label="currentFilterLabelTemplateId = $event"
    @update:filter-worker="currentFilterWorkerId = $event"
    @update:filter-user="currentFilterUserId = $event"
    @update:filter-sector="currentFilterSectorId = $event"
    @update:filter-name="currentFilterName = $event"
    @update:filter-phone="currentFilterPhone = $event"
    @update:filter-protocol="currentFilterProtocol = $event"
    @update:filter-date-start="currentFilterDateStart = $event"
    @update:filter-date-end="currentFilterDateEnd = $event"
    @update:sort-field="currentSortField = $event"
    @update:sort-order="currentSortOrder = $event"
    @update:model-value="isAdvancedFiltersModalOpen = $event"
    @filters-updated="handleFiltersUpdated"
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

.contact-validation-chip {
  font-size: 0.5rem;
  height: 16px;
  min-width: 16px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.2s ease;

  &--validated {
    background-color: rgba(var(--v-theme-success), 0.12) !important;
    color: rgb(var(--v-theme-success)) !important;
  }

  &--not-validated {
    background-color: rgba(var(--v-theme-error), 0.12) !important;
    color: rgb(var(--v-theme-error)) !important;
  }

  .v-icon {
    font-size: 10px;
    width: 10px;
    height: 10px;
  }
}

.contact-action-btn {
  opacity: 0;
  transition: opacity 0.2s ease;
}

.contact-item:hover .contact-action-btn {
  opacity: 1;
}

.contact-item:hover .contact-validation-chip {
  opacity: 0;
}

.chat-filter-options {
  .d-flex {
    width: 100%;
  }

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

.chat-list-header {
  .d-flex {
    width: 100%;
  }

  .flex-grow-1 {
    flex: 1 1 0;
    min-width: 0;
  }
}
</style>
