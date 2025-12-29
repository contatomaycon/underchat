<script lang="ts" setup>
import { PerfectScrollbar } from 'vue3-perfect-scrollbar';
import ChatQueue from './ChatQueue.vue';
import AppAddContactChat from '@/components/chat/AppAddContactChat.vue';
import AppEditContactChat from '@/components/chat/AppEditContactChat.vue';
import { useChatStore } from '@/@webcore/stores/chat';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { ListChatContactsResponse } from '@core/schema/chat/listContacts/response.schema';
import { ListChatsQuery } from '@core/schema/chat/listChats/request.schema';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ListChatsResult } from '@core/schema/chat/listChats/response.schema';
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

const emit = defineEmits<{
  (e: 'openChat', id: ListChatsResult['chat_id']): void;
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
const perPageQueue = ref(10);
const currentPageInChat = ref(1);
const perPageInChat = ref(10);

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
const contactScrollContainer = ref<InstanceType<
  typeof PerfectScrollbar
> | null>(null);
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

const chatbotPagings = ref({
  current_page: 1,
  total_pages: 1,
  per_page: 50,
  count: 0,
  total: 0,
});
const isLoadingChatbot = ref(false);

type FilterType = 'new' | 'all' | 'in_chat' | 'queue' | 'chatbot' | 'my_chats';

const activeFilter = ref<FilterType>('all');
const expandedFilter = ref<FilterType | null>('all');

const filteredInChat = computed(() => {
  if (activeFilter.value === 'all' || activeFilter.value === 'in_chat') {
    return chatStore.listInChat;
  }
  return [];
});

const filteredQueue = computed(() => {
  if (activeFilter.value === 'all' || activeFilter.value === 'queue') {
    return chatStore.listQueue;
  }
  return [];
});

const filteredMyChats = computed(() => {
  if (activeFilter.value === 'my_chats') {
    const userId = chatStore.user?.user_id;
    if (!userId) return [];

    const allChats = [...chatStore.listInChat, ...chatStore.listQueue];
    return allChats.filter((chat) => chat.user?.id === userId);
  }
  return [];
});

const allChatsCount = computed(() => {
  return chatStore.listInChat.length + chatStore.listQueue.length;
});

const inChatCount = computed(() => {
  return chatStore.listInChat.length;
});

const queueCount = computed(() => {
  return chatStore.listQueue.length;
});

const myChatsCount = computed(() => {
  const userId = chatStore.user?.user_id;
  if (!userId) return 0;

  const allChats = [...chatStore.listInChat, ...chatStore.listQueue];
  return allChats.filter((chat) => chat.user?.id === userId).length;
});

const chatbotCount = computed(() => {
  if (activeFilter.value === 'chatbot' && chatbotPagings.value.total > 0) {
    return chatbotPagings.value.total;
  }

  if (chatbotPagings.value.total > 0) {
    return chatbotPagings.value.total;
  }

  return chatStore.listChatbot.length;
});

const showInChatTitle = computed(() => {
  return activeFilter.value === 'all';
});

const showQueueTitle = computed(() => {
  return activeFilter.value === 'all';
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
    loadChatsByFilter();
  } else if (filter === 'new') {
    currentPageContacts.value = 1;
    accumulatedContacts.value = [];
    loadContacts();
  } else if (filter === 'chatbot') {
    chatbotPagings.value.current_page = 1;
    loadChatbotChats();
  } else if (filter === 'my_chats') {
    loadChatsByFilter();
  }
};

const loadChatsByFilter = async () => {
  if (activeFilter.value === 'all' || activeFilter.value === 'my_chats') {
    const requestQueue: ListChatsQuery = {
      current_page: currentPageQueue.value,
      per_page: perPageQueue.value,
      status: EChatStatus.queue,
    };

    const requestInChat: ListChatsQuery = {
      current_page: currentPageInChat.value,
      per_page: perPageInChat.value,
      status: EChatStatus.in_chat,
    };

    await Promise.all([
      chatStore.listQueueChats(requestQueue),
      chatStore.listInChatChats(requestInChat),
    ]);
  } else if (activeFilter.value === 'in_chat') {
    const requestInChat: ListChatsQuery = {
      current_page: currentPageInChat.value,
      per_page: perPageInChat.value,
      status: EChatStatus.in_chat,
    };

    await chatStore.listInChatChats(requestInChat);
  } else if (activeFilter.value === 'queue') {
    const requestQueue: ListChatsQuery = {
      current_page: currentPageQueue.value,
      per_page: perPageQueue.value,
      status: EChatStatus.queue,
    };

    await chatStore.listQueueChats(requestQueue);
  }
};

const loadContacts = async (append = false) => {
  if (isLoadingMoreContacts.value) return;

  isLoadingMoreContacts.value = true;

  try {
    const result = await chatStore.listChatContacts(
      currentPageContacts.value,
      perPageContacts.value,
      debouncedContactSearch.value || undefined
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

const loadChatbotChats = async () => {
  if (isLoadingChatbot.value) return;

  isLoadingChatbot.value = true;

  try {
    const request: ListChatsQuery = {
      current_page: chatbotPagings.value.current_page,
      per_page: chatbotPagings.value.per_page,
      status: EChatStatus.ura,
    };

    const result = await chatStore.listChatbotChats(request);
    if (result) {
      chatbotPagings.value = result.pagings;
    }
  } finally {
    isLoadingChatbot.value = false;
  }
};

const hasMoreContacts = computed(() => {
  return currentPageContacts.value < contactsTotalPages.value;
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

const performSearch = async () => {
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
    return;
  }

  isSearching.value = true;
  try {
    const request: SearchChatsQuery = {
      current_page: 1,
      per_page: 20,
      search: debouncedSearchQuery.value.trim(),
    };

    const result = await chatStore.searchChats(request);

    if (result) {
      searchResults.value = result.results;
      searchPagings.value = result.pagings;
    } else {
      searchResults.value = [];
      searchPagings.value = {
        current_page: 1,
        total_pages: 1,
        per_page: 20,
        count: 0,
        total: 0,
      };
    }
  } catch {
    searchResults.value = [];
  } finally {
    isSearching.value = false;
  }
};

watch(debouncedSearchQuery, () => {
  performSearch();
});

watch(
  () => activeFilter.value,
  () => {
    searchQuery.value = '';
    searchResults.value = [];
  }
);

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
  void loadWorkerConfigForSelectedWorker();
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

    emit('openChat', chat.chat_id);
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

const loadChatbotCount = async () => {
  if (!canViewChatbotTab.value) return;

  try {
    const request: ListChatsQuery = {
      current_page: 1,
      per_page: 1,
      status: EChatStatus.ura,
    };

    const result = await chatStore.listChatbotChats(request);
    if (result) {
      chatbotPagings.value.total = result.pagings.total;
    }
  } catch {
    chatbotPagings.value.total = 0;
  }
};

watch(
  () => chatStore.listChatbot.length,
  (newLength, oldLength) => {
    if (chatbotPagings.value.total > 0 && newLength < oldLength) {
      chatbotPagings.value.total = Math.max(0, chatbotPagings.value.total - 1);
    }
  }
);

watch(
  () => chatStore.activeChat?.status,
  (newStatus, oldStatus) => {
    if (newStatus === EChatStatus.in_chat) {
      if (oldStatus === EChatStatus.ura && activeFilter.value === 'chatbot') {
        activeFilter.value = 'in_chat';
        expandedFilter.value = 'in_chat';
        void loadChatsByFilter();
      } else if (
        oldStatus === EChatStatus.queue &&
        (activeFilter.value === 'queue' || activeFilter.value === 'all')
      ) {
        if (activeFilter.value === 'queue') {
          activeFilter.value = 'in_chat';
          expandedFilter.value = 'in_chat';
        }
        void loadChatsByFilter();
      }
    }
  }
);

onMounted(async () => {
  await Promise.all([loadChatsByFilter(), loadChatbotCount()]);
});
</script>

<template>
  <div class="chat-list-header">
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
      class="ms-4 me-1 chat-list-search"
      :loading="isSearching"
    />

    <IconBtn v-if="$vuetify.display.smAndDown" @click="$emit('close')">
      <VIcon icon="tabler-x" class="text-medium-emphasis" />
    </IconBtn>
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
          <span v-if="allChatsCount > 0" class="chat-filter-count-badge">
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
          <span v-if="inChatCount > 0" class="chat-filter-count-badge">
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
          <span v-if="myChatsCount > 0" class="chat-filter-count-badge">
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
          <span v-if="queueCount > 0" class="chat-filter-count-badge">
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
          <span v-if="chatbotCount > 0" class="chat-filter-count-badge">
            {{ chatbotCount }}
          </span>
        </div>
      </div>
    </div>
    <Transition name="expand">
      <div v-if="expandedFilter" class="chat-filter-expanded-full">
        {{
          expandedFilter === 'new'
            ? $t('new', 'Novo')
            : expandedFilter === 'all'
              ? $t('all', 'Todos')
              : expandedFilter === 'in_chat'
                ? $t('in_service')
                : expandedFilter === 'queue'
                  ? $t('waiting_for_service')
                  : expandedFilter === 'my_chats'
                    ? $t('my_chats', 'Meus atendimentos')
                    : $t('chatbot', 'ChatBot')
        }}
      </div>
    </Transition>
  </div>

  <VDivider />

  <template v-if="searchQuery && searchQuery.trim().length > 0">
    <PerfectScrollbar
      :options="{ wheelPropagation: false }"
      class="flex-grow-1"
    >
      <ul class="d-flex flex-column gap-y-1 chat-list px-3 py-2 list-none">
        <li v-if="isSearching" class="no-chat-items-text text-disabled">
          {{ $t('searching') }}
        </li>
        <template v-else>
          <ChatQueue
            v-for="result in searchResults"
            :key="`search-${result.chat_id}`"
            :user="result"
            @click="$emit('openChat', result.chat_id)"
          />
          <li
            v-if="!searchResults.length && !isSearching"
            class="no-chat-items-text text-disabled"
          >
            {{ $t('no_results_found') }}
          </li>
        </template>
      </ul>
    </PerfectScrollbar>
  </template>

  <template v-else-if="activeFilter === 'new'">
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
        />
        <VBtn
          color="primary"
          prepend-icon="tabler-plus"
          @click="isAddContactModalOpen = true"
        >
          {{ $t('add') }}
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
                @click.stop="handleValidateContact(contact.contact_id, $event)"
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

        <li
          v-if="chatStore.loading || isLoadingMoreContacts"
          class="d-flex justify-center pa-4"
        >
          <VProgressCircular indeterminate color="primary" size="32" />
        </li>
      </ul>
    </PerfectScrollbar>
  </template>

  <template v-else-if="activeFilter === 'chatbot'">
    <PerfectScrollbar :options="{ wheelPropagation: false }">
      <ul class="d-flex flex-column gap-y-1 chat-list px-3 py-2 list-none">
        <template v-if="isLoadingChatbot">
          <li
            v-for="i in 5"
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
        </template>
      </ul>
    </PerfectScrollbar>
  </template>

  <template v-else-if="activeFilter === 'my_chats'">
    <PerfectScrollbar :options="{ wheelPropagation: false }">
      <ul class="d-flex flex-column gap-y-1 chat-list px-3 py-2 list-none">
        <template v-if="chatStore.loading">
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
        </template>
      </ul>
    </PerfectScrollbar>
  </template>

  <PerfectScrollbar v-else :options="{ wheelPropagation: false }">
    <ul class="d-flex flex-column gap-y-1 chat-list px-3 py-2 list-none">
      <template v-if="chatStore.loading">
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
    min-width: 16px;
    padding: 0 4px;
    font-weight: 600;
    line-height: 16px;
    border-radius: 8px;
    background-color: rgb(var(--v-theme-primary));
    color: rgb(var(--v-theme-on-primary));
    display: inline-flex;
    align-items: center;
    justify-content: center;
    z-index: 1;
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
</style>
