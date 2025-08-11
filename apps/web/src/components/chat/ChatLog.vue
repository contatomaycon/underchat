<script lang="ts" setup>
import { useChatStore } from '@/@webcore/stores/chat';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { ListMessageResponse } from '@core/schema/chat/listMessageChats/response.schema';

const chatStore = useChatStore();

const isTypeUser = (message: ListMessageResponse): boolean => {
  return message.type_user === ETypeUserChat.client;
};

const resolveFeedbackIcon = (
  message: ListMessageResponse
): { icon: string; color: string | undefined } => {
  if (message.summary?.is_seen)
    return { icon: 'tabler-checks', color: 'success' };
  else if (message.summary?.is_delivered)
    return { icon: 'tabler-checks', color: undefined };
  else return { icon: 'tabler-check', color: undefined };
};

const resolvePhoto = (message: ListMessageResponse): string => {
  if (isTypeUser(message) && chatStore.activeChat?.photo) {
    return chatStore.activeChat.photo;
  }

  if (!isTypeUser(message) && message.user?.photo) {
    return message.user.photo;
  }

  if (!isTypeUser(message) && chatStore.user?.info.photo) {
    return chatStore.user.info.photo;
  }

  return '';
};

const isPhotoExist = (message: ListMessageResponse): boolean => {
  return !!resolvePhoto(message);
};

const avatarChat = (message: ListMessageResponse) => {
  if (isTypeUser(message) && chatStore.activeChat?.name) {
    return avatarText(chatStore.activeChat.name);
  }

  const name = message.user?.name ?? chatStore.user?.info.name;

  return avatarText(name);
};
</script>

<template>
  <div class="chat-log pa-6">
    <div
      v-for="(msgGrp, index) in chatStore.listMessages"
      :key="msgGrp.message_id"
      class="chat-group d-flex align-start"
      :class="[
        {
          'flex-row-reverse': !isTypeUser(msgGrp),
          'mb-6': chatStore.listMessages.length - 1 !== index,
        },
      ]"
    >
      <div class="chat-avatar" :class="!isTypeUser(msgGrp) ? 'ms-4' : 'me-4'">
        <VAvatar
          v-if="msgGrp.user"
          size="32"
          :variant="!isPhotoExist(msgGrp) ? 'tonal' : undefined"
        >
          <VImg v-if="isPhotoExist(msgGrp)" :src="resolvePhoto(msgGrp)" />
          <span v-else class="text-1xl">{{ avatarChat(msgGrp) }}</span>
        </VAvatar>
        <VAvatar
          v-else
          size="32"
          :variant="!isPhotoExist(msgGrp) ? 'tonal' : undefined"
        >
          <VImg v-if="isPhotoExist(msgGrp)" :src="resolvePhoto(msgGrp)" />
          <span v-else class="text-1xl">{{ avatarChat(msgGrp) }}</span>
        </VAvatar>
      </div>

      <div
        class="chat-body d-inline-flex flex-column"
        :class="!isTypeUser(msgGrp) ? 'align-end' : 'align-start'"
      >
        <div
          class="chat-content py-2 px-4 elevation-2"
          style="background-color: rgb(var(--v-theme-surface))"
          :class="[
            isTypeUser(msgGrp)
              ? 'chat-left'
              : 'bg-primary text-white chat-right',
          ]"
        >
          <p class="mb-0 text-base">
            {{ msgGrp.content?.message }}
          </p>
        </div>
        <div :class="{ 'text-right': !isTypeUser(msgGrp) }">
          <VIcon size="16" :color="resolveFeedbackIcon(msgGrp).color">
            {{ resolveFeedbackIcon(msgGrp).icon }}
          </VIcon>
          <span class="text-sm ms-2 text-disabled">{{
            formatDate(msgGrp.date, {
              hour: 'numeric',
              minute: 'numeric',
            })
          }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
.chat-log {
  .chat-body {
    max-inline-size: calc(100% - 6.75rem);

    .chat-content {
      border-end-end-radius: 6px;
      border-end-start-radius: 6px;

      p {
        overflow-wrap: anywhere;
      }

      &.chat-left {
        border-start-end-radius: 6px;
      }

      &.chat-right {
        border-start-start-radius: 6px;
      }
    }
  }
}
</style>
