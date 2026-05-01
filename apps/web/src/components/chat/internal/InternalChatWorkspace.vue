<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import { storeToRefs } from 'pinia';
import { refDebounced } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import axios from '@webcore/axios';
import { useInternalChatStore } from '@/@webcore/stores/internalChat';
import { useInternalChatSocket } from '@/composables/useInternalChatSocket';
import { formatDateToMonthShort } from '@/@webcore/utils/formatters';
import { Picker, EmojiIndex } from 'emoji-mart-vue-fast/src';
import data from 'emoji-mart-vue-fast/data/all.json';
import 'emoji-mart-vue-fast/css/emoji-mart.css';
import { can } from '@layouts/plugins/casl';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EInternalChatPermissions } from '@core/common/enums/EPermissions/internalChat';
import { EInternalChatConversationType } from '@core/common/enums/internalChat/EInternalChatConversationType';
import { EInternalChatConversationParticipantRole } from '@core/common/enums/internalChat/EInternalChatConversationParticipantRole';
import { EInternalChatActivityState } from '@core/common/enums/internalChat/EInternalChatActivityState';
import { EMessageType } from '@core/common/enums/EMessageType';
import { EColor } from '@core/common/enums/EColor';
import type { IApiResponse } from '@core/common/interfaces/IApiResponse';
import type { ListConversationsResponse } from '@core/schema/internalChat/listConversations/response.schema';
import type { ListUsersResponse } from '@core/schema/internalChat/listUsers/response.schema';
import type { ListMessagesResponse } from '@core/schema/internalChat/listMessages/response.schema';
import type { ListGroupMembersResponse } from '@core/schema/internalChat/listGroupMembers/response.schema';

type InternalConversation =
  ListConversationsResponse['data']['results'][number];
type InternalConversationParticipant =
  InternalConversation['participants'][number];
type InternalUser = ListUsersResponse['data']['results'][number];
type InternalMessage = ListMessagesResponse['data']['results'][number];
type InternalParticipant = ListGroupMembersResponse['data'][number];
type InternalSidebarTab = 'users' | 'all' | 'direct' | 'group';
type InternalSidebarTabInfo = {
  value: InternalSidebarTab;
  label: string;
  icon: string;
};
type GroupPhotoCropResizeHandle = 'nw' | 'ne' | 'sw' | 'se';
type GroupPhotoCropTarget = 'create' | 'update';
type InternalReaction = {
  emoji: string;
  user_id?: string | null;
  user_name?: string | null;
};
type EmojiSelection = {
  native?: string;
  id?: string;
};
type LocalPaging = {
  current_page: number;
  total_pages: number;
  per_page: number;
  count: number;
  total: number;
};

const emit = defineEmits<{
  (e: 'switch-whatsapp-mode'): void;
}>();

const internalChatStore = useInternalChatStore();
const internalChatSocket = useInternalChatSocket();
const { t } = useI18n();

const {
  user,
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
  loadingGroupMembers,
  sendingMessage,
  groupMembers,
} = storeToRefs(internalChatStore);

const usersPageSize = 50;
const groupCandidatePageSize = 50;
const searchQuery = ref('');
const searchQueryDebounced = refDebounced(searchQuery, 350);
const activeSidebarTab = ref<InternalSidebarTab>('all');
const loadingSidebarAppend = ref(false);
const composerText = ref('');
const replyMessage = ref<InternalMessage | null>(null);
const hoveredMessageId = ref<string | null>(null);
const showReactionPicker = ref<string | null>(null);
const showEmojiPicker = ref<string | null>(null);
const isComposerEmojiOpen = ref(false);
const ignoreReactionOutsideOnce = ref(false);

const selectedImages = ref<File[]>([]);
const selectedVideos = ref<File[]>([]);
const selectedDocuments = ref<File[]>([]);
const selectedAudios = ref<File[]>([]);

const imageInputRef = ref<HTMLInputElement | null>(null);
const videoInputRef = ref<HTMLInputElement | null>(null);
const documentInputRef = ref<HTMLInputElement | null>(null);
const audioInputRef = ref<HTMLInputElement | null>(null);
const sidebarBodyRef = ref<HTMLElement | null>(null);
const groupPhotoInputRef = ref<HTMLInputElement | null>(null);
const groupInfoPhotoInputRef = ref<HTMLInputElement | null>(null);

const isGroupDialogOpen = ref(false);
const groupName = ref('');
const groupMemberUserIds = ref<string[]>([]);
const groupPhotoFile = ref<File | null>(null);
const groupPhotoPreview = ref<string | null>(null);
const creatingGroup = ref(false);
const isGroupPhotoCropDialogOpen = ref(false);
const savingGroupPhotoCrop = ref(false);
const groupPhotoCropImageRef = ref<HTMLImageElement | null>(null);
const groupPhotoCropCanvasRef = ref<HTMLCanvasElement | null>(null);
const groupPhotoCropPreviewSize = 400;
const groupPhotoCropTarget = ref<GroupPhotoCropTarget>('create');
const groupPhotoCropDialog = ref({
  imageSrc: '',
});
const groupPhotoCropArea = ref({
  x: 0,
  y: 0,
  width: 200,
  height: 200,
  isDragging: false,
  isResizing: false,
  startX: 0,
  startY: 0,
  initialWidth: 0,
  initialHeight: 0,
  initialX: 0,
  initialY: 0,
  resizeHandle: null as GroupPhotoCropResizeHandle | null,
});

const isForwardDialogOpen = ref(false);
const forwardMessageSource = ref<InternalMessage | null>(null);
const forwardConversationIds = ref<string[]>([]);
const forwardingMessage = ref(false);

const isGroupInfoDrawerOpen = ref(false);
const isUserInfoDrawerOpen = ref(false);
const isCloseConversationDialogOpen = ref(false);
const groupInfoName = ref('');
const isEditingGroupInfoName = ref(false);
const updatingGroupInfo = ref(false);
const closingConversation = ref(false);
const isAddGroupMembersDialogOpen = ref(false);
const groupCandidateSearch = ref('');
const groupCandidateSearchDebounced = refDebounced(groupCandidateSearch, 350);
const groupCandidateUsers = ref<InternalUser[]>([]);
const groupCandidatePaging = ref<LocalPaging>({
  current_page: 1,
  total_pages: 1,
  per_page: groupCandidatePageSize,
  count: 0,
  total: 0,
});
const loadingGroupCandidates = ref(false);
const addingGroupMemberUserIds = ref<string[]>([]);
const removingGroupMemberUserIds = ref<string[]>([]);
const transferringLeaderUserIds = ref<string[]>([]);

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
const avatarFallback = '/images/svg/avatar-default.svg';
const allowedGroupPhotoTypes = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
];
const allowedGroupPhotoExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const maxGroupPhotoBytes = 16 * 1024 * 1024;
const groupNameMaxLength = 255;
const sidebarInitialSkeletonItems = [1, 2, 3, 4];
const sidebarAppendSkeletonItems = [1, 2];
const quickReactions = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const reactionEmojiIndex = new EmojiIndex(data);
let groupPhotoPreviewUrl: string | null = null;

const resolveAvatarSource = (photo?: string | null): string => {
  return photo?.trim() || avatarFallback;
};

const groupCreatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EInternalChatPermissions.internal_chat_group,
  EInternalChatPermissions.internal_chat_group_create,
];
const groupUpdatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EInternalChatPermissions.internal_chat_group,
  EInternalChatPermissions.internal_chat_group_update,
];
const groupMembersPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EInternalChatPermissions.internal_chat_group,
  EInternalChatPermissions.internal_chat_group_manage_members,
];
const groupTransferLeaderPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EInternalChatPermissions.internal_chat_group,
  EInternalChatPermissions.internal_chat_group_transfer_leader,
];

const makeLocalPaging = (perPage = groupCandidatePageSize): LocalPaging => ({
  current_page: 1,
  total_pages: 1,
  per_page: perPage,
  count: 0,
  total: 0,
});

const canCreateInternalGroup = computed(() => can(groupCreatePermissions));
const groupNameRules = [
  (value?: string) =>
    Boolean(value?.trim()) || t('internal_chat_group_name_required'),
  (value?: string) =>
    (value?.length ?? 0) <= groupNameMaxLength ||
    t('internal_chat_max_characters', { count: groupNameMaxLength }),
];

const defaultSidebarTab = computed<InternalSidebarTabInfo>(() => ({
  value: 'all',
  label: t('internal_chat_tab_all'),
  icon: 'tabler-list',
}));

const sidebarTabs = computed<InternalSidebarTabInfo[]>(() => [
  {
    value: 'users',
    label: t('internal_chat_tab_new_conversation'),
    icon: 'tabler-plus',
  },
  { value: 'all', label: t('internal_chat_tab_all'), icon: 'tabler-list' },
  {
    value: 'direct',
    label: t('internal_chat_tab_direct'),
    icon: 'tabler-message-circle',
  },
  {
    value: 'group',
    label: t('internal_chat_tab_groups'),
    icon: 'tabler-users-group',
  },
]);

const isUsersTab = computed(() => activeSidebarTab.value === 'users');

const activeSidebarTabInfo = computed(() => {
  return (
    sidebarTabs.value.find((tab) => tab.value === activeSidebarTab.value) ??
    defaultSidebarTab.value
  );
});

const activeConversationType = computed<
  EInternalChatConversationType | undefined
>(() => {
  if (activeSidebarTab.value === 'direct') {
    return EInternalChatConversationType.direct;
  }

  if (activeSidebarTab.value === 'group') {
    return EInternalChatConversationType.group;
  }

  return undefined;
});

const canLoadMoreSidebar = computed(() => {
  if (isUsersTab.value) {
    return (
      !loadingUsers.value &&
      usersPaging.value.current_page < usersPaging.value.total_pages
    );
  }

  return (
    !loadingConversations.value &&
    conversationsPaging.value.current_page <
      conversationsPaging.value.total_pages
  );
});

const isSidebarLoading = computed(() => {
  return isUsersTab.value ? loadingUsers.value : loadingConversations.value;
});

const searchPlaceholder = computed(() => {
  return isUsersTab.value
    ? t('internal_chat_search_users')
    : t('internal_chat_search_conversations');
});

const currentUserAvatar = computed(() => {
  return resolveAvatarSource(user.value?.info.photo);
});

const currentUserName = computed(() => {
  return user.value?.info.name?.trim() || t('internal_chat_unknown_user');
});

const displayedConversations = computed(() => conversations.value);
const displayedUsers = computed(() => users.value);
const canSubmitCreateGroup = computed(() => {
  return (
    groupName.value.trim().length > 0 &&
    groupName.value.length <= groupNameMaxLength &&
    groupMemberUserIds.value.length > 0
  );
});
const isActiveGroupConversation = computed(() => {
  return activeConversation.value?.type === EInternalChatConversationType.group;
});
const isActiveConversationLeader = computed(() => {
  return (
    isActiveGroupConversation.value &&
    activeConversation.value?.leader_user_id === internalChatStore.currentUserId
  );
});
const closeConversationActionLabel = computed(() => {
  return isActiveGroupConversation.value
    ? t('internal_chat_leave_group')
    : t('internal_chat_close_conversation');
});
const closeConversationDialogTitle = computed(() => {
  return isActiveGroupConversation.value
    ? t('internal_chat_leave_group_title')
    : t('internal_chat_close_conversation_title');
});
const closeConversationDialogDescription = computed(() => {
  if (!isActiveGroupConversation.value) {
    return t('internal_chat_close_conversation_description');
  }

  if (isActiveConversationLeader.value) {
    return t('internal_chat_leave_group_leader_description');
  }

  return t('internal_chat_leave_group_description');
});
const isActiveDirectConversation = computed(() => {
  return (
    activeConversation.value?.type === EInternalChatConversationType.direct
  );
});
const activeDirectParticipant = computed(() => {
  if (!isActiveDirectConversation.value || !activeConversation.value) {
    return null;
  }

  return (
    activeConversation.value.participants.find(
      (participant) => participant.user_id !== internalChatStore.currentUserId
    ) ??
    activeConversation.value.participants[0] ??
    null
  );
});
const currentGroupParticipant = computed(() => {
  return (
    groupMembers.value.find(
      (member) => member.user_id === internalChatStore.currentUserId
    ) ?? null
  );
});
const isCurrentUserGroupLeader = computed(() => {
  return (
    currentGroupParticipant.value?.role ===
    EInternalChatConversationParticipantRole.leader
  );
});
const canEditActiveGroup = computed(() => {
  return (
    isActiveGroupConversation.value &&
    isCurrentUserGroupLeader.value &&
    can(groupUpdatePermissions)
  );
});
const canManageActiveGroupMembers = computed(() => {
  return (
    isActiveGroupConversation.value &&
    isCurrentUserGroupLeader.value &&
    can(groupMembersPermissions)
  );
});
const canTransferActiveGroupLeader = computed(() => {
  return (
    isActiveGroupConversation.value &&
    isCurrentUserGroupLeader.value &&
    can(groupTransferLeaderPermissions)
  );
});
const canSubmitGroupNameUpdate = computed(() => {
  const nextName = groupInfoName.value.trim();

  return (
    canEditActiveGroup.value &&
    !updatingGroupInfo.value &&
    nextName.length > 0 &&
    groupInfoName.value.length <= groupNameMaxLength &&
    nextName !== resolveConversationTitle(activeConversation.value)
  );
});
const existingGroupMemberIds = computed(() => {
  return new Set(groupMembers.value.map((member) => member.user_id));
});
const availableGroupCandidates = computed(() => {
  return groupCandidateUsers.value.filter(
    (candidate) => !existingGroupMemberIds.value.has(candidate.user_id)
  );
});
const canLoadMoreGroupCandidates = computed(() => {
  return (
    !loadingGroupCandidates.value &&
    groupCandidatePaging.value.current_page <
      groupCandidatePaging.value.total_pages
  );
});

const sidebarEmptyText = computed(() => {
  if (isUsersTab.value) {
    return searchQueryDebounced.value.trim()
      ? t('internal_chat_empty_user_search')
      : t('internal_chat_empty_users');
  }

  if (activeSidebarTab.value === 'direct') {
    return t('internal_chat_empty_direct_conversations');
  }

  if (activeSidebarTab.value === 'group') {
    return t('internal_chat_empty_groups');
  }

  return t('internal_chat_empty_conversations');
});

const sidebarEmptyIcon = computed(() => {
  if (isUsersTab.value) return 'tabler-user-search';
  if (activeSidebarTab.value === 'group') return 'tabler-users-group';
  return 'tabler-messages';
});

const hasSidebarItems = computed(() => {
  return isUsersTab.value
    ? displayedUsers.value.length > 0
    : displayedConversations.value.length > 0;
});

const hasInitialSidebarLoading = computed(() => {
  return isSidebarLoading.value && !loadingSidebarAppend.value;
});

const canShowSidebarEmpty = computed(() => {
  return !hasSidebarItems.value && !isSidebarLoading.value;
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
    return t('internal_chat_activity_recording', {
      name: activity.user_name ?? t('internal_chat_unknown_user'),
    });
  }

  return t('internal_chat_activity_typing', {
    name: activity.user_name ?? t('internal_chat_unknown_user'),
  });
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

const resolveConversationTitle = (
  conversation?: InternalConversation | null
): string => {
  return conversation?.name?.trim() || t('internal_chat_default_conversation');
};

const internalChatPreviewTranslationKeys: Record<string, string> = {
  '[Imagem]': 'internal_chat_preview_image',
  '[Vídeo]': 'internal_chat_preview_video',
  '[Áudio]': 'internal_chat_preview_audio',
  '[Documento]': 'internal_chat_preview_document',
  '[Localização]': 'internal_chat_preview_location',
  '[Contato]': 'internal_chat_preview_contact',
  '[Contatos]': 'internal_chat_preview_contacts',
  internal_chat_preview_image: 'internal_chat_preview_image',
  internal_chat_preview_video: 'internal_chat_preview_video',
  internal_chat_preview_audio: 'internal_chat_preview_audio',
  internal_chat_preview_document: 'internal_chat_preview_document',
  internal_chat_preview_location: 'internal_chat_preview_location',
  internal_chat_preview_contact: 'internal_chat_preview_contact',
  internal_chat_preview_contacts: 'internal_chat_preview_contacts',
};

const translateInternalChatPreview = (preview: string): string => {
  const translationKey = internalChatPreviewTranslationKeys[preview];
  return translationKey ? t(translationKey) : preview;
};

const resolveConversationPreview = (
  conversation?: InternalConversation | null
): string => {
  const preview = conversation?.last_message_preview?.trim();
  return preview ? translateInternalChatPreview(preview) : '';
};

const isGroupConversation = (
  conversation?: InternalConversation | null
): boolean => {
  return conversation?.type === EInternalChatConversationType.group;
};

const formatConversationDate = (value?: string | null): string => {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return formatDateToMonthShort(date, t);
};

const resolveUnreadCount = (count: number): string => {
  if (count > 99) return '99+';
  return String(count);
};

const resolveUserName = (user: InternalUser): string => {
  return user.name?.trim() || t('internal_chat_unknown_user');
};

const resolveParticipantName = (member: InternalParticipant): string => {
  return member.name?.trim() || t('internal_chat_unknown_user');
};

const resolveConversationParticipantName = (
  participant?: InternalConversationParticipant | null
): string => {
  return participant?.name?.trim() || t('internal_chat_unknown_user');
};

const resolveInfoValue = (value?: string | null): string => {
  return value?.trim() || t('internal_chat_not_informed');
};

const isOwnMessage = (message: InternalMessage): boolean => {
  return (
    !!internalChatStore.currentUserId &&
    message.user?.id === internalChatStore.currentUserId
  );
};

const isDeletedMessage = (message: InternalMessage): boolean => {
  return Boolean(message.deleted);
};

const canInteractWithMessage = (message: InternalMessage): boolean => {
  return !isDeletedMessage(message) && Boolean(message.content);
};

const canEditInternalMessage = (message: InternalMessage): boolean => {
  return (
    isOwnMessage(message) &&
    !isDeletedMessage(message) &&
    message.content?.type === EMessageType.text
  );
};

const resolveMessageText = (message: InternalMessage): string | null => {
  if (!message.content) return null;
  if (message.deleted) return t('internal_chat_deleted_message');

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

const shouldShowCopy = (message: InternalMessage): boolean => {
  return !isDeletedMessage(message) && Boolean(resolveMessageText(message));
};

const resolveDownloadTarget = (
  message: InternalMessage
): { url: string; name: string } | null => {
  if (message.content?.image?.url) {
    return {
      url: message.content.image.url,
      name: message.content.image.name || 'imagem',
    };
  }

  if (message.content?.video?.url) {
    return {
      url: message.content.video.url,
      name: message.content.video.name || 'video',
    };
  }

  if (message.content?.audio?.url) {
    return {
      url: message.content.audio.url,
      name: message.content.audio.name || 'audio',
    };
  }

  if (message.content?.document?.url) {
    return {
      url: message.content.document.url,
      name: message.content.document.name || 'documento',
    };
  }

  return null;
};

const shouldShowDownload = (message: InternalMessage): boolean => {
  return !isDeletedMessage(message) && Boolean(resolveDownloadTarget(message));
};

const resolveQuotedText = (message: InternalMessage): string => {
  const quoted = message.content?.quoted;
  if (quoted?.message) return String(quoted.message);

  const quotedMessageId = message.content?.message_quoted_id;
  if (!quotedMessageId) return '';

  const quotedMessage = messages.value.find(
    (item) => item.message_id === quotedMessageId
  );

  if (!quotedMessage) return t('internal_chat_message');
  return resolveMessageText(quotedMessage) || t('internal_chat_message');
};

const resolveQuotedName = (message: InternalMessage): string => {
  const quoted = message.content?.quoted;
  if (quoted?.user_name) return String(quoted.user_name);

  const quotedMessageId = message.content?.message_quoted_id;
  if (!quotedMessageId) return t('internal_chat_reply');

  const quotedMessage = messages.value.find(
    (item) => item.message_id === quotedMessageId
  );

  return quotedMessage?.user?.name || t('internal_chat_reply');
};

const showQuotedMessage = (message: InternalMessage): boolean => {
  return Boolean(
    message.content?.quoted?.message || message.content?.message_quoted_id
  );
};

const cloneReactions = (
  reactions?: InternalReaction[] | null
): InternalReaction[] | null => {
  return reactions?.length
    ? reactions.map((reaction) => ({ ...reaction }))
    : null;
};

const getReactionsSummary = (
  reactions?: InternalReaction[] | null
): Array<{ emoji: string; count: number }> => {
  if (!reactions?.length) return [];

  const summary = new Map<string, { emoji: string; count: number }>();
  for (const reaction of reactions) {
    if (!reaction?.emoji) continue;

    const current = summary.get(reaction.emoji);
    if (!current) {
      summary.set(reaction.emoji, { emoji: reaction.emoji, count: 1 });
      continue;
    }

    current.count += 1;
  }

  return Array.from(summary.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.emoji.localeCompare(b.emoji);
  });
};

const clearComposer = () => {
  composerText.value = '';
  replyMessage.value = null;
  isComposerEmojiOpen.value = false;
  selectedImages.value = [];
  selectedVideos.value = [];
  selectedDocuments.value = [];
  selectedAudios.value = [];
};

const revokeGroupPhotoPreview = () => {
  if (!groupPhotoPreviewUrl) return;
  URL.revokeObjectURL(groupPhotoPreviewUrl);
  groupPhotoPreviewUrl = null;
};

const clearGroupPhoto = () => {
  revokeGroupPhotoPreview();
  groupPhotoFile.value = null;
  groupPhotoPreview.value = null;
  isGroupPhotoCropDialogOpen.value = false;
  groupPhotoCropDialog.value.imageSrc = '';

  if (groupPhotoInputRef.value) {
    groupPhotoInputRef.value.value = '';
  }
};

const resetGroupPhotoCropDialog = () => {
  isGroupPhotoCropDialogOpen.value = false;
  savingGroupPhotoCrop.value = false;
  groupPhotoCropDialog.value.imageSrc = '';
  endGroupPhotoCropDrag();
  endGroupPhotoCropResize();
};

const resetCreateGroupForm = () => {
  groupName.value = '';
  groupMemberUserIds.value = [];
  clearGroupPhoto();
};

const openGroupPhotoPicker = () => {
  groupPhotoInputRef.value?.click();
};

const openGroupInfoPhotoPicker = () => {
  if (!canEditActiveGroup.value || updatingGroupInfo.value) return;
  groupInfoPhotoInputRef.value?.click();
};

const resolveFileExtension = (filename: string): string => {
  return filename.split('.').pop()?.toLowerCase() ?? '';
};

const isAllowedGroupPhotoFile = (file: File): boolean => {
  const extension = resolveFileExtension(file.name);
  const isAllowedExtension = allowedGroupPhotoExtensions.includes(extension);
  const isAllowedType =
    !file.type || allowedGroupPhotoTypes.includes(file.type.toLowerCase());

  return isAllowedExtension && isAllowedType;
};

const handleGroupPhotoSelected = (
  event: Event,
  targetKind: GroupPhotoCropTarget
) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0] ?? null;

  if (!file) return;

  if (!isAllowedGroupPhotoFile(file)) {
    if (targetKind === 'create') clearGroupPhoto();
    internalChatStore.showSnackbar(
      t('internal_chat_invalid_image_format'),
      EColor.error
    );
    return;
  }

  if (file.size > maxGroupPhotoBytes) {
    if (targetKind === 'create') clearGroupPhoto();
    internalChatStore.showSnackbar(
      t('internal_chat_group_photo_size_exceeded'),
      EColor.error
    );
    return;
  }

  const reader = new FileReader();
  reader.onload = (readerEvent: ProgressEvent<FileReader>) => {
    const result = readerEvent.target?.result as string;
    if (!result) return;

    groupPhotoCropTarget.value = targetKind;
    groupPhotoCropDialog.value.imageSrc = result;
    isGroupPhotoCropDialogOpen.value = true;
    void nextTick(() => {
      initializeGroupPhotoCrop();
    });
  };
  reader.readAsDataURL(file);
  target.value = '';
};

const onGroupPhotoSelected = (event: Event) => {
  handleGroupPhotoSelected(event, 'create');
};

const onGroupInfoPhotoSelected = (event: Event) => {
  handleGroupPhotoSelected(event, 'update');
};

const initializeGroupPhotoCrop = () => {
  if (!groupPhotoCropImageRef.value) return;

  const img = groupPhotoCropImageRef.value;
  const container = img.parentElement;
  const containerWidth = container?.clientWidth || groupPhotoCropPreviewSize;
  const containerHeight = container?.clientHeight || groupPhotoCropPreviewSize;

  if (img.complete) {
    setupGroupPhotoCropArea(img, containerWidth, containerHeight);
    return;
  }

  img.onload = () => {
    setupGroupPhotoCropArea(img, containerWidth, containerHeight);
  };
};

const setupGroupPhotoCropArea = (
  img: HTMLImageElement,
  containerWidth: number,
  containerHeight: number
) => {
  const imgAspect = img.naturalWidth / img.naturalHeight;
  const containerAspect = containerWidth / containerHeight;

  let displayWidth = containerWidth;
  let displayHeight = containerHeight;

  if (imgAspect > containerAspect) {
    displayHeight = containerWidth / imgAspect;
  }

  if (imgAspect <= containerAspect) {
    displayWidth = containerHeight * imgAspect;
  }

  img.style.width = `${displayWidth}px`;
  img.style.height = `${displayHeight}px`;

  const cropSize = Math.min(
    displayWidth,
    displayHeight,
    groupPhotoCropPreviewSize
  );

  groupPhotoCropArea.value.width = cropSize;
  groupPhotoCropArea.value.height = cropSize;

  const imgLeft = (containerWidth - displayWidth) / 2;
  const imgTop = (containerHeight - displayHeight) / 2;

  groupPhotoCropArea.value.x =
    imgLeft + Math.max(0, (displayWidth - cropSize) / 2);
  groupPhotoCropArea.value.y =
    imgTop + Math.max(0, (displayHeight - cropSize) / 2);
};

const startGroupPhotoCropDrag = (event: MouseEvent | TouchEvent) => {
  event.preventDefault();
  event.stopPropagation();
  groupPhotoCropArea.value.isDragging = true;

  const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
  const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;
  const container = groupPhotoCropImageRef.value?.parentElement;
  if (!container) return;

  const rect = container.getBoundingClientRect();
  groupPhotoCropArea.value.startX =
    clientX - rect.left - groupPhotoCropArea.value.x;
  groupPhotoCropArea.value.startY =
    clientY - rect.top - groupPhotoCropArea.value.y;

  globalThis.document.addEventListener('mousemove', onGroupPhotoCropDrag);
  globalThis.document.addEventListener('touchmove', onGroupPhotoCropDrag);
  globalThis.document.addEventListener('mouseup', endGroupPhotoCropDrag);
  globalThis.document.addEventListener('touchend', endGroupPhotoCropDrag);
};

const startGroupPhotoCropResize = (
  handle: GroupPhotoCropResizeHandle,
  event: MouseEvent | TouchEvent
) => {
  event.preventDefault();
  event.stopPropagation();
  groupPhotoCropArea.value.isResizing = true;
  groupPhotoCropArea.value.resizeHandle = handle;
  groupPhotoCropArea.value.initialWidth = groupPhotoCropArea.value.width;
  groupPhotoCropArea.value.initialHeight = groupPhotoCropArea.value.height;
  groupPhotoCropArea.value.initialX = groupPhotoCropArea.value.x;
  groupPhotoCropArea.value.initialY = groupPhotoCropArea.value.y;

  const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
  const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;
  const container = groupPhotoCropImageRef.value?.parentElement;
  if (!container) return;

  const rect = container.getBoundingClientRect();
  groupPhotoCropArea.value.startX = clientX - rect.left;
  groupPhotoCropArea.value.startY = clientY - rect.top;

  globalThis.document.addEventListener('mousemove', onGroupPhotoCropResize);
  globalThis.document.addEventListener('touchmove', onGroupPhotoCropResize);
  globalThis.document.addEventListener('mouseup', endGroupPhotoCropResize);
  globalThis.document.addEventListener('touchend', endGroupPhotoCropResize);
};

const onGroupPhotoCropDrag = (event: MouseEvent | TouchEvent) => {
  if (!groupPhotoCropArea.value.isDragging || !groupPhotoCropImageRef.value) {
    return;
  }

  event.preventDefault();

  const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
  const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;
  const container = groupPhotoCropImageRef.value.parentElement;
  if (!container) return;

  const rect = container.getBoundingClientRect();
  const x = clientX - rect.left - groupPhotoCropArea.value.startX;
  const y = clientY - rect.top - groupPhotoCropArea.value.startY;
  const imgWidth = groupPhotoCropImageRef.value.offsetWidth;
  const imgHeight = groupPhotoCropImageRef.value.offsetHeight;
  const imgLeft = (container.clientWidth - imgWidth) / 2;
  const imgTop = (container.clientHeight - imgHeight) / 2;
  const maxX = imgLeft + imgWidth - groupPhotoCropArea.value.width;
  const maxY = imgTop + imgHeight - groupPhotoCropArea.value.height;

  groupPhotoCropArea.value.x = Math.max(imgLeft, Math.min(x, maxX));
  groupPhotoCropArea.value.y = Math.max(imgTop, Math.min(y, maxY));
};

const onGroupPhotoCropResize = (event: MouseEvent | TouchEvent) => {
  if (
    !groupPhotoCropArea.value.isResizing ||
    !groupPhotoCropImageRef.value ||
    !groupPhotoCropArea.value.resizeHandle
  ) {
    return;
  }

  event.preventDefault();

  const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
  const container = groupPhotoCropImageRef.value.parentElement;
  if (!container) return;

  const rect = container.getBoundingClientRect();
  const deltaX = clientX - rect.left - groupPhotoCropArea.value.startX;
  const minSize = 50;
  const handle = groupPhotoCropArea.value.resizeHandle;

  let newWidth = groupPhotoCropArea.value.initialWidth;
  let newHeight = groupPhotoCropArea.value.initialHeight;
  let newX = groupPhotoCropArea.value.initialX;
  let newY = groupPhotoCropArea.value.initialY;

  if (handle === 'se') {
    newWidth = Math.max(
      minSize,
      groupPhotoCropArea.value.initialWidth + deltaX
    );
    newHeight = newWidth;
  }

  if (handle === 'sw') {
    newWidth = Math.max(
      minSize,
      groupPhotoCropArea.value.initialWidth - deltaX
    );
    newHeight = newWidth;
    newX =
      groupPhotoCropArea.value.initialX +
      (groupPhotoCropArea.value.initialWidth - newWidth);
  }

  if (handle === 'ne') {
    newWidth = Math.max(
      minSize,
      groupPhotoCropArea.value.initialWidth + deltaX
    );
    newHeight = newWidth;
    newY =
      groupPhotoCropArea.value.initialY +
      (groupPhotoCropArea.value.initialHeight - newHeight);
  }

  if (handle === 'nw') {
    newWidth = Math.max(
      minSize,
      groupPhotoCropArea.value.initialWidth - deltaX
    );
    newHeight = newWidth;
    newX =
      groupPhotoCropArea.value.initialX +
      (groupPhotoCropArea.value.initialWidth - newWidth);
    newY =
      groupPhotoCropArea.value.initialY +
      (groupPhotoCropArea.value.initialHeight - newHeight);
  }

  const imgWidth = groupPhotoCropImageRef.value.offsetWidth;
  const imgHeight = groupPhotoCropImageRef.value.offsetHeight;
  const maxSize = Math.min(imgWidth, imgHeight);
  newWidth = Math.min(newWidth, maxSize);
  newHeight = newWidth;

  const imgLeft = (container.clientWidth - imgWidth) / 2;
  const imgTop = (container.clientHeight - imgHeight) / 2;
  const maxX = imgLeft + imgWidth - newWidth;
  const maxY = imgTop + imgHeight - newHeight;

  groupPhotoCropArea.value.width = newWidth;
  groupPhotoCropArea.value.height = newHeight;
  groupPhotoCropArea.value.x = Math.max(imgLeft, Math.min(newX, maxX));
  groupPhotoCropArea.value.y = Math.max(imgTop, Math.min(newY, maxY));
};

const endGroupPhotoCropDrag = () => {
  groupPhotoCropArea.value.isDragging = false;
  globalThis.document.removeEventListener('mousemove', onGroupPhotoCropDrag);
  globalThis.document.removeEventListener('touchmove', onGroupPhotoCropDrag);
  globalThis.document.removeEventListener('mouseup', endGroupPhotoCropDrag);
  globalThis.document.removeEventListener('touchend', endGroupPhotoCropDrag);
};

const endGroupPhotoCropResize = () => {
  groupPhotoCropArea.value.isResizing = false;
  groupPhotoCropArea.value.resizeHandle = null;
  globalThis.document.removeEventListener('mousemove', onGroupPhotoCropResize);
  globalThis.document.removeEventListener('touchmove', onGroupPhotoCropResize);
  globalThis.document.removeEventListener('mouseup', endGroupPhotoCropResize);
  globalThis.document.removeEventListener('touchend', endGroupPhotoCropResize);
};

const cancelGroupPhotoCrop = () => {
  if (savingGroupPhotoCrop.value) return;
  resetGroupPhotoCropDialog();
};

const updateGroupPhoto = async (file: File) => {
  const conversationId = activeConversation.value?.conversation_id;
  if (!conversationId || !canEditActiveGroup.value) return;

  updatingGroupInfo.value = true;
  try {
    const updated = await internalChatStore.updateGroup(conversationId, {
      photoFile: file,
    });

    if (!updated) return;

    internalChatStore.showSnackbar(
      t('internal_chat_group_photo_update_success'),
      EColor.success
    );
  } finally {
    updatingGroupInfo.value = false;
  }
};

const cropGroupPhoto = () => {
  if (savingGroupPhotoCrop.value) return;
  if (!groupPhotoCropImageRef.value || !groupPhotoCropCanvasRef.value) return;

  const img = groupPhotoCropImageRef.value;
  const canvas = groupPhotoCropCanvasRef.value;
  const ctx = canvas.getContext('2d');

  if (!ctx || !img.complete) {
    internalChatStore.showSnackbar(
      t('internal_chat_wait_image_load'),
      EColor.warning
    );
    return;
  }

  const container = img.parentElement;
  if (!container) return;

  const imgLeft = (container.clientWidth - img.offsetWidth) / 2;
  const imgTop = (container.clientHeight - img.offsetHeight) / 2;
  const relativeX = groupPhotoCropArea.value.x - imgLeft;
  const relativeY = groupPhotoCropArea.value.y - imgTop;
  const scaleX = img.naturalWidth / img.offsetWidth;
  const scaleY = img.naturalHeight / img.offsetHeight;

  canvas.width = groupPhotoCropPreviewSize;
  canvas.height = groupPhotoCropPreviewSize;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    img,
    relativeX * scaleX,
    relativeY * scaleY,
    groupPhotoCropArea.value.width * scaleX,
    groupPhotoCropArea.value.height * scaleY,
    0,
    0,
    groupPhotoCropPreviewSize,
    groupPhotoCropPreviewSize
  );

  savingGroupPhotoCrop.value = true;
  canvas.toBlob(
    async (blob) => {
      try {
        if (!blob) {
          internalChatStore.showSnackbar(
            t('internal_chat_crop_image_error'),
            EColor.error
          );
          return;
        }

        const croppedFile = new File([blob], 'group-photo.jpg', {
          type: 'image/jpeg',
        });

        if (groupPhotoCropTarget.value === 'update') {
          await updateGroupPhoto(croppedFile);
          resetGroupPhotoCropDialog();
          return;
        }

        revokeGroupPhotoPreview();
        groupPhotoFile.value = croppedFile;
        groupPhotoPreview.value = canvas.toDataURL('image/jpeg');
        resetGroupPhotoCropDialog();
      } finally {
        savingGroupPhotoCrop.value = false;
      }
    },
    'image/jpeg',
    0.9
  );
};

const loadSidebar = async (append = false) => {
  const normalizedSearch = searchQueryDebounced.value.trim();
  loadingSidebarAppend.value = append;

  try {
    if (isUsersTab.value) {
      await internalChatStore.listUsers(
        {
          current_page: append ? usersPaging.value.current_page + 1 : 1,
          per_page: usersPageSize,
          search: normalizedSearch || undefined,
        },
        append
      );
      return;
    }

    await internalChatStore.listConversations(
      {
        current_page: append ? conversationsPaging.value.current_page + 1 : 1,
        per_page: conversationsPaging.value.per_page,
        search: normalizedSearch || undefined,
        type: activeConversationType.value,
      },
      append
    );
  } finally {
    loadingSidebarAppend.value = false;
  }
};

const loadMoreSidebar = async () => {
  if (!canLoadMoreSidebar.value) return;
  await loadSidebar(true);
};

const handleSidebarScroll = async (event: Event) => {
  if (!canLoadMoreSidebar.value) return;

  const target = event.currentTarget as HTMLElement | null;
  if (!target) return;

  const remainingScroll =
    target.scrollHeight - target.scrollTop - target.clientHeight;

  if (remainingScroll > 120) return;

  await loadMoreSidebar();
};

const switchSidebarTab = async (tab: InternalSidebarTab) => {
  if (activeSidebarTab.value === tab) return;

  activeSidebarTab.value = tab;
  sidebarBodyRef.value?.scrollTo({ top: 0 });
};

const openConversation = async (conversationId: string) => {
  await internalChatStore.openConversation(conversationId);
};

const openConversationFromUser = async (userId: string) => {
  const conversation = await internalChatStore.openDirect(userId);
  if (!conversation) return;

  activeSidebarTab.value = 'all';
  sidebarBodyRef.value?.scrollTo({ top: 0 });
};

const openConversationFromGroupMember = async (member: InternalParticipant) => {
  if (member.user_id === internalChatStore.currentUserId) return;

  const conversation = await internalChatStore.openDirect(member.user_id);
  if (!conversation) return;

  activeSidebarTab.value = 'all';
  closeGroupInfoDrawer();
  sidebarBodyRef.value?.scrollTo({ top: 0 });
};

const openCreateGroupDialog = async () => {
  await internalChatStore.listUsers({ current_page: 1, per_page: 100 }, false);
  isGroupDialogOpen.value = true;
};

const closeCreateGroupDialog = () => {
  if (creatingGroup.value) return;

  isGroupDialogOpen.value = false;
  resetCreateGroupForm();
};

const resetGroupCandidateUsers = () => {
  groupCandidateUsers.value = [];
  groupCandidatePaging.value = makeLocalPaging();
};

const fetchGroupCandidateUsers = async (append = false) => {
  if (loadingGroupCandidates.value) return;

  loadingGroupCandidates.value = true;
  try {
    const params = {
      current_page: append ? groupCandidatePaging.value.current_page + 1 : 1,
      per_page: groupCandidatePageSize,
      search: groupCandidateSearch.value.trim() || undefined,
    };

    const response = await axios.get<IApiResponse<ListUsersResponse['data']>>(
      '/internal-chat/users',
      { params }
    );

    const data = response?.data;
    if (!data?.status || !data.data) {
      if (!append) resetGroupCandidateUsers();
      return;
    }

    const incoming = data.data.results ?? [];
    if (append) {
      const merged = [...groupCandidateUsers.value];
      for (const candidate of incoming) {
        if (!merged.some((item) => item.user_id === candidate.user_id)) {
          merged.push(candidate);
        }
      }
      groupCandidateUsers.value = merged;
    } else {
      groupCandidateUsers.value = incoming;
    }

    groupCandidatePaging.value = {
      current_page: data.data.pagings.current_page,
      total_pages: data.data.pagings.total_pages,
      per_page: data.data.pagings.per_page,
      count: data.data.pagings.count,
      total: data.data.pagings.total,
    };
  } catch (error) {
    internalChatStore.showSnackbar(
      internalChatStore.resolveErrorMessage(
        error,
        t('internal_chat_list_group_candidates_error')
      ),
      EColor.error
    );
  } finally {
    loadingGroupCandidates.value = false;
  }
};

const handleGroupCandidatesScroll = async (event: Event) => {
  if (!canLoadMoreGroupCandidates.value) return;

  const target = event.currentTarget as HTMLElement | null;
  if (!target) return;

  const remainingScroll =
    target.scrollHeight - target.scrollTop - target.clientHeight;

  if (remainingScroll > 120) return;

  await fetchGroupCandidateUsers(true);
};

const openAddGroupMembersDialog = async () => {
  if (!canManageActiveGroupMembers.value) return;

  isAddGroupMembersDialogOpen.value = true;
  groupCandidateSearch.value = '';
  resetGroupCandidateUsers();
  await fetchGroupCandidateUsers(false);
};

const openGroupInfoDrawer = async () => {
  if (!isActiveGroupConversation.value || !activeConversation.value) return;

  isUserInfoDrawerOpen.value = false;
  groupInfoName.value = resolveConversationTitle(activeConversation.value);
  isEditingGroupInfoName.value = false;
  groupMembers.value = [];
  isGroupInfoDrawerOpen.value = true;
  await internalChatStore.listGroupMembers(
    activeConversation.value.conversation_id
  );
};

const closeGroupInfoDrawer = () => {
  isGroupInfoDrawerOpen.value = false;
  isEditingGroupInfoName.value = false;
  isAddGroupMembersDialogOpen.value = false;
};

const startGroupNameEdit = () => {
  if (!canEditActiveGroup.value || updatingGroupInfo.value) return;

  groupInfoName.value = resolveConversationTitle(activeConversation.value);
  isEditingGroupInfoName.value = true;
};

const cancelGroupNameEdit = () => {
  groupInfoName.value = resolveConversationTitle(activeConversation.value);
  isEditingGroupInfoName.value = false;
};

const openUserInfoDrawer = () => {
  if (!isActiveDirectConversation.value || !activeDirectParticipant.value) {
    return;
  }

  isGroupInfoDrawerOpen.value = false;
  isUserInfoDrawerOpen.value = true;
};

const closeUserInfoDrawer = () => {
  isUserInfoDrawerOpen.value = false;
};

const openConversationInfo = async () => {
  if (isActiveGroupConversation.value) {
    await openGroupInfoDrawer();
    return;
  }

  openUserInfoDrawer();
};

const submitGroupNameUpdate = async () => {
  const conversationId = activeConversation.value?.conversation_id;
  const nextName = groupInfoName.value.trim();

  if (!conversationId || !canSubmitGroupNameUpdate.value) return;

  updatingGroupInfo.value = true;
  try {
    const updated = await internalChatStore.updateGroup(conversationId, {
      name: nextName,
    });

    if (!updated) return;

    internalChatStore.showSnackbar(
      t('internal_chat_group_name_update_success'),
      EColor.success
    );
    isEditingGroupInfoName.value = false;
  } finally {
    updatingGroupInfo.value = false;
  }
};

const addGroupMember = async (userId: string) => {
  const conversationId = activeConversation.value?.conversation_id;
  if (!conversationId || !canManageActiveGroupMembers.value) return;
  if (addingGroupMemberUserIds.value.includes(userId)) return;

  addingGroupMemberUserIds.value = [...addingGroupMemberUserIds.value, userId];
  try {
    const updated = await internalChatStore.addGroupMember(
      conversationId,
      userId
    );

    if (!updated) return;

    groupCandidateUsers.value = groupCandidateUsers.value.filter(
      (candidate) => candidate.user_id !== userId
    );
  } finally {
    addingGroupMemberUserIds.value = addingGroupMemberUserIds.value.filter(
      (item) => item !== userId
    );
  }
};

const removeGroupMember = async (member: InternalParticipant) => {
  const conversationId = activeConversation.value?.conversation_id;
  if (!conversationId || !canManageActiveGroupMembers.value) return;
  if (member.user_id === internalChatStore.currentUserId) return;

  const confirmed = window.confirm(
    t('internal_chat_remove_member_confirmation', {
      name: resolveParticipantName(member),
    })
  );
  if (!confirmed) return;

  removingGroupMemberUserIds.value = [
    ...removingGroupMemberUserIds.value,
    member.user_id,
  ];
  try {
    await internalChatStore.removeGroupMember(conversationId, member.user_id);
  } finally {
    removingGroupMemberUserIds.value = removingGroupMemberUserIds.value.filter(
      (item) => item !== member.user_id
    );
  }
};

const transferGroupLeader = async (member: InternalParticipant) => {
  const conversationId = activeConversation.value?.conversation_id;
  if (!conversationId || !canTransferActiveGroupLeader.value) return;
  if (member.role === EInternalChatConversationParticipantRole.leader) return;

  const confirmed = window.confirm(
    t('internal_chat_transfer_leader_confirmation', {
      name: resolveParticipantName(member),
    })
  );
  if (!confirmed) return;

  transferringLeaderUserIds.value = [
    ...transferringLeaderUserIds.value,
    member.user_id,
  ];
  try {
    await internalChatStore.transferGroupLeader(conversationId, member.user_id);
  } finally {
    transferringLeaderUserIds.value = transferringLeaderUserIds.value.filter(
      (item) => item !== member.user_id
    );
  }
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

const openCloseConversationDialog = () => {
  if (!activeConversation.value?.conversation_id) return;
  isCloseConversationDialogOpen.value = true;
};

const closeCloseConversationDialog = () => {
  if (closingConversation.value) return;
  isCloseConversationDialogOpen.value = false;
};

const confirmCloseActiveConversation = async () => {
  if (!activeConversation.value?.conversation_id) return;
  if (closingConversation.value) return;

  closingConversation.value = true;

  try {
    const closed = await internalChatStore.closeConversation(
      activeConversation.value.conversation_id
    );

    if (closed) {
      isCloseConversationDialogOpen.value = false;
      closeGroupInfoDrawer();
      closeUserInfoDrawer();
      resetGroupPhotoCropDialog();
      clearComposer();
      await internalChatStore.listConversations(
        {
          current_page: 1,
          per_page: conversationsPaging.value.per_page,
          search: searchQueryDebounced.value.trim() || undefined,
          type: activeConversationType.value,
        },
        false
      );
    }
  } finally {
    closingConversation.value = false;
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

  const normalized = `${contactName.value.trim() || t('internal_chat_contact')} (${contactPhone.value.trim()})`;
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
      t('internal_chat_microphone_error'),
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

const onComposerEmojiSelect = (emoji: EmojiSelection) => {
  const value = emoji.native ?? emoji.id;
  if (!value) return;

  composerText.value = `${composerText.value}${value}`;
};

const onReply = (message: InternalMessage) => {
  if (!canInteractWithMessage(message)) return;
  replyMessage.value = message;
};

const onReact = async (message: InternalMessage, emoji: string) => {
  if (!activeConversation.value?.conversation_id) return;
  if (!canInteractWithMessage(message)) return;

  const normalizedEmoji = emoji.trim();
  if (!normalizedEmoji) return;

  const previousReactions = cloneReactions(message.content?.reactions);

  internalChatStore.updateMessageReaction(message.message_id, normalizedEmoji);
  showReactionPicker.value = null;
  showEmojiPicker.value = null;

  const success = await internalChatStore.reactMessage(
    activeConversation.value.conversation_id,
    message.message_id,
    normalizedEmoji
  );

  if (!success) {
    internalChatStore.revertMessageReactions(
      message.message_id,
      previousReactions
    );
  }
};

const onMessageMouseEnter = (message: InternalMessage) => {
  if (!canInteractWithMessage(message)) return;
  hoveredMessageId.value = message.message_id;
};

const onMessageMouseLeave = () => {
  hoveredMessageId.value = null;
};

const toggleReactionPicker = (message: InternalMessage) => {
  if (!canInteractWithMessage(message)) return;

  const wasOpen = showReactionPicker.value === message.message_id;
  showReactionPicker.value = wasOpen ? null : message.message_id;
  showEmojiPicker.value = null;

  if (!wasOpen) {
    ignoreReactionOutsideOnce.value = true;
    setTimeout(() => {
      ignoreReactionOutsideOnce.value = false;
    }, 0);
  }
};

const toggleEmojiPicker = (messageId: string) => {
  const wasOpen = showEmojiPicker.value === messageId;
  showEmojiPicker.value = wasOpen ? null : messageId;

  if (!wasOpen) {
    ignoreReactionOutsideOnce.value = true;
    setTimeout(() => {
      ignoreReactionOutsideOnce.value = false;
    }, 0);
  }
};

const onSelectReactionEmoji = async (
  message: InternalMessage,
  emoji: EmojiSelection
) => {
  const value = emoji.native ?? emoji.id;
  if (!value) return;

  await onReact(message, value);
};

const onReactionOutsideClick = (event: MouseEvent) => {
  if (ignoreReactionOutsideOnce.value) return;

  const target = event.target as HTMLElement | null;
  if (!target) return;

  const isInsidePicker = target.closest('.internal-chat-reaction-picker');
  const isInsideTrigger = target.closest('.internal-chat-reaction-trigger');

  if (!isInsidePicker && !isInsideTrigger) {
    showReactionPicker.value = null;
    showEmojiPicker.value = null;
  }
};

const copyMessage = async (message: InternalMessage) => {
  const text = resolveMessageText(message);
  if (!text) return;

  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error('clipboard_unavailable');
    }

    await navigator.clipboard.writeText(text);
    internalChatStore.showSnackbar(
      t('internal_chat_message_copied'),
      EColor.success
    );
  } catch {
    internalChatStore.showSnackbar(
      t('internal_chat_copy_message_error'),
      EColor.error
    );
  }
};

const downloadMessage = (message: InternalMessage) => {
  const target = resolveDownloadTarget(message);
  if (!target) return;

  const link = document.createElement('a');
  link.href = target.url;
  link.download = target.name;
  link.target = '_blank';
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
};

const onEdit = async (message: InternalMessage) => {
  if (!activeConversation.value?.conversation_id) return;
  if (!canEditInternalMessage(message)) return;

  const nextText = window
    .prompt(t('internal_chat_edit_message_prompt'), message.content.message ?? '')
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
  const confirmed = window.confirm(
    t('internal_chat_delete_message_confirmation')
  );
  if (!confirmed) return;

  await internalChatStore.deleteMessage(
    activeConversation.value.conversation_id,
    message.message_id
  );
};

const openForwardDialog = (message: InternalMessage) => {
  if (!canInteractWithMessage(message)) return;

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
  if (!canSubmitCreateGroup.value) return;
  creatingGroup.value = true;

  try {
    const created = await internalChatStore.createGroup({
      name: groupName.value.trim(),
      member_user_ids: groupMemberUserIds.value,
      photoFile: groupPhotoFile.value,
    });

    if (!created) return;

    isGroupDialogOpen.value = false;
    resetCreateGroupForm();
  } finally {
    creatingGroup.value = false;
  }
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

watch([searchQueryDebounced, activeSidebarTab], async () => {
  sidebarBodyRef.value?.scrollTo({ top: 0 });
  await loadSidebar(false);
});

watch(groupCandidateSearchDebounced, async () => {
  if (!isAddGroupMembersDialogOpen.value) return;
  resetGroupCandidateUsers();
  await fetchGroupCandidateUsers(false);
});

watch(isGroupInfoDrawerOpen, (isOpen) => {
  if (isOpen) return;
  isAddGroupMembersDialogOpen.value = false;
  resetGroupCandidateUsers();
});

watch(isUserInfoDrawerOpen, (isOpen) => {
  if (!isOpen) return;
  isGroupInfoDrawerOpen.value = false;
});

watch(
  () => activeConversation.value?.conversation_id,
  async () => {
    showReactionPicker.value = null;
    showEmojiPicker.value = null;

    if (isUserInfoDrawerOpen.value && !isActiveDirectConversation.value) {
      closeUserInfoDrawer();
    }

    if (!isGroupInfoDrawerOpen.value) return;

    if (!isActiveGroupConversation.value || !activeConversation.value) {
      closeGroupInfoDrawer();
      return;
    }

    groupInfoName.value = resolveConversationTitle(activeConversation.value);
    isEditingGroupInfoName.value = false;
    groupMembers.value = [];
    await internalChatStore.listGroupMembers(
      activeConversation.value.conversation_id
    );
  }
);

onMounted(async () => {
  await loadSidebar(false);
  await internalChatSocket.initializeSocket();
  document.addEventListener('click', onReactionOutsideClick);
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

  endGroupPhotoCropDrag();
  endGroupPhotoCropResize();
  clearGroupPhoto();
  document.removeEventListener('click', onReactionOutsideClick);

  await internalChatSocket.cleanup();
});
</script>

<template>
  <div class="internal-chat-layout d-flex h-100">
    <aside class="internal-chat-sidebar">
      <div class="internal-chat-sidebar-header pa-3">
        <div class="internal-chat-mode-banner">
          <div class="internal-chat-mode-chip">
            <VIcon size="18">tabler-users-group</VIcon>
            <span>{{ t('internal_chat_title') }}</span>
          </div>

          <VBtn
            color="success"
            variant="tonal"
            class="internal-chat-back-btn"
            @click="emit('switch-whatsapp-mode')"
          >
            <VIcon size="18" class="me-1">tabler-brand-whatsapp</VIcon>
            {{ t('internal_chat_back_to_chat') }}
          </VBtn>
        </div>

        <div class="internal-chat-search-row">
          <VAvatar size="40" class="internal-chat-current-avatar">
            <VImg :src="currentUserAvatar" :alt="currentUserName" cover />
          </VAvatar>

          <AppTextField
            v-model="searchQuery"
            prepend-inner-icon="tabler-search"
            :placeholder="searchPlaceholder"
            hide-details
            density="compact"
            class="internal-chat-search-field"
          />

          <VBtn
            v-if="canCreateInternalGroup"
            icon
            color="primary"
            variant="flat"
            class="internal-chat-create-group-btn"
            @click="openCreateGroupDialog"
          >
            <VIcon size="18">tabler-users-plus</VIcon>
            <VTooltip activator="parent" location="bottom">
              {{ t('internal_chat_new_group') }}
            </VTooltip>
          </VBtn>
        </div>

        <div class="internal-chat-tabs">
          <VBtn
            v-for="tab in sidebarTabs"
            :key="tab.value"
            icon
            :variant="activeSidebarTab === tab.value ? 'flat' : 'text'"
            :color="activeSidebarTab === tab.value ? 'primary' : undefined"
            class="internal-chat-tab-btn"
            :aria-label="tab.label"
            @click="switchSidebarTab(tab.value)"
          >
            <VIcon size="20">
              {{ tab.icon }}
            </VIcon>
            <VTooltip activator="parent" location="bottom">
              {{ tab.label }}
            </VTooltip>
          </VBtn>
        </div>

        <div class="internal-chat-active-filter">
          <VIcon size="18">{{ activeSidebarTabInfo.icon }}</VIcon>
          <span>{{ activeSidebarTabInfo.label }}</span>
        </div>
      </div>

      <VDivider />

      <div
        ref="sidebarBodyRef"
        class="internal-chat-sidebar-body"
        @scroll="handleSidebarScroll"
      >
        <ul
          v-if="hasInitialSidebarLoading"
          class="internal-chat-card-list internal-chat-skeleton-list"
          aria-hidden="true"
        >
          <li
            v-for="item in sidebarInitialSkeletonItems"
            :key="`sidebar-skeleton-${activeSidebarTab}-${item}`"
            class="internal-chat-card internal-chat-skeleton-card d-flex align-center"
            :class="{ 'internal-chat-card--user': isUsersTab }"
          >
            <span class="internal-chat-skeleton-avatar" />
            <span class="internal-chat-skeleton-content">
              <span class="internal-chat-skeleton-line" />
              <span
                v-if="!isUsersTab"
                class="internal-chat-skeleton-line internal-chat-skeleton-line--short"
              />
            </span>
            <span v-if="!isUsersTab" class="internal-chat-skeleton-meta">
              <span
                class="internal-chat-skeleton-line internal-chat-skeleton-line--date"
              />
              <span class="internal-chat-skeleton-dot" />
            </span>
          </li>
        </ul>

        <template v-else-if="isUsersTab">
          <ul v-if="displayedUsers.length > 0" class="internal-chat-card-list">
            <li
              v-for="listedUser in displayedUsers"
              :key="listedUser.user_id"
              class="internal-chat-card internal-chat-card--user cursor-pointer d-flex align-center"
              role="button"
              tabindex="0"
              @click="openConversationFromUser(listedUser.user_id)"
              @keydown.enter.prevent="
                openConversationFromUser(listedUser.user_id)
              "
              @keydown.space.prevent="
                openConversationFromUser(listedUser.user_id)
              "
            >
              <VAvatar size="42" class="internal-chat-card-avatar">
                <VImg
                  :src="resolveAvatarSource(listedUser.photo)"
                  :alt="resolveUserName(listedUser)"
                  cover
                />
              </VAvatar>

              <div class="internal-chat-card-content ms-3 overflow-hidden">
                <p
                  class="internal-chat-card-title text-base text-high-emphasis mb-0 text-truncate"
                  :title="resolveUserName(listedUser)"
                >
                  {{ resolveUserName(listedUser) }}
                </p>
              </div>
            </li>
          </ul>
        </template>

        <template v-else>
          <ul
            v-if="displayedConversations.length > 0"
            class="internal-chat-card-list"
          >
            <li
              v-for="conversation in displayedConversations"
              :key="conversation.conversation_id"
              class="internal-chat-card cursor-pointer d-flex align-center"
              :class="{
                'internal-chat-card--active':
                  activeConversation?.conversation_id ===
                  conversation.conversation_id,
                'internal-chat-card--unread': conversation.unread_count > 0,
              }"
              role="button"
              tabindex="0"
              :aria-current="
                activeConversation?.conversation_id ===
                conversation.conversation_id
                  ? 'true'
                  : undefined
              "
              @click="openConversation(conversation.conversation_id)"
              @keydown.enter.prevent="
                openConversation(conversation.conversation_id)
              "
              @keydown.space.prevent="
                openConversation(conversation.conversation_id)
              "
            >
              <VAvatar size="42" class="internal-chat-card-avatar">
                <VImg
                  :src="resolveAvatarSource(conversation.photo)"
                  :alt="resolveConversationTitle(conversation)"
                  cover
                />
              </VAvatar>

              <div class="internal-chat-card-content ms-3 overflow-hidden">
                <div class="d-flex align-center gap-1">
                  <p
                    class="internal-chat-card-title text-base text-high-emphasis mb-0 text-truncate"
                    :title="resolveConversationTitle(conversation)"
                  >
                    {{ resolveConversationTitle(conversation) }}
                  </p>
                  <span
                    v-if="isGroupConversation(conversation)"
                    class="internal-chat-group-indicator"
                  >
                    <VIcon size="13">tabler-users-group</VIcon>
                    {{ t('internal_chat_group_badge') }}
                  </span>
                </div>
                <p
                  v-if="resolveConversationPreview(conversation)"
                  class="internal-chat-card-preview mb-0 text-body-2 text-medium-emphasis text-truncate"
                >
                  {{ resolveConversationPreview(conversation) }}
                </p>
              </div>

              <div class="internal-chat-card-meta ms-2">
                <span
                  v-if="conversation.last_message_at"
                  class="internal-chat-card-date text-body-2 text-disabled"
                >
                  {{ formatConversationDate(conversation.last_message_at) }}
                </span>
                <VBadge
                  v-if="conversation.unread_count > 0"
                  :content="resolveUnreadCount(conversation.unread_count)"
                  color="error"
                  inline
                  class="internal-chat-card-unread"
                />
              </div>
            </li>
          </ul>
        </template>

        <div v-if="canShowSidebarEmpty" class="internal-chat-empty-state">
          <VAvatar size="54" variant="tonal" color="primary" class="mb-2">
            <VIcon size="26">{{ sidebarEmptyIcon }}</VIcon>
          </VAvatar>
          <span>{{ sidebarEmptyText }}</span>
        </div>

        <ul
          v-if="isSidebarLoading && hasSidebarItems && loadingSidebarAppend"
          class="internal-chat-card-list internal-chat-skeleton-list internal-chat-skeleton-list--append"
          aria-hidden="true"
        >
          <li
            v-for="item in sidebarAppendSkeletonItems"
            :key="`sidebar-append-skeleton-${activeSidebarTab}-${item}`"
            class="internal-chat-card internal-chat-skeleton-card d-flex align-center"
            :class="{ 'internal-chat-card--user': isUsersTab }"
          >
            <span class="internal-chat-skeleton-avatar" />
            <span class="internal-chat-skeleton-content">
              <span class="internal-chat-skeleton-line" />
              <span
                v-if="!isUsersTab"
                class="internal-chat-skeleton-line internal-chat-skeleton-line--short"
              />
            </span>
            <span v-if="!isUsersTab" class="internal-chat-skeleton-meta">
              <span
                class="internal-chat-skeleton-line internal-chat-skeleton-line--date"
              />
              <span class="internal-chat-skeleton-dot" />
            </span>
          </li>
        </ul>
      </div>
    </aside>

    <section class="internal-chat-main d-flex flex-column">
      <template v-if="activeConversation">
        <div class="internal-chat-main-header d-flex align-center px-4 py-3">
          <button
            type="button"
            class="internal-chat-main-header-profile internal-chat-main-header-profile--clickable"
            @click="openConversationInfo"
          >
            <VAvatar size="38" class="internal-chat-main-avatar">
              <VImg
                :src="resolveAvatarSource(activeConversation.photo)"
                :alt="resolveConversationTitle(activeConversation)"
                cover
              />
            </VAvatar>

            <div class="ms-3 overflow-hidden text-start">
              <div
                class="text-subtitle-1 font-weight-medium text-truncate d-flex align-center gap-1"
              >
                <span class="text-truncate">
                  {{ resolveConversationTitle(activeConversation) }}
                </span>
                <span
                  v-if="isActiveGroupConversation"
                  class="internal-chat-group-indicator internal-chat-group-indicator--header"
                >
                  <VIcon size="13">tabler-users-group</VIcon>
                  {{ t('internal_chat_group_badge') }}
                </span>
              </div>
              <div v-if="firstActivity" class="text-caption text-primary">
                {{ activityLabel }}
              </div>
            </div>
          </button>

          <VSpacer />

          <div class="internal-chat-main-actions">
            <IconBtn
              color="error"
              :aria-label="closeConversationActionLabel"
              @click="openCloseConversationDialog"
            >
              <VIcon size="20">tabler-x</VIcon>
              <VTooltip activator="parent" location="bottom">
                {{ closeConversationActionLabel }}
              </VTooltip>
            </IconBtn>

            <VMenu location="bottom end">
              <template #activator="{ props }">
                <IconBtn
                  v-bind="props"
                  :aria-label="t('internal_chat_more_options')"
                >
                  <VIcon size="20">tabler-dots-vertical</VIcon>
                  <VTooltip activator="parent" location="bottom">
                    {{ t('internal_chat_more_options') }}
                  </VTooltip>
                </IconBtn>
              </template>

              <VList density="compact" min-width="190">
                <VListItem @click="openConversationInfo">
                  <template #prepend>
                    <VIcon size="18">tabler-info-circle</VIcon>
                  </template>
                  <VListItemTitle>
                    {{ t('internal_chat_information') }}
                  </VListItemTitle>
                </VListItem>
              </VList>
            </VMenu>
          </div>
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
              {{ t('internal_chat_load_previous_messages') }}
            </VBtn>
          </div>

          <div
            v-for="message in messages"
            :key="message.message_id"
            class="internal-chat-message-row"
            :class="{
              'internal-chat-message-row--mine': isOwnMessage(message),
            }"
            @mouseenter="onMessageMouseEnter(message)"
            @mouseleave="onMessageMouseLeave"
          >
            <div
              class="internal-chat-message-shell"
              :class="{
                'internal-chat-message-shell--mine': isOwnMessage(message),
              }"
            >
              <button
                v-if="
                  hoveredMessageId === message.message_id &&
                  canInteractWithMessage(message) &&
                  showReactionPicker !== message.message_id
                "
                type="button"
                class="internal-chat-reaction-trigger"
                :class="{
                  'internal-chat-reaction-trigger--mine': isOwnMessage(message),
                }"
                :aria-label="t('internal_chat_react_to_message')"
                @click.stop="toggleReactionPicker(message)"
              >
                <VIcon size="20">tabler-mood-smile</VIcon>
              </button>

              <div
                class="internal-chat-message-bubble"
                :class="{
                  'internal-chat-message-bubble--mine': isOwnMessage(message),
                  'internal-chat-message-bubble--deleted':
                    isDeletedMessage(message),
                  'internal-chat-message-bubble--with-reactions':
                    message.content?.reactions?.length,
                }"
              >
                <div class="d-flex align-center justify-space-between mb-1">
                  <span class="text-caption text-medium-emphasis">
                    {{ message.user?.name || t('internal_chat_system_user') }}
                  </span>

                  <div class="d-flex align-center gap-1">
                    <span class="text-caption text-medium-emphasis">
                      {{ formatMessageDate(message.date) }}
                    </span>

                    <VMenu
                      v-if="canInteractWithMessage(message)"
                      location="bottom end"
                      offset="6"
                    >
                      <template #activator="{ props }">
                        <IconBtn size="x-small" v-bind="props">
                          <VIcon size="16">tabler-chevron-down</VIcon>
                        </IconBtn>
                      </template>

                      <VList density="compact" min-width="180">
                        <VListItem @click="onReply(message)">
                          <template #prepend>
                            <VIcon size="18">tabler-corner-up-left</VIcon>
                          </template>
                          <VListItemTitle>
                            {{ t('internal_chat_reply_action') }}
                          </VListItemTitle>
                        </VListItem>

                        <VListItem
                          v-if="shouldShowCopy(message)"
                          @click="copyMessage(message)"
                        >
                          <template #prepend>
                            <VIcon size="18">tabler-copy</VIcon>
                          </template>
                          <VListItemTitle>
                            {{ t('internal_chat_copy_action') }}
                          </VListItemTitle>
                        </VListItem>

                        <VListItem
                          v-if="shouldShowDownload(message)"
                          @click="downloadMessage(message)"
                        >
                          <template #prepend>
                            <VIcon size="18">tabler-download</VIcon>
                          </template>
                          <VListItemTitle>
                            {{ t('internal_chat_download_action') }}
                          </VListItemTitle>
                        </VListItem>

                        <VListItem @click="openForwardDialog(message)">
                          <template #prepend>
                            <VIcon size="18">tabler-arrow-forward-up</VIcon>
                          </template>
                          <VListItemTitle>
                            {{ t('internal_chat_forward_action') }}
                          </VListItemTitle>
                        </VListItem>

                        <VListItem @click="toggleReactionPicker(message)">
                          <template #prepend>
                            <VIcon size="18">tabler-mood-smile</VIcon>
                          </template>
                          <VListItemTitle>
                            {{ t('internal_chat_react_action') }}
                          </VListItemTitle>
                        </VListItem>

                        <VListItem
                          v-if="canEditInternalMessage(message)"
                          @click="onEdit(message)"
                        >
                          <template #prepend>
                            <VIcon size="18">tabler-edit</VIcon>
                          </template>
                          <VListItemTitle>
                            {{ t('internal_chat_edit_action') }}
                          </VListItemTitle>
                        </VListItem>

                        <VListItem
                          v-if="isOwnMessage(message)"
                          @click="onDelete(message)"
                        >
                          <template #prepend>
                            <VIcon size="18">tabler-trash</VIcon>
                          </template>
                          <VListItemTitle>
                            {{ t('internal_chat_delete_action') }}
                          </VListItemTitle>
                        </VListItem>
                      </VList>
                    </VMenu>
                  </div>
                </div>

                <button
                  v-if="showQuotedMessage(message)"
                  type="button"
                  class="internal-chat-quoted mb-2 px-2 py-1"
                >
                  <span class="text-caption text-primary">
                    {{ resolveQuotedName(message) }}
                  </span>
                  <div class="text-body-2 text-truncate">
                    {{ resolveQuotedText(message) }}
                  </div>
                </button>

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
                  :alt="t('internal_chat_image_alt')"
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
                  rel="noopener"
                  class="internal-chat-document-link"
                >
                  <VIcon size="18">tabler-file</VIcon>
                  <span class="text-truncate">
                    {{
                      message.content.document.name ||
                      t('internal_chat_document_fallback')
                    }}
                  </span>
                </a>

                <a
                  v-if="message.content?.location"
                  class="d-inline-flex align-center text-decoration-none mt-1"
                  target="_blank"
                  rel="noopener"
                  :href="`https://www.google.com/maps?q=${message.content.location.latitude},${message.content.location.longitude}`"
                >
                  <VIcon size="16" class="me-1">tabler-map-pin</VIcon>
                  {{
                    message.content.location.name ||
                    message.content.location.address ||
                    t('internal_chat_location_fallback')
                  }}
                </a>

                <div
                  v-if="message.content?.contact || message.content?.contacts"
                  class="text-body-2 mt-1"
                >
                  {{
                    message.content.contact?.name ||
                    message.content.contacts
                      ?.map((item) => item.name)
                      .join(', ')
                  }}
                </div>

                <div
                  v-if="message.content?.reactions?.length"
                  class="internal-chat-reactions-summary"
                  :class="{
                    'internal-chat-reactions-summary--mine':
                      isOwnMessage(message),
                  }"
                >
                  <span
                    v-for="reaction in getReactionsSummary(
                      message.content.reactions
                    )"
                    :key="`${message.message_id}-reaction-${reaction.emoji}`"
                    class="internal-chat-reaction-summary-item"
                  >
                    <span>{{ reaction.emoji }}</span>
                    <span>{{ reaction.count }}</span>
                  </span>
                </div>

                <div
                  v-if="
                    showReactionPicker === message.message_id &&
                    canInteractWithMessage(message)
                  "
                  class="internal-chat-reaction-picker"
                  :class="{
                    'internal-chat-reaction-picker--mine':
                      isOwnMessage(message),
                  }"
                  @click.stop
                >
                  <div class="internal-chat-reaction-picker-row">
                    <VBtn
                      v-for="emoji in quickReactions"
                      :key="emoji"
                      icon
                      size="32"
                      variant="text"
                      class="internal-chat-reaction-option"
                      @click="onReact(message, emoji)"
                    >
                      <span class="text-h6">{{ emoji }}</span>
                    </VBtn>

                    <VDivider vertical class="mx-1" />

                    <VBtn
                      icon
                      size="32"
                      variant="text"
                      class="internal-chat-reaction-option"
                      @click.stop="toggleEmojiPicker(message.message_id)"
                    >
                      <VIcon size="20">tabler-plus</VIcon>
                    </VBtn>
                  </div>

                  <div
                    v-if="showEmojiPicker === message.message_id"
                    class="internal-chat-emoji-picker"
                  >
                    <Picker
                      :data="reactionEmojiIndex"
                      :per-line="8"
                      :show-preview="false"
                      :show-skin-tones="false"
                      :show-search="true"
                      @select="onSelectReactionEmoji(message, $event)"
                    />
                  </div>
                </div>
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
                {{ t('internal_chat_replying_to') }}
                {{ resolveMessageText(replyMessage) || t('internal_chat_message') }}
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

          <div
            v-if="isRecordingAudio"
            class="internal-chat-recording-bar d-flex align-center gap-3 px-4"
          >
            <IconBtn
              class="internal-chat-composer-btn"
              :aria-label="t('internal_chat_cancel_recording')"
              @click="cancelAudioRecording"
            >
              <VIcon size="20">tabler-trash</VIcon>
            </IconBtn>

            <span class="internal-chat-recording-dot"></span>
            <span class="internal-chat-recording-clock">
              {{ formattedRecordingDuration }}
            </span>
            <span class="text-body-2 text-medium-emphasis flex-grow-1">
              {{ t('internal_chat_recording_audio') }}
            </span>

            <VBtn
              class="internal-chat-send-btn"
              color="success"
              variant="flat"
              icon
              rounded="pill"
              :aria-label="t('internal_chat_send_audio')"
              @click="stopAudioRecording"
            >
              <VIcon size="20">tabler-send</VIcon>
            </VBtn>
          </div>

          <VTextarea
            v-else
            v-model="composerText"
            :rows="1"
            :max-rows="8"
            auto-grow
            variant="solo"
            density="comfortable"
            :placeholder="t('internal_chat_type_message')"
            class="internal-chat-textarea internal-chat-whats-composer"
            @keydown.enter.exact.prevent="sendMessage"
          >
            <template #prepend-inner>
              <VMenu
                offset="8"
                :close-on-content-click="true"
                location="top start"
              >
                <template #activator="{ props }">
                  <IconBtn
                    v-bind="props"
                    class="internal-chat-composer-btn"
                    :aria-label="t('internal_chat_attach')"
                  >
                    <VIcon size="22">tabler-plus</VIcon>
                  </IconBtn>
                </template>

                <VList
                  density="comfortable"
                  min-width="220"
                  class="internal-chat-attach-menu"
                >
                  <VListItem @click="documentInputRef?.click()">
                    <template #prepend>
                      <VIcon size="20">tabler-file</VIcon>
                    </template>
                    <VListItemTitle>
                      {{ t('internal_chat_documents') }}
                    </VListItemTitle>
                  </VListItem>
                  <VListItem @click="imageInputRef?.click()">
                    <template #prepend>
                      <VIcon size="20">tabler-photo</VIcon>
                    </template>
                    <VListItemTitle>
                      {{ t('internal_chat_photos') }}
                    </VListItemTitle>
                  </VListItem>
                  <VListItem @click="videoInputRef?.click()">
                    <template #prepend>
                      <VIcon size="20">tabler-video</VIcon>
                    </template>
                    <VListItemTitle>
                      {{ t('internal_chat_videos') }}
                    </VListItemTitle>
                  </VListItem>
                  <VListItem @click="audioInputRef?.click()">
                    <template #prepend>
                      <VIcon size="20">tabler-headphones</VIcon>
                    </template>
                    <VListItemTitle>
                      {{ t('internal_chat_audio') }}
                    </VListItemTitle>
                  </VListItem>
                  <VListItem @click="isContactDialogOpen = true">
                    <template #prepend>
                      <VIcon size="20">tabler-user</VIcon>
                    </template>
                    <VListItemTitle>
                      {{ t('internal_chat_contact') }}
                    </VListItemTitle>
                  </VListItem>
                  <VListItem @click="isLocationDialogOpen = true">
                    <template #prepend>
                      <VIcon size="20">tabler-map-pin</VIcon>
                    </template>
                    <VListItemTitle>
                      {{ t('internal_chat_location') }}
                    </VListItemTitle>
                  </VListItem>
                </VList>
              </VMenu>

              <VMenu
                v-model="isComposerEmojiOpen"
                location="top start"
                :close-on-content-click="false"
                offset="8"
              >
                <template #activator="{ props }">
                  <IconBtn
                    v-bind="props"
                    class="internal-chat-composer-btn"
                  :aria-label="t('internal_chat_emoji')"
                  >
                    <VIcon size="22">tabler-mood-smile</VIcon>
                  </IconBtn>
                </template>

                <div class="internal-chat-composer-emoji-picker">
                  <Picker
                    :data="reactionEmojiIndex"
                    :per-line="8"
                    :show-preview="false"
                    :show-search="true"
                    :show-skin-tones="false"
                    @select="onComposerEmojiSelect"
                  />
                </div>
              </VMenu>
            </template>

            <template #append-inner>
              <div class="d-flex align-center gap-1">
                <IconBtn
                  v-if="!hasComposerContent"
                  class="internal-chat-composer-btn internal-chat-mic-btn"
                  :aria-label="t('internal_chat_record_audio')"
                  :disabled="recordingStarting"
                  @click="startAudioRecording"
                >
                  <VIcon size="22">tabler-microphone</VIcon>
                </IconBtn>

                <VBtn
                  v-if="hasComposerContent"
                  class="internal-chat-send-btn"
                  color="success"
                  variant="flat"
                  icon
                  rounded="pill"
                  :aria-label="t('internal_chat_send_message')"
                  :loading="sendingMessage"
                  @click="sendMessage"
                >
                  <VIcon size="22">tabler-send</VIcon>
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
        <div class="text-subtitle-1 mb-1">{{ t('internal_chat_title') }}</div>
        <div class="text-body-2">
          {{
            isUsersTab
              ? t('internal_chat_empty_pick_user')
              : t('internal_chat_empty_pick_conversation')
          }}
        </div>
      </div>
    </section>

    <VNavigationDrawer
      v-model="isGroupInfoDrawerOpen"
      location="end"
      temporary
      width="390"
      class="internal-chat-group-info-drawer"
    >
      <div v-if="activeConversation" class="internal-chat-group-info">
        <div class="internal-chat-group-info-header">
          <IconBtn @click="closeGroupInfoDrawer">
            <VIcon size="20">tabler-x</VIcon>
          </IconBtn>
          <div class="text-subtitle-1 font-weight-medium">
            {{ t('internal_chat_group_data') }}
          </div>
        </div>

        <VDivider />

        <div class="internal-chat-group-hero">
          <div class="internal-chat-group-hero-photo">
            <VAvatar size="104" class="internal-chat-group-hero-avatar">
              <VImg
                :src="resolveAvatarSource(activeConversation.photo)"
                :alt="resolveConversationTitle(activeConversation)"
                cover
              />
            </VAvatar>

            <VBtn
              v-if="canEditActiveGroup"
              icon
              size="small"
              color="primary"
              variant="flat"
              class="internal-chat-group-hero-photo-btn"
              :loading="updatingGroupInfo"
              :aria-label="t('internal_chat_edit_group_photo')"
              @click="openGroupInfoPhotoPicker"
            >
              <VIcon size="18">tabler-camera</VIcon>
            </VBtn>

            <input
              ref="groupInfoPhotoInputRef"
              type="file"
              hidden
              accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
              @change="onGroupInfoPhotoSelected"
            />
          </div>

          <template v-if="canEditActiveGroup && isEditingGroupInfoName">
            <div class="internal-chat-group-name-edit">
              <AppTextField
                v-model="groupInfoName"
                class="internal-chat-group-name-edit-field"
                :placeholder="t('internal_chat_group_name_placeholder')"
                density="compact"
                hide-details="auto"
                autofocus
                :maxlength="groupNameMaxLength"
                :rules="groupNameRules"
                :disabled="updatingGroupInfo"
                @keydown.enter.prevent="submitGroupNameUpdate"
                @keydown.esc.prevent="cancelGroupNameEdit"
              />
              <div class="internal-chat-group-name-edit-actions">
                <VBtn
                  icon
                  color="primary"
                  variant="flat"
                  size="x-small"
                  class="internal-chat-group-name-edit-btn"
                  :loading="updatingGroupInfo"
                  :disabled="!canSubmitGroupNameUpdate"
                  :aria-label="t('internal_chat_save_group_name')"
                  @click="submitGroupNameUpdate"
                >
                  <VIcon size="16">tabler-check</VIcon>
                </VBtn>
                <IconBtn
                  size="x-small"
                  class="internal-chat-group-name-edit-btn"
                  :disabled="updatingGroupInfo"
                  :aria-label="t('internal_chat_cancel_group_name_edit')"
                  @click="cancelGroupNameEdit"
                >
                  <VIcon size="16">tabler-x</VIcon>
                </IconBtn>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="internal-chat-group-title-row">
              <div class="internal-chat-group-title">
                {{ resolveConversationTitle(activeConversation) }}
              </div>
              <IconBtn
                v-if="canEditActiveGroup"
                size="x-small"
                class="internal-chat-group-title-edit-btn"
                :aria-label="t('internal_chat_edit_group_name')"
                @click="startGroupNameEdit"
              >
                <VIcon size="16">tabler-pencil</VIcon>
                <VTooltip activator="parent" location="bottom">
                  {{ t('internal_chat_edit_group_name') }}
                </VTooltip>
              </IconBtn>
            </div>
          </template>

          <div class="text-body-2 text-medium-emphasis">
            {{
              t('internal_chat_participants_count', {
                count: groupMembers.length,
              })
            }}
          </div>
        </div>

        <VDivider />

        <div class="internal-chat-group-info-section">
          <div class="internal-chat-group-info-section-title">
            {{ t('internal_chat_participants') }}
          </div>

          <VBtn
            v-if="canManageActiveGroupMembers"
            variant="tonal"
            color="primary"
            block
            class="mb-3"
            @click="openAddGroupMembersDialog"
          >
            <VIcon size="18" class="me-2">tabler-user-plus</VIcon>
            {{ t('internal_chat_add_member') }}
          </VBtn>

          <div
            v-if="loadingGroupMembers"
            class="internal-chat-group-member-skeleton-list"
          >
            <div
              v-for="item in sidebarInitialSkeletonItems"
              :key="`member-skeleton-${item}`"
              class="internal-chat-group-member-row"
            >
              <span class="internal-chat-skeleton-avatar" />
              <span class="internal-chat-skeleton-content">
                <span class="internal-chat-skeleton-line" />
                <span
                  class="internal-chat-skeleton-line internal-chat-skeleton-line--short"
                />
              </span>
            </div>
          </div>

          <div v-else class="internal-chat-group-members">
            <div
              v-for="member in groupMembers"
              :key="member.user_id"
              class="internal-chat-group-member-row"
            >
              <VAvatar size="40" class="flex-shrink-0">
                <VImg
                  :src="resolveAvatarSource(member.photo)"
                  :alt="resolveParticipantName(member)"
                  cover
                />
              </VAvatar>

              <div class="internal-chat-group-member-main">
                <div class="d-flex align-center gap-2">
                  <span class="text-body-2 font-weight-medium text-truncate">
                    {{ resolveParticipantName(member) }}
                  </span>
                  <span
                    v-if="
                      member.role ===
                      EInternalChatConversationParticipantRole.leader
                    "
                    class="internal-chat-leader-chip"
                  >
                    <VIcon size="14">tabler-crown</VIcon>
                    {{ t('internal_chat_leader') }}
                  </span>
                </div>
              </div>

              <VMenu
                v-if="member.user_id !== internalChatStore.currentUserId"
                location="bottom end"
              >
                <template #activator="{ props }">
                  <IconBtn size="small" v-bind="props">
                    <VIcon size="18">tabler-dots-vertical</VIcon>
                  </IconBtn>
                </template>

                <VList density="compact" min-width="210">
                  <VListItem @click="openConversationFromGroupMember(member)">
                    <template #prepend>
                      <VIcon size="18">tabler-message-circle</VIcon>
                    </template>
                    <VListItemTitle>
                      {{ t('internal_chat_talk') }}
                    </VListItemTitle>
                  </VListItem>

                  <VDivider v-if="canManageActiveGroupMembers" />

                  <VListItem
                    v-if="
                      canManageActiveGroupMembers &&
                      canTransferActiveGroupLeader &&
                      member.role !==
                        EInternalChatConversationParticipantRole.leader
                    "
                    :disabled="
                      transferringLeaderUserIds.includes(member.user_id)
                    "
                    @click="transferGroupLeader(member)"
                  >
                    <template #prepend>
                      <VIcon size="18">tabler-crown</VIcon>
                    </template>
                    <VListItemTitle>
                      {{ t('internal_chat_change_leader') }}
                    </VListItemTitle>
                  </VListItem>

                  <VListItem
                    v-if="canManageActiveGroupMembers"
                    color="error"
                    :disabled="
                      removingGroupMemberUserIds.includes(member.user_id)
                    "
                    @click="removeGroupMember(member)"
                  >
                    <template #prepend>
                      <VIcon size="18">tabler-user-minus</VIcon>
                    </template>
                    <VListItemTitle>
                      {{ t('internal_chat_remove_member') }}
                    </VListItemTitle>
                  </VListItem>
                </VList>
              </VMenu>
            </div>
          </div>
        </div>
      </div>
    </VNavigationDrawer>

    <VNavigationDrawer
      v-model="isUserInfoDrawerOpen"
      location="end"
      temporary
      width="390"
      class="internal-chat-info-drawer"
    >
      <div v-if="activeDirectParticipant" class="internal-chat-user-info">
        <div class="internal-chat-group-info-header">
          <IconBtn @click="closeUserInfoDrawer">
            <VIcon size="20">tabler-x</VIcon>
          </IconBtn>
          <div class="text-subtitle-1 font-weight-medium">
            {{ t('internal_chat_user_information') }}
          </div>
        </div>

        <VDivider />

        <div class="internal-chat-user-hero">
          <VAvatar size="104" class="internal-chat-group-hero-avatar">
            <VImg
              :src="resolveAvatarSource(activeDirectParticipant.photo)"
              :alt="resolveConversationParticipantName(activeDirectParticipant)"
              cover
            />
          </VAvatar>

          <div class="internal-chat-user-title">
            {{ resolveConversationParticipantName(activeDirectParticipant) }}
          </div>
        </div>

        <VDivider />

        <div class="internal-chat-info-section">
          <div class="internal-chat-info-row">
            <VIcon size="19">tabler-user</VIcon>
            <div class="internal-chat-info-content">
              <span class="internal-chat-info-label">
                {{ t('internal_chat_name') }}
              </span>
              <span class="internal-chat-info-value">
                {{
                  resolveConversationParticipantName(activeDirectParticipant)
                }}
              </span>
            </div>
          </div>

          <div class="internal-chat-info-row">
            <VIcon size="19">tabler-mail</VIcon>
            <div class="internal-chat-info-content">
              <span class="internal-chat-info-label">
                {{ t('internal_chat_email') }}
              </span>
              <span class="internal-chat-info-value">
                {{ resolveInfoValue(activeDirectParticipant.email) }}
              </span>
            </div>
          </div>

          <div class="internal-chat-info-row">
            <VIcon size="19">tabler-building</VIcon>
            <div class="internal-chat-info-content">
              <span class="internal-chat-info-label">
                {{ t('internal_chat_sector') }}
              </span>
              <span class="internal-chat-info-value">
                {{ resolveInfoValue(activeDirectParticipant.sector) }}
              </span>
            </div>
          </div>

          <div class="internal-chat-info-row">
            <VIcon size="19">tabler-id-badge-2</VIcon>
            <div class="internal-chat-info-content">
              <span class="internal-chat-info-label">
                {{ t('internal_chat_position') }}
              </span>
              <span class="internal-chat-info-value">
                {{ resolveInfoValue(activeDirectParticipant.position) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </VNavigationDrawer>

    <VDialog
      v-model="isCloseConversationDialogOpen"
      max-width="460"
      :persistent="closingConversation"
    >
      <VCard>
        <VCardTitle class="d-flex align-center justify-space-between pa-4">
          <span>{{ closeConversationDialogTitle }}</span>
          <IconBtn
            :disabled="closingConversation"
            @click="closeCloseConversationDialog"
          >
            <VIcon size="20">tabler-x</VIcon>
          </IconBtn>
        </VCardTitle>

        <VDivider />

        <VCardText class="pa-4 text-body-2 text-medium-emphasis">
          {{ closeConversationDialogDescription }}
        </VCardText>

        <VCardActions class="pa-4 pt-0">
          <VSpacer />
          <VBtn
            variant="tonal"
            color="secondary"
            :disabled="closingConversation"
            @click="closeCloseConversationDialog"
          >
            {{ t('internal_chat_cancel') }}
          </VBtn>
          <VBtn
            color="error"
            variant="flat"
            :loading="closingConversation"
            @click="confirmCloseActiveConversation"
          >
            {{ closeConversationActionLabel }}
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>

    <VDialog v-model="isAddGroupMembersDialogOpen" max-width="520">
      <VCard>
        <VCardTitle class="d-flex align-center justify-space-between pa-4">
          <span>{{ t('internal_chat_add_members') }}</span>
          <IconBtn @click="isAddGroupMembersDialogOpen = false">
            <VIcon size="20">tabler-x</VIcon>
          </IconBtn>
        </VCardTitle>

        <VDivider />

        <VCardText class="pa-4">
          <AppTextField
            v-model="groupCandidateSearch"
            prepend-inner-icon="tabler-search"
            :placeholder="t('internal_chat_search_users')"
            density="compact"
            hide-details
            class="mb-3"
          />

          <div
            class="internal-chat-add-members-list"
            @scroll="handleGroupCandidatesScroll"
          >
            <div
              v-if="loadingGroupCandidates && groupCandidateUsers.length === 0"
              class="internal-chat-group-member-skeleton-list"
            >
              <div
                v-for="item in sidebarInitialSkeletonItems"
                :key="`candidate-skeleton-${item}`"
                class="internal-chat-group-member-row"
              >
                <span class="internal-chat-skeleton-avatar" />
                <span class="internal-chat-skeleton-content">
                  <span class="internal-chat-skeleton-line" />
                </span>
              </div>
            </div>

            <template v-else-if="availableGroupCandidates.length > 0">
              <div
                v-for="candidate in availableGroupCandidates"
                :key="candidate.user_id"
                class="internal-chat-group-member-row"
              >
                <VAvatar size="40" class="flex-shrink-0">
                  <VImg
                    :src="resolveAvatarSource(candidate.photo)"
                    :alt="resolveUserName(candidate)"
                    cover
                  />
                </VAvatar>

                <div class="internal-chat-group-member-main">
                  <span class="text-body-2 font-weight-medium text-truncate">
                    {{ resolveUserName(candidate) }}
                  </span>
                </div>

                <VBtn
                  size="small"
                  color="primary"
                  variant="tonal"
                  :loading="
                    addingGroupMemberUserIds.includes(candidate.user_id)
                  "
                  @click="addGroupMember(candidate.user_id)"
                >
                  {{ t('internal_chat_add') }}
                </VBtn>
              </div>

              <div
                v-if="loadingGroupCandidates"
                class="internal-chat-group-member-row"
              >
                <span class="internal-chat-skeleton-avatar" />
                <span class="internal-chat-skeleton-content">
                  <span class="internal-chat-skeleton-line" />
                </span>
              </div>
            </template>

            <div v-else class="internal-chat-members-empty">
              <VAvatar size="42" variant="tonal" color="primary" class="mb-2">
                <VIcon size="22">tabler-users-off</VIcon>
              </VAvatar>
              <span>{{ t('internal_chat_no_users_to_add') }}</span>
            </div>
          </div>
        </VCardText>
      </VCard>
    </VDialog>

    <VDialog v-model="isGroupDialogOpen" max-width="520">
      <DialogCloseBtn
        :disabled="creatingGroup"
        @click="closeCreateGroupDialog"
      />

      <VCard>
        <VCardTitle class="pa-4 pb-3 text-h6">
          {{ t('internal_chat_new_internal_group') }}
        </VCardTitle>

        <VDivider />

        <VCardText class="pa-4">
          <div class="internal-chat-group-photo-field mb-4">
            <div class="internal-chat-group-photo-stack">
              <VBtn
                type="button"
                variant="text"
                class="internal-chat-group-photo-picker"
                :aria-label="t('internal_chat_select_group_photo')"
                :disabled="creatingGroup"
                @click="openGroupPhotoPicker"
              >
                <VAvatar
                  size="72"
                  class="internal-chat-group-photo-avatar"
                  color="primary"
                  variant="tonal"
                >
                  <VImg
                    v-if="groupPhotoPreview"
                    :src="groupPhotoPreview"
                    :alt="t('internal_chat_group_photo_alt')"
                    cover
                  />
                  <VIcon v-else size="30">tabler-users-group</VIcon>
                </VAvatar>
                <span class="internal-chat-group-photo-overlay">
                  <VIcon size="18">tabler-camera</VIcon>
                </span>
              </VBtn>

              <VBtn
                v-if="groupPhotoPreview"
                icon
                size="x-small"
                variant="flat"
                color="secondary"
                class="internal-chat-group-photo-remove"
                :aria-label="t('internal_chat_remove_group_photo')"
                :disabled="creatingGroup"
                @click.stop="clearGroupPhoto"
              >
                <VIcon size="16">tabler-x</VIcon>
              </VBtn>
            </div>

            <input
              ref="groupPhotoInputRef"
              type="file"
              hidden
              accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
              @change="onGroupPhotoSelected"
            />
          </div>

          <AppTextField
            v-model="groupName"
            :label="t('internal_chat_group_name_label')"
            :placeholder="t('internal_chat_group_name_example')"
            class="mb-4"
            :maxlength="groupNameMaxLength"
            :counter="groupNameMaxLength"
            :rules="groupNameRules"
            :disabled="creatingGroup"
          />

          <div class="text-body-2 text-medium-emphasis mb-2">
            {{ t('internal_chat_group_members') }}
          </div>

          <div class="internal-chat-members-list">
            <template v-if="users.length > 0">
              <VCheckbox
                v-for="user in users"
                :key="`group-member-${user.user_id}`"
                v-model="groupMemberUserIds"
                :label="resolveUserName(user)"
                :value="user.user_id"
                :disabled="creatingGroup"
                density="compact"
                hide-details
              />
            </template>

            <div v-else class="internal-chat-members-empty">
              <VAvatar size="42" variant="tonal" color="primary" class="mb-2">
                <VIcon size="22">tabler-users-off</VIcon>
              </VAvatar>
              <span>{{ t('internal_chat_no_users_to_add_group') }}</span>
            </div>
          </div>
        </VCardText>

        <VCardActions class="px-4 pb-4 pt-0 gap-3">
          <VSpacer />
          <VBtn
            variant="tonal"
            color="secondary"
            :disabled="creatingGroup"
            @click="closeCreateGroupDialog"
          >
            {{ t('internal_chat_cancel') }}
          </VBtn>
          <VBtn
            color="primary"
            variant="flat"
            :loading="creatingGroup"
            :disabled="!canSubmitCreateGroup"
            @click="submitCreateGroup"
          >
            {{ t('internal_chat_create_group') }}
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>

    <VDialog v-model="isGroupPhotoCropDialogOpen" max-width="500" persistent>
      <VCard>
        <VCardTitle class="d-flex justify-space-between align-center">
          <span>{{ t('internal_chat_crop_image_title') }}</span>
          <IconBtn
            :disabled="savingGroupPhotoCrop"
            @click="cancelGroupPhotoCrop"
          >
            <VIcon icon="tabler-x" />
          </IconBtn>
        </VCardTitle>

        <VCardText>
          <div class="internal-chat-group-photo-crop-container">
            <img
              ref="groupPhotoCropImageRef"
              :src="groupPhotoCropDialog.imageSrc"
              :alt="t('internal_chat_crop_image_alt')"
              class="internal-chat-group-photo-crop-image"
              @load="initializeGroupPhotoCrop"
            />
            <div
              class="internal-chat-group-photo-crop-area"
              :style="{
                left: `${groupPhotoCropArea.x}px`,
                top: `${groupPhotoCropArea.y}px`,
                width: `${groupPhotoCropArea.width}px`,
                height: `${groupPhotoCropArea.height}px`,
              }"
              @mousedown.stop="startGroupPhotoCropDrag"
              @touchstart.stop="startGroupPhotoCropDrag"
            >
              <div class="internal-chat-group-photo-crop-area-border"></div>
              <div class="internal-chat-group-photo-crop-area-handles">
                <div
                  class="internal-chat-group-photo-crop-handle internal-chat-group-photo-crop-handle--nw"
                  @mousedown.stop="startGroupPhotoCropResize('nw', $event)"
                  @touchstart.stop="startGroupPhotoCropResize('nw', $event)"
                ></div>
                <div
                  class="internal-chat-group-photo-crop-handle internal-chat-group-photo-crop-handle--ne"
                  @mousedown.stop="startGroupPhotoCropResize('ne', $event)"
                  @touchstart.stop="startGroupPhotoCropResize('ne', $event)"
                ></div>
                <div
                  class="internal-chat-group-photo-crop-handle internal-chat-group-photo-crop-handle--sw"
                  @mousedown.stop="startGroupPhotoCropResize('sw', $event)"
                  @touchstart.stop="startGroupPhotoCropResize('sw', $event)"
                ></div>
                <div
                  class="internal-chat-group-photo-crop-handle internal-chat-group-photo-crop-handle--se"
                  @mousedown.stop="startGroupPhotoCropResize('se', $event)"
                  @touchstart.stop="startGroupPhotoCropResize('se', $event)"
                ></div>
              </div>
            </div>
          </div>

          <canvas ref="groupPhotoCropCanvasRef" class="d-none"></canvas>
        </VCardText>

        <VCardActions class="px-4 pb-4 pt-0 gap-3">
          <VSpacer />
          <VBtn
            variant="tonal"
            color="secondary"
            :disabled="savingGroupPhotoCrop"
            @click="cancelGroupPhotoCrop"
          >
            {{ t('internal_chat_cancel') }}
          </VBtn>
          <VBtn
            color="primary"
            variant="flat"
            :loading="savingGroupPhotoCrop"
            :disabled="savingGroupPhotoCrop"
            @click="cropGroupPhoto"
          >
            {{ t('internal_chat_save') }}
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>

    <VDialog v-model="isForwardDialogOpen" max-width="560">
      <VCard :title="t('internal_chat_forward_message_title')">
        <VCardText>
          <div class="text-body-2 text-medium-emphasis mb-2">
            {{ t('internal_chat_forward_destination_conversations') }}
          </div>

          <VCheckbox
            v-for="conversation in conversations"
            :key="`forward-${conversation.conversation_id}`"
            v-model="forwardConversationIds"
            :value="conversation.conversation_id"
            density="comfortable"
            hide-details
            :label="conversation.name || t('internal_chat_default_conversation')"
            :disabled="
              conversation.conversation_id ===
              activeConversation?.conversation_id
            "
          />
        </VCardText>
        <VCardActions class="px-4 pb-4 pt-0">
          <VSpacer />
          <VBtn variant="text" @click="isForwardDialogOpen = false"
            >{{ t('internal_chat_cancel') }}</VBtn
          >
          <VBtn
            color="primary"
            :loading="forwardingMessage"
            :disabled="forwardConversationIds.length === 0"
            @click="submitForward"
          >
            {{ t('internal_chat_forward_action') }}
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>

    <VDialog v-model="isLocationDialogOpen" max-width="520">
      <VCard :title="t('internal_chat_send_location_title')">
        <VCardText>
          <AppTextField
            v-model="locationLatitude"
            :label="t('internal_chat_latitude')"
            placeholder="-23.5505"
            class="mb-3"
          />
          <AppTextField
            v-model="locationLongitude"
            :label="t('internal_chat_longitude')"
            placeholder="-46.6333"
            class="mb-3"
          />
          <AppTextField
            v-model="locationName"
            :label="t('internal_chat_optional_name')"
            class="mb-3"
          />
          <AppTextField
            v-model="locationAddress"
            :label="t('internal_chat_optional_address')"
          />
        </VCardText>
        <VCardActions class="px-4 pb-4 pt-0">
          <VSpacer />
          <VBtn variant="text" @click="isLocationDialogOpen = false">
            {{ t('internal_chat_cancel') }}
          </VBtn>
          <VBtn color="primary" @click="sendLocationMessage">
            {{ t('internal_chat_send_location') }}
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>

    <VDialog v-model="isContactDialogOpen" max-width="520">
      <VCard :title="t('internal_chat_send_contact_title')">
        <VCardText>
          <AppTextField
            v-model="contactName"
            :label="t('internal_chat_contact_name')"
            :placeholder="t('internal_chat_name')"
            class="mb-3"
          />
          <AppTextField
            v-model="contactPhone"
            :label="t('internal_chat_phone')"
            placeholder="+55 11 99999-0000"
          />
        </VCardText>
        <VCardActions class="px-4 pb-4 pt-0">
          <VSpacer />
          <VBtn variant="text" @click="isContactDialogOpen = false">
            {{ t('internal_chat_cancel') }}
          </VBtn>
          <VBtn color="primary" @click="sendContactMessage">
            {{ t('internal_chat_send_contact') }}
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

.internal-chat-sidebar-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.internal-chat-mode-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.07);
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
}

.internal-chat-mode-chip {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
  font-size: 0.9rem;
  white-space: nowrap;
}

.internal-chat-back-btn {
  flex: 0 0 auto;
  min-width: 0;
  padding-inline: 10px;
}

.internal-chat-search-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.internal-chat-current-avatar,
.internal-chat-create-group-btn {
  flex: 0 0 auto;
}

.internal-chat-search-field {
  flex: 1 1 auto;
  min-width: 0;
}

.internal-chat-tabs {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-inline: 4px;
}

.internal-chat-tab-btn {
  flex: 0 0 40px;
  inline-size: 40px;
  block-size: 38px;
  min-width: 40px;
  border-radius: 8px;
  padding: 0;
  text-transform: none;
}

.internal-chat-active-filter {
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
  font-weight: 600;
}

.internal-chat-sidebar-body {
  flex: 1;
  overflow-y: auto;
}

.internal-chat-card-list {
  list-style: none;
  margin: 0;
  padding: 10px 12px;
}

.internal-chat-card {
  min-height: 74px;
  border-radius: 8px;
  padding: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgb(var(--v-theme-surface));
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    color 0.18s ease;

  &:not(:last-child) {
    margin-bottom: 8px;
  }

  &:hover {
    border-color: rgba(var(--v-theme-primary), 0.32);
    background: rgba(var(--v-theme-primary), 0.05);
  }

  &:focus-visible {
    outline: 2px solid rgba(var(--v-theme-primary), 0.42);
    outline-offset: 2px;
  }
}

.internal-chat-card--active {
  border-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  box-shadow: 0 4px 12px rgba(var(--v-theme-primary), 0.22);

  &:hover {
    border-color: rgb(var(--v-theme-primary));
    background: rgb(var(--v-theme-primary));
  }

  .internal-chat-card-title,
  .internal-chat-card-preview,
  .internal-chat-card-date {
    color: rgb(var(--v-theme-on-primary)) !important;
  }

  .internal-chat-card-preview,
  .internal-chat-card-date {
    opacity: 0.82;
  }
}

.internal-chat-card--user {
  min-height: 66px;
}

.internal-chat-card--unread .internal-chat-card-title {
  font-weight: 600;
}

.internal-chat-card-avatar {
  flex: 0 0 auto;
}

.internal-chat-card-content {
  flex: 1 1 auto;
  min-width: 0;
}

.internal-chat-card-title,
.internal-chat-card-preview {
  max-width: 100%;
}

.internal-chat-card-title {
  min-inline-size: 0;
}

.internal-chat-group-indicator {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 999px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
  font-size: 0.68rem;
  font-weight: 600;
  line-height: 1.25;
  padding: 2px 6px;
}

.internal-chat-card--active .internal-chat-group-indicator {
  background: rgba(var(--v-theme-on-primary), 0.16);
  color: rgb(var(--v-theme-on-primary));
}

.internal-chat-card-preview {
  line-height: 1.35;
}

.internal-chat-card-meta {
  min-width: 46px;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: flex-start;
  gap: 8px;
}

.internal-chat-card-date {
  white-space: nowrap;
}

.internal-chat-card-unread {
  margin-inline-start: auto;
}

.internal-chat-skeleton-list--append {
  padding-block-start: 0;
}

.internal-chat-skeleton-card {
  pointer-events: none;

  &:hover {
    border-color: rgba(var(--v-theme-on-surface), 0.12);
    background: rgb(var(--v-theme-surface));
  }
}

.internal-chat-skeleton-avatar,
.internal-chat-skeleton-line,
.internal-chat-skeleton-dot {
  position: relative;
  overflow: hidden;
  background: rgba(var(--v-theme-on-surface), 0.1);

  &::after {
    position: absolute;
    inset: 0;
    content: '';
    transform: translateX(-100%);
    background: linear-gradient(
      90deg,
      transparent,
      rgba(var(--v-theme-surface), 0.72),
      transparent
    );
    animation: internal-chat-skeleton-shimmer 1.35s infinite;
  }
}

.internal-chat-skeleton-avatar {
  flex: 0 0 42px;
  inline-size: 42px;
  block-size: 42px;
  border-radius: 50%;
}

.internal-chat-skeleton-content {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-inline-start: 12px;
}

.internal-chat-skeleton-line {
  inline-size: 72%;
  block-size: 11px;
  border-radius: 999px;
}

.internal-chat-skeleton-line--short {
  inline-size: 52%;
}

.internal-chat-skeleton-meta {
  flex: 0 0 46px;
  align-self: stretch;
  display: flex;
  align-items: flex-end;
  flex-direction: column;
  gap: 11px;
  margin-inline-start: 8px;
  padding-block-start: 2px;
}

.internal-chat-skeleton-line--date {
  inline-size: 34px;
  block-size: 9px;
}

.internal-chat-skeleton-dot {
  inline-size: 20px;
  block-size: 20px;
  border-radius: 50%;
}

.internal-chat-empty-state {
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  color: rgba(var(--v-theme-on-surface), 0.58);
  text-align: center;
  padding: 24px;
  font-size: 0.9rem;
}

.internal-chat-main {
  flex: 1;
  min-width: 0;
}

@keyframes internal-chat-skeleton-shimmer {
  100% {
    transform: translateX(100%);
  }
}

.internal-chat-main-header {
  min-height: 72px;
}

.internal-chat-main-header-profile {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  text-align: start;

  &:disabled {
    cursor: default;
  }
}

.internal-chat-main-header-profile--clickable {
  cursor: pointer;
  border-radius: 8px;
  padding: 4px 8px 4px 0;
  transition: background-color 0.18s ease;

  &:hover {
    background: rgba(var(--v-theme-primary), 0.06);
  }
}

.internal-chat-main-avatar {
  flex: 0 0 auto;
}

.internal-chat-main-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.internal-chat-group-indicator--header {
  font-size: 0.7rem;
}

.internal-chat-message-list {
  flex: 1;
  overflow-y: auto;
}

.internal-chat-message-row {
  display: flex;
  margin-bottom: 14px;
  padding-inline: 6px;
}

.internal-chat-message-row--mine {
  justify-content: flex-end;
}

.internal-chat-message-shell {
  position: relative;
  max-width: min(78%, 720px);
  min-width: 120px;
}

.internal-chat-message-shell--mine {
  display: flex;
  justify-content: flex-end;
}

.internal-chat-message-bubble {
  position: relative;
  min-width: 120px;
  max-width: 100%;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  border-radius: 8px;
  padding: 8px 10px 12px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 1px 2px rgba(var(--v-theme-on-surface), 0.08);
}

.internal-chat-message-bubble--mine {
  background: rgb(217, 253, 211);
  color: rgb(var(--v-theme-title));
}

.internal-chat-message-bubble--deleted {
  opacity: 0.74;
  font-style: italic;
}

.internal-chat-message-bubble--with-reactions {
  margin-bottom: 10px;
}

.internal-chat-message-text {
  white-space: pre-wrap;
  word-break: break-word;
}

.internal-chat-quoted {
  display: block;
  width: 100%;
  border: 0;
  border-left: 3px solid rgb(var(--v-theme-primary));
  border-radius: 6px;
  background: rgba(var(--v-theme-primary), 0.08);
  color: inherit;
  text-align: start;
  cursor: default;
}

.internal-chat-media {
  max-width: 100%;
  border-radius: 8px;
  max-height: 320px;
  display: block;
}

.internal-chat-composer {
  background: rgba(var(--v-theme-background), 0.6);
}

.internal-chat-whats-composer {
  :deep(.v-field) {
    min-height: 48px;
    border-radius: 8px;
    background: rgb(var(--v-theme-surface)) !important;
    box-shadow: 0 2px 8px rgba(var(--v-theme-on-surface), 0.1) !important;
  }

  :deep(.v-field__input) {
    align-items: center;
    padding-block: 0.55rem 0.45rem;
    font-size: 0.9375rem !important;
    line-height: 1.375rem;
    white-space: pre-wrap;
  }

  :deep(textarea) {
    resize: none;
    overflow: hidden;
    line-height: 1.5rem;
    padding-top: 0.7rem !important;
    padding-bottom: 0.45rem !important;
  }

  :deep(.v-field__prepend-inner),
  :deep(.v-field__append-inner) {
    align-items: center;
    padding-block-start: 0;
  }

  :deep(.v-field--prepended) {
    padding-inline-start: 8px;
  }

  :deep(.v-field--appended) {
    padding-inline-end: 8px;
  }
}

.internal-chat-composer-btn {
  color: rgba(var(--v-theme-on-surface), 0.68) !important;
  border-radius: 50% !important;

  &:hover {
    background: rgba(var(--v-theme-on-surface), 0.08) !important;
    color: rgb(var(--v-theme-primary)) !important;
  }
}

.internal-chat-mic-btn {
  color: rgb(var(--v-theme-error)) !important;
}

.internal-chat-send-btn {
  min-width: 42px !important;
  width: 42px !important;
  height: 42px !important;
  border-radius: 999px !important;
  box-shadow: none !important;
}

.internal-chat-attach-menu {
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(var(--v-theme-on-surface), 0.14);
}

.internal-chat-composer-emoji-picker {
  border-radius: 8px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 10px 30px rgba(var(--v-theme-on-surface), 0.14);
}

.internal-chat-recording-bar {
  min-height: 56px;
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 2px 8px rgba(var(--v-theme-on-surface), 0.1);
}

.internal-chat-recording-dot {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgb(var(--v-theme-error));
  animation: internal-chat-recording-pulse 1.4s ease-in-out infinite;
}

.internal-chat-recording-clock {
  min-width: 52px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

@keyframes internal-chat-recording-pulse {
  0%,
  100% {
    opacity: 0.5;
    transform: scale(0.78);
  }

  50% {
    opacity: 1;
    transform: scale(1);
  }
}

.internal-chat-document-link {
  min-width: 220px;
  max-width: 320px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 8px;
  padding: 10px;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: inherit;
  text-decoration: none;
}

.internal-chat-reaction-trigger {
  position: absolute;
  z-index: 12;
  top: 50%;
  left: calc(100% + 6px);
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 50%;
  background: rgb(var(--v-theme-surface));
  box-shadow:
    0 4px 10px rgba(var(--v-theme-on-surface), 0.12),
    0 2px 4px rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.72);
  transform: translateY(-50%);
  cursor: pointer;
  transition:
    transform 0.18s ease,
    color 0.18s ease;

  &:hover {
    color: rgb(var(--v-theme-primary));
    transform: translateY(-50%) scale(1.06);
  }
}

.internal-chat-reaction-trigger--mine {
  right: calc(100% + 6px);
  left: auto;
}

.internal-chat-reactions-summary {
  position: absolute;
  left: 12px;
  bottom: -14px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 22px;
  padding: 2px 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 999px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 1px 2px rgba(var(--v-theme-on-surface), 0.08);
}

.internal-chat-reactions-summary--mine {
  right: 12px;
  left: auto;
}

.internal-chat-reaction-summary-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.76rem;
  line-height: 1;

  span:last-child {
    font-weight: 600;
    color: rgba(var(--v-theme-on-surface), 0.68);
  }
}

.internal-chat-reaction-picker {
  position: absolute;
  z-index: 15;
  top: 50%;
  left: calc(100% + 8px);
  border-radius: 24px;
  background: rgb(var(--v-theme-surface));
  box-shadow:
    0 10px 30px rgba(var(--v-theme-on-surface), 0.14),
    0 2px 10px rgba(var(--v-theme-on-surface), 0.1);
  transform: translateY(-50%);
}

.internal-chat-reaction-picker--mine {
  right: calc(100% + 8px);
  left: auto;
}

.internal-chat-reaction-picker-row {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
}

.internal-chat-reaction-option {
  transition: transform 0.18s ease;

  &:hover {
    transform: scale(1.1);
  }
}

.internal-chat-emoji-picker {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 16;
}

.internal-chat-reaction-picker:not(.internal-chat-reaction-picker--mine)
  .internal-chat-emoji-picker {
  right: auto;
  left: 0;
}

.internal-chat-group-info-drawer,
.internal-chat-info-drawer {
  border-left: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.internal-chat-group-info,
.internal-chat-user-info {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: rgb(var(--v-theme-surface));
}

.internal-chat-group-info-header {
  min-height: 64px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
}

.internal-chat-group-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px 18px;
  text-align: center;
}

.internal-chat-group-hero-photo {
  position: relative;
  width: 112px;
  height: 112px;
}

.internal-chat-group-hero-avatar {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  box-shadow: 0 4px 14px rgba(var(--v-theme-on-surface), 0.12);
}

.internal-chat-group-hero-photo-btn {
  position: absolute;
  right: 4px;
  bottom: 4px;
}

.internal-chat-group-title {
  max-width: 100%;
  font-size: 1.15rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
  word-break: break-word;
}

.internal-chat-group-title-row {
  max-width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.internal-chat-group-title-row .internal-chat-group-title {
  min-width: 0;
}

.internal-chat-group-title-edit-btn {
  flex: 0 0 auto;
  color: rgba(var(--v-theme-on-surface), 0.52) !important;
}

.internal-chat-user-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 28px 18px;
  text-align: center;
}

.internal-chat-user-title {
  max-width: 100%;
  color: rgb(var(--v-theme-on-surface));
  font-size: 1.15rem;
  font-weight: 600;
  word-break: break-word;
}

.internal-chat-info-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
}

.internal-chat-info-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  border-radius: 8px;
  padding: 12px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.internal-chat-info-content {
  min-width: 0;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
}

.internal-chat-info-label {
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 0.76rem;
  font-weight: 600;
  text-transform: uppercase;
}

.internal-chat-info-value {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.92rem;
  line-height: 1.35;
  word-break: break-word;
}

.internal-chat-group-name-edit {
  width: 100%;
  max-width: 356px;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-inline: auto;
}

.internal-chat-group-name-edit-field {
  flex: 1 1 auto;
  min-width: 0;
}

.internal-chat-group-name-edit-actions {
  flex: 0 0 auto;
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding-block-start: 0;
}

.internal-chat-group-name-edit-btn {
  width: 28px !important;
  height: 28px !important;
  min-width: 28px !important;
}

.internal-chat-group-info-section {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.internal-chat-group-info-section-title {
  margin-bottom: 12px;
  color: rgba(var(--v-theme-on-surface), 0.64);
  font-size: 0.82rem;
  font-weight: 600;
  text-transform: uppercase;
}

.internal-chat-group-members,
.internal-chat-group-member-skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.internal-chat-group-member-row {
  min-height: 56px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-radius: 8px;
  padding: 8px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}

.internal-chat-group-member-main {
  min-width: 0;
  flex: 1 1 auto;
}

.internal-chat-leader-chip {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 999px;
  padding: 2px 7px;
  background: rgba(var(--v-theme-warning), 0.16);
  color: rgb(var(--v-theme-warning));
  font-size: 0.72rem;
  font-weight: 700;
}

.internal-chat-add-members-list {
  min-height: 260px;
  max-height: 430px;
  overflow-y: auto;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  padding: 8px;
}

.internal-chat-group-photo-field {
  display: flex;
  align-items: center;
  justify-content: center;
}

.internal-chat-group-photo-stack {
  position: relative;
  block-size: 78px;
  inline-size: 78px;
}

.internal-chat-group-photo-picker {
  position: relative;
  flex: 0 0 auto;
  border-radius: 50%;
  block-size: 78px;
  inline-size: 78px;
  min-inline-size: 78px;
  padding: 0;
}

.internal-chat-group-photo-avatar {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}

.internal-chat-group-photo-overlay {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
  block-size: 28px;
  box-shadow: 0 2px 8px rgba(var(--v-theme-on-surface), 0.18);
  color: rgb(var(--v-theme-on-primary));
  inline-size: 28px;
  inset-block-end: 3px;
  inset-inline-end: 3px;
}

.internal-chat-group-photo-remove {
  position: absolute;
  z-index: 1;
  inset-block-start: -4px;
  inset-inline-end: -4px;
}

.internal-chat-group-photo-crop-container {
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  background: rgba(var(--v-theme-surface-variant), 0.1);
  block-size: 400px;
  inline-size: 100%;
  margin: 0 auto;
  max-inline-size: 400px;
  touch-action: none;
  user-select: none;
}

.internal-chat-group-photo-crop-image {
  position: absolute;
  display: block;
  max-block-size: 100%;
  max-inline-size: 100%;
  pointer-events: none;
  inset-block-start: 50%;
  inset-inline-start: 50%;
  transform: translate(-50%, -50%);
}

.internal-chat-group-photo-crop-area {
  position: absolute;
  z-index: 10;
  border: 2px solid rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.05);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
  cursor: move;
  pointer-events: all;
  touch-action: none;
}

.internal-chat-group-photo-crop-area-border {
  position: absolute;
  border: 2px dashed rgba(255, 255, 255, 0.8);
  inset: 0;
  pointer-events: none;
}

.internal-chat-group-photo-crop-area-handles {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.internal-chat-group-photo-crop-handle {
  position: absolute;
  z-index: 11;
  border: 2px solid white;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
  block-size: 12px;
  cursor: nwse-resize;
  inline-size: 12px;
  pointer-events: all;
}

.internal-chat-group-photo-crop-handle--nw {
  cursor: nwse-resize;
  inset-block-start: -6px;
  inset-inline-start: -6px;
}

.internal-chat-group-photo-crop-handle--ne {
  cursor: nesw-resize;
  inset-block-start: -6px;
  inset-inline-end: -6px;
}

.internal-chat-group-photo-crop-handle--sw {
  cursor: nesw-resize;
  inset-block-end: -6px;
  inset-inline-start: -6px;
}

.internal-chat-group-photo-crop-handle--se {
  cursor: nwse-resize;
  inset-block-end: -6px;
  inset-inline-end: -6px;
}

.internal-chat-members-list {
  min-height: 88px;
  max-height: 280px;
  overflow-y: auto;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  padding: 8px;
}

.internal-chat-members-empty {
  min-height: 104px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  color: rgba(var(--v-theme-on-surface), 0.62);
  text-align: center;
  padding: 16px;
  font-size: 0.9rem;
}

@media (max-width: 959px) {
  .internal-chat-layout {
    flex-direction: column;
  }

  .internal-chat-sidebar {
    width: 100%;
    max-height: 45vh;
  }

  .internal-chat-mode-banner {
    align-items: stretch;
    flex-direction: column;
  }

  .internal-chat-back-btn {
    width: 100%;
  }
}
</style>
