<script lang="ts" setup>
import { PerfectScrollbar } from 'vue3-perfect-scrollbar';
import ChatQueue from './ChatQueue.vue';
import { useChatStore } from '@/@webcore/stores/chat';
import { ListChatsQuery } from '@core/schema/chat/listChats/request.schema';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ListChatsResult } from '@core/schema/chat/listChats/response.schema';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { can } from '@layouts/plugins/casl';

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

const currentPageQueue = ref(1);
const perPageQueue = ref(10);
const currentPageInChat = ref(1);
const perPageInChat = ref(10);

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

  <PerfectScrollbar :options="{ wheelPropagation: false }">
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
