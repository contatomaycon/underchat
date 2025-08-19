<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import { useChatStore } from '@/@webcore/stores/chat';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { ListMessageResponse } from '@core/schema/chat/listMessageChats/response.schema';

const chatStore = useChatStore();

const inputRef = ref<HTMLInputElement | null>(null);

const replying = computed(() => chatStore.messageReply);

const isClient = (m: ListMessageResponse | null) =>
  !!m && m.type_user === ETypeUserChat.client;

const replyName = computed(() => {
  const m = replying.value;
  if (!m) {
    return '';
  }
  if (isClient(m)) {
    return chatStore.activeChat?.name || '';
  }

  return m.user?.name || chatStore.user?.info.name || '';
});

const replyText = computed(() => {
  const m = replying.value;
  if (!m) {
    return '';
  }

  if (m.content?.message) {
    return m.content.message;
  }

  if (m.content?.link_preview?.['matched-text']) {
    return m.content.link_preview['matched-text'];
  }

  if (m.content?.link_preview?.['canonical-url']) {
    return m.content.link_preview['canonical-url'];
  }

  return '';
});

onMounted(() => {
  window.addEventListener('focus-composer', () => {
    inputRef.value?.focus();
  });
});
</script>

<template>
  <div v-if="replying" class="reply-preview">
    <div class="rp-name">{{ replyName }}</div>
    <div class="rp-text">{{ replyText }}</div>
    <VBtn
      class="rp-close"
      icon
      size="22"
      density="comfortable"
      variant="text"
      @click="chatStore.clearMessageReply()"
    >
      <VIcon size="18">tabler-x</VIcon>
    </VBtn>
  </div>
</template>

<style lang="scss">
.reply-preview {
  position: relative;
  background: rgb(var(--v-theme-surface));
  border-radius: 10px;
  padding: 10px 36px 10px 12px;
  margin-bottom: 8px;
  border-inline-start: 3px solid rgb(var(--v-theme-primary));
}
.rp-name {
  font-size: 14px;
  line-height: 1.1;
  margin-bottom: 4px;
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}
.rp-text {
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface));
}
.rp-close {
  position: absolute;
  top: 6px;
  right: 6px;
}
.left,
.right {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
