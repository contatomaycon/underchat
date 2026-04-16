<script lang="ts" setup>
import { ref, computed, watch, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useChatStore } from '@/@webcore/stores/chat';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { EMessageType } from '@core/common/enums/EMessageType';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { extractMessageTextFromContent } from '@core/common/functions/extractMessageTextFromContent';
import type { ChatNotificationToastPayload } from '@/composables/useChatNotificationToast';

interface Props {
  notification: ChatNotificationToastPayload;
  visible: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  close: [];
  click: [];
}>();

const router = useRouter();
const chatStore = useChatStore();
const { t } = useI18n();
const timer = ref<ReturnType<typeof setTimeout> | null>(null);

const shouldShow = computed(() => props.visible);

const notificationChatId = computed(() => {
  if (props.notification.type === 'message') {
    return props.notification.message.chat_id;
  }

  return props.notification.chat.chat_id;
});

const notificationChat = computed(() => {
  if (props.notification.type === 'status') {
    return props.notification.chat;
  }

  const chatId = props.notification.message.chat_id;

  return (
    chatStore.listQueue.find((chat) => chat.chat_id === chatId) ||
    chatStore.listInChat.find((chat) => chat.chat_id === chatId) ||
    chatStore.listChatbot.find((chat) => chat.chat_id === chatId) ||
    null
  );
});

const senderName = computed(() => {
  return (
    notificationChat.value?.name || notificationChat.value?.contact?.name || ''
  );
});

const senderIcon = computed(() => {
  return (
    notificationChat.value?.photo ||
    notificationChat.value?.contact?.photo ||
    '/images/svg/avatar-default.svg'
  );
});

function getMessagePreview(message: IChatMessage): string {
  if (!message.content) {
    return '';
  }

  const text = extractMessageTextFromContent(message.content);
  if (text) {
    return text;
  }

  switch (message.content.type) {
    case EMessageType.image:
      return `[${t('image')}]`;
    case EMessageType.video:
      return `[${t('video')}]`;
    case EMessageType.audio:
      return `[${t('audio')}]`;
    case EMessageType.document:
      return `[${t('document')}]`;
    case EMessageType.sticker:
      return `[${t('sticker')}]`;
    case EMessageType.location:
      return `[${t('location')}]`;
    case EMessageType.contact_card:
    case EMessageType.contacts:
      return `[${t('contact')}]`;
    default:
      return `[${t('message')}]`;
  }
}

const messagePreview = computed(() => {
  if (props.notification.type === 'status') {
    if (props.notification.chat.status === EChatStatus.in_chat) {
      return t('chat_notification_status_in_chat');
    }

    if (props.notification.chat.status === EChatStatus.queue) {
      return t('chat_notification_status_queue');
    }

    return t('chat_notification_status_update');
  }

  return getMessagePreview(props.notification.message);
});

function handleClick() {
  emit('click');
  emit('close');

  if (chatStore.setActiveChat) {
    chatStore.setActiveChat(notificationChatId.value);
  }

  router.push({
    name: 'chat',
  });
}

function handleClose() {
  emit('close');
}

function startTimer() {
  if (timer.value) {
    clearTimeout(timer.value);
    timer.value = null;
  }

  if (shouldShow.value) {
    timer.value = setTimeout(() => {
      handleClose();
    }, 5000);
  }
}

watch(
  () => props.visible,
  () => {
    startTimer();
  },
  { immediate: true }
);

onUnmounted(() => {
  if (timer.value) {
    clearTimeout(timer.value);
  }
});
</script>

<template>
  <Transition name="notification-toast">
    <VCard
      v-if="shouldShow"
      class="chat-notification-toast"
      elevation="8"
      @click="handleClick"
    >
      <VCardItem class="pa-3">
        <div class="d-flex align-center gap-3">
          <VAvatar size="40" :image="senderIcon" />
          <div class="flex-grow-1 min-width-0">
            <div class="text-body-1 font-weight-medium text-high-emphasis">
              {{ senderName }}
            </div>
            <div
              v-if="messagePreview"
              class="text-body-2 text-medium-emphasis text-truncate"
            >
              {{ messagePreview }}
            </div>
          </div>
          <VBtn
            icon
            variant="text"
            size="small"
            class="flex-shrink-0"
            @click.stop="handleClose"
          >
            <VIcon icon="tabler-x" size="20" />
          </VBtn>
        </div>
      </VCardItem>
    </VCard>
  </Transition>
</template>

<style lang="scss" scoped>
.chat-notification-toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 9999;
  min-width: 320px;
  max-width: 400px;
  cursor: pointer;
  transition: transform 0.2s;

  &:hover {
    transform: translateY(-2px);
  }
}

.notification-toast-enter-active {
  transition: all 0.3s ease-out;
}

.notification-toast-leave-active {
  transition: all 0.2s ease-in;
}

.notification-toast-enter-from {
  transform: translateX(calc(100% + 24px));
  opacity: 0;
}

.notification-toast-leave-to {
  transform: translateX(calc(100% + 24px));
  opacity: 0;
}
</style>
