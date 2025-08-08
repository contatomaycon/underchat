<script lang="ts" setup>
import { useChatStore } from '@/@webcore/stores/chat';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { ListMessageChatsQuery } from '@core/schema/chat/listMessageChats/request.schema';
import { ListMessageResponse } from '@core/schema/chat/listMessageChats/response.schema';

const chatStore = useChatStore();

const from = ref(0);
const size = ref(100);

const resolveFeedbackIcon = (message: ListMessageResponse) => {
  if (message.summary?.is_seen)
    return { icon: 'tabler-checks', color: 'success' };
  else if (message.summary?.is_delivered)
    return { icon: 'tabler-checks', color: undefined };
  else return { icon: 'tabler-check', color: undefined };
};

onMounted(async () => {
  const requestQueue: ListMessageChatsQuery = {
    from: from.value,
    size: size.value,
  };

  await chatStore.getChatById(requestQueue);
});
</script>

<template>
  <div class="chat-log pa-6">
    <div
      v-for="(msgGrp, index) in chatStore.listMessages"
      :key="msgGrp.message_id"
      class="chat-group d-flex align-start"
      :class="[
        {
          'flex-row-reverse': msgGrp.type_user !== ETypeUserChat.client,
          'mb-6': chatStore.listMessages.length - 1 !== index,
        },
      ]"
    >
      <div
        class="chat-avatar"
        :class="msgGrp.type_user !== ETypeUserChat.client ? 'ms-4' : 'me-4'"
      >
        <VAvatar size="32">
          <VImg src="avatar-placeholder.png" />
        </VAvatar>
      </div>

      <div
        class="chat-body d-inline-flex flex-column"
        :class="
          msgGrp.type_user !== ETypeUserChat.client
            ? 'align-end'
            : 'align-start'
        "
      >
        <div
          class="chat-content py-2 px-4 elevation-2"
          style="background-color: rgb(var(--v-theme-surface))"
          :class="[
            msgGrp.type_user === ETypeUserChat.client
              ? 'chat-left'
              : 'bg-primary text-white chat-right',
            //msgGrp.messages.length - 1 !== msgIndex ? 'mb-2' : 'mb-1',
          ]"
        >
          <p class="mb-0 text-base">
            {{ msgGrp.message }}
          </p>
        </div>
        <div
          :class="{ 'text-right': msgGrp.type_user !== ETypeUserChat.client }"
        >
          <VIcon
            v-if="msgGrp.type_user !== ETypeUserChat.client"
            size="16"
            :color="resolveFeedbackIcon(msgGrp).color"
          >
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
