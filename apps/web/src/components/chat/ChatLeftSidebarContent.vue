<script lang="ts" setup>
import { PerfectScrollbar } from 'vue3-perfect-scrollbar';
import ChatQueue from './ChatQueue.vue';
import AppAddContact from '@/components/contact/AppAddContact.vue';
import { useChatStore } from '@/@webcore/stores/chat';
import { useContactStore } from '@/@webcore/stores/contact';
import { ListChatsQuery } from '@core/schema/chat/listChats/request.schema';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ListChatsResult } from '@core/schema/chat/listChats/response.schema';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { can } from '@layouts/plugins/casl';
import { refDebounced } from '@vueuse/core';
import { ListContactResponse } from '@core/schema/contact/listContact/response.schema';
import axios from '@webcore/axios';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { IChat } from '@core/common/interfaces/IChat';
import { EColor } from '@core/common/enums/EColor';

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
const contactStore = useContactStore();

const currentPageQueue = ref(1);
const perPageQueue = ref(10);
const currentPageInChat = ref(1);
const perPageInChat = ref(10);

const contactSearchQuery = ref('');
const debouncedContactSearch = refDebounced(contactSearchQuery, 500);
const currentPageContacts = ref(1);
const perPageContacts = ref(50);
const isAddContactModalOpen = ref(false);
const isLoadingMoreContacts = ref(false);
const contactScrollContainer = ref<InstanceType<
  typeof PerfectScrollbar
> | null>(null);
const accumulatedContacts = ref<ListContactResponse[]>([]);

type FilterType = 'new' | 'all' | 'in_chat' | 'queue' | 'chatbot';

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

const modelSearch = computed({
  get: () => props.search,
  set: (value: string) => emit('update:search', value),
});

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
  }
};

const loadChatsByFilter = async () => {
  if (activeFilter.value === 'all') {
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
  if (isLoadingMoreContacts.value || contactStore.loading) return;

  isLoadingMoreContacts.value = true;

  try {
    const result = await contactStore.listContact({
      page: currentPageContacts.value,
      per_page: perPageContacts.value,
      sort_by: [],
      search: debouncedContactSearch.value || undefined,
    });

    if (result) {
      if (append) {
        accumulatedContacts.value.push(...result.results);
      } else {
        accumulatedContacts.value = [...result.results];
      }
    }
  } finally {
    isLoadingMoreContacts.value = false;
  }
};

const hasMoreContacts = computed(() => {
  const pagings = contactStore.pagings;
  return currentPageContacts.value < pagings.total_pages;
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
    !isLoadingMoreContacts.value &&
    !contactStore.loading
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

watch(debouncedContactSearch, () => {
  currentPageContacts.value = 1;
  accumulatedContacts.value = [];
  loadContacts();
});

const handleContactClick = async (contact: ListContactResponse) => {
  if (!contact.phone_partial) {
    contactStore.showSnackbar(
      chatStore.i18n.global.t('contact_phone_required'),
      EColor.warning
    );
    return;
  }

  try {
    chatStore.loading = true;

    const phone = contact.phone_partial.replaceAll(/\D/g, '');

    let workerId = chatStore.activeChat?.worker?.id;

    if (!workerId) {
      const anyChat = chatStore.listInChat[0] || chatStore.listQueue[0];

      workerId = anyChat?.worker?.id;
    }

    if (!workerId) {
      throw new Error('Worker ID not found');
    }

    const response = await axios.post<IApiResponse<IChat>>('/chat', {
      worker_id: workerId,
      phone: phone,
      name: contact.name + (contact.last_name ? ` ${contact.last_name}` : ''),
    });

    chatStore.loading = false;

    const data = response?.data;

    if (!data?.status || !data?.data) {
      const errorMessage =
        data?.message || chatStore.i18n.global.t('chat_creation_error');
      chatStore.showSnackbar(errorMessage, EColor.error);
      return;
    }

    emit('openChat', data.data.chat_id);
  } catch (error: any) {
    chatStore.loading = false;
    const errorMessage =
      error?.response?.data?.message ||
      chatStore.i18n.global.t('chat_creation_error');
    chatStore.showSnackbar(errorMessage, EColor.error);
  }
};

onMounted(async () => {
  await loadChatsByFilter();
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
          chatStore.user?.chat_user?.status as EChatUserStatus
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
      v-model="modelSearch"
      placeholder="Search..."
      prepend-inner-icon="tabler-search"
      class="ms-4 me-1 chat-list-search"
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
        <VBtn
          :variant="activeFilter === 'all' ? 'flat' : 'text'"
          :color="activeFilter === 'all' ? 'primary' : undefined"
          class="chat-filter-btn w-100"
          @click="handleFilterClick('all')"
        >
          <VIcon size="24">tabler-list</VIcon>
        </VBtn>
      </div>
      <div class="chat-filter-item flex-grow-1">
        <VBtn
          :variant="activeFilter === 'in_chat' ? 'flat' : 'text'"
          :color="activeFilter === 'in_chat' ? 'primary' : undefined"
          class="chat-filter-btn w-100"
          @click="handleFilterClick('in_chat')"
        >
          <VIcon size="24">tabler-message-circle</VIcon>
        </VBtn>
      </div>
      <div class="chat-filter-item flex-grow-1">
        <VBtn
          :variant="activeFilter === 'queue' ? 'flat' : 'text'"
          :color="activeFilter === 'queue' ? 'primary' : undefined"
          class="chat-filter-btn w-100"
          @click="handleFilterClick('queue')"
        >
          <VIcon size="24">tabler-clock</VIcon>
        </VBtn>
      </div>
      <div class="chat-filter-item flex-grow-1">
        <VBtn
          :variant="activeFilter === 'chatbot' ? 'flat' : 'text'"
          :color="activeFilter === 'chatbot' ? 'primary' : undefined"
          class="chat-filter-btn w-100"
          @click="handleFilterClick('chatbot')"
        >
          <VIcon size="24">tabler-robot</VIcon>
        </VBtn>
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
                  : $t('chatbot', 'ChatBot')
        }}
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
          class="contact-item d-flex align-center gap-3 pa-3 cursor-pointer"
          @click="handleContactClick(contact)"
        >
          <VAvatar size="40" color="primary" variant="tonal">
            <VIcon size="20">tabler-user</VIcon>
          </VAvatar>
          <div class="flex-grow-1">
            <div class="text-body-1 font-weight-medium">
              {{ contact.name }}
              {{ contact.last_name || '' }}
            </div>
            <div
              v-if="contact.phone_partial"
              class="text-caption text-disabled"
            >
              {{ contact.phone_partial }}
            </div>
          </div>
        </li>

        <li
          v-if="
            !accumulatedContacts.length &&
            !contactStore.loading &&
            !isLoadingMoreContacts
          "
          class="no-chat-items-text text-disabled"
        >
          {{ $t('no_contacts_found') }}
        </li>

        <li
          v-if="contactStore.loading || isLoadingMoreContacts"
          class="d-flex justify-center pa-4"
        >
          <VProgressCircular indeterminate color="primary" size="32" />
        </li>
      </ul>
    </PerfectScrollbar>
  </template>

  <PerfectScrollbar v-else :options="{ wheelPropagation: false }">
    <ul class="d-flex flex-column gap-y-1 chat-list px-3 py-2 list-none">
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
    </ul>
  </PerfectScrollbar>

  <AppAddContact
    v-model="isAddContactModalOpen"
    @update:model-value="handleAddContactModalClose"
  />
</template>

<style lang="scss">
.chat-list {
  --chat-content-spacing-x: 16px;

  padding-block-end: 0.75rem;

  .chat-header {
    margin-block: 0.5rem 0.25rem;
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
  transition: background-color 0.2s ease;

  &:hover {
    background-color: rgba(var(--v-theme-on-surface), 0.04);
  }
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
