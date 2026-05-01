<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { refDebounced } from '@vueuse/core';
import { useInternalChatStore } from '@/@webcore/stores/internalChat';
import { useInternalChatSocket } from '@/composables/useInternalChatSocket';
import { EInternalChatActivityState } from '@core/common/enums/internalChat/EInternalChatActivityState';
import { EMessageType } from '@core/common/enums/EMessageType';
import { EColor } from '@core/common/enums/EColor';
import type { ListMessagesResponse } from '@core/schema/internalChat/listMessages/response.schema';

type InternalMessage = ListMessagesResponse['data']['results'][number];

const emit = defineEmits<{
  (e: 'switch-whatsapp-mode'): void;
}>();

const internalChatStore = useInternalChatStore();
const internalChatSocket = useInternalChatSocket();

const {
  conversations,
  users,
  activeConversation,
  messages,
  conversationsPaging,
  usersPaging,
  messagesPaging,
  loadingConversations,
  loadingUsers,
  loadingMessages,
  sendingMessage,
  showUsersFallback,
} = storeToRefs(internalChatStore);

const searchQuery = ref('');
const searchQueryDebounced = refDebounced(searchQuery, 350);
const composerText = ref('');
const replyMessage = ref<InternalMessage | null>(null);

const selectedImages = ref<File[]>([]);
const selectedVideos = ref<File[]>([]);
const selectedDocuments = ref<File[]>([]);
const selectedAudios = ref<File[]>([]);

const imageInputRef = ref<HTMLInputElement | null>(null);
const videoInputRef = ref<HTMLInputElement | null>(null);
const documentInputRef = ref<HTMLInputElement | null>(null);
const audioInputRef = ref<HTMLInputElement | null>(null);

const isGroupDialogOpen = ref(false);
const groupName = ref('');
const groupMemberUserIds = ref<string[]>([]);
const creatingGroup = ref(false);

const isForwardDialogOpen = ref(false);
const forwardMessageSource = ref<InternalMessage | null>(null);
const forwardConversationIds = ref<string[]>([]);
const forwardingMessage = ref(false);

const isLocationDialogOpen = ref(false);
const locationLatitude = ref<string>('');
const locationLongitude = ref<string>('');
const locationName = ref<string>('');
const locationAddress = ref<string>('');

const isContactDialogOpen = ref(false);
const contactName = ref('');
const contactPhone = ref('');

const isRecordingAudio = ref(false);
const recordingStarting = ref(false);
const mediaRecorderRef = ref<MediaRecorder | null>(null);
const mediaStreamRef = ref<MediaStream | null>(null);
const audioChunksRef = ref<Blob[]>([]);
const recordingStartAt = ref<number | null>(null);
const recordingDurationMs = ref(0);
const recordingTimer = ref<ReturnType<typeof setInterval> | null>(null);
const activityCleanupTimer = ref<ReturnType<typeof setInterval> | null>(null);

const isConversationMode = computed(
  () => !showUsersFallback.value && conversations.value.length > 0
);

const canLoadMoreSidebar = computed(() => {
  if (isConversationMode.value) {
    return (
      conversationsPaging.value.current_page <
      conversationsPaging.value.total_pages
    );
  }

  return usersPaging.value.current_page < usersPaging.value.total_pages;
});

const hasAnyAttachment = computed(() => {
  return (
    selectedImages.value.length > 0 ||
    selectedVideos.value.length > 0 ||
    selectedDocuments.value.length > 0 ||
    selectedAudios.value.length > 0
  );
});

const hasComposerContent = computed(() => {
  return composerText.value.trim().length > 0 || hasAnyAttachment.value;
});

const currentConversationActivities = computed(() => {
  if (!activeConversation.value?.conversation_id) return [];
  return internalChatStore.listConversationActivities(
    activeConversation.value.conversation_id
  );
});

const firstActivity = computed(() => currentConversationActivities.value[0]);

const activityLabel = computed(() => {
  const activity = firstActivity.value;
  if (!activity) return '';

  if (activity.state === EInternalChatActivityState.recording) {
    return `${activity.user_name ?? 'Usuário'} está gravando áudio...`;
  }

  return `${activity.user_name ?? 'Usuário'} está digitando...`;
});

const formattedRecordingDuration = computed(() => {
  const totalSeconds = Math.floor(recordingDurationMs.value / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
});

const formatMessageDate = (value?: string | null): string => {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const isOwnMessage = (message: InternalMessage): boolean => {
  return (
    !!internalChatStore.currentUserId &&
    message.user?.id === internalChatStore.currentUserId
  );
};

const resolveMessageText = (message: InternalMessage): string | null => {
  if (!message.content) return null;
  if (message.deleted) return 'Mensagem removida';

  if (
    message.content.type === EMessageType.image ||
    message.content.type === EMessageType.video ||
    message.content.type === EMessageType.audio ||
    message.content.type === EMessageType.document ||
    message.content.type === EMessageType.location ||
    message.content.type === EMessageType.contact_card ||
    message.content.type === EMessageType.contacts
  ) {
    return message.content.message ?? null;
  }

  return message.content.message ?? null;
};

const clearComposer = () => {
  composerText.value = '';
  replyMessage.value = null;
  selectedImages.value = [];
  selectedVideos.value = [];
  selectedDocuments.value = [];
  selectedAudios.value = [];
};

const loadSidebar = async (append = false) => {
  const normalizedSearch = searchQueryDebounced.value.trim();
  const shouldTryConversations =
    normalizedSearch.length === 0 ||
    isConversationMode.value ||
    conversationsPaging.value.total > 0;

  if (shouldTryConversations) {
    await internalChatStore.listConversations(
      {
        current_page: append ? conversationsPaging.value.current_page + 1 : 1,
        per_page: conversationsPaging.value.per_page,
        search: normalizedSearch || undefined,
      },
      append
    );

    if (internalChatStore.conversations.length === 0) {
      await internalChatStore.listUsers(
        {
          current_page: 1,
          per_page: usersPaging.value.per_page,
          search: normalizedSearch || undefined,
        },
        false
      );
    }

    return;
  }

  await internalChatStore.listUsers(
    {
      current_page: append ? usersPaging.value.current_page + 1 : 1,
      per_page: usersPaging.value.per_page,
      search: normalizedSearch || undefined,
    },
    append
  );
};

const loadMoreSidebar = async () => {
  if (!canLoadMoreSidebar.value) return;

  if (isConversationMode.value) {
    await internalChatStore.listConversations(
      {
        current_page: conversationsPaging.value.current_page + 1,
        per_page: conversationsPaging.value.per_page,
        search: searchQueryDebounced.value.trim() || undefined,
      },
      true
    );
    return;
  }

  await internalChatStore.listUsers(
    {
      current_page: usersPaging.value.current_page + 1,
      per_page: usersPaging.value.per_page,
      search: searchQueryDebounced.value.trim() || undefined,
    },
    true
  );
};

const openConversation = async (conversationId: string) => {
  await internalChatStore.openConversation(conversationId);
};

const openConversationFromUser = async (userId: string) => {
  await internalChatStore.openDirect(userId);
};

const loadMoreMessages = async () => {
  if (!activeConversation.value?.conversation_id) return;
  if (messagesPaging.value.current_page >= messagesPaging.value.total_pages) {
    return;
  }

  await internalChatStore.listMessages(
    activeConversation.value.conversation_id,
    {
      current_page: messagesPaging.value.current_page + 1,
      per_page: messagesPaging.value.per_page,
    },
    true
  );
};

const closeActiveConversation = async () => {
  if (!activeConversation.value?.conversation_id) return;

  const closed = await internalChatStore.closeConversation(
    activeConversation.value.conversation_id
  );

  if (closed) {
    clearComposer();
  }
};

const createMultipartPayload = (input: {
  type: EMessageType;
  field: 'images' | 'videos' | 'documents' | 'audios';
  files: File[];
  message?: string | null;
  messageQuotedId?: string | null;
}): FormData => {
  const formData = new FormData();
  formData.append('type', input.type);

  if (input.message && input.message.trim().length > 0) {
    formData.append('message', input.message.trim());
  }

  if (input.messageQuotedId) {
    formData.append('message_quoted_id', input.messageQuotedId);
  }

  for (const file of input.files) {
    formData.append(input.field, file);
  }

  return formData;
};

const sendMessage = async () => {
  if (!activeConversation.value?.conversation_id || !hasComposerContent.value) {
    return;
  }

  const conversationId = activeConversation.value.conversation_id;
  const message = composerText.value.trim();
  const messageQuotedId = replyMessage.value?.message_id ?? null;
  let hasSendFailure = false;

  const sendPayload = async (payload: FormData | Record<string, unknown>) => {
    const success = await internalChatStore.createMessage(
      conversationId,
      payload as any
    );
    if (!success) {
      hasSendFailure = true;
    }
  };

  if (selectedImages.value.length > 0) {
    await sendPayload(
      createMultipartPayload({
        type: EMessageType.image,
        field: 'images',
        files: selectedImages.value,
        message,
        messageQuotedId,
      })
    );
  }

  if (selectedVideos.value.length > 0) {
    await sendPayload(
      createMultipartPayload({
        type: EMessageType.video,
        field: 'videos',
        files: selectedVideos.value,
        message,
        messageQuotedId,
      })
    );
  }

  if (selectedDocuments.value.length > 0) {
    await sendPayload(
      createMultipartPayload({
        type: EMessageType.document,
        field: 'documents',
        files: selectedDocuments.value,
        message,
        messageQuotedId,
      })
    );
  }

  if (selectedAudios.value.length > 0) {
    await sendPayload(
      createMultipartPayload({
        type: EMessageType.audio,
        field: 'audios',
        files: selectedAudios.value,
        message,
        messageQuotedId,
      })
    );
  }

  if (!hasAnyAttachment.value && message.length > 0) {
    await sendPayload({
      type: EMessageType.text,
      message,
      message_quoted_id: messageQuotedId,
    });
  }

  if (!hasSendFailure) {
    clearComposer();
    void internalChatStore.publishActivity(
      conversationId,
      EInternalChatActivityState.available
    );
  }
};

const sendLocationMessage = async () => {
  if (!activeConversation.value?.conversation_id) return;
  if (!locationLatitude.value || !locationLongitude.value) return;

  const success = await internalChatStore.createMessage(
    activeConversation.value.conversation_id,
    {
      type: EMessageType.location,
      location_latitude: locationLatitude.value,
      location_longitude: locationLongitude.value,
      location_name: locationName.value || null,
      location_address: locationAddress.value || null,
      message_quoted_id: replyMessage.value?.message_id ?? null,
    }
  );

  if (!success) return;

  isLocationDialogOpen.value = false;
  locationLatitude.value = '';
  locationLongitude.value = '';
  locationName.value = '';
  locationAddress.value = '';
  replyMessage.value = null;
};

const sendContactMessage = async () => {
  if (!activeConversation.value?.conversation_id) return;
  if (!contactPhone.value.trim()) return;

  const normalized = `${contactName.value.trim() || 'Contato'} (${contactPhone.value.trim()})`;
  const success = await internalChatStore.createMessage(
    activeConversation.value.conversation_id,
    {
      type: EMessageType.contact_card,
      contacts: [normalized],
      message_quoted_id: replyMessage.value?.message_id ?? null,
    }
  );

  if (!success) return;

  isContactDialogOpen.value = false;
  contactName.value = '';
  contactPhone.value = '';
  replyMessage.value = null;
};

const removeFileAtIndex = (files: File[], index: number) => {
  if (index < 0 || index >= files.length) return;
  files.splice(index, 1);
};

const appendSelectedFiles = (
  filesRef: typeof selectedImages,
  files: FileList | null
) => {
  if (!files || files.length === 0) return;

  const next = [...filesRef.value];
  for (const file of Array.from(files)) {
    if (next.length >= 10) break;
    next.push(file);
  }
  filesRef.value = next;
};

const onImagesSelected = (event: Event) => {
  const target = event.target as HTMLInputElement;
  appendSelectedFiles(selectedImages, target.files);
  target.value = '';
};

const onVideosSelected = (event: Event) => {
  const target = event.target as HTMLInputElement;
  appendSelectedFiles(selectedVideos, target.files);
  target.value = '';
};

const onDocumentsSelected = (event: Event) => {
  const target = event.target as HTMLInputElement;
  appendSelectedFiles(selectedDocuments, target.files);
  target.value = '';
};

const onAudiosSelected = (event: Event) => {
  const target = event.target as HTMLInputElement;
  appendSelectedFiles(selectedAudios, target.files);
  target.value = '';
};

const startAudioRecording = async () => {
  if (recordingStarting.value || isRecordingAudio.value) return;

  recordingStarting.value = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.value = stream;

    const recorder = new MediaRecorder(stream);
    mediaRecorderRef.value = recorder;
    audioChunksRef.value = [];
    recordingDurationMs.value = 0;
    recordingStartAt.value = Date.now();

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) {
        audioChunksRef.value.push(event.data);
      }
    });

    recorder.addEventListener('stop', () => {
      if (recordingTimer.value) {
        clearInterval(recordingTimer.value);
        recordingTimer.value = null;
      }

      stream.getTracks().forEach((track) => track.stop());
      mediaStreamRef.value = null;

      const blob = new Blob(audioChunksRef.value, { type: 'audio/webm' });
      if (blob.size > 0) {
        const file = new File([blob], `audio-${Date.now()}.webm`, {
          type: 'audio/webm',
        });
        selectedAudios.value.push(file);
      }

      audioChunksRef.value = [];
      isRecordingAudio.value = false;

      if (activeConversation.value?.conversation_id) {
        void internalChatStore.publishActivity(
          activeConversation.value.conversation_id,
          EInternalChatActivityState.available
        );
      }
    });

    recorder.start();
    isRecordingAudio.value = true;

    recordingTimer.value = setInterval(() => {
      if (!recordingStartAt.value) return;
      recordingDurationMs.value = Date.now() - recordingStartAt.value;
    }, 250);

    if (activeConversation.value?.conversation_id) {
      void internalChatStore.publishActivity(
        activeConversation.value.conversation_id,
        EInternalChatActivityState.recording
      );
    }
  } catch {
    internalChatStore.showSnackbar(
      'Não foi possível acessar o microfone',
      EColor.error
    );
  } finally {
    recordingStarting.value = false;
  }
};

const stopAudioRecording = () => {
  if (!mediaRecorderRef.value || mediaRecorderRef.value.state === 'inactive') {
    return;
  }
  mediaRecorderRef.value.stop();
};

const cancelAudioRecording = () => {
  if (!mediaRecorderRef.value || mediaRecorderRef.value.state === 'inactive') {
    return;
  }
  audioChunksRef.value = [];
  mediaRecorderRef.value.stop();
};

const toggleAudioRecording = async () => {
  if (isRecordingAudio.value) {
    stopAudioRecording();
    return;
  }

  await startAudioRecording();
};

const onReply = (message: InternalMessage) => {
  replyMessage.value = message;
};

const onReact = async (message: InternalMessage) => {
  if (!activeConversation.value?.conversation_id) return;

  const emoji = window.prompt('Emoji da reação (ex: 👍):', '👍')?.trim();
  if (!emoji) return;

  await internalChatStore.reactMessage(
    activeConversation.value.conversation_id,
    message.message_id,
    emoji
  );
};

const onEdit = async (message: InternalMessage) => {
  if (!activeConversation.value?.conversation_id) return;
  if (message.content?.type !== EMessageType.text) return;

  const nextText = window
    .prompt('Editar mensagem:', message.content.message ?? '')
    ?.trim();

  if (!nextText) return;

  await internalChatStore.editMessage(
    activeConversation.value.conversation_id,
    message.message_id,
    nextText
  );
};

const onDelete = async (message: InternalMessage) => {
  if (!activeConversation.value?.conversation_id) return;
  const confirmed = window.confirm('Deseja remover esta mensagem?');
  if (!confirmed) return;

  await internalChatStore.deleteMessage(
    activeConversation.value.conversation_id,
    message.message_id
  );
};

const openForwardDialog = (message: InternalMessage) => {
  forwardMessageSource.value = message;
  forwardConversationIds.value = [];
  isForwardDialogOpen.value = true;
};

const submitForward = async () => {
  if (
    !activeConversation.value?.conversation_id ||
    !forwardMessageSource.value
  ) {
    return;
  }

  if (forwardConversationIds.value.length === 0) return;

  forwardingMessage.value = true;
  try {
    const success = await internalChatStore.forwardMessage(
      activeConversation.value.conversation_id,
      forwardMessageSource.value.message_id,
      forwardConversationIds.value
    );

    if (!success) return;

    isForwardDialogOpen.value = false;
    forwardMessageSource.value = null;
    forwardConversationIds.value = [];
  } finally {
    forwardingMessage.value = false;
  }
};

const submitCreateGroup = async () => {
  if (!groupName.value.trim()) return;
  creatingGroup.value = true;

  try {
    const created = await internalChatStore.createGroup({
      name: groupName.value.trim(),
      member_user_ids: groupMemberUserIds.value,
    });

    if (!created) return;

    isGroupDialogOpen.value = false;
    groupName.value = '';
    groupMemberUserIds.value = [];
  } finally {
    creatingGroup.value = false;
  }
};

const openCreateGroupDialog = async () => {
  await internalChatStore.listUsers({ current_page: 1, per_page: 100 }, false);
  isGroupDialogOpen.value = true;
};

let typingResetTimer: ReturnType<typeof setTimeout> | null = null;
let lastTypingSentAt = 0;

watch(
  () => composerText.value,
  (value) => {
    const conversationId = activeConversation.value?.conversation_id;
    if (!conversationId) return;

    if (typingResetTimer) {
      clearTimeout(typingResetTimer);
      typingResetTimer = null;
    }

    if (!value.trim()) {
      void internalChatStore.publishActivity(
        conversationId,
        EInternalChatActivityState.available
      );
      return;
    }

    const now = Date.now();
    if (now - lastTypingSentAt > 900) {
      lastTypingSentAt = now;
      void internalChatStore.publishActivity(
        conversationId,
        EInternalChatActivityState.typing
      );
    }

    typingResetTimer = setTimeout(() => {
      void internalChatStore.publishActivity(
        conversationId,
        EInternalChatActivityState.available
      );
    }, 1400);
  }
);

watch(searchQueryDebounced, async () => {
  await loadSidebar(false);
});

onMounted(async () => {
  await internalChatStore.bootstrap();
  await internalChatSocket.initializeSocket();
  activityCleanupTimer.value = setInterval(() => {
    internalChatStore.clearExpiredActivities();
  }, 1500);
});

onBeforeUnmount(async () => {
  if (typingResetTimer) {
    clearTimeout(typingResetTimer);
    typingResetTimer = null;
  }

  if (recordingTimer.value) {
    clearInterval(recordingTimer.value);
    recordingTimer.value = null;
  }

  if (activityCleanupTimer.value) {
    clearInterval(activityCleanupTimer.value);
    activityCleanupTimer.value = null;
  }

  if (mediaRecorderRef.value && mediaRecorderRef.value.state !== 'inactive') {
    mediaRecorderRef.value.stop();
  }

  if (mediaStreamRef.value) {
    mediaStreamRef.value.getTracks().forEach((track) => track.stop());
    mediaStreamRef.value = null;
  }

  await internalChatSocket.cleanup();
});
</script>

<template>
  <div class="internal-chat-layout d-flex h-100">
    <aside class="internal-chat-sidebar">
      <div class="internal-chat-sidebar-header d-flex flex-column gap-2 pa-3">
        <div class="d-flex gap-2">
          <VBtn color="primary" variant="flat" class="flex-grow-1">
            <VIcon class="me-1" size="18">tabler-users-group</VIcon>
            Chat Interno
          </VBtn>

          <VBtn
            icon
            color="primary"
            variant="flat"
            @click="openCreateGroupDialog"
          >
            <VIcon size="18">tabler-plus</VIcon>
            <VTooltip activator="parent" location="bottom">
              Novo Grupo
            </VTooltip>
          </VBtn>

          <VBtn icon variant="tonal" @click="emit('switch-whatsapp-mode')">
            <VIcon size="18">tabler-brand-whatsapp</VIcon>
            <VTooltip activator="parent" location="bottom">
              Voltar ao Chat
            </VTooltip>
          </VBtn>
        </div>

        <AppTextField
          v-model="searchQuery"
          prepend-inner-icon="tabler-search"
          :placeholder="
            isConversationMode
              ? 'Pesquisar conversas internas...'
              : 'Pesquisar usuários...'
          "
          hide-details
          density="compact"
        />
      </div>

      <VDivider />

      <div class="internal-chat-sidebar-body">
        <div v-if="isConversationMode">
          <VList lines="two" density="comfortable" class="py-0">
            <VListItem
              v-for="conversation in conversations"
              :key="conversation.conversation_id"
              :active="
                activeConversation?.conversation_id ===
                conversation.conversation_id
              "
              @click="openConversation(conversation.conversation_id)"
            >
              <template #prepend>
                <VAvatar size="36" :image="conversation.photo || undefined">
                  <span v-if="!conversation.photo">
                    {{ conversation.name?.slice(0, 1).toUpperCase() }}
                  </span>
                </VAvatar>
              </template>

              <VListItemTitle>
                {{ conversation.name || 'Conversa interna' }}
              </VListItemTitle>
              <VListItemSubtitle class="text-truncate">
                {{ conversation.last_message_preview || 'Sem mensagens' }}
              </VListItemSubtitle>

              <template #append>
                <VBadge
                  v-if="conversation.unread_count > 0"
                  :content="conversation.unread_count"
                  color="primary"
                />
              </template>
            </VListItem>
          </VList>
        </div>

        <div v-else>
          <VList lines="one" density="comfortable" class="py-0">
            <VListItem
              v-for="user in users"
              :key="user.user_id"
              @click="openConversationFromUser(user.user_id)"
            >
              <template #prepend>
                <VAvatar size="36" :image="user.photo || undefined">
                  <span v-if="!user.photo">
                    {{ user.name.slice(0, 1).toUpperCase() }}
                  </span>
                </VAvatar>
              </template>
              <VListItemTitle>{{ user.name }}</VListItemTitle>
            </VListItem>
          </VList>
        </div>
      </div>

      <div class="internal-chat-sidebar-footer pa-3">
        <VBtn
          v-if="canLoadMoreSidebar"
          block
          variant="tonal"
          :loading="loadingConversations || loadingUsers"
          @click="loadMoreSidebar"
        >
          Carregar mais
        </VBtn>
      </div>
    </aside>

    <section class="internal-chat-main d-flex flex-column">
      <template v-if="activeConversation">
        <div class="internal-chat-main-header d-flex align-center px-4 py-3">
          <VAvatar size="38" :image="activeConversation.photo || undefined">
            <span v-if="!activeConversation.photo">
              {{ activeConversation.name?.slice(0, 1).toUpperCase() }}
            </span>
          </VAvatar>

          <div class="ms-3 overflow-hidden">
            <div class="text-subtitle-1 font-weight-medium text-truncate">
              {{ activeConversation.name || 'Conversa interna' }}
            </div>
            <div v-if="firstActivity" class="text-caption text-primary">
              {{ activityLabel }}
            </div>
          </div>

          <VSpacer />

          <VBtn
            color="error"
            variant="text"
            size="small"
            @click="closeActiveConversation"
          >
            Fechar conversa
          </VBtn>
        </div>

        <VDivider />

        <div class="internal-chat-message-list px-4 py-3">
          <div class="d-flex justify-center mb-3">
            <VBtn
              v-if="messagesPaging.current_page < messagesPaging.total_pages"
              size="small"
              variant="tonal"
              :loading="loadingMessages"
              @click="loadMoreMessages"
            >
              Carregar mensagens anteriores
            </VBtn>
          </div>

          <div
            v-for="message in messages"
            :key="message.message_id"
            class="internal-chat-message-row"
            :class="{
              'internal-chat-message-row--mine': isOwnMessage(message),
            }"
          >
            <div class="internal-chat-message-bubble">
              <div class="d-flex align-center justify-space-between mb-1">
                <span class="text-caption text-medium-emphasis">
                  {{ message.user?.name || 'Sistema' }}
                </span>

                <div class="d-flex align-center gap-1">
                  <span class="text-caption text-medium-emphasis">
                    {{ formatMessageDate(message.date) }}
                  </span>

                  <VMenu location="bottom end">
                    <template #activator="{ props }">
                      <IconBtn size="x-small" v-bind="props">
                        <VIcon size="14">tabler-dots</VIcon>
                      </IconBtn>
                    </template>

                    <VList density="comfortable">
                      <VListItem @click="onReply(message)">
                        <VListItemTitle>Responder</VListItemTitle>
                      </VListItem>
                      <VListItem @click="onReact(message)">
                        <VListItemTitle>Reagir</VListItemTitle>
                      </VListItem>
                      <VListItem @click="openForwardDialog(message)">
                        <VListItemTitle>Encaminhar</VListItemTitle>
                      </VListItem>
                      <VListItem
                        v-if="
                          isOwnMessage(message) &&
                          message.content?.type === EMessageType.text
                        "
                        @click="onEdit(message)"
                      >
                        <VListItemTitle>Editar</VListItemTitle>
                      </VListItem>
                      <VListItem
                        v-if="isOwnMessage(message)"
                        @click="onDelete(message)"
                      >
                        <VListItemTitle>Apagar</VListItemTitle>
                      </VListItem>
                    </VList>
                  </VMenu>
                </div>
              </div>

              <div
                v-if="
                  message.content?.quoted?.message ||
                  message.content?.message_quoted_id
                "
                class="internal-chat-quoted mb-2 px-2 py-1"
              >
                <span class="text-caption text-medium-emphasis">
                  Resposta
                </span>
                <div class="text-body-2 text-truncate">
                  {{
                    message.content?.quoted?.message ||
                    message.content?.message_quoted_id
                  }}
                </div>
              </div>

              <div
                v-if="resolveMessageText(message)"
                class="internal-chat-message-text mb-2"
              >
                {{ resolveMessageText(message) }}
              </div>

              <img
                v-if="message.content?.image?.url"
                :src="message.content.image.url"
                class="internal-chat-media"
                alt="Imagem"
              />

              <video
                v-if="message.content?.video?.url"
                :src="message.content.video.url"
                class="internal-chat-media"
                controls
              />

              <audio
                v-if="message.content?.audio?.url"
                :src="message.content.audio.url"
                controls
                class="w-100"
              />

              <a
                v-if="message.content?.document?.url"
                :href="message.content.document.url"
                target="_blank"
                class="d-inline-flex align-center text-decoration-none"
              >
                <VIcon size="16" class="me-1">tabler-file</VIcon>
                {{ message.content.document.name || 'Documento' }}
              </a>

              <a
                v-if="message.content?.location"
                class="d-inline-flex align-center text-decoration-none mt-1"
                target="_blank"
                :href="`https://www.google.com/maps?q=${message.content.location.latitude},${message.content.location.longitude}`"
              >
                <VIcon size="16" class="me-1">tabler-map-pin</VIcon>
                {{
                  message.content.location.name ||
                  message.content.location.address ||
                  'Localização'
                }}
              </a>

              <div
                v-if="message.content?.contact || message.content?.contacts"
                class="text-body-2 mt-1"
              >
                {{
                  message.content.contact?.name ||
                  message.content.contacts?.map((item) => item.name).join(', ')
                }}
              </div>

              <div
                v-if="message.content?.reactions?.length"
                class="d-flex flex-wrap gap-1 mt-2"
              >
                <VChip
                  v-for="(reaction, index) in message.content.reactions"
                  :key="`${message.message_id}-reaction-${index}`"
                  size="x-small"
                  variant="outlined"
                >
                  {{ reaction.emoji }}
                </VChip>
              </div>
            </div>
          </div>
        </div>

        <VDivider />

        <div class="internal-chat-composer px-4 py-3">
          <VAlert
            v-if="replyMessage"
            density="comfortable"
            type="info"
            variant="tonal"
            class="mb-3"
          >
            <div class="d-flex align-center justify-space-between gap-2">
              <div class="text-truncate">
                Respondendo:
                {{ resolveMessageText(replyMessage) || 'Mensagem' }}
              </div>
              <IconBtn @click="replyMessage = null">
                <VIcon size="16">tabler-x</VIcon>
              </IconBtn>
            </div>
          </VAlert>

          <div v-if="hasAnyAttachment" class="d-flex flex-column gap-2 mb-3">
            <div
              v-if="selectedImages.length > 0"
              class="d-flex align-center flex-wrap gap-2"
            >
              <VChip
                v-for="(file, index) in selectedImages"
                :key="`img-${file.name}-${index}`"
                closable
                @click:close="removeFileAtIndex(selectedImages, index)"
              >
                {{ file.name }}
              </VChip>
            </div>

            <div
              v-if="selectedVideos.length > 0"
              class="d-flex align-center flex-wrap gap-2"
            >
              <VChip
                v-for="(file, index) in selectedVideos"
                :key="`video-${file.name}-${index}`"
                closable
                @click:close="removeFileAtIndex(selectedVideos, index)"
              >
                {{ file.name }}
              </VChip>
            </div>

            <div
              v-if="selectedDocuments.length > 0"
              class="d-flex align-center flex-wrap gap-2"
            >
              <VChip
                v-for="(file, index) in selectedDocuments"
                :key="`doc-${file.name}-${index}`"
                closable
                @click:close="removeFileAtIndex(selectedDocuments, index)"
              >
                {{ file.name }}
              </VChip>
            </div>

            <div
              v-if="selectedAudios.length > 0"
              class="d-flex align-center flex-wrap gap-2"
            >
              <VChip
                v-for="(file, index) in selectedAudios"
                :key="`audio-${file.name}-${index}`"
                closable
                @click:close="removeFileAtIndex(selectedAudios, index)"
              >
                {{ file.name }}
              </VChip>
            </div>
          </div>

          <VTextarea
            v-model="composerText"
            :rows="1"
            :max-rows="6"
            auto-grow
            variant="outlined"
            density="comfortable"
            placeholder="Digite uma mensagem interna"
            class="internal-chat-textarea"
            @keydown.enter.exact.prevent="sendMessage"
          >
            <template #prepend-inner>
              <div class="d-flex align-center gap-1">
                <IconBtn @click="documentInputRef?.click()">
                  <VIcon size="18">tabler-file</VIcon>
                </IconBtn>
                <IconBtn @click="imageInputRef?.click()">
                  <VIcon size="18">tabler-photo</VIcon>
                </IconBtn>
                <IconBtn @click="videoInputRef?.click()">
                  <VIcon size="18">tabler-video</VIcon>
                </IconBtn>
                <IconBtn @click="audioInputRef?.click()">
                  <VIcon size="18">tabler-headphones</VIcon>
                </IconBtn>
                <IconBtn @click="isContactDialogOpen = true">
                  <VIcon size="18">tabler-user</VIcon>
                </IconBtn>
                <IconBtn @click="isLocationDialogOpen = true">
                  <VIcon size="18">tabler-map-pin</VIcon>
                </IconBtn>
              </div>
            </template>

            <template #append-inner>
              <div class="d-flex align-center gap-1">
                <VChip
                  v-if="isRecordingAudio"
                  color="error"
                  variant="flat"
                  size="small"
                >
                  Gravando {{ formattedRecordingDuration }}
                </VChip>

                <IconBtn
                  color="error"
                  variant="text"
                  @click="toggleAudioRecording"
                >
                  <VIcon size="18">
                    {{
                      isRecordingAudio
                        ? 'tabler-player-stop'
                        : 'tabler-microphone'
                    }}
                  </VIcon>
                </IconBtn>

                <IconBtn
                  v-if="isRecordingAudio"
                  color="warning"
                  variant="text"
                  @click="cancelAudioRecording"
                >
                  <VIcon size="18">tabler-x</VIcon>
                </IconBtn>

                <VBtn
                  color="success"
                  variant="flat"
                  :disabled="!hasComposerContent"
                  :loading="sendingMessage"
                  @click="sendMessage"
                >
                  <VIcon size="18" class="me-1">tabler-send</VIcon>
                  Enviar
                </VBtn>
              </div>
            </template>
          </VTextarea>

          <input
            ref="imageInputRef"
            type="file"
            hidden
            multiple
            accept="image/*"
            @change="onImagesSelected"
          />
          <input
            ref="videoInputRef"
            type="file"
            hidden
            multiple
            accept="video/*"
            @change="onVideosSelected"
          />
          <input
            ref="documentInputRef"
            type="file"
            hidden
            multiple
            @change="onDocumentsSelected"
          />
          <input
            ref="audioInputRef"
            type="file"
            hidden
            multiple
            accept="audio/*"
            @change="onAudiosSelected"
          />
        </div>
      </template>

      <div
        v-else
        class="d-flex h-100 align-center justify-center flex-column text-medium-emphasis"
      >
        <VAvatar size="92" variant="tonal" color="primary" class="mb-3">
          <VIcon size="44">tabler-users-group</VIcon>
        </VAvatar>
        <div class="text-subtitle-1 mb-1">Chat Interno</div>
        <div class="text-body-2">
          {{
            isConversationMode
              ? 'Selecione uma conversa aberta'
              : 'Nenhuma conversa aberta. Escolha um usuário na lista.'
          }}
        </div>
      </div>
    </section>

    <VDialog v-model="isGroupDialogOpen" max-width="520">
      <VCard title="Novo Grupo Interno">
        <VCardText>
          <AppTextField
            v-model="groupName"
            label="Nome do grupo"
            placeholder="Ex: Suporte Interno"
            class="mb-4"
          />

          <div class="text-body-2 text-medium-emphasis mb-2">
            Membros do grupo
          </div>

          <div class="internal-chat-members-list">
            <VCheckbox
              v-for="user in users"
              :key="`group-member-${user.user_id}`"
              v-model="groupMemberUserIds"
              :label="user.name"
              :value="user.user_id"
              density="compact"
              hide-details
            />
          </div>
        </VCardText>
        <VCardActions class="px-4 pb-4 pt-0">
          <VSpacer />
          <VBtn variant="text" @click="isGroupDialogOpen = false"
            >Cancelar</VBtn
          >
          <VBtn
            color="primary"
            :loading="creatingGroup"
            :disabled="groupName.trim().length === 0"
            @click="submitCreateGroup"
          >
            Criar Grupo
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>

    <VDialog v-model="isForwardDialogOpen" max-width="560">
      <VCard title="Encaminhar mensagem">
        <VCardText>
          <div class="text-body-2 text-medium-emphasis mb-2">
            Selecione as conversas de destino
          </div>

          <VCheckbox
            v-for="conversation in conversations"
            :key="`forward-${conversation.conversation_id}`"
            v-model="forwardConversationIds"
            :value="conversation.conversation_id"
            density="comfortable"
            hide-details
            :label="conversation.name || 'Conversa interna'"
            :disabled="
              conversation.conversation_id ===
              activeConversation?.conversation_id
            "
          />
        </VCardText>
        <VCardActions class="px-4 pb-4 pt-0">
          <VSpacer />
          <VBtn variant="text" @click="isForwardDialogOpen = false"
            >Cancelar</VBtn
          >
          <VBtn
            color="primary"
            :loading="forwardingMessage"
            :disabled="forwardConversationIds.length === 0"
            @click="submitForward"
          >
            Encaminhar
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>

    <VDialog v-model="isLocationDialogOpen" max-width="520">
      <VCard title="Enviar localização">
        <VCardText>
          <AppTextField
            v-model="locationLatitude"
            label="Latitude"
            placeholder="-23.5505"
            class="mb-3"
          />
          <AppTextField
            v-model="locationLongitude"
            label="Longitude"
            placeholder="-46.6333"
            class="mb-3"
          />
          <AppTextField
            v-model="locationName"
            label="Nome (opcional)"
            class="mb-3"
          />
          <AppTextField v-model="locationAddress" label="Endereço (opcional)" />
        </VCardText>
        <VCardActions class="px-4 pb-4 pt-0">
          <VSpacer />
          <VBtn variant="text" @click="isLocationDialogOpen = false">
            Cancelar
          </VBtn>
          <VBtn color="primary" @click="sendLocationMessage">
            Enviar localização
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>

    <VDialog v-model="isContactDialogOpen" max-width="520">
      <VCard title="Enviar contato">
        <VCardText>
          <AppTextField
            v-model="contactName"
            label="Nome do contato"
            placeholder="Nome"
            class="mb-3"
          />
          <AppTextField
            v-model="contactPhone"
            label="Telefone"
            placeholder="+55 11 99999-0000"
          />
        </VCardText>
        <VCardActions class="px-4 pb-4 pt-0">
          <VSpacer />
          <VBtn variant="text" @click="isContactDialogOpen = false">
            Cancelar
          </VBtn>
          <VBtn color="primary" @click="sendContactMessage">
            Enviar contato
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>
  </div>
</template>

<style scoped lang="scss">
.internal-chat-layout {
  min-height: 100%;
  background: rgb(var(--v-theme-background));
}

.internal-chat-sidebar {
  width: 340px;
  border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgb(var(--v-theme-surface));
  display: flex;
  flex-direction: column;
}

.internal-chat-sidebar-body {
  flex: 1;
  overflow-y: auto;
}

.internal-chat-main {
  flex: 1;
  min-width: 0;
}

.internal-chat-main-header {
  min-height: 72px;
}

.internal-chat-message-list {
  flex: 1;
  overflow-y: auto;
}

.internal-chat-message-row {
  display: flex;
  margin-bottom: 12px;
}

.internal-chat-message-row--mine {
  justify-content: flex-end;
}

.internal-chat-message-bubble {
  max-width: min(78%, 720px);
  border-radius: 12px;
  padding: 10px 12px;
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.internal-chat-message-row--mine .internal-chat-message-bubble {
  background: rgba(var(--v-theme-primary), 0.14);
}

.internal-chat-message-text {
  white-space: pre-wrap;
  word-break: break-word;
}

.internal-chat-quoted {
  border-left: 3px solid rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
}

.internal-chat-media {
  max-width: 100%;
  border-radius: 8px;
  max-height: 320px;
  display: block;
}

.internal-chat-members-list {
  max-height: 280px;
  overflow-y: auto;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  padding: 8px;
}

@media (max-width: 959px) {
  .internal-chat-layout {
    flex-direction: column;
  }

  .internal-chat-sidebar {
    width: 100%;
    max-height: 45vh;
  }
}
</style>
