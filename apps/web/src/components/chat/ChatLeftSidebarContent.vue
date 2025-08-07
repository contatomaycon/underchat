<script lang="ts" setup>
import { PerfectScrollbar } from 'vue3-perfect-scrollbar';
import ChatQueue from './ChatQueue.vue';
import { useChatStore } from '@/@webcore/stores/chat';
import { ListChatsQuery } from '@core/schema/chat/listChats/request.schema';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ListChatsResponse } from '@core/schema/chat/listChats/response.schema';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';

const emit = defineEmits<{
  (e: 'openChat', id: ListChatsResponse['chat_id']): void;
  (e: 'showUserProfile'): void;
  (e: 'close'): void;
  (e: 'update:search', value: string): void;
}>();

const props = defineProps<{
  isDrawerOpen: boolean;
  search: string;
}>();

const chatStore = useChatStore();

const fromQueue = ref(0);
const sizeQueue = ref(100);
const fromInChat = ref(0);
const sizeInChat = ref(100);

const modelSearch = computed({
  get: () => props.search,
  set: (value: string) => emit('update:search', value),
});

onMounted(async () => {
  const requestQueue: ListChatsQuery = {
    from: fromQueue.value,
    size: sizeQueue.value,
    status: EChatStatus.queue,
  };

  const requestInChat: ListChatsQuery = {
    from: fromInChat.value,
    size: sizeInChat.value,
    status: EChatStatus.in_chat,
  };

  await Promise.all([
    chatStore.listQueueChats(requestQueue),
    chatStore.listInChatChats(requestInChat),
  ]);
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
        <span v-else class="text-3xl">{{
          avatarText(chatStore.user?.info.name)
        }}</span>
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

  <PerfectScrollbar
    tag="ul"
    class="d-flex flex-column gap-y-1 chat-list px-3 py-2 list-none"
    :options="{ wheelPropagation: false }"
  >
    <li class="list-none">
      <h5 class="chat-header text-primary text-h5">
        {{ $t('in_service') }}
      </h5>
    </li>

    <ChatQueue
      v-for="inChat in chatStore.listInChat"
      :key="`chat-${inChat.chat_id}`"
      :user="inChat"
      @click="$emit('openChat', inChat.chat_id)"
    />

    <span
      v-show="!chatStore.listInChat.length"
      class="no-chat-items-text text-disabled"
      >{{ $t('no_chat_in_service') }}
    </span>
    <li class="list-none pt-2">
      <h5 class="chat-header text-primary text-h5">
        {{ $t('waiting_for_service') }}
      </h5>
    </li>

    <ChatQueue
      v-for="queue in chatStore.listQueue"
      :key="`chat-${queue.chat_id}`"
      :user="queue"
      @click="$emit('openChat', queue.chat_id)"
    />

    <span
      v-show="!chatStore.listQueue.length"
      class="no-chat-items-text text-disabled"
      >{{ $t('no_chat_in_queue') }}
    </span>
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
</style>
