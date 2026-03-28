<script lang="ts" setup>
import {
  computed,
  watch,
  nextTick,
  onMounted,
  onUnmounted,
  onBeforeUnmount,
  ref,
} from 'vue';
import { useRoute } from 'vue-router';
import { PerfectScrollbar } from 'vue3-perfect-scrollbar';
import { useDisplay, useTheme } from 'vuetify';
import { themes } from '@/plugins/vuetify/theme';
import ChatActiveChatUserProfileSidebarContent from '@/components/chat/ChatActiveChatUserProfileSidebarContent.vue';
import ChatLeftSidebarContent from '@/components/chat/ChatLeftSidebarContent.vue';
import ChatLog from '@/components/chat/ChatLog.vue';
import ChatQuickMessagePreview from '@/components/chat/ChatQuickMessagePreview.vue';
import ChatUserProfileSidebarContent from '@/components/chat/ChatUserProfileSidebarContent.vue';
import ChatSearchSidebarContent from '@/components/chat/ChatSearchSidebarContent.vue';
import ChatAttendanceHistorySidebarContent from '@/components/chat/ChatAttendanceHistorySidebarContent.vue';
import AppContactPicker from '@/components/chat/AppContactPicker.vue';
import AppAddContactChat from '@/components/chat/AppAddContactChat.vue';
import AppEditContactChat from '@/components/chat/AppEditContactChat.vue';
import ChatLocationPicker from '@/components/chat/ChatLocationPicker.vue';
import ChatContactViewModal from '@/components/chat/ChatContactViewModal.vue';
import ChatLabelModal from '@/components/chat/ChatLabelModal.vue';
import ChatLinkPreview from '@/components/chat/ChatLinkPreview.vue';
import ChatProtocolBadgeDialog from '@/components/chat/ChatProtocolBadgeDialog.vue';
import ChatQueueStatusBanner from '@/components/chat/ChatQueueStatusBanner.vue';
import ChatMediaViewer from '@/components/chat/ChatMediaViewer.vue';
import AiReplyModal from '@/components/chat/AiReplyModal.vue';
import TranscribeModal from '@/components/chat/TranscribeModal.vue';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EChatbotPermissions } from '@core/common/enums/EPermissions/chatbot';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import { EPermissionRole } from '@core/common/enums/EPermissionRole';
import { getPermissions, getSectors } from '@/@webcore/localStorage/user';
import { can } from '@/@layouts/plugins/casl';
import { ListChatsResult } from '@core/schema/chat/listChats/response.schema';
import { useChatStore } from '@/@webcore/stores/chat';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { ViewWorkerConfigForChatResponse } from '@core/schema/chat/viewWorkerConfigForChat/response.schema';
import { ViewChatAttendantsResponse } from '@core/schema/chat/viewChatAttendants/response.schema';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import { generateProtocol } from '@core/common/functions/generateProtocol';
import { ViewChatContactResponse } from '@core/schema/chat/viewContact/response.schema';
import { CreateContactRequest } from '@core/schema/contact/createContact/request.schema';
import { ListMessageChatsQuery } from '@core/schema/chat/listMessageChats/request.schema';
import {
  ContentMessageChat,
  ListMessageResult,
} from '@core/schema/chat/listMessageChats/response.schema';
import { useChatSocket } from '@/composables/useChatSocket';
import { CreateMessageChatsBody } from '@core/schema/chat/createMessageChats/request.schema';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EColor } from '@core/common/enums/EColor';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import type { TransferWorker } from '@core/schema/chat/listTransferOptions/response.schema';
import {
  IChatMessage,
  IQuotedMessage,
} from '@core/common/interfaces/IChatMessage';
import { IChat } from '@core/common/interfaces/IChat';
import { IChatTyping } from '@core/common/interfaces/IChatTyping';
import {
  isChatParticipant,
  isChatPrimary,
  isChatSecondary,
} from '@core/common/functions/chatParticipants';
import {
  ISelectedPhotoPreview,
  ISelectedDocumentPreview,
  ISelectedVideoPreview,
  ISelectedAudioPreview,
  ISelectedContactPreview,
} from '@core/common/interfaces/IChatFilePreview';
import { extractFirstUrl } from '@core/common/functions/extractFirstUrl';
import { ViewLinkPreviewResponse } from '@core/schema/chat/viewLinkPreview/response.schema';
import { refDebounced } from '@vueuse/core';
import { getOffsetTop } from '@core/common/functions/getOffsetTop';
import { Picker, EmojiIndex } from 'emoji-mart-vue-fast/src';
import data from 'emoji-mart-vue-fast/data/all.json';
import 'emoji-mart-vue-fast/css/emoji-mart.css';
import { useI18n } from 'vue-i18n';
import { ListQuickMessageTemplatesResponse } from '@core/schema/chat/listQuickMessageTemplates/response.schema';

const emojiIndex = new EmojiIndex(data);
const { t } = useI18n();

const MAX_DOCUMENT_SIZE_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_SIZE_BYTES = 16 * 1024 * 1024;
const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024;
const MAX_AUDIO_SIZE_BYTES = 16 * 1024 * 1024;

definePage({
  meta: {
    layoutWrapperClasses: 'layout-content-height-fixed',
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
      EChatPermissions.chat_access,
      EChatPermissions.view_chatbot_messages,
      EChatbotPermissions.chatbot_group,
      EChatbotPermissions.chatbot_access,
    ],
  },
});

const chatStore = useChatStore();
const channelStore = useChannelsStore();
const chatSocket = useChatSocket();
const route = useRoute();
useSnackbarCleanup(chatStore);
const { name, global } = useTheme();
const vuetifyDisplays = useDisplay();

const contact_id = ref('contact-id');
const { isLeftSidebarOpen } = useResponsiveLeftSidebar(
  vuetifyDisplays.smAndDown
);

const currentPage = ref(1);
const perPage = ref(10);
const chatLogPS = ref();
const resizeHandler = ref<(() => void) | null>(null);
const q = ref('');
const msg = ref('');
const messageDraftByChatId = ref<Record<string, string>>({});
const quickMessageTemplates = ref<
  import('@core/schema/chat/listQuickMessageTemplates/response.schema').ListQuickMessageTemplatesResponse[]
>([]);
const showQuickMessageList = ref(false);
const quickMessageSearch = ref('');
const selectedQuickMessage = ref<
  | import('@core/schema/chat/listQuickMessageTemplates/response.schema').ListQuickMessageTemplatesResponse
  | null
>(null);
const isUserProfileSidebarOpen = ref(false);
const isUpdatingUserProfileStatus = ref(false);
const isActiveChatUserProfileSidebarOpen = ref(false);
const isSearchSidebarOpen = ref(false);
const isAttendanceHistorySidebarOpen = ref(false);
const linkPreview = ref<ViewLinkPreviewResponse | null>(null);
const isLoadingLinkPreview = ref(false);
const hasUrlInMessage = computed(() => {
  return !!extractFirstUrl(msg.value as string);
});
const composerRef = ref();

const fileDocRef = ref<HTMLInputElement | null>(null);
const filePhotoRef = ref<HTMLInputElement | null>(null);
const fileVideoRef = ref<HTMLInputElement | null>(null);
const fileAudioRef = ref<HTMLInputElement | null>(null);
const leftSidebarRef = ref<InstanceType<typeof ChatLeftSidebarContent>>();
const isEmojiOpen = ref(false);
const isContactPickerOpen = ref(false);
const isLocationPickerOpen = ref(false);
const isAnnotationModalOpen = ref(false);
const annotationText = ref('');
const isAnnotationEmojiOpen = ref(false);
const isContactViewModalOpen = ref(false);
const selectedContactDetails = ref<ViewChatContactResponse | null>(null);
const isAddContactModalOpen = ref(false);
const addContactInitialData = ref<Partial<CreateContactRequest> | null>(null);
const isEditContactModalOpen = ref(false);
const editContactId = ref<string | null>(null);
const viewContactEmail = ref<string | null>(null);
const viewContactEmailPartial = ref<string | null>(null);
const viewContactPhone = ref<string | null>(null);
const viewContactPhonePartial = ref<string | null>(null);
const isViewEmailDecrypted = ref(false);
const isViewPhoneDecrypted = ref(false);
const isLoadingViewEmail = ref(false);
const isLoadingViewPhone = ref(false);
const headerPhoneDecrypted = ref<string | null>(null);
const isHeaderPhoneDecrypted = ref(false);
const isHeaderPhoneLoading = ref(false);
type RemoteActivityMode = 'typing' | 'recording';
const typingStates = ref(
  new Map<string, { mode: RemoteActivityMode; timestamp: number }>()
);
const typingTimeouts = ref(new Map<string, NodeJS.Timeout>());
const selectedPhotos = ref<ISelectedPhotoPreview[]>([]);
const selectedDocuments = ref<ISelectedDocumentPreview[]>([]);
const selectedVideos = ref<ISelectedVideoPreview[]>([]);
const selectedAudios = ref<ISelectedAudioPreview[]>([]);
const selectedContacts = ref<ISelectedContactPreview[]>([]);
const selectedLocation = ref<{
  latitude: number;
  longitude: number;
  name?: string | null;
  address?: string | null;
} | null>(null);

const persistMessageDraft = (
  chatId: string | null | undefined,
  messageValue: string | null | undefined
) => {
  if (!chatId) return;

  const nextMessage = messageValue ?? '';
  if (nextMessage.length === 0) {
    delete messageDraftByChatId.value[chatId];
    return;
  }

  messageDraftByChatId.value[chatId] = nextMessage;
};

const getMessageDraft = (chatId: string | null | undefined): string => {
  if (!chatId) return '';
  return messageDraftByChatId.value[chatId] ?? '';
};

const isRecordingAudio = ref(false);
const isRecordingPaused = ref(false);
const audioViewOnce = ref(false);
const audioPendingViewOnce = ref(false);
const audioRecordingStartAt = ref<number | null>(null);
const audioRecordingAccumulated = ref(0);
const audioRecordingElapsedMs = ref(0);
const audioRecordingTimerId = ref<number | null>(null);
const audioRecordingRAFId = ref<number | null>(null);
const mediaRecorderRef = ref<MediaRecorder | null>(null);
const audioStreamRef = ref<MediaStream | null>(null);
const audioContextRef = ref<AudioContext | null>(null);
const audioAnalyserRef = ref<AnalyserNode | null>(null);
const audioDataArrayRef = ref<Uint8Array | null>(null);
const audioCanvasRef = ref<HTMLCanvasElement | null>(null);
const audioChunksRef = ref<Blob[]>([]);
const shouldPersistRecording = ref(false);
const recordedAudioBlob = ref<Blob | null>(null);
const recordedAudioUrl = ref<string | null>(null);
const audioRecordingDurationSeconds = ref<number | null>(null);

const viewerOpen = ref(false);
const viewerSrc = ref<string>('');
const viewerCaption = ref<string>('');
const viewerDownloadName = ref<string>('');
const viewerKind = ref<'image' | 'video'>('image');

const hasContent = computed(() => !!msg.value && msg.value.trim().length > 0);

const isQueueStatus = computed(
  () => chatStore.activeChat?.status === EChatStatus.queue
);

const isUraStatus = computed(
  () =>
    chatStore.activeChat?.status === EChatStatus.ura ||
    chatStore.activeChat?.status === EChatStatus.ura_output ||
    chatStore.activeChat?.status === EChatStatus.ura_schedule ||
    chatStore.activeChat?.status === EChatStatus.ura_webhook
);

const isClosedStatus = computed(
  () => chatStore.activeChat?.status === EChatStatus.closed
);

const isQueueOrUraStatus = computed(() => {
  return (
    chatStore.activeChat?.status === EChatStatus.queue ||
    chatStore.activeChat?.status === EChatStatus.ura ||
    chatStore.activeChat?.status === EChatStatus.ura_output ||
    chatStore.activeChat?.status === EChatStatus.ura_schedule ||
    chatStore.activeChat?.status === EChatStatus.ura_webhook
  );
});

const workerConfigForChat = ref<ViewWorkerConfigForChatResponse>(null);
const isLoadingWorkerConfig = ref(false);
const lastLoadedWorkerConfigId = ref<string | null>(null);

const getStatusColor = (status: EChatUserStatus): string => {
  const isDark = global.name.value === 'dark';

  const colorMap: Record<EChatUserStatus, string> = {
    [EChatUserStatus.online]: '#4caf50',
    [EChatUserStatus.busy]: '#f44336',
    [EChatUserStatus.away]: '#ff9800',
    [EChatUserStatus.offline]: isDark ? '#9e9e9e' : '#757575',
    [EChatUserStatus.do_not_disturb]: '#ff9800',
  };
  return colorMap[status] || (isDark ? '#9e9e9e' : '#757575');
};

const userStatus = computed(
  () =>
    (chatStore.user?.chat_user?.status as EChatUserStatus | undefined) ||
    EChatUserStatus.offline
);

const cannotAttendDueToStatus = computed(() => {
  if (!isQueueOrUraStatus.value && !isClosedStatus.value) return false;
  if (!workerConfigForChat.value?.allow_attendance_only_online) return false;
  return userStatus.value !== EChatUserStatus.online;
});

const cannotAttendDueToLimit = computed(() => {
  if (!isQueueOrUraStatus.value && !isClosedStatus.value) return false;
  if (cannotAttendDueToStatus.value) return false;
  if (!workerConfigForChat.value?.simultaneous_attendance_enabled) return false;
  if (!chatStore.activeChat?.worker?.id || !chatStore.user?.user_id)
    return false;

  const limit = workerConfigForChat.value.simultaneous_attendance;
  if (limit === null || limit === undefined) return false;

  const currentInChatCount = chatStore.listInChat.filter(
    (chat) =>
      isChatParticipant(chat as unknown as IChat, chatStore.user?.user_id) &&
      chat.worker?.id === chatStore.activeChat?.worker?.id
  ).length;

  return currentInChatCount >= limit;
});

const canAttendChat = computed(() => {
  if (!isQueueOrUraStatus.value) return false;
  if (cannotAttendDueToStatus.value) return false;
  if (cannotAttendDueToLimit.value) return false;
  return true;
});

const isCurrentUserParticipantInActiveChat = computed(() => {
  const activeChat = chatStore.activeChat as IChat | null;
  if (!activeChat) {
    return false;
  }

  return isChatParticipant(activeChat, chatStore.user?.user_id);
});

const isCurrentUserPrimaryInActiveChat = computed(() => {
  const activeChat = chatStore.activeChat as IChat | null;
  if (!activeChat) {
    return false;
  }

  return isChatPrimary(activeChat, chatStore.user?.user_id);
});

const isCurrentUserSecondaryInActiveChat = computed(() => {
  const activeChat = chatStore.activeChat as IChat | null;
  if (!activeChat) {
    return false;
  }

  return isChatSecondary(activeChat, chatStore.user?.user_id);
});

const isCurrentUserMasterOrAdministrator = computed(() => {
  const roleId = chatStore.user?.type?.user_type_id;
  if (!roleId) {
    return false;
  }

  const normalizedRoleId = roleId.trim().toLowerCase();

  return (
    normalizedRoleId === EPermissionRole.master ||
    normalizedRoleId === EPermissionRole.administrator
  );
});

const hasManageInChatLifecyclePermission = computed(() => {
  return can([
    EGeneralPermissions.full_access,
    EGeneralPermissions.full_access_group,
    EChatPermissions.manage_in_chat_lifecycle,
  ]);
});

const hasViewChatAttendantsInfoPermission = computed(() => {
  return can([
    EGeneralPermissions.full_access,
    EGeneralPermissions.full_access_group,
    EChatPermissions.chat_group,
    EChatPermissions.view_chat_attendants_info,
  ]);
});

const canManageInChatLifecycle = computed(() => {
  return (
    isCurrentUserPrimaryInActiveChat.value ||
    isCurrentUserMasterOrAdministrator.value ||
    hasManageInChatLifecyclePermission.value
  );
});

const canJoinConversation = computed(() => {
  const activeChat = chatStore.activeChat as IChat | null;
  if (!activeChat) {
    return false;
  }

  if (activeChat.status !== EChatStatus.in_chat) {
    return false;
  }

  return !isCurrentUserParticipantInActiveChat.value;
});

const canComposeInActiveChat = computed(() => {
  if (!chatStore.activeChat?.chat_id) {
    return false;
  }

  if (isQueueStatus.value || isUraStatus.value || isClosedStatus.value) {
    return false;
  }

  return isCurrentUserParticipantInActiveChat.value;
});

const canReopenChatPermission = computed(() => {
  return can([
    EGeneralPermissions.full_access,
    EGeneralPermissions.full_access_group,
    EChatPermissions.chat_group,
    EChatPermissions.reopen_chat,
  ]);
});

const canReopenChat = computed(() => {
  if (!isClosedStatus.value) return false;
  if (!canReopenChatPermission.value) return false;
  if (cannotAttendDueToStatus.value) return false;
  if (cannotAttendDueToLimit.value) return false;
  return true;
});

const showProtocolInChat = computed(() => {
  return workerConfigForChat.value?.show_protocol_in_chat === true;
});

const loadWorkerConfigForChat = async (forceReload = false) => {
  const workerId = chatStore.activeChat?.worker?.id;
  if (!workerId) {
    workerConfigForChat.value = null;
    isLoadingWorkerConfig.value = false;
    lastLoadedWorkerConfigId.value = null;
    return;
  }

  if (
    !forceReload &&
    lastLoadedWorkerConfigId.value === workerId &&
    workerConfigForChat.value !== null
  ) {
    return;
  }

  if (
    isLoadingWorkerConfig.value &&
    lastLoadedWorkerConfigId.value === workerId
  ) {
    return;
  }

  isLoadingWorkerConfig.value = true;
  lastLoadedWorkerConfigId.value = workerId;
  try {
    const config = await channelStore.fetchWorkerConfigForChat(workerId);
    if (lastLoadedWorkerConfigId.value === workerId) {
      workerConfigForChat.value = config;
    }
  } catch (error) {
    if (lastLoadedWorkerConfigId.value === workerId) {
      workerConfigForChat.value = null;
    }
  } finally {
    if (lastLoadedWorkerConfigId.value === workerId) {
      isLoadingWorkerConfig.value = false;
    }
  }
};

watch(
  () => chatStore.activeChat?.worker?.id,
  (newWorkerId, oldWorkerId) => {
    if (newWorkerId !== oldWorkerId || workerConfigForChat.value === null) {
      loadWorkerConfigForChat().catch(() => {});
    }
  },
  { immediate: true }
);

watch(
  () => route.name,
  async (newRouteName, oldRouteName) => {
    if (
      newRouteName === 'chat' &&
      oldRouteName !== 'chat' &&
      chatStore.activeChat?.chat_id
    ) {
      await chatSocket.refreshActiveChat();
      await nextTick();
      requestAnimationFrame(() => {
        scrollToBottomInChatLog();
      });
    }
  }
);

watch(
  () => route.query.chat_id,
  async (nextChatId, previousChatId) => {
    if (route.name !== 'chat') {
      return;
    }

    const nextValue = Array.isArray(nextChatId) ? nextChatId[0] : nextChatId;
    const previousValue = Array.isArray(previousChatId)
      ? previousChatId[0]
      : previousChatId;

    if (!nextValue || nextValue === previousValue) {
      return;
    }

    await openChat(nextValue, {
      skipClearSummary: true,
      forceReload: true,
    });
  }
);

const isAttendReopenLoading = ref(false);
const isJoinConversationLoading = ref(false);
const queueBannerActionLoading = computed(() => {
  if (canJoinConversation.value) {
    return isJoinConversationLoading.value;
  }

  return isAttendReopenLoading.value;
});

const handleAttendChat = async () => {
  if (!chatStore.activeChat?.chat_id || isAttendReopenLoading.value) return;

  isAttendReopenLoading.value = true;
  try {
    const success = await chatStore.updateChatStatus(
      chatStore.activeChat.chat_id,
      EChatStatus.in_chat
    );

    if (success) {
      chatStore.showSnackbar(t('chat_attended_successfully'), EColor.success);
      await nextTick();
      leftSidebarRef.value?.scrollToTop();
    }
  } finally {
    isAttendReopenLoading.value = false;
  }
};

const handleReopenChat = async () => {
  if (!chatStore.activeChat?.chat_id || isAttendReopenLoading.value) return;

  isAttendReopenLoading.value = true;
  try {
    const success = await chatStore.updateChatStatus(
      chatStore.activeChat.chat_id,
      EChatStatus.in_chat
    );

    if (success) {
      chatStore.showSnackbar(t('chat_reopened_successfully'), EColor.success);
      await leftSidebarRef.value?.clearAdvancedFilters();
      await nextTick();
      leftSidebarRef.value?.scrollToTop();
    }
  } finally {
    isAttendReopenLoading.value = false;
  }
};

const handleJoinConversation = async () => {
  if (!chatStore.activeChat?.chat_id || isJoinConversationLoading.value) return;

  isJoinConversationLoading.value = true;
  try {
    const joined = await chatStore.joinChat(chatStore.activeChat.chat_id);
    if (!joined) {
      return;
    }

    chatStore.showSnackbar(t('join_conversation_success'), EColor.success);
    await openChat(chatStore.activeChat.chat_id, {
      forceReload: true,
    });
  } finally {
    isJoinConversationLoading.value = false;
  }
};

const isCloseServiceDialogOpen = ref(false);
const closeServiceSendMessageOnFinishAttendance = ref(true);
const isLeaveConversationDialogOpen = ref(false);
const isLeaveConversationLoading = ref(false);
const isAttendantsInfoDialogOpen = ref(false);
const isLoadingAttendantsInfo = ref(false);
const attendantsInfo = ref<ViewChatAttendantsResponse | null>(null);

const handleCloseService = () => {
  if (isInChatStatus.value && !canManageInChatLifecycle.value) {
    chatStore.showSnackbar(t('only_primary_can_close'), EColor.warning);
    return;
  }

  closeServiceSendMessageOnFinishAttendance.value = true;
  isCloseServiceDialogOpen.value = true;
};

const canShowLeaveConversationAction = computed(() => {
  if (!isInChatStatus.value) {
    return false;
  }

  return (
    isCurrentUserSecondaryInActiveChat.value &&
    !isCurrentUserPrimaryInActiveChat.value
  );
});

const handleLeaveConversation = () => {
  if (!canShowLeaveConversationAction.value) {
    chatStore.showSnackbar(t('only_secondary_can_leave'), EColor.warning);
    return;
  }

  isLeaveConversationDialogOpen.value = true;
};

const confirmLeaveConversation = async () => {
  if (!chatStore.activeChat?.chat_id || isLeaveConversationLoading.value) {
    return;
  }

  isLeaveConversationLoading.value = true;
  try {
    const success = await chatStore.leaveChat(chatStore.activeChat.chat_id);
    if (!success) {
      return;
    }

    isLeaveConversationDialogOpen.value = false;
    chatStore.showSnackbar(t('leave_conversation_success'), EColor.success);
    await openChat(chatStore.activeChat.chat_id, {
      forceReload: true,
    });
  } finally {
    isLeaveConversationLoading.value = false;
  }
};

const confirmCloseService = async () => {
  if (!chatStore.activeChat?.chat_id) return;
  isCloseServiceDialogOpen.value = false;

  await chatStore.updateChatStatus(
    chatStore.activeChat.chat_id,
    EChatStatus.closed,
    shouldShowCloseServiceSendMessageToggle.value
      ? {
          send_message_on_finish_attendance:
            closeServiceSendMessageOnFinishAttendance.value,
        }
      : undefined
  );
};

const resolveAttendantPhoto = (photo?: string | null): string => {
  if (typeof photo !== 'string') {
    return '/images/svg/avatar-default.svg';
  }

  const normalizedPhoto = photo.trim();
  if (!normalizedPhoto) {
    return '/images/svg/avatar-default.svg';
  }

  return normalizedPhoto;
};

const hasAttendantPhoto = (photo?: string | null): boolean => {
  if (typeof photo !== 'string') {
    return false;
  }

  return photo.trim().length > 0;
};

const formatAttendantEnteredAt = (enteredAt?: string | null): string => {
  if (!enteredAt) {
    return '-';
  }

  const enteredAtDate = new Date(enteredAt);
  if (Number.isNaN(enteredAtDate.getTime())) {
    return '-';
  }

  return enteredAtDate.toLocaleString();
};

const openAttendantsInfoDialog = async () => {
  const chatId = chatStore.activeChat?.chat_id;
  if (!chatId || isLoadingAttendantsInfo.value) {
    return;
  }

  isLoadingAttendantsInfo.value = true;
  try {
    const response = await chatStore.viewChatAttendants(chatId);
    if (!response) {
      return;
    }

    attendantsInfo.value = response;
    isAttendantsInfoDialogOpen.value = true;
  } finally {
    isLoadingAttendantsInfo.value = false;
  }
};

const attendantsPrimaryUser = computed(
  () => attendantsInfo.value?.primary_user ?? null
);

const attendantsSecondaryUsers = computed(
  () => attendantsInfo.value?.secondary_users ?? []
);

const handleActiveChatHeaderClick = () => {
  isActiveChatUserProfileSidebarOpen.value = true;
};

const resetHeaderPhoneVisibility = () => {
  headerPhoneDecrypted.value = null;
  isHeaderPhoneDecrypted.value = false;
  isHeaderPhoneLoading.value = false;
};

const activeChatHeaderPhoneMasked = computed(() => {
  const activeChat = chatStore.activeChat;
  if (!activeChat) {
    return '';
  }

  if (activeChat.contact?.name && activeChat.contact?.phone) {
    if (activeChat.contact.phone_ddi) {
      return `+${activeChat.contact.phone_ddi} ${activeChat.contact.phone}`;
    }
    return activeChat.contact.phone;
  }

  return formatPhoneBR(activeChat.phone);
});

const activeChatHeaderPhone = computed(() => {
  if (!isHeaderPhoneDecrypted.value || !headerPhoneDecrypted.value) {
    return activeChatHeaderPhoneMasked.value;
  }

  return formatPhone(headerPhoneDecrypted.value);
});

const toggleHeaderPhoneVisibility = async () => {
  const contactId = chatStore.activeChat?.contact?.id;
  if (!contactId) {
    return;
  }

  if (isHeaderPhoneDecrypted.value) {
    resetHeaderPhoneVisibility();
    return;
  }

  isHeaderPhoneLoading.value = true;
  const decryptedPhone =
    await chatStore.getChatContactPhoneDecrypted(contactId);
  isHeaderPhoneLoading.value = false;

  if (decryptedPhone) {
    headerPhoneDecrypted.value = decryptedPhone.replaceAll(/\D/g, '');
    isHeaderPhoneDecrypted.value = true;
  }
};

const isTransferModalOpen = ref(false);
const transferType = ref<'user' | 'sector' | null>(null);
const selectedTransferChannel = ref<string | null>(null);
const selectedTransferUser = ref<string | null>(null);
const selectedTransferSector = ref<string | null>(null);
const selectedTransferSectorUser = ref<string | null>(null);
type TransferChannelOption = {
  value: string;
  title: string;
  name: string;
  number: string | null;
};
const transferChannels = ref<TransferChannelOption[]>([]);
const transferUsers = ref<any[]>([]);
const transferSectors = ref<any[]>([]);
const transferSectorUsers = ref<any[]>([]);
const transferWorkerConfigForChat = ref<ViewWorkerConfigForChatResponse | null>(
  null
);
const isLoadingTransferChannels = ref(false);
const isLoadingTransferUsers = ref(false);
const isLoadingTransferSectors = ref(false);
const isLoadingTransferSectorUsers = ref(false);
const isTransferring = ref(false);
const transferAnnotationText = ref('');
const transferKeepInChat = ref(false);
const transferSendMessageOnTransfer = ref(true);
const isTransferAnnotationEmojiOpen = ref(false);
const activePrimaryUserIdForTransfer = computed(
  () => chatStore.activeChat?.user?.id ?? null
);

const isLabelModalOpen = ref(false);

const isAiReplyModalOpen = ref(false);
const aiReplyTargetMessage = ref<ListMessageResult | null>(null);
const isTranscribeModalOpen = ref(false);
const transcribeTargetMessage = ref<ListMessageResult | null>(null);

const formatChannelNumber = (number?: string | null): string | null => {
  if (!number) return null;
  return formatPhoneBR(number);
};

const selectedTransferChannelOption = computed<TransferChannelOption | null>(
  () =>
    transferChannels.value.find(
      (channel) => channel.value === selectedTransferChannel.value
    ) ?? null
);

const activeContactLabelTemplate = computed<{
  label: string;
  color: string;
} | null>(() => {
  const contactId = chatStore.activeChat?.contact?.id;
  if (!contactId) {
    return null;
  }

  const contact = chatStore.chatContacts[contactId];
  if (contact?.label_templates && contact.label_templates.length > 0) {
    const firstLabel = contact.label_templates[0];
    return {
      label: firstLabel.label,
      color: firstLabel.color,
    };
  }

  return null;
});

const activeContactLabelTemplates = computed(() => {
  const contactId = chatStore.activeChat?.contact?.id;
  if (!contactId) return [];
  const contact = chatStore.chatContacts[contactId];
  return contact?.label_templates ?? [];
});

const remainingContactLabels = computed(() => {
  if (activeContactLabelTemplates.value.length <= 1) return [];
  return activeContactLabelTemplates.value.slice(1);
});

const remainingContactLabelsText = computed(() => {
  return remainingContactLabels.value.map((lt) => lt.label).join(', ');
});

const openLabelModal = () => {
  isLabelModalOpen.value = true;
};

const removeLabel = async () => {
  if (!chatStore.activeChat?.chat_id) return;

  const currentLabels = activeChatLabels.value;
  if (currentLabels.length === 0) return;

  const remainingLabels = currentLabels.slice(1);
  const remainingLabelData = remainingLabels.map((label) => ({
    label_template_id: label.label_template_id,
    label: label.label,
    color: label.color,
  }));
  const remainingLabelIds =
    remainingLabelData.length > 0
      ? remainingLabelData.map((label) => label.label_template_id)
      : null;

  const success = await chatStore.updateChatLabel(
    chatStore.activeChat.chat_id,
    remainingLabelIds,
    remainingLabelData.length > 0 ? remainingLabelData : null
  );

  if (!success) {
    return;
  }

  await nextTick();
};

watch(
  () => chatStore.activeChat?.contact?.id,
  (contactId) => {
    if (contactId) {
      chatStore.getChatContactById(contactId);
    }
  },
  { immediate: true }
);

watch(
  () => chatStore.activeChat?.chat_id,
  () => {
    resetHeaderPhoneVisibility();
    attendantsInfo.value = null;
    isAttendantsInfoDialogOpen.value = false;
  }
);

const loadTransferChannels = async () => {
  if (!chatStore.user?.account_id) return;

  isLoadingTransferChannels.value = true;
  try {
    const options = await chatStore.listTransferOptions();
    transferChannels.value =
      options?.workers.map((worker: TransferWorker) => {
        const formattedNumber = formatChannelNumber(worker.number || null);

        return {
          value: worker.id,
          title: formattedNumber
            ? `${worker.name} (${formattedNumber})`
            : worker.name,
          name: worker.name,
          number: formattedNumber,
        };
      }) ?? [];
  } catch (error) {
    transferChannels.value = [];
  } finally {
    isLoadingTransferChannels.value = false;
  }
};

const loadTransferWorkerConfig = async (channelId?: string | null) => {
  if (!channelId) {
    transferWorkerConfigForChat.value = null;
    return;
  }

  try {
    const config = await channelStore.fetchWorkerConfigForChat(channelId);
    transferWorkerConfigForChat.value = config;
  } catch (error) {
    transferWorkerConfigForChat.value = null;
  }
};

const loadTransferUsers = async (channelId?: string | null) => {
  if (!chatStore.user?.account_id || !channelId) {
    transferUsers.value = [];
    return;
  }

  isLoadingTransferUsers.value = true;
  try {
    const chatId = chatStore.activeChat?.chat_id;
    const users = await chatStore.listTransferUsers(chatId, channelId);
    transferUsers.value = users
      .filter((user) => user.id !== activePrimaryUserIdForTransfer.value)
      .map((user) => ({
        value: user.id,
        title: user.name,
        photo: user.photo || null,
        status: user.status || null,
      }));
  } catch (error) {
    transferUsers.value = [];
  } finally {
    isLoadingTransferUsers.value = false;
  }
};

const loadTransferSectors = async () => {
  if (!chatStore.user?.account_id) return;

  isLoadingTransferSectors.value = true;
  try {
    const sectors = await chatStore.listTransferSectors();
    transferSectors.value = sectors.map((sector) => ({
      value: sector.id,
      title: sector.name,
      color: sector.color || null,
    }));
  } catch (error) {
  } finally {
    isLoadingTransferSectors.value = false;
  }
};

const loadTransferSectorUsers = async (
  sectorId: string,
  channelId?: string | null
) => {
  if (!chatStore.user?.account_id || !sectorId || !channelId) {
    transferSectorUsers.value = [];
    return;
  }

  isLoadingTransferSectorUsers.value = true;
  try {
    const chatId = chatStore.activeChat?.chat_id;
    const users = await chatStore.listTransferSectorUsers(
      sectorId,
      chatId,
      channelId
    );
    transferSectorUsers.value = users
      .filter((user) => user.id !== activePrimaryUserIdForTransfer.value)
      .map((user) => ({
        value: user.id,
        title: user.name,
        photo: user.photo || null,
        status: user.status,
      }));
  } catch (error) {
    transferSectorUsers.value = [];
  } finally {
    isLoadingTransferSectorUsers.value = false;
  }
};

watch(transferType, () => {
  selectedTransferUser.value = null;
  selectedTransferSector.value = null;
  selectedTransferSectorUser.value = null;
  transferSectorUsers.value = [];
});

watch(selectedTransferChannel, async (channelId) => {
  selectedTransferUser.value = null;
  selectedTransferSectorUser.value = null;
  transferUsers.value = [];
  transferSectorUsers.value = [];

  await loadTransferWorkerConfig(channelId);

  if (!channelId) {
    return;
  }

  await loadTransferUsers(channelId);

  if (selectedTransferSector.value) {
    await loadTransferSectorUsers(selectedTransferSector.value, channelId);
  }
});

watch(isTransferModalOpen, (isOpen) => {
  if (!isOpen) {
    transferAnnotationText.value = '';
    transferKeepInChat.value = false;
    transferSendMessageOnTransfer.value = true;
  }
});

watch(selectedTransferSector, (sectorId) => {
  selectedTransferSectorUser.value = null;
  transferSectorUsers.value = [];

  if (sectorId && selectedTransferChannel.value) {
    loadTransferSectorUsers(sectorId, selectedTransferChannel.value);
  }
});

watch(isTransferModalOpen, async (isOpen) => {
  if (isOpen) {
    isLoadingTransferChannels.value = true;
    isLoadingTransferSectors.value = true;
    nextTick(() => {
      try {
        transferType.value = null;
        selectedTransferChannel.value = null;
        selectedTransferUser.value = null;
        selectedTransferSector.value = null;
        selectedTransferSectorUser.value = null;
        transferChannels.value = [];
        transferUsers.value = [];
        transferSectors.value = [];
        transferSectorUsers.value = [];
        transferWorkerConfigForChat.value = null;
        transferAnnotationText.value = '';
        transferKeepInChat.value = false;
        transferSendMessageOnTransfer.value = true;
        isTransferAnnotationEmojiOpen.value = false;
        loadTransferChannels();
        loadTransferSectors();
      } catch {}
    });
  } else {
    transferAnnotationText.value = '';
    transferKeepInChat.value = false;
    transferSendMessageOnTransfer.value = true;
    selectedTransferChannel.value = null;
    transferWorkerConfigForChat.value = null;
  }
});

const handleTransfer = async () => {
  if (!chatStore.activeChat?.chat_id) return;

  if (!canManageInChatLifecycle.value) {
    chatStore.showSnackbar(t('only_primary_can_transfer'), EColor.warning);
    return;
  }

  if (!selectedTransferChannel.value) {
    chatStore.showSnackbar(t('channel_required'), EColor.error);
    return;
  }

  if (transferType.value === 'user' && !selectedTransferUser.value) {
    chatStore.showSnackbar(t('user_required'), EColor.error);
    return;
  }

  if (transferType.value === 'sector' && !selectedTransferSector.value) {
    chatStore.showSnackbar(t('sector_required'), EColor.error);
    return;
  }

  isTransferring.value = true;

  try {
    const userId =
      transferType.value === 'user'
        ? selectedTransferUser.value
        : transferType.value === 'sector'
          ? selectedTransferSectorUser.value || null
          : null;
    if (userId && userId === activePrimaryUserIdForTransfer.value) {
      chatStore.showSnackbar(
        t('cannot_transfer_to_current_primary'),
        EColor.error
      );
      return;
    }

    const sectorId =
      transferType.value === 'sector' ? selectedTransferSector.value : null;
    const workerId = selectedTransferChannel.value;
    const annotation = transferAnnotationText.value.trim() || null;

    const success = await chatStore.transferChat(
      chatStore.activeChat.chat_id,
      userId,
      sectorId,
      annotation,
      leftSidebarRef.value?.hasAppliedAdvancedFilters ?? false,
      workerId,
      transferKeepInChat.value,
      shouldShowTransferSendMessageToggle.value
        ? transferSendMessageOnTransfer.value
        : undefined
    );

    if (success) {
      isTransferModalOpen.value = false;

      const activeChat = chatStore.activeChat as IChat;
      const currentDate = new Date().toISOString();
      const selectedChannel = selectedTransferChannelOption.value;
      let nextUser: IChat['user'] | null = activeChat.user ?? null;
      let nextSector: IChat['sector'] | null = activeChat.sector ?? null;
      let nextSecondaryUsers = Array.isArray(activeChat.secondary_users)
        ? activeChat.secondary_users.filter((user) => !!user?.id)
        : [];
      const secondaryUsersById = new Map(
        nextSecondaryUsers
          .filter((secondaryUser) => !!secondaryUser?.id)
          .map((secondaryUser) => [secondaryUser.id, secondaryUser])
      );
      const nextWorker: IChat['worker'] = selectedChannel
        ? {
            id: selectedChannel.value,
            name: selectedChannel.name,
          }
        : activeChat.worker;

      if (transferType.value === 'user') {
        const selected = transferUsers.value.find(
          (user) => user.value === userId
        );
        const existingSecondary = selected?.value
          ? secondaryUsersById.get(selected.value)
          : undefined;
        nextUser = selected
          ? {
              id: selected.value,
              name: selected.title,
              photo: selected.photo ?? null,
              entered_at: existingSecondary?.entered_at ?? currentDate,
            }
          : null;
        nextSector = null;
      } else if (transferType.value === 'sector') {
        const selected = transferSectors.value.find(
          (sector) => sector.value === sectorId
        );
        nextSector = selected
          ? {
              id: selected.value,
              name: selected.title,
              color: selected.color ?? undefined,
            }
          : null;
        if (userId) {
          const selectedUser = transferSectorUsers.value.find(
            (user) => user.value === userId
          );
          const existingSecondary = selectedUser?.value
            ? secondaryUsersById.get(selectedUser.value)
            : undefined;
          nextUser = selectedUser
            ? {
                id: selectedUser.value,
                name: selectedUser.title,
                photo: selectedUser.photo ?? null,
                entered_at: existingSecondary?.entered_at ?? currentDate,
              }
            : null;
        } else {
          nextUser = null;
        }
      } else {
        nextUser = null;
        nextSector = null;
      }

      nextSecondaryUsers = nextSecondaryUsers.filter(
        (secondaryUser) =>
          secondaryUser?.id && secondaryUser.id !== nextUser?.id
      );

      if (!transferKeepInChat.value && activeChat.user?.id) {
        nextSecondaryUsers = nextSecondaryUsers.filter(
          (secondaryUser) => secondaryUser.id !== activeChat.user?.id
        );
      }

      if (
        transferKeepInChat.value &&
        activeChat.user?.id &&
        activeChat.user.id !== nextUser?.id
      ) {
        const hasActorAsSecondary = nextSecondaryUsers.some(
          (secondaryUser) => secondaryUser.id === activeChat.user?.id
        );

        if (!hasActorAsSecondary) {
          nextSecondaryUsers.push({
            id: activeChat.user.id,
            name: activeChat.user.name,
            photo: activeChat.user.photo ?? null,
            entered_at:
              activeChat.user.entered_at ??
              activeChat.started_at ??
              currentDate,
          });
        }
      }

      chatStore.addChat(
        {
          ...activeChat,
          worker: nextWorker,
          status: EChatStatus.queue,
          user: nextUser,
          secondary_users: nextSecondaryUsers,
          sector: nextSector,
        },
        true
      );

      if (chatStore.activeChat?.chat_id === activeChat.chat_id) {
        chatStore.activeChat = null;
      }

      chatStore.showSnackbar(t('transfer_successfully'), EColor.success);
    }
  } catch (error) {
  } finally {
    isTransferring.value = false;
  }
};

const isInChatStatus = computed(
  () => chatStore.activeChat?.status === EChatStatus.in_chat
);

const canCloseChatWithoutAttending = computed(() => {
  return can([
    EGeneralPermissions.full_access,
    EGeneralPermissions.full_access_group,
    EChatPermissions.chat_group,
    EChatPermissions.close_chat_without_attending,
  ]);
});

const canShowCloseButton = computed(() => {
  if (isInChatStatus.value) {
    return canManageInChatLifecycle.value;
  }

  if (isQueueOrUraStatus.value && canCloseChatWithoutAttending.value) {
    return true;
  }

  return false;
});

const canShowAttendantsInfoAction = computed(() => {
  return (
    !!chatStore.activeChat?.chat_id && hasViewChatAttendantsInfoPermission.value
  );
});

const canShowHeaderActionsMenu = computed(() => {
  return (
    canShowCloseButton.value ||
    canShowAttendantsInfoAction.value ||
    canShowLeaveConversationAction.value
  );
});

const canTransfer = computed(() => {
  return isInChatStatus.value && canManageInChatLifecycle.value;
});

const canViewAttendanceHistory = computed(() => {
  return can([
    EGeneralPermissions.full_access,
    EGeneralPermissions.full_access_group,
    EChatPermissions.chat_group,
    EChatPermissions.attendance_history,
  ]);
});

const canToggleForwardToOutputChatbot = computed(() => {
  return can([
    EGeneralPermissions.full_access,
    EGeneralPermissions.full_access_group,
    EChatPermissions.chat_group,
    EChatPermissions.forward_to_output_chatbot,
  ]);
});

const canDisableSendMessageOnFinishAttendance = computed(() => {
  return can([
    EGeneralPermissions.full_access,
    EGeneralPermissions.full_access_group,
    EChatPermissions.chat_group,
    EChatPermissions.disable_send_message_on_finish_attendance,
  ]);
});

const canDisableSendMessageOnTransfer = computed(() => {
  return can([
    EGeneralPermissions.full_access,
    EGeneralPermissions.full_access_group,
    EChatPermissions.disable_send_message_on_transfer,
  ]);
});

const shouldShowCloseServiceSendMessageToggle = computed(() => {
  return (
    workerConfigForChat.value?.send_message_on_finish_attendance_enabled ===
      true && canDisableSendMessageOnFinishAttendance.value
  );
});

const shouldShowTransferSendMessageToggle = computed(() => {
  return (
    transferWorkerConfigForChat.value?.send_message_on_transfer_enabled ===
      true && canDisableSendMessageOnTransfer.value
  );
});

const isForwardToOutputChatbotActive = computed(
  () => chatStore.activeChat?.forward_to_output_chatbot !== false
);

const handleToggleForwardToOutputChatbot = async () => {
  if (!chatStore.activeChat?.chat_id) return;
  const next = chatStore.activeChat?.forward_to_output_chatbot === false;
  await chatStore.updateForwardToOutputChatbot(
    chatStore.activeChat.chat_id,
    next
  );
};

const activeChatLabels = computed(() => {
  if (!chatStore.activeChat?.label) return [];
  if (Array.isArray(chatStore.activeChat.label)) {
    return chatStore.activeChat.label;
  }
  return [];
});

const activeChatLabelTemplate = computed(() => {
  if (activeChatLabels.value.length === 0) return null;
  return {
    label: activeChatLabels.value[0].label,
    color: activeChatLabels.value[0].color,
  };
});

const activeChatLabelTemplates = computed(() => {
  return activeChatLabels.value;
});

const remainingChatLabels = computed(() => {
  if (activeChatLabelTemplates.value.length <= 1) return [];
  return activeChatLabelTemplates.value.slice(1);
});

const remainingChatLabelsText = computed(() => {
  return remainingChatLabels.value.map((lt) => lt.label).join(', ');
});

const hasAttachmentsOrContent = computed(
  () =>
    hasContent.value ||
    selectedPhotos.value.length > 0 ||
    selectedDocuments.value.length > 0 ||
    selectedVideos.value.length > 0 ||
    selectedAudios.value.length > 0 ||
    selectedContacts.value.length > 0 ||
    isRecordingAudio.value
);
const hasSelectedAudios = computed(() => selectedAudios.value.length > 0);

const createMessageHash = () => crypto.randomUUID();

const cloneLinkPreview = (): ViewLinkPreviewResponse | undefined => {
  const preview = linkPreview.value;
  if (!preview) return undefined;

  return structuredClone(preview);
};

const buildQuotedPayload = (
  replyMessage?: ListMessageResult | null
): IQuotedMessage | null => {
  const reply = replyMessage ?? chatStore.messageReply;
  if (!reply) return null;

  const key = {
    remote_jid: reply.message_key?.remote_jid ?? null,
    remote_jid_alt: reply.message_key?.remote_jid_alt ?? null,
    from_me: reply.message_key?.from_me ?? null,
    id: reply.message_key?.id ?? reply.message_id,
    participant: reply.message_key?.participant ?? null,
    participant_alt: reply.message_key?.participant_alt ?? null,
    addressing_mode: reply.message_key?.addressing_mode ?? null,
    is_view_once: reply.message_key?.is_view_once ?? false,
  } satisfies IQuotedMessage['key'];

  const quotedType = reply.content?.type as EMessageType | undefined;

  const quoted: IQuotedMessage = {
    key,
    message: reply.content?.message ?? null,
    type: quotedType ?? undefined,
    image: reply.content?.image ?? null,
    video: reply.content?.video ?? null,
    document: reply.content?.document ?? null,
    audio: reply.content?.audio ?? null,
    sticker: reply.content?.sticker ?? null,
    location: reply.content?.location ?? null,
    contact: reply.content?.contact ?? null,
  };

  if (quotedType === EMessageType.contacts && reply.content?.contacts) {
    (quoted as any).contacts = reply.content.contacts;
  }

  return quoted;
};

const getQuotedContent = (
  replyMessage?: ListMessageResult | null
): ContentMessageChat['quoted'] | undefined => {
  const payload = buildQuotedPayload(replyMessage);
  if (!payload) return undefined;

  const { type, ...rest } = payload;

  return {
    ...rest,
    type: type ?? undefined,
  } as ContentMessageChat['quoted'];
};

const createLocalMessageSummary = () => ({
  is_sent: false,
  is_delivered: false,
  is_seen: false,
  is_sent_to_internal: true,
});

const formatLocalMessageWithAttendeeName = (
  text: string | null | undefined
): string | null | undefined => {
  if (!text) return text;
  if (!workerConfigForChat.value?.show_attendee_name) return text;

  const attendeeName = chatStore.user?.info?.name?.trim();
  if (!attendeeName) return text;

  const prefix = `*${attendeeName}*:\n\n`;
  if (text.startsWith(prefix)) return text;

  return `${prefix}${text}`;
};

const createLocalMessageEntry = (
  content: ContentMessageChat,
  hash: string
): ListMessageResult => {
  if (!chatStore.activeChat?.chat_id) {
    throw new Error('Cannot create local message without an active chat.');
  }

  const userInfo = chatStore.user?.info;

  return {
    message_id: hash,
    chat_id: chatStore.activeChat.chat_id,
    type_user: ETypeUserChat.operator,
    user: userInfo
      ? {
          id: userInfo.user_info_id,
          name: userInfo.name,
          photo: userInfo.photo ?? null,
        }
      : null,
    content,
    summary: createLocalMessageSummary(),
    date: new Date().toISOString(),
    deleted: false,
    has_quoted: Boolean(content.message_quoted_id),
    hash,
  };
};

const registerLocalMessage = async (
  content: ContentMessageChat,
  hash: string
) => {
  const entry = createLocalMessageEntry(content, hash);
  chatStore.initializeLocalMessageState(hash);
  chatStore.upsertLocalMessage(entry);
  await nextTick();
  scrollToBottomInChatLog();
};

const markUploadProgress = (hash: string, progress: number) => {
  chatStore.updateLocalMessageProgress(hash, progress);
};

const markUploadError = (hash: string, message?: string) => {
  chatStore.markLocalMessageError(hash, message);
};

const getComposerMessage = (): string | null => {
  if (!msg.value) return null;
  return msg.value.trim().length > 0 ? msg.value : null;
};
function formatRecordingLabel(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

const formattedRecordingTime = computed(() => {
  if (!isRecordingAudio.value && !audioRecordingElapsedMs.value) {
    return '00:00';
  }
  return formatRecordingLabel(audioRecordingElapsedMs.value) ?? '00:00';
});

const scrollToBottomInChatLog = async (smooth: boolean = false) => {
  if (!chatLogPS.value) return;

  const scrollEl = chatLogPS.value.$el || chatLogPS.value;
  if (!scrollEl) return;

  const psContainer =
    (scrollEl.querySelector('.ps') as HTMLElement) ||
    (scrollEl.closest('.ps') as HTMLElement) ||
    scrollEl;

  if (!psContainer) return;

  const foundElement =
    (psContainer.querySelector('.ps__rail-y')?.parentElement as HTMLElement) ||
    (psContainer.querySelector('.ps__container') as HTMLElement) ||
    psContainer;

  if (!foundElement) return;

  foundElement.scrollTop = foundElement.scrollHeight;

  await nextTick();

  requestAnimationFrame(() => {
    foundElement.scrollTop = foundElement.scrollHeight;
    chatLogPS.value?.update?.();
  });
};

const highlightedMessageTimers = new Map<string, number>();

const applyPersistentHighlight = (target: HTMLElement, id: string) => {
  target.classList.add('message-target-persistent');

  const chatContent = target.querySelector('.chat-content') as HTMLElement;
  if (chatContent) {
    chatContent.classList.add('message-target-persistent-content');
  }

  const existingTimer = highlightedMessageTimers.get(id);
  if (existingTimer) clearTimeout(existingTimer);

  const timeoutId = globalThis.setTimeout(() => {
    target.classList.remove('message-target-persistent');
    if (chatContent) {
      chatContent.classList.remove('message-target-persistent-content');
    }
    highlightedMessageTimers.delete(id);
  }, 30_000) as unknown as number;

  highlightedMessageTimers.set(id, timeoutId);
};

const isMessageLoaded = (id: string): boolean =>
  chatStore.listMessages.some((message) => message.message_id === id);

const isMessageLoadedByKeyId = (keyId: string): boolean =>
  chatStore.listMessages.some((message) => message.message_key?.id === keyId);

const findMessageIdByKeyId = (keyId: string): string | null => {
  const message = chatStore.listMessages.find(
    (m) => m.message_key?.id === keyId
  );
  return message?.message_id || null;
};

const checkMessageLoaded = (id: string, isUuid: boolean): boolean => {
  return isUuid ? isMessageLoaded(id) : isMessageLoadedByKeyId(id);
};

const ensureMessageLoaded = async (id: string): Promise<boolean> => {
  if (!id) return false;

  const isUuid = !!id.match(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );

  if (checkMessageLoaded(id, isUuid)) return true;

  while (chatStore.currentPage < chatStore.totalPages) {
    const loaded = await chatStore.loadMoreMessages();
    if (!loaded) break;
    await nextTick();

    if (checkMessageLoaded(id, isUuid)) return true;
  }

  return checkMessageLoaded(id, isUuid);
};

const scrollToMessageById = async (
  id?: string,
  options: { highlight?: boolean } = {}
) => {
  await nextTick();

  if (!chatLogPS.value) return;

  const scrollEl = chatLogPS.value.$el || chatLogPS.value;
  if (!scrollEl) return;

  const psContainer =
    (scrollEl.querySelector('.ps') as HTMLElement) ||
    (scrollEl.closest('.ps') as HTMLElement) ||
    scrollEl;

  if (!psContainer) return;

  const scrollContainer =
    (psContainer.querySelector('.ps__rail-y')?.parentElement as HTMLElement) ||
    (psContainer.querySelector('.ps__container') as HTMLElement) ||
    psContainer;

  if (!scrollContainer) return;

  if (!id) {
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    await nextTick();
    requestAnimationFrame(() => {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
      chatLogPS.value?.update?.();
    });
    return;
  }

  const isUuid = !!id.match(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );

  let targetMessageId = id;
  if (isUuid) {
    const messageReady = await ensureMessageLoaded(targetMessageId);
    if (!messageReady) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
      await nextTick();
      requestAnimationFrame(() => {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
        chatLogPS.value?.update?.();
      });
      return;
    }
  } else {
    await ensureMessageLoaded(id);

    const foundMessageId = findMessageIdByKeyId(id);
    if (foundMessageId) {
      targetMessageId = foundMessageId;
    }
  }

  await nextTick();

  let target =
    (scrollContainer.querySelector(
      `[data-message-id="${targetMessageId}"]`
    ) as HTMLElement) ||
    (document.getElementById(`msg-${targetMessageId}`) as HTMLElement);

  if (!target && !isUuid) {
    const message = chatStore.listMessages.find(
      (m) => m.message_key?.id === id
    );
    if (message) {
      target =
        (scrollContainer.querySelector(
          `[data-message-id="${message.message_id}"]`
        ) as HTMLElement) ||
        (document.getElementById(`msg-${message.message_id}`) as HTMLElement);
    }
  }

  if (target) {
    await nextTick();

    const top = getOffsetTop(scrollContainer, target) - 60;
    const maxScroll =
      scrollContainer.scrollHeight - scrollContainer.clientHeight;
    const validTop = Math.max(0, Math.min(top, maxScroll));

    scrollContainer.scrollTop = validTop;
    chatLogPS.value?.update?.();

    requestAnimationFrame(() => {
      scrollContainer.scrollTop = validTop;
      chatLogPS.value?.update?.();

      if (options.highlight) {
        target.classList.remove(
          'message-target-flash',
          'message-target-persistent'
        );
        const existingChatContent = target.querySelector(
          '.chat-content'
        ) as HTMLElement;
        if (existingChatContent) {
          existingChatContent.classList.remove(
            'message-target-persistent-content'
          );
        }

        applyPersistentHighlight(target, targetMessageId);
      }
    });

    return;
  }

  scrollContainer.scrollTop = scrollContainer.scrollHeight;
  await nextTick();
  requestAnimationFrame(() => {
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    chatLogPS.value?.update?.();
  });
};

const highlightAndScrollToMessage = async (id: string) => {
  if (!id) return;
  await scrollToMessageById(id, { highlight: true });
};

const startConversation = () => {
  if (vuetifyDisplays.mdAndUp.value) return;
  isLeftSidebarOpen.value = true;
};

const createImageFormData = (
  photo: ISelectedPhotoPreview,
  messageValue: string | null,
  quotedId: string | null,
  hash: string
): FormData => {
  const formData = new FormData();
  formData.append('type', EMessageType.image);
  if (messageValue) {
    formData.append('message', messageValue);
  }

  if (quotedId) {
    formData.append('message_quoted_id', quotedId);
  }

  formData.append('images', photo.file);
  formData.append('hash', hash);

  return formData;
};

const createDocumentFormData = (
  doc: ISelectedDocumentPreview,
  messageValue: string | null,
  quotedId: string | null,
  hash: string
): FormData => {
  const formData = new FormData();
  formData.append('type', EMessageType.document);
  if (messageValue) {
    formData.append('message', messageValue);
  }

  if (quotedId) {
    formData.append('message_quoted_id', quotedId);
  }

  formData.append('documents', doc.file);
  formData.append('hash', hash);

  return formData;
};

const createVideoFormData = (
  video: ISelectedVideoPreview,
  messageValue: string | null,
  quotedId: string | null,
  hash: string
): FormData => {
  const formData = new FormData();
  formData.append('type', EMessageType.video);
  if (messageValue) {
    formData.append('message', messageValue);
  }

  if (quotedId) {
    formData.append('message_quoted_id', quotedId);
  }

  formData.append('videos', video.file);
  if (typeof video.duration === 'number' && !Number.isNaN(video.duration)) {
    formData.append('video_duration', Math.round(video.duration).toString());
  }

  formData.append('hash', hash);

  return formData;
};

const createAudioFormData = (
  audio: {
    blob: Blob;
    fileName: string;
    mimeType: string;
  },
  viewOnce: boolean,
  duration: number | null,
  hash: string,
  ptt: boolean = false,
  replyMessageId?: string | null
): FormData => {
  const formData = new FormData();
  formData.append('type', EMessageType.audio);

  formData.append('audios', audio.blob, audio.fileName);
  if (typeof duration === 'number' && !Number.isNaN(duration)) {
    formData.append('audio_duration', Math.round(duration).toString());
  }
  if (viewOnce) {
    formData.append('audio_view_once', 'true');
  }
  formData.append('audio_ptt', ptt ? 'true' : 'false');

  if (replyMessageId) {
    formData.append('message_quoted_id', replyMessageId);
  }

  formData.append('hash', hash);

  return formData;
};

const createTextMessageBody = (
  hash: string,
  messageText?: string,
  linkPreviewData?: ViewLinkPreviewResponse | null,
  replyMessage?: ListMessageResult | null,
  quickMessageTemplateId?: string | null
): CreateMessageChatsBody => {
  const messageValue = messageText ?? msg.value;
  const preview = linkPreviewData ?? linkPreview.value;
  const replyId =
    replyMessage?.message_id ?? chatStore.messageReply?.message_id;

  const inputCreateMessage: CreateMessageChatsBody = {
    type: EMessageType.text,
    message: messageValue,
    link_preview: preview?.title
      ? (preview as ViewLinkPreviewResponse)
      : undefined,
    hash,
  };

  if (replyId) {
    inputCreateMessage.message_quoted_id = replyId;
  }

  if (quickMessageTemplateId) {
    inputCreateMessage.quick_message_template_id = quickMessageTemplateId;
  }

  return inputCreateMessage;
};

const revokeVideoPreview = (preview: string) => {
  if (preview && preview.startsWith('blob:')) {
    URL.revokeObjectURL(preview);
  }
};

const removeVideo = (index: number) => {
  const video = selectedVideos.value[index];
  if (video) {
    revokeVideoPreview(video.preview);
  }
  selectedVideos.value.splice(index, 1);
};

const clearSelectedVideos = () => {
  selectedVideos.value = [];
};

const clearSelectedAudios = () => {
  for (const audio of selectedAudios.value) {
    if (audio.preview && audio.preview.startsWith('blob:')) {
      URL.revokeObjectURL(audio.preview);
    }
  }
  selectedAudios.value = [];
};

const clearSelectedContacts = () => {
  selectedContacts.value = [];
};

const canSendMessage = (): boolean => {
  return !!(
    msg.value ||
    selectedPhotos.value.length > 0 ||
    selectedDocuments.value.length > 0 ||
    selectedVideos.value.length > 0 ||
    selectedAudios.value.length > 0 ||
    selectedContacts.value.length > 0 ||
    selectedLocation.value !== null
  );
};

const hasActiveChat = (): boolean => {
  return !!chatStore.activeChat?.worker?.id;
};

const sendImageMessage = async (
  photosToSend?: ISelectedPhotoPreview[],
  messageText?: string | null,
  replyMessage?: ListMessageResult | null
): Promise<void> => {
  if (!chatStore.activeChat?.chat_id) return;
  const photos = photosToSend ?? [...selectedPhotos.value];
  if (photos.length === 0) return;

  const replyId =
    replyMessage?.message_id ?? chatStore.messageReply?.message_id ?? null;
  const quotedPayload = getQuotedContent(replyMessage || null);
  const messageValue = messageText ?? getComposerMessage();

  const messagesWithHashes = await Promise.all(
    photos.map(async (photo) => {
      const hash = createMessageHash();
      const extension = (photo.file.name.split('.').pop() || '').toLowerCase();
      const formattedMessage =
        formatLocalMessageWithAttendeeName(messageValue) ?? messageValue;
      const content: ContentMessageChat = {
        type: EMessageType.image,
        message: formattedMessage,
        message_quoted_id: replyId ?? undefined,
        quoted: quotedPayload,
        image: {
          url: photo.preview,
          caption: formattedMessage,
          mimetype: photo.file.type,
          size: photo.file.size,
          extension: extension || null,
        },
      };

      await registerLocalMessage(content, hash);
      return { photo, hash };
    })
  );

  await Promise.all(
    messagesWithHashes.map(async ({ photo, hash }) => {
      const formData = createImageFormData(photo, messageValue, replyId, hash);

      const success = await chatStore.createMessageWithImages(formData, {
        skipLoading: true,
        onUploadProgress: (progress) => {
          markUploadProgress(hash, progress);
        },
      });

      if (!success) {
        markUploadError(hash);
      }
    })
  );
};

const sendVideoMessage = async (
  videosToSend?: ISelectedVideoPreview[],
  messageText?: string | null,
  replyMessage?: ListMessageResult | null
): Promise<void> => {
  if (!chatStore.activeChat?.chat_id) return;
  const videos = videosToSend ?? [...selectedVideos.value];
  if (videos.length === 0) return;

  const replyId =
    replyMessage?.message_id ?? chatStore.messageReply?.message_id ?? null;
  const quotedPayload = getQuotedContent(replyMessage || null);
  const messageValue = messageText ?? getComposerMessage();

  const messagesWithHashes = await Promise.all(
    videos.map(async (video) => {
      const hash = createMessageHash();
      const extension = (video.name.split('.').pop() || '').toLowerCase();
      const formattedMessage =
        formatLocalMessageWithAttendeeName(messageValue) ?? messageValue;
      const content: ContentMessageChat = {
        type: EMessageType.video,
        message: formattedMessage,
        message_quoted_id: replyId ?? undefined,
        quoted: quotedPayload,
        video: {
          url: video.preview,
          caption: formattedMessage,
          mimetype: video.type,
          size: video.size,
          duration: video.duration ?? null,
          name: video.name,
          extension: extension || null,
        },
      };

      await registerLocalMessage(content, hash);
      return { video, hash };
    })
  );

  await Promise.all(
    messagesWithHashes.map(async ({ video, hash }) => {
      const formData = createVideoFormData(video, messageValue, replyId, hash);

      const success = await chatStore.createMessageWithVideos(formData, {
        skipLoading: true,
        onUploadProgress: (progress) => {
          markUploadProgress(hash, progress);
        },
      });

      if (!success) {
        markUploadError(hash);
      }
    })
  );
};

const sendAudioMessage = async (
  blob: Blob,
  mimeType: string,
  duration: number | null,
  viewOnce: boolean,
  _messageText?: string | null,
  replyMessage?: ListMessageResult | null
): Promise<void> => {
  if (!chatStore.activeChat?.chat_id) return;

  if (blob.size > MAX_AUDIO_SIZE_BYTES) {
    chatStore.showSnackbar(t('audio_size_exceeded'), EColor.error);
    return;
  }

  const hash = createMessageHash();
  const replyId =
    replyMessage?.message_id ?? chatStore.messageReply?.message_id ?? null;
  const quotedPayload = getQuotedContent(replyMessage || null);

  let extensionFromMime =
    mimeType.split('/')[1]?.split(';')[0]?.trim() || 'ogg';

  const mimeToExtension: Record<string, string> = {
    mpeg: 'mp3',
    mp3: 'mp3',
    aac: 'aac',
    m4a: 'm4a',
    'x-m4a': 'm4a',
    amr: 'amr',
    'amr-wb': 'amr',
    ogg: 'ogg',
    opus: 'opus',
  };

  extensionFromMime = mimeToExtension[extensionFromMime] || extensionFromMime;
  const fileName = `audio-${Date.now()}.${extensionFromMime}`;
  const localUrl = URL.createObjectURL(blob);

  const content: ContentMessageChat = {
    type: EMessageType.audio,
    message: null,
    message_quoted_id: replyId ?? undefined,
    quoted: quotedPayload,
    audio: {
      url: localUrl,
      name: fileName,
      mimetype: mimeType,
      size: blob.size,
      duration: duration ?? null,
      extension: extensionFromMime,
      view_once: viewOnce ? true : undefined,
    },
  };

  await registerLocalMessage(content, hash);

  const formData = createAudioFormData(
    { blob, fileName, mimeType },
    viewOnce,
    duration,
    hash,
    true,
    replyId
  );

  const success = await chatStore.createMessageWithAudios(formData, {
    skipLoading: true,
    onUploadProgress: (progress) => {
      markUploadProgress(hash, progress);
    },
  });

  if (!success) {
    markUploadError(hash);
    return;
  }
  chatStore.clearMessageReply();
};

const sendAudioFilesMessage = async (
  audiosToSend?: ISelectedAudioPreview[],
  _messageText?: string | null,
  _replyMessage?: ListMessageResult | null
): Promise<void> => {
  if (!chatStore.activeChat?.chat_id) return;
  const audios = audiosToSend ?? [...selectedAudios.value];
  if (audios.length === 0) return;

  const messagesWithHashes = await Promise.all(
    audios.map(async (audio) => {
      const hash = createMessageHash();
      const extension = (audio.name.split('.').pop() || '').toLowerCase();
      const content: ContentMessageChat = {
        type: EMessageType.audio,
        message: null,
        audio: {
          url: audio.preview,
          mimetype: audio.type,
          size: audio.size,
          duration: audio.duration ?? null,
          name: audio.name,
          extension: extension || null,
        },
      };

      await registerLocalMessage(content, hash);
      return { audio, hash };
    })
  );

  await Promise.all(
    messagesWithHashes.map(async ({ audio, hash }) => {
      const formData = createAudioFormData(
        {
          blob: audio.file,
          fileName: audio.name,
          mimeType: audio.type,
        },
        false,
        audio.duration,
        hash,
        false
      );

      const success = await chatStore.createMessageWithAudios(formData, {
        skipLoading: true,
        onUploadProgress: (progress) => {
          markUploadProgress(hash, progress);
        },
      });

      if (!success) {
        markUploadError(hash);
      }
    })
  );
};

const sendDocumentMessage = async (
  documentsToSend?: ISelectedDocumentPreview[],
  messageText?: string | null,
  replyMessage?: ListMessageResult | null
): Promise<void> => {
  if (!chatStore.activeChat?.chat_id) return;
  const docs = documentsToSend ?? [...selectedDocuments.value];
  if (docs.length === 0) return;

  const replyId =
    replyMessage?.message_id ?? chatStore.messageReply?.message_id ?? null;
  const quotedPayload = getQuotedContent(replyMessage || null);
  const messageValue = messageText ?? getComposerMessage();

  const messagesWithHashes = await Promise.all(
    docs.map(async (doc) => {
      const hash = createMessageHash();
      const localUrl = URL.createObjectURL(doc.file);
      const content: ContentMessageChat = {
        type: EMessageType.document,
        message:
          formatLocalMessageWithAttendeeName(messageValue) ?? messageValue,
        message_quoted_id: replyId ?? undefined,
        quoted: quotedPayload,
        document: {
          url: localUrl,
          name: doc.name,
          mimetype: doc.type,
          extension: doc.extension,
          size: doc.size,
        },
      };

      await registerLocalMessage(content, hash);
      return { doc, hash };
    })
  );

  await Promise.all(
    messagesWithHashes.map(async ({ doc, hash }) => {
      const formData = createDocumentFormData(doc, messageValue, replyId, hash);

      const success = await chatStore.createMessageWithDocuments(formData, {
        skipLoading: true,
        onUploadProgress: (progress) => {
          markUploadProgress(hash, progress);
        },
      });

      if (!success) {
        markUploadError(hash);
      }
    })
  );
};

const sendContactsMessage = async (
  contactsToSend?: ISelectedContactPreview[],
  messageText?: string | null,
  replyMessage?: ListMessageResult | null
): Promise<void> => {
  if (!chatStore.activeChat?.chat_id) return;
  const contacts = contactsToSend ?? [...selectedContacts.value];
  if (contacts.length === 0) return;

  const replyId =
    replyMessage?.message_id ?? chatStore.messageReply?.message_id ?? null;
  const quotedPayload = getQuotedContent(replyMessage || null);
  const messageValue = messageText ?? getComposerMessage();

  const messagesWithHashes = await Promise.all(
    contacts.map(async (contact) => {
      const hash = createMessageHash();
      const content: ContentMessageChat = {
        type: EMessageType.contact_card,
        message:
          formatLocalMessageWithAttendeeName(messageValue) ?? messageValue,
        message_quoted_id: replyId ?? undefined,
        quoted: quotedPayload,
        contact: {
          contact_id: contact.contact_id,
          name: contact.name,
          last_name: contact.last_name ?? null,
          phone: contact.phone_partial ?? null,
          email_partial: contact.email_partial ?? null,
        },
      };

      await registerLocalMessage(content, hash);
      return { contact, hash };
    })
  );

  await Promise.all(
    messagesWithHashes.map(async ({ contact, hash }) => {
      const formData = new FormData();
      formData.append('type', EMessageType.contact_card);
      if (messageValue) {
        formData.append('message', messageValue);
      }
      if (replyId) {
        formData.append('message_quoted_id', replyId);
      }
      formData.append('contacts', contact.contact_id);
      formData.append('hash', hash);

      const success = await chatStore.createMessageWithContacts(formData, {
        skipLoading: true,
      });

      if (!success) {
        markUploadError(hash);
      }
    })
  );

  if (contactsToSend === undefined) {
    chatStore.clearMessageReply();
    clearSelectedContacts();
  }
};

const sendLocationMessage = async (
  locationToSend?: typeof selectedLocation.value,
  messageText?: string | null,
  replyMessage?: ListMessageResult | null
): Promise<void> => {
  if (!chatStore.activeChat?.chat_id) return;
  const location = locationToSend ?? selectedLocation.value;
  if (!location) return;

  const hash = createMessageHash();
  const replyId =
    replyMessage?.message_id ?? chatStore.messageReply?.message_id ?? null;
  const quotedPayload = getQuotedContent(replyMessage || null);
  const messageValue = messageText ?? getComposerMessage();

  const content: ContentMessageChat = {
    type: EMessageType.location,
    message: formatLocalMessageWithAttendeeName(messageValue) ?? messageValue,
    message_quoted_id: replyId ?? undefined,
    quoted: quotedPayload,
    location: {
      latitude: location.latitude,
      longitude: location.longitude,
      name: location.name ?? null,
      address: location.address ?? null,
    },
  };

  await registerLocalMessage(content, hash);

  const formData = new FormData();
  formData.append('type', EMessageType.location);
  if (messageValue) {
    formData.append('message', messageValue);
  }
  if (replyId) {
    formData.append('message_quoted_id', replyId);
  }
  formData.append('location_latitude', location.latitude.toString());
  formData.append('location_longitude', location.longitude.toString());
  if (location.name) {
    formData.append('location_name', location.name);
  }
  if (location.address) {
    formData.append('location_address', location.address);
  }
  formData.append('hash', hash);

  const success = await chatStore.createMessageWithLocation(formData, {
    skipLoading: true,
  });

  if (!success) {
    markUploadError(hash);
  }

  if (locationToSend === undefined) {
    chatStore.clearMessageReply();
    selectedLocation.value = null;
  }
};

const onContactsSelected = (contacts: ISelectedContactPreview[]) => {
  const existingIds = new Set(selectedContacts.value.map((c) => c.contact_id));
  const newContacts = contacts.filter((c) => !existingIds.has(c.contact_id));
  selectedContacts.value = [...selectedContacts.value, ...newContacts];
};

const sendTextMessage = async (
  messageText?: string,
  linkPreviewData?: ViewLinkPreviewResponse | null,
  replyMessage?: ListMessageResult | null,
  quickMessageTemplateId?: string | null
): Promise<void> => {
  if (!chatStore.activeChat?.chat_id) return;
  const hash = createMessageHash();
  const messageValue = messageText ?? msg.value;
  const replyId =
    replyMessage?.message_id ?? chatStore.messageReply?.message_id ?? null;

  const quotedPayload = getQuotedContent(replyMessage || null);
  const preview = linkPreviewData ?? cloneLinkPreview();

  const content: ContentMessageChat = {
    type: EMessageType.text,
    message: formatLocalMessageWithAttendeeName(messageValue) ?? messageValue,
    message_quoted_id: replyId ?? undefined,
    quoted: quotedPayload,
    link_preview: preview,
  };

  await registerLocalMessage(content, hash);

  const messageBody = createTextMessageBody(
    hash,
    messageValue,
    preview,
    replyMessage || null,
    quickMessageTemplateId
  );
  const success = await chatStore.createMessage(messageBody);

  if (!success) {
    markUploadError(hash);
  }
};

const sendAnnotationMessage = async (): Promise<void> => {
  if (!chatStore.activeChat?.chat_id) return;
  if (!annotationText.value.trim()) return;

  const hash = createMessageHash();
  const messageValue = annotationText.value.trim();

  const content: ContentMessageChat = {
    type: EMessageType.annotation,
    message: messageValue,
  };

  await registerLocalMessage(content, hash);

  const messageBody: CreateMessageChatsBody = {
    type: EMessageType.annotation,
    message: messageValue,
    hash,
  };

  isAnnotationModalOpen.value = false;
  annotationText.value = '';

  chatStore.createMessage(messageBody).then((success) => {
    if (!success) {
      markUploadError(hash);
    }
  });
};

const onAnnotationEmojiSelect = (emoji: any) => {
  const emojiText = emoji.native || emoji.colons;
  const textarea = annotationText.value;
  const textareaElement = document.querySelector(
    '#annotation-textarea'
  ) as HTMLTextAreaElement;
  if (textareaElement) {
    const cursorPos = textareaElement.selectionStart || textarea.length;
    annotationText.value =
      textarea.slice(0, cursorPos) + emojiText + textarea.slice(cursorPos);
    nextTick(() => {
      textareaElement.setSelectionRange(
        cursorPos + emojiText.length,
        cursorPos + emojiText.length
      );
      textareaElement.focus();
    });
  } else {
    annotationText.value = textarea + emojiText;
  }

  isAnnotationEmojiOpen.value = false;
};

const onTransferAnnotationEmojiSelect = (emoji: any) => {
  const emojiText = emoji.native || emoji.colons;
  const textarea = transferAnnotationText.value;
  const textareaElement = document.querySelector(
    '#transfer-annotation-textarea'
  ) as HTMLTextAreaElement;
  if (textareaElement) {
    const cursorPos = textareaElement.selectionStart || textarea.length;
    transferAnnotationText.value =
      textarea.slice(0, cursorPos) + emojiText + textarea.slice(cursorPos);
    nextTick(() => {
      textareaElement.setSelectionRange(
        cursorPos + emojiText.length,
        cursorPos + emojiText.length
      );
      textareaElement.focus();
    });
  } else {
    transferAnnotationText.value = textarea + emojiText;
  }

  isTransferAnnotationEmojiOpen.value = false;
};

const finalizeSend = async () => {
  nextTick(() => {
    const scrollEl = chatLogPS.value?.$el || chatLogPS.value;
    if (scrollEl) {
      const scrollTop = scrollEl.scrollTop;
      const scrollHeight = scrollEl.scrollHeight;
      const clientHeight = scrollEl.clientHeight;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      const isNearBottom = distanceFromBottom < 200;

      scrollToBottomInChatLog(!isNearBottom);
    } else {
      scrollToBottomInChatLog(true);
    }

    setTimeout(() => {
      const scrollEl = chatLogPS.value?.$el || chatLogPS.value;
      if (scrollEl) {
        scrollEl.scrollTop = scrollEl.scrollHeight;
        chatLogPS.value?.update?.();
      }
    }, 300);
  });
};

const sendMessage = async () => {
  if (!canSendMessage()) return;
  if (!hasActiveChat()) return;
  if (!canComposeInActiveChat.value) {
    chatStore.showSnackbar(
      t('must_join_conversation_to_reply'),
      EColor.warning
    );
    return;
  }

  const savedMsg = msg.value;
  const savedLinkPreview = linkPreview.value ? { ...linkPreview.value } : null;
  const savedPhotos = [...selectedPhotos.value];
  const savedDocuments = [...selectedDocuments.value];
  const savedVideos = [...selectedVideos.value];
  const savedAudios = [...selectedAudios.value];
  const savedContacts = [...selectedContacts.value];
  const savedLocation = selectedLocation.value;
  const savedReply = chatStore.messageReply;

  chatStore.clearMessageReply();

  msg.value = '';
  linkPreview.value = null;
  clearSelectedVideos();
  clearSelectedAudios();
  clearSelectedContacts();
  selectedPhotos.value = [];
  selectedDocuments.value = [];
  selectedLocation.value = null;

  if (savedDocuments.length > 0) {
    await sendDocumentMessage(
      savedDocuments,
      savedMsg,
      savedReply || undefined
    );
    finalizeSend();
    return;
  }

  if (savedVideos.length > 0) {
    await sendVideoMessage(savedVideos, savedMsg, savedReply || undefined);
    finalizeSend();
    return;
  }

  if (savedAudios.length > 0) {
    await sendAudioFilesMessage(savedAudios, savedMsg, savedReply || undefined);
    finalizeSend();
    return;
  }

  if (savedContacts.length > 0) {
    await sendContactsMessage(savedContacts, savedMsg, savedReply || undefined);
    finalizeSend();
    return;
  }

  if (savedLocation) {
    await sendLocationMessage(savedLocation, savedMsg, savedReply || undefined);
    finalizeSend();
    return;
  }

  if (savedPhotos.length > 0) {
    await sendImageMessage(savedPhotos, savedMsg, savedReply || undefined);
    finalizeSend();
    return;
  }

  await sendTextMessage(savedMsg, savedLinkPreview, savedReply || undefined);

  finalizeSend();
};

type OpenChatOptions = {
  skipClearSummary?: boolean;
  forceReload?: boolean;
};

const resolveRouteChatId = (): string | null => {
  const value = route.query.chat_id;

  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  return null;
};

const openChat = async (
  chatId: ListChatsResult['chat_id'],
  options?: OpenChatOptions
) => {
  const isSameChat = chatStore.activeChat?.chat_id === chatId;
  if (isSameChat && !options?.forceReload) return;

  linkPreview.value = null;
  isLoadingLinkPreview.value = false;

  if (chatLogPS.value) {
    const scrollEl = chatLogPS.value.$el || chatLogPS.value;
    if (scrollEl) {
      scrollEl.scrollTop = 0;
    }
  }

  if (!isSameChat || !chatStore.activeChat) {
    chatStore.setActiveChat(chatId);
  }

  if (chatStore.activeChat?.chat_id !== chatId) {
    return;
  }

  const requestQueue: ListMessageChatsQuery = {
    current_page: currentPage.value,
    per_page: perPage.value,
  };

  await chatStore.getChatById(requestQueue, chatId);

  if (
    chatStore.activeChat?.status === EChatStatus.in_chat &&
    isChatParticipant(
      chatStore.activeChat as unknown as IChat,
      chatStore.user?.user_id
    ) &&
    !options?.skipClearSummary
  ) {
    await chatStore.clearChatSummary(chatId);
  }

  if (vuetifyDisplays.smAndDown.value) {
    isLeftSidebarOpen.value = false;
  }

  await nextTick();

  requestAnimationFrame(() => {
    scrollToBottomInChatLog();
  });
};

const chatContentContainerBg = computed(() => {
  let color = 'transparent';

  if (themes) {
    color = themes?.[name.value].colors?.background as string;
  }

  return color;
});

const previewDomain = computed(() => {
  const u =
    linkPreview.value?.['canonical-url'] ||
    linkPreview.value?.['matched-text'] ||
    '';
  if (!u) return '';
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
});

const previewHref = computed(() => {
  return (
    linkPreview.value?.['canonical-url'] ||
    linkPreview.value?.['matched-text'] ||
    ''
  );
});

const previewImage = computed(() => {
  const p = linkPreview.value;
  if (!p) {
    return null;
  }
  const cand =
    p.highQualityThumbnail || p.originalThumbnailUrl || p.jpegThumbnail || '';
  if (!cand) return null;
  if (cand.startsWith('http')) return cand;
  return `data:image/jpeg;base64,${cand}`;
});

const openAttach = (
  type:
    | 'document'
    | 'photo'
    | 'video'
    | 'audio'
    | 'contact'
    | 'location'
    | 'annotation'
) => {
  if (!canComposeInActiveChat.value) return;

  switch (type) {
    case 'document':
      fileDocRef.value?.click();
      break;
    case 'photo':
      filePhotoRef.value?.click();
      break;
    case 'video':
      fileVideoRef.value?.click();
      break;
    case 'audio':
      fileAudioRef.value?.click();
      break;
    case 'contact':
      isContactPickerOpen.value = true;
      break;
    case 'location':
      isLocationPickerOpen.value = true;
      break;
    case 'annotation':
      isAnnotationModalOpen.value = true;
      break;
  }
};

const onPickDoc = (e: Event) => {
  const target = e.target as HTMLInputElement;
  const files = target.files;

  if (!files || files.length === 0) {
    target.value = '';
    return;
  }

  if (selectedVideos.value.length > 0) {
    chatStore.showSnackbar(t('clear_videos_before_documents'), EColor.warning);
    target.value = '';
    return;
  }

  if (selectedPhotos.value.length > 0) {
    chatStore.showSnackbar(t('clear_images_before_documents'), EColor.warning);
    target.value = '';
    return;
  }

  const limit = 10;
  const currentCount = selectedDocuments.value.length;
  if (currentCount >= limit) {
    chatStore.showSnackbar(t('max_documents_selected'), EColor.warning);
    target.value = '';
    return;
  }

  const spaceLeft = limit - currentCount;
  const filesArray = Array.from(files);
  const filesToAdd = filesArray.slice(0, spaceLeft);
  if (filesArray.length > spaceLeft) {
    chatStore.showSnackbar(
      t('can_select_more_documents', { count: spaceLeft }),
      EColor.warning
    );
  }

  const oversizedDocs = filesToAdd.filter(
    (file) => file.size > MAX_DOCUMENT_SIZE_BYTES
  );
  const validDocs = filesToAdd.filter(
    (file) => file.size <= MAX_DOCUMENT_SIZE_BYTES
  );

  if (oversizedDocs.length > 0) {
    chatStore.showSnackbar(t('document_size_exceeded'), EColor.error);
  }

  for (const file of validDocs) {
    selectedDocuments.value.push({
      file,
      name: file.name,
      size: file.size,
      extension: (file.name.split('.').pop() || '').toLowerCase(),
      type: file.type,
    });
  }

  target.value = '';
};
const onPickPhoto = (e: Event) => {
  const target = e.target as HTMLInputElement;
  const files = target.files;

  if (!files || files.length === 0) {
    target.value = '';
    return;
  }

  if (selectedVideos.value.length > 0) {
    chatStore.showSnackbar(t('clear_videos_before_images'), EColor.warning);
    target.value = '';
    return;
  }

  if (selectedDocuments.value.length > 0) {
    chatStore.showSnackbar(t('clear_documents_before_images'), EColor.warning);
    target.value = '';
    return;
  }

  const allowedImageTypes = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
  ]);
  const allowedExtensions = new Set(['jpg', 'jpeg', 'png', 'gif']);

  const imageFiles = Array.from(files).filter((file) => {
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    return (
      allowedImageTypes.has(file.type) ||
      (fileExtension && allowedExtensions.has(fileExtension))
    );
  });

  if (imageFiles.length === 0) {
    chatStore.showSnackbar(t('invalid_image_format'), EColor.error);
    target.value = '';
    return;
  }

  const invalidImages = Array.from(files).filter((file) => {
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    return (
      !allowedImageTypes.has(file.type) &&
      (!fileExtension || !allowedExtensions.has(fileExtension))
    );
  });

  if (invalidImages.length > 0) {
    chatStore.showSnackbar(t('invalid_image_format'), EColor.error);
  }

  const oversizedImages = imageFiles.filter(
    (file) => file.size > MAX_IMAGE_SIZE_BYTES
  );
  const validImages = imageFiles.filter(
    (file) => file.size <= MAX_IMAGE_SIZE_BYTES
  );

  if (oversizedImages.length > 0) {
    chatStore.showSnackbar(t('image_size_exceeded'), EColor.error);
  }

  if (validImages.length === 0) {
    target.value = '';
    return;
  }

  const currentCount = selectedPhotos.value.length;
  const totalAfterSelection = currentCount + validImages.length;

  if (totalAfterSelection > 10) {
    chatStore.showSnackbar(t('max_images_selected'), EColor.warning);
    target.value = '';
    return;
  }

  const remainingSlots = 10 - currentCount;

  if (validImages.length > remainingSlots) {
    chatStore.showSnackbar(
      t('can_select_more_images', { count: remainingSlots }),
      EColor.warning
    );
    target.value = '';
    return;
  }

  for (const file of validImages) {
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        selectedPhotos.value.push({
          file,
          preview: event.target.result as string,
        });
      }
    };
    reader.readAsDataURL(file);
  }

  target.value = '';
};
const getVideoDuration = (src: string): Promise<number | null> =>
  new Promise((resolve) => {
    const videoEl = document.createElement('video');
    const clean = () => {
      videoEl.removeAttribute('src');
      videoEl.load();
      videoEl.remove();
    };

    videoEl.preload = 'metadata';
    videoEl.muted = true;
    videoEl.onloadedmetadata = () => {
      const dur = Number.isFinite(videoEl.duration) ? videoEl.duration : null;
      clean();
      resolve(dur);
    };
    videoEl.onerror = () => {
      clean();
      resolve(null);
    };
    videoEl.src = src;
  });

const getAudioDuration = (src: string): Promise<number | null> =>
  new Promise((resolve) => {
    const audioEl = document.createElement('audio');
    const clean = () => {
      audioEl.removeAttribute('src');
      audioEl.load();
      audioEl.remove();
    };

    audioEl.preload = 'metadata';
    audioEl.onloadedmetadata = () => {
      const dur = Number.isFinite(audioEl.duration) ? audioEl.duration : null;
      clean();
      resolve(dur);
    };
    audioEl.onerror = () => {
      clean();
      resolve(null);
    };
    audioEl.src = src;
  });

const updateRecordingElapsed = () => {
  if (audioRecordingStartAt.value === null) {
    audioRecordingElapsedMs.value = audioRecordingAccumulated.value;
    return;
  }
  audioRecordingElapsedMs.value =
    audioRecordingAccumulated.value +
    (performance.now() - audioRecordingStartAt.value);
};

const setupAudioCanvas = () => {
  const canvas = audioCanvasRef.value;
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.offsetWidth * dpr;
  const height = canvas.offsetHeight * dpr;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
};

const drawAudioWaveform = () => {
  if (!isRecordingAudio.value || !audioAnalyserRef.value) {
    return;
  }
  const analyser = audioAnalyserRef.value;
  const canvas = audioCanvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const bufferLength = analyser.fftSize;
  if (
    !audioDataArrayRef.value ||
    audioDataArrayRef.value.length !== bufferLength
  ) {
    audioDataArrayRef.value = new Uint8Array(bufferLength);
  }

  const byteArray = audioDataArrayRef.value!;
  analyser.getByteTimeDomainData(
    byteArray as unknown as Uint8Array<ArrayBuffer>
  );
  setupAudioCanvas();

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(34, 197, 94, 0.95)';
  ctx.fillStyle = 'rgba(34, 197, 94, 0.15)';
  ctx.beginPath();

  const data = byteArray;
  const sliceWidth = width / bufferLength;
  let x = 0;
  const centerY = height / 2;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.strokeStyle = 'rgba(34, 197, 94, 0.35)';
  ctx.stroke();

  ctx.beginPath();
  ctx.strokeStyle = 'rgba(34, 197, 94, 0.9)';

  for (let i = 0; i < bufferLength; i += 4) {
    const v = data[i] / 128;
    const y = (v * height) / 2;
    if (i === 0) {
      ctx.moveTo(x, y);
    }
    if (i !== 0) {
      ctx.lineTo(x, y);
    }
    x += sliceWidth * 4;
  }

  ctx.stroke();
  ctx.restore();

  audioRecordingRAFId.value = requestAnimationFrame(drawAudioWaveform);
};

const releaseAudioResources = () => {
  if (audioRecordingTimerId.value) {
    clearInterval(audioRecordingTimerId.value);
    audioRecordingTimerId.value = null;
  }
  if (audioRecordingRAFId.value) {
    cancelAnimationFrame(audioRecordingRAFId.value);
    audioRecordingRAFId.value = null;
  }
  if (audioStreamRef.value) {
    for (const track of audioStreamRef.value.getTracks()) {
      track.stop();
    }
    audioStreamRef.value = null;
  }
  if (audioContextRef.value) {
    audioContextRef.value.close().catch(() => null);
    audioContextRef.value = null;
  }
  audioAnalyserRef.value = null;
  audioDataArrayRef.value = null;
  mediaRecorderRef.value = null;
};

const resetRecordingState = () => {
  isRecordingAudio.value = false;
  isRecordingPaused.value = false;
  audioViewOnce.value = false;
  audioPendingViewOnce.value = false;
  audioRecordingStartAt.value = null;
  audioRecordingAccumulated.value = 0;
  audioRecordingElapsedMs.value = 0;
  audioRecordingDurationSeconds.value = null;
  audioChunksRef.value = [];
};

const handleRecorderStop = async (
  savedMessageText?: string | null,
  savedReply?: ListMessageResult | null,
  sessionId?: number,
  capturedChunks?: Blob[],
  capturedRecorder?: MediaRecorder | null,
  capturedShouldPersist?: boolean,
  capturedViewOnce?: boolean,
  capturedElapsedMs?: number
) => {
  const isCurrentSession = () =>
    sessionId === undefined || sessionId === recordingSessionId;

  const recorder = capturedRecorder ?? mediaRecorderRef.value;
  const chunks = capturedChunks ?? audioChunksRef.value;
  const saveRecording = capturedShouldPersist ?? shouldPersistRecording.value;
  const viewOnce = capturedViewOnce ?? audioPendingViewOnce.value;
  const elapsedMs = capturedElapsedMs ?? audioRecordingElapsedMs.value;

  if (isCurrentSession()) {
    shouldPersistRecording.value = false;
  }

  if (!saveRecording && recordedAudioUrl.value && isCurrentSession()) {
    URL.revokeObjectURL(recordedAudioUrl.value);
    recordedAudioUrl.value = null;
  }

  if (saveRecording && recorder && chunks.length > 0) {
    let mimeType = recorder.mimeType || 'audio/ogg;codecs=opus';

    const allowedMimeTypes = [
      'audio/mpeg',
      'audio/mp3',
      'audio/aac',
      'audio/m4a',
      'audio/x-m4a',
      'audio/amr',
      'audio/amr-wb',
      'audio/ogg',
      'audio/opus',
    ];

    const baseMimeType = mimeType.split(';')[0].trim();
    const isAllowed = allowedMimeTypes.some((allowed) => {
      return mimeType === allowed || baseMimeType === allowed;
    });

    if (!isAllowed) {
      mimeType = 'audio/ogg;codecs=opus';
    }

    const blob = new Blob(chunks, { type: mimeType });
    const durationSeconds = Math.round(elapsedMs / 1000);

    if (isCurrentSession()) {
      recordedAudioBlob.value = blob;
      if (recordedAudioUrl.value) URL.revokeObjectURL(recordedAudioUrl.value);
      recordedAudioUrl.value = URL.createObjectURL(blob);
      audioRecordingDurationSeconds.value = durationSeconds;
    }

    const audioWithinLimit = blob.size <= MAX_AUDIO_SIZE_BYTES;
    if (!audioWithinLimit) {
      chatStore.showSnackbar(t('audio_size_exceeded'), EColor.error);
      if (isCurrentSession() && recordedAudioUrl.value) {
        URL.revokeObjectURL(recordedAudioUrl.value);
        recordedAudioUrl.value = null;
      }
    }
    if (audioWithinLimit) {
      await sendAudioMessage(
        blob,
        mimeType,
        durationSeconds,
        viewOnce,
        savedMessageText,
        savedReply || undefined
      );
      if (isCurrentSession()) {
        recordedAudioUrl.value = null;
      }
    }
    if (isCurrentSession()) {
      recordedAudioBlob.value = null;
    }
  }

  if (isCurrentSession()) {
    releaseAudioResources();

    audioViewOnce.value = false;
    audioPendingViewOnce.value = false;
    audioRecordingStartAt.value = null;
    audioRecordingAccumulated.value = 0;
    audioRecordingElapsedMs.value = 0;
    audioRecordingDurationSeconds.value = null;
    audioChunksRef.value = [];
  }
};

let savedMessageTextForRecording: string | null | undefined = undefined;
let savedReplyForRecording: ListMessageResult | null | undefined = undefined;
let recordingSessionId = 0;

const stopAudioRecordingInternal = (
  savedMessageText?: string | null,
  savedReply?: ListMessageResult | null
) => {
  savedMessageTextForRecording = savedMessageText;
  savedReplyForRecording = savedReply;

  if (audioRecordingStartAt.value !== null) {
    audioRecordingAccumulated.value +=
      performance.now() - audioRecordingStartAt.value;
    audioRecordingStartAt.value = null;
  }
  updateRecordingElapsed();

  const sessionAtStop = recordingSessionId;
  const capturedChunks = [...audioChunksRef.value];
  const capturedRecorder = mediaRecorderRef.value;
  const capturedShouldPersist = shouldPersistRecording.value;
  const capturedViewOnce = audioPendingViewOnce.value;
  const capturedElapsedMs = audioRecordingElapsedMs.value;

  if (capturedRecorder) {
    capturedRecorder.ondataavailable = (event) => {
      if (event.data?.size > 0) {
        capturedChunks.push(event.data);
      }
    };
    capturedRecorder.onstop = (_ev: Event) => {
      handleRecorderStop(
        savedMessageTextForRecording,
        savedReplyForRecording,
        sessionAtStop,
        capturedChunks,
        capturedRecorder,
        capturedShouldPersist,
        capturedViewOnce,
        capturedElapsedMs
      ).catch(() => {});
    };
    if (capturedRecorder.state !== 'inactive') {
      capturedRecorder.stop();
      return;
    }
  }

  handleRecorderStop(
    savedMessageTextForRecording,
    savedReplyForRecording,
    sessionAtStop,
    capturedChunks,
    capturedRecorder,
    capturedShouldPersist,
    capturedViewOnce,
    capturedElapsedMs
  ).catch(() => {});
};

const cancelAudioRecording = () => {
  if (!isRecordingAudio.value && !mediaRecorderRef.value) {
    return;
  }

  isRecordingAudio.value = false;
  isRecordingPaused.value = false;

  if (audioRecordingTimerId.value) {
    clearInterval(audioRecordingTimerId.value);
    audioRecordingTimerId.value = null;
  }
  if (audioRecordingRAFId.value) {
    cancelAnimationFrame(audioRecordingRAFId.value);
    audioRecordingRAFId.value = null;
  }

  shouldPersistRecording.value = false;
  stopAudioRecordingInternal();
};

const finalizeAudioRecording = () => {
  if (!isRecordingAudio.value) return;

  const savedMsg = msg.value;
  const savedReply = chatStore.messageReply;

  msg.value = '';
  linkPreview.value = null;
  chatStore.clearMessageReply();

  isRecordingAudio.value = false;
  isRecordingPaused.value = false;

  if (audioRecordingTimerId.value) {
    clearInterval(audioRecordingTimerId.value);
    audioRecordingTimerId.value = null;
  }
  if (audioRecordingRAFId.value) {
    cancelAnimationFrame(audioRecordingRAFId.value);
    audioRecordingRAFId.value = null;
  }

  audioRecordingElapsedMs.value = 0;

  shouldPersistRecording.value = true;
  audioPendingViewOnce.value = audioViewOnce.value;
  stopAudioRecordingInternal(savedMsg, savedReply);
};

const togglePauseAudioRecording = async () => {
  if (!isRecordingAudio.value || !mediaRecorderRef.value) return;

  if (!isRecordingPaused.value) {
    if (mediaRecorderRef.value.state === 'recording') {
      mediaRecorderRef.value.pause();
    }
    if (audioRecordingStartAt.value !== null) {
      audioRecordingAccumulated.value +=
        performance.now() - audioRecordingStartAt.value;
      audioRecordingStartAt.value = null;
      updateRecordingElapsed();
    }
    if (audioContextRef.value?.state === 'running') {
      await audioContextRef.value.suspend().catch(() => null);
    }
    if (audioRecordingRAFId.value) {
      cancelAnimationFrame(audioRecordingRAFId.value);
      audioRecordingRAFId.value = null;
    }
    isRecordingPaused.value = true;
    return;
  }
  if (mediaRecorderRef.value.state === 'paused') {
    mediaRecorderRef.value.resume();
  }
  if (audioContextRef.value?.state === 'suspended') {
    await audioContextRef.value.resume().catch(() => null);
  }
  audioRecordingStartAt.value = performance.now();
  updateRecordingElapsed();
  isRecordingPaused.value = false;
  drawAudioWaveform();
};

const toggleViewOnceAudio = () => {
  audioViewOnce.value = !audioViewOnce.value;
};

const startAudioRecording = async () => {
  if (isRecordingAudio.value) return;

  recordingSessionId++;

  releaseAudioResources();
  resetRecordingState();

  if (recordedAudioUrl.value) {
    URL.revokeObjectURL(recordedAudioUrl.value);
    recordedAudioUrl.value = null;
  }
  recordedAudioBlob.value = null;
  audioRecordingDurationSeconds.value = null;
  audioPendingViewOnce.value = false;

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      chatStore.showSnackbar(t('audio_recording_error'), EColor.error);
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioStreamRef.value = stream;

    const preferredMimeTypes = [
      'audio/ogg;codecs=opus',
      'audio/opus',
      'audio/ogg',
    ];

    let mediaRecorder: MediaRecorder | null = null;
    for (const mimeType of preferredMimeTypes) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        try {
          mediaRecorder = new MediaRecorder(stream, { mimeType });
          break;
        } catch {}
      }
    }

    if (!mediaRecorder) {
      mediaRecorder = new MediaRecorder(stream);
    }

    mediaRecorderRef.value = mediaRecorder;
    audioChunksRef.value = [];
    mediaRecorder.ondataavailable = (event) => {
      if (event.data?.size > 0) {
        audioChunksRef.value.push(event.data);
      }
    };
    const currentSession = recordingSessionId;
    mediaRecorder.onstop = (_ev: Event) => {
      handleRecorderStop(
        savedMessageTextForRecording,
        savedReplyForRecording,
        currentSession
      ).catch(() => {});
    };

    const audioCtx = new AudioContext();
    audioContextRef.value = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    audioAnalyserRef.value = analyser;
    source.connect(analyser);

    mediaRecorder.start(250);
    isRecordingAudio.value = true;
    isRecordingPaused.value = false;
    audioViewOnce.value = false;
    audioRecordingAccumulated.value = 0;
    audioRecordingElapsedMs.value = 0;
    audioRecordingStartAt.value = performance.now();
    updateRecordingElapsed();
    if (audioRecordingTimerId.value) {
      clearInterval(audioRecordingTimerId.value);
    }
    audioRecordingTimerId.value = globalThis.setInterval(
      updateRecordingElapsed,
      200
    ) as unknown as number;

    await nextTick(() => {
      setupAudioCanvas();
    });
    drawAudioWaveform();
  } catch (error: any) {
    releaseAudioResources();
    resetRecordingState();
    const message =
      error?.name === 'NotAllowedError'
        ? t('audio_recording_permission_denied')
        : t('audio_recording_error');
    chatStore.showSnackbar(message, EColor.error);
  }
};

const onPickVideo = async (e: Event) => {
  const target = e.target as HTMLInputElement;
  const files = target.files;

  if (!files || files.length === 0) {
    target.value = '';
    return;
  }

  if (selectedDocuments.value.length > 0) {
    chatStore.showSnackbar(t('clear_documents_before_videos'), EColor.warning);
    target.value = '';
    return;
  }

  if (selectedPhotos.value.length > 0) {
    chatStore.showSnackbar(t('clear_images_before_videos'), EColor.warning);
    target.value = '';
    return;
  }

  const allowedVideoTypes = new Set([
    'video/mp4',
    'video/avi',
    'video/x-flv',
    'video/x-matroska',
    'video/quicktime',
    'video/3gpp',
  ]);
  const allowedExtensions = new Set(['mp4', 'avi', 'flv', 'mkv', 'mov', '3gp']);

  const videoFiles = Array.from(files).filter((file) => {
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    return (
      allowedVideoTypes.has(file.type) ||
      (fileExtension && allowedExtensions.has(fileExtension))
    );
  });

  if (videoFiles.length === 0) {
    chatStore.showSnackbar(t('invalid_video_format'), EColor.error);
    target.value = '';
    return;
  }

  const invalidVideos = Array.from(files).filter((file) => {
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    return (
      !allowedVideoTypes.has(file.type) &&
      (!fileExtension || !allowedExtensions.has(fileExtension))
    );
  });

  if (invalidVideos.length > 0) {
    chatStore.showSnackbar(t('invalid_video_format'), EColor.error);
  }

  const limit = 10;
  const currentCount = selectedVideos.value.length;
  if (currentCount >= limit) {
    chatStore.showSnackbar(t('max_videos_selected'), EColor.warning);
    target.value = '';
    return;
  }

  const spaceLeft = limit - currentCount;
  const filesToAdd = videoFiles.slice(0, spaceLeft);
  if (videoFiles.length > spaceLeft) {
    chatStore.showSnackbar(
      t('can_select_more_videos', { count: spaceLeft }),
      EColor.warning
    );
  }

  const oversizedVideos = filesToAdd.filter(
    (file) => file.size > MAX_VIDEO_SIZE_BYTES
  );
  const validVideos = filesToAdd.filter(
    (file) => file.size <= MAX_VIDEO_SIZE_BYTES
  );

  if (oversizedVideos.length > 0) {
    chatStore.showSnackbar(t('video_size_exceeded'), EColor.error);
  }

  const loadedVideos = await Promise.all(
    validVideos.map(async (file) => {
      const preview = URL.createObjectURL(file);
      const duration = await getVideoDuration(preview);

      return {
        file,
        preview,
        name: file.name,
        size: file.size,
        type: file.type,
        duration: duration ?? null,
      };
    })
  );

  for (const video of loadedVideos) {
    selectedVideos.value.push(video);
  }

  target.value = '';
};
const onPickAudio = async (e: Event) => {
  const target = e.target as HTMLInputElement;
  const files = target.files;

  if (!files || files.length === 0) {
    target.value = '';
    return;
  }

  if (selectedDocuments.value.length > 0) {
    chatStore.showSnackbar(t('clear_documents_before_audios'), EColor.warning);
    target.value = '';
    return;
  }

  if (selectedPhotos.value.length > 0) {
    chatStore.showSnackbar(t('clear_images_before_audios'), EColor.warning);
    target.value = '';
    return;
  }

  if (selectedVideos.value.length > 0) {
    chatStore.showSnackbar(t('clear_videos_before_audios'), EColor.warning);
    target.value = '';
    return;
  }

  const allowedAudioTypes = new Set([
    'audio/mpeg',
    'audio/mp3',
    'audio/aac',
    'audio/m4a',
    'audio/x-m4a',
    'audio/amr',
    'audio/amr-wb',
    'audio/ogg',
    'audio/opus',
  ]);
  const allowedExtensions = new Set([
    'mp3',
    'aac',
    'm4a',
    'amr',
    'ogg',
    'opus',
  ]);

  const audioFiles = Array.from(files).filter((file) => {
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    return (
      allowedAudioTypes.has(file.type) ||
      (fileExtension && allowedExtensions.has(fileExtension))
    );
  });

  if (audioFiles.length === 0) {
    chatStore.showSnackbar(t('invalid_audio_format'), EColor.error);
    target.value = '';
    return;
  }

  const invalidAudios = Array.from(files).filter((file) => {
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    return (
      !allowedAudioTypes.has(file.type) &&
      (!fileExtension || !allowedExtensions.has(fileExtension))
    );
  });

  if (invalidAudios.length > 0) {
    chatStore.showSnackbar(t('invalid_audio_format'), EColor.error);
  }

  const limit = 10;
  const currentCount = selectedAudios.value.length;
  if (currentCount >= limit) {
    chatStore.showSnackbar(t('max_audios_selected'), EColor.warning);
    target.value = '';
    return;
  }

  const spaceLeft = limit - currentCount;
  const filesToAdd = audioFiles.slice(0, spaceLeft);
  if (audioFiles.length > spaceLeft) {
    chatStore.showSnackbar(
      t('can_select_more_audios', { count: spaceLeft }),
      EColor.warning
    );
  }

  const oversizedAudios = filesToAdd.filter(
    (file) => file.size > MAX_AUDIO_SIZE_BYTES
  );
  const validAudios = filesToAdd.filter(
    (file) => file.size <= MAX_AUDIO_SIZE_BYTES
  );

  if (oversizedAudios.length > 0) {
    chatStore.showSnackbar(t('audio_size_exceeded'), EColor.error);
  }

  const loadedAudios = await Promise.all(
    validAudios.map(async (file) => {
      const preview = URL.createObjectURL(file);
      const duration = await getAudioDuration(preview);

      return {
        file,
        preview,
        name: file.name,
        size: file.size,
        type: file.type,
        duration: duration ?? null,
      };
    })
  );

  for (const audio of loadedAudios) {
    selectedAudios.value.push(audio);
  }

  target.value = '';
};

const processPastedFile = async (file: File) => {
  const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';

  const allowedImageTypes = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
  ]);
  const allowedImageExtensions = new Set(['jpg', 'jpeg', 'png', 'gif']);

  const allowedVideoTypes = new Set([
    'video/mp4',
    'video/avi',
    'video/x-flv',
    'video/x-matroska',
    'video/quicktime',
    'video/3gpp',
  ]);
  const allowedVideoExtensions = new Set([
    'mp4',
    'avi',
    'flv',
    'mkv',
    'mov',
    '3gp',
  ]);

  const allowedAudioTypes = new Set([
    'audio/mpeg',
    'audio/mp3',
    'audio/aac',
    'audio/m4a',
    'audio/x-m4a',
    'audio/amr',
    'audio/amr-wb',
    'audio/ogg',
    'audio/opus',
  ]);
  const allowedAudioExtensions = new Set([
    'mp3',
    'aac',
    'm4a',
    'amr',
    'ogg',
    'opus',
  ]);

  const isImage =
    allowedImageTypes.has(file.type) ||
    (fileExtension && allowedImageExtensions.has(fileExtension));
  const isVideo =
    allowedVideoTypes.has(file.type) ||
    (fileExtension && allowedVideoExtensions.has(fileExtension));
  const isAudio =
    allowedAudioTypes.has(file.type) ||
    (fileExtension && allowedAudioExtensions.has(fileExtension));
  const isDocument = !isImage && !isVideo && !isAudio;

  if (isImage) {
    if (selectedVideos.value.length > 0) {
      chatStore.showSnackbar(t('clear_videos_before_images'), EColor.warning);
      return;
    }

    if (selectedDocuments.value.length > 0) {
      chatStore.showSnackbar(
        t('clear_documents_before_images'),
        EColor.warning
      );
      return;
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      chatStore.showSnackbar(t('image_size_exceeded'), EColor.error);
      return;
    }

    const currentCount = selectedPhotos.value.length;
    if (currentCount >= 10) {
      chatStore.showSnackbar(t('max_images_selected'), EColor.warning);
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        selectedPhotos.value.push({
          file,
          preview: event.target.result as string,
        });
      }
    };
    reader.readAsDataURL(file);
    return;
  }

  if (isVideo) {
    if (selectedDocuments.value.length > 0) {
      chatStore.showSnackbar(
        t('clear_documents_before_videos'),
        EColor.warning
      );
      return;
    }

    if (selectedPhotos.value.length > 0) {
      chatStore.showSnackbar(t('clear_images_before_videos'), EColor.warning);
      return;
    }

    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      chatStore.showSnackbar(t('video_size_exceeded'), EColor.error);
      return;
    }

    const currentCount = selectedVideos.value.length;
    if (currentCount >= 10) {
      chatStore.showSnackbar(t('max_videos_selected'), EColor.warning);
      return;
    }

    const preview = URL.createObjectURL(file);
    const duration = await getVideoDuration(preview);

    selectedVideos.value.push({
      file,
      preview,
      name: file.name,
      size: file.size,
      type: file.type,
      duration: duration ?? null,
    });
    return;
  }

  if (isAudio) {
    if (selectedDocuments.value.length > 0) {
      chatStore.showSnackbar(
        t('clear_documents_before_audios'),
        EColor.warning
      );
      return;
    }

    if (selectedPhotos.value.length > 0) {
      chatStore.showSnackbar(t('clear_images_before_audios'), EColor.warning);
      return;
    }

    if (selectedVideos.value.length > 0) {
      chatStore.showSnackbar(t('clear_videos_before_audios'), EColor.warning);
      return;
    }

    if (file.size > MAX_AUDIO_SIZE_BYTES) {
      chatStore.showSnackbar(t('audio_size_exceeded'), EColor.error);
      return;
    }

    const currentCount = selectedAudios.value.length;
    if (currentCount >= 10) {
      chatStore.showSnackbar(t('max_audios_selected'), EColor.warning);
      return;
    }

    const preview = URL.createObjectURL(file);
    const duration = await getAudioDuration(preview);

    selectedAudios.value.push({
      file,
      preview,
      name: file.name,
      size: file.size,
      type: file.type,
      duration: duration ?? null,
    });
    return;
  }

  if (isDocument) {
    if (selectedVideos.value.length > 0) {
      chatStore.showSnackbar(
        t('clear_videos_before_documents'),
        EColor.warning
      );
      return;
    }

    if (selectedPhotos.value.length > 0) {
      chatStore.showSnackbar(
        t('clear_images_before_documents'),
        EColor.warning
      );
      return;
    }

    if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
      chatStore.showSnackbar(t('document_size_exceeded'), EColor.error);
      return;
    }

    const currentCount = selectedDocuments.value.length;
    if (currentCount >= 10) {
      chatStore.showSnackbar(t('max_documents_selected'), EColor.warning);
      return;
    }

    selectedDocuments.value.push({
      file,
      name: file.name,
      size: file.size,
      extension: fileExtension,
      type: file.type,
    });
    return;
  }

  chatStore.showSnackbar(t('invalid_file_format'), EColor.error);
};

const handlePaste = async (event: ClipboardEvent) => {
  if (isQueueStatus.value || isUraStatus.value || selectedQuickMessage.value) {
    return;
  }

  const items = event.clipboardData?.items;
  if (!items) {
    return;
  }

  const files: File[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) {
        files.push(file);
      }
    }
  }

  if (files.length === 0) {
    return;
  }

  event.preventDefault();

  for (const file of files) {
    await processPastedFile(file);
  }
};

const openPreviewImage = (photo: ISelectedPhotoPreview) => {
  viewerKind.value = 'image';
  viewerSrc.value = photo.preview;
  viewerCaption.value = '';
  viewerDownloadName.value = photo.file.name;
  viewerOpen.value = true;
};

const openPreviewVideo = (video: ISelectedVideoPreview) => {
  viewerKind.value = 'video';
  viewerSrc.value = video.preview;
  viewerCaption.value = '';
  viewerDownloadName.value = video.name;
  viewerOpen.value = true;
};

const removeAudio = (index: number) => {
  const audio = selectedAudios.value[index];
  if (audio) {
    if (audio.preview && audio.preview.startsWith('blob:')) {
      URL.revokeObjectURL(audio.preview);
    }
  }
  selectedAudios.value.splice(index, 1);
};

const removeContact = (index: number) => {
  selectedContacts.value.splice(index, 1);
};

function formatPhone(value: string | null | undefined): string {
  if (!value) return '';

  const numbers = value.replaceAll(/\D/g, '').slice(0, 11);

  if (numbers.length <= 2) {
    return numbers;
  }
  if (numbers.length <= 6) {
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  }
  if (numbers.length <= 10) {
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
  }
  return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
}

const viewContactEmailFormatted = computed(() => {
  if (isViewEmailDecrypted.value) {
    return viewContactEmail.value ?? '';
  }
  return viewContactEmailPartial.value ?? '';
});

const viewContactPhoneFormatted = computed(() => {
  if (isViewPhoneDecrypted.value && viewContactPhone.value) {
    return formatPhone(viewContactPhone.value);
  }
  return viewContactPhonePartial.value ?? '';
});

const toggleViewEmailVisibility = async () => {
  if (!selectedContactDetails.value?.contact_id) return;

  if (isViewEmailDecrypted.value) {
    viewContactEmail.value = null;
    isViewEmailDecrypted.value = false;
    return;
  }

  isLoadingViewEmail.value = true;
  const decryptedEmail = await chatStore.getChatContactEmailDecrypted(
    selectedContactDetails.value.contact_id
  );
  isLoadingViewEmail.value = false;

  if (decryptedEmail) {
    viewContactEmail.value = decryptedEmail;
    isViewEmailDecrypted.value = true;
  }
};

const toggleViewPhoneVisibility = async () => {
  if (!selectedContactDetails.value?.contact_id) return;

  if (isViewPhoneDecrypted.value) {
    if (viewContactPhonePartial.value?.includes('*')) {
      viewContactPhone.value = null;
    }
    if (!viewContactPhonePartial.value?.includes('*')) {
      viewContactPhone.value =
        viewContactPhonePartial.value?.replaceAll(/\D/g, '') ?? null;
    }
    isViewPhoneDecrypted.value = false;
    return;
  }

  isLoadingViewPhone.value = true;
  const decryptedPhone = await chatStore.getChatContactPhoneDecrypted(
    selectedContactDetails.value.contact_id
  );
  isLoadingViewPhone.value = false;

  if (decryptedPhone) {
    viewContactPhone.value = decryptedPhone.replaceAll(/\D/g, '');
    isViewPhoneDecrypted.value = true;
  }
};

const viewContact = async (contactId: string) => {
  const contact = await chatStore.getChatContactById(contactId);
  if (contact) {
    selectedContactDetails.value = contact;
    viewContactEmailPartial.value = contact.email_partial ?? null;
    viewContactEmail.value = null;
    isViewEmailDecrypted.value = false;
    viewContactPhonePartial.value = contact.phone_partial ?? null;
    viewContactPhone.value = null;
    isViewPhoneDecrypted.value = false;
    isContactViewModalOpen.value = true;
  }
};

const audioModalOpen = ref(false);
const audioModalSrc = ref<string>('');
const audioModalName = ref<string>('');
const audioModalDuration = ref<number | null>(null);
const audioModalPlayer = ref<HTMLAudioElement | null>(null);
const audioModalIsPlaying = ref(false);
const audioModalCurrentTime = ref(0);
const audioModalProgress = ref(0);

const setupAudioModalListeners = (): (() => void) | null => {
  if (!audioModalPlayer.value) return null;

  const player = audioModalPlayer.value;

  const onLoadedMetadata = () => {
    if (player) {
      audioModalDuration.value = player.duration;
    }
  };

  const onTimeUpdate = () => {
    if (player) {
      audioModalCurrentTime.value = player.currentTime;
      if (player.duration) {
        audioModalProgress.value = (player.currentTime / player.duration) * 100;
      }
    }
  };

  const onPlay = () => {
    audioModalIsPlaying.value = true;
  };

  const onPause = () => {
    audioModalIsPlaying.value = false;
  };

  const onEnded = () => {
    audioModalIsPlaying.value = false;
    audioModalCurrentTime.value = 0;
    audioModalProgress.value = 0;
  };

  player.addEventListener('loadedmetadata', onLoadedMetadata);
  player.addEventListener('timeupdate', onTimeUpdate);
  player.addEventListener('play', onPlay);
  player.addEventListener('pause', onPause);
  player.addEventListener('ended', onEnded);

  return () => {
    player.removeEventListener('loadedmetadata', onLoadedMetadata);
    player.removeEventListener('timeupdate', onTimeUpdate);
    player.removeEventListener('play', onPlay);
    player.removeEventListener('pause', onPause);
    player.removeEventListener('ended', onEnded);
  };
};

let audioModalCleanup: (() => void) | null = null;

const openPreviewAudio = (audio: ISelectedAudioPreview) => {
  if (audioModalCleanup) {
    audioModalCleanup();
    audioModalCleanup = null;
  }

  audioModalSrc.value = audio.preview;
  audioModalName.value = audio.name;
  audioModalDuration.value = audio.duration;
  audioModalCurrentTime.value = 0;
  audioModalProgress.value = 0;
  audioModalOpen.value = true;

  nextTick(() => {
    audioModalCleanup = setupAudioModalListeners();
  });
};

const toggleAudioModalPlay = () => {
  if (!audioModalPlayer.value) return;

  if (audioModalIsPlaying.value) {
    audioModalPlayer.value.pause();
    return;
  }

  audioModalPlayer.value.play().catch(() => {
    audioModalIsPlaying.value = false;
  });
};

const formatAudioModalTime = (seconds: number | null): string => {
  if (seconds === null || !Number.isFinite(seconds)) return '0:00';
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

const closeAudioModal = () => {
  if (audioModalPlayer.value) {
    audioModalPlayer.value.pause();
    audioModalPlayer.value.currentTime = 0;
  }
  if (audioModalCleanup) {
    audioModalCleanup();
    audioModalCleanup = null;
  }
  audioModalIsPlaying.value = false;
  audioModalCurrentTime.value = 0;
  audioModalProgress.value = 0;
  audioModalOpen.value = false;
};

const downloadPreviewImage = async (url: string, filename?: string | null) => {
  if (!url) return;

  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = globalThis.URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = filename || 'image.jpg';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => {
      globalThis.URL.revokeObjectURL(blobUrl);
    }, 100);
  } catch (error) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.download = filename || 'image.jpg';
    anchor.rel = 'noopener';
    anchor.click();
  }
};

const downloadPreviewVideo = async (url: string, filename?: string | null) => {
  if (!url) return;

  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = globalThis.URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = filename || 'video.mp4';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => {
      globalThis.URL.revokeObjectURL(blobUrl);
    }, 100);
  } catch (error) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.download = filename || 'video.mp4';
    anchor.rel = 'noopener';
    anchor.click();
  }
};

const downloadViewerMedia = () => {
  if (!viewerSrc.value) return;
  if (viewerKind.value === 'video') {
    downloadPreviewVideo(viewerSrc.value, viewerDownloadName.value);
    return;
  }
  downloadPreviewImage(viewerSrc.value, viewerDownloadName.value);
};

const onEmojiSelect = (e: any) => {
  if (hasSelectedAudios.value) return;

  const ch = e?.native || e?.skins?.[0]?.native || '';

  if (ch) {
    msg.value = (msg.value || '') + ch;
    nextTick(() => globalThis.dispatchEvent(new CustomEvent('focus-composer')));
  }
};

const onRecordAudio = () => {
  if (isUraStatus.value) return;
  startAudioRecording();
};

const onSendText = () => {
  if (selectedQuickMessage.value) {
    void sendQuickMessage();
    return;
  }

  void sendMessage();
};

const removeDocument = (index: number) => {
  selectedDocuments.value.splice(index, 1);
};

const documentIconMap: Record<string, string> = {
  pdf: 'tabler-file-type-pdf',
  doc: 'tabler-file-type-doc',
  docx: 'tabler-file-type-doc',
  xls: 'tabler-file-type-xls',
  xlsx: 'tabler-file-type-xls',
  csv: 'tabler-file-type-xls',
  ppt: 'tabler-file-type-ppt',
  pptx: 'tabler-file-type-ppt',
  txt: 'tabler-file-type-txt',
  zip: 'tabler-file-type-zip',
  rar: 'tabler-file-type-zip',
  '7z': 'tabler-file-type-zip',
  json: 'tabler-file-code',
  xml: 'tabler-file-code',
};

const resolveDocumentIcon = (extension?: string, mimetype?: string): string => {
  const ext = extension?.toLowerCase();
  if (ext && documentIconMap[ext]) {
    return documentIconMap[ext];
  }

  if (mimetype?.includes('pdf')) return 'tabler-file-type-pdf';
  if (mimetype?.includes('word')) return 'tabler-file-type-doc';
  if (mimetype?.includes('sheet') || mimetype?.includes('excel'))
    return 'tabler-file-type-xls';
  if (mimetype?.includes('presentation')) return 'tabler-file-type-ppt';
  if (mimetype?.includes('zip') || mimetype?.includes('compressed'))
    return 'tabler-file-type-zip';

  return 'tabler-file-description';
};

const truncateFileName = (name: string, max = 32): string => {
  if (name.length <= max) return name;
  const extIndex = name.lastIndexOf('.');
  if (extIndex === -1 || extIndex < name.length - 6) {
    return `${name.slice(0, max - 3)}...`;
  }

  const ext = name.slice(extIndex);
  const base = name.slice(0, max - ext.length - 3);
  return `${base}...${ext}`;
};

const formatFileSize = (bytes: number): string => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, exponent);
  let formatted: string;
  if (value >= 100) {
    formatted = value.toFixed(0);
    return `${formatted} ${units[exponent]}`;
  }
  if (value >= 10) {
    formatted = value.toFixed(1);
    return `${formatted} ${units[exponent]}`;
  }
  formatted = value.toFixed(2);
  return `${formatted} ${units[exponent]}`;
};

const debouncedMsg = refDebounced(msg, 250);
watch(debouncedMsg, async (val) => {
  const firstUrl = extractFirstUrl(val as string);
  if (firstUrl) {
    isLoadingLinkPreview.value = true;
    linkPreview.value = null;
    try {
      const linkPreviewResponse = await chatStore.generateLinkPreview({
        url: firstUrl,
      });
      if (linkPreviewResponse?.title !== 'Error') {
        linkPreview.value = linkPreviewResponse as ViewLinkPreviewResponse;
      } else {
        linkPreview.value = null;
      }
    } catch (error) {
      linkPreview.value = null;
    } finally {
      isLoadingLinkPreview.value = false;
    }
    return;
  }
  isLoadingLinkPreview.value = false;
  linkPreview.value = null;
});

watch(
  () => chatStore.activeChat?.chat_id,
  (newChatId, oldChatId) => {
    persistMessageDraft(oldChatId, msg.value);

    selectedQuickMessage.value = null;
    showQuickMessageList.value = false;
    quickMessageTemplates.value = [];
    quickMessageSearch.value = '';

    const nextDraft = getMessageDraft(newChatId);
    if (msg.value !== nextDraft) {
      msg.value = nextDraft;
    }

    linkPreview.value = null;
    isLoadingLinkPreview.value = false;
  }
);

watch(msg, async (val) => {
  persistMessageDraft(chatStore.activeChat?.chat_id, val);

  if (selectedQuickMessage.value) {
    showQuickMessageList.value = false;
    quickMessageTemplates.value = [];
    quickMessageSearch.value = '';
    return;
  }

  if (typeof val === 'string' && val.startsWith('/')) {
    const searchTerm = val.slice(1).trim();
    quickMessageSearch.value = searchTerm;
    showQuickMessageList.value = true;

    const templates = await chatStore.listQuickMessageTemplates(
      searchTerm || null,
      chatStore.activeChat?.worker?.id ?? null
    );
    if (selectedQuickMessage.value) {
      return;
    }
    quickMessageTemplates.value = templates;
  } else {
    showQuickMessageList.value = false;
    quickMessageTemplates.value = [];
    quickMessageSearch.value = '';
  }
});

watch(
  () => selectedAudios.value.length,
  (audioCount) => {
    if (audioCount <= 0) {
      return;
    }

    if (msg.value) {
      msg.value = '';
    }

    linkPreview.value = null;
    isLoadingLinkPreview.value = false;
    showQuickMessageList.value = false;
    quickMessageTemplates.value = [];
    quickMessageSearch.value = '';
    isEmojiOpen.value = false;

    if (chatStore.messageReply) {
      chatStore.clearMessageReply();
    }
  }
);

const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) {
    return t('good_morning');
  }
  if (hour >= 12 && hour < 18) {
    return t('good_afternoon');
  }
  return t('good_evening');
};

const getCurrentProtocol = (): string => {
  const activeChat = chatStore.activeChat;
  if (!activeChat) {
    return generateProtocol();
  }

  if (activeChat.protocol_start && activeChat.protocol_start.length > 0) {
    return activeChat.protocol_start[activeChat.protocol_start.length - 1];
  }
  if (activeChat.protocol_transfer && activeChat.protocol_transfer.length > 0) {
    return activeChat.protocol_transfer[
      activeChat.protocol_transfer.length - 1
    ];
  }
  if (activeChat.protocol_ura && activeChat.protocol_ura.length > 0) {
    return activeChat.protocol_ura[activeChat.protocol_ura.length - 1];
  }

  return generateProtocol();
};

const replaceTagsInMessage = (message: string | null): string => {
  if (!message) return '';

  const activeChat = chatStore.activeChat;
  const contactName = activeChat?.name || '';
  const protocol = getCurrentProtocol();
  const now = new Date();
  const date = now.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const time = now.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const greeting = getGreeting();
  const accountName = activeChat?.account?.name || '';
  const phone = activeChat?.phone ? formatPhoneBR(activeChat.phone) : '';
  const channelName = activeChat?.worker?.name || '';

  let replaced = message;

  replaced = replaced.replaceAll(/\{\{\s*greeting\s*\}\}/gi, greeting);
  replaced = replaced.replaceAll(/\{\{\s*name\s*\}\}/gi, contactName);
  replaced = replaced.replaceAll(/\{\{\s*protocol\s*\}\}/gi, protocol);
  replaced = replaced.replaceAll(/\{\{\s*protocolo\s*\}\}/gi, protocol);
  replaced = replaced.replaceAll(/\{\{\s*date\s*\}\}/gi, date);
  replaced = replaced.replaceAll(/\{\{\s*time\s*\}\}/gi, time);
  replaced = replaced.replaceAll(/\{\{\s*account_name\s*\}\}/gi, accountName);
  replaced = replaced.replaceAll(/\{\{\s*accountname\s*\}\}/gi, accountName);
  replaced = replaced.replaceAll(/\{\{\s*phone\s*\}\}/gi, phone);
  replaced = replaced.replaceAll(/\{\{\s*channel_name\s*\}\}/gi, channelName);
  replaced = replaced.replaceAll(/\{\{\s*channelname\s*\}\}/gi, channelName);

  return replaced;
};

const selectQuickMessage = async (
  template: ListQuickMessageTemplatesResponse
) => {
  if (template.auto_send) {
    selectedQuickMessage.value = template;
    showQuickMessageList.value = false;
    await sendQuickMessage();
    return;
  }

  selectedQuickMessage.value = template;
  showQuickMessageList.value = false;
  quickMessageTemplates.value = [];
  quickMessageSearch.value = '';
  msg.value = replaceTagsInMessage(template.message);
};

const canSendSelectedQuickMessage = computed(() => {
  const template = selectedQuickMessage.value;
  if (!template) return false;

  if (!chatStore.activeChat?.worker?.id || !canComposeInActiveChat.value) {
    return false;
  }

  if (template.type === EMessageType.text) {
    return msg.value.trim().length > 0;
  }

  return !!template.attachment_url;
});

const createQuickMessageFormData = (
  type: string,
  messageValue: string | null,
  hash: string,
  template: typeof selectedQuickMessage.value,
  options?: {
    includeEmptyMessage?: boolean;
  }
): FormData => {
  const formData = new FormData();
  formData.append('type', type);
  formData.append('hash', hash);

  if (messageValue) {
    formData.append('message', messageValue);
  } else if (options?.includeEmptyMessage) {
    formData.append('message', '');
  }

  if (template?.message_template_id) {
    formData.append('quick_message_template_id', template.message_template_id);
  }

  return formData;
};

const sendQuickMessage = async () => {
  if (!selectedQuickMessage.value) return;
  if (!hasActiveChat()) return;
  if (!canComposeInActiveChat.value) {
    chatStore.showSnackbar(
      t('must_join_conversation_to_reply'),
      EColor.warning
    );
    return;
  }

  const template = selectedQuickMessage.value;
  const isAutoSend = template.auto_send === true;
  const hydratedTemplateMessage = replaceTagsInMessage(template.message);
  const resolvedMessage = isAutoSend ? hydratedTemplateMessage : msg.value;
  const messageValue =
    resolvedMessage.trim().length > 0 ? resolvedMessage : null;
  const shouldIncludeEmptyMessage =
    !isAutoSend &&
    template.type !== EMessageType.text &&
    resolvedMessage.trim().length === 0;

  if (template.type === EMessageType.text) {
    if (!messageValue) {
      return;
    }

    const savedReply = chatStore.messageReply;
    const savedLinkPreview = linkPreview.value
      ? { ...linkPreview.value }
      : null;

    chatStore.clearMessageReply();
    selectedQuickMessage.value = null;
    showQuickMessageList.value = false;
    quickMessageTemplates.value = [];
    quickMessageSearch.value = '';

    msg.value = '';
    linkPreview.value = null;
    isLoadingLinkPreview.value = false;

    clearSelectedVideos();
    clearSelectedAudios();
    clearSelectedContacts();
    selectedPhotos.value = [];
    selectedDocuments.value = [];
    selectedLocation.value = null;

    await sendTextMessage(
      messageValue,
      savedLinkPreview,
      savedReply || undefined,
      isAutoSend || resolvedMessage === hydratedTemplateMessage
        ? (template.message_template_id ?? null)
        : null
    );
    finalizeSend();
    return;
  }

  if (!template.attachment_url) {
    return;
  }

  chatStore.clearMessageReply();
  selectedQuickMessage.value = null;
  showQuickMessageList.value = false;
  quickMessageTemplates.value = [];
  quickMessageSearch.value = '';

  msg.value = '';
  linkPreview.value = null;
  isLoadingLinkPreview.value = false;

  const hash = createMessageHash();
  const quickMediaContent = {
    url: template.attachment_url,
    mimetype: template.mimetype || null,
    ...(messageValue
      ? {
          caption: messageValue,
        }
      : {}),
    ...(template.type === 'video' && {
      duration: template.duration ?? null,
      width: template.width ?? null,
      height: template.height ?? null,
    }),
    ...(template.type === 'audio' && {
      duration: template.duration ?? null,
    }),
    ...(template.type === 'image' && {
      width: template.width ?? null,
      height: template.height ?? null,
    }),
  };

  const content: ContentMessageChat = {
    type: template.type as EMessageType,
    message: messageValue,
    [template.type]: quickMediaContent,
    ...(template.type === 'document'
      ? {
          document: quickMediaContent,
        }
      : {}),
  };

  await registerLocalMessage(content, hash);

  const formData = createQuickMessageFormData(
    template.type,
    messageValue,
    hash,
    template,
    {
      includeEmptyMessage: shouldIncludeEmptyMessage,
    }
  );

  let success = false;

  if (template.type === 'image') {
    success = await chatStore.createMessageWithImages(formData, {
      skipLoading: true,
      onUploadProgress: (progress) => {
        markUploadProgress(hash, progress);
      },
    });
  } else if (template.type === 'video') {
    success = await chatStore.createMessageWithVideos(formData, {
      skipLoading: true,
      onUploadProgress: (progress) => {
        markUploadProgress(hash, progress);
      },
    });
  } else if (template.type === 'audio') {
    success = await chatStore.createMessageWithAudios(formData, {
      skipLoading: true,
      onUploadProgress: (progress) => {
        markUploadProgress(hash, progress);
      },
    });
  } else if (template.type === 'document') {
    success = await chatStore.createMessageWithDocuments(formData, {
      skipLoading: true,
      onUploadProgress: (progress) => {
        markUploadProgress(hash, progress);
      },
    });
  }

  if (success) {
    finalizeSend();
  } else {
    markUploadError(hash);
  }
};

const cancelQuickMessage = () => {
  selectedQuickMessage.value = null;
  showQuickMessageList.value = false;
  quickMessageTemplates.value = [];
  quickMessageSearch.value = '';
  msg.value = '';
  linkPreview.value = null;
  isLoadingLinkPreview.value = false;
};

let previousLoadingState = false;
let previousActiveChatId: string | undefined = undefined;
watch(
  () =>
    [
      chatStore.loading,
      chatStore.listMessages.length,
      chatStore.activeChat?.chat_id,
    ] as const,
  async ([loading, messageCount, activeChatId]) => {
    const currentLoading = Boolean(loading);
    const currentMessageCount =
      typeof messageCount === 'number' ? messageCount : 0;
    const chatChanged = previousActiveChatId !== activeChatId;

    const loadingFinished =
      previousLoadingState && !currentLoading && currentMessageCount > 0;

    const chatChangedWithMessages =
      chatChanged && !currentLoading && currentMessageCount > 0;

    previousLoadingState = currentLoading;
    previousActiveChatId = activeChatId;

    if ((loadingFinished || chatChangedWithMessages) && activeChatId) {
      await nextTick();

      requestAnimationFrame(() => {
        scrollToBottomInChatLog();
        hideScrollbarIfNotNeeded();
      });
    }
  }
);

const hideScrollbarIfNotNeeded = () => {
  if (!chatLogPS.value) return;

  const scrollEl = chatLogPS.value.$el || chatLogPS.value;
  if (!scrollEl) return;

  const psContainer =
    (scrollEl.querySelector('.ps') as HTMLElement) ||
    (scrollEl.closest('.ps') as HTMLElement) ||
    (scrollEl as HTMLElement);

  if (!psContainer) return;

  const needsScroll = psContainer.scrollHeight > psContainer.clientHeight;

  const railY = psContainer.querySelector('.ps__rail-y') as HTMLElement;
  if (railY) {
    railY.style.display = needsScroll ? '' : 'none';
  }
};

watch(
  () => [chatStore.listMessages.length, chatStore.loading],
  async () => {
    await nextTick();
    requestAnimationFrame(() => {
      hideScrollbarIfNotNeeded();
    });
  }
);

const onOpenAddContactModal = (e: Event) => {
  const customEvent = e as CustomEvent;
  const contactData =
    customEvent.detail as Partial<CreateContactRequest> | null;
  if (contactData) {
    addContactInitialData.value = contactData;
  } else {
    addContactInitialData.value = null;
  }
  isAddContactModalOpen.value = true;
};

const onSendTemplateButton = async (e: Event) => {
  const customEvent = e as CustomEvent;
  const { text } = customEvent.detail as {
    text: string;
    buttonId: string;
    messageId: string;
  };

  if (!text || !hasActiveChat()) return;
  if (isQueueOrUraStatus.value) return;

  await sendTextMessage(text);
};

const onOpenEditContactModal = (e: Event) => {
  const customEvent = e as CustomEvent;
  const contactId = customEvent.detail as string;

  if (contactId) {
    editContactId.value = contactId;
    isEditContactModalOpen.value = true;
  }
};

const onOpenAiReplyModal = (e: Event) => {
  const customEvent = e as CustomEvent;
  const message = customEvent.detail as ListMessageResult;
  if (message) {
    aiReplyTargetMessage.value = message;
    isAiReplyModalOpen.value = true;
  }
};

const onOpenTranscribeModal = (e: Event) => {
  const customEvent = e as CustomEvent;
  const message = customEvent.detail as ListMessageResult;
  if (message) {
    transcribeTargetMessage.value = message;
    isTranscribeModalOpen.value = true;
  }
};

const onAiReplySend = async (
  text: string,
  audioUrl?: string,
  audioDuration?: number
) => {
  if (!text || !hasActiveChat()) return;
  if (isQueueOrUraStatus.value) return;

  const replyMessage = aiReplyTargetMessage.value;

  if (audioUrl) {
    try {
      const response = await fetch(audioUrl);
      if (!response.ok) throw new Error('Failed to fetch audio');
      const blob = await response.blob();
      const mimeType = blob.type || 'audio/mpeg';
      await sendAudioMessage(
        blob,
        mimeType,
        audioDuration ?? null,
        false,
        null,
        replyMessage
      );
    } catch {
      chatStore.showSnackbar(t('chat_ai_reply_send_audio_error'), EColor.error);
    }
  } else {
    await sendTextMessage(text, null, replyMessage);
  }
};

const focusComposer = () => {
  setTimeout(() => {
    const el = composerRef.value?.$el?.querySelector(
      'textarea'
    ) as HTMLTextAreaElement | null;
    el?.focus({ preventScroll: false });
  }, 120);
};

const onScrollToMessageEvt = (e: Event) => {
  const id = (e as CustomEvent<string>).detail;
  if (id) highlightAndScrollToMessage(id).catch(() => {});
};

const retryTextMessage = async (
  content: NonNullable<ListMessageResult['content']>,
  hash: string
): Promise<void> => {
  const messageBody: CreateMessageChatsBody = {
    type: EMessageType.text,
    message: content.message ?? '',
    hash,
  };

  if (content.link_preview) {
    messageBody.link_preview = content.link_preview as ViewLinkPreviewResponse;
  }

  if (content.message_quoted_id) {
    messageBody.message_quoted_id = content.message_quoted_id;
  }

  const success = await chatStore.createMessage(messageBody);
  if (!success) {
    markUploadError(hash);
  }
};

const retryImageMessage = async (
  content: NonNullable<ListMessageResult['content']>,
  hash: string
): Promise<void> => {
  try {
    const response = await fetch(content.image!.url!);
    const blob = await response.blob();
    const file = new File(
      [blob],
      `image.${content.image!.extension || 'jpg'}`,
      {
        type: content.image!.mimetype || 'image/jpeg',
      }
    );

    const photo = {
      file,
      preview: content.image!.url!,
    };

    const replyId = content.message_quoted_id ?? null;
    const formData = createImageFormData(
      photo,
      content.message ?? null,
      replyId,
      hash
    );

    chatStore.updateLocalMessageProgress(hash, 0);
    const success = await chatStore.createMessageWithImages(formData, {
      skipLoading: true,
      onUploadProgress: (progress) => {
        markUploadProgress(hash, progress);
      },
    });

    if (!success) {
      markUploadError(hash);
    }
  } catch (error) {
    markUploadError(hash);
  }
};

const retryVideoMessage = async (
  content: NonNullable<ListMessageResult['content']>,
  hash: string
): Promise<void> => {
  try {
    const response = await fetch(content.video!.url!);
    const blob = await response.blob();
    const file = new File(
      [blob],
      content.video!.name || `video.${content.video!.extension || 'mp4'}`,
      {
        type: content.video!.mimetype || 'video/mp4',
      }
    );

    const video = {
      file,
      preview: content.video!.url!,
      name: content.video!.name || file.name,
      type: content.video!.mimetype || 'video/mp4',
      size: content.video!.size || file.size,
      duration: content.video!.duration ?? null,
    };

    const replyId = content.message_quoted_id ?? null;
    const formData = createVideoFormData(
      video,
      content.message ?? null,
      replyId,
      hash
    );

    chatStore.updateLocalMessageProgress(hash, 0);
    const success = await chatStore.createMessageWithVideos(formData, {
      skipLoading: true,
      onUploadProgress: (progress) => {
        markUploadProgress(hash, progress);
      },
    });

    if (!success) {
      markUploadError(hash);
    }
  } catch (error) {
    markUploadError(hash);
  }
};

const retryAudioMessage = async (
  content: NonNullable<ListMessageResult['content']>,
  hash: string
): Promise<void> => {
  try {
    const response = await fetch(content.audio!.url!);
    const blob = await response.blob();

    const audioData = {
      blob,
      fileName:
        content.audio!.name || `audio.${content.audio!.extension || 'ogg'}`,
      mimeType: content.audio!.mimetype || 'audio/ogg',
    };

    const formData = createAudioFormData(
      audioData,
      content.audio!.view_once ?? false,
      content.audio!.duration ?? null,
      hash,
      content.audio!.ptt ?? false
    );

    chatStore.updateLocalMessageProgress(hash, 0);
    const success = await chatStore.createMessageWithAudios(formData, {
      skipLoading: true,
      onUploadProgress: (progress) => {
        markUploadProgress(hash, progress);
      },
    });

    if (!success) {
      markUploadError(hash);
    }
  } catch (error) {
    markUploadError(hash);
  }
};

const retryDocumentMessage = async (
  content: NonNullable<ListMessageResult['content']>,
  hash: string
): Promise<void> => {
  try {
    const response = await fetch(content.document!.url!);
    const blob = await response.blob();
    const file = new File(
      [blob],
      content.document!.name ||
        `document.${content.document!.extension || 'pdf'}`,
      {
        type: content.document!.mimetype || 'application/pdf',
      }
    );

    const doc = {
      file,
      name: content.document!.name || file.name,
      type: content.document!.mimetype || 'application/pdf',
      size: content.document!.size || file.size,
      extension: content.document!.extension || 'pdf',
    };

    const replyId = content.message_quoted_id ?? null;
    const formData = createDocumentFormData(
      doc,
      content.message ?? null,
      replyId,
      hash
    );

    chatStore.updateLocalMessageProgress(hash, 0);
    const success = await chatStore.createMessageWithDocuments(formData, {
      skipLoading: true,
      onUploadProgress: (progress) => {
        markUploadProgress(hash, progress);
      },
    });

    if (!success) {
      markUploadError(hash);
    }
  } catch (error) {
    markUploadError(hash);
  }
};

const retryContactMessage = async (
  content: NonNullable<ListMessageResult['content']>,
  hash: string
): Promise<void> => {
  if (!chatStore.activeChat?.chat_id) {
    markUploadError(hash);
    return;
  }

  if (!content.contact?.contact_id) {
    markUploadError(hash);
    return;
  }

  const replyId = content.message_quoted_id ?? null;
  const messageValue = content.message ?? null;

  const formData = new FormData();
  formData.append('type', EMessageType.contact_card);
  if (messageValue) {
    formData.append('message', messageValue);
  }
  if (replyId) {
    formData.append('message_quoted_id', replyId);
  }
  formData.append('contacts', content.contact.contact_id);
  formData.append('hash', hash);

  const success = await chatStore.createMessageWithContacts(formData, {
    skipLoading: true,
  });

  if (!success) {
    markUploadError(hash);
  }
};

const onRetryMessage = async (e: Event) => {
  const { message } = (e as CustomEvent<{ message: ListMessageResult }>).detail;
  if (!message?.hash) return;

  const content = message.content;
  if (!content) return;

  const hash = message.hash;
  chatStore.clearLocalMessageState(hash);

  if (content.type === EMessageType.text) {
    await retryTextMessage(content, hash);
    return;
  }

  if (content.type === EMessageType.image && content.image?.url) {
    await retryImageMessage(content, hash);
    return;
  }

  if (content.type === EMessageType.video && content.video?.url) {
    await retryVideoMessage(content, hash);
    return;
  }

  if (content.type === EMessageType.audio && content.audio?.url) {
    await retryAudioMessage(content, hash);
    return;
  }

  if (content.type === EMessageType.document && content.document?.url) {
    await retryDocumentMessage(content, hash);
    return;
  }

  if (
    content.type === EMessageType.contact_card &&
    content.contact?.contact_id
  ) {
    await retryContactMessage(content, hash);
  }
};

const TYPING_TIMEOUT_MS = 5000;

const resolveTypingMode = (
  typingData: IChatTyping
): RemoteActivityMode | null => {
  if (
    typingData.typing_state === 'typing' ||
    typingData.typing_state === 'recording'
  ) {
    return typingData.typing_state;
  }

  if (typingData.typing_state === 'available') {
    return null;
  }

  if (typingData.is_recording === true) {
    return 'recording';
  }

  if (typingData.is_typing === true) {
    return 'typing';
  }

  return null;
};

const clearTypingTimeout = (chatId?: string) => {
  if (chatId) {
    const timeout = typingTimeouts.value.get(chatId);
    if (timeout) {
      clearTimeout(timeout);
      typingTimeouts.value.delete(chatId);
    }
    return;
  }

  for (const timeout of typingTimeouts.value.values()) {
    clearTimeout(timeout);
  }
  typingTimeouts.value.clear();
};

const setTypingState = (chatId: string, mode: RemoteActivityMode | null) => {
  clearTypingTimeout(chatId);

  if (!mode) {
    typingStates.value.delete(chatId);
    return;
  }

  const now = Date.now();
  typingStates.value.set(chatId, { mode, timestamp: now });

  const timeout = setTimeout(() => {
    typingStates.value.delete(chatId);
    typingTimeouts.value.delete(chatId);
  }, TYPING_TIMEOUT_MS);
  typingTimeouts.value.set(chatId, timeout);
};

const getTypingState = (chatId: string): RemoteActivityMode | null => {
  const state = typingStates.value.get(chatId);
  if (!state) {
    return null;
  }

  const elapsed = Date.now() - state.timestamp;
  if (elapsed >= TYPING_TIMEOUT_MS) {
    typingStates.value.delete(chatId);
    clearTypingTimeout(chatId);
    return null;
  }

  return state.mode;
};

const activeTypingMode = computed<RemoteActivityMode | null>(() => {
  const activeChatId = chatStore.activeChat?.chat_id;
  if (!activeChatId) {
    return null;
  }

  return getTypingState(activeChatId);
});

const isTyping = computed(() => activeTypingMode.value !== null);
const typingIndicatorIcon = computed(() =>
  activeTypingMode.value === 'recording' ? 'tabler-microphone' : 'tabler-pencil'
);
const typingIndicatorText = computed(() =>
  activeTypingMode.value === 'recording'
    ? t('is_recording_audio')
    : t('is_typing')
);

const checkJidMatches = (
  eventJid: string,
  messages: ListMessageResult[]
): boolean => {
  for (const message of messages) {
    const messageJid = message.message_key?.remote_jid;
    const messageJidAlt = message.message_key?.remote_jid_alt;

    if (messageJid === eventJid || messageJidAlt === eventJid) {
      return true;
    }
  }

  const normalizedEventJid = eventJid.replace('@lid', '@s.whatsapp.net');

  for (const message of messages) {
    const messageJid = message.message_key?.remote_jid;
    const messageJidAlt = message.message_key?.remote_jid_alt;

    if (
      messageJid === normalizedEventJid ||
      messageJidAlt === normalizedEventJid
    ) {
      return true;
    }
  }

  return false;
};

const handleTypingEvent = (data: IChatTyping | IChatMessage) => {
  if ('message_id' in data) {
    const chatId = data.chat_id;
    if (chatId) {
      setTypingState(chatId, null);
    }
    return;
  }

  if (data.type !== 'typing') {
    return;
  }

  const typingData = data as IChatTyping;
  const activeChat = chatStore.activeChat;

  if (!activeChat) {
    return;
  }

  const eventJid = typingData.jid;
  const messages = chatStore.listMessages;

  if (!checkJidMatches(eventJid, messages)) {
    return;
  }

  setTypingState(activeChat.chat_id, resolveTypingMode(typingData));
};

const handleGlobalMessage = (e: Event) => {
  const messageData = (e as CustomEvent<IChatMessage>).detail;
  if (chatStore.activeChat?.chat_id !== messageData.chat_id) {
    return;
  }

  handleTypingEvent(messageData);

  const changeType = chatStore.addMessageActiveChat(messageData);

  if (changeType === 'created') {
    nextTick(async () => {
      await scrollToBottomInChatLog();
    });
    globalThis.dispatchEvent(new CustomEvent('focus-composer'));
  }
};

const handleGlobalTyping = (e: Event) => {
  const typingData = (e as CustomEvent<IChatTyping>).detail;
  handleTypingEvent(typingData);
};

const handleGlobalChatUpdate = async (e: Event) => {
  const chatData = (e as CustomEvent<IChat>).detail;
  const permissions = getPermissions();
  const canListAllChatsWithoutSectorLimit = permissions.some(
    (perm: EPermissionsRoles) =>
      perm === EGeneralPermissions.full_access ||
      perm === EGeneralPermissions.full_access_group ||
      perm === EChatPermissions.chat_group ||
      perm === EChatPermissions.list_all_chats_without_sector_limit
  );
  const canViewChatbotInputMessages = permissions.some(
    (perm: EPermissionsRoles) =>
      perm === EGeneralPermissions.full_access ||
      perm === EGeneralPermissions.full_access_group ||
      perm === EChatPermissions.chat_group ||
      perm === EChatPermissions.view_chatbot_messages ||
      perm === EChatbotPermissions.chatbot_group ||
      perm === EChatbotPermissions.chatbot_access
  );

  const userSectors: string[] = canListAllChatsWithoutSectorLimit
    ? []
    : getSectors();

  const canReceiveChatNotification = (chat: IChat): boolean => {
    if (canListAllChatsWithoutSectorLimit) {
      return true;
    }

    const chatExistsInList =
      chatStore.listQueue.some((c) => c.chat_id === chat.chat_id) ||
      chatStore.listInChat.some((c) => c.chat_id === chat.chat_id);

    if (chatExistsInList) {
      return true;
    }

    if (isChatParticipant(chat, chatStore.user?.user_id)) {
      return true;
    }

    if (chat.status === EChatStatus.ura && canViewChatbotInputMessages) {
      return true;
    }

    if (
      chat.status === EChatStatus.queue &&
      !chat.sector?.id &&
      !chat.user?.id &&
      (!Array.isArray(chat.secondary_users) ||
        chat.secondary_users.length === 0)
    ) {
      return true;
    }

    if (userSectors.length === 0) {
      return !chat.sector?.id;
    }

    if (!chat.sector?.id) {
      return false;
    }

    return userSectors.includes(chat.sector.id);
  };

  if (!canReceiveChatNotification(chatData)) {
    return;
  }

  chatStore.addChat(chatData);

  const isActiveChatForUser =
    (chatData as any)._active &&
    isChatParticipant(chatData, chatStore.user?.user_id);

  if (isActiveChatForUser) {
    const previousActiveChatId = chatStore.activeChat?.chat_id;

    if (previousActiveChatId !== chatData.chat_id) {
      chatStore.listMessages = [];
      chatStore.currentPage = 1;
      chatStore.totalPages = 1;
      currentPage.value = 1;
    }

    chatStore.setActiveChat(chatData.chat_id);

    if (chatStore.activeChat?.chat_id === chatData.chat_id) {
      const requestQueue: ListMessageChatsQuery = {
        current_page: 1,
        per_page: perPage.value,
      };
      await chatStore.getChatById(requestQueue);

      await nextTick();
      requestAnimationFrame(() => {
        scrollToBottomInChatLog();
      });
    }
  }
};

onMounted(async () => {
  const routeChatId = resolveRouteChatId();
  if (routeChatId) {
    await openChat(routeChatId, {
      skipClearSummary: true,
      forceReload: true,
    });
  } else {
    await chatSocket.refreshActiveChat();
  }

  globalThis.addEventListener('chat-message', handleGlobalMessage);
  globalThis.addEventListener('chat-typing', handleGlobalTyping);
  globalThis.addEventListener('chat-update', handleGlobalChatUpdate);

  globalThis.addEventListener('focus-composer', focusComposer);
  globalThis.addEventListener(
    'scroll-to-message',
    onScrollToMessageEvt as EventListener
  );
  globalThis.addEventListener('retry-message', onRetryMessage as EventListener);
  globalThis.addEventListener(
    'open-add-contact-modal',
    onOpenAddContactModal as EventListener
  );
  globalThis.addEventListener(
    'open-edit-contact-modal',
    onOpenEditContactModal as EventListener
  );
  globalThis.addEventListener(
    'send-template-button',
    onSendTemplateButton as EventListener
  );
  globalThis.addEventListener(
    'open-ai-reply-modal',
    onOpenAiReplyModal as EventListener
  );
  globalThis.addEventListener(
    'open-transcribe-modal',
    onOpenTranscribeModal as EventListener
  );

  const handleResize = () => {
    requestAnimationFrame(() => {
      hideScrollbarIfNotNeeded();
    });
  };
  window.addEventListener('resize', handleResize);
  resizeHandler.value = handleResize;
});

onUnmounted(async () => {
  clearTypingTimeout();

  globalThis.removeEventListener('chat-message', handleGlobalMessage);
  globalThis.removeEventListener('chat-typing', handleGlobalTyping);
  globalThis.removeEventListener('chat-update', handleGlobalChatUpdate);

  globalThis.removeEventListener('focus-composer', focusComposer);
  globalThis.removeEventListener(
    'scroll-to-message',
    onScrollToMessageEvt as EventListener
  );
  globalThis.removeEventListener(
    'retry-message',
    onRetryMessage as EventListener
  );
  globalThis.removeEventListener(
    'open-add-contact-modal',
    onOpenAddContactModal as EventListener
  );
  globalThis.removeEventListener(
    'open-edit-contact-modal',
    onOpenEditContactModal as EventListener
  );
  globalThis.removeEventListener(
    'send-template-button',
    onSendTemplateButton as EventListener
  );
  globalThis.removeEventListener(
    'open-ai-reply-modal',
    onOpenAiReplyModal as EventListener
  );
  globalThis.removeEventListener(
    'open-transcribe-modal',
    onOpenTranscribeModal as EventListener
  );

  if (resizeHandler.value) {
    window.removeEventListener('resize', resizeHandler.value);
    resizeHandler.value = null;
  }

  for (const timeoutId of highlightedMessageTimers.values()) {
    clearTimeout(timeoutId);
  }
  highlightedMessageTimers.clear();

  const highlightedElements = document.querySelectorAll(
    '.message-target-persistent'
  );

  for (const el of highlightedElements) {
    el.classList.remove('message-target-persistent');
    const chatContent = el.querySelector('.chat-content');
    if (chatContent) {
      chatContent.classList.remove('message-target-persistent-content');
    }
  }
});

onBeforeUnmount(() => {
  shouldPersistRecording.value = false;
  cancelAudioRecording();
  if (recordedAudioUrl.value) {
    URL.revokeObjectURL(recordedAudioUrl.value);
    recordedAudioUrl.value = null;
  }
});
</script>

<template>
  <VLayout class="chat-app-layout" style="z-index: 0">
    <VNavigationDrawer
      v-model="isUserProfileSidebarOpen"
      data-allow-mismatch
      temporary
      touchless
      absolute
      class="user-profile-sidebar"
      location="start"
      width="370"
      :persistent="isUpdatingUserProfileStatus"
    >
      <ChatUserProfileSidebarContent
        @close="isUserProfileSidebarOpen = false"
        @update:is-updating="isUpdatingUserProfileStatus = $event"
      />
    </VNavigationDrawer>

    <VNavigationDrawer
      v-model="isActiveChatUserProfileSidebarOpen"
      data-allow-mismatch
      width="374"
      absolute
      temporary
      location="end"
      touchless
      class="active-chat-user-profile-sidebar"
    >
      <ChatActiveChatUserProfileSidebarContent
        :is-open="isActiveChatUserProfileSidebarOpen"
        @close="isActiveChatUserProfileSidebarOpen = false"
      />
    </VNavigationDrawer>

    <VNavigationDrawer
      v-model="isSearchSidebarOpen"
      data-allow-mismatch
      width="374"
      absolute
      temporary
      location="end"
      touchless
      class="chat-search-sidebar"
    >
      <ChatSearchSidebarContent @close="isSearchSidebarOpen = false" />
    </VNavigationDrawer>

    <VNavigationDrawer
      v-model="isAttendanceHistorySidebarOpen"
      data-allow-mismatch
      width="374"
      absolute
      temporary
      location="end"
      touchless
      class="chat-attendance-history-sidebar"
    >
      <ChatAttendanceHistorySidebarContent
        :is-open="isAttendanceHistorySidebarOpen"
        @close="isAttendanceHistorySidebarOpen = false"
      />
    </VNavigationDrawer>

    <VNavigationDrawer
      v-model="isLeftSidebarOpen"
      data-allow-mismatch
      absolute
      touchless
      location="start"
      width="370"
      :temporary="$vuetify.display.smAndDown"
      class="chat-list-sidebar"
      :permanent="$vuetify.display.mdAndUp"
    >
      <ChatLeftSidebarContent
        ref="leftSidebarRef"
        v-model:is-drawer-open="isLeftSidebarOpen"
        v-model:search="q"
        @open-chat="openChat"
        @show-user-profile="isUserProfileSidebarOpen = true"
        @close="isLeftSidebarOpen = false"
      />
    </VNavigationDrawer>

    <VMain class="chat-content-container">
      <div v-if="chatStore.activeChat" class="d-flex flex-column h-100">
        <div
          class="active-chat-header d-flex align-center text-medium-emphasis bg-surface"
        >
          <IconBtn class="d-md-none me-1" @click="isLeftSidebarOpen = true">
            <VIcon icon="tabler-menu-2" />
          </IconBtn>

          <IconBtn
            v-if="canShowCloseButton"
            class="me-2"
            color="error"
            variant="text"
            :title="t('close_service')"
            @click="handleCloseService"
          >
            <VIcon icon="tabler-x" />
          </IconBtn>

          <div
            class="d-flex align-center cursor-pointer active-chat-contact-info"
            @click="handleActiveChatHeaderClick"
          >
            <VAvatar
              size="40"
              :variant="
                !(
                  chatStore.activeChat.contact?.photo ??
                  chatStore.activeChat.photo
                )
                  ? 'tonal'
                  : undefined
              "
              class="cursor-pointer"
            >
              <VImg
                v-if="
                  chatStore.activeChat.contact?.photo ??
                  chatStore.activeChat.photo
                "
                :src="
                  chatStore.activeChat.contact?.photo ??
                  chatStore.activeChat.photo ??
                  ''
                "
                :alt="
                  chatStore.activeChat.contact?.name ??
                  chatStore.activeChat.name ??
                  ''
                "
              />
              <VImg
                v-else
                :src="'/images/svg/avatar-default.svg'"
                :alt="
                  chatStore.activeChat.contact?.name ??
                  chatStore.activeChat.name ??
                  ''
                "
              />
            </VAvatar>

            <div class="flex-grow-1 ms-4 overflow-hidden active-chat-details">
              <div class="d-flex align-center gap-2 mb-0 active-chat-name-row">
                <div class="text-h6 mb-0 font-weight-regular text-truncate">
                  {{
                    chatStore.activeChat.contact?.name ??
                    chatStore.activeChat.name
                  }}
                </div>
                <VChip
                  v-if="chatStore.activeChat.contact?.name"
                  size="x-small"
                  variant="tonal"
                  color="primary"
                  class="contact-label d-none d-sm-inline-flex"
                >
                  {{ $t('contact_label') }}
                </VChip>
                <div
                  v-if="activeContactLabelTemplate"
                  class="d-none d-sm-flex align-center contact-labels-group"
                >
                  <VChip
                    size="x-small"
                    variant="outlined"
                    :color="activeContactLabelTemplate.color"
                    class="contact-label"
                    :class="{
                      'contact-label--with-count':
                        activeContactLabelTemplates.length > 1,
                    }"
                    :title="activeContactLabelTemplate.label"
                  >
                    {{
                      activeContactLabelTemplate.label.length > 15
                        ? `${activeContactLabelTemplate.label.slice(0, 15)}…`
                        : activeContactLabelTemplate.label
                    }}
                  </VChip>
                  <span
                    v-if="activeContactLabelTemplates.length > 1"
                    class="contact-label-count-wrapper"
                  >
                    <VTooltip
                      v-if="remainingContactLabelsText"
                      location="top"
                      transition="scale-transition"
                      activator="parent"
                    >
                      <span>{{ remainingContactLabelsText }}</span>
                    </VTooltip>
                    <VChip
                      class="contact-label-count"
                      size="x-small"
                      variant="outlined"
                      :color="activeContactLabelTemplate.color"
                    >
                      +{{ activeContactLabelTemplates.length - 1 }}
                    </VChip>
                  </span>
                </div>
              </div>
              <div class="d-flex align-center gap-2">
                <p class="text-truncate mb-0 text-body-2">
                  {{ activeChatHeaderPhone }}
                </p>
                <VIcon
                  v-if="chatStore.activeChat.contact?.id"
                  :icon="
                    isHeaderPhoneDecrypted ? 'tabler-eye-off' : 'tabler-eye'
                  "
                  class="cursor-pointer flex-shrink-0"
                  :class="{ 'opacity-50': isHeaderPhoneLoading }"
                  @click.stop="toggleHeaderPhoneVisibility"
                />
              </div>
              <!-- Protocol badge inline (mobile only) -->
              <ChatProtocolBadgeDialog
                v-if="showProtocolInChat"
                class="d-sm-none active-chat-protocol-mobile"
                @click.stop
                :chat="chatStore.activeChat"
                :contact-name="
                  chatStore.activeChat.contact?.name ??
                  chatStore.activeChat.name ??
                  ''
                "
                @copied="
                  chatStore.showSnackbar(t('protocol_copied'), EColor.success)
                "
                @copy-error="
                  (msg) =>
                    chatStore.showSnackbar(
                      msg || t('error_copying_protocol'),
                      EColor.error
                    )
                "
              />
            </div>
          </div>

          <!-- Protocol badge (desktop/tablet) -->
          <ChatProtocolBadgeDialog
            v-if="showProtocolInChat"
            class="d-none d-sm-flex"
            :chat="chatStore.activeChat"
            :contact-name="
              chatStore.activeChat.contact?.name ??
              chatStore.activeChat.name ??
              ''
            "
            @copied="
              chatStore.showSnackbar(t('protocol_copied'), EColor.success)
            "
            @copy-error="
              (msg) =>
                chatStore.showSnackbar(
                  msg || t('error_copying_protocol'),
                  EColor.error
                )
            "
          />

          <VSpacer />

          <div class="d-sm-flex align-center d-none text-medium-emphasis">
            <div
              v-if="isInChatStatus && activeChatLabelTemplate"
              :key="activeChatLabelTemplate.label"
              class="d-flex align-center me-2 chat-labels-group"
            >
              <VChip
                class="chat-label-chip"
                :class="{
                  'chat-label-chip--with-count':
                    activeChatLabelTemplates.length > 1,
                }"
                size="small"
                variant="flat"
                :color="activeChatLabelTemplate.color"
                text-color="white"
                closable
                @click="openLabelModal"
                @click:close.stop="removeLabel"
                :title="activeChatLabelTemplate.label"
              >
                <VIcon icon="tabler-tag" start size="16" />
                {{
                  activeChatLabelTemplate.label.length > 15
                    ? `${activeChatLabelTemplate.label.slice(0, 15)}…`
                    : activeChatLabelTemplate.label
                }}
              </VChip>
              <span
                v-if="activeChatLabelTemplates.length > 1"
                class="chat-label-count-wrapper"
              >
                <VTooltip
                  v-if="remainingChatLabelsText"
                  location="top"
                  transition="scale-transition"
                  activator="parent"
                >
                  <span>{{ remainingChatLabelsText }}</span>
                </VTooltip>
                <VChip
                  class="chat-label-count"
                  size="small"
                  variant="flat"
                  :color="activeChatLabelTemplate.color"
                  text-color="white"
                >
                  +{{ activeChatLabelTemplates.length - 1 }}
                </VChip>
              </span>
            </div>
            <IconBtn
              v-else-if="isInChatStatus"
              class="me-1"
              @click="openLabelModal"
              :title="t('label')"
            >
              <VIcon icon="tabler-tag" />
            </IconBtn>
            <IconBtn
              v-if="
                (isInChatStatus || isQueueOrUraStatus) &&
                workerConfigForChat?.has_ura_output === true &&
                canToggleForwardToOutputChatbot
              "
              @click="handleToggleForwardToOutputChatbot"
              :title="t('forward_to_output_chatbot')"
            >
              <VIcon
                :icon="
                  isForwardToOutputChatbotActive
                    ? 'tabler-robot'
                    : 'tabler-robot-off'
                "
              />
            </IconBtn>
            <IconBtn
              v-if="canViewAttendanceHistory"
              @click="isAttendanceHistorySidebarOpen = true"
              :title="t('attendance_history')"
            >
              <VIcon icon="tabler-history" />
            </IconBtn>
            <IconBtn
              v-if="isInChatStatus && canTransfer"
              @click="isTransferModalOpen = true"
              :title="t('transfer')"
            >
              <VIcon icon="tabler-arrows-right-left" />
            </IconBtn>
            <IconBtn @click="isSearchSidebarOpen = true">
              <VIcon icon="tabler-search" />
            </IconBtn>
            <VMenu
              v-if="canShowHeaderActionsMenu"
              offset="8"
              :close-on-content-click="true"
              location="bottom end"
            >
              <template #activator="{ props }">
                <IconBtn v-bind="props">
                  <VIcon icon="tabler-dots-vertical" />
                </IconBtn>
              </template>

              <VList density="comfortable" min-width="200">
                <VListItem
                  v-if="canShowAttendantsInfoAction"
                  @click="openAttendantsInfoDialog"
                >
                  <template #prepend>
                    <VIcon size="20" color="primary">tabler-users</VIcon>
                  </template>
                  <VListItemTitle class="font-weight-medium">
                    {{ t('attendants_info') }}
                  </VListItemTitle>
                </VListItem>

                <VDivider
                  v-if="
                    canShowAttendantsInfoAction &&
                    (canShowLeaveConversationAction || canShowCloseButton)
                  "
                />

                <VListItem
                  v-if="canShowLeaveConversationAction"
                  @click="handleLeaveConversation"
                >
                  <template #prepend>
                    <VIcon size="20" color="error">tabler-logout</VIcon>
                  </template>
                  <VListItemTitle>{{ t('leave_conversation') }}</VListItemTitle>
                </VListItem>

                <VListItem
                  v-if="canShowCloseButton"
                  @click="handleCloseService"
                >
                  <template #prepend>
                    <VIcon size="20" color="error">tabler-x</VIcon>
                  </template>
                  <VListItemTitle>{{ t('close_service') }}</VListItemTitle>
                </VListItem>
              </VList>
            </VMenu>
          </div>
        </div>

        <VDivider />

        <PerfectScrollbar
          ref="chatLogPS"
          tag="ul"
          :options="{ wheelPropagation: false }"
          class="flex-grow-1"
        >
          <ChatLog :key="chatStore.activeChat?.chat_id || 'no-chat'" />
        </PerfectScrollbar>

        <ChatLinkPreview
          :preview="linkPreview"
          :loading="isLoadingLinkPreview && hasUrlInMessage"
          @close="
            linkPreview = null;
            isLoadingLinkPreview = false;
          "
        />

        <VForm
          class="chat-log-message-form mb-5 mx-5"
          @submit.prevent="sendMessage"
        >
          <Transition name="fade">
            <div
              v-if="isTyping && chatStore.activeChat"
              class="typing-indicator d-flex align-center gap-2 mb-2"
            >
              <VIcon size="20" color="primary" :icon="typingIndicatorIcon" />
              <span
                class="text-primary"
                style="font-style: italic; font-size: 0.8rem; font-weight: 400"
              >
                {{
                  chatStore.activeChat.contact?.name ??
                  chatStore.activeChat.name ??
                  (chatStore.activeChat.contact?.phone_ddi &&
                  chatStore.activeChat.contact?.phone
                    ? `+${chatStore.activeChat.contact.phone_ddi} ${chatStore.activeChat.contact.phone}`
                    : chatStore.activeChat.contact?.phone) ??
                  chatStore.activeChat.phone
                }}
                {{ typingIndicatorText }}
              </span>
            </div>
          </Transition>

          <ReplyPreview v-if="chatStore.messageReply" />

          <Transition name="fade">
            <div
              v-if="selectedDocuments.length > 0"
              class="composer-attachment mt-3"
            >
              <VCard class="composer-attachment-card">
                <VCardTitle class="d-flex align-center justify-space-between">
                  <span
                    >{{ t('documents_selected') }} (
                    {{ selectedDocuments.length }}/10 )</span
                  >
                  <VBtn
                    icon
                    size="24"
                    variant="text"
                    @click="selectedDocuments = []"
                  >
                    <VIcon size="18" icon="tabler-x" />
                  </VBtn>
                </VCardTitle>
                <VCardText>
                  <div class="document-preview-list">
                    <div
                      v-for="(doc, index) in selectedDocuments"
                      :key="`${doc.name}-${index}`"
                      class="document-preview-item d-flex align-center justify-space-between px-3 py-2"
                    >
                      <div class="d-flex align-center gap-3 overflow-hidden">
                        <VIcon
                          :icon="resolveDocumentIcon(doc.extension, doc.type)"
                          size="28"
                          color="primary"
                        />
                        <div class="d-flex flex-column overflow-hidden">
                          <VTooltip location="bottom">
                            <template #activator="{ props }">
                              <span
                                v-bind="props"
                                class="text-body-2 fw-medium document-preview-name"
                              >
                                {{ truncateFileName(doc.name) }}
                              </span>
                            </template>
                            <span>{{ doc.name }}</span>
                          </VTooltip>
                          <span class="text-caption text-disabled">
                            {{ formatFileSize(doc.size) }}
                          </span>
                        </div>
                      </div>
                      <VBtn
                        icon
                        size="20"
                        variant="flat"
                        color="error"
                        @click="removeDocument(index)"
                      >
                        <VIcon size="14" icon="tabler-x" />
                      </VBtn>
                    </div>
                  </div>
                </VCardText>
              </VCard>
            </div>
          </Transition>

          <Transition name="fade">
            <div
              v-if="selectedVideos.length > 0"
              class="composer-attachment mt-3"
            >
              <VCard class="composer-attachment-card">
                <VCardTitle class="d-flex align-center justify-space-between">
                  <span
                    >{{ t('videos_selected') }} ({{
                      selectedVideos.length
                    }}/10)</span
                  >
                  <VBtn
                    icon
                    size="24"
                    variant="text"
                    @click="clearSelectedVideos()"
                  >
                    <VIcon size="18" icon="tabler-x" />
                  </VBtn>
                </VCardTitle>
                <VCardText>
                  <div class="attachment-grid attachment-grid--videos">
                    <div
                      v-for="(video, index) in selectedVideos"
                      :key="`${video.name}-${index}`"
                      class="video-preview-wrapper"
                    >
                      <div class="video-preview-container">
                        <video
                          :src="video.preview"
                          class="video-preview"
                          preload="metadata"
                          muted
                          playsinline
                          @click="openPreviewVideo(video)"
                        >
                          <track kind="captions" />
                        </video>
                        <div
                          class="video-preview-play-overlay"
                          @click="openPreviewVideo(video)"
                        >
                          <VIcon size="24">tabler-player-play</VIcon>
                        </div>
                      </div>
                      <div class="video-preview-meta">
                        <VTooltip location="bottom">
                          <template #activator="{ props }">
                            <span v-bind="props" class="video-preview-name">
                              {{ truncateFileName(video.name) }}
                            </span>
                          </template>
                          <span>{{ video.name }}</span>
                        </VTooltip>
                        <span
                          class="video-preview-info text-caption text-disabled"
                        >
                          {{
                            (video.name.split('.').pop() || '').toUpperCase()
                          }}
                          •
                          {{ formatFileSize(video.size) }}
                        </span>
                      </div>
                      <VBtn
                        icon
                        size="20"
                        variant="flat"
                        color="error"
                        class="video-preview-remove"
                        @click.stop="removeVideo(index)"
                      >
                        <VIcon size="14" icon="tabler-x" />
                      </VBtn>
                    </div>
                  </div>
                </VCardText>
              </VCard>
            </div>
          </Transition>

          <Transition name="fade">
            <div
              v-if="selectedAudios.length > 0"
              class="composer-attachment mt-3"
            >
              <VCard class="composer-attachment-card">
                <VCardTitle class="d-flex align-center justify-space-between">
                  <span
                    >{{ t('audios_selected') }} ({{
                      selectedAudios.length
                    }}/10)</span
                  >
                  <VBtn
                    icon
                    size="24"
                    variant="text"
                    @click="clearSelectedAudios()"
                  >
                    <VIcon size="18" icon="tabler-x" />
                  </VBtn>
                </VCardTitle>
                <VCardText>
                  <div class="attachment-grid attachment-grid--audios">
                    <div
                      v-for="(audio, index) in selectedAudios"
                      :key="`${audio.name}-${index}`"
                      class="audio-preview-wrapper"
                    >
                      <div class="audio-preview-container">
                        <div
                          class="audio-preview-icon-wrapper"
                          @click="openPreviewAudio(audio)"
                        >
                          <VIcon size="32" color="primary"
                            >tabler-headphones</VIcon
                          >
                        </div>
                        <div
                          class="audio-preview-play-overlay"
                          @click="openPreviewAudio(audio)"
                        >
                          <VIcon size="24">tabler-player-play</VIcon>
                        </div>
                      </div>
                      <div class="audio-preview-meta">
                        <VTooltip location="bottom">
                          <template #activator="{ props }">
                            <span v-bind="props" class="audio-preview-name">
                              {{ truncateFileName(audio.name) }}
                            </span>
                          </template>
                          <span>{{ audio.name }}</span>
                        </VTooltip>
                        <span
                          class="audio-preview-info text-caption text-disabled"
                        >
                          {{
                            (audio.name.split('.').pop() || '').toUpperCase()
                          }}
                          •
                          {{ formatFileSize(audio.size) }}
                          <span v-if="audio.duration">
                            • {{ formatAudioModalTime(audio.duration) }}
                          </span>
                        </span>
                      </div>
                      <VBtn
                        icon
                        size="20"
                        variant="flat"
                        color="error"
                        class="audio-preview-remove"
                        @click.stop="removeAudio(index)"
                      >
                        <VIcon size="14" icon="tabler-x" />
                      </VBtn>
                    </div>
                  </div>
                </VCardText>
              </VCard>
            </div>
          </Transition>

          <Transition name="fade">
            <div
              v-if="selectedContacts.length > 0"
              class="composer-attachment mt-3"
            >
              <VCard class="composer-attachment-card">
                <VCardTitle class="d-flex align-center justify-space-between">
                  <span
                    >{{ t('contacts_selected') }} ({{
                      selectedContacts.length
                    }}/10)</span
                  >
                  <VBtn
                    icon
                    size="24"
                    variant="text"
                    @click="clearSelectedContacts()"
                  >
                    <VIcon size="18" icon="tabler-x" />
                  </VBtn>
                </VCardTitle>
                <VCardText>
                  <div class="attachment-grid">
                    <div
                      v-for="(contact, index) in selectedContacts"
                      :key="`${contact.contact_id}-${index}`"
                      class="contact-preview-wrapper"
                      @click="viewContact(contact.contact_id)"
                      style="cursor: pointer"
                    >
                      <div class="contact-preview-container">
                        <VAvatar
                          size="48"
                          :rounded="8"
                          :variant="contact.photo ? undefined : 'tonal'"
                        >
                          <VImg
                            v-if="contact.photo"
                            :src="contact.photo"
                            :alt="contact.name"
                          />
                          <VIcon
                            v-else
                            size="32"
                            color="primary"
                            icon="tabler-user"
                          />
                        </VAvatar>
                      </div>
                      <div class="contact-preview-meta">
                        <VTooltip location="bottom">
                          <template #activator="{ props }">
                            <span v-bind="props" class="contact-preview-name">
                              {{ contact.name }}
                              {{ contact.last_name || '' }}
                            </span>
                          </template>
                          <span
                            >{{ contact.name }}
                            {{ contact.last_name || '' }}</span
                          >
                        </VTooltip>
                        <span
                          class="contact-preview-info text-caption text-disabled"
                        >
                          <span v-if="contact.phone_partial">
                            {{ contact.phone_partial }}
                          </span>
                        </span>
                      </div>
                      <VBtn
                        icon
                        size="20"
                        variant="flat"
                        color="error"
                        class="contact-preview-remove"
                        @click.stop="removeContact(index)"
                      >
                        <VIcon size="14" icon="tabler-x" />
                      </VBtn>
                    </div>
                  </div>
                </VCardText>
              </VCard>
            </div>
          </Transition>

          <Transition name="fade">
            <div
              v-if="selectedPhotos.length > 0"
              class="composer-attachment mt-3"
            >
              <VCard class="composer-attachment-card">
                <VCardTitle class="d-flex align-center justify-space-between">
                  <span
                    >{{ t('images_selected') }} ({{
                      selectedPhotos.length
                    }}/10)</span
                  >
                  <VBtn
                    icon
                    size="24"
                    variant="text"
                    @click="selectedPhotos = []"
                  >
                    <VIcon size="18" icon="tabler-x" />
                  </VBtn>
                </VCardTitle>
                <VCardText>
                  <div class="attachment-grid">
                    <div
                      v-for="(photo, index) in selectedPhotos"
                      :key="index"
                      class="photo-preview-wrapper"
                    >
                      <VImg
                        :src="photo.preview"
                        cover
                        class="photo-preview-image"
                        @click="openPreviewImage(photo)"
                      />
                      <VBtn
                        icon
                        size="20"
                        variant="flat"
                        color="error"
                        class="photo-preview-remove"
                        @click.stop="selectedPhotos.splice(index, 1)"
                      >
                        <VIcon size="14" icon="tabler-x" />
                      </VBtn>
                    </div>
                  </div>
                </VCardText>
              </VCard>
            </div>
          </Transition>

          <div
            v-if="isRecordingAudio"
            class="audio-recording-inline whats-composer d-flex align-center gap-3 px-4"
          >
            <IconBtn
              class="record-action"
              aria-label="Cancelar gravação"
              @click="cancelAudioRecording"
            >
              <VIcon size="20">tabler-trash</VIcon>
            </IconBtn>

            <span
              class="recording-dot flex-shrink-0"
              :class="{ 'is-paused': isRecordingPaused }"
            ></span>

            <span class="audio-recording-clock flex-shrink-0">{{
              formattedRecordingTime
            }}</span>

            <div class="audio-recording-info flex-grow-1">
              <canvas
                ref="audioCanvasRef"
                class="audio-wave-canvas"
                height="32"
              ></canvas>
            </div>

            <IconBtn
              class="record-action flex-shrink-0"
              aria-label="Pausar ou retomar gravação"
              @click="togglePauseAudioRecording"
            >
              <VIcon size="20">
                {{
                  isRecordingPaused
                    ? 'tabler-player-play'
                    : 'tabler-player-pause'
                }}
              </VIcon>
            </IconBtn>

            <IconBtn
              class="record-action view-once-toggle flex-shrink-0"
              :class="{ 'is-active': audioViewOnce }"
              aria-label="Visualização única"
              @click="toggleViewOnceAudio"
            >
              <VIcon size="20">
                {{ audioViewOnce ? 'tabler-eye-off' : 'tabler-eye' }}
              </VIcon>
            </IconBtn>

            <VBtn
              class="record-send-btn flex-shrink-0"
              color="success"
              variant="flat"
              icon
              rounded="pill"
              aria-label="Enviar áudio gravado"
              @click="finalizeAudioRecording"
            >
              <VIcon size="20">tabler-send</VIcon>
            </VBtn>
          </div>

          <ChatQueueStatusBanner
            :is-queue-status="isQueueOrUraStatus"
            :is-closed-status="isClosedStatus"
            :show-join-button="canJoinConversation"
            :can-attend-chat="canAttendChat"
            :can-reopen-chat="canReopenChat"
            :can-reopen-chat-permission="canReopenChatPermission"
            :cannot-attend-due-to-status="cannotAttendDueToStatus"
            :cannot-attend-due-to-limit="cannotAttendDueToLimit"
            :worker-config-for-chat="workerConfigForChat"
            :loading="isLoadingWorkerConfig"
            :action-loading="queueBannerActionLoading"
            @attend="handleAttendChat"
            @reopen="handleReopenChat"
            @join="handleJoinConversation"
          />

          <VCard
            v-if="
              showQuickMessageList &&
              quickMessageTemplates.length > 0 &&
              !selectedQuickMessage
            "
            class="quick-message-list mb-2"
            style="max-height: 300px; overflow-y: auto"
          >
            <VList density="compact">
              <VListItem
                v-for="template in quickMessageTemplates"
                :key="template.message_template_id"
                @click="selectQuickMessage(template)"
                class="cursor-pointer"
              >
                <VListItemTitle>
                  <span class="font-weight-bold">/{{ template.command }}</span>
                  <span class="text-caption text-medium-emphasis ml-2">
                    {{ template.message.substring(0, 50)
                    }}{{ template.message.length > 50 ? '...' : '' }}
                  </span>
                </VListItemTitle>
              </VListItem>
            </VList>
          </VCard>

          <div
            v-if="selectedQuickMessage"
            class="quick-message-preview mb-2 position-relative"
            @click.self="cancelQuickMessage"
          >
            <VCard class="position-relative">
              <VBtn
                icon
                size="small"
                variant="text"
                class="position-absolute"
                style="top: 8px; right: 8px; z-index: 10"
                @click.stop="cancelQuickMessage"
              >
                <VIcon size="20">tabler-x</VIcon>
              </VBtn>
              <VCardText>
                <ChatQuickMessagePreview
                  :template="selectedQuickMessage"
                  :message-override="msg"
                />
              </VCardText>
            </VCard>
          </div>

          <div class="position-relative">
            <VTextarea
              v-if="!isRecordingAudio"
              ref="composerRef"
              :key="contact_id"
              v-model="msg"
              variant="solo"
              density="comfortable"
              class="chat-message-input whats-composer"
              :placeholder="$t('write_your_message')"
              :auto-grow="true"
              rows="1"
              :max-rows="8"
              :disabled="!canComposeInActiveChat"
              :readonly="hasSelectedAudios"
              @keydown.enter.exact.prevent="onSendText"
              @paste="handlePaste"
            >
              <template #prepend-inner>
                <VMenu
                  offset="8"
                  :close-on-content-click="true"
                  location="top start"
                  :disabled="!!selectedQuickMessage || !canComposeInActiveChat"
                >
                  <template #activator="{ props }">
                    <IconBtn
                      v-bind="props"
                      class="composer-btn"
                      aria-label="Anexar"
                      :disabled="
                        !!selectedQuickMessage || !canComposeInActiveChat
                      "
                    >
                      <VIcon size="22">tabler-plus</VIcon>
                    </IconBtn>
                  </template>

                  <VList
                    density="comfortable"
                    min-width="220"
                    class="attach-menu"
                  >
                    <VListItem
                      :disabled="!canComposeInActiveChat"
                      @click="openAttach('document')"
                    >
                      <template #prepend
                        ><VIcon size="20">tabler-file</VIcon></template
                      >
                      <VListItemTitle>Documentos</VListItemTitle>
                    </VListItem>
                    <VListItem
                      :disabled="!canComposeInActiveChat"
                      @click="openAttach('photo')"
                    >
                      <template #prepend
                        ><VIcon size="20">tabler-photo</VIcon></template
                      >
                      <VListItemTitle>Fotos</VListItemTitle>
                    </VListItem>
                    <VListItem
                      :disabled="!canComposeInActiveChat"
                      @click="openAttach('video')"
                    >
                      <template #prepend
                        ><VIcon size="20">tabler-video</VIcon></template
                      >
                      <VListItemTitle>Vídeos</VListItemTitle>
                    </VListItem>
                    <VListItem
                      :disabled="!canComposeInActiveChat"
                      @click="openAttach('audio')"
                    >
                      <template #prepend
                        ><VIcon size="20">tabler-headphones</VIcon></template
                      >
                      <VListItemTitle>Áudio</VListItemTitle>
                    </VListItem>
                    <VListItem
                      :disabled="!canComposeInActiveChat"
                      @click="openAttach('contact')"
                    >
                      <template #prepend
                        ><VIcon size="20">tabler-user</VIcon></template
                      >
                      <VListItemTitle>Contato</VListItemTitle>
                    </VListItem>
                    <VListItem
                      :disabled="!canComposeInActiveChat"
                      @click="openAttach('location')"
                    >
                      <template #prepend
                        ><VIcon size="20">tabler-map-pin</VIcon></template
                      >
                      <VListItemTitle>Localização</VListItemTitle>
                    </VListItem>
                    <VListItem
                      :disabled="!canComposeInActiveChat"
                      @click="openAttach('annotation')"
                    >
                      <template #prepend
                        ><VIcon size="20">tabler-note</VIcon></template
                      >
                      <VListItemTitle>{{ t('annotation') }}</VListItemTitle>
                    </VListItem>
                  </VList>
                </VMenu>

                <VMenu
                  v-model="isEmojiOpen"
                  location="top start"
                  :close-on-content-click="false"
                  offset="8"
                  :disabled="!!selectedQuickMessage || hasSelectedAudios"
                >
                  <template #activator="{ props }">
                    <IconBtn
                      v-bind="props"
                      class="composer-btn"
                      aria-label="Emoji"
                      :disabled="!!selectedQuickMessage || hasSelectedAudios"
                    >
                      <VIcon size="22">tabler-mood-smile</VIcon>
                    </IconBtn>
                  </template>

                  <div class="emoji-picker-wrap">
                    <Picker
                      :data="emojiIndex"
                      :per-line="8"
                      :show-preview="false"
                      :show-search="true"
                      :show-skin-tones="false"
                      @select="onEmojiSelect"
                    />
                  </div>
                </VMenu>
              </template>

              <template #append-inner>
                <div class="d-flex align-center gap-1">
                  <IconBtn
                    v-if="!hasAttachmentsOrContent && !selectedQuickMessage"
                    class="composer-btn mic-btn"
                    aria-label="Gravar áudio"
                    :disabled="!canComposeInActiveChat"
                    @click="onRecordAudio"
                  >
                    <VIcon size="22">tabler-microphone</VIcon>
                  </IconBtn>

                  <VBtn
                    v-if="hasAttachmentsOrContent && !selectedQuickMessage"
                    class="send-btn"
                    icon
                    color="success"
                    variant="flat"
                    rounded="pill"
                    aria-label="Enviar mensagem"
                    :disabled="!hasActiveChat() || !canComposeInActiveChat"
                    @click="onSendText"
                  >
                    <VIcon size="22">tabler-send</VIcon>
                  </VBtn>
                </div>
              </template>
            </VTextarea>

            <VBtn
              v-if="selectedQuickMessage"
              class="send-btn"
              icon
              color="success"
              variant="flat"
              rounded="pill"
              aria-label="Enviar mensagem"
              style="
                position: absolute;
                right: 8px;
                top: 50%;
                transform: translateY(-50%);
                z-index: 10;
              "
              :disabled="!canSendSelectedQuickMessage"
              @click="sendQuickMessage"
            >
              <VIcon size="22">tabler-send</VIcon>
            </VBtn>
          </div>

          <input
            ref="fileDocRef"
            type="file"
            hidden
            multiple
            @change="onPickDoc"
          />
          <input
            ref="filePhotoRef"
            type="file"
            hidden
            accept="image/jpeg,image/jpg,image/png,image/gif,.jpg,.jpeg,.png,.gif"
            multiple
            @change="onPickPhoto"
          />
          <input
            ref="fileVideoRef"
            type="file"
            hidden
            accept="video/mp4,video/avi,video/x-flv,video/x-matroska,video/quicktime,video/3gpp,.mp4,.avi,.flv,.mkv,.mov,.3gp"
            @change="onPickVideo"
          />
          <input
            ref="fileAudioRef"
            type="file"
            hidden
            accept="audio/mpeg,audio/mp3,audio/aac,audio/m4a,audio/x-m4a,audio/amr,audio/amr-wb,audio/ogg,audio/opus,.mp3,.aac,.m4a,.amr,.ogg,.opus"
            multiple
            @change="onPickAudio"
          />
        </VForm>
      </div>

      <div
        v-if="!chatStore.activeChat"
        class="d-flex h-100 align-center justify-center flex-column"
      >
        <VAvatar size="98" variant="tonal" color="primary" class="mb-4">
          <VIcon size="50" class="rounded-0" icon="tabler-message-2" />
        </VAvatar>
        <VBtn
          v-if="$vuetify.display.smAndDown"
          rounded="pill"
          @click="startConversation"
        >
          {{ $t('start_conversation') }}
        </VBtn>

        <p
          v-if="!$vuetify.display.smAndDown"
          style="max-inline-size: 40ch; text-wrap: balance"
          class="text-center text-disabled"
        >
          {{ $t('select_a_contact') }}
        </p>
      </div>
    </VMain>
  </VLayout>

  <AppContactPicker
    v-model="isContactPickerOpen"
    :existing-contacts="selectedContacts"
    @select="onContactsSelected"
  />

  <ChatLocationPicker
    v-model="isLocationPickerOpen"
    @confirm="
      (location) => {
        selectedLocation = location;
        sendLocationMessage();
        finalizeSend();
      }
    "
  />

  <ChatContactViewModal
    v-model="isContactViewModalOpen"
    :contact="selectedContactDetails"
  />

  <AppAddContactChat
    v-model="isAddContactModalOpen"
    :initial-data="addContactInitialData"
  />

  <AppEditContactChat
    v-model="isEditContactModalOpen"
    :contact-id="editContactId"
  />

  <ChatLabelModal v-model="isLabelModalOpen" />

  <AiReplyModal
    v-model="isAiReplyModalOpen"
    :message="aiReplyTargetMessage"
    @send="onAiReplySend"
  />

  <TranscribeModal
    v-model="isTranscribeModalOpen"
    :message="transcribeTargetMessage"
  />

  <VSnackbar
    v-model="chatStore.snackbar.status"
    transition="scroll-y-reverse-transition"
    location="top end"
    :color="chatStore.snackbar.color"
  >
    {{ chatStore.snackbar.message }}
  </VSnackbar>

  <ChatMediaViewer
    v-model="viewerOpen"
    :src="viewerSrc"
    :caption="viewerCaption"
    :download-name="viewerDownloadName"
    :kind="viewerKind"
    @download="downloadViewerMedia"
  />

  <VDialog
    v-model="audioModalOpen"
    max-width="500"
    scrim="rgba(0,0,0,.7)"
    :scrollable="false"
  >
    <VCard class="audio-modal-card">
      <VCardTitle class="d-flex align-center justify-space-between">
        <span class="text-truncate">{{ audioModalName }}</span>
        <VBtn icon size="24" variant="text" @click="closeAudioModal">
          <VIcon size="18" icon="tabler-x" />
        </VBtn>
      </VCardTitle>
      <VCardText>
        <div class="audio-modal-player">
          <audio
            ref="audioModalPlayer"
            :src="audioModalSrc"
            preload="metadata"
            style="display: none"
          />
          <div class="audio-modal-controls">
            <VBtn
              icon
              size="48"
              variant="flat"
              color="primary"
              class="audio-modal-play-btn"
              @click="toggleAudioModalPlay"
            >
              <VIcon size="24">
                {{
                  audioModalIsPlaying
                    ? 'tabler-player-pause'
                    : 'tabler-player-play'
                }}
              </VIcon>
            </VBtn>
            <div class="audio-modal-info">
              <div class="audio-modal-time">
                <span>{{ formatAudioModalTime(audioModalCurrentTime) }}</span>
                <span>/</span>
                <span>{{ formatAudioModalTime(audioModalDuration) }}</span>
              </div>
              <div class="audio-modal-progress-container">
                <div
                  class="audio-modal-progress-bar"
                  :style="{ width: `${audioModalProgress}%` }"
                ></div>
              </div>
            </div>
          </div>
        </div>
      </VCardText>
    </VCard>
  </VDialog>

  <VDialog
    v-model="isAttendantsInfoDialogOpen"
    max-width="520"
    class="v-dialog-sm"
  >
    <DialogCloseBtn @click="isAttendantsInfoDialogOpen = false" />

    <VCard :title="t('attendants_info')">
      <VCardText>
        <div v-if="isLoadingAttendantsInfo" class="attendants-info-loading">
          <VSkeletonLoader type="list-item-avatar-two-line" />
          <VSkeletonLoader type="list-item-avatar-two-line" />
        </div>

        <template v-else>
          <div
            v-if="attendantsPrimaryUser"
            class="attendants-info-primary d-flex align-center"
          >
            <VAvatar
              size="42"
              :variant="
                hasAttendantPhoto(attendantsPrimaryUser.photo)
                  ? undefined
                  : 'tonal'
              "
              class="me-3"
            >
              <VImg
                :src="resolveAttendantPhoto(attendantsPrimaryUser.photo)"
                :alt="attendantsPrimaryUser.name"
              />
            </VAvatar>
            <div class="attendants-info-main">
              <div class="d-flex align-center gap-2">
                <span class="font-weight-medium">{{
                  attendantsPrimaryUser.name
                }}</span>
                <VChip size="x-small" color="primary" variant="tonal">
                  {{ t('primary_attendant') }}
                </VChip>
              </div>
              <div class="text-body-2 text-medium-emphasis">
                {{ t('entered_at_label') }}:
                {{ formatAttendantEnteredAt(attendantsPrimaryUser.entered_at) }}
              </div>
            </div>
          </div>

          <div v-else class="text-body-2 text-medium-emphasis">
            {{ t('primary_attendant_not_available') }}
          </div>

          <VDivider class="my-4" />

          <div
            v-if="attendantsSecondaryUsers.length > 0"
            class="d-flex flex-column gap-3"
          >
            <div class="text-body-2 font-weight-medium">
              {{ t('secondary_attendants') }}
            </div>

            <div
              v-for="secondaryUser in attendantsSecondaryUsers"
              :key="secondaryUser.id"
              class="attendants-info-secondary d-flex align-center"
            >
              <VAvatar
                size="38"
                :variant="
                  hasAttendantPhoto(secondaryUser.photo) ? undefined : 'tonal'
                "
                class="me-3"
              >
                <VImg
                  :src="resolveAttendantPhoto(secondaryUser.photo)"
                  :alt="secondaryUser.name"
                />
              </VAvatar>
              <div class="attendants-info-main">
                <div class="font-weight-medium">{{ secondaryUser.name }}</div>
                <div class="text-body-2 text-medium-emphasis">
                  {{ t('entered_at_label') }}:
                  {{ formatAttendantEnteredAt(secondaryUser.entered_at) }}
                </div>
              </div>
            </div>
          </div>

          <div v-else class="text-body-2 text-medium-emphasis">
            {{ t('no_secondary_attendants') }}
          </div>
        </template>
      </VCardText>

      <VCardText class="d-flex justify-end">
        <VBtn
          color="secondary"
          variant="tonal"
          @click="isAttendantsInfoDialogOpen = false"
        >
          {{ t('close') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>

  <VDialog v-model="isCloseServiceDialogOpen" persistent class="v-dialog-sm">
    <DialogCloseBtn @click="isCloseServiceDialogOpen = false" />

    <VCard :title="t('close_service')">
      <VCardText>{{ t('close_service_confirmation') }}</VCardText>

      <VCardText v-if="shouldShowCloseServiceSendMessageToggle">
        <div class="d-flex align-center justify-space-between gap-4">
          <div>
            <div class="text-body-1 font-weight-medium">
              {{ t('close_service_send_message_toggle_title') }}
            </div>
            <div class="text-body-2 text-medium-emphasis">
              {{ t('close_service_send_message_toggle_description') }}
            </div>
          </div>

          <VSwitch
            v-model="closeServiceSendMessageOnFinishAttendance"
            color="primary"
            hide-details
            inset
          />
        </div>
      </VCardText>

      <VCardText class="d-flex justify-end gap-3 flex-wrap">
        <VBtn
          color="secondary"
          variant="tonal"
          @click="isCloseServiceDialogOpen = false"
        >
          {{ t('cancel') }}
        </VBtn>
        <VBtn @click="confirmCloseService">
          {{ t('confirm') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>

  <VDialog
    v-model="isLeaveConversationDialogOpen"
    persistent
    class="v-dialog-sm"
  >
    <DialogCloseBtn @click="isLeaveConversationDialogOpen = false" />

    <VCard :title="t('leave_conversation')">
      <VCardText>{{ t('leave_conversation_confirmation') }}</VCardText>

      <VCardText class="d-flex justify-end gap-3 flex-wrap">
        <VBtn
          color="secondary"
          variant="tonal"
          @click="isLeaveConversationDialogOpen = false"
          :disabled="isLeaveConversationLoading"
        >
          {{ t('cancel') }}
        </VBtn>
        <VBtn
          color="error"
          :loading="isLeaveConversationLoading"
          :disabled="isLeaveConversationLoading"
          @click="confirmLeaveConversation"
        >
          {{ t('leave_conversation') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>

  <VDialog v-model="isTransferModalOpen" max-width="600">
    <DialogCloseBtn @click="isTransferModalOpen = false" />
    <VCard :title="$t('transfer')">
      <VCardText>
        <template
          v-if="
            isLoadingTransferChannels ||
            isLoadingTransferUsers ||
            isLoadingTransferSectors
          "
        >
          <VRow>
            <VCol cols="12">
              <VSkeletonLoader type="text" width="90" class="mb-2" />
              <VSkeletonLoader type="text" width="100%" height="40" />
            </VCol>
            <VCol cols="12">
              <VSkeletonLoader type="text" width="130" class="mb-2" />
              <VSkeletonLoader type="text" width="100%" height="40" />
            </VCol>
            <VCol cols="12">
              <div class="d-flex align-center mb-2">
                <VSkeletonLoader type="text" width="90" />
                <VSpacer />
                <VSkeletonLoader type="avatar" width="24" height="24" />
              </div>
              <VSkeletonLoader type="image" width="100%" height="160" />
              <VSkeletonLoader type="text" width="180" class="mt-2" />
            </VCol>
          </VRow>
        </template>
        <VRow v-else>
          <VCol cols="12">
            <VLabel class="text-body-2 mb-1">{{ $t('channel') }} *</VLabel>
            <AppSelectSearch
              v-model="selectedTransferChannel"
              :items="transferChannels"
              :placeholder="$t('select_channel')"
              item-value="value"
              item-title="title"
            />
            <div v-if="selectedTransferChannelOption" class="mt-2">
              <VChip
                size="small"
                color="primary"
                variant="tonal"
                class="channel-tag"
              >
                <VIcon size="16" class="me-1">tabler-device-mobile</VIcon>
                {{ selectedTransferChannelOption.name }}
                <span
                  v-if="selectedTransferChannelOption.number"
                  class="ms-1 text-caption"
                >
                  ({{ selectedTransferChannelOption.number }})
                </span>
              </VChip>
            </div>
          </VCol>

          <VCol cols="12">
            <VLabel class="text-body-2 mb-1">{{ $t('transfer_to') }}:</VLabel>
            <AppSelectSearch
              v-model="transferType"
              :items="[
                { value: 'user', title: $t('user') },
                { value: 'sector', title: $t('sector') },
              ]"
              :placeholder="$t('transfer_to_placeholder')"
              :clearable="true"
              :disabled="!selectedTransferChannel"
              item-value="value"
              item-title="title"
            />
          </VCol>

          <VCol cols="12">
            <VCheckbox
              v-model="transferKeepInChat"
              density="compact"
              hide-details
              :label="t('keep_in_chat')"
            />
            <div class="text-caption text-medium-emphasis mt-1">
              {{ t('keep_in_chat_description') }}
            </div>
          </VCol>

          <VCol v-if="shouldShowTransferSendMessageToggle" cols="12">
            <div class="d-flex align-center justify-space-between gap-4">
              <div>
                <div class="text-body-1 font-weight-medium">
                  {{ t('send_message_on_transfer') }}
                </div>
                <div class="text-body-2 text-medium-emphasis">
                  {{ t('send_message_on_transfer_description') }}
                </div>
              </div>

              <VSwitch
                v-model="transferSendMessageOnTransfer"
                color="primary"
                hide-details
                inset
              />
            </div>
          </VCol>

          <VCol v-if="transferType === 'user'" cols="12">
            <VLabel class="text-body-2 mb-1">{{ $t('user') }}:</VLabel>
            <AppSelectSearch
              v-model="selectedTransferUser"
              :items="transferUsers"
              :placeholder="$t('search') + '...'"
              :loading="isLoadingTransferUsers"
              :disabled="!selectedTransferChannel"
              item-value="value"
              item-title="title"
            >
              <template #item-prepend="{ item }">
                <VAvatar
                  size="32"
                  :variant="!item.photo ? 'tonal' : undefined"
                  color="primary"
                >
                  <VImg v-if="item.photo" :src="item.photo" :alt="item.title" />
                  <VIcon v-else icon="tabler-user" size="18" />
                </VAvatar>
              </template>
              <template #item-title="{ item }">
                <template
                  v-if="
                    transferWorkerConfigForChat?.allow_attendance_only_online &&
                    item.status
                  "
                >
                  <div class="d-flex align-center gap-2">
                    <span
                      class="v-badge v-badge--dot v-badge--inline"
                      :style="{
                        backgroundColor: getStatusColor(
                          (item.status as EChatUserStatus) ||
                            EChatUserStatus.offline
                        ),
                      }"
                      style="
                        width: 8px;
                        height: 8px;
                        border-radius: 50%;
                        display: inline-block;
                        margin-right: 8px;
                      "
                    ></span>
                    <span>{{ item.title }}</span>
                  </div>
                </template>
                <template v-else>
                  {{ item.title }}
                </template>
              </template>
            </AppSelectSearch>
          </VCol>

          <template v-if="transferType === 'sector'">
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('sector') }}:</VLabel>
              <AppSelectSearch
                v-model="selectedTransferSector"
                :items="transferSectors"
                :placeholder="$t('search') + '...'"
                :loading="isLoadingTransferSectors"
                :disabled="!selectedTransferChannel"
                item-value="value"
                item-title="title"
              >
                <template #item-prepend="{ item }">
                  <VAvatar
                    size="24"
                    :style="{
                      backgroundColor: item.color || '#1976D2',
                    }"
                  />
                </template>
              </AppSelectSearch>
            </VCol>

            <VCol v-if="selectedTransferSector" cols="12">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('user') }} ({{ $t('sector') }}):</VLabel
              >
              <AppSelectSearch
                v-model="selectedTransferSectorUser"
                :items="transferSectorUsers"
                :placeholder="$t('search') + '...'"
                :loading="isLoadingTransferSectorUsers"
                :disabled="!selectedTransferChannel"
                item-value="value"
                item-title="title"
              >
                <template #item-prepend="{ item }">
                  <VAvatar
                    size="32"
                    :variant="!item.photo ? 'tonal' : undefined"
                    color="primary"
                  >
                    <VImg
                      v-if="item.photo"
                      :src="item.photo"
                      :alt="item.title"
                    />
                    <VIcon v-else icon="tabler-user" size="18" />
                  </VAvatar>
                </template>
                <template #item-title="{ item }">
                  <template
                    v-if="
                      transferWorkerConfigForChat?.allow_attendance_only_online &&
                      item.status
                    "
                  >
                    <div class="d-flex align-center gap-2">
                      <span
                        class="v-badge v-badge--dot v-badge--inline"
                        :style="{
                          backgroundColor: getStatusColor(
                            (item.status as EChatUserStatus) ||
                              EChatUserStatus.offline
                          ),
                        }"
                        style="
                          width: 8px;
                          height: 8px;
                          border-radius: 50%;
                          display: inline-block;
                          margin-right: 8px;
                        "
                      ></span>
                      <span>{{ item.title }}</span>
                    </div>
                  </template>
                  <template v-else>
                    {{ item.title }}
                  </template>
                </template>
              </AppSelectSearch>
            </VCol>
          </template>

          <VCol cols="12">
            <div class="d-flex align-center gap-2 mb-2">
              <VLabel class="text-body-2">{{ $t('annotation') }}:</VLabel>
              <VSpacer />
              <VMenu
                v-model="isTransferAnnotationEmojiOpen"
                location="top end"
                :close-on-content-click="false"
                offset="8"
              >
                <template #activator="{ props }">
                  <IconBtn
                    v-bind="props"
                    size="small"
                    variant="text"
                    aria-label="Emoji"
                  >
                    <VIcon size="20">tabler-mood-smile</VIcon>
                  </IconBtn>
                </template>
                <div class="emoji-picker-wrap">
                  <Picker
                    :data="emojiIndex"
                    :per-line="8"
                    :show-preview="false"
                    :show-search="true"
                    :show-skin-tones="false"
                    @select="onTransferAnnotationEmojiSelect"
                  />
                </div>
              </VMenu>
            </div>
            <VTextarea
              id="transfer-annotation-textarea"
              v-model="transferAnnotationText"
              :placeholder="$t('write_your_annotation')"
              variant="outlined"
              :maxlength="5000"
              :rows="6"
              :auto-grow="true"
              :max-rows="10"
              counter
            />
            <div class="text-caption text-medium-emphasis mt-1">
              {{ $t('annotation_max_characters', { count: 5000 }) }}
            </div>
          </VCol>
        </VRow>
      </VCardText>
      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          @click="isTransferModalOpen = false"
        >
          {{ t('cancel') }}
        </VBtn>
        <VBtn
          color="primary"
          :disabled="
            !selectedTransferChannel ||
            (transferType === 'user'
              ? !selectedTransferUser
              : transferType === 'sector'
                ? !selectedTransferSector
                : false)
          "
          :loading="isTransferring"
          @click="handleTransfer"
        >
          {{ t('transfer') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>

  <VDialog v-model="isAnnotationModalOpen" max-width="600">
    <DialogCloseBtn @click="isAnnotationModalOpen = false" />
    <VCard :title="$t('annotation')">
      <VCardText>
        <VRow>
          <VCol cols="12">
            <div class="d-flex align-center gap-2 mb-2">
              <VLabel class="text-body-2">{{ $t('message') }}:</VLabel>
              <VSpacer />
              <VMenu
                v-model="isAnnotationEmojiOpen"
                location="top end"
                :close-on-content-click="false"
                offset="8"
              >
                <template #activator="{ props }">
                  <IconBtn
                    v-bind="props"
                    size="small"
                    variant="text"
                    aria-label="Emoji"
                  >
                    <VIcon size="20">tabler-mood-smile</VIcon>
                  </IconBtn>
                </template>
                <div class="emoji-picker-wrap">
                  <Picker
                    :data="emojiIndex"
                    :per-line="8"
                    :show-preview="false"
                    :show-search="true"
                    :show-skin-tones="false"
                    @select="onAnnotationEmojiSelect"
                  />
                </div>
              </VMenu>
            </div>
            <VTextarea
              id="annotation-textarea"
              v-model="annotationText"
              :placeholder="$t('write_your_annotation')"
              variant="outlined"
              :maxlength="5000"
              :rows="8"
              :auto-grow="true"
              :max-rows="12"
              counter
            />
            <div class="text-caption text-medium-emphasis mt-1">
              {{ $t('annotation_max_characters', { count: 5000 }) }}
            </div>
          </VCol>
        </VRow>
      </VCardText>
      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          @click="
            () => {
              isAnnotationModalOpen = false;
              annotationText = '';
            }
          "
        >
          {{ t('cancel') }}
        </VBtn>
        <VBtn
          color="primary"
          :disabled="!annotationText.trim()"
          @click="sendAnnotationMessage"
        >
          {{ t('save') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style lang="scss">
@use '@styles/variables/vuetify';
@use '@webcore/scss/base/mixins';
@use '@layouts/styles/mixins' as layoutsMixins;

$chat-app-header-height: 76px;

%chat-header {
  display: flex;
  align-items: center;
  min-block-size: $chat-app-header-height;
  padding-inline: 1.5rem;
}

.chat-start-conversation-btn {
  cursor: default;
}

.chat-app-layout {
  border-radius: vuetify.$card-border-radius;
  @include mixins.elevation(vuetify.$card-elevation);
  $sel-chat-app-layout: &;

  @at-root {
    .skin--bordered {
      @include mixins.bordered-skin($sel-chat-app-layout);
    }
  }

  .active-chat-user-profile-sidebar,
  .user-profile-sidebar {
    .v-navigation-drawer__content {
      display: flex;
      flex-direction: column;
    }
  }

  .chat-list-header,
  .active-chat-header {
    @extend %chat-header;
  }

  .chat-list-sidebar {
    .v-navigation-drawer__content {
      display: flex;
      flex-direction: column;
    }
  }
}

.chat-message-input textarea {
  resize: none;
  overflow: hidden;
  line-height: 1.5rem;
  padding-top: 0.8rem !important;
  padding-bottom: 0.5rem !important;
}

.chat-content-container {
  background-color: v-bind(chatContentContainerBg);

  .chat-message-input {
    .v-field__input {
      font-size: 0.9375rem !important;
      line-height: 1.375rem;
      padding-block: 0.6rem 0.5rem;
      white-space: pre-wrap;
    }

    .v-field__append-inner {
      align-items: center;
      padding-block-start: 0;
    }

    .v-field--appended {
      padding-inline-end: 8px;
    }
  }
}

.chat-user-profile-badge {
  .v-badge__badge {
    min-width: 12px !important;
    height: 0.75rem;
  }
}

.link-preview-card {
  position: relative;
  padding: 14px;
  margin-bottom: 0.5rem;
}

.link-preview-close {
  position: absolute;
  top: 6px;
  right: 6px;
  min-width: 28px !important;
  width: 28px !important;
  height: 28px !important;
}

.two-line-ellipsis {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.composer-attachment {
  display: flex;
  justify-content: flex-start;
  width: 100%;
}

.composer-attachment-card {
  inline-size: 100%;
  max-inline-size: 100%;
}

.audio-recording-inline {
  background: rgb(var(--v-theme-surface));
  border-radius: 12px;
  min-height: 56px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.audio-recording-inline::-webkit-scrollbar {
  display: none;
}

.audio-recording-inline .record-action {
  color: rgba(var(--v-theme-on-surface), 0.7) !important;
  flex-shrink: 0;
}

.audio-recording-inline .record-send-btn {
  min-width: 42px !important;
  height: 42px !important;
  flex-shrink: 0;
}

@media (max-width: 600px) {
  .audio-recording-inline {
    gap: 0.5rem !important;
    padding-left: 0.5rem !important;
    padding-right: 0.5rem !important;
  }

  .audio-recording-inline .record-action {
    min-width: 36px !important;
    width: 36px !important;
    height: 36px !important;
  }

  .audio-recording-inline .record-action .v-icon {
    font-size: 18px !important;
  }

  .audio-recording-inline .record-send-btn {
    min-width: 36px !important;
    width: 36px !important;
    height: 36px !important;
  }

  .audio-recording-inline .record-send-btn .v-icon {
    font-size: 18px !important;
  }
}

.audio-recording-info {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.audio-wave-canvas {
  width: min(220px, 35vw);
  height: 28px;
  background: transparent;
}

@media (max-width: 600px) {
  .audio-wave-canvas {
    width: min(80px, 20vw);
    height: 20px;
  }
}

.audio-recording-clock {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  min-width: 52px;
  text-align: center;
  flex-shrink: 0;
}

@media (max-width: 600px) {
  .audio-recording-clock {
    min-width: 42px;
    font-size: 0.875rem;
  }
}

.recording-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgb(var(--v-theme-error));
  animation: pulse 1.4s ease-in-out infinite;
  flex-shrink: 0;
}

@media (max-width: 600px) {
  .recording-dot {
    width: 8px;
    height: 8px;
  }
}

.recording-dot.is-paused {
  background: rgba(var(--v-theme-on-surface), 0.4);
  animation: none;
}

.record-action {
  color: rgba(var(--v-theme-on-surface), 0.6) !important;
}

.view-once-toggle.is-active {
  color: rgb(var(--v-theme-primary)) !important;
}

.audio-recording-controls {
  gap: 8px !important;
}

@keyframes pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.3);
    opacity: 0.65;
  }
}

.attachment-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.attachment-grid--videos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}

.video-preview-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  padding: 8px;
  overflow: hidden;
}

.video-preview-container {
  position: relative;
  inline-size: 100%;
  block-size: 120px;
  border-radius: 8px;
  overflow: hidden;
}

.video-preview {
  inline-size: 100%;
  block-size: 100%;
  border-radius: 8px;
  background: #000;
  object-fit: cover;
  cursor: pointer;
  display: block;
}

.video-preview-play-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.95);
  background: rgba(0, 0, 0, 0.3);
  pointer-events: auto;
  z-index: 1;
  border-radius: 8px;
  cursor: pointer;
}

.video-preview-play-overlay .v-icon {
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  transform: scale(1);
}

.video-preview-wrapper:hover .video-preview-play-overlay {
  background: rgba(0, 0, 0, 0.4);
}

.video-preview-wrapper:hover .video-preview-play-overlay .v-icon {
  transform: scale(1.2);
}

.video-preview-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.video-preview-name {
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.video-preview-info {
  white-space: nowrap;
}

.video-preview-remove {
  position: absolute;
  inset-block-start: 6px;
  inset-inline-end: 6px;
}

.attachment-grid--audios {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}

.audio-preview-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  padding: 8px;
  overflow: hidden;
}

.audio-preview-container {
  position: relative;
  inline-size: 100%;
  block-size: 120px;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(var(--v-theme-primary), 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.audio-preview-icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.audio-preview-play-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.95);
  background: rgba(0, 0, 0, 0.3);
  pointer-events: auto;
  z-index: 1;
  border-radius: 8px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.audio-preview-wrapper:hover .audio-preview-play-overlay {
  opacity: 1;
}

.audio-preview-play-overlay .v-icon {
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  transform: scale(1);
}

.audio-preview-wrapper:hover .audio-preview-play-overlay .v-icon {
  transform: scale(1.2);
}

.audio-preview-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.audio-preview-name {
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.audio-preview-info {
  white-space: nowrap;
}

.audio-preview-remove {
  position: absolute;
  inset-block-start: 6px;
  inset-inline-end: 6px;
}

.contact-preview-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  padding: 8px;
  overflow: hidden;
}

.contact-preview-container {
  position: relative;
  inline-size: 100%;
  block-size: 120px;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(var(--v-theme-primary), 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
}

.contact-preview-icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.contact-preview-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.contact-preview-name {
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.contact-preview-info {
  white-space: nowrap;
}

.contact-preview-remove {
  position: absolute;
  inset-block-start: 6px;
  inset-inline-end: 6px;
}

.audio-modal-card {
  border-radius: 12px;
}

.audio-modal-player {
  padding: 16px 0;
}

.audio-modal-controls {
  display: flex;
  align-items: center;
  gap: 16px;
}

.audio-modal-play-btn {
  min-width: 48px !important;
  width: 48px !important;
  height: 48px !important;
  flex-shrink: 0;
}

.audio-modal-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.audio-modal-time {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.875rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-variant-numeric: tabular-nums;
}

.audio-modal-progress-container {
  width: 100%;
  height: 4px;
  background: rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 2px;
  overflow: hidden;
  cursor: pointer;
}

.label-select {
  .v-field__input {
    > .v-select__selection {
      margin: 0;
      display: flex;
      align-items: center;

      > span:not(.label-color-circle):not(:has(.label-color-circle)),
      > .v-select__selection-text {
        display: none !important;
      }
    }
  }

  .v-select__selection {
    .v-select__selection-text {
      display: none !important;
    }

    > span:not(:has(.label-color-circle)):not(.label-color-circle) {
      display: none !important;
    }
  }

  .v-list-item__prepend {
    margin-inline-end: 12px;
  }
}

.label-color-circle {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-inline-end: 8px;
}

.audio-modal-progress-bar {
  height: 100%;
  background: rgb(var(--v-theme-primary));
  border-radius: 2px;
  transition: width 0.1s linear;
}

.photo-preview-wrapper {
  position: relative;
  inline-size: 132px;
  block-size: 132px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
}

.photo-preview-image {
  inline-size: 100%;
  block-size: 100%;
  border-radius: 8px;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.photo-preview-wrapper:hover .photo-preview-image {
  opacity: 0.9;
}

.photo-preview-remove {
  position: absolute;
  inset-block-start: 4px;
  inset-inline-end: 4px;
}

.viewer-wrap {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: transparent;
  padding: 16px;
  overflow: hidden;
}

.viewer-box {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  max-width: 90vw;
  max-height: 90vh;
}

.viewer-media-container {
  position: relative;
  display: inline-block;
  max-width: 100%;
  max-height: 100%;
}

.viewer-img {
  display: block;
  width: auto;
  height: auto;
  max-width: 90vw;
  max-height: 85vh;
  object-fit: contain;
  border-radius: 12px;
}

.viewer-video {
  display: block;
  max-width: 90vw;
  max-height: 85vh;
  border-radius: 12px;
  background: #000;
}

.viewer-actions {
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 10;
}

.viewer-close,
.viewer-download {
  color: white !important;
  background: rgba(0, 0, 0, 0.5) !important;
  border-radius: 50%;
  min-width: 36px;
  height: 36px;

  &:hover {
    background: rgba(0, 0, 0, 0.7) !important;
  }
}

.viewer-caption {
  color: white;
  text-align: center;
  margin: 12px;
}

.location-picker-map-container {
  width: 100%;
  height: 400px;
  position: relative;
  border-radius: 8px;
  overflow: hidden;
}

.message-target-flash {
  animation: messageTargetFlash 1.1s ease;
}

.message-target-persistent-content {
  background-color: rgba(var(--v-theme-primary), 0.12) !important;
  transition: background-color 0.3s ease;
  border-top-left-radius: 8px !important;
}
@keyframes messageTargetFlash {
  0% {
    background-color: rgba(var(--v-theme-primary), 0.16);
  }
  100% {
    background-color: transparent;
  }
}

.document-preview-item {
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.document-preview-name {
  display: inline-block;
  max-width: 220px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.document-preview-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 320px;
  overflow-y: auto;
  padding-inline-end: 4px;
}
.contact-label {
  font-size: 0.625rem !important;
  height: 16px !important;
  opacity: 0.7;
  flex-shrink: 0;
}

.contact-labels-group {
  gap: 0;
}

.contact-label--with-count {
  border-top-right-radius: 0 !important;
  border-bottom-right-radius: 0 !important;
  margin-right: 0 !important;
}

.contact-label-count-wrapper {
  display: inline-flex;
  align-items: center;
  margin-left: 0;
}

.contact-label-count {
  height: 16px !important;
  min-width: auto;
  padding: 0 6px;
  font-size: 0.625rem !important;
  border-top-left-radius: 0 !important;
  border-bottom-left-radius: 0 !important;
  border-top-right-radius: 4px !important;
  border-bottom-right-radius: 4px !important;
  margin-left: 0 !important;
  opacity: 0.7;
  flex-shrink: 0;
}

.chat-labels-group {
  gap: 0;
}

.chat-label-chip--with-count {
  border-top-right-radius: 0 !important;
  border-bottom-right-radius: 0 !important;
  margin-right: 0 !important;
}

.chat-label-count-wrapper {
  display: inline-flex;
  align-items: center;
  margin-left: 0;
}

.chat-label-count {
  height: 28px;
  min-width: auto;
  padding: 0 8px;
  font-size: 0.75rem;
  border-top-left-radius: 0 !important;
  border-bottom-left-radius: 0 !important;
  border-top-right-radius: 4px !important;
  border-bottom-right-radius: 4px !important;
  margin-left: 0 !important;
}

.attendants-info-loading {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.attendants-info-primary {
  border: 1px solid rgba(var(--v-theme-primary), 0.25);
  background: rgba(var(--v-theme-primary), 0.05);
  border-radius: 0.75rem;
  padding: 0.75rem;
}

.attendants-info-secondary {
  border-radius: 0.625rem;
  background: rgba(var(--v-theme-on-surface), 0.03);
  padding: 0.625rem 0.75rem;
}

.attendants-info-main {
  min-width: 0;
}

// Mobile responsive header
@media (max-width: 600px) {
  .chat-app-layout {
    .active-chat-header {
      padding-inline: 0.75rem;
      min-block-size: 86px;
    }
  }

  .active-chat-contact-info {
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
  }

  .active-chat-name-row {
    overflow: hidden;
    flex-wrap: nowrap;
  }

  .active-chat-details {
    margin-inline-start: 0.625rem !important;
  }

  .active-chat-protocol-mobile {
    margin-block-start: 0.125rem;
    margin-inline: 0;
  }
}
</style>
