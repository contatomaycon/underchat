<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import { useChatStore } from '@/@webcore/stores/chat';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ListMessageResult } from '@core/schema/chat/listMessageChats/response.schema';
import { useI18n } from 'vue-i18n';

const chatStore = useChatStore();
const { t } = useI18n();

const inputRef = ref<HTMLInputElement | null>(null);

const replying = computed(() => chatStore.messageReply);

const isClient = (m: ListMessageResult | null) =>
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

const replyIsImage = computed(
  () => replying.value?.content?.type === EMessageType.image
);

const replyImageSrc = computed(() => {
  const img = replying.value?.content?.image;
  if (!img) {
    return null;
  }

  return img.url || img.thumbnail || null;
});

const replyText = computed(() => {
  const m = replying.value;
  if (!m) {
    return '';
  }

  if (m.content?.type === EMessageType.image) {
    return m.content.image?.caption || t('photo_label');
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
  (globalThis as Window & typeof globalThis).addEventListener(
    'focus-composer',
    () => {
      inputRef.value?.focus();
    }
  );
});
</script>

<template>
  <div v-if="replying" class="reply-preview">
    <div v-if="replyIsImage && replyImageSrc" class="rp-media">
      <img :src="replyImageSrc" alt="preview" />
    </div>
    <div class="rp-content">
      <div class="rp-name">{{ replyName }}</div>
      <div class="rp-text">{{ replyText }}</div>
    </div>
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
  display: flex;
  align-items: center;
  gap: 10px;
}
.rp-media {
  inline-size: 40px;
  block-size: 40px;
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;

  img {
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
    display: block;
  }
}
.rp-content {
  flex: 1;
  min-inline-size: 0;
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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rp-close {
  position: absolute;
  top: 6px;
  right: 6px;
}
</style>
