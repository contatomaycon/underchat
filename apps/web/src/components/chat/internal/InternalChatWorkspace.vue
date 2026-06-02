<script setup lang="ts">
import {
  computed,
  nextTick,
  onErrorCaptured,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue';
import { storeToRefs } from 'pinia';
import { refDebounced } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import { PerfectScrollbar } from 'vue3-perfect-scrollbar';
import { MglMap, MglMarker } from 'vue-maplibre-gl';
import axios from '@webcore/axios';
import { useInternalChatStore } from '@/@webcore/stores/internalChat';
import { useInternalChatSocket } from '@/composables/useInternalChatSocket';
import { formatDateToMonthShort } from '@/@webcore/utils/formatters';
import AppContactPicker from '@/components/chat/AppContactPicker.vue';
import ChatLinkPreview from '@/components/chat/ChatLinkPreview.vue';
import ChatLocationPicker from '@/components/chat/ChatLocationPicker.vue';
import ChatMediaViewer from '@/components/chat/ChatMediaViewer.vue';
import InternalChatSearchSidebarContent from '@/components/chat/internal/InternalChatSearchSidebarContent.vue';
import GroupContactMessageCard from '@/components/chat/GroupContactMessageCard.vue';
import { Picker, EmojiIndex } from 'emoji-mart-vue-fast/src';
import data from 'emoji-mart-vue-fast/data/all.json';
import 'emoji-mart-vue-fast/css/emoji-mart.css';
import { extractFirstUrl } from '@core/common/functions/extractFirstUrl';
import { can } from '@layouts/plugins/casl';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EInternalChatPermissions } from '@core/common/enums/EPermissions/internalChat';
import { EInternalChatConversationType } from '@core/common/enums/internalChat/EInternalChatConversationType';
import { EInternalChatConversationParticipantRole } from '@core/common/enums/internalChat/EInternalChatConversationParticipantRole';
import { EInternalChatActivityState } from '@core/common/enums/internalChat/EInternalChatActivityState';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EColor } from '@core/common/enums/EColor';
import type { IApiResponse } from '@core/common/interfaces/IApiResponse';
import type { ListConversationsResponse } from '@core/schema/internalChat/listConversations/response.schema';
import type { ListUsersResponse } from '@core/schema/internalChat/listUsers/response.schema';
import type { ListMessagesResponse } from '@core/schema/internalChat/listMessages/response.schema';
import type { ListGroupMembersResponse } from '@core/schema/internalChat/listGroupMembers/response.schema';
import type { MessageHistoryResponse } from '@core/schema/internalChat/messageHistory/response.schema';
import type { ViewInternalChatLinkPreviewResponse } from '@core/schema/internalChat/viewLinkPreview/response.schema';
import type {
  ISelectedAudioPreview,
  ISelectedContactPreview,
  ISelectedDocumentPreview,
  ISelectedPhotoPreview,
  ISelectedVideoPreview,
} from '@core/common/interfaces/IChatFilePreview';

type InternalConversation =
  ListConversationsResponse['data']['results'][number];
type InternalConversationParticipant =
  InternalConversation['participants'][number];
type InternalUser = ListUsersResponse['data']['results'][number];
type InternalMessage = ListMessagesResponse['data']['results'][number];
type InternalMessageHistoryApiItem =
  MessageHistoryResponse['data']['results'][number];
type InternalLinkPreview = ViewInternalChatLinkPreviewResponse['data'];
type InternalContact = NonNullable<
  InternalMessage['content']['contacts']
>[number];
type InternalParticipant = ListGroupMembersResponse['data'][number];
type InternalUserInfo = {
  user_id: string;
  name: string;
  photo?: string | null;
  email?: string | null;
  sector?: string | null;
  position?: string | null;
};
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
type InternalMediaKind = 'image' | 'video';
type InternalViewerMediaItem = {
  src: string;
  caption?: string;
  downloadName?: string;
  kind: InternalMediaKind;
};
type InternalReplyPreviewContent = Partial<InternalMessage['content']> & {
  message_id?: string | null;
  id?: string | null;
  type?: EMessageType | string | null;
  user_name?: string | null;
  key?: { id?: string | null } | null;
};
type InternalMessageHistoryItem = {
  text: string;
  date: string;
  label: string;
  isCurrent: boolean;
  isDeletedSnapshot: boolean;
};
type InternalMessageDisplayItem =
  | {
      kind: 'date-separator';
      id: string;
      separatorDate: string;
      separatorLabel: string;
    }
  | {
      kind: 'message';
      id: string;
      message: InternalMessage;
    }
  | {
      kind: 'media-group';
      id: string;
      mediaKind: InternalMediaKind;
      messages: InternalMessage[];
      firstMessage: InternalMessage;
      lastMessage: InternalMessage;
      isMine: boolean;
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

const props = withDefaults(
  defineProps<{
    showBackToChat?: boolean;
  }>(),
  {
    showBackToChat: false,
  }
);

const internalChatStore = useInternalChatStore();
const internalChatSocket = useInternalChatSocket();
const { t, getLocaleMessage } = useI18n();

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
const composerTextDebounced = refDebounced(composerText, 350);
const replyMessage = ref<InternalMessage | null>(null);
const hoveredMessageId = ref<string | null>(null);
const showReactionPicker = ref<string | null>(null);
const showEmojiPicker = ref<string | null>(null);
const isComposerEmojiOpen = ref(false);
const ignoreReactionOutsideOnce = ref(false);
const showScrollToBottom = ref(false);
const shouldAutoScrollMessages = ref(true);
const loadingPreviousMessages = ref(false);
const highlightedMessageId = ref<string | null>(null);
const fixedMessageDateLabel = ref('');
const fixedMessageDateIndicatorTop = ref(0);
const fixedMessageDateIndicatorLeft = ref(0);
const fixedMessageDateIndicatorWidth = ref(0);
const shouldShowFixedMessageDate = computed(
  () => showScrollToBottom.value && !!fixedMessageDateLabel.value
);

const selectedImages = ref<ISelectedPhotoPreview[]>([]);
const selectedVideos = ref<ISelectedVideoPreview[]>([]);
const selectedDocuments = ref<ISelectedDocumentPreview[]>([]);
const selectedAudios = ref<ISelectedAudioPreview[]>([]);
const selectedContacts = ref<ISelectedContactPreview[]>([]);
const selectedLocation = ref<{
  latitude: number;
  longitude: number;
  name?: string | null;
  address?: string | null;
} | null>(null);
const linkPreview = ref<InternalLinkPreview | null>(null);
const isLoadingLinkPreview = ref(false);
const isContactPickerOpen = ref(false);
const isLocationPickerOpen = ref(false);
const mediaViewerOpen = ref(false);
const mediaViewerItems = ref<InternalViewerMediaItem[]>([]);
const mediaViewerInitialIndex = ref(0);
const locationModalOpen = ref(false);
const locationData = ref<{
  latitude: number;
  longitude: number;
  name?: string | null;
  address?: string | null;
} | null>(null);
const locationMapRef = ref<any>(null);
const webGLSupported = ref(true);
const mapErrors = reactive<Record<string, boolean>>({});
const contactViewerOpen = ref(false);
const contactViewerContacts = ref<InternalContact[]>([]);
const contactViewerPhoneCache = reactive<Record<string, string>>({});
const contactViewerPhoneDdiCache = reactive<Record<string, string | null>>({});
const contactViewerVisiblePhones = reactive<Record<string, boolean>>({});
const contactViewerPhoneLoading = reactive<Record<string, boolean>>({});

const audioPlayers = ref<Map<string, HTMLAudioElement>>(new Map());
const audioPlayStates = reactive<Record<string, boolean>>({});
const audioCurrentTimes = reactive<Record<string, number>>({});
const audioDurations = reactive<Record<string, number>>({});
const audioWaveforms = reactive<Record<string, number[]>>({});
const audioPlaybackRates = reactive<Record<string, number>>({});

const imageInputRef = ref<HTMLInputElement | null>(null);
const videoInputRef = ref<HTMLInputElement | null>(null);
const documentInputRef = ref<HTMLInputElement | null>(null);
const audioInputRef = ref<HTMLInputElement | null>(null);
const sidebarBodyRef = ref<HTMLElement | null>(null);
const messageListScrollRef = ref<InstanceType<typeof PerfectScrollbar> | null>(
  null
);
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

const isGroupInfoDrawerOpen = ref(false);
const isUserInfoDrawerOpen = ref(false);
const isSearchDrawerOpen = ref(false);
const selectedUserInfo = ref<InternalUserInfo | null>(null);
const selectedUserInfoConversationUserId = ref<string | null>(null);
const isCloseConversationDialogOpen = ref(false);
const isEditMessageDialogOpen = ref(false);
const editMessageTarget = ref<InternalMessage | null>(null);
const editMessageText = ref('');
const isDeleteMessageDialogOpen = ref(false);
const deleteMessageTarget = ref<InternalMessage | null>(null);
const isMessageHistoryDialogOpen = ref(false);
const messageHistoryTarget = ref<InternalMessage | null>(null);
const messageHistoryItems = ref<InternalMessageHistoryItem[]>([]);
const loadingMessageHistory = ref(false);
const groupInfoName = ref('');
const isEditingGroupInfoName = ref(false);
const updatingGroupInfo = ref(false);
const closingConversation = ref(false);
const editingMessage = ref(false);
const deletingMessage = ref(false);
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

const isRecordingAudio = ref(false);
const isRecordingPaused = ref(false);
const recordingStarting = ref(false);
const recordingSending = ref(false);
const mediaRecorderRef = ref<MediaRecorder | null>(null);
const mediaStreamRef = ref<MediaStream | null>(null);
const audioContextRef = ref<AudioContext | null>(null);
const audioAnalyserRef = ref<AnalyserNode | null>(null);
const audioDataArrayRef = ref<Uint8Array | null>(null);
const audioCanvasRef = ref<HTMLCanvasElement | null>(null);
const audioChunksRef = ref<Blob[]>([]);
const recordingStartAt = ref<number | null>(null);
const recordingAccumulatedMs = ref(0);
const recordingDurationMs = ref(0);
const recordingTimer = ref<ReturnType<typeof setInterval> | null>(null);
const recordingAnimationFrame = ref<number | null>(null);
const shouldSendRecording = ref(false);
const activityCleanupTimer = ref<ReturnType<typeof setInterval> | null>(null);
let highlightedMessageTimer: ReturnType<typeof setTimeout> | null = null;
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
const maxComposerFiles = 10;
const maxDocumentSizeBytes = 100 * 1024 * 1024;
const maxImageSizeBytes = 16 * 1024 * 1024;
const maxVideoSizeBytes = 100 * 1024 * 1024;
const maxAudioSizeBytes = 16 * 1024 * 1024;
const sidebarInitialSkeletonItems = [1, 2, 3, 4];
const sidebarAppendSkeletonItems = [1, 2];
const quickReactions = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const reactionEmojiIndex = new EmojiIndex(data);
const internalDocumentIconMap: Record<string, string> = {
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
let groupPhotoPreviewUrl: string | null = null;

const resolveAvatarSource = (photo?: string | null): string => {
  return photo?.trim() || avatarFallback;
};

const resolveMessageAvatarSource = (message: InternalMessage): string => {
  return resolveAvatarSource(message.user?.photo);
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
const canStartConversationFromSelectedUserInfo = computed(() => {
  const userId = selectedUserInfoConversationUserId.value;

  return (
    isActiveGroupConversation.value &&
    Boolean(userId) &&
    userId !== internalChatStore.currentUserId
  );
});
const canSubmitEditMessage = computed(() => {
  const nextText = editMessageText.value.trim();
  const currentText = editMessageTarget.value?.content?.message?.trim() ?? '';

  return (
    Boolean(editMessageTarget.value) &&
    nextText.length > 0 &&
    nextText !== currentText &&
    !editingMessage.value
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
  return (
    isSidebarLoading.value &&
    !loadingSidebarAppend.value &&
    !hasSidebarItems.value
  );
});

const canShowSidebarEmpty = computed(() => {
  return !hasSidebarItems.value && !isSidebarLoading.value;
});

const hasAnyAttachment = computed(() => {
  return (
    selectedImages.value.length > 0 ||
    selectedVideos.value.length > 0 ||
    selectedDocuments.value.length > 0 ||
    selectedAudios.value.length > 0 ||
    selectedContacts.value.length > 0 ||
    selectedLocation.value !== null
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

const mapStyle = computed(() => ({
  version: 8,
  sources: {
    'osm-tiles': {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    {
      id: 'osm-tiles-layer',
      type: 'raster',
      source: 'osm-tiles',
      minzoom: 0,
      maxzoom: 22,
    },
  ],
}));

const mapCenter = computed<[number, number]>(() => {
  if (!locationData.value) return [0, 0];
  return [locationData.value.longitude, locationData.value.latitude];
});

const mapZoom = computed(() => 15);

const markerPosition = computed<[number, number]>(() => {
  if (!locationData.value) return [0, 0];
  return [locationData.value.longitude, locationData.value.latitude];
});

const isWebGLSupported = (): boolean => {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return !!gl;
  } catch {
    return false;
  }
};

onErrorCaptured((err) => {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message.includes('WebGL') ||
    message.includes('webglcontextcreationerror') ||
    message.includes('Failed to initialize WebGL')
  ) {
    webGLSupported.value = false;
    return false;
  }

  return true;
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

const formatMessageDateSeparator = (value?: string | null): string => {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const messageDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );

  if (messageDate.getTime() === today.getTime()) return t('today');

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (messageDate.getTime() === yesterday.getTime()) return t('yesterday');

  const diffMs = today.getTime() - messageDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays > 0 && diffDays < 7) {
    const weekdays = [
      t('sunday'),
      t('monday'),
      t('tuesday'),
      t('wednesday'),
      t('thursday'),
      t('friday'),
      t('saturday'),
    ];
    return weekdays[date.getDay()];
  }

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
};

const isSameMessageDay = (
  dateA?: string | null,
  dateB?: string | null
): boolean => {
  if (!dateA || !dateB) return false;

  const firstDate = new Date(dateA);
  const secondDate = new Date(dateB);

  if (Number.isNaN(firstDate.getTime()) || Number.isNaN(secondDate.getTime())) {
    return false;
  }

  return (
    firstDate.getDate() === secondDate.getDate() &&
    firstDate.getMonth() === secondDate.getMonth() &&
    firstDate.getFullYear() === secondDate.getFullYear()
  );
};

const resolveConversationTitle = (
  conversation?: InternalConversation | null
): string => {
  return conversation?.name?.trim() || t('internal_chat_default_conversation');
};

const internalChatPreviewTranslationKeys = [
  'internal_chat_preview_image',
  'internal_chat_preview_video',
  'internal_chat_preview_audio',
  'internal_chat_preview_document',
  'internal_chat_preview_location',
  'internal_chat_preview_contact',
  'internal_chat_preview_contacts',
  'internal_chat_preview_group_event',
] as const;
type InternalChatPreviewTranslationKey =
  (typeof internalChatPreviewTranslationKeys)[number];
const internalChatPreviewTranslationKeySet = new Set<string>(
  internalChatPreviewTranslationKeys
);
const legacyInternalChatPreviewTranslationKeys = computed(() => {
  const ptMessages = getLocaleMessage('pt') as Record<string, unknown>;

  return internalChatPreviewTranslationKeys.reduce<
    Record<string, InternalChatPreviewTranslationKey>
  >((acc, key) => {
    const legacyPreview = ptMessages[key];
    if (typeof legacyPreview === 'string') {
      acc[legacyPreview] = key;
    }

    return acc;
  }, {});
});

const translateInternalChatPreview = (preview: string): string => {
  const translationKey = internalChatPreviewTranslationKeySet.has(preview)
    ? (preview as InternalChatPreviewTranslationKey)
    : legacyInternalChatPreviewTranslationKeys.value[preview];

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

const resolveUserInfoName = (info?: InternalUserInfo | null): string => {
  return info?.name?.trim() || t('internal_chat_unknown_user');
};

const buildUserInfo = (source: {
  user_id: string;
  name?: string | null;
  photo?: string | null;
  email?: string | null;
  sector?: string | null;
  position?: string | null;
}): InternalUserInfo => {
  return {
    user_id: source.user_id,
    name: source.name?.trim() || t('internal_chat_unknown_user'),
    photo: source.photo ?? null,
    email: source.email ?? null,
    sector: source.sector ?? null,
    position: source.position ?? null,
  };
};

const findKnownUserInfoByUserId = (userId: string): InternalUserInfo | null => {
  const conversationParticipant = activeConversation.value?.participants.find(
    (participant) => participant.user_id === userId
  );

  if (conversationParticipant) {
    return buildUserInfo(conversationParticipant);
  }

  const groupMember = groupMembers.value.find(
    (member) => member.user_id === userId
  );

  if (groupMember) {
    return buildUserInfo(groupMember);
  }

  if (userId === internalChatStore.currentUserId && user.value?.info) {
    const currentUserInfo = user.value.info as Partial<InternalUserInfo>;

    return buildUserInfo({
      user_id: userId,
      name: currentUserInfo.name,
      photo: currentUserInfo.photo,
      email: currentUserInfo.email,
      sector: currentUserInfo.sector,
      position: currentUserInfo.position,
    });
  }

  return null;
};

const resolveMessageUserInfo = (
  message: InternalMessage
): InternalUserInfo | null => {
  if (!message.user?.id) return null;

  return (
    findKnownUserInfoByUserId(message.user.id) ??
    buildUserInfo({
      user_id: message.user.id,
      name: message.user.name,
      photo: message.user.photo,
    })
  );
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

const isSystemMessage = (message: InternalMessage): boolean => {
  return (
    message.type_user === ETypeUserChat.system ||
    message.content?.type === EMessageType.system
  );
};

const resolveSystemMessageText = (message: InternalMessage): string => {
  const system = message.content?.system as
    | {
        key?: string | null;
        params?: Record<string, string | number | null | undefined> | null;
      }
    | null
    | undefined;
  const key = system?.key || message.content?.message || '';

  if (key) {
    return String(t(key, system?.params ?? {}));
  }

  return String(t('internal_chat_preview_group_event'));
};

const canMutateInternalMessage = (message: InternalMessage): boolean => {
  return isOwnMessage(message);
};

const canInteractWithMessage = (message: InternalMessage): boolean => {
  return (
    !isSystemMessage(message) &&
    !isDeletedMessage(message) &&
    Boolean(message.content)
  );
};

const canEditInternalMessage = (message: InternalMessage): boolean => {
  return (
    canMutateInternalMessage(message) &&
    !isDeletedMessage(message) &&
    message.content?.type === EMessageType.text
  );
};

const canDeleteInternalMessage = (message: InternalMessage): boolean => {
  return canMutateInternalMessage(message) && !isDeletedMessage(message);
};

const hasMessageHistory = (message: InternalMessage): boolean => {
  return Boolean(message.content?.history_available);
};

const canViewMessageHistory = (message: InternalMessage): boolean => {
  return (
    (isOwnMessage(message) || isActiveConversationLeader.value) &&
    hasMessageHistory(message)
  );
};

const canShowMessageActions = (message: InternalMessage): boolean => {
  return canInteractWithMessage(message) || canViewMessageHistory(message);
};

const resolveHistoryFallbackText = (
  type?: EMessageType | string | null
): string => {
  if (type === EMessageType.image) return t('internal_chat_image_alt');
  if (type === EMessageType.video) return t('internal_chat_preview_video');
  if (type === EMessageType.audio) return t('internal_chat_preview_audio');
  if (type === EMessageType.document) {
    return t('internal_chat_document_fallback');
  }
  if (type === EMessageType.location) {
    return t('internal_chat_location_fallback');
  }
  if (type === EMessageType.contact_card || type === EMessageType.contacts) {
    return t('internal_chat_preview_contact');
  }

  return t('internal_chat_deleted_message');
};

const resolveHistoryItemLabel = (
  item: InternalMessageHistoryApiItem
): string => {
  if (item.kind === 'current') return t('internal_chat_current_message');
  if (item.kind === 'deleted_snapshot') {
    return t('internal_chat_deleted_message_content');
  }
  if (item.kind === 'original') return t('internal_chat_original_message');

  return t('internal_chat_previous_version');
};

const mapMessageHistoryItems = (
  items: InternalMessageHistoryApiItem[]
): InternalMessageHistoryItem[] => {
  return items.map((item) => {
    const text =
      item.message?.trim() ||
      resolveHistoryFallbackText(item.type as EMessageType | string);

    return {
      text,
      date: item.date,
      label: resolveHistoryItemLabel(item),
      isCurrent: item.is_current,
      isDeletedSnapshot: item.is_deleted_snapshot,
    };
  });
};

const resolveMessageText = (message: InternalMessage): string | null => {
  if (!message.content) return null;
  if (isSystemMessage(message)) return resolveSystemMessageText(message);
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

const shouldRenderMessageTextBeforeMedia = (
  message: InternalMessage
): boolean => {
  const mediaWithOwnCaption = [
    EMessageType.audio,
    EMessageType.document,
    EMessageType.location,
    EMessageType.contact_card,
    EMessageType.contacts,
  ];

  return !mediaWithOwnCaption.includes(message.content?.type as EMessageType);
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
      name: message.content.image.extension
        ? `image.${String(message.content.image.extension).replace(/^\./, '')}`
        : 'image.jpg',
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

const resolveMessageMediaKind = (
  message: InternalMessage
): InternalMediaKind | null => {
  if (
    message.content?.type === EMessageType.image &&
    Boolean(message.content.image?.url)
  ) {
    return 'image';
  }

  if (
    message.content?.type === EMessageType.video &&
    Boolean(message.content.video?.url)
  ) {
    return 'video';
  }

  return null;
};

const canGroupMessageMedia = (message: InternalMessage): boolean => {
  return Boolean(
    resolveMessageMediaKind(message) &&
    message.user?.id &&
    !isDeletedMessage(message) &&
    !resolveMessageText(message) &&
    !showQuotedMessage(message) &&
    !message.content?.reactions?.length &&
    !resolveMessageLocalState(message)
  );
};

const buildMediaViewerItem = (
  message: InternalMessage
): InternalViewerMediaItem | null => {
  const image = message.content?.image;
  if (message.content?.type === EMessageType.image && image?.url) {
    return {
      src: image.url,
      caption: image.caption || message.content.message || '',
      downloadName: image.extension
        ? `image.${String(image.extension).replace(/^\./, '')}`
        : 'image.jpg',
      kind: 'image',
    };
  }

  const video = message.content?.video;
  if (message.content?.type === EMessageType.video && video?.url) {
    return {
      src: video.url,
      caption: video.caption || message.content.message || '',
      downloadName:
        video.name ||
        (video.extension
          ? `video.${String(video.extension).replace(/^\./, '')}`
          : 'video.mp4'),
      kind: 'video',
    };
  }

  return null;
};

const messageDisplayItems = computed<InternalMessageDisplayItem[]>(() => {
  const displayItems: InternalMessageDisplayItem[] = [];
  let index = 0;
  let lastDate: string | null = null;

  while (index < messages.value.length) {
    const firstMessage = messages.value[index];
    const mediaKind = resolveMessageMediaKind(firstMessage);
    const messageDate = firstMessage.date;

    if (!lastDate || !isSameMessageDay(messageDate, lastDate)) {
      displayItems.push({
        kind: 'date-separator',
        id: `date-separator:${messageDate}`,
        separatorDate: messageDate,
        separatorLabel: formatMessageDateSeparator(messageDate),
      });
      lastDate = messageDate;
    }

    if (!mediaKind || !canGroupMessageMedia(firstMessage)) {
      displayItems.push({
        kind: 'message',
        id: `message:${firstMessage.message_id}`,
        message: firstMessage,
      });
      index += 1;
      continue;
    }

    const userId = firstMessage.user?.id;
    const groupedMessages: InternalMessage[] = [firstMessage];
    let nextIndex = index + 1;

    while (nextIndex < messages.value.length) {
      const nextMessage = messages.value[nextIndex];
      const nextMediaKind = resolveMessageMediaKind(nextMessage);

      if (
        !canGroupMessageMedia(nextMessage) ||
        nextMediaKind !== mediaKind ||
        nextMessage.user?.id !== userId ||
        !isSameMessageDay(nextMessage.date, firstMessage.date)
      ) {
        break;
      }

      groupedMessages.push(nextMessage);
      nextIndex += 1;
    }

    if (groupedMessages.length === 1) {
      displayItems.push({
        kind: 'message',
        id: `message:${firstMessage.message_id}`,
        message: firstMessage,
      });
      index += 1;
      continue;
    }

    const lastMessage = groupedMessages[groupedMessages.length - 1];
    displayItems.push({
      kind: 'media-group',
      id: `media-group:${mediaKind}:${firstMessage.message_id}:${lastMessage.message_id}`,
      mediaKind,
      messages: groupedMessages,
      firstMessage,
      lastMessage,
      isMine: isOwnMessage(firstMessage),
    });
    index = nextIndex;
  }

  return displayItems;
});

const getMediaGroupPreviewItems = (
  displayItem: Extract<InternalMessageDisplayItem, { kind: 'media-group' }>
): InternalMessage[] => {
  return displayItem.messages.slice(0, 4);
};

const getMediaGroupRemainingCount = (
  displayItem: Extract<InternalMessageDisplayItem, { kind: 'media-group' }>
): number => {
  return Math.max(0, displayItem.messages.length - 4);
};

const getMediaGroupGridClass = (
  displayItem: Extract<InternalMessageDisplayItem, { kind: 'media-group' }>
): string => {
  const previewCount = getMediaGroupPreviewItems(displayItem).length;
  return `internal-chat-media-group-grid--${Math.max(
    1,
    Math.min(previewCount, 4)
  )}`;
};

const openMediaViewerWithItems = (
  items: InternalViewerMediaItem[],
  initialIndex = 0
) => {
  if (!items.length) return;

  mediaViewerItems.value = items;
  mediaViewerInitialIndex.value = Math.max(
    0,
    Math.min(initialIndex, items.length - 1)
  );
  mediaViewerOpen.value = true;
};

const openMessageMediaViewer = (message: InternalMessage) => {
  const item = buildMediaViewerItem(message);
  if (!item) return;

  openMediaViewerWithItems([item]);
};

const openMediaGroupViewer = (
  displayItem: Extract<InternalMessageDisplayItem, { kind: 'media-group' }>,
  initialIndex = 0
) => {
  const items = displayItem.messages
    .map((message) => buildMediaViewerItem(message))
    .filter((item): item is InternalViewerMediaItem => Boolean(item));

  openMediaViewerWithItems(items, initialIndex);
};

const downloadMediaViewerItem = (payload?: {
  item?: InternalViewerMediaItem;
  index?: number;
}) => {
  const item =
    payload?.item ?? mediaViewerItems.value[mediaViewerInitialIndex.value];
  if (!item?.src) return;

  const link = document.createElement('a');
  link.href = item.src;
  link.download =
    item.downloadName || (item.kind === 'video' ? 'video.mp4' : 'image.jpg');
  link.target = '_blank';
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
};

const resolveMessageLocalState = (message: InternalMessage) => {
  return message.hash
    ? internalChatStore.localMessageState[message.hash]
    : null;
};

const resolveMessageUploadProgress = (message: InternalMessage): number => {
  return resolveMessageLocalState(message)?.progress ?? 0;
};

const hasMessageUploadError = (message: InternalMessage): boolean => {
  return resolveMessageLocalState(message)?.status === 'error';
};

const resolveMessageContacts = (message: InternalMessage) => {
  if (message.content?.contacts?.length) return message.content.contacts;
  if (message.content?.contact) return [message.content.contact];
  return [];
};

const resolveContactFullName = (contact: InternalContact): string => {
  return `${contact.name || t('internal_chat_contact')} ${
    contact.last_name || ''
  }`.trim();
};

const resolveContactViewerKey = (
  contact: InternalContact,
  index: number
): string => {
  return (
    contact.contact_id ||
    `${contact.name}-${contact.phone || contact.phone_partial || contact.email || index}`
  );
};

const onlyPhoneDigits = (value?: string | null): string => {
  return value?.replace(/\D/g, '') ?? '';
};

const formatNationalPhone = (
  phone: string | null | undefined,
  phoneDdi?: string | null
): string => {
  const normalizedPhone = phone?.trim() ?? '';
  if (!normalizedPhone) return '';

  if (normalizedPhone.startsWith('+')) {
    return normalizedPhone;
  }

  if (normalizedPhone.includes('*')) {
    return normalizedPhone;
  }

  const phoneDdiDigits = onlyPhoneDigits(phoneDdi);
  const phoneDigits = onlyPhoneDigits(normalizedPhone);
  const nationalDigits =
    phoneDdiDigits && phoneDigits.startsWith(phoneDdiDigits)
      ? phoneDigits.slice(phoneDdiDigits.length)
      : phoneDigits;

  if (nationalDigits.length === 11) {
    return `(${nationalDigits.slice(0, 2)}) ${nationalDigits.slice(
      2,
      7
    )}-${nationalDigits.slice(7)}`;
  }

  if (nationalDigits.length === 10) {
    return `(${nationalDigits.slice(0, 2)}) ${nationalDigits.slice(
      2,
      6
    )}-${nationalDigits.slice(6)}`;
  }

  if (nationalDigits.length === 9) {
    return `${nationalDigits.slice(0, 5)}-${nationalDigits.slice(5)}`;
  }

  if (nationalDigits.length === 8) {
    return `${nationalDigits.slice(0, 4)}-${nationalDigits.slice(4)}`;
  }

  return normalizedPhone;
};

const formatContactPhone = (
  phone: string | null | undefined,
  phoneDdi?: string | null
): string => {
  const normalizedPhone = phone?.trim() ?? '';
  if (!normalizedPhone) return '';
  if (normalizedPhone.startsWith('+')) return normalizedPhone;

  const phoneDdiDigits = onlyPhoneDigits(phoneDdi);
  const phoneDigits = onlyPhoneDigits(normalizedPhone);
  const prefix =
    phoneDdiDigits && !phoneDigits.startsWith(phoneDdiDigits)
      ? `+${phoneDdiDigits} `
      : phoneDdiDigits
        ? `+${phoneDdiDigits} `
        : '';

  return `${prefix}${formatNationalPhone(normalizedPhone, phoneDdiDigits)}`;
};

const isContactPhoneVisible = (contact: InternalContact): boolean => {
  return Boolean(
    contact.contact_id && contactViewerVisiblePhones[contact.contact_id]
  );
};

const isContactPhoneLoading = (contact: InternalContact): boolean => {
  return Boolean(
    contact.contact_id && contactViewerPhoneLoading[contact.contact_id]
  );
};

const canViewFullContactPhone = (contact: InternalContact): boolean => {
  return Boolean(
    contact.contact_id && (contact.phone_partial || contact.phone)
  );
};

const resolveContactViewerDdi = (contact: InternalContact): string | null => {
  if (contact.contact_id && contactViewerPhoneDdiCache[contact.contact_id]) {
    return contactViewerPhoneDdiCache[contact.contact_id];
  }

  return contact.phone_ddi ?? null;
};

const resolveContactViewerMeta = (contact: InternalContact): string => {
  if (
    contact.contact_id &&
    contactViewerVisiblePhones[contact.contact_id] &&
    contactViewerPhoneCache[contact.contact_id]
  ) {
    return formatContactPhone(
      contactViewerPhoneCache[contact.contact_id],
      resolveContactViewerDdi(contact)
    );
  }

  const phone = contact.phone_partial || contact.phone;
  if (phone) {
    return formatContactPhone(phone, resolveContactViewerDdi(contact));
  }

  return contact.email_partial || contact.email || '';
};

const clearVisibleContactPhones = () => {
  for (const key of Object.keys(contactViewerVisiblePhones)) {
    delete contactViewerVisiblePhones[key];
  }
};

const toggleContactPhoneVisibility = async (contact: InternalContact) => {
  if (!contact.contact_id || !canViewFullContactPhone(contact)) return;

  if (contactViewerVisiblePhones[contact.contact_id]) {
    delete contactViewerVisiblePhones[contact.contact_id];
    return;
  }

  if (contactViewerPhoneCache[contact.contact_id]) {
    contactViewerVisiblePhones[contact.contact_id] = true;
    return;
  }

  contactViewerPhoneLoading[contact.contact_id] = true;
  try {
    const response = await internalChatStore.viewContactPhone(
      contact.contact_id
    );
    const phone = response?.phone?.trim();
    if (!phone) return;

    contactViewerPhoneCache[contact.contact_id] = phone;
    contactViewerPhoneDdiCache[contact.contact_id] =
      response?.phone_ddi ?? contact.phone_ddi ?? null;
    contactViewerVisiblePhones[contact.contact_id] = true;
  } finally {
    delete contactViewerPhoneLoading[contact.contact_id];
  }
};

const resolveMessageContactCardTitle = (message: InternalMessage): string => {
  const contacts = resolveMessageContacts(message);
  const firstContact = contacts[0];
  if (!firstContact) return t('internal_chat_contact');

  const firstName = resolveContactFullName(firstContact);
  if (contacts.length === 1) return firstName;

  const remainingCount = contacts.length - 1;
  return t(
    remainingCount === 1
      ? 'internal_chat_contacts_summary_one'
      : 'internal_chat_contacts_summary_many',
    {
      name: firstName,
      count: remainingCount,
    }
  );
};

const resolveMessageContactCardSubtitle = (
  message: InternalMessage
): string | null => {
  const contacts = resolveMessageContacts(message);
  if (contacts.length !== 1) return null;

  const contact = contacts[0];
  const phone = contact.phone_partial || contact.phone;
  if (phone) {
    return formatContactPhone(phone, contact.phone_ddi ?? '55');
  }

  return contact.email_partial || contact.email || null;
};

const openMessageContacts = (message: InternalMessage) => {
  const contacts = resolveMessageContacts(message);
  if (!contacts.length) return;

  clearVisibleContactPhones();
  contactViewerContacts.value = contacts;
  contactViewerOpen.value = true;
};

const resolveInternalDocumentIcon = (
  doc?: InternalMessage['content']['document'] | null
): string => {
  if (!doc) return 'tabler-file-description';

  const extension = doc.extension?.toLowerCase().replace(/^\./, '');
  if (extension && internalDocumentIconMap[extension]) {
    return internalDocumentIconMap[extension];
  }

  const mimetype = doc.mimetype ?? '';
  if (mimetype.includes('pdf')) return 'tabler-file-type-pdf';
  if (mimetype.includes('word')) return 'tabler-file-type-doc';
  if (mimetype.includes('sheet') || mimetype.includes('excel')) {
    return 'tabler-file-type-xls';
  }
  if (mimetype.includes('presentation')) return 'tabler-file-type-ppt';
  if (mimetype.includes('zip') || mimetype.includes('compressed')) {
    return 'tabler-file-type-zip';
  }

  return 'tabler-file-description';
};

const resolveInternalDocumentName = (
  doc?: InternalMessage['content']['document'] | null
): string => {
  return doc?.name || t('internal_chat_document_fallback');
};

const resolveInternalDocumentDownloadName = (
  doc?: InternalMessage['content']['document'] | null
): string => {
  return resolveInternalDocumentName(doc);
};

const resolveInternalDocumentMeta = (
  doc?: InternalMessage['content']['document'] | null
): string => {
  if (!doc) return '';

  const extension =
    (doc.extension || '').replace(/^\./, '').toUpperCase() || 'FILE';
  const size = doc.size ? formatFileSize(doc.size) : '—';
  return `${extension} • ${size}`;
};

const hasValidLocation = (message: InternalMessage): boolean => {
  const location = message.content?.location;
  return (
    typeof location?.latitude === 'number' &&
    typeof location.longitude === 'number'
  );
};

const resolveLocationCoordinates = (
  location?: InternalMessage['content']['location'] | null
): [number, number] => {
  return [Number(location?.longitude ?? 0), Number(location?.latitude ?? 0)];
};

const openMessageLocation = (message: InternalMessage) => {
  const location = message.content?.location;
  if (!hasValidLocation(message) || !location) return;

  locationData.value = {
    latitude: location.latitude as number,
    longitude: location.longitude as number,
    name: location.name ?? null,
    address: location.address ?? null,
  };
  locationModalOpen.value = true;
};

const onInternalLocationMapLoad = () => {
  if (locationMapRef.value?.map) {
    locationMapRef.value.map.resize();
  }
};

const normalizeAudioTimeValue = (value?: number | null): number | null => {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  if (value < 0) return null;
  return value;
};

const formatAudioTime = (seconds?: number | null): string => {
  const totalSeconds = Math.floor(normalizeAudioTimeValue(seconds) ?? 0);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

const getOrCreateAudioPlayer = (
  messageId: string,
  url: string
): HTMLAudioElement => {
  const existingPlayer = audioPlayers.value.get(messageId);
  if (existingPlayer) return existingPlayer;

  const audio = new Audio(url);
  audio.preload = 'metadata';
  audioPlayers.value.set(messageId, audio);

  audio.addEventListener('loadedmetadata', () => {
    const duration = normalizeAudioTimeValue(audio.duration);
    if (duration !== null) {
      audioDurations[messageId] = duration;
    }
  });

  audio.addEventListener('timeupdate', () => {
    const currentTime = normalizeAudioTimeValue(audio.currentTime);
    if (currentTime !== null) {
      audioCurrentTimes[messageId] = currentTime;
    }
  });

  audio.addEventListener('play', () => {
    audioPlayStates[messageId] = true;
  });

  audio.addEventListener('pause', () => {
    audioPlayStates[messageId] = false;
  });

  audio.addEventListener('ended', () => {
    audioPlayStates[messageId] = false;
    audioCurrentTimes[messageId] = 0;
  });

  return audio;
};

const toggleAudioPlay = (messageId: string, url: string) => {
  const audio = getOrCreateAudioPlayer(messageId, url);
  const isPlaying = audioPlayStates[messageId] || false;

  if (isPlaying) {
    audio.pause();
    return;
  }

  audio.playbackRate = audioPlaybackRates[messageId] || 1;
  audio.play().catch(() => {
    audioPlayStates[messageId] = false;
  });
};

const getAudioSpeed = (messageId: string): number => {
  return audioPlaybackRates[messageId] || 1;
};

const getAudioSpeedLabel = (messageId: string): string => {
  const speed = getAudioSpeed(messageId);
  if (speed === 1.5) return '1.5x';
  if (speed === 2) return '2x';
  return '1x';
};

const toggleAudioSpeed = (messageId: string) => {
  const currentSpeed = getAudioSpeed(messageId);
  const newSpeed = currentSpeed === 1 ? 1.5 : currentSpeed === 1.5 ? 2 : 1;
  audioPlaybackRates[messageId] = newSpeed;

  const audio = audioPlayers.value.get(messageId);
  if (audio) audio.playbackRate = newSpeed;
};

const seekAudio = (messageId: string, url: string, event: MouseEvent) => {
  const container = event.currentTarget as HTMLElement | null;
  if (!container) return;

  const rect = container.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const percentage = Math.max(0, Math.min(1, clickX / rect.width));
  const audio = getOrCreateAudioPlayer(messageId, url);
  const duration = normalizeAudioTimeValue(audio.duration);

  if (duration === null) return;

  audio.currentTime = percentage * duration;
  audioCurrentTimes[messageId] = audio.currentTime;
};

const decodeBase64Waveform = (base64String: string): number[] | null => {
  try {
    const binaryString = atob(base64String);
    const bytes = new Uint8Array(binaryString.length);
    for (let index = 0; index < binaryString.length; index += 1) {
      const codePoint = binaryString.codePointAt(index);
      bytes[index] = codePoint ?? 0;
    }
    return Array.from(bytes);
  } catch {
    return null;
  }
};

const normalizeWaveformValues = (waveformArray: number[]): number[] => {
  return waveformArray.map((value) => {
    const normalized = value / 100;
    return Math.max(0.15, Math.min(1, normalized));
  });
};

const createDefaultWaveform = (): number[] => new Array(64).fill(0.3);

const parseWaveform = (
  waveform: string | number[] | null | undefined
): number[] | null => {
  if (!waveform) return null;
  if (typeof waveform === 'string') return decodeBase64Waveform(waveform);
  if (Array.isArray(waveform) && waveform.length > 0) return waveform;
  return null;
};

const loadAudioWaveform = (
  messageId: string,
  waveform: string | number[] | null | undefined
) => {
  if (audioWaveforms[messageId]) return;

  const waveformArray = parseWaveform(waveform);
  audioWaveforms[messageId] = waveformArray?.length
    ? normalizeWaveformValues(waveformArray)
    : createDefaultWaveform();
};

const getAudioProgress = (messageId: string): number => {
  const currentTime =
    normalizeAudioTimeValue(audioCurrentTimes[messageId]) ?? 0;
  const duration = normalizeAudioTimeValue(audioDurations[messageId]) ?? 0;
  if (duration === 0) return 0;
  return (currentTime / duration) * 100;
};

const isAudioPlaying = (messageId: string): boolean => {
  return !!audioPlayStates[messageId];
};

const getDisplayAudioTime = (
  messageId: string,
  fallbackDuration?: number | null
): string => {
  const currentTime = normalizeAudioTimeValue(audioCurrentTimes[messageId]);
  const duration =
    normalizeAudioTimeValue(audioDurations[messageId]) ??
    normalizeAudioTimeValue(fallbackDuration);

  if (isAudioPlaying(messageId) && currentTime !== null) {
    return formatAudioTime(currentTime);
  }

  return formatAudioTime(duration);
};

const resolveReplyPreviewContent = (
  message?: InternalMessage | null
): InternalReplyPreviewContent | null => {
  return (message?.content as InternalReplyPreviewContent | null) ?? null;
};

const resolveQuotedPreviewContent = (
  message: InternalMessage
): InternalReplyPreviewContent | null => {
  if (message.content?.quoted) {
    return message.content.quoted as InternalReplyPreviewContent;
  }

  const quotedMessageId = message.content?.message_quoted_id;
  if (!quotedMessageId) return null;

  const quotedMessage = messages.value.find(
    (item) => item.message_id === quotedMessageId
  );

  return resolveReplyPreviewContent(quotedMessage);
};

const resolveReplyPreviewContacts = (
  content?: InternalReplyPreviewContent | null
): InternalContact[] => {
  if (content?.contacts?.length) {
    return content.contacts as InternalContact[];
  }

  if (content?.contact) {
    return [content.contact as InternalContact];
  }

  return [];
};

const resolveReplyPreviewContactTitle = (
  content?: InternalReplyPreviewContent | null
): string => {
  const contacts = resolveReplyPreviewContacts(content);
  const firstContact = contacts[0];
  if (!firstContact) return t('contact_label');

  const firstName = resolveContactFullName(firstContact);
  if (contacts.length === 1) return firstName;

  const remainingCount = contacts.length - 1;
  return t(
    remainingCount === 1
      ? 'internal_chat_contacts_summary_one'
      : 'internal_chat_contacts_summary_many',
    {
      name: firstName,
      count: remainingCount,
    }
  );
};

const resolveReplyPreviewText = (
  content?: InternalReplyPreviewContent | null
): string => {
  if (!content) return t('internal_chat_message');

  if (content.type === EMessageType.image) {
    return content.image?.caption || content.message || t('photo_label');
  }

  if (content.type === EMessageType.document) {
    return content.document?.name || content.message || t('document_label');
  }

  if (content.type === EMessageType.video) {
    return content.video?.caption || content.message || t('video_label');
  }

  if (content.type === EMessageType.audio) {
    return content.message || t('audio_label');
  }

  if (content.type === EMessageType.location) {
    return (
      content.location?.name ||
      content.location?.address ||
      content.message ||
      t('location_label')
    );
  }

  if (
    content.type === EMessageType.contact_card ||
    content.type === EMessageType.contacts
  ) {
    const contactTitle = resolveReplyPreviewContactTitle(content);
    return content.message
      ? `${contactTitle} - ${content.message}`
      : contactTitle;
  }

  if (content.message) return content.message;

  const linkPreview = content.link_preview as
    | Record<string, string | null | undefined>
    | null
    | undefined;
  return (
    linkPreview?.['matched-text'] ||
    linkPreview?.['canonical-url'] ||
    t('internal_chat_message')
  );
};

const resolveReplyPreviewMeta = (
  content?: InternalReplyPreviewContent | null
): string => {
  if (!content) return '';

  if (content.type === EMessageType.document) {
    return resolveInternalDocumentMeta(content.document);
  }

  if (content.type === EMessageType.video) {
    const items: string[] = [];
    const extension = content.video?.extension
      ?.replace(/^\./, '')
      .toUpperCase();
    if (extension) items.push(extension);
    if (content.video?.size) items.push(formatFileSize(content.video.size));
    return items.join(' • ');
  }

  if (content.type === EMessageType.audio) {
    const items: string[] = [];
    if (content.audio?.size) items.push(formatFileSize(content.audio.size));
    if (content.audio?.duration) {
      items.push(formatAudioTime(content.audio.duration));
    }
    return items.join(' • ');
  }

  return '';
};

const resolveReplyPreviewDocumentIcon = (
  content?: InternalReplyPreviewContent | null
): string => {
  return resolveInternalDocumentIcon(content?.document);
};

const resolveReplyPreviewImageSrc = (
  content?: InternalReplyPreviewContent | null
): string | null => {
  if (content?.type !== EMessageType.image) return null;
  return content.image?.url || content.image?.thumbnail || null;
};

const resolveReplyPreviewContactPhoto = (
  content?: InternalReplyPreviewContent | null
): string | null => {
  const contacts = resolveReplyPreviewContacts(content);
  if (contacts.length !== 1) return null;
  return contacts[0]?.photo || null;
};

const isReplyPreviewDocument = (
  content?: InternalReplyPreviewContent | null
): boolean => content?.type === EMessageType.document;

const isReplyPreviewVideo = (
  content?: InternalReplyPreviewContent | null
): boolean => content?.type === EMessageType.video;

const isReplyPreviewAudio = (
  content?: InternalReplyPreviewContent | null
): boolean => content?.type === EMessageType.audio;

const isReplyPreviewLocation = (
  content?: InternalReplyPreviewContent | null
): boolean => content?.type === EMessageType.location;

const isReplyPreviewContact = (
  content?: InternalReplyPreviewContent | null
): boolean =>
  content?.type === EMessageType.contact_card ||
  content?.type === EMessageType.contacts;

const isReplyPreviewContactGroup = (
  content?: InternalReplyPreviewContent | null
): boolean => content?.type === EMessageType.contacts;

const resolveReplyPreviewName = (message?: InternalMessage | null): string => {
  return (
    message?.user?.name || user.value?.info?.name || t('internal_chat_reply')
  );
};

const activeReplyPreviewContent = computed(() =>
  resolveReplyPreviewContent(replyMessage.value)
);

const resolveQuotedPreviewMeta = (message: InternalMessage): string => {
  return resolveReplyPreviewMeta(resolveQuotedPreviewContent(message));
};

const resolveQuotedPreviewImageSrc = (
  message: InternalMessage
): string | null => {
  return resolveReplyPreviewImageSrc(resolveQuotedPreviewContent(message));
};

const resolveQuotedPreviewDocumentIcon = (message: InternalMessage): string => {
  return resolveReplyPreviewDocumentIcon(resolveQuotedPreviewContent(message));
};

const resolveQuotedPreviewContactPhoto = (
  message: InternalMessage
): string | null => {
  return resolveReplyPreviewContactPhoto(resolveQuotedPreviewContent(message));
};

const resolveQuotedText = (message: InternalMessage): string => {
  const quotedContent = resolveQuotedPreviewContent(message);
  return quotedContent ? resolveReplyPreviewText(quotedContent) : '';
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
  return Boolean(message.content?.quoted || message.content?.message_quoted_id);
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

const clearComposer = (revokeObjectUrls = true) => {
  composerText.value = '';
  replyMessage.value = null;
  isComposerEmojiOpen.value = false;
  linkPreview.value = null;
  isLoadingLinkPreview.value = false;
  if (revokeObjectUrls) {
    for (const video of selectedVideos.value) {
      if (video.preview.startsWith('blob:')) URL.revokeObjectURL(video.preview);
    }
    for (const audio of selectedAudios.value) {
      if (audio.preview.startsWith('blob:')) URL.revokeObjectURL(audio.preview);
    }
  }
  selectedImages.value = [];
  selectedVideos.value = [];
  selectedDocuments.value = [];
  selectedAudios.value = [];
  selectedContacts.value = [];
  selectedLocation.value = null;
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

const messageAutoScrollThreshold = 80;
const messagePreviousLoadThreshold = 200;

const canLoadPreviousMessages = computed(() => {
  return messagesPaging.value.current_page < messagesPaging.value.total_pages;
});

const getMessageScrollElement = (): HTMLElement | null => {
  const scrollRef = messageListScrollRef.value as
    | (InstanceType<typeof PerfectScrollbar> & {
        ps?: { element?: HTMLElement; value?: { element?: HTMLElement } };
        $el?: HTMLElement;
      })
    | null;
  const psElement = scrollRef?.ps?.element ?? scrollRef?.ps?.value?.element;
  if (psElement) return psElement;

  const root = scrollRef?.$el ?? null;

  if (!root) return null;
  if (root.classList.contains('ps')) return root;

  return (root.querySelector('.ps') as HTMLElement | null) ?? root;
};

const updateMessageScrollbar = async () => {
  await nextTick();

  const scrollRef = messageListScrollRef.value as
    | (InstanceType<typeof PerfectScrollbar> & {
        ps?: { update?: () => void; value?: { update?: () => void } };
        update?: () => void;
      })
    | null;

  if (typeof scrollRef?.ps?.update === 'function') {
    scrollRef.ps.update();
    return;
  }

  if (typeof scrollRef?.ps?.value?.update === 'function') {
    scrollRef.ps.value.update();
    return;
  }

  if (typeof scrollRef?.update === 'function') {
    scrollRef.update();
    return;
  }

  getMessageScrollElement()?.dispatchEvent(new Event('scroll'));
};

const isMessageListNearBottom = (target?: HTMLElement | null): boolean => {
  const element = target ?? getMessageScrollElement();
  if (!element) return true;

  const distanceFromBottom =
    element.scrollHeight - element.scrollTop - element.clientHeight;

  return distanceFromBottom <= messageAutoScrollThreshold;
};

const updateFixedMessageDatePosition = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect();
  fixedMessageDateIndicatorTop.value = rect.top;
  fixedMessageDateIndicatorLeft.value = rect.left;
  fixedMessageDateIndicatorWidth.value = rect.width;
};

const updateFixedMessageDateLabel = (element: HTMLElement) => {
  const separators = element.querySelectorAll(
    '.internal-chat-date-separator-wrapper[data-separator-date]'
  );

  if (!separators.length) {
    fixedMessageDateLabel.value = '';
    return;
  }

  const scrollRect = element.getBoundingClientRect();
  const viewportTop = scrollRect.top + 80;
  const floatingZoneBottom = scrollRect.top + 60;
  let activeLabel = '';
  let activeSeparatorRect: DOMRect | null = null;

  for (let index = 0; index < separators.length; index += 1) {
    const separatorElement = separators[index] as HTMLElement;
    const rect = separatorElement.getBoundingClientRect();
    const label = separatorElement.getAttribute('data-separator-label') ?? '';

    if (rect.top <= viewportTop && label) {
      activeLabel = label;
      activeSeparatorRect = rect;
    }
  }

  const separatorStillVisible =
    activeSeparatorRect &&
    activeSeparatorRect.bottom >= scrollRect.top &&
    activeSeparatorRect.top <= floatingZoneBottom;

  fixedMessageDateLabel.value =
    activeLabel && !separatorStillVisible ? activeLabel : '';
};

const updateMessageScrollState = (target?: HTMLElement | null) => {
  const element = target ?? getMessageScrollElement();
  if (!element) return;

  updateFixedMessageDatePosition(element);

  const isNearBottom = isMessageListNearBottom(element);
  shouldAutoScrollMessages.value = isNearBottom;
  showScrollToBottom.value = !isNearBottom;

  if (isNearBottom) {
    fixedMessageDateLabel.value = '';
    return;
  }

  updateFixedMessageDateLabel(element);
};

const scrollMessagesToBottom = async (smooth = false) => {
  shouldAutoScrollMessages.value = true;
  fixedMessageDateLabel.value = '';

  await updateMessageScrollbar();

  const element = getMessageScrollElement();
  if (!element) return;

  const top = element.scrollHeight;
  element.scrollTo({
    top,
    behavior: smooth ? 'smooth' : 'auto',
  });

  await nextTick();

  requestAnimationFrame(() => {
    element.scrollTop = element.scrollHeight;
    showScrollToBottom.value = false;
    fixedMessageDateLabel.value = '';
  });
};

const clearHighlightedMessage = () => {
  if (highlightedMessageTimer) {
    clearTimeout(highlightedMessageTimer);
    highlightedMessageTimer = null;
  }

  highlightedMessageId.value = null;
};

const highlightMessage = (messageId: string) => {
  if (highlightedMessageTimer) {
    clearTimeout(highlightedMessageTimer);
  }

  highlightedMessageId.value = messageId;
  highlightedMessageTimer = setTimeout(() => {
    highlightedMessageId.value = null;
    highlightedMessageTimer = null;
  }, 30_000);
};

const findMessageByTargetId = (targetId: string): InternalMessage | null => {
  return (
    messages.value.find(
      (message) =>
        message.message_id === targetId ||
        (message.hash ? message.hash === targetId : false)
    ) ?? null
  );
};

const isMessageLoaded = (targetId: string): boolean => {
  return Boolean(findMessageByTargetId(targetId));
};

const ensureMessageLoaded = async (targetId: string): Promise<boolean> => {
  if (!targetId) return false;
  if (isMessageLoaded(targetId)) return true;

  while (messagesPaging.value.current_page < messagesPaging.value.total_pages) {
    const previousPage = messagesPaging.value.current_page;
    await loadMoreMessages();
    await nextTick();

    if (isMessageLoaded(targetId)) return true;
    if (messagesPaging.value.current_page === previousPage) break;
  }

  return isMessageLoaded(targetId);
};

const escapeMessageSelectorValue = (value: string): string => {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
};

const findMessageTargetElement = (
  scrollElement: HTMLElement,
  messageId: string
): HTMLElement | null => {
  const selectorValue = escapeMessageSelectorValue(messageId);

  return (
    (scrollElement.querySelector(
      `[data-message-id="${selectorValue}"]`
    ) as HTMLElement | null) ||
    (scrollElement.querySelector(
      `[data-message-group-ids~="${selectorValue}"]`
    ) as HTMLElement | null) ||
    (document.getElementById(`internal-msg-${messageId}`) as HTMLElement | null)
  );
};

const resolveQuotedTargetId = (message: InternalMessage): string | null => {
  if (isDeletedMessage(message)) return null;

  const explicitId = message.content?.message_quoted_id;
  if (explicitId) return String(explicitId);

  const quoted = message.content?.quoted as
    | {
        message_id?: string | null;
        id?: string | null;
        key?: { id?: string | null } | null;
        message?: string | null;
      }
    | null
    | undefined;

  const quotedId = quoted?.message_id || quoted?.id || quoted?.key?.id;
  if (quotedId) return String(quotedId);

  const quotedText = quoted?.message?.trim();
  if (!quotedText) return null;

  const matchedMessage = messages.value.find(
    (item) => item.content?.message?.trim() === quotedText
  );

  return matchedMessage?.message_id ?? null;
};

const resolveQuotedTargetIds = (message: InternalMessage): string[] => {
  if (isDeletedMessage(message)) return [];

  const quoted = message.content?.quoted as InternalReplyPreviewContent | null;
  const ids = [
    message.content?.message_quoted_id,
    quoted?.message_id,
    quoted?.id,
    quoted?.key?.id,
  ]
    .filter(Boolean)
    .map((id) => String(id));

  return [...new Set(ids)];
};

const resolveComparableMessageText = (
  message?: InternalMessage | null
): string => {
  if (!message || isDeletedMessage(message) || isSystemMessage(message)) {
    return '';
  }

  return (resolveMessageText(message) || '').trim();
};

const hasSameQuotedMedia = (
  message: InternalMessage,
  quotedContent: InternalReplyPreviewContent
): boolean => {
  if (quotedContent.type === EMessageType.image) {
    return Boolean(
      message.content?.image?.url &&
      (message.content.image.url === quotedContent.image?.url ||
        message.content.image.thumbnail === quotedContent.image?.thumbnail)
    );
  }

  if (quotedContent.type === EMessageType.video) {
    return Boolean(
      message.content?.video?.url &&
      message.content.video.url === quotedContent.video?.url
    );
  }

  if (quotedContent.type === EMessageType.audio) {
    return Boolean(
      message.content?.audio?.url &&
      message.content.audio.url === quotedContent.audio?.url
    );
  }

  if (quotedContent.type === EMessageType.document) {
    return Boolean(
      message.content?.document?.url &&
      (message.content.document.url === quotedContent.document?.url ||
        message.content.document.name === quotedContent.document?.name)
    );
  }

  return false;
};

const hasSameQuotedLocation = (
  message: InternalMessage,
  quotedContent: InternalReplyPreviewContent
): boolean => {
  if (quotedContent.type !== EMessageType.location) return false;

  return Boolean(
    message.content?.location &&
    quotedContent.location &&
    message.content.location.latitude === quotedContent.location.latitude &&
    message.content.location.longitude === quotedContent.location.longitude
  );
};

const hasSameQuotedContact = (
  message: InternalMessage,
  quotedContent: InternalReplyPreviewContent
): boolean => {
  if (
    quotedContent.type !== EMessageType.contact_card &&
    quotedContent.type !== EMessageType.contacts
  ) {
    return false;
  }

  const quotedContacts = resolveReplyPreviewContacts(quotedContent);
  const messageContacts =
    message.content?.contacts?.length && message.content.contacts.length > 0
      ? message.content.contacts
      : message.content?.contact
        ? [message.content.contact]
        : [];

  if (!quotedContacts.length || !messageContacts.length) return false;

  return quotedContacts.every((quotedContact) =>
    messageContacts.some(
      (messageContact) =>
        (quotedContact.contact_id &&
          messageContact.contact_id === quotedContact.contact_id) ||
        resolveContactFullName(messageContact) ===
          resolveContactFullName(quotedContact)
    )
  );
};

const findMessageByQuotedPreview = (
  sourceMessage: InternalMessage
): InternalMessage | null => {
  const quotedContent = resolveQuotedPreviewContent(sourceMessage);
  if (!quotedContent) return null;

  const quotedText = resolveReplyPreviewText(quotedContent).trim();
  const sourceIndex = messages.value.findIndex(
    (message) => message.message_id === sourceMessage.message_id
  );
  const candidates =
    sourceIndex > -1 ? messages.value.slice(0, sourceIndex) : messages.value;

  for (const candidate of [...candidates].reverse()) {
    if (candidate.message_id === sourceMessage.message_id) continue;
    if (isDeletedMessage(candidate) || isSystemMessage(candidate)) continue;

    if (
      quotedContent.type &&
      candidate.content?.type &&
      quotedContent.type !== candidate.content.type
    ) {
      continue;
    }

    if (hasSameQuotedMedia(candidate, quotedContent)) return candidate;
    if (hasSameQuotedLocation(candidate, quotedContent)) return candidate;
    if (hasSameQuotedContact(candidate, quotedContent)) return candidate;

    if (quotedText && resolveComparableMessageText(candidate) === quotedText) {
      return candidate;
    }
  }

  return null;
};

const resolveQuotedTargetMessage = (
  message: InternalMessage
): InternalMessage | null => {
  for (const targetId of resolveQuotedTargetIds(message)) {
    const targetMessage = findMessageByTargetId(targetId);
    if (targetMessage) return targetMessage;
  }

  return findMessageByQuotedPreview(message);
};

const ensureQuotedTargetMessageLoaded = async (
  message: InternalMessage
): Promise<InternalMessage | null> => {
  const initialTarget = resolveQuotedTargetMessage(message);
  if (initialTarget) return initialTarget;

  while (messagesPaging.value.current_page < messagesPaging.value.total_pages) {
    const previousPage = messagesPaging.value.current_page;
    await loadMoreMessages();
    await nextTick();

    const targetMessage = resolveQuotedTargetMessage(message);
    if (targetMessage) return targetMessage;
    if (messagesPaging.value.current_page === previousPage) break;
  }

  return resolveQuotedTargetMessage(message);
};

const hasQuotedNavigationTarget = (message: InternalMessage): boolean => {
  return showQuotedMessage(message);
};

const isMediaGroupHighlighted = (
  displayItem: InternalMessageDisplayItem
): boolean => {
  if (displayItem.kind !== 'media-group') return false;

  return displayItem.messages.some(
    (message) => message.message_id === highlightedMessageId.value
  );
};

const scrollToMessage = async (targetId: string, smooth = true) => {
  if (!targetId) return;

  shouldAutoScrollMessages.value = false;
  await ensureMessageLoaded(targetId);
  await updateMessageScrollbar();
  await nextTick();

  const scrollElement = getMessageScrollElement();
  if (!scrollElement) return;

  const loadedMessage = findMessageByTargetId(targetId);
  const messageId = loadedMessage?.message_id ?? targetId;
  const target = findMessageTargetElement(scrollElement, messageId);
  if (!target) return;

  const scrollRect = scrollElement.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const top = scrollElement.scrollTop + targetRect.top - scrollRect.top - 60;
  const maxScroll = scrollElement.scrollHeight - scrollElement.clientHeight;
  const validTop = Math.max(0, Math.min(top, maxScroll));

  scrollElement.scrollTo({
    top: validTop,
    behavior: smooth ? 'smooth' : 'auto',
  });

  highlightMessage(messageId);

  requestAnimationFrame(() => {
    if (Math.abs(scrollElement.scrollTop - validTop) > 4) {
      scrollElement.scrollTop = validTop;
    }
    updateMessageScrollbar();
    updateMessageScrollState(scrollElement);
  });
};

const goToQuotedMessage = async (message: InternalMessage) => {
  const targetMessage = await ensureQuotedTargetMessageLoaded(message);
  const targetId = targetMessage?.message_id ?? resolveQuotedTargetId(message);
  if (!targetId) return;

  await scrollToMessage(targetId, true);
};

const shouldLoadPreviousMessages = (
  element: HTMLElement,
  options: { allowNearBottom?: boolean } = {}
): boolean => {
  if (!canLoadPreviousMessages.value) return false;
  if (loadingMessages.value || loadingPreviousMessages.value) return false;
  if (element.scrollTop > messagePreviousLoadThreshold) return false;

  return options.allowNearBottom === true || !isMessageListNearBottom(element);
};

const handleMessageListScroll = async (event: Event) => {
  const element = event.currentTarget as HTMLElement | null;
  updateMessageScrollState(element);
  if (!element || !shouldLoadPreviousMessages(element)) return;

  await loadMoreMessages();
};

const handleMessageListWheel = (event: WheelEvent) => {
  if (event.deltaY >= 0) return;

  const element = getMessageScrollElement();
  if (
    !element ||
    !shouldLoadPreviousMessages(element, { allowNearBottom: true })
  ) {
    return;
  }

  void loadMoreMessages();
};

const switchSidebarTab = async (tab: InternalSidebarTab) => {
  if (activeSidebarTab.value === tab) return;

  activeSidebarTab.value = tab;
  sidebarBodyRef.value?.scrollTo({ top: 0 });
};

const openConversation = async (conversationId: string) => {
  shouldAutoScrollMessages.value = true;
  await internalChatStore.openConversation(conversationId);
  await scrollMessagesToBottom();
};

const openConversationFromUser = async (userId: string) => {
  shouldAutoScrollMessages.value = true;
  const conversation = await internalChatStore.openDirect(userId);
  if (!conversation) return;

  activeSidebarTab.value = 'all';
  sidebarBodyRef.value?.scrollTo({ top: 0 });
  await scrollMessagesToBottom();
};

const openConversationFromGroupMember = async (member: InternalParticipant) => {
  if (member.user_id === internalChatStore.currentUserId) return;

  shouldAutoScrollMessages.value = true;
  const conversation = await internalChatStore.openDirect(member.user_id);
  if (!conversation) return;

  activeSidebarTab.value = 'all';
  closeGroupInfoDrawer();
  sidebarBodyRef.value?.scrollTo({ top: 0 });
  await scrollMessagesToBottom();
};

const openConversationFromSelectedUserInfo = async () => {
  const userId = selectedUserInfoConversationUserId.value;
  if (!userId || userId === internalChatStore.currentUserId) return;

  shouldAutoScrollMessages.value = true;
  const conversation = await internalChatStore.openDirect(userId);
  if (!conversation) return;

  activeSidebarTab.value = 'all';
  closeUserInfoDrawer();
  closeGroupInfoDrawer();
  sidebarBodyRef.value?.scrollTo({ top: 0 });
  await scrollMessagesToBottom();
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

const openSelectedUserInfoDrawer = (
  info: InternalUserInfo,
  options: { allowConversationAction?: boolean } = {}
) => {
  selectedUserInfo.value = info;
  selectedUserInfoConversationUserId.value =
    options.allowConversationAction &&
    info.user_id !== internalChatStore.currentUserId
      ? info.user_id
      : null;
  closeGroupInfoDrawer();
  isUserInfoDrawerOpen.value = true;
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

  openSelectedUserInfoDrawer(buildUserInfo(activeDirectParticipant.value));
};

const openMessageUserInfoDrawer = (message: InternalMessage) => {
  if (isActiveDirectConversation.value && activeDirectParticipant.value) {
    openUserInfoDrawer();
    return;
  }

  const info = resolveMessageUserInfo(message);
  if (!info) return;

  openSelectedUserInfoDrawer(info, {
    allowConversationAction: isActiveGroupConversation.value,
  });
};

const closeUserInfoDrawer = () => {
  isUserInfoDrawerOpen.value = false;
  selectedUserInfo.value = null;
  selectedUserInfoConversationUserId.value = null;
};

const openConversationInfo = async () => {
  if (isActiveGroupConversation.value) {
    await openGroupInfoDrawer();
    return;
  }

  openUserInfoDrawer();
};

const openSearchDrawer = () => {
  if (!activeConversation.value) return;

  closeGroupInfoDrawer();
  closeUserInfoDrawer();
  isSearchDrawerOpen.value = true;
};

const closeSearchDrawer = () => {
  isSearchDrawerOpen.value = false;
};

const handleSearchMessageSelect = async (messageId: string) => {
  closeSearchDrawer();
  await scrollToMessage(messageId, true);
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
  if (!canLoadPreviousMessages.value) return;
  if (loadingMessages.value || loadingPreviousMessages.value) return;

  const scrollElement = getMessageScrollElement();
  const previousScrollHeight = scrollElement?.scrollHeight ?? 0;
  const previousScrollTop = scrollElement?.scrollTop ?? 0;
  shouldAutoScrollMessages.value = false;

  loadingPreviousMessages.value = true;
  try {
    await internalChatStore.listMessages(
      activeConversation.value.conversation_id,
      {
        current_page: messagesPaging.value.current_page + 1,
        per_page: messagesPaging.value.per_page,
      },
      true
    );

    await updateMessageScrollbar();

    if (!scrollElement) return;

    const scrollDifference = scrollElement.scrollHeight - previousScrollHeight;
    scrollElement.scrollTop = previousScrollTop + scrollDifference;
    updateMessageScrollState(scrollElement);
  } finally {
    loadingPreviousMessages.value = false;
  }
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

const createMessageHash = () => crypto.randomUUID();

const cloneLinkPreview = (): InternalLinkPreview | null => {
  return linkPreview.value ? structuredClone(linkPreview.value) : null;
};

const getQuotedLocalPayload = (
  message?: InternalMessage | null
): Record<string, unknown> | undefined => {
  if (!message) return undefined;

  return {
    message_id: message.message_id,
    id: message.message_id,
    key: {
      id: message.message_id,
      is_view_once: false,
    },
    message: resolveMessageText(message),
    user_name: message.user?.name ?? t('internal_chat_system_user'),
    type: message.content?.type,
    image: message.content?.image ?? null,
    video: message.content?.video ?? null,
    document: message.content?.document ?? null,
    audio: message.content?.audio ?? null,
    location: message.content?.location ?? null,
    contact: message.content?.contact ?? null,
    contacts: message.content?.contacts ?? null,
  };
};

const createLocalMessageEntry = (
  content: InternalMessage['content'],
  hash: string
): InternalMessage => {
  const userInfo = user.value?.info;

  return {
    message_id: hash,
    conversation_id: activeConversation.value?.conversation_id ?? '',
    account_id: activeConversation.value?.account_id ?? '',
    type_user: 'operator',
    user: userInfo
      ? {
          id: user.value?.user_id ?? userInfo.user_info_id,
          name: userInfo.name,
          photo: userInfo.photo ?? null,
        }
      : null,
    content,
    hash,
    date: new Date().toISOString(),
    deleted: false,
  } as InternalMessage;
};

const registerLocalMessage = async (
  content: InternalMessage['content'],
  hash: string
) => {
  internalChatStore.initializeLocalMessageState(hash);
  internalChatStore.upsertMessage(createLocalMessageEntry(content, hash));
  await nextTick();
  scrollMessagesToBottom();
};

const markUploadProgress = (hash: string, progress: number) => {
  internalChatStore.updateLocalMessageProgress(hash, progress);
};

const markUploadError = (hash: string) => {
  internalChatStore.markLocalMessageError(
    hash,
    t('internal_chat_send_message_error')
  );
};

const buildMessageBaseContent = (
  type: EMessageType,
  message: string | null,
  messageQuotedId: string | null,
  quoted: Record<string, unknown> | undefined
): InternalMessage['content'] => {
  return {
    type,
    message: message || null,
    message_quoted_id: messageQuotedId || null,
    quoted: (quoted as any) ?? null,
  };
};

const createMultipartPayload = (input: {
  type: EMessageType;
  field: 'images' | 'videos' | 'documents' | 'audios';
  file: File;
  message?: string | null;
  messageQuotedId?: string | null;
  hash: string;
}): FormData => {
  const formData = new FormData();
  formData.append('type', input.type);

  if (input.message && input.message.trim().length > 0) {
    formData.append('message', input.message.trim());
  }

  if (input.messageQuotedId) {
    formData.append('message_quoted_id', input.messageQuotedId);
  }

  formData.append(input.field, input.file);
  formData.append('hash', input.hash);

  return formData;
};

const sendMessage = async () => {
  if (!activeConversation.value?.conversation_id || !hasComposerContent.value) {
    return;
  }

  const conversationId = activeConversation.value.conversation_id;
  const message = composerText.value.trim();
  const messageQuotedId = replyMessage.value?.message_id ?? null;
  const quoted = getQuotedLocalPayload(replyMessage.value);
  const savedImages = [...selectedImages.value];
  const savedVideos = [...selectedVideos.value];
  const savedDocuments = [...selectedDocuments.value];
  const savedAudios = [...selectedAudios.value];
  const savedContacts = [...selectedContacts.value];
  const savedLocation = selectedLocation.value;
  const savedLinkPreview = cloneLinkPreview();

  clearComposer(false);

  const sendPayload = async (
    payload: FormData | Record<string, unknown>,
    hash: string,
    withProgress = false
  ) => {
    const success = await internalChatStore.createMessage(
      conversationId,
      payload as any,
      {
        skipLoading: true,
        onUploadProgress: withProgress
          ? (progress) => markUploadProgress(hash, progress)
          : undefined,
      }
    );
    if (!success) {
      markUploadError(hash);
      return;
    }
    internalChatStore.clearLocalMessageState(hash);
  };

  for (const image of savedImages) {
    const hash = createMessageHash();
    await registerLocalMessage(
      {
        ...buildMessageBaseContent(
          EMessageType.image,
          message || null,
          messageQuotedId,
          quoted
        ),
        image: {
          url: image.preview,
          caption: message || null,
          mimetype: image.file.type,
          extension: image.file.name.split('.').pop()?.toLowerCase() || null,
          size: image.file.size,
        } as any,
      },
      hash
    );
    await sendPayload(
      createMultipartPayload({
        type: EMessageType.image,
        field: 'images',
        file: image.file,
        message,
        messageQuotedId,
        hash,
      }),
      hash,
      true
    );
  }

  for (const video of savedVideos) {
    const hash = createMessageHash();
    await registerLocalMessage(
      {
        ...buildMessageBaseContent(
          EMessageType.video,
          message || null,
          messageQuotedId,
          quoted
        ),
        video: {
          url: video.preview,
          caption: message || null,
          name: video.name,
          mimetype: video.type,
          extension: video.name.split('.').pop()?.toLowerCase() || null,
          size: video.size,
          duration: video.duration ?? null,
        } as any,
      },
      hash
    );
    await sendPayload(
      createMultipartPayload({
        type: EMessageType.video,
        field: 'videos',
        file: video.file,
        message,
        messageQuotedId,
        hash,
      }),
      hash,
      true
    );
  }

  for (const document of savedDocuments) {
    const hash = createMessageHash();
    const localUrl = URL.createObjectURL(document.file);
    await registerLocalMessage(
      {
        ...buildMessageBaseContent(
          EMessageType.document,
          message || null,
          messageQuotedId,
          quoted
        ),
        document: {
          url: localUrl,
          name: document.name,
          mimetype: document.type,
          extension: document.extension,
          size: document.size,
        } as any,
      },
      hash
    );
    await sendPayload(
      createMultipartPayload({
        type: EMessageType.document,
        field: 'documents',
        file: document.file,
        message,
        messageQuotedId,
        hash,
      }),
      hash,
      true
    );
  }

  for (const audio of savedAudios) {
    const hash = createMessageHash();
    await registerLocalMessage(
      {
        ...buildMessageBaseContent(
          EMessageType.audio,
          null,
          messageQuotedId,
          quoted
        ),
        audio: {
          url: audio.preview,
          name: audio.name,
          mimetype: audio.type,
          extension: audio.name.split('.').pop()?.toLowerCase() || null,
          size: audio.size,
          duration: audio.duration ?? null,
        } as any,
      },
      hash
    );
    await sendPayload(
      createMultipartPayload({
        type: EMessageType.audio,
        field: 'audios',
        file: audio.file,
        messageQuotedId,
        hash,
      }),
      hash,
      true
    );
  }

  for (const contact of savedContacts) {
    const hash = createMessageHash();
    await registerLocalMessage(
      {
        ...buildMessageBaseContent(
          EMessageType.contact_card,
          message || null,
          messageQuotedId,
          quoted
        ),
        contact: {
          contact_id: contact.contact_id,
          name: contact.name,
          last_name: contact.last_name ?? null,
          phone: contact.phone_partial ?? null,
          phone_partial: contact.phone_partial ?? null,
          phone_ddi: contact.phone_ddi ?? null,
          email_partial: contact.email_partial ?? null,
          photo: contact.photo ?? null,
        },
      },
      hash
    );
    await sendPayload(
      {
        type: EMessageType.contact_card,
        message: message || undefined,
        contacts: [contact.contact_id],
        message_quoted_id: messageQuotedId,
        hash,
      },
      hash
    );
  }

  if (savedLocation) {
    const hash = createMessageHash();
    await registerLocalMessage(
      {
        ...buildMessageBaseContent(
          EMessageType.location,
          message || null,
          messageQuotedId,
          quoted
        ),
        location: savedLocation as any,
      },
      hash
    );
    await sendPayload(
      {
        type: EMessageType.location,
        message: message || undefined,
        location_latitude: savedLocation.latitude,
        location_longitude: savedLocation.longitude,
        location_name: savedLocation.name ?? null,
        location_address: savedLocation.address ?? null,
        message_quoted_id: messageQuotedId,
        hash,
      },
      hash
    );
  }

  if (
    savedImages.length === 0 &&
    savedVideos.length === 0 &&
    savedDocuments.length === 0 &&
    savedAudios.length === 0 &&
    savedContacts.length === 0 &&
    !savedLocation &&
    message.length > 0
  ) {
    const hash = createMessageHash();
    await registerLocalMessage(
      {
        ...buildMessageBaseContent(
          EMessageType.text,
          message,
          messageQuotedId,
          quoted
        ),
        link_preview: savedLinkPreview,
      },
      hash
    );
    await sendPayload(
      {
        type: EMessageType.text,
        message,
        message_quoted_id: messageQuotedId,
        link_preview: savedLinkPreview?.title ? savedLinkPreview : undefined,
        hash,
      },
      hash
    );
  }

  void internalChatStore.publishActivity(
    conversationId,
    EInternalChatActivityState.available
  );
};

const retryLocalMessage = async (message: InternalMessage) => {
  if (!activeConversation.value?.conversation_id || !message.hash) return;
  if (!hasMessageUploadError(message)) return;

  const conversationId = activeConversation.value.conversation_id;
  const hash = message.hash;
  const content = message.content;
  const retryMessageType = content.type as EMessageType;
  const messageText = content.message ?? null;
  const quotedId = content.message_quoted_id ?? null;

  internalChatStore.initializeLocalMessageState(hash);

  const sendPayload = async (
    payload: FormData | Record<string, unknown>,
    withProgress = false
  ) => {
    const success = await internalChatStore.createMessage(
      conversationId,
      payload as any,
      {
        skipLoading: true,
        onUploadProgress: withProgress
          ? (progress) => markUploadProgress(hash, progress)
          : undefined,
      }
    );
    if (!success) {
      markUploadError(hash);
      return;
    }
    internalChatStore.clearLocalMessageState(hash);
  };

  if (content.type === EMessageType.text) {
    await sendPayload({
      type: EMessageType.text,
      message: messageText,
      message_quoted_id: quotedId,
      link_preview: content.link_preview ?? undefined,
      hash,
    });
    return;
  }

  if (content.type === EMessageType.location && content.location) {
    await sendPayload({
      type: EMessageType.location,
      message: messageText ?? undefined,
      message_quoted_id: quotedId,
      location_latitude: content.location.latitude,
      location_longitude: content.location.longitude,
      location_name: content.location.name ?? null,
      location_address: content.location.address ?? null,
      hash,
    });
    return;
  }

  if (
    content.type === EMessageType.contact_card &&
    content.contact?.contact_id
  ) {
    await sendPayload({
      type: EMessageType.contact_card,
      message: messageText ?? undefined,
      message_quoted_id: quotedId,
      contacts: [content.contact.contact_id],
      hash,
    });
    return;
  }

  const media =
    content.image || content.video || content.audio || content.document || null;
  if (!media?.url) {
    markUploadError(hash);
    return;
  }

  try {
    const response = await fetch(media.url);
    const blob = await response.blob();
    const fileName =
      'name' in media && media.name
        ? media.name
        : `${retryMessageType}.${'extension' in media && media.extension ? media.extension : 'bin'}`;
    const file = new File([blob], fileName, {
      type: 'mimetype' in media && media.mimetype ? media.mimetype : blob.type,
    });

    const fieldByType: Partial<
      Record<EMessageType, 'images' | 'videos' | 'documents' | 'audios'>
    > = {
      [EMessageType.image]: 'images',
      [EMessageType.video]: 'videos',
      [EMessageType.document]: 'documents',
      [EMessageType.audio]: 'audios',
    };
    const field = fieldByType[retryMessageType];
    if (!field) {
      markUploadError(hash);
      return;
    }

    await sendPayload(
      createMultipartPayload({
        type: retryMessageType,
        field,
        file,
        message: messageText,
        messageQuotedId: quotedId,
        hash,
      }),
      true
    );
  } catch {
    markUploadError(hash);
  }
};

const removeImage = (index: number) => {
  selectedImages.value.splice(index, 1);
};

const removeVideo = (index: number) => {
  const video = selectedVideos.value[index];
  if (video?.preview.startsWith('blob:')) {
    URL.revokeObjectURL(video.preview);
  }
  selectedVideos.value.splice(index, 1);
};

const removeDocument = (index: number) => {
  selectedDocuments.value.splice(index, 1);
};

const removeAudio = (index: number) => {
  const audio = selectedAudios.value[index];
  if (audio?.preview.startsWith('blob:')) {
    URL.revokeObjectURL(audio.preview);
  }
  selectedAudios.value.splice(index, 1);
};

const removeContact = (index: number) => {
  selectedContacts.value.splice(index, 1);
};

const clearSelectedImages = () => {
  selectedImages.value = [];
};

const clearSelectedVideos = () => {
  for (const video of selectedVideos.value) {
    if (video.preview.startsWith('blob:')) URL.revokeObjectURL(video.preview);
  }
  selectedVideos.value = [];
};

const clearSelectedDocuments = () => {
  selectedDocuments.value = [];
};

const clearSelectedAudios = () => {
  for (const audio of selectedAudios.value) {
    if (audio.preview.startsWith('blob:')) URL.revokeObjectURL(audio.preview);
  }
  selectedAudios.value = [];
};

const clearSelectedContacts = () => {
  selectedContacts.value = [];
};

const validateAttachmentMix = (
  kind: 'image' | 'video' | 'document' | 'audio'
): boolean => {
  if (kind === 'image' && selectedVideos.value.length > 0) {
    internalChatStore.showSnackbar(
      t('clear_videos_before_images'),
      EColor.warning
    );
    return false;
  }
  if (kind === 'image' && selectedDocuments.value.length > 0) {
    internalChatStore.showSnackbar(
      t('clear_documents_before_images'),
      EColor.warning
    );
    return false;
  }
  if (kind === 'video' && selectedImages.value.length > 0) {
    internalChatStore.showSnackbar(
      t('clear_images_before_videos'),
      EColor.warning
    );
    return false;
  }
  if (kind === 'video' && selectedDocuments.value.length > 0) {
    internalChatStore.showSnackbar(
      t('clear_documents_before_videos'),
      EColor.warning
    );
    return false;
  }
  if (kind === 'document' && selectedImages.value.length > 0) {
    internalChatStore.showSnackbar(
      t('clear_images_before_documents'),
      EColor.warning
    );
    return false;
  }
  if (kind === 'document' && selectedVideos.value.length > 0) {
    internalChatStore.showSnackbar(
      t('clear_videos_before_documents'),
      EColor.warning
    );
    return false;
  }
  if (kind === 'audio' && selectedImages.value.length > 0) {
    internalChatStore.showSnackbar(
      t('clear_images_before_audios'),
      EColor.warning
    );
    return false;
  }
  if (kind === 'audio' && selectedVideos.value.length > 0) {
    internalChatStore.showSnackbar(
      t('clear_videos_before_audios'),
      EColor.warning
    );
    return false;
  }
  if (kind === 'audio' && selectedDocuments.value.length > 0) {
    internalChatStore.showSnackbar(
      t('clear_documents_before_audios'),
      EColor.warning
    );
    return false;
  }
  if (kind !== 'audio' && selectedAudios.value.length > 0) {
    internalChatStore.showSnackbar(
      t('clear_audios_before_attachments'),
      EColor.warning
    );
    return false;
  }
  return true;
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
      const duration = Number.isFinite(videoEl.duration)
        ? videoEl.duration
        : null;
      clean();
      resolve(duration);
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
      const duration = Number.isFinite(audioEl.duration)
        ? audioEl.duration
        : null;
      clean();
      resolve(duration);
    };
    audioEl.onerror = () => {
      clean();
      resolve(null);
    };
    audioEl.src = src;
  });

const formatAttachmentDuration = (seconds: number | null): string => {
  if (!seconds) return '00:00';
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const remainingSeconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
};

const formatFileSize = (bytes: number): string => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, exponent);
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[exponent]}`;
};

const truncateFileName = (name: string, max = 32): string => {
  if (name.length <= max) return name;
  const extensionIndex = name.lastIndexOf('.');
  if (extensionIndex === -1) return `${name.slice(0, max - 3)}...`;
  const extension = name.slice(extensionIndex);
  return `${name.slice(0, max - extension.length - 3)}...${extension}`;
};

const onContactsSelected = (contacts: ISelectedContactPreview[]) => {
  const existingIds = new Set(
    selectedContacts.value.map((item) => item.contact_id)
  );
  selectedContacts.value = [
    ...selectedContacts.value,
    ...contacts.filter((contact) => !existingIds.has(contact.contact_id)),
  ].slice(0, maxComposerFiles);
};

const onLocationSelected = (location: {
  latitude: number;
  longitude: number;
  name?: string | null;
  address?: string | null;
}) => {
  selectedLocation.value = location;
};

const onImagesSelected = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const files = Array.from(target.files ?? []);
  if (!files.length || !validateAttachmentMix('image')) {
    target.value = '';
    return;
  }

  const allowedTypes = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
  ]);
  const allowedExtensions = new Set(['jpg', 'jpeg', 'png', 'gif']);
  const validImages = files.filter((file) => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    return (
      (allowedTypes.has(file.type) ||
        Boolean(extension && allowedExtensions.has(extension))) &&
      file.size <= maxImageSizeBytes
    );
  });
  if (validImages.length !== files.length) {
    internalChatStore.showSnackbar(t('invalid_image_format'), EColor.error);
  }
  for (const file of validImages.slice(
    0,
    maxComposerFiles - selectedImages.value.length
  )) {
    await new Promise<void>((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          selectedImages.value.push({
            file,
            preview: event.target.result as string,
          });
        }
        resolve();
      };
      reader.onerror = () => resolve();
      reader.readAsDataURL(file);
    });
  }
  target.value = '';
};

const onVideosSelected = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const files = Array.from(target.files ?? []);
  if (!files.length || !validateAttachmentMix('video')) {
    target.value = '';
    return;
  }

  const allowedTypes = new Set([
    'video/mp4',
    'video/avi',
    'video/x-flv',
    'video/x-matroska',
    'video/quicktime',
    'video/3gpp',
  ]);
  const allowedExtensions = new Set(['mp4', 'avi', 'flv', 'mkv', 'mov', '3gp']);
  const validVideos = files.filter((file) => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    return (
      (allowedTypes.has(file.type) ||
        Boolean(extension && allowedExtensions.has(extension))) &&
      file.size <= maxVideoSizeBytes
    );
  });
  if (validVideos.length !== files.length) {
    internalChatStore.showSnackbar(t('invalid_video_format'), EColor.error);
  }
  for (const file of validVideos.slice(
    0,
    maxComposerFiles - selectedVideos.value.length
  )) {
    const preview = URL.createObjectURL(file);
    selectedVideos.value.push({
      file,
      preview,
      name: file.name,
      size: file.size,
      type: file.type,
      duration: await getVideoDuration(preview),
    });
  }
  target.value = '';
};

const onDocumentsSelected = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const files = Array.from(target.files ?? []);
  if (!files.length || !validateAttachmentMix('document')) {
    target.value = '';
    return;
  }

  const validDocuments = files.filter(
    (file) => file.size <= maxDocumentSizeBytes
  );
  if (validDocuments.length !== files.length) {
    internalChatStore.showSnackbar(t('document_size_exceeded'), EColor.error);
  }
  for (const file of validDocuments.slice(
    0,
    maxComposerFiles - selectedDocuments.value.length
  )) {
    selectedDocuments.value.push({
      file,
      name: file.name,
      size: file.size,
      extension: file.name.split('.').pop()?.toLowerCase() || '',
      type: file.type,
    });
  }
  target.value = '';
};

const onAudiosSelected = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const files = Array.from(target.files ?? []);
  if (!files.length || !validateAttachmentMix('audio')) {
    target.value = '';
    return;
  }

  const allowedTypes = new Set([
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
    'webm',
  ]);
  const validAudios = files.filter((file) => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    return (
      (allowedTypes.has(file.type) ||
        Boolean(extension && allowedExtensions.has(extension))) &&
      file.size <= maxAudioSizeBytes
    );
  });
  if (validAudios.length !== files.length) {
    internalChatStore.showSnackbar(t('invalid_audio_format'), EColor.error);
  }
  for (const file of validAudios.slice(
    0,
    maxComposerFiles - selectedAudios.value.length
  )) {
    const preview = URL.createObjectURL(file);
    selectedAudios.value.push({
      file,
      preview,
      name: file.name,
      size: file.size,
      type: file.type || 'audio/webm',
      duration: await getAudioDuration(preview),
    });
  }
  target.value = '';
};

const processPastedFile = async (file: File) => {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';

  if (
    file.type.startsWith('image/') ||
    ['jpg', 'jpeg', 'png', 'gif'].includes(extension)
  ) {
    if (!validateAttachmentMix('image')) return;
    if (file.size > maxImageSizeBytes) {
      internalChatStore.showSnackbar(t('image_size_exceeded'), EColor.error);
      return;
    }
    if (selectedImages.value.length >= maxComposerFiles) {
      internalChatStore.showSnackbar(t('max_images_selected'), EColor.warning);
      return;
    }
    await new Promise<void>((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          selectedImages.value.push({
            file,
            preview: event.target.result as string,
          });
        }
        resolve();
      };
      reader.onerror = () => resolve();
      reader.readAsDataURL(file);
    });
    return;
  }

  if (
    file.type.startsWith('video/') ||
    ['mp4', 'avi', 'flv', 'mkv', 'mov', '3gp'].includes(extension)
  ) {
    if (!validateAttachmentMix('video')) return;
    if (file.size > maxVideoSizeBytes) {
      internalChatStore.showSnackbar(t('video_size_exceeded'), EColor.error);
      return;
    }
    if (selectedVideos.value.length >= maxComposerFiles) {
      internalChatStore.showSnackbar(t('max_videos_selected'), EColor.warning);
      return;
    }
    const preview = URL.createObjectURL(file);
    selectedVideos.value.push({
      file,
      preview,
      name: file.name,
      size: file.size,
      type: file.type,
      duration: await getVideoDuration(preview),
    });
    return;
  }

  if (
    file.type.startsWith('audio/') ||
    ['mp3', 'aac', 'm4a', 'amr', 'ogg', 'opus', 'webm'].includes(extension)
  ) {
    if (!validateAttachmentMix('audio')) return;
    if (file.size > maxAudioSizeBytes) {
      internalChatStore.showSnackbar(t('audio_size_exceeded'), EColor.error);
      return;
    }
    if (selectedAudios.value.length >= maxComposerFiles) {
      internalChatStore.showSnackbar(t('max_audios_selected'), EColor.warning);
      return;
    }
    const preview = URL.createObjectURL(file);
    selectedAudios.value.push({
      file,
      preview,
      name: file.name,
      size: file.size,
      type: file.type || 'audio/webm',
      duration: await getAudioDuration(preview),
    });
    return;
  }

  if (!validateAttachmentMix('document')) return;
  if (file.size > maxDocumentSizeBytes) {
    internalChatStore.showSnackbar(t('document_size_exceeded'), EColor.error);
    return;
  }
  if (selectedDocuments.value.length >= maxComposerFiles) {
    internalChatStore.showSnackbar(t('max_documents_selected'), EColor.warning);
    return;
  }
  selectedDocuments.value.push({
    file,
    name: file.name,
    size: file.size,
    extension,
    type: file.type,
  });
};

const handlePaste = async (event: ClipboardEvent) => {
  const items = event.clipboardData?.items;
  if (!items) return;

  const files: File[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }

  if (files.length === 0) return;
  event.preventDefault();

  for (const file of files) {
    await processPastedFile(file);
  }
};

const updateRecordingDuration = () => {
  if (recordingStartAt.value === null) {
    recordingDurationMs.value = recordingAccumulatedMs.value;
    return;
  }

  recordingDurationMs.value =
    recordingAccumulatedMs.value + (performance.now() - recordingStartAt.value);
};

const setupRecordingCanvas = () => {
  const canvas = audioCanvasRef.value;
  if (!canvas) return;

  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, canvas.offsetWidth || 220) * dpr;
  const height = Math.max(1, canvas.offsetHeight || 28) * dpr;

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
};

const drawRecordingWaveform = () => {
  if (
    !isRecordingAudio.value ||
    isRecordingPaused.value ||
    !audioAnalyserRef.value
  ) {
    return;
  }

  const canvas = audioCanvasRef.value;
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;

  const analyser = audioAnalyserRef.value;
  const bufferLength = analyser.fftSize;
  if (
    !audioDataArrayRef.value ||
    audioDataArrayRef.value.length !== bufferLength
  ) {
    audioDataArrayRef.value = new Uint8Array(bufferLength);
  }

  analyser.getByteTimeDomainData(
    audioDataArrayRef.value as unknown as Uint8Array<ArrayBuffer>
  );
  setupRecordingCanvas();

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const centerY = height / 2;
  const sliceWidth = width / bufferLength;

  context.save();
  context.scale(dpr, dpr);
  context.clearRect(0, 0, width, height);
  context.lineWidth = 2;
  context.lineCap = 'round';
  context.strokeStyle = 'rgba(34, 197, 94, 0.35)';
  context.beginPath();
  context.moveTo(0, centerY);
  context.lineTo(width, centerY);
  context.stroke();

  context.strokeStyle = 'rgba(34, 197, 94, 0.95)';
  context.beginPath();

  let x = 0;
  for (let index = 0; index < bufferLength; index += 4) {
    const value = audioDataArrayRef.value[index] / 128;
    const y = (value * height) / 2;

    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }

    x += sliceWidth * 4;
  }

  context.stroke();
  context.restore();

  recordingAnimationFrame.value = requestAnimationFrame(drawRecordingWaveform);
};

const clearRecordingTimers = () => {
  if (recordingTimer.value) {
    clearInterval(recordingTimer.value);
    recordingTimer.value = null;
  }

  if (recordingAnimationFrame.value) {
    cancelAnimationFrame(recordingAnimationFrame.value);
    recordingAnimationFrame.value = null;
  }
};

const publishRecordingAvailable = () => {
  if (!activeConversation.value?.conversation_id) return;

  void internalChatStore.publishActivity(
    activeConversation.value.conversation_id,
    EInternalChatActivityState.available
  );
};

const releaseRecordingResources = () => {
  clearRecordingTimers();

  if (mediaStreamRef.value) {
    mediaStreamRef.value.getTracks().forEach((track) => track.stop());
    mediaStreamRef.value = null;
  }

  if (audioContextRef.value) {
    audioContextRef.value.close().catch(() => null);
    audioContextRef.value = null;
  }

  audioAnalyserRef.value = null;
  audioDataArrayRef.value = null;
  mediaRecorderRef.value = null;
};

const resetAudioRecordingState = () => {
  isRecordingAudio.value = false;
  isRecordingPaused.value = false;
  shouldSendRecording.value = false;
  recordingStartAt.value = null;
  recordingAccumulatedMs.value = 0;
  recordingDurationMs.value = 0;
  audioChunksRef.value = [];
};

const resolveRecordingMimeType = (mimeType?: string | null): string => {
  const normalizedMimeType = mimeType?.trim();
  if (normalizedMimeType) return normalizedMimeType;

  return 'audio/webm';
};

const resolveRecordingExtension = (mimeType: string): string => {
  const normalizedMimeType = mimeType.toLowerCase();
  if (normalizedMimeType.includes('ogg')) return 'ogg';
  if (normalizedMimeType.includes('opus')) return 'opus';
  if (normalizedMimeType.includes('mpeg')) return 'mp3';
  if (
    normalizedMimeType.includes('mp4') ||
    normalizedMimeType.includes('m4a')
  ) {
    return 'm4a';
  }
  if (normalizedMimeType.includes('webm')) return 'webm';

  return 'webm';
};

const createAudioRecorder = (stream: MediaStream): MediaRecorder => {
  const preferredMimeTypes = [
    'audio/ogg;codecs=opus',
    'audio/opus',
    'audio/ogg',
    'audio/webm;codecs=opus',
    'audio/webm',
  ];

  for (const mimeType of preferredMimeTypes) {
    if (!MediaRecorder.isTypeSupported(mimeType)) continue;

    try {
      return new MediaRecorder(stream, { mimeType });
    } catch {}
  }

  return new MediaRecorder(stream);
};

const sendRecordedAudioFile = async (file: File, duration: number | null) => {
  if (!activeConversation.value?.conversation_id) return false;
  if (file.size > maxAudioSizeBytes) {
    internalChatStore.showSnackbar(t('audio_size_exceeded'), EColor.error);
    return false;
  }

  const conversationId = activeConversation.value.conversation_id;
  const messageQuotedId = replyMessage.value?.message_id ?? null;
  const quoted = getQuotedLocalPayload(replyMessage.value);
  const preview = URL.createObjectURL(file);
  const hash = createMessageHash();

  replyMessage.value = null;
  composerText.value = '';
  linkPreview.value = null;

  await registerLocalMessage(
    {
      ...buildMessageBaseContent(
        EMessageType.audio,
        null,
        messageQuotedId,
        quoted
      ),
      audio: {
        url: preview,
        name: file.name,
        mimetype: file.type || 'audio/webm',
        extension: file.name.split('.').pop()?.toLowerCase() || null,
        size: file.size,
        duration,
      } as any,
    },
    hash
  );

  const success = await internalChatStore.createMessage(
    conversationId,
    createMultipartPayload({
      type: EMessageType.audio,
      field: 'audios',
      file,
      messageQuotedId,
      hash,
    }) as any,
    {
      skipLoading: true,
      onUploadProgress: (progress) => markUploadProgress(hash, progress),
    }
  );

  if (!success) {
    markUploadError(hash);
    return false;
  }

  internalChatStore.clearLocalMessageState(hash);
  return true;
};

const handleAudioRecordingStop = async (recorder: MediaRecorder) => {
  updateRecordingDuration();

  const shouldSend = shouldSendRecording.value;
  const chunks = [...audioChunksRef.value];
  const duration = Math.max(0, Math.round(recordingDurationMs.value / 1000));
  const mimeType = resolveRecordingMimeType(recorder.mimeType);
  const extension = resolveRecordingExtension(mimeType);

  releaseRecordingResources();
  resetAudioRecordingState();
  publishRecordingAvailable();

  if (!shouldSend || chunks.length === 0) {
    recordingSending.value = false;
    return;
  }

  recordingSending.value = true;

  try {
    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size <= 0) return;

    const file = new File([blob], `audio-${Date.now()}.${extension}`, {
      type: mimeType,
    });

    await sendRecordedAudioFile(file, duration);
  } finally {
    recordingSending.value = false;
  }
};

const startAudioRecording = async () => {
  if (
    recordingStarting.value ||
    recordingSending.value ||
    isRecordingAudio.value
  ) {
    return;
  }

  recordingStarting.value = true;
  releaseRecordingResources();
  resetAudioRecordingState();

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      internalChatStore.showSnackbar(
        t('internal_chat_microphone_error'),
        EColor.error
      );
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.value = stream;

    const recorder = createAudioRecorder(stream);
    mediaRecorderRef.value = recorder;
    audioChunksRef.value = [];

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size > 0) {
        audioChunksRef.value.push(event.data);
      }
    });

    recorder.addEventListener('stop', () => {
      void handleAudioRecordingStop(recorder);
    });

    const AudioContextCtor = window.AudioContext;
    const audioContext = new AudioContextCtor();
    audioContextRef.value = audioContext;
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    audioAnalyserRef.value = analyser;

    recorder.start(250);
    isRecordingAudio.value = true;
    isRecordingPaused.value = false;
    shouldSendRecording.value = false;
    recordingAccumulatedMs.value = 0;
    recordingDurationMs.value = 0;
    recordingStartAt.value = performance.now();

    recordingTimer.value = setInterval(updateRecordingDuration, 200);

    await nextTick();
    setupRecordingCanvas();
    drawRecordingWaveform();

    if (activeConversation.value?.conversation_id) {
      void internalChatStore.publishActivity(
        activeConversation.value.conversation_id,
        EInternalChatActivityState.recording
      );
    }
  } catch {
    releaseRecordingResources();
    resetAudioRecordingState();
    internalChatStore.showSnackbar(
      t('internal_chat_microphone_error'),
      EColor.error
    );
  } finally {
    recordingStarting.value = false;
  }
};

const stopActiveAudioRecorder = () => {
  const recorder = mediaRecorderRef.value;
  if (!recorder || recorder.state === 'inactive') {
    releaseRecordingResources();
    resetAudioRecordingState();
    publishRecordingAvailable();
    return;
  }

  recorder.stop();
};

const cancelAudioRecording = () => {
  if (!isRecordingAudio.value && !mediaRecorderRef.value) return;

  shouldSendRecording.value = false;
  isRecordingAudio.value = false;
  isRecordingPaused.value = false;
  stopActiveAudioRecorder();
};

const finalizeAudioRecording = () => {
  if (!isRecordingAudio.value && !mediaRecorderRef.value) return;

  updateRecordingDuration();
  shouldSendRecording.value = true;
  isRecordingAudio.value = false;
  isRecordingPaused.value = false;
  stopActiveAudioRecorder();
};

const togglePauseAudioRecording = async () => {
  const recorder = mediaRecorderRef.value;
  if (!isRecordingAudio.value || !recorder) return;

  if (!isRecordingPaused.value) {
    if (recorder.state === 'recording') {
      recorder.pause();
    }

    if (recordingStartAt.value !== null) {
      recordingAccumulatedMs.value +=
        performance.now() - recordingStartAt.value;
      recordingStartAt.value = null;
    }
    updateRecordingDuration();

    if (audioContextRef.value?.state === 'running') {
      await audioContextRef.value.suspend().catch(() => null);
    }
    if (recordingAnimationFrame.value) {
      cancelAnimationFrame(recordingAnimationFrame.value);
      recordingAnimationFrame.value = null;
    }

    isRecordingPaused.value = true;
    return;
  }

  if (recorder.state === 'paused') {
    recorder.resume();
  }
  if (audioContextRef.value?.state === 'suspended') {
    await audioContextRef.value.resume().catch(() => null);
  }

  recordingStartAt.value = performance.now();
  updateRecordingDuration();
  isRecordingPaused.value = false;
  drawRecordingWaveform();
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

const onEdit = (message: InternalMessage) => {
  if (!activeConversation.value?.conversation_id) return;
  if (!canEditInternalMessage(message)) return;

  editMessageTarget.value = message;
  editMessageText.value = message.content.message ?? '';
  isEditMessageDialogOpen.value = true;
};

const closeEditMessageDialog = () => {
  if (editingMessage.value) return;

  isEditMessageDialogOpen.value = false;
  editMessageTarget.value = null;
  editMessageText.value = '';
};

const confirmEditMessage = async () => {
  if (!activeConversation.value?.conversation_id) return;
  if (!editMessageTarget.value) return;
  if (!canEditInternalMessage(editMessageTarget.value)) return;
  if (!canSubmitEditMessage.value) return;

  editingMessage.value = true;

  try {
    const success = await internalChatStore.editMessage(
      activeConversation.value.conversation_id,
      editMessageTarget.value.message_id,
      editMessageText.value.trim()
    );

    if (!success) return;

    isEditMessageDialogOpen.value = false;
    editMessageTarget.value = null;
    editMessageText.value = '';
  } finally {
    editingMessage.value = false;
  }
};

const openMessageHistoryDialog = async (message: InternalMessage) => {
  if (!activeConversation.value?.conversation_id) return;
  if (!canViewMessageHistory(message)) return;

  messageHistoryTarget.value = message;
  isMessageHistoryDialogOpen.value = true;
  messageHistoryItems.value = [];
  loadingMessageHistory.value = true;

  try {
    const items = await internalChatStore.viewMessageHistory(
      activeConversation.value.conversation_id,
      message.message_id
    );

    if (messageHistoryTarget.value?.message_id !== message.message_id) return;

    messageHistoryItems.value = mapMessageHistoryItems(items);
  } finally {
    loadingMessageHistory.value = false;
  }
};

const closeMessageHistoryDialog = () => {
  isMessageHistoryDialogOpen.value = false;
  messageHistoryTarget.value = null;
  messageHistoryItems.value = [];
  loadingMessageHistory.value = false;
};

const onDelete = async (message: InternalMessage) => {
  if (!activeConversation.value?.conversation_id) return;
  if (!canDeleteInternalMessage(message)) return;

  deleteMessageTarget.value = message;
  isDeleteMessageDialogOpen.value = true;
};

const closeDeleteMessageDialog = () => {
  if (deletingMessage.value) return;

  isDeleteMessageDialogOpen.value = false;
  deleteMessageTarget.value = null;
};

const confirmDeleteMessage = async () => {
  if (!activeConversation.value?.conversation_id) return;
  if (!deleteMessageTarget.value) return;
  if (!canDeleteInternalMessage(deleteMessageTarget.value)) return;
  if (deletingMessage.value) return;

  deletingMessage.value = true;

  try {
    const success = await internalChatStore.deleteMessage(
      activeConversation.value.conversation_id,
      deleteMessageTarget.value.message_id
    );

    if (!success) return;

    isDeleteMessageDialogOpen.value = false;
    deleteMessageTarget.value = null;
  } finally {
    deletingMessage.value = false;
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

watch(composerTextDebounced, async (value) => {
  if (hasAnyAttachment.value) {
    linkPreview.value = null;
    isLoadingLinkPreview.value = false;
    return;
  }

  const firstUrl = extractFirstUrl(value || '');
  if (!firstUrl) {
    linkPreview.value = null;
    isLoadingLinkPreview.value = false;
    return;
  }

  isLoadingLinkPreview.value = true;
  try {
    const preview = await internalChatStore.generateLinkPreview({
      url: firstUrl,
    });
    linkPreview.value = preview && preview.title !== 'Error' ? preview : null;
  } finally {
    isLoadingLinkPreview.value = false;
  }
});

watch(hasAnyAttachment, (hasAttachment) => {
  if (!hasAttachment) return;
  linkPreview.value = null;
  isLoadingLinkPreview.value = false;
});

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
  if (isOpen) {
    isSearchDrawerOpen.value = false;
    return;
  }

  isAddGroupMembersDialogOpen.value = false;
  resetGroupCandidateUsers();
});

watch(isUserInfoDrawerOpen, (isOpen) => {
  if (!isOpen) {
    selectedUserInfo.value = null;
    selectedUserInfoConversationUserId.value = null;
    return;
  }

  isGroupInfoDrawerOpen.value = false;
  isSearchDrawerOpen.value = false;
});

watch(isDeleteMessageDialogOpen, (isOpen) => {
  if (isOpen || deletingMessage.value) return;
  deleteMessageTarget.value = null;
});

watch(isEditMessageDialogOpen, (isOpen) => {
  if (isOpen || editingMessage.value) return;
  editMessageTarget.value = null;
  editMessageText.value = '';
});

watch(isMessageHistoryDialogOpen, (isOpen) => {
  if (isOpen) return;
  messageHistoryTarget.value = null;
  messageHistoryItems.value = [];
  loadingMessageHistory.value = false;
});

watch(
  () => activeConversation.value?.conversation_id,
  async () => {
    shouldAutoScrollMessages.value = true;
    showScrollToBottom.value = false;
    fixedMessageDateLabel.value = '';
    showReactionPicker.value = null;
    showEmojiPicker.value = null;
    if (!deletingMessage.value) {
      isDeleteMessageDialogOpen.value = false;
      deleteMessageTarget.value = null;
    }
    if (!editingMessage.value) {
      isEditMessageDialogOpen.value = false;
      editMessageTarget.value = null;
      editMessageText.value = '';
    }
    isMessageHistoryDialogOpen.value = false;
    messageHistoryTarget.value = null;
    messageHistoryItems.value = [];
    loadingMessageHistory.value = false;
    isSearchDrawerOpen.value = false;

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

watch(
  () => messages.value[messages.value.length - 1]?.message_id,
  async (messageId, previousMessageId) => {
    await updateMessageScrollbar();

    if (messageId) {
      await scrollMessagesToBottom(Boolean(previousMessageId));
      return;
    }

    updateMessageScrollState();
  }
);

watch(
  () => messages.value,
  (messageList) => {
    for (const message of messageList) {
      if (
        message.content?.type === EMessageType.audio &&
        message.content.audio?.url &&
        !audioWaveforms[message.message_id]
      ) {
        loadAudioWaveform(message.message_id, message.content.audio.waveform);
      }
    }
  },
  { deep: true, immediate: true }
);

onMounted(async () => {
  webGLSupported.value = isWebGLSupported();
  await loadSidebar(false);
  await internalChatSocket.initializeSocket();
  await updateMessageScrollbar();
  if (activeConversation.value) {
    await scrollMessagesToBottom();
  }
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

  if (activityCleanupTimer.value) {
    clearInterval(activityCleanupTimer.value);
    activityCleanupTimer.value = null;
  }

  clearHighlightedMessage();

  shouldSendRecording.value = false;
  if (mediaRecorderRef.value && mediaRecorderRef.value.state !== 'inactive') {
    mediaRecorderRef.value.stop();
  }
  releaseRecordingResources();
  resetAudioRecordingState();

  for (const audio of audioPlayers.value.values()) {
    audio.pause();
    audio.src = '';
  }
  audioPlayers.value.clear();
  for (const key of Object.keys(audioPlayStates)) {
    delete audioPlayStates[key];
  }
  for (const key of Object.keys(audioCurrentTimes)) {
    delete audioCurrentTimes[key];
  }
  for (const key of Object.keys(audioDurations)) {
    delete audioDurations[key];
  }
  for (const key of Object.keys(audioWaveforms)) {
    delete audioWaveforms[key];
  }
  for (const key of Object.keys(audioPlaybackRates)) {
    delete audioPlaybackRates[key];
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
            v-if="props.showBackToChat"
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
                <VListItem @click="openSearchDrawer">
                  <template #prepend>
                    <VIcon size="18">tabler-search</VIcon>
                  </template>
                  <VListItemTitle>
                    {{ t('search_messages') }}
                  </VListItemTitle>
                </VListItem>

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

        <div
          class="internal-chat-message-scroll"
          @wheel.passive="handleMessageListWheel"
        >
          <PerfectScrollbar
            ref="messageListScrollRef"
            :options="{ wheelPropagation: false }"
            class="internal-chat-message-list px-4 py-3"
            @ps-scroll-y="handleMessageListScroll"
          >
            <div
              v-if="loadingPreviousMessages"
              class="d-flex justify-center mb-3"
            >
              <VProgressCircular indeterminate color="primary" size="24" />
            </div>

            <template
              v-for="displayItem in messageDisplayItems"
              :key="displayItem.id"
            >
              <div
                v-if="displayItem.kind === 'date-separator'"
                class="internal-chat-date-separator-wrapper"
                :data-separator-date="displayItem.separatorDate"
                :data-separator-label="displayItem.separatorLabel"
              >
                <div class="internal-chat-date-separator-line"></div>
                <div class="internal-chat-date-separator">
                  {{ displayItem.separatorLabel }}
                </div>
                <div class="internal-chat-date-separator-line"></div>
              </div>

              <template v-else-if="displayItem.kind === 'message'">
                <div
                  v-for="message in [displayItem.message]"
                  :key="message.message_id"
                  :id="`internal-msg-${message.message_id}`"
                  :data-message-id="message.message_id"
                  class="internal-chat-message-row"
                  :class="{
                    'internal-chat-message-row--mine': isOwnMessage(message),
                    'internal-chat-message-row--system':
                      isSystemMessage(message),
                    'internal-chat-message-row--target':
                      highlightedMessageId === message.message_id,
                  }"
                  @mouseenter="onMessageMouseEnter(message)"
                  @mouseleave="onMessageMouseLeave"
                >
                  <div
                    v-if="isSystemMessage(message)"
                    class="internal-chat-system-message"
                  >
                    {{ resolveSystemMessageText(message) }}
                  </div>

                  <button
                    v-if="!isSystemMessage(message)"
                    type="button"
                    class="internal-chat-message-avatar-button"
                    :disabled="!message.user?.id"
                    :aria-label="t('internal_chat_user_information')"
                    @click.stop="openMessageUserInfoDrawer(message)"
                  >
                    <VAvatar
                      size="32"
                      class="internal-chat-message-avatar"
                      :class="{
                        'internal-chat-message-avatar--mine':
                          isOwnMessage(message),
                      }"
                    >
                      <VImg
                        :src="resolveMessageAvatarSource(message)"
                        :alt="
                          message.user?.name || t('internal_chat_system_user')
                        "
                        cover
                      />
                    </VAvatar>
                  </button>

                  <div
                    v-if="!isSystemMessage(message)"
                    class="internal-chat-message-shell"
                    :class="{
                      'internal-chat-message-shell--mine':
                        isOwnMessage(message),
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
                        'internal-chat-reaction-trigger--mine':
                          isOwnMessage(message),
                      }"
                      :aria-label="t('internal_chat_react_to_message')"
                      @click.stop="toggleReactionPicker(message)"
                    >
                      <VIcon size="20">tabler-mood-smile</VIcon>
                    </button>

                    <div
                      class="internal-chat-message-bubble"
                      :class="{
                        'internal-chat-message-bubble--mine':
                          isOwnMessage(message),
                        'internal-chat-message-bubble--deleted':
                          isDeletedMessage(message),
                        'internal-chat-message-bubble--with-reactions':
                          message.content?.reactions?.length,
                      }"
                    >
                      <div class="internal-chat-message-header">
                        <span class="text-caption text-medium-emphasis">
                          {{
                            message.user?.name || t('internal_chat_system_user')
                          }}
                        </span>

                        <VMenu
                          v-if="canShowMessageActions(message)"
                          location="bottom end"
                          offset="6"
                        >
                          <template #activator="{ props }">
                            <IconBtn
                              class="internal-chat-message-action-btn"
                              size="x-small"
                              v-bind="props"
                            >
                              <VIcon size="16">tabler-chevron-down</VIcon>
                            </IconBtn>
                          </template>

                          <VList density="compact" min-width="190">
                            <template v-if="isDeletedMessage(message)">
                              <VListItem
                                v-if="canViewMessageHistory(message)"
                                @click="openMessageHistoryDialog(message)"
                              >
                                <template #prepend>
                                  <VIcon size="18">tabler-history</VIcon>
                                </template>
                                <VListItemTitle>
                                  {{ t('internal_chat_view_message_history') }}
                                </VListItemTitle>
                              </VListItem>
                            </template>

                            <template v-else>
                              <VListItem @click="onReply(message)">
                                <template #prepend>
                                  <VIcon size="18">
                                    tabler-corner-up-left
                                  </VIcon>
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
                                v-if="canViewMessageHistory(message)"
                                @click="openMessageHistoryDialog(message)"
                              >
                                <template #prepend>
                                  <VIcon size="18">tabler-history</VIcon>
                                </template>
                                <VListItemTitle>
                                  {{ t('internal_chat_view_message_history') }}
                                </VListItemTitle>
                              </VListItem>

                              <VListItem
                                v-if="canDeleteInternalMessage(message)"
                                @click="onDelete(message)"
                              >
                                <template #prepend>
                                  <VIcon size="18">tabler-trash</VIcon>
                                </template>
                                <VListItemTitle>
                                  {{ t('internal_chat_delete_action') }}
                                </VListItemTitle>
                              </VListItem>
                            </template>
                          </VList>
                        </VMenu>
                      </div>

                      <button
                        v-if="showQuotedMessage(message)"
                        type="button"
                        class="internal-chat-quoted"
                        :class="{
                          'internal-chat-quoted--clickable':
                            hasQuotedNavigationTarget(message),
                        }"
                        :aria-label="t('internal_chat_original_message')"
                        @click.prevent.stop="goToQuotedMessage(message)"
                      >
                        <div
                          v-if="resolveQuotedPreviewImageSrc(message)"
                          class="internal-chat-reply-preview-media"
                        >
                          <img
                            :src="resolveQuotedPreviewImageSrc(message) || ''"
                            :alt="t('photo_label')"
                          />
                        </div>
                        <div
                          v-else-if="
                            isReplyPreviewDocument(
                              resolveQuotedPreviewContent(message)
                            )
                          "
                          class="internal-chat-reply-preview-icon"
                        >
                          <VIcon
                            :icon="resolveQuotedPreviewDocumentIcon(message)"
                            size="26"
                            color="primary"
                          />
                        </div>
                        <div
                          v-else-if="
                            isReplyPreviewVideo(
                              resolveQuotedPreviewContent(message)
                            )
                          "
                          class="internal-chat-reply-preview-icon"
                        >
                          <VIcon size="26" color="primary">
                            tabler-player-play
                          </VIcon>
                        </div>
                        <div
                          v-else-if="
                            isReplyPreviewAudio(
                              resolveQuotedPreviewContent(message)
                            )
                          "
                          class="internal-chat-reply-preview-icon"
                        >
                          <VIcon size="26" color="primary">
                            tabler-microphone
                          </VIcon>
                        </div>
                        <div
                          v-else-if="
                            isReplyPreviewLocation(
                              resolveQuotedPreviewContent(message)
                            )
                          "
                          class="internal-chat-reply-preview-icon"
                        >
                          <VIcon size="26" color="primary">
                            tabler-map-pin
                          </VIcon>
                        </div>
                        <div
                          v-else-if="
                            isReplyPreviewContact(
                              resolveQuotedPreviewContent(message)
                            )
                          "
                          class="internal-chat-reply-preview-icon"
                        >
                          <VAvatar
                            v-if="resolveQuotedPreviewContactPhoto(message)"
                            size="26"
                          >
                            <VImg
                              :src="
                                resolveQuotedPreviewContactPhoto(message) || ''
                              "
                              :alt="resolveQuotedText(message)"
                            />
                          </VAvatar>
                          <VIcon
                            v-else
                            size="26"
                            color="primary"
                            :icon="
                              isReplyPreviewContactGroup(
                                resolveQuotedPreviewContent(message)
                              )
                                ? 'tabler-users'
                                : 'tabler-user'
                            "
                          />
                        </div>

                        <div class="internal-chat-reply-preview-content">
                          <div class="internal-chat-reply-preview-name">
                            {{ resolveQuotedName(message) }}
                          </div>
                          <div class="internal-chat-reply-preview-text">
                            {{
                              resolveQuotedText(message) ||
                              t('internal_chat_message')
                            }}
                          </div>
                          <div
                            v-if="resolveQuotedPreviewMeta(message)"
                            class="internal-chat-reply-preview-meta"
                          >
                            {{ resolveQuotedPreviewMeta(message) }}
                          </div>
                        </div>
                      </button>

                      <div
                        v-if="
                          resolveMessageText(message) &&
                          shouldRenderMessageTextBeforeMedia(message)
                        "
                        class="internal-chat-message-text mb-2"
                        :class="{
                          'internal-chat-message-text--deleted':
                            isDeletedMessage(message),
                        }"
                      >
                        {{ resolveMessageText(message) }}
                      </div>

                      <div
                        v-if="message.content?.link_preview"
                        class="internal-chat-link-preview"
                      >
                        <ChatLinkPreview
                          :preview="message.content.link_preview as any"
                        />
                      </div>

                      <button
                        v-if="message.content?.image?.url"
                        type="button"
                        class="internal-chat-media-frame"
                        :aria-label="t('internal_chat_image_alt')"
                        @click="openMessageMediaViewer(message)"
                      >
                        <img
                          :src="message.content.image.url"
                          class="internal-chat-media"
                          :alt="t('internal_chat_image_alt')"
                        />
                      </button>

                      <button
                        v-if="message.content?.video?.url"
                        type="button"
                        class="internal-chat-media-frame"
                        :aria-label="t('internal_chat_videos')"
                        @click="openMessageMediaViewer(message)"
                      >
                        <video
                          :src="message.content.video.url"
                          class="internal-chat-media"
                          preload="metadata"
                          muted
                          playsinline
                        >
                          <track kind="captions" />
                        </video>
                        <span class="internal-chat-video-overlay">
                          <VIcon size="26">tabler-player-play</VIcon>
                        </span>
                      </button>

                      <div
                        v-if="message.content?.audio?.url"
                        class="internal-chat-audio-bubble"
                        :class="{
                          'internal-chat-audio-bubble--right':
                            isOwnMessage(message),
                          'internal-chat-audio-bubble--left':
                            !isOwnMessage(message),
                          'is-deleted': isDeletedMessage(message),
                        }"
                      >
                        <div class="internal-chat-audio-player-container">
                          <button
                            type="button"
                            class="internal-chat-audio-speed-btn"
                            @click.stop="toggleAudioSpeed(message.message_id)"
                          >
                            {{ getAudioSpeedLabel(message.message_id) }}
                          </button>
                          <VBtn
                            icon
                            size="36"
                            variant="text"
                            class="internal-chat-audio-play-btn"
                            @click="
                              toggleAudioPlay(
                                message.message_id,
                                message.content.audio.url || ''
                              )
                            "
                          >
                            <VIcon size="18">
                              {{
                                isAudioPlaying(message.message_id)
                                  ? 'tabler-player-pause'
                                  : 'tabler-player-play'
                              }}
                            </VIcon>
                          </VBtn>

                          <div
                            class="internal-chat-audio-waveform-container"
                            @click="
                              seekAudio(
                                message.message_id,
                                message.content.audio.url || '',
                                $event
                              )
                            "
                          >
                            <template
                              v-if="
                                (audioWaveforms[message.message_id]?.length ||
                                  0) > 0
                              "
                            >
                              <div class="internal-chat-audio-waveform">
                                <div
                                  v-for="(barValue, index) in audioWaveforms[
                                    message.message_id
                                  ]"
                                  :key="`${message.message_id}-audio-wave-${index}`"
                                  class="internal-chat-audio-waveform-bar"
                                  :class="{
                                    'internal-chat-audio-waveform-bar--active':
                                      getAudioProgress(message.message_id) >
                                      (index /
                                        (audioWaveforms[message.message_id]
                                          ?.length || 64)) *
                                        100,
                                  }"
                                  :style="{
                                    height: `${Math.max(2, barValue * 100)}%`,
                                  }"
                                ></div>
                              </div>
                              <div
                                class="internal-chat-audio-progress-indicator"
                                :style="{
                                  left: `${getAudioProgress(
                                    message.message_id
                                  )}%`,
                                }"
                              ></div>
                            </template>
                            <div
                              v-else
                              class="internal-chat-audio-waveform-placeholder"
                            >
                              <div
                                v-for="index in 64"
                                :key="`${message.message_id}-audio-placeholder-${index}`"
                                class="internal-chat-audio-waveform-bar-placeholder"
                              ></div>
                            </div>
                          </div>
                        </div>

                        <div class="internal-chat-audio-meta">
                          {{
                            getDisplayAudioTime(
                              message.message_id,
                              message.content.audio.duration
                            )
                          }}
                        </div>

                        <p
                          v-if="message.content?.message"
                          class="internal-chat-media-caption"
                        >
                          {{ message.content.message }}
                        </p>
                      </div>

                      <div
                        v-if="message.content?.document?.url"
                        class="internal-chat-document-content"
                      >
                        <div
                          class="internal-chat-document-bubble"
                          :class="{
                            'internal-chat-document-bubble--right':
                              isOwnMessage(message),
                            'internal-chat-document-bubble--left':
                              !isOwnMessage(message),
                            'is-deleted': isDeletedMessage(message),
                          }"
                        >
                          <div class="internal-chat-document-icon">
                            <VIcon
                              :icon="
                                resolveInternalDocumentIcon(
                                  message.content.document
                                )
                              "
                              size="26"
                              color="primary"
                            />
                          </div>
                          <div class="internal-chat-document-details">
                            <VTooltip location="bottom">
                              <template #activator="{ props }">
                                <a
                                  v-bind="props"
                                  class="internal-chat-document-name"
                                  :href="message.content.document.url"
                                  :download="
                                    resolveInternalDocumentDownloadName(
                                      message.content.document
                                    )
                                  "
                                  target="_blank"
                                  rel="noopener"
                                >
                                  {{
                                    truncateFileName(
                                      resolveInternalDocumentName(
                                        message.content.document
                                      ),
                                      30
                                    )
                                  }}
                                </a>
                              </template>
                              <span>
                                {{
                                  resolveInternalDocumentName(
                                    message.content.document
                                  )
                                }}
                              </span>
                            </VTooltip>

                            <span
                              class="internal-chat-document-meta text-caption text-disabled"
                            >
                              {{
                                resolveInternalDocumentMeta(
                                  message.content.document
                                )
                              }}
                            </span>
                          </div>
                          <a
                            class="internal-chat-document-download"
                            :href="message.content.document.url"
                            :download="
                              resolveInternalDocumentDownloadName(
                                message.content.document
                              )
                            "
                            target="_blank"
                            rel="noopener"
                          >
                            <VIcon size="20">tabler-download</VIcon>
                          </a>
                        </div>

                        <p
                          v-if="message.content?.message"
                          class="internal-chat-media-caption"
                        >
                          {{ message.content.message }}
                        </p>
                      </div>

                      <button
                        v-if="hasValidLocation(message)"
                        type="button"
                        class="internal-chat-location-bubble"
                        :class="{
                          'internal-chat-location-bubble--right':
                            isOwnMessage(message),
                          'internal-chat-location-bubble--left':
                            !isOwnMessage(message),
                          'is-deleted': isDeletedMessage(message),
                        }"
                        @click="openMessageLocation(message)"
                      >
                        <div class="internal-chat-location-map-preview">
                          <div
                            v-if="
                              !webGLSupported || mapErrors[message.message_id]
                            "
                            class="internal-chat-location-map-fallback"
                          >
                            <VIcon size="32" color="primary">
                              tabler-map-pin
                            </VIcon>
                            <span class="text-caption mt-2">
                              {{ t('location_map_unavailable') }}
                            </span>
                          </div>
                          <MglMap
                            v-else
                            :key="`internal-map-${message.message_id}`"
                            :map-style="mapStyle"
                            :center="
                              resolveLocationCoordinates(
                                message.content.location
                              )
                            "
                            :zoom="15"
                            :interactive="false"
                            :attribution-control="false"
                            :navigation-control="false"
                            class="internal-chat-location-map-preview-map"
                            :style="{ width: '100%', height: '112px' }"
                          >
                            <MglMarker
                              :coordinates="
                                resolveLocationCoordinates(
                                  message.content.location
                                )
                              "
                              color="#ef4444"
                            />
                          </MglMap>
                        </div>
                        <div class="internal-chat-location-info">
                          <div
                            v-if="message.content.location?.name"
                            class="internal-chat-location-title"
                          >
                            {{ message.content.location.name }}
                          </div>
                          <div
                            v-if="message.content.location?.address"
                            class="internal-chat-location-address text-caption"
                          >
                            {{ message.content.location.address }}
                          </div>
                        </div>
                      </button>

                      <div
                        v-if="resolveMessageContacts(message).length > 0"
                        class="internal-chat-contact-bubble"
                        :class="{
                          'internal-chat-contact-bubble--right':
                            isOwnMessage(message),
                          'internal-chat-contact-bubble--left':
                            !isOwnMessage(message),
                          'is-deleted': isDeletedMessage(message),
                        }"
                      >
                        <GroupContactMessageCard
                          :title="resolveMessageContactCardTitle(message)"
                          :subtitle="resolveMessageContactCardSubtitle(message)"
                          :align="isOwnMessage(message) ? 'right' : 'left'"
                          :is-group="resolveMessageContacts(message).length > 1"
                          :photo="
                            resolveMessageContacts(message).length === 1
                              ? resolveMessageContacts(message)[0]?.photo
                              : null
                          "
                          :show-meta="false"
                          @toggle="openMessageContacts(message)"
                          @view-all="openMessageContacts(message)"
                        />

                        <p
                          v-if="message.content?.message"
                          class="internal-chat-media-caption"
                        >
                          {{ message.content.message }}
                        </p>
                      </div>

                      <div
                        v-if="resolveMessageLocalState(message)"
                        class="internal-chat-upload-state"
                        :class="{
                          'internal-chat-upload-state--error':
                            hasMessageUploadError(message),
                        }"
                      >
                        <VProgressLinear
                          v-if="!hasMessageUploadError(message)"
                          :model-value="resolveMessageUploadProgress(message)"
                          height="3"
                          color="primary"
                          rounded
                        />
                        <span v-else>
                          {{ t('internal_chat_send_message_error') }}
                        </span>
                        <VBtn
                          v-if="hasMessageUploadError(message)"
                          size="x-small"
                          variant="text"
                          color="error"
                          class="ms-1"
                          @click="retryLocalMessage(message)"
                        >
                          {{ t('internal_chat_retry_send') }}
                        </VBtn>
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

                      <div class="internal-chat-message-footer">
                        <div class="internal-chat-message-meta-content">
                          <span
                            v-if="isDeletedMessage(message)"
                            class="internal-chat-message-status-badge"
                          >
                            {{ t('internal_chat_deleted_badge') }}
                          </span>
                          <span
                            v-else-if="hasMessageHistory(message)"
                            class="internal-chat-message-status-badge"
                          >
                            {{ t('internal_chat_edited') }}
                          </span>
                          <div class="internal-chat-message-meta-row">
                            <span class="internal-chat-message-time">
                              {{ formatMessageDate(message.date) }}
                            </span>
                          </div>
                        </div>
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
              </template>

              <template v-else-if="displayItem.kind === 'media-group'">
                <div
                  class="internal-chat-message-row"
                  :data-message-group-ids="
                    displayItem.messages
                      .map((message) => message.message_id)
                      .join(' ')
                  "
                  :class="{
                    'internal-chat-message-row--mine': displayItem.isMine,
                    'internal-chat-message-row--target':
                      isMediaGroupHighlighted(displayItem),
                  }"
                >
                  <button
                    type="button"
                    class="internal-chat-message-avatar-button"
                    :disabled="!displayItem.firstMessage.user?.id"
                    :aria-label="t('internal_chat_user_information')"
                    @click.stop="
                      openMessageUserInfoDrawer(displayItem.firstMessage)
                    "
                  >
                    <VAvatar
                      size="32"
                      class="internal-chat-message-avatar"
                      :class="{
                        'internal-chat-message-avatar--mine':
                          displayItem.isMine,
                      }"
                    >
                      <VImg
                        :src="
                          resolveMessageAvatarSource(displayItem.firstMessage)
                        "
                        :alt="
                          displayItem.firstMessage.user?.name ||
                          t('internal_chat_system_user')
                        "
                        cover
                      />
                    </VAvatar>
                  </button>

                  <div
                    class="internal-chat-message-shell"
                    :class="{
                      'internal-chat-message-shell--mine': displayItem.isMine,
                    }"
                  >
                    <div
                      class="internal-chat-message-bubble internal-chat-message-bubble--media-group"
                      :class="{
                        'internal-chat-message-bubble--mine':
                          displayItem.isMine,
                      }"
                    >
                      <div class="internal-chat-message-header">
                        <span class="text-caption text-medium-emphasis">
                          {{
                            displayItem.firstMessage.user?.name ||
                            t('internal_chat_system_user')
                          }}
                        </span>
                      </div>

                      <div
                        class="internal-chat-media-group-grid"
                        :class="getMediaGroupGridClass(displayItem)"
                      >
                        <button
                          v-for="(
                            mediaMessage, mediaIndex
                          ) in getMediaGroupPreviewItems(displayItem)"
                          :key="mediaMessage.message_id"
                          type="button"
                          :id="`internal-msg-${mediaMessage.message_id}`"
                          :data-message-id="mediaMessage.message_id"
                          class="internal-chat-media-group-tile"
                          :aria-label="
                            displayItem.mediaKind === 'video'
                              ? t('internal_chat_videos')
                              : t('internal_chat_image_alt')
                          "
                          @click="openMediaGroupViewer(displayItem, mediaIndex)"
                        >
                          <img
                            v-if="
                              resolveMessageMediaKind(mediaMessage) === 'image'
                            "
                            :src="mediaMessage.content?.image?.url"
                            class="internal-chat-media-group-thumb"
                            :alt="t('internal_chat_image_alt')"
                          />
                          <video
                            v-else
                            :src="mediaMessage.content?.video?.url"
                            class="internal-chat-media-group-thumb"
                            preload="metadata"
                            muted
                            playsinline
                          >
                            <track kind="captions" />
                          </video>

                          <span
                            v-if="
                              resolveMessageMediaKind(mediaMessage) === 'video'
                            "
                            class="internal-chat-video-overlay"
                          >
                            <VIcon size="24">tabler-player-play</VIcon>
                          </span>

                          <span
                            v-if="
                              mediaIndex === 3 &&
                              getMediaGroupRemainingCount(displayItem) > 0
                            "
                            class="internal-chat-media-group-more"
                          >
                            +{{ getMediaGroupRemainingCount(displayItem) }}
                          </span>
                        </button>
                      </div>

                      <div class="internal-chat-message-footer">
                        <div class="internal-chat-message-meta-content">
                          <div class="internal-chat-message-meta-row">
                            <span class="internal-chat-message-time">
                              {{
                                formatMessageDate(displayItem.lastMessage.date)
                              }}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </template>
          </PerfectScrollbar>

          <Transition name="fade">
            <VBtn
              v-if="showScrollToBottom"
              class="internal-chat-scroll-to-bottom"
              icon
              size="small"
              variant="flat"
              color="white"
              elevation="2"
              :aria-label="t('internal_chat_scroll_to_bottom')"
              @click="scrollMessagesToBottom(true)"
            >
              <VIcon size="18" color="primary">tabler-arrow-down</VIcon>
              <VTooltip activator="parent" location="top">
                {{ t('internal_chat_scroll_to_bottom') }}
              </VTooltip>
            </VBtn>
          </Transition>

          <Teleport to="body">
            <Transition name="fade">
              <div
                v-if="shouldShowFixedMessageDate"
                class="internal-chat-fixed-date-indicator"
                :style="{
                  top: `${fixedMessageDateIndicatorTop + 8}px`,
                  left: `${fixedMessageDateIndicatorLeft}px`,
                  width: `${fixedMessageDateIndicatorWidth}px`,
                }"
              >
                <div class="internal-chat-fixed-date-indicator-badge">
                  {{ fixedMessageDateLabel }}
                </div>
              </div>
            </Transition>
          </Teleport>
        </div>

        <VDivider />

        <div class="internal-chat-composer px-4 py-3">
          <div v-if="replyMessage" class="internal-chat-reply-preview">
            <div
              v-if="resolveReplyPreviewImageSrc(activeReplyPreviewContent)"
              class="internal-chat-reply-preview-media"
            >
              <img
                :src="
                  resolveReplyPreviewImageSrc(activeReplyPreviewContent) || ''
                "
                :alt="t('photo_label')"
              />
            </div>
            <div
              v-else-if="isReplyPreviewDocument(activeReplyPreviewContent)"
              class="internal-chat-reply-preview-icon"
            >
              <VIcon
                :icon="
                  resolveReplyPreviewDocumentIcon(activeReplyPreviewContent)
                "
                size="26"
                color="primary"
              />
            </div>
            <div
              v-else-if="isReplyPreviewVideo(activeReplyPreviewContent)"
              class="internal-chat-reply-preview-icon"
            >
              <VIcon size="26" color="primary">tabler-player-play</VIcon>
            </div>
            <div
              v-else-if="isReplyPreviewAudio(activeReplyPreviewContent)"
              class="internal-chat-reply-preview-icon"
            >
              <VIcon size="26" color="primary">tabler-microphone</VIcon>
            </div>
            <div
              v-else-if="isReplyPreviewLocation(activeReplyPreviewContent)"
              class="internal-chat-reply-preview-icon"
            >
              <VIcon size="26" color="primary">tabler-map-pin</VIcon>
            </div>
            <div
              v-else-if="isReplyPreviewContact(activeReplyPreviewContent)"
              class="internal-chat-reply-preview-icon"
            >
              <VAvatar
                v-if="
                  resolveReplyPreviewContactPhoto(activeReplyPreviewContent)
                "
                size="26"
              >
                <VImg
                  :src="
                    resolveReplyPreviewContactPhoto(
                      activeReplyPreviewContent
                    ) || ''
                  "
                  :alt="resolveReplyPreviewText(activeReplyPreviewContent)"
                />
              </VAvatar>
              <VIcon
                v-else
                size="26"
                color="primary"
                :icon="
                  isReplyPreviewContactGroup(activeReplyPreviewContent)
                    ? 'tabler-users'
                    : 'tabler-user'
                "
              />
            </div>

            <div class="internal-chat-reply-preview-content">
              <div class="internal-chat-reply-preview-name">
                {{ resolveReplyPreviewName(replyMessage) }}
              </div>
              <div class="internal-chat-reply-preview-text">
                {{ resolveReplyPreviewText(activeReplyPreviewContent) }}
              </div>
              <div
                v-if="resolveReplyPreviewMeta(activeReplyPreviewContent)"
                class="internal-chat-reply-preview-meta"
              >
                {{ resolveReplyPreviewMeta(activeReplyPreviewContent) }}
              </div>
            </div>

            <VBtn
              class="internal-chat-reply-preview-close"
              icon
              size="22"
              density="comfortable"
              variant="text"
              :aria-label="t('close')"
              @click="replyMessage = null"
            >
              <VIcon size="18">tabler-x</VIcon>
            </VBtn>
          </div>

          <ChatLinkPreview
            v-if="linkPreview || isLoadingLinkPreview"
            :preview="linkPreview"
            :loading="isLoadingLinkPreview"
            class="internal-chat-composer-link-preview"
            @close="linkPreview = null"
          />

          <Transition name="fade">
            <VCard
              v-if="selectedImages.length > 0"
              class="internal-chat-attachment-card mb-3"
            >
              <VCardTitle class="internal-chat-attachment-title">
                <span
                  >{{ t('images_selected') }} ({{
                    selectedImages.length
                  }}/10)</span
                >
                <IconBtn size="small" @click="clearSelectedImages">
                  <VIcon size="18">tabler-x</VIcon>
                </IconBtn>
              </VCardTitle>
              <VCardText>
                <div class="internal-chat-attachment-grid">
                  <div
                    v-for="(photo, index) in selectedImages"
                    :key="`${photo.file.name}-${index}`"
                    class="internal-chat-photo-preview"
                  >
                    <VImg
                      :src="photo.preview"
                      cover
                      class="internal-chat-photo-preview-image"
                    />
                    <VBtn
                      icon
                      size="20"
                      variant="flat"
                      color="error"
                      class="internal-chat-preview-remove"
                      @click.stop="removeImage(index)"
                    >
                      <VIcon size="14">tabler-x</VIcon>
                    </VBtn>
                  </div>
                </div>
              </VCardText>
            </VCard>
          </Transition>

          <Transition name="fade">
            <VCard
              v-if="selectedVideos.length > 0"
              class="internal-chat-attachment-card mb-3"
            >
              <VCardTitle class="internal-chat-attachment-title">
                <span
                  >{{ t('videos_selected') }} ({{
                    selectedVideos.length
                  }}/10)</span
                >
                <IconBtn size="small" @click="clearSelectedVideos">
                  <VIcon size="18">tabler-x</VIcon>
                </IconBtn>
              </VCardTitle>
              <VCardText>
                <div
                  class="internal-chat-attachment-grid internal-chat-attachment-grid--wide"
                >
                  <div
                    v-for="(video, index) in selectedVideos"
                    :key="`${video.name}-${index}`"
                    class="internal-chat-file-preview"
                  >
                    <div class="internal-chat-file-preview-media">
                      <video
                        :src="video.preview"
                        muted
                        playsinline
                        preload="metadata"
                      />
                      <VIcon size="24">tabler-player-play</VIcon>
                    </div>
                    <div class="internal-chat-file-preview-meta">
                      <span>{{ truncateFileName(video.name) }}</span>
                      <small>
                        {{ formatFileSize(video.size) }}
                        <template v-if="video.duration">
                          • {{ formatAttachmentDuration(video.duration) }}
                        </template>
                      </small>
                    </div>
                    <VBtn
                      icon
                      size="20"
                      variant="flat"
                      color="error"
                      class="internal-chat-preview-remove"
                      @click.stop="removeVideo(index)"
                    >
                      <VIcon size="14">tabler-x</VIcon>
                    </VBtn>
                  </div>
                </div>
              </VCardText>
            </VCard>
          </Transition>

          <Transition name="fade">
            <VCard
              v-if="selectedDocuments.length > 0"
              class="internal-chat-attachment-card mb-3"
            >
              <VCardTitle class="internal-chat-attachment-title">
                <span
                  >{{ t('documents_selected') }} ({{
                    selectedDocuments.length
                  }}/10)</span
                >
                <IconBtn size="small" @click="clearSelectedDocuments">
                  <VIcon size="18">tabler-x</VIcon>
                </IconBtn>
              </VCardTitle>
              <VCardText>
                <div
                  class="internal-chat-attachment-grid internal-chat-attachment-grid--wide"
                >
                  <div
                    v-for="(doc, index) in selectedDocuments"
                    :key="`${doc.name}-${index}`"
                    class="internal-chat-file-preview"
                  >
                    <div class="internal-chat-file-preview-icon">
                      <VIcon size="30">tabler-file-description</VIcon>
                    </div>
                    <div class="internal-chat-file-preview-meta">
                      <span>{{ truncateFileName(doc.name) }}</span>
                      <small
                        >{{ doc.extension.toUpperCase() }} •
                        {{ formatFileSize(doc.size) }}</small
                      >
                    </div>
                    <VBtn
                      icon
                      size="20"
                      variant="flat"
                      color="error"
                      class="internal-chat-preview-remove"
                      @click.stop="removeDocument(index)"
                    >
                      <VIcon size="14">tabler-x</VIcon>
                    </VBtn>
                  </div>
                </div>
              </VCardText>
            </VCard>
          </Transition>

          <Transition name="fade">
            <VCard
              v-if="selectedAudios.length > 0"
              class="internal-chat-attachment-card mb-3"
            >
              <VCardTitle class="internal-chat-attachment-title">
                <span
                  >{{ t('audios_selected') }} ({{
                    selectedAudios.length
                  }}/10)</span
                >
                <IconBtn size="small" @click="clearSelectedAudios">
                  <VIcon size="18">tabler-x</VIcon>
                </IconBtn>
              </VCardTitle>
              <VCardText>
                <div
                  class="internal-chat-attachment-grid internal-chat-attachment-grid--wide"
                >
                  <div
                    v-for="(audio, index) in selectedAudios"
                    :key="`${audio.name}-${index}`"
                    class="internal-chat-file-preview"
                  >
                    <div class="internal-chat-file-preview-icon">
                      <VIcon size="30">tabler-headphones</VIcon>
                    </div>
                    <div class="internal-chat-file-preview-meta">
                      <span>{{ truncateFileName(audio.name) }}</span>
                      <small>
                        {{ formatFileSize(audio.size) }}
                        <template v-if="audio.duration">
                          • {{ formatAttachmentDuration(audio.duration) }}
                        </template>
                      </small>
                    </div>
                    <VBtn
                      icon
                      size="20"
                      variant="flat"
                      color="error"
                      class="internal-chat-preview-remove"
                      @click.stop="removeAudio(index)"
                    >
                      <VIcon size="14">tabler-x</VIcon>
                    </VBtn>
                  </div>
                </div>
              </VCardText>
            </VCard>
          </Transition>

          <Transition name="fade">
            <VCard
              v-if="selectedContacts.length > 0"
              class="internal-chat-attachment-card mb-3"
            >
              <VCardTitle class="internal-chat-attachment-title">
                <span
                  >{{ t('contacts_selected') }} ({{
                    selectedContacts.length
                  }}/10)</span
                >
                <IconBtn size="small" @click="clearSelectedContacts">
                  <VIcon size="18">tabler-x</VIcon>
                </IconBtn>
              </VCardTitle>
              <VCardText>
                <div class="internal-chat-attachment-grid">
                  <div
                    v-for="(contact, index) in selectedContacts"
                    :key="`${contact.contact_id}-${index}`"
                    class="internal-chat-contact-preview"
                  >
                    <VAvatar
                      size="44"
                      :variant="contact.photo ? undefined : 'tonal'"
                    >
                      <VImg v-if="contact.photo" :src="contact.photo" />
                      <VIcon v-else size="24">tabler-user</VIcon>
                    </VAvatar>
                    <div class="internal-chat-file-preview-meta">
                      <span
                        >{{ contact.name }} {{ contact.last_name || '' }}</span
                      >
                      <small>{{
                        contact.phone_partial || contact.email_partial || ''
                      }}</small>
                    </div>
                    <VBtn
                      icon
                      size="20"
                      variant="flat"
                      color="error"
                      class="internal-chat-preview-remove"
                      @click.stop="removeContact(index)"
                    >
                      <VIcon size="14">tabler-x</VIcon>
                    </VBtn>
                  </div>
                </div>
              </VCardText>
            </VCard>
          </Transition>

          <Transition name="fade">
            <VCard
              v-if="selectedLocation"
              class="internal-chat-attachment-card internal-chat-location-preview mb-3"
            >
              <VCardText class="d-flex align-center gap-3">
                <VAvatar size="44" variant="tonal" color="primary">
                  <VIcon size="24">tabler-map-pin</VIcon>
                </VAvatar>
                <div class="min-w-0 flex-grow-1">
                  <div class="text-body-2 font-weight-medium text-truncate">
                    {{ selectedLocation.name || t('internal_chat_location') }}
                  </div>
                  <div class="text-caption text-medium-emphasis text-truncate">
                    {{
                      selectedLocation.address ||
                      `${selectedLocation.latitude}, ${selectedLocation.longitude}`
                    }}
                  </div>
                </div>
                <IconBtn size="small" @click="selectedLocation = null">
                  <VIcon size="18">tabler-x</VIcon>
                </IconBtn>
              </VCardText>
            </VCard>
          </Transition>

          <div
            v-if="isRecordingAudio"
            class="internal-chat-recording-bar d-flex align-center gap-3 px-4"
          >
            <IconBtn
              class="internal-chat-recording-action"
              :aria-label="t('internal_chat_cancel_recording')"
              @click="cancelAudioRecording"
            >
              <VIcon size="20">tabler-trash</VIcon>
              <VTooltip activator="parent" location="top">
                {{ t('internal_chat_cancel_recording') }}
              </VTooltip>
            </IconBtn>

            <span
              class="internal-chat-recording-dot"
              :class="{ 'is-paused': isRecordingPaused }"
            ></span>
            <span class="internal-chat-recording-clock">
              {{ formattedRecordingDuration }}
            </span>

            <div class="internal-chat-recording-wave flex-grow-1">
              <canvas
                ref="audioCanvasRef"
                class="internal-chat-recording-wave-canvas"
                height="32"
              ></canvas>
            </div>

            <IconBtn
              class="internal-chat-recording-action flex-shrink-0"
              :aria-label="
                isRecordingPaused
                  ? t('internal_chat_resume_recording')
                  : t('internal_chat_pause_recording')
              "
              @click="togglePauseAudioRecording"
            >
              <VIcon size="20">
                {{
                  isRecordingPaused
                    ? 'tabler-player-play'
                    : 'tabler-player-pause'
                }}
              </VIcon>
              <VTooltip activator="parent" location="top">
                {{
                  isRecordingPaused
                    ? t('internal_chat_resume_recording')
                    : t('internal_chat_pause_recording')
                }}
              </VTooltip>
            </IconBtn>

            <VBtn
              class="internal-chat-send-btn"
              color="success"
              variant="flat"
              icon
              rounded="pill"
              :aria-label="t('internal_chat_send_audio')"
              :loading="recordingSending"
              @click="finalizeAudioRecording"
            >
              <VIcon size="20">tabler-send</VIcon>
              <VTooltip activator="parent" location="top">
                {{ t('internal_chat_send_audio') }}
              </VTooltip>
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
            @paste="handlePaste"
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
                  <VListItem @click="isContactPickerOpen = true">
                    <template #prepend>
                      <VIcon size="20">tabler-user</VIcon>
                    </template>
                    <VListItemTitle>
                      {{ t('internal_chat_contact') }}
                    </VListItemTitle>
                  </VListItem>
                  <VListItem @click="isLocationPickerOpen = true">
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
                  :disabled="recordingStarting || recordingSending"
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
      v-model="isSearchDrawerOpen"
      location="end"
      temporary
      width="390"
      class="internal-chat-search-drawer"
    >
      <InternalChatSearchSidebarContent
        v-if="activeConversation"
        :conversation-id="activeConversation.conversation_id"
        :conversation-name="resolveConversationTitle(activeConversation)"
        @close="closeSearchDrawer"
        @select-message="handleSearchMessageSelect"
      />
    </VNavigationDrawer>

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
      <div v-if="selectedUserInfo" class="internal-chat-user-info">
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
              :src="resolveAvatarSource(selectedUserInfo.photo)"
              :alt="resolveUserInfoName(selectedUserInfo)"
              cover
            />
          </VAvatar>

          <div class="internal-chat-user-title">
            {{ resolveUserInfoName(selectedUserInfo) }}
          </div>

          <VBtn
            v-if="canStartConversationFromSelectedUserInfo"
            size="small"
            variant="tonal"
            color="primary"
            class="mt-3"
            @click="openConversationFromSelectedUserInfo"
          >
            <VIcon start size="18">tabler-message-circle</VIcon>
            {{ t('internal_chat_talk') }}
          </VBtn>
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
                {{ resolveUserInfoName(selectedUserInfo) }}
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
                {{ resolveInfoValue(selectedUserInfo.email) }}
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
                {{ resolveInfoValue(selectedUserInfo.sector) }}
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
                {{ resolveInfoValue(selectedUserInfo.position) }}
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

    <VDialog
      v-model="isEditMessageDialogOpen"
      max-width="600"
      :persistent="editingMessage"
    >
      <VCard>
        <VCardTitle class="d-flex align-center justify-space-between pa-4">
          <span>{{ t('internal_chat_edit_message_title') }}</span>
          <IconBtn :disabled="editingMessage" @click="closeEditMessageDialog">
            <VIcon size="20">tabler-x</VIcon>
          </IconBtn>
        </VCardTitle>

        <VDivider />

        <VCardText class="pa-4">
          <VTextarea
            v-model="editMessageText"
            :label="t('internal_chat_message_label')"
            rows="4"
            auto-grow
            variant="outlined"
            counter
            :disabled="editingMessage"
            @keydown.enter.ctrl="confirmEditMessage"
            @keydown.enter.meta="confirmEditMessage"
          />
        </VCardText>

        <VCardActions class="pa-4 pt-0">
          <VSpacer />
          <VBtn
            variant="tonal"
            color="secondary"
            :disabled="editingMessage"
            @click="closeEditMessageDialog"
          >
            {{ t('internal_chat_cancel') }}
          </VBtn>
          <VBtn
            color="primary"
            variant="flat"
            :loading="editingMessage"
            :disabled="!canSubmitEditMessage"
            @click="confirmEditMessage"
          >
            {{ t('internal_chat_save') }}
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>

    <VDialog
      v-model="isDeleteMessageDialogOpen"
      max-width="430"
      :persistent="deletingMessage"
    >
      <VCard>
        <VCardTitle class="d-flex align-center justify-space-between pa-4">
          <span>{{ t('internal_chat_delete_message_title') }}</span>
          <IconBtn
            :disabled="deletingMessage"
            @click="closeDeleteMessageDialog"
          >
            <VIcon size="20">tabler-x</VIcon>
          </IconBtn>
        </VCardTitle>

        <VDivider />

        <VCardText class="pa-4 text-body-2 text-medium-emphasis">
          {{ t('internal_chat_delete_message_confirmation') }}
        </VCardText>

        <VCardActions class="pa-4 pt-0">
          <VSpacer />
          <VBtn
            variant="tonal"
            color="secondary"
            :disabled="deletingMessage"
            @click="closeDeleteMessageDialog"
          >
            {{ t('internal_chat_cancel') }}
          </VBtn>
          <VBtn
            color="error"
            variant="flat"
            :loading="deletingMessage"
            @click="confirmDeleteMessage"
          >
            {{ t('internal_chat_delete_action') }}
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>

    <VDialog
      v-model="isMessageHistoryDialogOpen"
      max-width="600"
      :scrollable="false"
    >
      <VCard v-if="messageHistoryTarget">
        <VCardTitle class="d-flex align-center justify-space-between pa-4">
          <span>{{ t('internal_chat_message_history_title') }}</span>
          <IconBtn @click="closeMessageHistoryDialog">
            <VIcon size="20">tabler-x</VIcon>
          </IconBtn>
        </VCardTitle>

        <VDivider />

        <VCardText class="pa-4">
          <div v-if="loadingMessageHistory" class="d-flex justify-center py-6">
            <VProgressCircular indeterminate color="primary" />
          </div>

          <div
            v-else-if="messageHistoryItems.length > 0"
            class="internal-chat-history-list"
          >
            <div
              v-for="(item, index) in messageHistoryItems"
              :key="`${messageHistoryTarget.message_id}-history-${index}`"
              class="internal-chat-history-item"
              :class="{
                'internal-chat-history-item--current': item.isCurrent,
                'internal-chat-history-item--deleted': item.isDeletedSnapshot,
              }"
            >
              <div class="internal-chat-history-header">
                <span class="internal-chat-history-label">
                  {{ item.label }}
                </span>
                <span class="internal-chat-history-date">
                  {{ formatMessageDate(item.date) }}
                </span>
              </div>
              <div class="internal-chat-history-text">
                {{ item.text }}
              </div>
            </div>
          </div>

          <div v-else class="text-body-2 text-medium-emphasis">
            {{ t('internal_chat_no_message_history') }}
          </div>
        </VCardText>

        <VCardActions class="pa-4 pt-0">
          <VSpacer />
          <VBtn
            variant="tonal"
            color="secondary"
            @click="closeMessageHistoryDialog"
          >
            {{ t('close') }}
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

    <VDialog v-model="locationModalOpen" max-width="800" :scrollable="false">
      <VCard v-if="locationData">
        <VCardTitle class="d-flex align-center justify-space-between">
          <div>
            <div class="text-h6">
              {{ locationData.name || t('location_label') }}
            </div>
            <div
              v-if="locationData.address"
              class="text-caption text-disabled mt-1"
            >
              {{ locationData.address }}
            </div>
          </div>
          <VBtn
            icon
            variant="text"
            size="small"
            @click="locationModalOpen = false"
          >
            <VIcon>tabler-x</VIcon>
          </VBtn>
        </VCardTitle>
        <VCardText class="pa-0">
          <div
            v-if="locationModalOpen && locationData"
            class="internal-chat-location-map-wrapper"
          >
            <div
              v-if="!webGLSupported"
              class="internal-chat-location-map-fallback-modal"
            >
              <VIcon size="48" color="primary">tabler-map-pin</VIcon>
              <span class="text-body-1 mt-4">
                {{ t('location_map_unavailable') }}
              </span>
            </div>
            <MglMap
              v-else
              ref="locationMapRef"
              :map-style="mapStyle"
              :center="mapCenter"
              :zoom="mapZoom"
              width="100%"
              height="500px"
              @map:load="onInternalLocationMapLoad"
            >
              <MglMarker :coordinates="markerPosition" color="#ef4444">
                <template v-if="locationData.name || locationData.address">
                  <div class="maplibregl-popup-content text-body-2 pa-2">
                    {{ locationData.name || locationData.address }}
                  </div>
                </template>
              </MglMarker>
            </MglMap>
          </div>
        </VCardText>
        <VCardActions>
          <VSpacer />
          <VBtn
            variant="text"
            :href="`https://www.google.com/maps?q=${locationData.latitude},${locationData.longitude}`"
            target="_blank"
            rel="noopener"
          >
            <VIcon start>tabler-external-link</VIcon>
            {{ t('open_in_google_maps') }}
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>

    <VDialog v-model="contactViewerOpen" max-width="420" :scrollable="false">
      <VCard>
        <VCardTitle class="d-flex align-center justify-space-between">
          <span>{{ t('contacts') }}</span>
          <VBtn
            icon
            variant="text"
            size="small"
            @click="contactViewerOpen = false"
          >
            <VIcon>tabler-x</VIcon>
          </VBtn>
        </VCardTitle>
        <VDivider />
        <VCardText>
          <div class="internal-chat-contact-viewer-list">
            <div
              v-for="(contact, index) in contactViewerContacts"
              :key="resolveContactViewerKey(contact, index)"
              class="internal-chat-contact-viewer-row"
            >
              <VAvatar size="42" variant="tonal" color="primary">
                <VImg
                  v-if="contact.photo"
                  :src="contact.photo"
                  :alt="resolveContactFullName(contact)"
                />
                <VIcon v-else size="20">tabler-user</VIcon>
              </VAvatar>
              <div class="internal-chat-contact-viewer-info">
                <div class="internal-chat-contact-viewer-name">
                  {{ resolveContactFullName(contact) }}
                </div>
                <div
                  v-if="isContactPhoneLoading(contact)"
                  class="internal-chat-contact-viewer-meta internal-chat-contact-viewer-meta--loading"
                  aria-hidden="true"
                >
                  <span class="internal-chat-contact-viewer-meta-skeleton" />
                </div>
                <div
                  v-else-if="resolveContactViewerMeta(contact)"
                  class="internal-chat-contact-viewer-meta"
                >
                  {{ resolveContactViewerMeta(contact) }}
                </div>
              </div>
              <VTooltip v-if="canViewFullContactPhone(contact)" location="top">
                <template #activator="{ props: tooltipProps }">
                  <VBtn
                    v-bind="tooltipProps"
                    icon
                    variant="text"
                    size="small"
                    color="primary"
                    class="internal-chat-contact-viewer-eye"
                    :disabled="isContactPhoneLoading(contact)"
                    :loading="isContactPhoneLoading(contact)"
                    @click.stop="toggleContactPhoneVisibility(contact)"
                  >
                    <VIcon size="18">
                      {{
                        isContactPhoneVisible(contact)
                          ? 'tabler-eye-off'
                          : 'tabler-eye'
                      }}
                    </VIcon>
                  </VBtn>
                </template>
                <span>
                  {{
                    isContactPhoneVisible(contact)
                      ? t('internal_chat_hide_full_phone')
                      : t('internal_chat_view_full_phone')
                  }}
                </span>
              </VTooltip>
            </div>
          </div>
        </VCardText>
      </VCard>
    </VDialog>

    <ChatLocationPicker
      v-model="isLocationPickerOpen"
      @confirm="onLocationSelected"
    />

    <AppContactPicker
      v-model="isContactPickerOpen"
      source="internal-chat"
      :existing-contacts="selectedContacts"
      @select="onContactsSelected"
    />

    <ChatMediaViewer
      v-model="mediaViewerOpen"
      :items="mediaViewerItems"
      :initial-index="mediaViewerInitialIndex"
      @download="downloadMediaViewerItem"
    />
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

.internal-chat-message-scroll {
  flex: 1;
  min-height: 0;
  position: relative;
}

.internal-chat-message-list {
  height: 100%;
  scrollbar-color: rgba(var(--v-theme-on-surface), 0.28) transparent;
  scrollbar-width: thin;

  :deep(.ps__rail-y) {
    width: 10px;
    opacity: 1;
    background: transparent !important;
  }

  :deep(.ps__thumb-y) {
    right: 2px;
    width: 6px;
    border-radius: 999px;
    background: rgba(var(--v-theme-on-surface), 0.28) !important;
  }

  :deep(.ps__rail-y:hover .ps__thumb-y) {
    width: 7px;
    background: rgba(var(--v-theme-on-surface), 0.38) !important;
  }
}

.internal-chat-message-list::-webkit-scrollbar {
  width: 8px;
}

.internal-chat-message-list::-webkit-scrollbar-track {
  background: transparent;
}

.internal-chat-message-list::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.28);
}

.internal-chat-date-separator-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  inline-size: 100%;
  gap: 8px;
  margin-block: 16px;
}

.internal-chat-date-separator-line {
  flex: 0.25 1 0;
  block-size: 1px;
  background: rgba(var(--v-theme-on-surface), 0.12);
}

.internal-chat-date-separator {
  display: inline-block;
  min-inline-size: fit-content;
  border-radius: 7.5px;
  padding: 4px 12px;
  background: rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.65);
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
}

.internal-chat-fixed-date-indicator {
  position: fixed;
  z-index: 2400;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.internal-chat-fixed-date-indicator-badge {
  display: inline-block;
  min-inline-size: fit-content;
  border-radius: 7.5px;
  padding: 4px 12px;
  background: rgba(var(--v-theme-on-surface), 0.12);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  color: rgba(var(--v-theme-on-surface), 0.65);
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
}

.internal-chat-message-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  margin-bottom: 14px;
  padding-inline: 6px;
}

.internal-chat-message-row--mine {
  flex-direction: row-reverse;
  justify-content: flex-start;
}

.internal-chat-message-row--system {
  justify-content: center;
  margin-block: 10px 16px;
}

.internal-chat-system-message {
  max-inline-size: min(72%, 640px);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  border-radius: 8px;
  padding: 6px 12px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.76rem;
  font-weight: 500;
  line-height: 1.35;
  text-align: center;
  overflow-wrap: anywhere;
}

.internal-chat-message-row--target .internal-chat-message-bubble,
.internal-chat-message-row--target .internal-chat-system-message {
  animation: internal-chat-message-target 1.1s ease;
  background-color: rgba(var(--v-theme-primary), 0.12) !important;
}

.internal-chat-message-avatar-button {
  display: inline-flex;
  flex: 0 0 auto;
  margin-block-end: 2px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
}

.internal-chat-message-avatar-button:disabled {
  cursor: default;
}

.internal-chat-message-avatar-button:focus-visible {
  outline: 2px solid rgba(var(--v-theme-primary), 0.45);
  outline-offset: 2px;
}

.internal-chat-message-avatar {
  flex: 0 0 auto;
  margin-block-end: 2px;
  background: rgba(var(--v-theme-primary), 0.08);
  box-shadow: 0 1px 2px rgba(var(--v-theme-on-surface), 0.08);
}

.internal-chat-message-avatar-button .internal-chat-message-avatar {
  margin-block-end: 0;
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
  padding: 8px 42px 22px 10px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 1px 2px rgba(var(--v-theme-on-surface), 0.08);
}

.internal-chat-message-header {
  display: flex;
  align-items: center;
  min-height: 20px;
  margin-block-end: 4px;
  padding-inline-end: 22px;
}

.internal-chat-message-action-btn {
  position: absolute !important;
  z-index: 4;
  inset-block-start: 2px;
  inset-inline-end: 4px;
  min-width: 28px !important;
  width: 28px !important;
  height: 28px !important;
  opacity: 0;
  visibility: hidden;
  color: rgba(var(--v-theme-on-surface), 0.7) !important;
  transition:
    opacity 0.15s ease,
    visibility 0.15s ease,
    background-color 0.15s ease;
}

.internal-chat-message-bubble:hover .internal-chat-message-action-btn,
.internal-chat-message-action-btn[aria-expanded='true'] {
  opacity: 1;
  visibility: visible;
}

.internal-chat-message-bubble--mine .internal-chat-message-action-btn {
  color: rgba(17, 27, 33, 0.68) !important;
}

.internal-chat-message-footer {
  position: absolute;
  right: 0;
  bottom: 6px;
  left: 0;
  display: flex;
  align-items: flex-end;
  gap: 4px;
  justify-content: flex-end;
  padding-inline: 16px 12px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.75rem;
  font-weight: 400;
  letter-spacing: 0;
  pointer-events: none;
}

.internal-chat-message-meta-content {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.internal-chat-message-meta-row {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.internal-chat-message-time {
  line-height: 1;
  white-space: nowrap;
}

.internal-chat-message-status-badge {
  border-radius: 999px;
  padding: 1px 6px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: inherit;
  font-size: 0.66rem;
  font-weight: 600;
  line-height: 1.25;
}

.internal-chat-message-bubble--mine .internal-chat-message-footer {
  color: rgba(17, 27, 33, 0.6);
}

.internal-chat-message-bubble--mine {
  background: rgb(217, 253, 211);
  color: rgb(var(--v-theme-title));
}

.internal-chat-message-bubble--deleted {
  opacity: 0.74;
  padding-bottom: 34px;
  font-style: italic;
}

.internal-chat-history-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: min(420px, 64vh);
  overflow-y: auto;
  padding-right: 4px;
}

.internal-chat-history-item {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  padding: 12px;
  background: rgb(var(--v-theme-surface));
}

.internal-chat-history-item--current {
  border-color: rgba(var(--v-theme-primary), 0.35);
  background: rgba(var(--v-theme-primary), 0.06);
}

.internal-chat-history-item--deleted {
  border-color: rgba(var(--v-theme-error), 0.26);
  background: rgba(var(--v-theme-error), 0.05);
}

.internal-chat-history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.internal-chat-history-label {
  color: rgb(var(--v-theme-primary));
  font-size: 0.78rem;
  font-weight: 700;
}

.internal-chat-history-date {
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 0.75rem;
  white-space: nowrap;
}

.internal-chat-history-text {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.9rem;
  line-height: 1.45;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.internal-chat-message-bubble--with-reactions {
  margin-bottom: 10px;
}

.internal-chat-scroll-to-bottom {
  position: absolute;
  z-index: 12;
  right: 26px;
  bottom: 18px;
  min-width: 36px !important;
  width: 36px !important;
  height: 36px !important;
  border-radius: 50% !important;
  background: rgb(var(--v-theme-surface)) !important;
  box-shadow:
    0 8px 18px rgba(var(--v-theme-on-surface), 0.14),
    0 2px 6px rgba(var(--v-theme-on-surface), 0.1) !important;
}

.internal-chat-message-text {
  white-space: pre-wrap;
  word-break: break-word;
}

.internal-chat-message-text--deleted {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.78rem;
  line-height: 1.25;
}

.internal-chat-quoted {
  display: flex;
  align-items: center;
  gap: 10px;
  inline-size: 100%;
  border: 0;
  border-inline-start: 3px solid rgb(var(--v-theme-primary));
  border-radius: 8px;
  margin-block-end: 6px;
  padding: 8px 10px;
  background: rgba(var(--v-theme-primary), 0.08);
  color: inherit;
  text-align: start;
  cursor: default;
}

.internal-chat-quoted--clickable {
  cursor: pointer;
}

.internal-chat-quoted--clickable:hover {
  background: rgba(var(--v-theme-primary), 0.12);
}

.internal-chat-reply-preview {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  border-inline-start: 3px solid rgb(var(--v-theme-primary));
  border-radius: 10px;
  margin-block-end: 8px;
  padding: 10px 36px 10px 12px;
  background: rgb(var(--v-theme-surface));
}

.internal-chat-reply-preview-media,
.internal-chat-reply-preview-icon {
  inline-size: 40px;
  block-size: 40px;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 6px;
}

.internal-chat-reply-preview-media img {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  object-fit: cover;
}

.internal-chat-reply-preview-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--v-theme-primary), 0.12);
}

.internal-chat-reply-preview-content {
  min-inline-size: 0;
  flex: 1 1 auto;
}

.internal-chat-reply-preview-name {
  color: rgb(var(--v-theme-primary));
  font-size: 14px;
  font-weight: 600;
  line-height: 1.1;
  margin-block-end: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.internal-chat-reply-preview-text {
  overflow: hidden;
  color: rgb(var(--v-theme-on-surface));
  font-size: 13px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.internal-chat-reply-preview-meta {
  margin-block-start: 2px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 12px;
  line-height: 1.2;
}

.internal-chat-reply-preview-close {
  position: absolute;
  inset-block-start: 6px;
  inset-inline-end: 6px;
}

.internal-chat-quoted .internal-chat-reply-preview-media,
.internal-chat-quoted .internal-chat-reply-preview-icon {
  inline-size: 36px;
  block-size: 36px;
}

.internal-chat-quoted .internal-chat-reply-preview-name {
  font-size: 0.85rem;
}

.internal-chat-quoted .internal-chat-reply-preview-text {
  font-size: 0.9rem;
}

.internal-chat-media {
  width: 100%;
  border-radius: 8px;
  max-height: 360px;
  display: block;
  object-fit: cover;
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
  color: rgba(var(--v-theme-on-surface), 0.68) !important;
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
  overflow-x: auto;
  overflow-y: hidden;
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.internal-chat-recording-bar::-webkit-scrollbar {
  display: none;
}

.internal-chat-recording-action {
  flex-shrink: 0;
  color: rgba(var(--v-theme-on-surface), 0.7) !important;

  &:hover {
    background: rgba(var(--v-theme-on-surface), 0.08) !important;
    color: rgba(var(--v-theme-on-surface), 0.7) !important;
  }
}

.internal-chat-recording-dot {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgb(var(--v-theme-error));
  animation: internal-chat-recording-pulse 1.4s ease-in-out infinite;
}

.internal-chat-recording-dot.is-paused {
  background: rgba(var(--v-theme-on-surface), 0.4);
  animation: none;
}

.internal-chat-recording-clock {
  min-width: 52px;
  flex-shrink: 0;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.internal-chat-recording-wave {
  display: flex;
  min-width: 0;
  align-items: center;
}

.internal-chat-recording-wave-canvas {
  width: min(220px, 35vw);
  height: 28px;
  background: transparent;
}

@media (max-width: 600px) {
  .internal-chat-recording-bar {
    gap: 8px !important;
    padding-inline: 8px !important;
  }

  .internal-chat-recording-action {
    min-width: 36px !important;
    width: 36px !important;
    height: 36px !important;
  }

  .internal-chat-recording-clock {
    min-width: 42px;
    font-size: 0.875rem;
  }

  .internal-chat-recording-wave-canvas {
    width: min(80px, 20vw);
    height: 20px;
  }

  .internal-chat-recording-dot {
    width: 8px;
    height: 8px;
  }

  .internal-chat-recording-bar .internal-chat-send-btn {
    min-width: 36px !important;
    width: 36px !important;
    height: 36px !important;
  }
}

@keyframes internal-chat-recording-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }

  50% {
    opacity: 0.65;
    transform: scale(1.3);
  }
}

.internal-chat-link-preview {
  display: block;
  max-width: 320px;

  :deep(> .mx-5) {
    margin: 4px 0 8px !important;
  }

  :deep(.link-preview-card) {
    border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
    border-radius: 7px;
    padding: 10px;
    background: rgba(var(--v-theme-on-surface), 0.035);
    box-shadow: none;
  }

  :deep(.link-preview-close) {
    display: none;
  }
}

.internal-chat-media-frame {
  position: relative;
  display: block;
  overflow: hidden;
  inline-size: min(260px, 72vw);
  max-inline-size: 260px;
  border: 0;
  border-radius: 8px;
  padding: 0;
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: inherit;
  cursor: pointer;
  line-height: 0;
  text-align: start;
}

.internal-chat-video-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  background: rgba(0, 0, 0, 0.16);
  pointer-events: none;

  .v-icon {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.45);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  }
}

.internal-chat-message-bubble--media-group {
  width: auto;
  padding: 7px 7px 22px;
}

.internal-chat-media-group-grid {
  display: grid;
  gap: 2px;
  inline-size: min(180px, 72vw);
  aspect-ratio: 1 / 1;
  overflow: hidden;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.08);
}

.internal-chat-media-group-grid--1 {
  grid-template-columns: 1fr;
  grid-template-rows: 1fr;
}

.internal-chat-media-group-grid--2 {
  grid-template-columns: repeat(2, 1fr);
  grid-template-rows: 1fr;
}

.internal-chat-media-group-grid--3 {
  grid-template-columns: 1.3fr 1fr;
  grid-template-rows: repeat(2, 1fr);

  .internal-chat-media-group-tile:first-child {
    grid-row: span 2;
  }
}

.internal-chat-media-group-grid--4 {
  grid-template-columns: repeat(2, 1fr);
  grid-template-rows: repeat(2, 1fr);
}

.internal-chat-media-group-tile {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.internal-chat-media-group-thumb {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.internal-chat-media-group-more {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.48);
  color: white;
  font-size: 1.35rem;
  font-weight: 700;
}

.internal-chat-audio-bubble {
  max-inline-size: 360px;
  inline-size: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-block-start: 2px;
  position: relative;
}

.internal-chat-audio-bubble.is-deleted {
  pointer-events: none;
  opacity: 0.7;
}

.internal-chat-audio-player-container {
  inline-size: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 18px;
  padding: 10px 12px;
  background: rgba(var(--v-theme-on-surface), 0.045);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.54);
}

.internal-chat-audio-bubble--right .internal-chat-audio-player-container {
  border-color: rgba(17, 27, 33, 0.1);
  background: rgba(255, 255, 255, 0.42);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.38);
}

.internal-chat-audio-bubble--left .internal-chat-audio-player-container {
  background: rgba(var(--v-theme-primary), 0.055);
}

.internal-chat-audio-play-btn {
  flex-shrink: 0;
  min-width: 36px !important;
  width: 36px !important;
  height: 36px !important;
  border: 2px solid rgb(var(--v-theme-primary));
  border-radius: 50% !important;
  background: rgba(255, 255, 255, 0.95);
  color: rgb(var(--v-theme-primary));
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

  :deep(.v-icon) {
    color: rgb(var(--v-theme-primary));
  }
}

.internal-chat-audio-bubble--right .internal-chat-audio-play-btn {
  border-color: rgba(255, 255, 255, 0.8);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
}

.internal-chat-audio-speed-btn {
  min-width: 36px;
  height: 24px;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1.5px solid rgba(var(--v-theme-on-surface), 0.3);
  border-radius: 12px;
  padding: 0 6px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer;
  font-size: 0.7rem;
  font-weight: 600;
  user-select: none;
}

.internal-chat-audio-speed-btn:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
}

.internal-chat-audio-bubble--right .internal-chat-audio-speed-btn {
  border-color: rgba(17, 27, 33, 0.35);
  color: rgba(17, 27, 33, 0.7);
}

.internal-chat-audio-waveform-container {
  min-width: 100px;
  height: 36px;
  position: relative;
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  overflow: hidden;
  cursor: pointer;
}

.internal-chat-audio-waveform,
.internal-chat-audio-waveform-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 3px;
  height: 100%;
  padding: 6px 0;
}

.internal-chat-audio-waveform-bar,
.internal-chat-audio-waveform-bar-placeholder {
  flex: 1 1 0;
  min-width: 3px;
  max-width: 4px;
  border-radius: 2px;
}

.internal-chat-audio-waveform-bar {
  min-height: 4px;
  background: rgba(var(--v-theme-on-surface), 0.4);
  transition:
    background 0.2s ease,
    height 0.1s ease;
}

.internal-chat-audio-waveform-bar--active {
  background: rgb(var(--v-theme-primary));
}

.internal-chat-audio-waveform-bar-placeholder {
  height: 20%;
  background: rgba(var(--v-theme-on-surface), 0.2);
  animation: internal-chat-audio-pulse 1.5s ease-in-out infinite;
}

.internal-chat-audio-bubble--right .internal-chat-audio-waveform-bar {
  background: rgba(17, 27, 33, 0.45);
}

.internal-chat-audio-bubble--right .internal-chat-audio-waveform-bar--active {
  background: rgba(17, 27, 33, 0.9);
}

.internal-chat-audio-bubble--right
  .internal-chat-audio-waveform-bar-placeholder {
  background: rgba(17, 27, 33, 0.35);
}

.internal-chat-audio-progress-indicator {
  position: absolute;
  z-index: 1;
  top: 0;
  bottom: 0;
  width: 2px;
  border-radius: 1px;
  background: rgb(var(--v-theme-primary));
  transform: translateX(-50%);
}

.internal-chat-audio-bubble--right .internal-chat-audio-progress-indicator {
  background: rgba(17, 27, 33, 0.85);
}

.internal-chat-audio-meta {
  margin-block-start: -2px;
  padding-inline: 12px;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.75rem;
  line-height: 1;
}

@keyframes internal-chat-audio-pulse {
  0%,
  100% {
    opacity: 0.3;
  }

  50% {
    opacity: 0.6;
  }
}

.internal-chat-media-caption {
  margin: 8px 4px 0;
  font-size: 0.95rem;
  line-height: 1.25rem;
  white-space: pre-line;
}

.internal-chat-document-content {
  inline-size: min(320px, 72vw);
  max-inline-size: 100%;
  display: flex;
  flex-direction: column;
}

.internal-chat-document-bubble {
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: 10px;
  margin-bottom: 6px;
  padding: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.internal-chat-document-bubble--left {
  border-start-end-radius: 6px;
}

.internal-chat-document-bubble--right {
  border-start-start-radius: 6px;
}

.internal-chat-document-bubble.is-deleted {
  pointer-events: none;
  opacity: 0.7;
}

.internal-chat-document-icon {
  inline-size: 36px;
  block-size: 36px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(var(--v-theme-primary), 0.12);
}

.internal-chat-document-details {
  min-inline-size: 0;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 4px;
}

.internal-chat-document-name {
  overflow: hidden;
  color: rgb(var(--v-theme-primary));
  font-size: 0.875rem;
  font-weight: 600;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.internal-chat-document-meta {
  font-size: 0.75rem;
  white-space: nowrap;
}

.internal-chat-document-download {
  inline-size: 30px;
  block-size: 30px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
  transition: background-color 0.2s ease;
}

.internal-chat-document-download:hover {
  background: rgba(var(--v-theme-primary), 0.18);
}

.internal-chat-location-bubble {
  width: 200px;
  min-width: 175px;
  max-width: 100%;
  display: block;
  overflow: hidden;
  border: 0;
  border-radius: 8px;
  padding: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: start;
  transition: opacity 0.2s;
}

.internal-chat-location-bubble:hover {
  opacity: 0.9;
}

.internal-chat-location-bubble.is-deleted {
  opacity: 0.5;
  cursor: not-allowed;
}

.internal-chat-location-map-preview {
  width: 100%;
  height: 112px;
  position: relative;
  overflow: hidden;
  border-radius: 8px 8px 0 0;
}

.internal-chat-location-map-preview-map {
  width: 100% !important;
  height: 112px !important;
  pointer-events: none;
}

.internal-chat-location-map-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.05);
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.internal-chat-location-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
}

.internal-chat-location-title {
  font-weight: 500;
}

.internal-chat-location-address {
  color: rgba(var(--v-theme-on-surface), 0.68);
  word-break: break-word;
}

.internal-chat-contact-bubble {
  inline-size: min(260px, 72vw);
  display: flex;
  flex-direction: column;
}

.internal-chat-contact-bubble--right {
  align-items: flex-end;
  margin-left: auto;
}

.internal-chat-contact-bubble--left :deep(.group-contact-card),
.internal-chat-contact-bubble--right :deep(.group-contact-card) {
  width: 100%;
  max-width: 260px;
  margin: 0;
}

.internal-chat-contact-bubble :deep(.group-contact-card) {
  box-shadow: none;
}

.internal-chat-contact-bubble :deep(.group-contact-card__body) {
  min-height: 64px;
  gap: 12px;
  padding: 12px 14px;
}

.internal-chat-contact-bubble :deep(.group-contact-card__photo),
.internal-chat-contact-bubble :deep(.group-contact-card__icon) {
  inline-size: 38px !important;
  block-size: 38px !important;
}

.internal-chat-contact-bubble :deep(.group-contact-card__left) {
  padding-top: 0;
}

.internal-chat-contact-bubble :deep(.group-contact-card__title) {
  font-size: 0.9rem;
}

.internal-chat-contact-bubble :deep(.group-contact-card__subtitle) {
  font-size: 0.78rem;
}

.internal-chat-contact-viewer-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.internal-chat-contact-viewer-row {
  min-height: 58px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-radius: 8px;
  padding: 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.internal-chat-contact-viewer-info {
  min-width: 0;
  flex: 1 1 auto;
}

.internal-chat-contact-viewer-name {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.internal-chat-contact-viewer-meta {
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.8rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.internal-chat-contact-viewer-meta--loading {
  display: flex;
  align-items: center;
  min-block-size: 18px;
}

.internal-chat-contact-viewer-meta-skeleton {
  display: block;
  block-size: 11px;
  inline-size: 138px;
  border-radius: 999px;
  animation: internal-chat-contact-viewer-skeleton 1.2s ease-in-out infinite;
  background: linear-gradient(
    90deg,
    rgba(var(--v-theme-on-surface), 0.08) 25%,
    rgba(var(--v-theme-on-surface), 0.16) 37%,
    rgba(var(--v-theme-on-surface), 0.08) 63%
  );
  background-size: 400% 100%;
}

@keyframes internal-chat-contact-viewer-skeleton {
  0% {
    background-position: 100% 0;
  }

  100% {
    background-position: 0 0;
  }
}

.internal-chat-contact-viewer-eye {
  flex: 0 0 auto;
}

.internal-chat-location-map-wrapper {
  min-height: 500px;
}

.internal-chat-location-map-fallback-modal {
  min-height: 500px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.internal-chat-upload-state {
  margin-top: 8px;
}

.internal-chat-upload-state--error {
  color: rgb(var(--v-theme-error));
  font-size: 0.76rem;
}

.internal-chat-attachment-card {
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 8px !important;
  box-shadow: none !important;
}

.internal-chat-attachment-title {
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  font-size: 0.88rem;
  font-weight: 600;
}

.internal-chat-attachment-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  gap: 10px;
}

.internal-chat-attachment-grid--wide {
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
}

.internal-chat-photo-preview,
.internal-chat-file-preview,
.internal-chat-contact-preview {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.035);
}

.internal-chat-photo-preview {
  aspect-ratio: 1;
}

.internal-chat-photo-preview-image {
  width: 100%;
  height: 100%;
}

.internal-chat-file-preview,
.internal-chat-contact-preview {
  min-height: 74px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 32px 10px 10px;
}

.internal-chat-file-preview-media,
.internal-chat-file-preview-icon {
  width: 54px;
  height: 54px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
  flex: 0 0 auto;
}

.internal-chat-file-preview-media video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  grid-area: 1 / 1;
}

.internal-chat-file-preview-media .v-icon {
  grid-area: 1 / 1;
  color: white;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.4));
}

.internal-chat-file-preview-meta {
  min-width: 0;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
}

.internal-chat-file-preview-meta span {
  overflow: hidden;
  font-size: 0.86rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.internal-chat-file-preview-meta small {
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.internal-chat-preview-remove {
  position: absolute;
  z-index: 2;
  top: 6px;
  right: 6px;
}

.internal-chat-composer-link-preview {
  :deep(> .mx-5) {
    margin: 0 0 10px !important;
  }
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
  right: 12px;
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
  right: auto;
  left: 12px;
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

@keyframes internal-chat-message-target {
  0% {
    box-shadow: 0 0 0 0 rgba(var(--v-theme-primary), 0);
  }

  40% {
    box-shadow: 0 0 0 4px rgba(var(--v-theme-primary), 0.2);
  }

  100% {
    box-shadow: 0 0 0 0 rgba(var(--v-theme-primary), 0);
  }
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
