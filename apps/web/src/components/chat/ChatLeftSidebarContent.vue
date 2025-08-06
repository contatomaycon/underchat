<script lang="ts" setup>
import { PerfectScrollbar } from 'vue3-perfect-scrollbar';
import ChatQueue from './ChatQueue.vue';
import { useChatStore } from '@/@webcore/stores/chat';
import { ListChatsQuery } from '@core/schema/chat/listChats/request.schema';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ListChatsResponse } from '@core/schema/chat/listChats/response.schema';

defineEmits<{
  (e: 'openChatOfContact', id: ListChatsResponse['chat_id']): void;
  (e: 'showUserProfile'): void;
  (e: 'close'): void;
  (e: 'update:search', value: string): void;
}>();

const chatStore = useChatStore();

const fromQueue = ref(0);
const sizeQueue = ref(100);

const fromInChat = ref(0);
const sizeInChat = ref(100);

const search = ref('');

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
    <VBadge dot location="bottom right" offset-x="3" offset-y="3" bordered>
      <VAvatar
        size="40"
        class="cursor-pointer"
        @click="$emit('showUserProfile')"
      >
        <VImg alt="John Doe" />
      </VAvatar>
    </VBadge>

    <AppTextField
      id="search"
      v-model="search"
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
    class="d-flex flex-column gap-y-1 chat-contacts-list px-3 py-2 list-none"
    :options="{ wheelPropagation: false }"
  >
    <li class="list-none">
      <h5 class="chat-contact-header text-primary text-h5">
        {{ $t('in_service') }}
      </h5>
    </li>

    <ChatQueue
      v-for="inChat in chatStore.listInChat"
      :key="`chat-${inChat.chat_id}`"
      :user="inChat"
      @click="$emit('openChatOfContact', inChat.chat_id)"
    />

    <span
      v-show="!chatStore.listInChat.length"
      class="no-chat-items-text text-disabled"
      >{{ $t('no_chat_in_service') }}
    </span>
    <li class="list-none pt-2">
      <h5 class="chat-contact-header text-primary text-h5">
        {{ $t('waiting_for_service') }}
      </h5>
    </li>

    <ChatQueue
      v-for="queue in chatStore.listQueue"
      :key="`chat-${queue.chat_id}`"
      :user="queue"
      @click="$emit('openChatOfContact', queue.chat_id)"
    />

    <span
      v-show="!chatStore.listQueue.length"
      class="no-chat-items-text text-disabled"
      >{{ $t('no_chat_in_queue') }}
    </span>
  </PerfectScrollbar>
</template>

<style lang="scss">
.chat-contacts-list {
  --chat-content-spacing-x: 16px;

  padding-block-end: 0.75rem;

  .chat-contact-header {
    margin-block: 0.5rem 0.25rem;
  }

  .chat-contact-header,
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
