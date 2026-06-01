import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItem,
} from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { AppAvatar } from '../components/AppAvatar';
import { BottomSheetModal } from '../components/BottomSheetModal';
import {
  buildInternalOptimisticFileMessage,
  createInternalChatMessageHash,
  INTERNAL_MESSAGE_TYPE,
  useInternalChat,
} from '../context/InternalChatContext';
import {
  appendInternalChatFile,
  generateInternalChatLinkPreview,
  listInternalChatContacts,
  viewInternalChatContactPhone,
} from '../api/internalChatApi';
import { getPermissions } from '../storage/authStorage';
import {
  canManageInternalChatGroupMembers,
  canTransferInternalChatGroupLeader,
  canUpdateInternalChatGroup,
} from '../constants/chatAuthorization';
import type { InternalChatStackParamList } from '../navigation/types';
import type {
  InternalChatContact,
  InternalChatConversation,
  InternalChatMessage,
  InternalChatParticipant,
  InternalChatSearchMessageResult,
  InternalChatUploadFile,
} from '../types/internalChat';
import {
  INTERNAL_CHAT_ACTIVITY_STATE,
  INTERNAL_CHAT_CONVERSATION_TYPE,
  INTERNAL_CHAT_PARTICIPANT_ROLE,
} from '../types/internalChat';
import { colors } from '../theme/colors';
import { pt } from '../locales/pt';
import {
  dismissKeyboard,
  dismissKeyboardAnd,
  keyboardAvoidingBehavior,
} from '../utils/keyboard';
import { resolveImageUri } from '../utils/imageUri';
import {
  isInternalChatSystemMessage,
  resolveInternalChatMessageText,
  resolveInternalChatSenderName,
  resolveInternalChatTextTag,
} from '../utils/internalChatText';

type Navigation = NativeStackNavigationProp<InternalChatStackParamList>;
type ScreenRoute = RouteProp<InternalChatStackParamList, 'InternalChatRoom'>;
type PendingGroupAction =
  | { type: 'remove'; member: InternalChatParticipant }
  | { type: 'transfer'; member: InternalChatParticipant }
  | { type: 'leave' };
type InternalAttachmentActionKey =
  | 'document'
  | 'photo'
  | 'video'
  | 'audio'
  | 'contact'
  | 'location';

type InternalAttachmentAction = {
  key: InternalAttachmentActionKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onPress: () => void;
};

const MAX_DOCUMENT_SIZE_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_SIZE_BYTES = 16 * 1024 * 1024;
const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024;
const MAX_AUDIO_SIZE_BYTES = 16 * 1024 * 1024;
const VOICE_LOCK_SWIPE_THRESHOLD = 70;
const VOICE_RELEASE_LOCK_GRACE_MS = 220;
const VOICE_CANCEL_SWIPE_THRESHOLD = 90;
const RECORDING_WAVEFORM_MAX_BARS = 44;
const RECORDING_WAVEFORM_MIN_BARS = 26;
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const COMPOSER_EMOJIS = [
  '😀',
  '😃',
  '😄',
  '😁',
  '😊',
  '😉',
  '😍',
  '😘',
  '😂',
  '🤣',
  '😎',
  '🤔',
  '👍',
  '👏',
  '🙏',
  '💪',
  '🔥',
  '❤️',
  '✅',
  '🚀',
  '📌',
  '📎',
];
const URL_PATTERN = /(https?:\/\/[^\s]+)/i;

function formatMessageTime(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAudioTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function normalizeRecordingMetering(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0.2;
  }
  const clamped = Math.max(-60, Math.min(0, value));
  const normalized = (clamped + 60) / 60;
  return Math.max(0.15, normalized);
}

function formatDateSeparator(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  const now = new Date();
  if (parsed.toDateString() === now.toDateString()) return 'Hoje';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (parsed.toDateString() === yesterday.toDateString()) return 'Ontem';
  return parsed.toLocaleDateString('pt-BR');
}

function isSameDay(a: string, b: string): boolean {
  const dateA = new Date(a);
  const dateB = new Date(b);
  return dateA.toDateString() === dateB.toDateString();
}

function resolveConversationTitle(
  conversation: InternalChatConversation,
  currentUserId: string | null
): string {
  if (conversation.type === INTERNAL_CHAT_CONVERSATION_TYPE.group) {
    return conversation.name?.trim() || 'Grupo';
  }
  const otherParticipant =
    conversation.participants.find((item) => item.user_id !== currentUserId) ??
    conversation.participants[0];
  return otherParticipant?.name || conversation.name || 'Conversa';
}

function resolveConversationPhoto(
  conversation: InternalChatConversation,
  currentUserId: string | null
): string | null {
  if (conversation.photo) return conversation.photo;
  if (conversation.type === INTERNAL_CHAT_CONVERSATION_TYPE.group) return null;
  const otherParticipant =
    conversation.participants.find((item) => item.user_id !== currentUserId) ??
    conversation.participants[0];
  return otherParticipant?.photo ?? null;
}

function getMessageText(message: InternalChatMessage): string {
  return resolveInternalChatMessageText(message);
}

function getMediaUrl(message: InternalChatMessage): string | null {
  const content = message.content;
  return (
    content?.image?.url ??
    content?.video?.url ??
    content?.audio?.url ??
    content?.document?.url ??
    null
  );
}

function getFileNameFromUri(uri: string, fallback: string): string {
  const clean = uri.split('?')[0]?.split('#')[0] ?? uri;
  const name = clean.split('/').pop();
  return name?.trim() || fallback;
}

function getMimeTypeFromName(name: string, fallback: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'mp4' || ext === 'mov') return 'video/mp4';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'ogg' || ext === 'opus') return 'audio/ogg';
  if (ext === 'm4a' || ext === 'aac') return 'audio/mp4';
  if (ext === 'pdf') return 'application/pdf';
  return fallback;
}

function assertFileSize(size: number | undefined | null, max: number): boolean {
  if (!size || size <= max) return true;
  Alert.alert(pt.warning_title, 'Arquivo maior que o limite permitido.');
  return false;
}

function createBaseFormData(type: string, hash: string, replyId?: string | null) {
  const formData = new FormData();
  formData.append('type', type);
  formData.append('hash', hash);
  if (replyId) formData.append('message_quoted_id', replyId);
  return formData;
}

export function InternalChatRoomScreen() {
  const navigation = useNavigation<Navigation>();
  const route = useRoute<ScreenRoute>();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<InternalChatMessage>>(null);
  const micPressActiveRef = useRef(false);
  const micStartXRef = useRef<number | null>(null);
  const micStartYRef = useRef<number | null>(null);
  const pendingReleaseBeforeReadyRef = useRef(false);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recordingStartTokenRef = useRef(0);
  const cancelArmedRef = useRef(false);
  const recordingActiveRef = useRef(false);
  const recordingRef = useRef(false);
  const recordingLockedRef = useRef(false);
  const preparingRecordingRef = useRef(false);
  const sendingVoiceRecordingRef = useRef(false);
  const composerTextRef = useRef('');
  const sendingRef = useRef(false);
  const recordingPulse = useRef(new Animated.Value(1)).current;
  const recordingHintOffset = useRef(new Animated.Value(0)).current;
  const recordingHintOpacity = useRef(new Animated.Value(0)).current;
  const recorderOptions = useMemo(
    () => ({
      ...RecordingPresets.HIGH_QUALITY,
      isMeteringEnabled: true,
    }),
    []
  );
  const recorder = useAudioRecorder(recorderOptions);
  const recorderState = useAudioRecorderState(recorder, 100);

  const {
    currentUserId,
    state,
    groupMembers,
    loadingMessages,
    openConversation,
    loadUsers,
    closeConversation,
    loadMessages,
    markRead,
    sendMessage,
    sendFormDataMessage,
    reactMessage,
    editMessage,
    deleteMessage,
    viewMessageHistory,
    searchMessages,
    publishActivity,
    listGroupMembers,
    updateGroup,
    addGroupMember,
    removeGroupMember,
    transferGroupLeader,
    openDirect,
  } = useInternalChat();

  const routeConversation = route.params.conversation;
  const activeConversation =
    state.activeConversation?.conversation_id === routeConversation.conversation_id
      ? state.activeConversation
      : routeConversation;
  const conversationId = activeConversation.conversation_id;
  const messages = state.messages[conversationId] ?? [];
  const paging = state.messagesPaging[conversationId];

  const [composerText, setComposerText] = useState('');
  const [replyTo, setReplyTo] = useState<InternalChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<InternalChatMessage | null>(
    null
  );
  const [actionMessage, setActionMessage] =
    useState<InternalChatMessage | null>(null);
  const [attachmentVisible, setAttachmentVisible] = useState(false);
  const [composerEmojiPickerVisible, setComposerEmojiPickerVisible] =
    useState(false);
  const [infoVisible, setInfoVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyItems, setHistoryItems] = useState<
    Awaited<ReturnType<typeof viewMessageHistory>>
  >([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<
    InternalChatSearchMessageResult[]
  >([]);
  const [contactsVisible, setContactsVisible] = useState(false);
  const [contacts, setContacts] = useState<InternalChatContact[]>([]);
  const [recording, setRecording] = useState(false);
  const [isMicPressActive, setIsMicPressActive] = useState(false);
  const [isRecordingLocked, setIsRecordingLocked] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [isPreparingRecording, setIsPreparingRecording] = useState(false);
  const [sendingVoiceRecording, setSendingVoiceRecording] = useState(false);
  const [isRecordingCancelArmed, setIsRecordingCancelArmed] = useState(false);
  const [recordingWaveform, setRecordingWaveform] = useState<number[]>([]);
  const [showRecordingHint, setShowRecordingHint] = useState(false);
  const [sending, setSending] = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState(
    activeConversation.name ?? ''
  );
  const [canUpdateGroup, setCanUpdateGroup] = useState(false);
  const [canManageMembers, setCanManageMembers] = useState(false);
  const [canTransferLeader, setCanTransferLeader] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [transferringLeaderId, setTransferringLeaderId] = useState<
    string | null
  >(null);
  const [leavingConversation, setLeavingConversation] = useState(false);
  const [pendingGroupAction, setPendingGroupAction] =
    useState<PendingGroupAction | null>(null);
  const [groupActionError, setGroupActionError] = useState<string | null>(null);
  const [openingMemberDirectId, setOpeningMemberDirectId] = useState<
    string | null
  >(null);
  const [infoActionError, setInfoActionError] = useState<string | null>(null);

  const conversationTitle = resolveConversationTitle(
    activeConversation,
    currentUserId
  );
  const conversationPhoto = resolveConversationPhoto(
    activeConversation,
    currentUserId
  );
  const isGroup =
    activeConversation.type === INTERNAL_CHAT_CONVERSATION_TYPE.group;
  const isLeader =
    !!currentUserId && activeConversation.leader_user_id === currentUserId;
  const canEditGroup = isGroup && isLeader && canUpdateGroup;
  const canManageGroupMembers = isGroup && isLeader && canManageMembers;
  const memberActionLoading =
    !!removingMemberId || !!transferringLeaderId || leavingConversation;
  const infoActionLoading = memberActionLoading || !!openingMemberDirectId;
  const initialMessagesLoading = loadingMessages && messages.length === 0;

  const pendingGroupActionContent = useMemo(() => {
    if (!pendingGroupAction) {
      return {
        title: '',
        message: '',
        confirmText: '',
        loadingText: '',
        danger: false,
      };
    }
    if (pendingGroupAction.type === 'remove') {
      return {
        title: 'Remover membro',
        message: `Remover ${pendingGroupAction.member.name} do grupo?`,
        confirmText: 'Remover',
        loadingText: 'Removendo...',
        danger: true,
      };
    }
    if (pendingGroupAction.type === 'transfer') {
      return {
        title: 'Tornar líder',
        message: `Transferir a liderança do grupo para ${pendingGroupAction.member.name}?`,
        confirmText: 'Tornar líder',
        loadingText: 'Transferindo...',
        danger: false,
      };
    }
    return {
      title: isGroup ? 'Sair do grupo' : 'Fechar conversa',
      message: isGroup
        ? 'Você deixará de receber mensagens deste grupo.'
        : 'A conversa será removida da sua lista.',
      confirmText: isGroup ? 'Sair do grupo' : 'Fechar conversa',
      loadingText: isGroup ? 'Saindo...' : 'Fechando...',
      danger: true,
    };
  }, [isGroup, pendingGroupAction]);

  const recordingDurationLabel = useMemo(() => {
    const durationSec = Math.max(0, (recorderState.durationMillis || 0) / 1000);
    return formatAudioTime(durationSec);
  }, [recorderState.durationMillis]);

  const recordingWaveformBars = useMemo(() => {
    if (recordingWaveform.length > 0) return recordingWaveform;
    return new Array(RECORDING_WAVEFORM_MIN_BARS).fill(0.2);
  }, [recordingWaveform]);

  const hasComposerText = composerText.trim().length > 0;
  const showRecordingHoldOverlay =
    isMicPressActive &&
    !isRecordingLocked &&
    (isPreparingRecording || recording);
  const showRecordingComposer =
    recording && (isRecordingLocked || !isMicPressActive);

  const remoteActivity = useMemo(() => {
    return Object.values(state.remoteActivities).find(
      (activity) =>
        activity.conversation_id === conversationId &&
        activity.user_id !== currentUserId
    );
  }, [conversationId, currentUserId, state.remoteActivities]);

  useEffect(() => {
    void openConversation(conversationId);
  }, [conversationId, openConversation]);

  useEffect(() => {
    let cancelled = false;
    void getPermissions().then((permissions) => {
      if (cancelled) return;
      setCanUpdateGroup(canUpdateInternalChatGroup(permissions));
      setCanManageMembers(canManageInternalChatGroupMembers(permissions));
      setCanTransferLeader(canTransferInternalChatGroupLeader(permissions));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isGroup) return;
    void listGroupMembers(conversationId);
  }, [conversationId, isGroup, listGroupMembers]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last) {
      void markRead(conversationId, last.message_id);
    }
  }, [conversationId, markRead, messages]);

  useEffect(() => {
    if (!composerText.trim()) {
      void publishActivity(
        conversationId,
        recording
          ? INTERNAL_CHAT_ACTIVITY_STATE.recording
          : INTERNAL_CHAT_ACTIVITY_STATE.available
      );
      return;
    }
    const timer = setTimeout(() => {
      void publishActivity(conversationId, INTERNAL_CHAT_ACTIVITY_STATE.typing);
    }, 300);
    return () => clearTimeout(timer);
  }, [composerText, conversationId, publishActivity, recording]);

  useEffect(() => {
    composerTextRef.current = composerText;
    sendingRef.current = sending;
    recordingRef.current = recording;
    recordingLockedRef.current = isRecordingLocked;
    preparingRecordingRef.current = isPreparingRecording;
    sendingVoiceRecordingRef.current = sendingVoiceRecording;
  }, [
    composerText,
    isPreparingRecording,
    isRecordingLocked,
    recording,
    sending,
    sendingVoiceRecording,
  ]);

  useEffect(() => {
    const useNativeDriver = Platform.OS !== 'web';

    if (!showRecordingHint) {
      recordingHintOpacity.stopAnimation();
      recordingHintOffset.stopAnimation();
      recordingHintOpacity.setValue(0);
      recordingHintOffset.setValue(0);
      return;
    }

    recordingHintOpacity.setValue(0);
    recordingHintOffset.setValue(8);
    Animated.parallel([
      Animated.timing(recordingHintOpacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver,
      }),
      Animated.timing(recordingHintOffset, {
        toValue: 0,
        duration: 180,
        useNativeDriver,
      }),
    ]).start();

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(recordingHintOffset, {
          toValue: -5,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver,
        }),
        Animated.timing(recordingHintOffset, {
          toValue: 0,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver,
        }),
      ])
    );

    loop.start();
    return () => {
      loop.stop();
    };
  }, [recordingHintOffset, recordingHintOpacity, showRecordingHint]);

  useEffect(() => {
    const useNativeDriver = Platform.OS !== 'web';

    if (!recording || isRecordingPaused) {
      recordingPulse.stopAnimation();
      recordingPulse.setValue(1);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(recordingPulse, {
          toValue: 1.16,
          duration: 560,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver,
        }),
        Animated.timing(recordingPulse, {
          toValue: 1,
          duration: 560,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver,
        }),
      ])
    );

    loop.start();
    return () => {
      loop.stop();
    };
  }, [isRecordingPaused, recording, recordingPulse]);

  useEffect(() => {
    if (!recording || isRecordingPaused) return;

    const amplitude = normalizeRecordingMetering(recorderState.metering);
    setRecordingWaveform((previous) => {
      const next = [...previous, amplitude];
      if (next.length > RECORDING_WAVEFORM_MAX_BARS) {
        return next.slice(next.length - RECORDING_WAVEFORM_MAX_BARS);
      }
      return next;
    });
  }, [
    isRecordingPaused,
    recorderState.durationMillis,
    recorderState.metering,
    recording,
  ]);

  useEffect(() => {
    recordingActiveRef.current =
      recording || isRecordingPaused || recorderState.isRecording;
  }, [isRecordingPaused, recorderState.isRecording, recording]);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  const sendText = useCallback(async () => {
    const text = composerText.trim();
    if (!text || sending) return;
    setComposerEmojiPickerVisible(false);

    if (editingMessage) {
      setSending(true);
      try {
        const ok = await editMessage(
          conversationId,
          editingMessage.message_id,
          text
        );
        if (!ok) Alert.alert(pt.error_title, 'Não foi possível editar.');
        setEditingMessage(null);
        setComposerText('');
      } finally {
        setSending(false);
      }
      return;
    }

    setSending(true);
    try {
      const url = URL_PATTERN.exec(text)?.[0] ?? null;
      const linkPreview = url
        ? await generateInternalChatLinkPreview(url).catch(() => null)
        : null;
      const sent = await sendMessage(conversationId, {
        type: INTERNAL_MESSAGE_TYPE.text,
        message: text,
        message_quoted_id: replyTo?.message_id ?? null,
        link_preview: linkPreview,
      });
      if (!sent) Alert.alert(pt.error_title, pt.send_error);
      setComposerText('');
      setReplyTo(null);
      scrollToEnd();
    } finally {
      setSending(false);
    }
  }, [
    composerText,
    conversationId,
    editMessage,
    editingMessage,
    replyTo,
    scrollToEnd,
    sendMessage,
    sending,
  ]);

  const sendUpload = useCallback(
    async (input: {
      type: string;
      field: 'images' | 'videos' | 'documents' | 'audios';
      file: InternalChatUploadFile;
      content: InternalChatMessage['content'];
    }) => {
      const hash = createInternalChatMessageHash();
      const formData = createBaseFormData(
        input.type,
        hash,
        replyTo?.message_id ?? null
      );
      await appendInternalChatFile(formData, input.field, input.file);
      const optimistic = buildInternalOptimisticFileMessage({
        conversation: activeConversation,
        currentUserId,
        userName: 'Você',
        userPhoto: null,
        hash,
        content: {
          ...input.content,
          message_quoted_id: replyTo?.message_id ?? null,
        },
      });
      const sent = await sendFormDataMessage(conversationId, formData, optimistic);
      if (!sent) Alert.alert(pt.error_title, pt.send_error);
      setReplyTo(null);
      scrollToEnd();
    },
    [
      activeConversation,
      conversationId,
      currentUserId,
      replyTo,
      scrollToEnd,
      sendFormDataMessage,
    ]
  );

  const sendImageAsset = useCallback(
    async (asset: ImagePicker.ImagePickerAsset) => {
      if (!asset.uri) return;
      if (!assertFileSize(asset.fileSize, MAX_IMAGE_SIZE_BYTES)) return;
      const name =
        asset.fileName || getFileNameFromUri(asset.uri, `imagem-${Date.now()}.jpg`);
      const mimeType = asset.mimeType || getMimeTypeFromName(name, 'image/jpeg');
      await sendUpload({
        type: INTERNAL_MESSAGE_TYPE.image,
        field: 'images',
        file: { uri: asset.uri, name, mimeType },
        content: {
          type: INTERNAL_MESSAGE_TYPE.image,
          image: {
            url: asset.uri,
            mimetype: mimeType,
            name,
          } as never,
        },
      });
    },
    [sendUpload]
  );

  const sendVideoAsset = useCallback(
    async (asset: ImagePicker.ImagePickerAsset) => {
      if (!asset.uri) return;
      if (!assertFileSize(asset.fileSize, MAX_VIDEO_SIZE_BYTES)) return;
      const name =
        asset.fileName || getFileNameFromUri(asset.uri, `video-${Date.now()}.mp4`);
      const mimeType = asset.mimeType || getMimeTypeFromName(name, 'video/mp4');
      await sendUpload({
        type: INTERNAL_MESSAGE_TYPE.video,
        field: 'videos',
        file: { uri: asset.uri, name, mimeType },
        content: {
          type: INTERNAL_MESSAGE_TYPE.video,
          video: { url: asset.uri, name, mimetype: mimeType },
        },
      });
    },
    [sendUpload]
  );

  const pickImage = useCallback(async () => {
    setAttachmentVisible(false);
    setComposerEmojiPickerVisible(false);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(pt.warning_title, pt.image_permission_denied);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]?.uri) return;
    await sendImageAsset(result.assets[0]);
  }, [sendImageAsset]);

  const pickVideo = useCallback(async () => {
    setAttachmentVisible(false);
    setComposerEmojiPickerVisible(false);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(pt.warning_title, pt.image_permission_denied);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]?.uri) return;
    await sendVideoAsset(result.assets[0]);
  }, [sendVideoAsset]);

  const captureMedia = useCallback(async () => {
    setAttachmentVisible(false);
    setComposerEmojiPickerVisible(false);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(pt.warning_title, pt.camera_permission_denied);
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.85,
      videoMaxDuration: 120,
    });
    if (result.canceled || !result.assets[0]?.uri) return;
    const asset = result.assets[0];
    if (asset.type === 'video') {
      await sendVideoAsset(asset);
      return;
    }
    await sendImageAsset(asset);
  }, [sendImageAsset, sendVideoAsset]);

  const pickDocument = useCallback(async () => {
    setAttachmentVisible(false);
    setComposerEmojiPickerVisible(false);
    const result = await DocumentPicker.getDocumentAsync({
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]?.uri) return;
    const asset = result.assets[0];
    if (!assertFileSize(asset.size, MAX_DOCUMENT_SIZE_BYTES)) return;
    const name = asset.name || getFileNameFromUri(asset.uri, 'documento');
    const mimeType = asset.mimeType || getMimeTypeFromName(name, 'application/octet-stream');
    await sendUpload({
      type: INTERNAL_MESSAGE_TYPE.document,
      field: 'documents',
      file: { uri: asset.uri, name, mimeType },
      content: {
        type: INTERNAL_MESSAGE_TYPE.document,
        document: { url: asset.uri, name, mimetype: mimeType, size: asset.size },
      },
    });
  }, [sendUpload]);

  const pickAudioFile = useCallback(async () => {
    setAttachmentVisible(false);
    setComposerEmojiPickerVisible(false);
    const result = await DocumentPicker.getDocumentAsync({
      type: ['audio/*'],
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]?.uri) return;
    const asset = result.assets[0];
    if (!assertFileSize(asset.size, MAX_AUDIO_SIZE_BYTES)) return;
    const name = asset.name || getFileNameFromUri(asset.uri, 'audio.m4a');
    const mimeType = asset.mimeType || getMimeTypeFromName(name, 'audio/mp4');
    await sendUpload({
      type: INTERNAL_MESSAGE_TYPE.audio,
      field: 'audios',
      file: { uri: asset.uri, name, mimeType },
      content: {
        type: INTERNAL_MESSAGE_TYPE.audio,
        audio: { url: asset.uri, name, mimetype: mimeType },
      },
    });
  }, [sendUpload]);

  const sendCurrentLocation = useCallback(async () => {
    setAttachmentVisible(false);
    setComposerEmojiPickerVisible(false);
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(pt.warning_title, 'Permissão de localização negada.');
      return;
    }
    const location = await Location.getCurrentPositionAsync({});
    const sent = await sendMessage(conversationId, {
      type: INTERNAL_MESSAGE_TYPE.location,
      location_latitude: location.coords.latitude,
      location_longitude: location.coords.longitude,
      location_name: 'Localização atual',
      message_quoted_id: replyTo?.message_id ?? null,
    });
    if (!sent) Alert.alert(pt.error_title, pt.send_error);
    setReplyTo(null);
  }, [conversationId, replyTo, sendMessage]);

  const openContactPicker = useCallback(async () => {
    setAttachmentVisible(false);
    setComposerEmojiPickerVisible(false);
    setContactsVisible(true);
    const data = await listInternalChatContacts({ currentPage: 1, perPage: 50 });
    setContacts(data.results);
  }, []);

  const sendContact = useCallback(
    async (contact: InternalChatContact) => {
      setContactsVisible(false);
      const sent = await sendMessage(conversationId, {
        type: INTERNAL_MESSAGE_TYPE.contact_card,
        contacts: [contact.contact_id],
        message_quoted_id: replyTo?.message_id ?? null,
      });
      if (!sent) Alert.alert(pt.error_title, pt.send_error);
      setReplyTo(null);
    },
    [conversationId, replyTo, sendMessage]
  );

  const attachmentActions = useMemo<InternalAttachmentAction[]>(
    () => [
      {
        key: 'document',
        label: pt.documents,
        icon: 'document-text-outline',
        color: '#1D9BF0',
        onPress: () => {
          void pickDocument();
        },
      },
      {
        key: 'photo',
        label: pt.photos,
        icon: 'image-outline',
        color: '#1D9BF0',
        onPress: () => {
          void pickImage();
        },
      },
      {
        key: 'video',
        label: pt.videos,
        icon: 'videocam-outline',
        color: '#4F46E5',
        onPress: () => {
          void pickVideo();
        },
      },
      {
        key: 'audio',
        label: pt.audio,
        icon: 'headset-outline',
        color: '#22C55E',
        onPress: () => {
          void pickAudioFile();
        },
      },
      {
        key: 'contact',
        label: pt.contact,
        icon: 'person-outline',
        color: '#6B7280',
        onPress: () => {
          void openContactPicker();
        },
      },
      {
        key: 'location',
        label: pt.location,
        icon: 'location-outline',
        color: '#10B981',
        onPress: () => {
          void sendCurrentLocation();
        },
      },
    ],
    [
      openContactPicker,
      pickAudioFile,
      pickDocument,
      pickImage,
      pickVideo,
      sendCurrentLocation,
    ]
  );

  const openAttachmentPicker = useCallback(() => {
    setComposerEmojiPickerVisible(false);
    setAttachmentVisible(true);
  }, []);

  const selectComposerEmoji = useCallback((emoji: string) => {
    setComposerText((current) => `${current}${emoji}`);
  }, []);

  const resetRecordingComposerState = useCallback(() => {
    micPressActiveRef.current = false;
    micStartXRef.current = null;
    micStartYRef.current = null;
    pendingReleaseBeforeReadyRef.current = false;
    recordingStartedAtRef.current = null;
    cancelArmedRef.current = false;
    recordingRef.current = false;
    recordingLockedRef.current = false;
    preparingRecordingRef.current = false;
    setIsMicPressActive(false);
    setRecording(false);
    setIsRecordingLocked(false);
    setIsRecordingPaused(false);
    setIsPreparingRecording(false);
    setIsRecordingCancelArmed(false);
    setShowRecordingHint(false);
    setRecordingWaveform([]);
  }, []);

  const applyRecordingAudioMode = useCallback(async (enabled: boolean) => {
    try {
      if (enabled) {
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
          interruptionMode: 'duckOthers',
          shouldPlayInBackground: false,
          shouldRouteThroughEarpiece: false,
          allowsBackgroundRecording: false,
        });
        return;
      }

      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
      });
    } catch {}
  }, []);

  const stopRecording = useCallback(async () => {
    const durationSec = Math.max(
      1,
      Math.round((recorderState.durationMillis || 0) / 1000)
    );

    try {
      await recorder.stop();
    } catch {}

    await applyRecordingAudioMode(false);

    const uri = recorder.uri ?? recorderState.url;
    if (!uri) return null;
    const name = getFileNameFromUri(uri, `audio-${Date.now()}.m4a`);
    const mimeType = getMimeTypeFromName(name, 'audio/mp4');

    return { uri, name, mimeType, durationSec };
  }, [
    applyRecordingAudioMode,
    recorder,
    recorderState.durationMillis,
    recorderState.url,
  ]);

  const sendRecording = useCallback(async () => {
    if (sendingVoiceRecordingRef.current) return;
    sendingVoiceRecordingRef.current = true;
    setSendingVoiceRecording(true);

    const recorded = await stopRecording();
    resetRecordingComposerState();
    void publishActivity(conversationId, INTERNAL_CHAT_ACTIVITY_STATE.available);

    try {
      if (!recorded) return;
      await sendUpload({
        type: INTERNAL_MESSAGE_TYPE.audio,
        field: 'audios',
        file: {
          uri: recorded.uri,
          name: recorded.name,
          mimeType: recorded.mimeType,
        },
        content: {
          type: INTERNAL_MESSAGE_TYPE.audio,
          audio: {
            url: recorded.uri,
            name: recorded.name,
            mimetype: recorded.mimeType,
            duration: recorded.durationSec,
            ptt: true,
          },
        },
      });
    } finally {
      sendingVoiceRecordingRef.current = false;
      setSendingVoiceRecording(false);
    }
  }, [
    conversationId,
    publishActivity,
    resetRecordingComposerState,
    sendUpload,
    stopRecording,
  ]);

  const lockRecording = useCallback(() => {
    if (!recordingRef.current || recordingLockedRef.current) return;
    recordingLockedRef.current = true;
    setIsRecordingLocked(true);
    setShowRecordingHint(false);
  }, []);

  const cancelRecording = useCallback(async () => {
    recordingStartTokenRef.current += 1;

    try {
      await recorder.stop();
    } catch {}

    await applyRecordingAudioMode(false);
    resetRecordingComposerState();
    void publishActivity(conversationId, INTERNAL_CHAT_ACTIVITY_STATE.available);
  }, [
    applyRecordingAudioMode,
    conversationId,
    publishActivity,
    recorder,
    resetRecordingComposerState,
  ]);

  const togglePauseRecording = useCallback(() => {
    if (!recordingRef.current) return;

    try {
      if (isRecordingPaused) {
        recorder.record();
        setIsRecordingPaused(false);
        return;
      }
      recorder.pause();
      setIsRecordingPaused(true);
    } catch {}
  }, [isRecordingPaused, recorder]);

  const startRecording = useCallback(async () => {
    if (
      recordingRef.current ||
      preparingRecordingRef.current ||
      sendingVoiceRecordingRef.current
    ) {
      return;
    }

    setComposerEmojiPickerVisible(false);
    const startToken = ++recordingStartTokenRef.current;
    preparingRecordingRef.current = true;
    setIsPreparingRecording(true);

    try {
      const permission = await requestRecordingPermissionsAsync();
      if (startToken !== recordingStartTokenRef.current) return;
      if (!permission.granted) {
        resetRecordingComposerState();
        Alert.alert(pt.warning_title, pt.microphone_permission_denied);
        return;
      }

      await applyRecordingAudioMode(true);
      if (startToken !== recordingStartTokenRef.current) return;
      await recorder.prepareToRecordAsync(recorderOptions);
      if (startToken !== recordingStartTokenRef.current) return;
      recorder.record();

      recordingRef.current = true;
      recordingLockedRef.current = false;
      setRecording(true);
      setIsRecordingLocked(false);
      setIsRecordingPaused(false);
      setShowRecordingHint(true);
      setRecordingWaveform([]);
      recordingStartedAtRef.current = Date.now();
      void publishActivity(conversationId, INTERNAL_CHAT_ACTIVITY_STATE.recording);

      if (pendingReleaseBeforeReadyRef.current) {
        pendingReleaseBeforeReadyRef.current = false;
        lockRecording();
      }
    } catch {
      resetRecordingComposerState();
      await applyRecordingAudioMode(false);
      Alert.alert(pt.error_title, pt.audio_recording_error);
    } finally {
      preparingRecordingRef.current = false;
      setIsPreparingRecording(false);
    }
  }, [
    applyRecordingAudioMode,
    conversationId,
    lockRecording,
    publishActivity,
    recorder,
    recorderOptions,
    resetRecordingComposerState,
  ]);

  const startRecordingCbRef = useRef(startRecording);
  const sendRecordingCbRef = useRef(sendRecording);
  const lockRecordingCbRef = useRef(lockRecording);
  const cancelRecordingCbRef = useRef(cancelRecording);

  useEffect(() => {
    startRecordingCbRef.current = startRecording;
  }, [startRecording]);

  useEffect(() => {
    sendRecordingCbRef.current = sendRecording;
  }, [sendRecording]);

  useEffect(() => {
    lockRecordingCbRef.current = lockRecording;
  }, [lockRecording]);

  useEffect(() => {
    cancelRecordingCbRef.current = cancelRecording;
  }, [cancelRecording]);

  useEffect(() => {
    return () => {
      if (!recordingActiveRef.current) return;
      try {
        recorder.stop();
      } catch {}
      void applyRecordingAudioMode(false);
    };
  }, [applyRecordingAudioMode, recorder]);

  useEffect(() => {
    if (!recordingActiveRef.current) return;
    void cancelRecordingCbRef.current();
  }, [conversationId]);

  const handleMicPressGrant = useCallback((pageX: number, pageY: number) => {
    if (composerTextRef.current.trim().length > 0) return;
    if (sendingRef.current || sendingVoiceRecordingRef.current) return;
    if (preparingRecordingRef.current || recordingRef.current) return;

    pendingReleaseBeforeReadyRef.current = false;
    cancelArmedRef.current = false;
    setIsRecordingCancelArmed(false);
    micPressActiveRef.current = true;
    micStartXRef.current = pageX;
    micStartYRef.current = pageY;
    setIsMicPressActive(true);
    void startRecordingCbRef.current();
  }, []);

  const handleMicPressMove = useCallback((pageX: number, pageY: number) => {
    if (!recordingRef.current || recordingLockedRef.current) return;

    const startX = micStartXRef.current;
    if (startX != null) {
      const deltaX = pageX - startX;
      const nextCancelArmed = deltaX <= -VOICE_CANCEL_SWIPE_THRESHOLD;
      if (nextCancelArmed !== cancelArmedRef.current) {
        cancelArmedRef.current = nextCancelArmed;
        setIsRecordingCancelArmed(nextCancelArmed);
        setShowRecordingHint(!nextCancelArmed);
      }
    }

    if (cancelArmedRef.current) return;

    const startY = micStartYRef.current;
    if (startY == null) return;
    const deltaY = startY - pageY;
    if (deltaY < VOICE_LOCK_SWIPE_THRESHOLD) return;

    lockRecordingCbRef.current();
  }, []);

  const handleMicPressRelease = useCallback(() => {
    const wasMicPressActive = micPressActiveRef.current;
    const wasCancelArmed = cancelArmedRef.current;
    micPressActiveRef.current = false;
    micStartXRef.current = null;
    micStartYRef.current = null;
    cancelArmedRef.current = false;
    setIsRecordingCancelArmed(false);
    setIsMicPressActive(false);
    setShowRecordingHint(false);

    if (!wasMicPressActive) return;

    if (wasCancelArmed) {
      void cancelRecordingCbRef.current();
      return;
    }

    if (!recordingRef.current) {
      pendingReleaseBeforeReadyRef.current = true;
      return;
    }
    if (recordingLockedRef.current) return;

    const recordingStartedAt = recordingStartedAtRef.current;
    const elapsedMs = recordingStartedAt
      ? Date.now() - recordingStartedAt
      : Number.POSITIVE_INFINITY;
    if (elapsedMs < VOICE_RELEASE_LOCK_GRACE_MS) {
      lockRecordingCbRef.current();
      return;
    }

    void sendRecordingCbRef.current();
  }, []);

  const handleMicPressTerminate = useCallback(() => {
    const wasMicPressActive = micPressActiveRef.current;
    const wasCancelArmed = cancelArmedRef.current;
    micPressActiveRef.current = false;
    micStartXRef.current = null;
    micStartYRef.current = null;
    cancelArmedRef.current = false;
    setIsRecordingCancelArmed(false);
    setIsMicPressActive(false);
    setShowRecordingHint(false);

    if (!wasMicPressActive) return;

    if (wasCancelArmed) {
      void cancelRecordingCbRef.current();
      return;
    }

    if (!recordingRef.current) {
      pendingReleaseBeforeReadyRef.current = true;
      return;
    }
    if (recordingLockedRef.current) return;

    lockRecordingCbRef.current();
  }, []);

  const micPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: (event) => {
          handleMicPressGrant(
            event.nativeEvent.pageX,
            event.nativeEvent.pageY
          );
        },
        onPanResponderMove: (event) => {
          handleMicPressMove(event.nativeEvent.pageX, event.nativeEvent.pageY);
        },
        onPanResponderRelease: handleMicPressRelease,
        onPanResponderTerminate: handleMicPressTerminate,
        onPanResponderTerminationRequest: () => false,
      }),
    [
      handleMicPressGrant,
      handleMicPressMove,
      handleMicPressRelease,
      handleMicPressTerminate,
    ]
  );

  const loadOlder = useCallback(() => {
    if (loadingMessages || !paging || paging.current_page >= paging.total_pages) {
      return;
    }
    void loadMessages(conversationId, {
      page: paging.current_page + 1,
      append: true,
    });
  }, [conversationId, loadMessages, loadingMessages, paging]);

  const handleAction = useCallback(
    async (action: string) => {
      const target = actionMessage;
      if (!target) return;
      setActionMessage(null);

      if (action === 'reply') {
        setReplyTo(target);
        return;
      }
      if (action === 'copy') {
        await Clipboard.setStringAsync(getMessageText(target));
        return;
      }
      if (action === 'edit') {
        setEditingMessage(target);
        setComposerText(getMessageText(target));
        return;
      }
      if (action === 'delete') {
        const ok = await deleteMessage(conversationId, target.message_id);
        if (!ok) Alert.alert(pt.error_title, 'Não foi possível apagar.');
        return;
      }
      if (action === 'history') {
        const items = await viewMessageHistory(conversationId, target.message_id);
        setHistoryItems(items);
        setHistoryVisible(true);
        return;
      }
      if (action.startsWith('react:')) {
        const emoji = action.slice('react:'.length);
        const ok = await reactMessage(conversationId, target.message_id, emoji);
        if (!ok) Alert.alert(pt.error_title, 'Não foi possível reagir.');
        return;
      }
      if (action === 'download') {
        const url = getMediaUrl(target);
        if (url) await Linking.openURL(resolveImageUri(url) ?? url);
      }
    },
    [
      actionMessage,
      conversationId,
      deleteMessage,
      reactMessage,
      viewMessageHistory,
    ]
  );

  const runSearch = useCallback(async () => {
    const normalized = searchTerm.trim();
    if (!normalized) {
      setSearchResults([]);
      return;
    }
    const result = await searchMessages(conversationId, normalized);
    setSearchResults(result.results);
  }, [conversationId, searchMessages, searchTerm]);

  const closePendingGroupAction = useCallback(() => {
    if (memberActionLoading) return;
    setPendingGroupAction(null);
    setGroupActionError(null);
  }, [memberActionLoading]);

  const requestRemoveGroupMember = useCallback(
    (member: InternalChatParticipant) => {
      if (infoActionLoading) return;
      setInfoActionError(null);
      setGroupActionError(null);
      setPendingGroupAction({ type: 'remove', member });
    },
    [infoActionLoading]
  );

  const requestTransferGroupLeader = useCallback(
    (member: InternalChatParticipant) => {
      if (infoActionLoading) return;
      setInfoActionError(null);
      setGroupActionError(null);
      setPendingGroupAction({ type: 'transfer', member });
    },
    [infoActionLoading]
  );

  const closeOrLeave = useCallback(() => {
    if (infoActionLoading) return;
    setInfoActionError(null);
    setGroupActionError(null);
    setPendingGroupAction({ type: 'leave' });
  }, [infoActionLoading]);

  const confirmPendingGroupAction = useCallback(async () => {
    const action = pendingGroupAction;
    if (!action || memberActionLoading) return;
    setGroupActionError(null);

    if (action.type === 'remove') {
      setRemovingMemberId(action.member.user_id);
      try {
        const ok = await removeGroupMember(
          conversationId,
          action.member.user_id
        );
        if (!ok) {
          setGroupActionError('Não foi possível remover o membro.');
          return;
        }
        setPendingGroupAction(null);
      } finally {
        setRemovingMemberId(null);
      }
      return;
    }

    if (action.type === 'transfer') {
      setTransferringLeaderId(action.member.user_id);
      try {
        const updated = await transferGroupLeader(
          conversationId,
          action.member.user_id
        );
        if (!updated) {
          setGroupActionError('Não foi possível alterar a liderança.');
          return;
        }
        setPendingGroupAction(null);
      } finally {
        setTransferringLeaderId(null);
      }
      return;
    }

    setLeavingConversation(true);
    let navigated = false;
    try {
      const ok = await closeConversation(conversationId);
      if (!ok) {
        setGroupActionError(
          isGroup
            ? 'Não foi possível sair do grupo.'
            : 'Não foi possível fechar a conversa.'
        );
        return;
      }
      navigated = true;
      setPendingGroupAction(null);
      navigation.goBack();
    } finally {
      if (!navigated) {
        setLeavingConversation(false);
      }
    }
  }, [
    closeConversation,
    conversationId,
    isGroup,
    memberActionLoading,
    navigation,
    pendingGroupAction,
    removeGroupMember,
    transferGroupLeader,
  ]);

  const updateGroupName = useCallback(async () => {
    const normalized = groupNameDraft.trim();
    if (!normalized) return;
    const updated = await updateGroup(conversationId, { name: normalized });
    if (!updated) Alert.alert(pt.error_title, 'Não foi possível atualizar o grupo.');
  }, [conversationId, groupNameDraft, updateGroup]);

  const openDirectFromMember = useCallback(
    async (member: InternalChatParticipant) => {
      if (infoActionLoading) return;
      setInfoActionError(null);
      setOpeningMemberDirectId(member.user_id);
      try {
        const conversation = await openDirect(member.user_id);
        if (conversation) {
          setInfoVisible(false);
          navigation.push('InternalChatRoom', { conversation });
          return;
        }
        setInfoActionError('Não foi possível abrir a conversa direta.');
      } finally {
        setOpeningMemberDirectId(null);
      }
    },
    [infoActionLoading, navigation, openDirect]
  );

  const renderMessage: ListRenderItem<InternalChatMessage> = useCallback(
    ({ item, index }) => {
      const own = !!currentUserId && item.user?.id === currentUserId;
      const previous = messages[index - 1];
      const showDate = !previous || !isSameDay(previous.date, item.date);
      const content = item.content;
      const imageUri = resolveImageUri(content?.image?.url);
      const documentName = content?.document?.name;
      const reactions = content?.reactions ?? [];

      return (
        <View>
          {showDate ? (
            <View style={styles.dateSeparator}>
              <Text style={styles.dateSeparatorText}>
                {formatDateSeparator(item.date)}
              </Text>
            </View>
          ) : null}
          <Pressable
            style={[styles.messageRow, own && styles.messageRowOwn]}
            onLongPress={() => setActionMessage(item)}
          >
            {!own && isGroup ? (
              <AppAvatar uri={item.user?.photo ?? null} size={28} />
            ) : null}
            <View
              style={[
                styles.bubble,
                own ? styles.bubbleOwn : styles.bubbleOther,
                item.deleted && styles.bubbleDeleted,
              ]}
            >
              {!own && isGroup ? (
                <Text
                  style={[
                    styles.senderName,
                    isInternalChatSystemMessage(item) && styles.systemSenderName,
                  ]}
                >
                  {resolveInternalChatSenderName(item)}
                </Text>
              ) : null}
              {content?.quoted ? (
                <View style={styles.quoteBox}>
                  <Text style={styles.quoteText} numberOfLines={2}>
                    {resolveInternalChatTextTag(content.quoted.message) ||
                      resolveInternalChatTextTag(content.quoted.type) ||
                      'Resposta'}
                  </Text>
                </View>
              ) : null}
              {imageUri ? (
                <ExpoImage
                  source={{ uri: imageUri }}
                  style={styles.messageImage}
                  contentFit="cover"
                />
              ) : null}
              {content?.video ? (
                <View style={styles.mediaBox}>
                  <Ionicons name="play-circle" size={26} color={colors.primary} />
                  <Text style={styles.mediaText} numberOfLines={1}>
                    {content.video.name || 'Vídeo'}
                  </Text>
                </View>
              ) : null}
              {content?.audio ? (
                <View style={styles.mediaBox}>
                  <Ionicons name="mic" size={22} color={colors.primary} />
                  <Text style={styles.mediaText} numberOfLines={1}>
                    {content.audio.name || 'Áudio'}
                  </Text>
                </View>
              ) : null}
              {content?.document ? (
                <Pressable
                  style={styles.mediaBox}
                  onPress={() => {
                    const url = resolveImageUri(content.document?.url ?? null);
                    if (url) void Linking.openURL(url);
                  }}
                >
                  <Ionicons name="document-text" size={22} color={colors.primary} />
                  <Text style={styles.mediaText} numberOfLines={1}>
                    {documentName || 'Documento'}
                  </Text>
                </Pressable>
              ) : null}
              {content?.location ? (
                <Pressable
                  style={styles.mediaBox}
                  onPress={() => {
                    const { latitude, longitude } = content.location ?? {};
                    if (latitude && longitude) {
                      void Linking.openURL(
                        `https://maps.google.com/?q=${latitude},${longitude}`
                      );
                    }
                  }}
                >
                  <Ionicons name="location" size={22} color={colors.primary} />
                  <Text style={styles.mediaText} numberOfLines={1}>
                    {content.location.name || 'Localização'}
                  </Text>
                </Pressable>
              ) : null}
              {content?.contact ? (
                <Pressable
                  style={styles.mediaBox}
                  onPress={() => {
                    if (!content.contact?.contact_id) return;
                    void viewInternalChatContactPhone(
                      content.contact.contact_id
                    ).then((phone) => {
                      Alert.alert(
                        content.contact?.name ?? 'Contato',
                        phone?.phone
                          ? `+${phone.phone_ddi ?? ''} ${phone.phone}`
                          : 'Telefone indisponível'
                      );
                    });
                  }}
                >
                  <Ionicons name="person-circle" size={24} color={colors.primary} />
                  <Text style={styles.mediaText} numberOfLines={1}>
                    {content.contact.name}
                  </Text>
                </Pressable>
              ) : null}
              {content?.link_preview?.title ? (
                <View style={styles.linkPreview}>
                  <Text style={styles.linkTitle} numberOfLines={1}>
                    {content.link_preview.title}
                  </Text>
                  {content.link_preview.description ? (
                    <Text style={styles.linkDescription} numberOfLines={2}>
                      {content.link_preview.description}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {content?.message || item.deleted ? (
                <Text
                  style={[
                    styles.messageText,
                    item.deleted && styles.messageDeletedText,
                  ]}
                >
                  {getMessageText(item)}
                </Text>
              ) : null}
              <View style={styles.messageMeta}>
                {item.local_status === 'sending' ? (
                  <Text style={styles.metaText}>enviando</Text>
                ) : item.local_status === 'error' ? (
                  <Text style={styles.errorMetaText}>erro</Text>
                ) : null}
                <Text style={styles.metaText}>{formatMessageTime(item.date)}</Text>
              </View>
              {reactions.length > 0 ? (
                <View style={styles.reactionsRow}>
                  {reactions.map((reaction, reactionIndex) => (
                    <Text key={`${reaction.emoji}-${reactionIndex}`}>
                      {reaction.emoji}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          </Pressable>
        </View>
      );
    },
    [currentUserId, isGroup, messages]
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={keyboardAvoidingBehavior}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Ionicons name="chevron-back" size={28} color={colors.onSurface} />
        </Pressable>
        <Pressable style={styles.headerContact} onPress={() => setInfoVisible(true)}>
          <AppAvatar
            uri={conversationPhoto}
            size={42}
            iconName={isGroup ? 'people' : 'person'}
          />
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {conversationTitle}
            </Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {remoteActivity
                ? `${remoteActivity.user_name ?? 'Usuário'} ${
                    remoteActivity.state === 'recording'
                      ? 'está gravando áudio...'
                      : 'está digitando...'
                  }`
                : isGroup
                  ? `${activeConversation.participants.length} membros`
                  : 'Chat Interno'}
            </Text>
          </View>
        </Pressable>
        <Pressable onPress={() => setSearchVisible(true)} hitSlop={12}>
          <Ionicons name="search" size={22} color={colors.grey700} />
        </Pressable>
        <Pressable onPress={() => setInfoVisible(true)} hitSlop={12}>
          <Ionicons name="ellipsis-vertical" size={22} color={colors.grey700} />
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.message_id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messagesContent}
        onContentSizeChange={scrollToEnd}
        ListHeaderComponent={
          paging && paging.current_page < paging.total_pages ? (
            <Pressable style={styles.loadOlderBtn} onPress={loadOlder}>
              {loadingMessages ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={styles.loadOlderText}>Carregar anteriores</Text>
              )}
            </Pressable>
          ) : null
        }
      />

      {initialMessagesLoading ? (
        <View pointerEvents="none" style={styles.initialMessagesLoading}>
          <View style={styles.initialMessagesLoadingCard}>
            <ActivityIndicator size="small" color={colors.onPrimary} />
            <Text style={styles.initialMessagesLoadingText}>
              Abrindo conversa...
            </Text>
          </View>
        </View>
      ) : null}

      {replyTo || editingMessage ? (
        <View style={styles.replyBar}>
          <View style={styles.replyAccent} />
          <View style={styles.replyContent}>
            <Text style={styles.replyTitle}>
              {editingMessage ? 'Editando mensagem' : 'Respondendo'}
            </Text>
            <Text style={styles.replyText} numberOfLines={1}>
              {getMessageText(editingMessage ?? replyTo!)}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              setReplyTo(null);
              setEditingMessage(null);
              setComposerText('');
            }}
            hitSlop={10}
          >
            <Ionicons name="close" size={20} color={colors.grey700} />
          </Pressable>
        </View>
      ) : null}

      <View
        style={[
          styles.composer,
          showRecordingComposer && styles.composerRecording,
          { paddingBottom: insets.bottom + 8 },
        ]}
      >
        {showRecordingComposer ? (
          <View style={styles.recordingComposerWrap}>
            {isRecordingLocked ? (
              <>
                <Pressable
                  onPress={() => {
                    void cancelRecording();
                  }}
                  style={styles.recordActionBtn}
                  accessibilityLabel={pt.delete_recording}
                >
                  <Ionicons name="trash-outline" size={20} color="#EF4444" />
                </Pressable>
                <View style={styles.recordingLockedCenter}>
                  <View style={styles.recordingMetaRow}>
                    <Animated.View
                      style={[
                        styles.recordingDot,
                        isRecordingPaused && styles.recordingDotPaused,
                        { transform: [{ scale: recordingPulse }] },
                      ]}
                    />
                    <Text style={styles.recordingTimeText}>
                      {recordingDurationLabel}
                    </Text>
                  </View>
                  <View style={styles.recordingWaveformTrack}>
                    {recordingWaveformBars.map((value, index) => (
                      <View
                        key={`internal-record-locked-${index}`}
                        style={[
                          styles.recordingWaveformBar,
                          { height: `${Math.max(14, value * 100)}%` },
                        ]}
                      />
                    ))}
                  </View>
                </View>
                <Pressable
                  style={styles.recordActionBtn}
                  onPress={togglePauseRecording}
                  accessibilityLabel={
                    isRecordingPaused
                      ? pt.resume_recording
                      : pt.pause_recording
                  }
                >
                  <Ionicons
                    name={isRecordingPaused ? 'play' : 'pause'}
                    size={19}
                    color={colors.primary}
                  />
                </Pressable>
                <Pressable
                  onPress={() => {
                    void sendRecording();
                  }}
                  style={[
                    styles.recordActionBtn,
                    styles.recordSendBtn,
                    sendingVoiceRecording && styles.sendBtnDisabled,
                  ]}
                  disabled={sendingVoiceRecording}
                  accessibilityLabel={pt.send_recording}
                >
                  {sendingVoiceRecording ? (
                    <ActivityIndicator size="small" color={colors.onPrimary} />
                  ) : (
                    <Ionicons name="send" size={18} color="#FFFFFF" />
                  )}
                </Pressable>
              </>
            ) : (
              <>
                <View style={styles.recordingLiveMeta}>
                  <Animated.View
                    style={[
                      styles.recordingDot,
                      { transform: [{ scale: recordingPulse }] },
                    ]}
                  />
                  <Text style={styles.recordingTimeText}>
                    {recordingDurationLabel}
                  </Text>
                </View>
                <View style={styles.recordingWaveformTrack}>
                  {recordingWaveformBars.map((value, index) => (
                    <View
                      key={`internal-record-live-${index}`}
                      style={[
                        styles.recordingWaveformBar,
                        { height: `${Math.max(12, value * 100)}%` },
                      ]}
                    />
                  ))}
                </View>
                <Animated.View
                  style={[
                    styles.recordingHintWrap,
                    {
                      opacity: recordingHintOpacity,
                      transform: [{ translateY: recordingHintOffset }],
                    },
                  ]}
                >
                  <Ionicons
                    name="chevron-up-outline"
                    size={16}
                    color={colors.primary}
                  />
                  <Text style={styles.recordingHintText}>
                    {pt.slide_up_to_lock}
                  </Text>
                </Animated.View>
              </>
            )}
          </View>
        ) : (
          <>
            {!recording && !showRecordingHoldOverlay ? (
              <Pressable
                style={styles.plusActionBtn}
                onPress={openAttachmentPicker}
                accessibilityLabel={pt.open_attachments}
              >
                <Ionicons name="add" size={20} color={colors.grey700} />
              </Pressable>
            ) : null}
            <View style={styles.inputStack}>
              <TextInput
                style={styles.composerInput}
                value={composerText}
                onChangeText={setComposerText}
                placeholder={pt.type_message}
                placeholderTextColor={colors.grey500}
                multiline
                maxLength={65535}
                editable={
                  !sending &&
                  !isPreparingRecording &&
                  !recording &&
                  !sendingVoiceRecording
                }
              />
              {!showRecordingHoldOverlay ? (
                <Pressable
                  style={[
                    styles.emojiInputBtn,
                    composerEmojiPickerVisible && styles.emojiInputBtnActive,
                  ]}
                  onPress={() =>
                    setComposerEmojiPickerVisible((current) => !current)
                  }
                  accessibilityLabel={pt.open_emoji_keyboard}
                >
                  <Ionicons
                    name="happy-outline"
                    size={19}
                    color={colors.grey600}
                  />
                </Pressable>
              ) : null}
              {showRecordingHoldOverlay ? (
                <View pointerEvents="none" style={styles.recordingHoldOverlay}>
                  <View style={styles.recordingHoldLeft}>
                    <Animated.View
                      style={[
                        styles.recordingDot,
                        !recording && styles.recordingDotPaused,
                        { transform: [{ scale: recordingPulse }] },
                      ]}
                    />
                    <Text style={styles.recordingHoldTime}>
                      {recordingDurationLabel}
                    </Text>
                  </View>
                  <View style={styles.recordingHoldCenter}>
                    <Text
                      style={[
                        styles.recordingHoldCancelText,
                        isRecordingCancelArmed &&
                          styles.recordingHoldCancelTextArmed,
                      ]}
                      numberOfLines={1}
                    >
                      {isRecordingCancelArmed
                        ? pt.release_to_cancel
                        : pt.slide_left_to_cancel}
                    </Text>
                    <Ionicons
                      name="chevron-back-outline"
                      size={18}
                      color={
                        isRecordingCancelArmed ? '#EF4444' : colors.grey600
                      }
                    />
                  </View>
                  <View style={styles.recordingHoldRight}>
                    <Ionicons
                      name="lock-closed-outline"
                      size={15}
                      color={colors.grey600}
                    />
                    <Ionicons
                      name="chevron-up-outline"
                      size={18}
                      color={colors.grey600}
                    />
                  </View>
                </View>
              ) : null}
            </View>
            {hasComposerText ? (
              <Pressable
                style={[styles.sendBtn, sending && styles.sendBtnDisabled]}
                onPress={dismissKeyboardAnd(sendText)}
                disabled={sending}
              >
                {sending ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <Ionicons name="send" size={20} color={colors.onPrimary} />
                )}
              </Pressable>
            ) : (
              <View style={styles.composerActionsWrap}>
                {!recording && !showRecordingHoldOverlay ? (
                  <Pressable
                    style={styles.composerActionBtn}
                    onPress={() => {
                      void captureMedia();
                    }}
                    accessibilityLabel={pt.open_camera}
                  >
                    <Ionicons
                      name="camera-outline"
                      size={21}
                      color="#FFFFFF"
                    />
                  </Pressable>
                ) : null}
                <View style={styles.micGestureWrap} collapsable={false}>
                  {showRecordingHoldOverlay && !isRecordingCancelArmed ? (
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        styles.micLockHintPill,
                        {
                          transform: [{ translateY: recordingHintOffset }],
                        },
                      ]}
                    >
                      <Ionicons
                        name="lock-closed"
                        size={14}
                        color={colors.grey700}
                      />
                      <Ionicons
                        name="chevron-up-outline"
                        size={18}
                        color={colors.grey700}
                      />
                    </Animated.View>
                  ) : null}
                  <Animated.View
                    {...micPanResponder.panHandlers}
                    collapsable={false}
                    style={[
                      styles.composerActionBtn,
                      styles.micActionBtn,
                      (isPreparingRecording || recording) &&
                        styles.micActionBtnRecording,
                      styles.micActionBtnLarge,
                      sendingVoiceRecording && styles.sendBtnDisabled,
                      { transform: [{ scale: recordingPulse }] },
                    ]}
                  >
                    {isPreparingRecording || sendingVoiceRecording ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Ionicons name="mic" size={22} color="#FFFFFF" />
                    )}
                  </Animated.View>
                </View>
              </View>
            )}
          </>
        )}
      </View>

      {composerEmojiPickerVisible && !recording ? (
        <View style={styles.composerEmojiPickerWrap}>
          <View style={styles.composerEmojiPickerCard}>
            <View style={styles.emojiGrid}>
              {COMPOSER_EMOJIS.map((emoji, index) => (
                <Pressable
                  key={`${emoji}-${index}`}
                  style={styles.emojiBtn}
                  onPress={() => selectComposerEmoji(emoji)}
                >
                  <Text style={styles.emojiText}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      ) : null}

      <Modal
        visible={attachmentVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAttachmentVisible(false)}
        statusBarTranslucent
        navigationBarTranslucent
      >
        <Pressable
          style={[
            styles.cameraPickerOverlay,
            { paddingBottom: 16 + insets.bottom },
          ]}
          onPress={() => setAttachmentVisible(false)}
        >
          <Pressable
            style={styles.cameraPickerSheet}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.cameraPickerGrid}>
              {attachmentActions.map((action) => (
                <Pressable
                  key={action.key}
                  style={styles.cameraPickerGridItem}
                  onPress={action.onPress}
                >
                  <View style={styles.cameraPickerGridIconCircle}>
                    <Ionicons
                      name={action.icon}
                      size={28}
                      color={action.color}
                    />
                  </View>
                  <Text style={styles.cameraPickerGridLabel} numberOfLines={1}>
                    {action.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              style={[styles.cameraPickerAction, styles.cameraPickerCancel]}
              onPress={() => setAttachmentVisible(false)}
            >
              <Text style={styles.cameraPickerCancelText}>{pt.cancel}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={!!actionMessage}
        transparent
        animationType="fade"
        onRequestClose={() => setActionMessage(null)}
      >
        <Pressable style={styles.centerOverlay} onPress={() => setActionMessage(null)}>
          <View style={styles.actionCard}>
            <View style={styles.quickReactions}>
              {QUICK_REACTIONS.map((emoji) => (
                <Pressable
                  key={emoji}
                  style={styles.reactionBtn}
                  onPress={() => void handleAction(`react:${emoji}`)}
                >
                  <Text style={styles.reactionEmoji}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
            {[
              ['reply-outline', 'Responder', 'reply'],
              ['copy-outline', 'Copiar', 'copy'],
              ['download-outline', 'Abrir arquivo', 'download'],
              ['create-outline', 'Editar', 'edit'],
              ['time-outline', 'Histórico', 'history'],
              ['trash-outline', 'Apagar', 'delete'],
            ].map(([icon, label, action]) => {
              const target = actionMessage;
              const own = !!target && target.user?.id === currentUserId;
              if ((action === 'edit' || action === 'delete') && !own) return null;
              if (action === 'download' && (!target || !getMediaUrl(target))) {
                return null;
              }
              return (
                <Pressable
                  key={action as string}
                  style={styles.actionItem}
                  onPress={() => void handleAction(action as string)}
                >
                  <Ionicons
                    name={icon as keyof typeof Ionicons.glyphMap}
                    size={21}
                    color={
                      action === 'delete' ? colors.error : colors.onSurface
                    }
                  />
                  <Text
                    style={[
                      styles.actionText,
                      action === 'delete' && styles.actionTextDanger,
                    ]}
                  >
                    {label as string}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={contactsVisible} animationType="slide" onRequestClose={() => setContactsVisible(false)}>
        <View style={[styles.fullModal, { paddingTop: insets.top + 12 }]}>
          <View style={styles.fullModalHeader}>
            <Text style={styles.fullModalTitle}>Selecionar contato</Text>
            <Pressable onPress={() => setContactsVisible(false)}>
              <Ionicons name="close" size={24} color={colors.grey700} />
            </Pressable>
          </View>
          <FlatList
            data={contacts}
            keyExtractor={(item) => item.contact_id}
            renderItem={({ item }) => (
              <Pressable style={styles.memberRow} onPress={() => void sendContact(item)}>
                <AppAvatar uri={item.photo ?? null} size={42} />
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName} numberOfLines={1}>
                    {[item.name, item.last_name].filter(Boolean).join(' ')}
                  </Text>
                  <Text style={styles.memberSub} numberOfLines={1}>
                    {item.phone_partial ?? item.email_partial ?? 'Contato'}
                  </Text>
                </View>
              </Pressable>
            )}
          />
        </View>
      </Modal>

      <Modal visible={infoVisible} animationType="slide" onRequestClose={() => setInfoVisible(false)}>
        <View style={[styles.fullModal, { paddingTop: insets.top + 12 }]}>
          <View style={styles.fullModalHeader}>
            <Text style={styles.fullModalTitle}>
              {isGroup ? 'Informações do grupo' : 'Informações'}
            </Text>
            <Pressable onPress={() => setInfoVisible(false)}>
              <Ionicons name="close" size={24} color={colors.grey700} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.infoContent}>
            <AppAvatar
              uri={conversationPhoto}
              size={86}
              iconName={isGroup ? 'people' : 'person'}
              style={styles.infoAvatar}
            />
            <Text style={styles.infoTitle}>{conversationTitle}</Text>
            {canEditGroup ? (
              <View style={styles.groupEditRow}>
                <TextInput
                  style={styles.groupEditInput}
                  value={groupNameDraft}
                  onChangeText={setGroupNameDraft}
                  placeholder="Nome do grupo"
                  placeholderTextColor={colors.grey500}
                />
                <Pressable style={styles.groupSaveBtn} onPress={updateGroupName}>
                  <Ionicons name="checkmark" size={22} color={colors.onPrimary} />
                </Pressable>
              </View>
            ) : null}
            {infoActionError ? (
              <View style={styles.infoErrorBox}>
                <Ionicons
                  name="alert-circle-outline"
                  size={18}
                  color={colors.error}
                />
                <Text style={styles.infoErrorText}>{infoActionError}</Text>
              </View>
            ) : null}
            {isGroup ? (
              <View style={styles.infoSection}>
                <Text style={styles.infoSectionTitle}>
                  Membros ({groupMembers.length})
                </Text>
                {groupMembers.map((member) => {
                  const removing = removingMemberId === member.user_id;
                  const transferring = transferringLeaderId === member.user_id;
                  const openingDirect = openingMemberDirectId === member.user_id;
                  const actionDisabled = infoActionLoading;

                  return (
                    <View key={member.user_id} style={styles.memberRow}>
                      <AppAvatar uri={member.photo} size={42} />
                      <View style={styles.memberInfo}>
                        <Text style={styles.memberName} numberOfLines={1}>
                          {member.name}
                        </Text>
                        <Text style={styles.memberSub}>
                          {member.role === INTERNAL_CHAT_PARTICIPANT_ROLE.leader
                            ? 'Líder'
                            : member.email || member.sector || 'Membro'}
                        </Text>
                      </View>
                      {member.user_id !== currentUserId ? (
                        <Pressable
                          style={[
                            styles.memberIconBtn,
                            actionDisabled && styles.memberIconBtnDisabled,
                          ]}
                          onPress={() => void openDirectFromMember(member)}
                          disabled={actionDisabled}
                        >
                          {openingDirect ? (
                            <ActivityIndicator
                              size="small"
                              color={colors.primary}
                            />
                          ) : (
                            <Ionicons
                              name="chatbubble-outline"
                              size={19}
                              color={colors.primary}
                            />
                          )}
                        </Pressable>
                      ) : null}
                      {canManageGroupMembers &&
                      member.user_id !== currentUserId ? (
                        <Pressable
                          style={[
                            styles.memberIconBtn,
                            actionDisabled && styles.memberIconBtnDisabled,
                          ]}
                          onPress={() => requestRemoveGroupMember(member)}
                          disabled={actionDisabled}
                        >
                          {removing ? (
                            <ActivityIndicator size="small" color={colors.error} />
                          ) : (
                            <Ionicons
                              name="person-remove-outline"
                              size={19}
                              color={colors.error}
                            />
                          )}
                        </Pressable>
                      ) : null}
                      {canTransferLeader && member.user_id !== currentUserId ? (
                        <Pressable
                          style={[
                            styles.memberIconBtn,
                            actionDisabled && styles.memberIconBtnDisabled,
                          ]}
                          onPress={() => requestTransferGroupLeader(member)}
                          disabled={actionDisabled}
                        >
                          {transferring ? (
                            <ActivityIndicator
                              size="small"
                              color={colors.warning}
                            />
                          ) : (
                            <Ionicons
                              name="ribbon-outline"
                              size={19}
                              color={colors.warning}
                            />
                          )}
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
                {canManageGroupMembers ? (
                  <View style={styles.availableUsersSection}>
                    <Pressable
                      style={styles.addMemberBtn}
                      onPress={() => void loadUsers({ page: 1, append: false })}
                    >
                      <Ionicons
                        name="person-add-outline"
                        size={20}
                        color={colors.primary}
                      />
                      <Text style={styles.addMemberText}>
                        Carregar usuários para adicionar
                      </Text>
                    </Pressable>
                    {state.users
                      .filter(
                        (user) =>
                          !groupMembers.some(
                            (member) => member.user_id === user.user_id
                          )
                      )
                      .slice(0, 12)
                      .map((user) => (
                        <Pressable
                          key={user.user_id}
                          style={styles.memberRow}
                          onPress={() =>
                            void addGroupMember(conversationId, user.user_id)
                          }
                        >
                          <AppAvatar uri={user.photo} size={38} />
                          <View style={styles.memberInfo}>
                            <Text style={styles.memberName} numberOfLines={1}>
                              {user.name}
                            </Text>
                            <Text style={styles.memberSub} numberOfLines={1}>
                              {user.email ?? user.sector ?? 'Usuário'}
                            </Text>
                          </View>
                          <Ionicons
                            name="add-circle"
                            size={22}
                            color={colors.primary}
                          />
                        </Pressable>
                      ))}
                  </View>
                ) : null}
              </View>
            ) : null}
            <Pressable
              style={[
                styles.closeConversationBtn,
                infoActionLoading && styles.closeConversationBtnDisabled,
              ]}
              onPress={closeOrLeave}
              disabled={infoActionLoading}
            >
              {leavingConversation ? (
                <ActivityIndicator color={colors.error} />
              ) : (
                <Ionicons name="exit-outline" size={20} color={colors.error} />
              )}
              <Text style={styles.closeConversationText}>
                {leavingConversation
                  ? isGroup
                    ? 'Saindo...'
                    : 'Fechando...'
                  : isGroup
                    ? 'Sair do grupo'
                    : 'Fechar conversa'}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      <BottomSheetModal
        visible={pendingGroupAction !== null}
        onClose={closePendingGroupAction}
        title={pendingGroupActionContent.title}
        cardStyle={styles.confirmSheetCard}
        footerStyle={styles.confirmSheetFooter}
        avoidKeyboard={false}
        footer={
          <>
            <Pressable
              style={[
                styles.secondaryBtn,
                memberActionLoading && styles.confirmBtnDisabled,
              ]}
              onPress={closePendingGroupAction}
              disabled={memberActionLoading}
            >
              <Text style={styles.secondaryBtnText}>{pt.cancel}</Text>
            </Pressable>
            <Pressable
              style={[
                styles.confirmBtn,
                pendingGroupActionContent.danger && styles.confirmBtnDanger,
                memberActionLoading && styles.confirmBtnDisabled,
              ]}
              onPress={() => void confirmPendingGroupAction()}
              disabled={memberActionLoading}
            >
              {memberActionLoading ? (
                <>
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                  <Text style={styles.confirmBtnText}>
                    {pendingGroupActionContent.loadingText}
                  </Text>
                </>
              ) : (
                <Text style={styles.confirmBtnText}>
                  {pendingGroupActionContent.confirmText}
                </Text>
              )}
            </Pressable>
          </>
        }
      >
        <Text style={styles.confirmSheetMessage}>
          {pendingGroupActionContent.message}
        </Text>
        {groupActionError ? (
          <View style={styles.confirmErrorBox}>
            <Ionicons
              name="alert-circle-outline"
              size={18}
              color={colors.error}
            />
            <Text style={styles.confirmErrorText}>{groupActionError}</Text>
          </View>
        ) : null}
      </BottomSheetModal>

      <Modal visible={searchVisible} animationType="slide" onRequestClose={() => setSearchVisible(false)}>
        <View style={[styles.fullModal, { paddingTop: insets.top + 12 }]}>
          <View style={styles.fullModalHeader}>
            <Text style={styles.fullModalTitle}>Buscar mensagens</Text>
            <Pressable onPress={() => setSearchVisible(false)}>
              <Ionicons name="close" size={24} color={colors.grey700} />
            </Pressable>
          </View>
          <View style={styles.searchModalRow}>
            <TextInput
              style={styles.searchModalInput}
              value={searchTerm}
              onChangeText={setSearchTerm}
              placeholder="Pesquisar"
              placeholderTextColor={colors.grey500}
              returnKeyType="search"
              onSubmitEditing={runSearch}
            />
            <Pressable style={styles.searchModalBtn} onPress={runSearch}>
              <Ionicons name="search" size={20} color={colors.onPrimary} />
            </Pressable>
          </View>
          <FlatList
            data={searchResults}
            keyExtractor={(item) => item.message_id}
            renderItem={({ item }) => (
              <Pressable style={styles.searchResultRow} onPress={() => setSearchVisible(false)}>
                <Text style={styles.searchResultText} numberOfLines={2}>
                  {resolveInternalChatTextTag(item.message) || 'Mensagem'}
                </Text>
                <Text style={styles.searchResultDate}>
                  {formatDateSeparator(item.date)}
                </Text>
              </Pressable>
            )}
          />
        </View>
      </Modal>

      <Modal visible={historyVisible} animationType="slide" onRequestClose={() => setHistoryVisible(false)}>
        <View style={[styles.fullModal, { paddingTop: insets.top + 12 }]}>
          <View style={styles.fullModalHeader}>
            <Text style={styles.fullModalTitle}>Histórico</Text>
            <Pressable onPress={() => setHistoryVisible(false)}>
              <Ionicons name="close" size={24} color={colors.grey700} />
            </Pressable>
          </View>
          <FlatList
            data={historyItems}
            keyExtractor={(item, index) => `${item.kind}-${item.date}-${index}`}
            renderItem={({ item }) => (
              <View style={styles.historyRow}>
                <Text style={styles.historyKind}>{item.kind}</Text>
                <Text style={styles.historyText}>{item.message || '-'}</Text>
                <Text style={styles.searchResultDate}>
                  {formatDateSeparator(item.date)} {formatMessageTime(item.date)}
                </Text>
              </View>
            )}
          />
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#ECE5DD',
  },
  header: {
    minHeight: 64,
    paddingHorizontal: 10,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey200,
  },
  headerContact: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  headerTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    color: colors.onSurface,
    fontSize: 16,
    fontWeight: '800',
  },
  headerSubtitle: {
    color: colors.grey600,
    fontSize: 12,
    marginTop: 2,
  },
  messagesContent: {
    paddingHorizontal: 10,
    paddingVertical: 12,
    flexGrow: 1,
  },
  loadOlderBtn: {
    alignSelf: 'center',
    minHeight: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  loadOlderText: {
    color: colors.primary,
    fontWeight: '800',
    fontSize: 12,
  },
  initialMessagesLoading: {
    position: 'absolute',
    top: 78,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20,
  },
  initialMessagesLoadingCard: {
    minHeight: 34,
    borderRadius: 17,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  initialMessagesLoadingText: {
    color: colors.onPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  dateSeparator: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.82)',
    marginVertical: 8,
  },
  dateSeparatorText: {
    color: colors.grey600,
    fontSize: 12,
    fontWeight: '700',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    marginVertical: 3,
    maxWidth: '92%',
  },
  messageRowOwn: {
    alignSelf: 'flex-end',
  },
  bubble: {
    maxWidth: '100%',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  bubbleOwn: {
    backgroundColor: colors.bubbleSent,
    borderTopRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 4,
  },
  bubbleDeleted: {
    opacity: 0.72,
  },
  senderName: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 3,
  },
  systemSenderName: {
    color: colors.grey600,
  },
  quoteBox: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    backgroundColor: 'rgba(40,101,183,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    marginBottom: 5,
  },
  quoteText: {
    color: colors.grey700,
    fontSize: 12,
  },
  messageImage: {
    width: 210,
    height: 160,
    borderRadius: 8,
    marginBottom: 5,
    backgroundColor: colors.grey200,
  },
  mediaBox: {
    minWidth: 180,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: 'rgba(40,101,183,0.08)',
    marginBottom: 5,
  },
  mediaText: {
    flex: 1,
    color: colors.onSurface,
    fontWeight: '700',
  },
  linkPreview: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.06)',
    marginBottom: 5,
  },
  linkTitle: {
    color: colors.onSurface,
    fontWeight: '800',
    fontSize: 13,
  },
  linkDescription: {
    color: colors.grey700,
    fontSize: 12,
    marginTop: 3,
  },
  messageText: {
    color: colors.onSurface,
    fontSize: 15,
    lineHeight: 20,
  },
  messageDeletedText: {
    color: colors.grey600,
    fontStyle: 'italic',
  },
  messageMeta: {
    marginTop: 3,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 6,
  },
  metaText: {
    color: colors.bubbleSentTime,
    fontSize: 10,
  },
  errorMetaText: {
    color: colors.error,
    fontSize: 10,
    fontWeight: '800',
  },
  reactionsRow: {
    flexDirection: 'row',
    gap: 3,
    marginTop: 4,
  },
  replyBar: {
    minHeight: 54,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: colors.grey200,
    gap: 9,
  },
  replyAccent: {
    width: 4,
    height: 34,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  replyContent: {
    flex: 1,
    minWidth: 0,
  },
  replyTitle: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
  },
  replyText: {
    color: colors.grey700,
    fontSize: 12,
    marginTop: 2,
  },
  composer: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.grey200,
    overflow: 'visible',
  },
  composerRecording: {
    alignItems: 'center',
  },
  plusActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.grey200,
  },
  inputStack: {
    flex: 1,
    position: 'relative',
  },
  composerInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingRight: 46,
    paddingVertical: 10,
    backgroundColor: colors.inputBg,
    color: colors.onSurface,
    fontSize: 15,
  },
  emojiInputBtn: {
    position: 'absolute',
    right: 10,
    top: '50%',
    marginTop: -14,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiInputBtnActive: {
    backgroundColor: 'rgba(40, 101, 183, 0.1)',
  },
  composerActionsWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    overflow: 'visible',
  },
  composerActionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  micActionBtn: {
    backgroundColor: '#2563EB',
  },
  micActionBtnRecording: {
    backgroundColor: '#EF4444',
  },
  micActionBtnLarge: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  micGestureWrap: {
    position: 'relative',
  },
  micLockHintPill: {
    position: 'absolute',
    right: 0,
    bottom: 54,
    width: 44,
    paddingVertical: 6,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(47, 43, 61, 0.16)',
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
  composerEmojiPickerWrap: {
    borderTopWidth: 1,
    borderTopColor: colors.grey200,
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: Platform.OS === 'ios' ? 10 : 6,
  },
  composerEmojiPickerCard: {
    borderRadius: 16,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 12 : 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(47, 43, 61, 0.16)',
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  emojiBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.grey100,
  },
  emojiText: {
    fontSize: 22,
  },
  recordingComposerWrap: {
    flex: 1,
    minHeight: 48,
    borderRadius: 22,
    backgroundColor: colors.inputBg,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recordingLiveMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  recordingLockedCenter: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  recordingMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recordingTimeText: {
    color: colors.onSurface,
    fontSize: 13,
    fontWeight: '600',
    minWidth: 40,
  },
  recordingWaveformTrack: {
    flex: 1,
    minWidth: 0,
    height: 28,
    borderRadius: 12,
    backgroundColor: 'rgba(40, 101, 183, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    overflow: 'hidden',
  },
  recordingWaveformBar: {
    width: 2,
    minHeight: 4,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  recordActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
  },
  recordSendBtn: {
    backgroundColor: colors.primary,
  },
  recordingHintWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  recordingHintText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '500',
  },
  recordingHoldOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: 20,
    backgroundColor: colors.inputBg,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  recordingHoldLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  recordingHoldTime: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: '600',
    minWidth: 46,
  },
  recordingHoldCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  recordingHoldCancelText: {
    color: colors.grey600,
    fontSize: 13,
    fontWeight: '600',
  },
  recordingHoldCancelTextArmed: {
    color: '#EF4444',
  },
  recordingHoldRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
  },
  recordingBar: {
    minHeight: 66,
    paddingHorizontal: 14,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    gap: 12,
  },
  recordAction: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.error,
  },
  recordingDotPaused: {
    opacity: 0.45,
    backgroundColor: colors.grey500,
  },
  recordingText: {
    color: colors.onSurface,
    fontWeight: '800',
  },
  recordSend: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  centerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  cameraPickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  cameraPickerSheet: {
    borderRadius: 14,
    backgroundColor: colors.surface,
    paddingTop: 14,
    paddingHorizontal: 10,
    paddingBottom: 8,
    gap: 10,
  },
  cameraPickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  cameraPickerGridItem: {
    width: '25%',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginBottom: 14,
    paddingHorizontal: 2,
  },
  cameraPickerGridIconCircle: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F3F5',
  },
  cameraPickerGridLabel: {
    marginTop: 7,
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  cameraPickerAction: {
    height: 46,
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(47, 43, 61, 0.08)',
  },
  cameraPickerCancel: {
    justifyContent: 'center',
    backgroundColor: 'rgba(47, 43, 61, 0.08)',
  },
  cameraPickerCancelText: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: '600',
  },
  actionCard: {
    width: '100%',
    borderRadius: 14,
    backgroundColor: colors.surface,
    padding: 10,
  },
  quickReactions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  reactionBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: colors.grey100,
  },
  reactionEmoji: {
    fontSize: 22,
  },
  actionItem: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 8,
  },
  actionText: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: '700',
  },
  actionTextDanger: {
    color: colors.error,
  },
  fullModal: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  fullModalHeader: {
    minHeight: 54,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.grey200,
  },
  fullModalTitle: {
    color: colors.onSurface,
    fontSize: 17,
    fontWeight: '800',
  },
  confirmSheetCard: {
    maxHeight: '45%',
  },
  confirmSheetFooter: {
    paddingTop: 14,
  },
  confirmSheetMessage: {
    color: colors.onSurface,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  confirmErrorBox: {
    minHeight: 40,
    borderRadius: 10,
    marginBottom: 16,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFF0F0',
  },
  confirmErrorText: {
    flex: 1,
    color: colors.error,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  secondaryBtn: {
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.grey300,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  secondaryBtnText: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: '600',
  },
  confirmBtn: {
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
  },
  confirmBtnDanger: {
    backgroundColor: colors.error,
  },
  confirmBtnDisabled: {
    opacity: 0.65,
  },
  confirmBtnText: {
    color: colors.onPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  memberRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey100,
  },
  memberInfo: {
    flex: 1,
    minWidth: 0,
  },
  memberName: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: '800',
  },
  memberSub: {
    color: colors.grey600,
    fontSize: 12,
    marginTop: 2,
  },
  infoContent: {
    paddingBottom: 30,
  },
  infoAvatar: {
    alignSelf: 'center',
    marginTop: 24,
    marginBottom: 12,
  },
  infoTitle: {
    alignSelf: 'center',
    color: colors.onSurface,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 14,
  },
  groupEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    gap: 8,
    marginBottom: 18,
  },
  groupEditInput: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: colors.inputBg,
    paddingHorizontal: 12,
    color: colors.onSurface,
  },
  groupSaveBtn: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  infoSection: {
    marginTop: 8,
  },
  infoErrorBox: {
    marginHorizontal: 16,
    marginBottom: 10,
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFF0F0',
  },
  infoErrorText: {
    flex: 1,
    color: colors.error,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  infoSectionTitle: {
    color: colors.grey700,
    fontSize: 13,
    fontWeight: '800',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  memberIconBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberIconBtnDisabled: {
    opacity: 0.55,
  },
  addMemberBtn: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  addMemberText: {
    color: colors.primary,
    fontWeight: '800',
  },
  availableUsersSection: {
    borderTopWidth: 1,
    borderTopColor: colors.grey100,
  },
  closeConversationBtn: {
    marginHorizontal: 16,
    marginTop: 18,
    minHeight: 48,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFF0F0',
  },
  closeConversationBtnDisabled: {
    opacity: 0.7,
  },
  closeConversationText: {
    color: colors.error,
    fontWeight: '800',
  },
  searchModalRow: {
    flexDirection: 'row',
    gap: 8,
    padding: 16,
  },
  searchModalInput: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: colors.inputBg,
    paddingHorizontal: 12,
    color: colors.onSurface,
  },
  searchModalBtn: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  searchResultRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey100,
  },
  searchResultText: {
    color: colors.onSurface,
    fontSize: 14,
  },
  searchResultDate: {
    color: colors.grey500,
    fontSize: 12,
    marginTop: 4,
  },
  historyRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey100,
  },
  historyKind: {
    color: colors.primary,
    fontWeight: '800',
    marginBottom: 4,
  },
  historyText: {
    color: colors.onSurface,
    fontSize: 14,
  },
});
