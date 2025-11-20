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

onMounted(async () => {
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

  <PerfectScrollbar :options="{ wheelPropagation: false }">
    <ul class="d-flex flex-column gap-y-1 chat-list px-3 py-2 list-none">
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

      <li
        v-if="!chatStore.listInChat.length"
        class="no-chat-items-text text-disabled"
      >
        {{ $t('no_chat_in_service') }}
      </li>

      <li class="list-none pt-2">
        <h5 class="chat-header text-primary text-h5">
          {{ $t('waiting_for_service') }}
        </h5>
      </li>

      <ChatQueue
        v-for="(queue, index) in chatStore.listQueue"
        :key="`chat-${queue.chat_id}`"
        :user="queue"
        :disabled="!isQueueChatSelectable(index)"
        @click="handleQueueClick(queue.chat_id, index)"
      />

      <li
        v-if="!chatStore.listQueue.length"
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
</style>
