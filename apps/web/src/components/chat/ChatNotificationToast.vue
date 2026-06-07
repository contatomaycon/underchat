<script lang="ts" setup>
import { computed, ref, watch, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useChatStore } from '@/@webcore/stores/chat';
import { useInternalChatStore } from '@/@webcore/stores/internalChat';
import type { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { EMessageType } from '@core/common/enums/EMessageType';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EInternalChatConversationType } from '@core/common/enums/internalChat/EInternalChatConversationType';
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
const route = useRoute();
const chatStore = useChatStore();
const internalChatStore = useInternalChatStore();
const { t } = useI18n();
const timer = ref<ReturnType<typeof setTimeout> | null>(null);

const isTransferNotification = computed(
  () => props.notification.type === 'transfer'
);

const notificationChatId = computed(() => {
  if (props.notification.type === 'internal-message') {
    return props.notification.message.conversation_id;
  }

  if (props.notification.type === 'message') {
    return props.notification.message.chat_id;
  }

  if (props.notification.type === 'status') {
    return props.notification.chat.chat_id;
  }

  return props.notification.chat_id;
});

const notificationChat = computed(() => {
  if (props.notification.type === 'internal-message' || props.notification.type === 'transfer') {
    return null;
  }

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
  if (props.notification.type === 'internal-message') {
    const { message } = props.notification;
    const conversation = internalChatStore.conversations.find(
      (item) => item.conversation_id === message.conversation_id
    );

    if (conversation?.type === EInternalChatConversationType.group) {
      return conversation.name || t('internal_chat_default_conversation');
    }

    return message.user?.name || t('internal_chat_default_conversation');
  }

  if (props.notification.type === 'transfer') {
    return props.notification.contact_name;
  }

  return notificationChat.value?.name || notificationChat.value?.contact?.name || '';
});

const senderIcon = computed(() => {
  if (props.notification.type === 'internal-message') {
    const { message } = props.notification;
    const conversation = internalChatStore.conversations.find(
      (item) => item.conversation_id === message.conversation_id
    );

    return (
      conversation?.photo ||
      message.user?.photo ||
      '/images/svg/avatar-default.svg'
    );
  }

  if (props.notification.type === 'transfer') {
    return (
      props.notification.contact_photo || '/images/svg/avatar-default.svg'
    );
  }

  return (
    notificationChat.value?.photo ||
    notificationChat.value?.contact?.photo ||
    '/images/svg/avatar-default.svg'
  );
});

const transferOperatorName = computed(() => {
  if (props.notification.type !== 'transfer') {
    return '';
  }

  return (
    props.notification.actor_user_name ||
    props.notification.actor_user_id ||
    t('chat_notification_transfer_operator_fallback')
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
  if (props.notification.type === 'internal-message') {
    return getMessagePreview(
      props.notification.message as unknown as IChatMessage
    );
  }

  if (props.notification.type === 'status') {
    if (props.notification.chat.status === EChatStatus.in_chat) {
      return t('chat_notification_status_in_chat');
    }

    if (props.notification.chat.status === EChatStatus.queue) {
      return t('chat_notification_status_queue');
    }

    if (
      props.notification.chat.status === EChatStatus.ura ||
      props.notification.chat.status === EChatStatus.ura_output ||
      props.notification.chat.status === EChatStatus.ura_schedule ||
      props.notification.chat.status === EChatStatus.ura_webhook
    ) {
      return t('chat_notification_status_chatbot');
    }

    return t('chat_notification_status_update');
  }

  if (props.notification.type === 'transfer') {
    return props.notification.contact_name;
  }

  return getMessagePreview(props.notification.message);
});

function handleCardClick() {
  if (props.notification.type === 'transfer') {
    return;
  }

  emit('click');
  emit('close');

  if (props.notification.type === 'internal-message') {
    const conversationId = props.notification.message.conversation_id;
    void internalChatStore.openConversation(conversationId);
    router.push({
      name: 'internal-chat',
      query: { conversation_id: conversationId },
    });
    return;
  }

  if (chatStore.setActiveChat) {
    chatStore.setActiveChat(notificationChatId.value);
  }

  router.push({
    name: 'chat',
  });
}

function goToTransferredChat() {
  if (props.notification.type !== 'transfer') {
    return;
  }

  const chatId = props.notification.chat_id;
  const fallbackChat = chatStore.findChatInLists(chatId);

  if (route.name === 'chat') {
    globalThis.dispatchEvent(
      new CustomEvent('open-chat-from-toast', {
        detail: { chatId },
      })
    );
  } else {
    if (chatStore.setActiveChat) {
      chatStore.setActiveChat(chatId, fallbackChat ?? undefined);
    }

    router.push({
      name: 'chat',
    });
  }

  emit('close');
}

function handleDismissTransfer() {
  emit('close');
}

function startTimer() {
  if (timer.value) {
    clearTimeout(timer.value);
    timer.value = null;
  }

  if (props.notification.type === 'transfer') {
    return;
  }

  timer.value = setTimeout(() => {
    emit('close');
  }, 5000);
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
      v-if="props.visible"
      class="chat-notification-toast"
      elevation="8"
      @click="handleCardClick"
    >
      <VCardItem class="pa-3">
        <div v-if="isTransferNotification" class="d-flex flex-column gap-2">
          <div class="d-flex align-center gap-3">
            <VAvatar size="40" :image="senderIcon" />
            <div class="flex-grow-1 min-width-0">
              <div class="text-body-1 font-weight-medium text-high-emphasis">
                {{
                  t('chat_notification_transfer_title')
                }}
              </div>
              <div
                class="text-body-2 text-medium-emphasis text-truncate"
              >
                {{
                  t('chat_notification_transfer_contact', {
                    name: senderName,
                  })
                }}
              </div>
              <div class="text-body-2 text-medium-emphasis text-truncate">
                {{
                  t('chat_notification_transfer_operator', {
                    operator: transferOperatorName,
                  })
                }}
              </div>
            </div>
          </div>

          <div class="chat-notification-toast-actions d-flex justify-end gap-2">
            <VBtn
              variant="text"
              size="small"
              @click.stop="handleDismissTransfer"
            >
              {{ t('chat_notification_transfer_dismiss') }}
            </VBtn>
            <VBtn
              color="primary"
              size="small"
              @click.stop="goToTransferredChat"
            >
              {{ t('chat_notification_transfer_go_to_attendance') }}
            </VBtn>
          </div>
        </div>

        <div v-else class="d-flex align-center gap-3">
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
            @click.stop="handleDismissTransfer"
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
  width: 100%;
  cursor: pointer;
  transition: transform 0.2s;

  &:hover {
    transform: translateY(-2px);
  }
}

.chat-notification-toast-actions {
  width: 100%;
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
