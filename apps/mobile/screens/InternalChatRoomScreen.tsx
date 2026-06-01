import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
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

type Navigation = NativeStackNavigationProp<InternalChatStackParamList>;
type ScreenRoute = RouteProp<InternalChatStackParamList, 'InternalChatRoom'>;

const MAX_DOCUMENT_SIZE_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_SIZE_BYTES = 16 * 1024 * 1024;
const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024;
const MAX_AUDIO_SIZE_BYTES = 16 * 1024 * 1024;
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const URL_PATTERN = /(https?:\/\/[^\s]+)/i;

function formatMessageTime(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
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
  const content = message.content;
  if (message.deleted) return 'Mensagem apagada';
  if (content?.message) return content.message;
  if (content?.image) return content.image.caption || '[Imagem]';
  if (content?.video) return content.video.caption || '[Video]';
  if (content?.audio) return '[Audio]';
  if (content?.document) return content.document.name || '[Documento]';
  if (content?.location) return content.location.name || '[Localizacao]';
  if (content?.contact) return content.contact.name || '[Contato]';
  if (content?.contacts) return '[Contatos]';
  if (content?.type === INTERNAL_MESSAGE_TYPE.system) return 'Atualização do grupo';
  return '';
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
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);

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
  const [sending, setSending] = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState(
    activeConversation.name ?? ''
  );
  const [canUpdateGroup, setCanUpdateGroup] = useState(false);
  const [canManageMembers, setCanManageMembers] = useState(false);
  const [canTransferLeader, setCanTransferLeader] = useState(false);

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

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  const sendText = useCallback(async () => {
    const text = composerText.trim();
    if (!text || sending) return;

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

  const pickImage = useCallback(async () => {
    setAttachmentVisible(false);
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
    const asset = result.assets[0];
    if (!assertFileSize(asset.fileSize, MAX_IMAGE_SIZE_BYTES)) return;
    const name = asset.fileName || getFileNameFromUri(asset.uri, 'imagem.jpg');
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
  }, [sendUpload]);

  const pickVideo = useCallback(async () => {
    setAttachmentVisible(false);
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
    const asset = result.assets[0];
    if (!assertFileSize(asset.fileSize, MAX_VIDEO_SIZE_BYTES)) return;
    const name = asset.fileName || getFileNameFromUri(asset.uri, 'video.mp4');
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
  }, [sendUpload]);

  const pickDocument = useCallback(async () => {
    setAttachmentVisible(false);
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

  const startRecording = useCallback(async () => {
    if (recording) return;
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(pt.warning_title, pt.microphone_permission_denied);
      return;
    }
    try {
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: 'duckOthers',
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
        allowsBackgroundRecording: false,
      });
      await recorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
      recorder.record();
      setRecording(true);
      void publishActivity(conversationId, INTERNAL_CHAT_ACTIVITY_STATE.recording);
    } catch {
      Alert.alert(pt.error_title, pt.audio_recording_error);
    }
  }, [conversationId, publishActivity, recorder, recording]);

  const cancelRecording = useCallback(async () => {
    try {
      await recorder.stop();
    } catch {}
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(
      () => {}
    );
    setRecording(false);
    void publishActivity(conversationId, INTERNAL_CHAT_ACTIVITY_STATE.available);
  }, [conversationId, publishActivity, recorder]);

  const sendRecording = useCallback(async () => {
    if (!recording) return;
    const durationSec = Math.max(1, Math.round((recorderState.durationMillis || 0) / 1000));
    try {
      await recorder.stop();
    } catch {}
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(
      () => {}
    );
    const uri = recorder.uri ?? recorderState.url;
    setRecording(false);
    void publishActivity(conversationId, INTERNAL_CHAT_ACTIVITY_STATE.available);
    if (!uri) return;
    const name = getFileNameFromUri(uri, `audio-${Date.now()}.m4a`);
    const mimeType = getMimeTypeFromName(name, 'audio/mp4');
    await sendUpload({
      type: INTERNAL_MESSAGE_TYPE.audio,
      field: 'audios',
      file: { uri, name, mimeType },
      content: {
        type: INTERNAL_MESSAGE_TYPE.audio,
        audio: { url: uri, name, mimetype: mimeType, duration: durationSec, ptt: true },
      },
    });
  }, [
    conversationId,
    publishActivity,
    recorder,
    recorderState.durationMillis,
    recorderState.url,
    recording,
    sendUpload,
  ]);

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

  const closeOrLeave = useCallback(async () => {
    const ok = await closeConversation(conversationId);
    if (ok) navigation.goBack();
  }, [closeConversation, conversationId, navigation]);

  const updateGroupName = useCallback(async () => {
    const normalized = groupNameDraft.trim();
    if (!normalized) return;
    const updated = await updateGroup(conversationId, { name: normalized });
    if (!updated) Alert.alert(pt.error_title, 'Não foi possível atualizar o grupo.');
  }, [conversationId, groupNameDraft, updateGroup]);

  const openDirectFromMember = useCallback(
    async (member: InternalChatParticipant) => {
      const conversation = await openDirect(member.user_id);
      if (conversation) {
        setInfoVisible(false);
        navigation.push('InternalChatRoom', { conversation });
      }
    },
    [navigation, openDirect]
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
                <Text style={styles.senderName}>{item.user?.name ?? 'Usuário'}</Text>
              ) : null}
              {content?.quoted ? (
                <View style={styles.quoteBox}>
                  <Text style={styles.quoteText} numberOfLines={2}>
                    {content.quoted.message || content.quoted.type || 'Resposta'}
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

      {recording ? (
        <View style={styles.recordingBar}>
          <Pressable onPress={cancelRecording} style={styles.recordAction}>
            <Ionicons name="trash-outline" size={22} color={colors.error} />
          </Pressable>
          <View style={styles.recordingCenter}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingText}>
              {Math.round((recorderState.durationMillis || 0) / 1000)}s
            </Text>
          </View>
          <Pressable onPress={sendRecording} style={styles.recordSend}>
            <Ionicons name="send" size={20} color={colors.onPrimary} />
          </Pressable>
        </View>
      ) : (
        <View style={[styles.composer, { paddingBottom: insets.bottom + 8 }]}>
          <Pressable
            style={styles.iconBtn}
            onPress={() => setAttachmentVisible(true)}
            accessibilityLabel={pt.open_attachments}
          >
            <Ionicons name="add" size={26} color={colors.primary} />
          </Pressable>
          <TextInput
            style={styles.composerInput}
            value={composerText}
            onChangeText={setComposerText}
            placeholder={pt.type_message}
            placeholderTextColor={colors.grey500}
            multiline
          />
          {composerText.trim() ? (
            <Pressable
              style={styles.sendBtn}
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
            <Pressable
              style={styles.iconBtn}
              onPress={startRecording}
              accessibilityLabel="Gravar áudio"
            >
              <Ionicons name="mic" size={24} color={colors.primary} />
            </Pressable>
          )}
        </View>
      )}

      <Modal
        visible={attachmentVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAttachmentVisible(false)}
      >
        <Pressable
          style={styles.centerOverlay}
          onPress={() => setAttachmentVisible(false)}
        >
          <View style={styles.attachmentCard}>
            {[
              ['image-outline', 'Imagem', pickImage],
              ['videocam-outline', 'Vídeo', pickVideo],
              ['document-text-outline', 'Documento', pickDocument],
              ['musical-notes-outline', 'Áudio', pickAudioFile],
              ['location-outline', 'Localização', sendCurrentLocation],
              ['person-circle-outline', 'Contato', openContactPicker],
            ].map(([icon, label, handler]) => (
              <Pressable
                key={label as string}
                style={styles.attachmentItem}
                onPress={handler as () => void}
              >
                <Ionicons
                  name={icon as keyof typeof Ionicons.glyphMap}
                  size={24}
                  color={colors.primary}
                />
                <Text style={styles.attachmentText}>{label as string}</Text>
              </Pressable>
            ))}
          </View>
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
            {isGroup ? (
              <View style={styles.infoSection}>
                <Text style={styles.infoSectionTitle}>
                  Membros ({groupMembers.length})
                </Text>
                {groupMembers.map((member) => (
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
                        style={styles.memberIconBtn}
                        onPress={() => void openDirectFromMember(member)}
                      >
                        <Ionicons name="chatbubble-outline" size={19} color={colors.primary} />
                      </Pressable>
                    ) : null}
                    {canManageGroupMembers && member.user_id !== currentUserId ? (
                      <Pressable
                        style={styles.memberIconBtn}
                        onPress={() =>
                          void removeGroupMember(conversationId, member.user_id)
                        }
                      >
                        <Ionicons name="person-remove-outline" size={19} color={colors.error} />
                      </Pressable>
                    ) : null}
                    {canTransferLeader && member.user_id !== currentUserId ? (
                      <Pressable
                        style={styles.memberIconBtn}
                        onPress={() =>
                          void transferGroupLeader(conversationId, member.user_id)
                        }
                      >
                        <Ionicons name="ribbon-outline" size={19} color={colors.warning} />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
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
            <Pressable style={styles.closeConversationBtn} onPress={closeOrLeave}>
              <Ionicons name="exit-outline" size={20} color={colors.error} />
              <Text style={styles.closeConversationText}>
                {isGroup ? 'Sair do grupo' : 'Fechar conversa'}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

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
                  {item.message || 'Mensagem'}
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
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 8,
    paddingTop: 8,
    backgroundColor: colors.surface,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF5FF',
  },
  composerInput: {
    flex: 1,
    maxHeight: 120,
    minHeight: 42,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 11 : 8,
    color: colors.onSurface,
    backgroundColor: colors.inputBg,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
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
  attachmentCard: {
    width: '100%',
    borderRadius: 14,
    backgroundColor: colors.surface,
    padding: 10,
  },
  attachmentItem: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 10,
  },
  attachmentText: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: '700',
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
