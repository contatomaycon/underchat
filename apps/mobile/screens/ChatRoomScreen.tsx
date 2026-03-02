import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactElement,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Image,
  Linking,
  Animated,
  Modal,
  ActivityIndicator,
  PanResponder,
  Easing,
  Alert,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatStackParamList } from '../navigation/types';
import {
  type ListChatsResult,
  type ListMessageResult,
  type ChatLabel,
  type MessageContent,
  type MessageContentContact,
  type MessageContentDocument,
  type MessageContentLinkPreview,
  type MessageContextExternalAdReply,
  type MessageQuoted,
  type MessageReaction,
  type MessageTemplateButton,
  type MessageContentVideo,
  ETypeUserChat,
} from '../types/chat';
import {
  createAudioPlayer,
  type AudioPlayer,
  useAudioRecorder,
  useAudioRecorderState,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  RecordingPresets,
} from 'expo-audio';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Directory, File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import {
  listMessages,
  createMessage,
  createMessageWithFormData,
  clearChatSummary,
  updateChatStatusDetailed,
  transferChat,
  listTransferOptions,
  listTransferUsers,
  listTransferSectors,
  listTransferSectorUsers,
  listLabelTemplates,
  updateChatLabel,
  searchMessages,
  updateForwardToOutputChatbot,
  viewWorkerConfigForChat,
  searchChats,
  type LabelTemplate,
  type ChatUserStatus,
  type WorkerConfigForChat,
  type TransferChatPayload,
  type TransferUserOption,
  type TransferSectorOption,
  listChatContacts,
  type ListChatContactResult,
  getChatContactById,
  getChatContactPhoneDecrypted,
  getChatContactByPhone,
  type ChatContactLookupResult,
} from '../api/chatApi';
import {
  addChatSocketListener,
  consumePendingChatUpdates,
  consumePendingMessages,
  type SocketTypingPayload,
  type SocketChatPayload,
  type SocketMessagePayload,
} from '../socket/chatSocket';
import { getUser, getPermissions, getSectors } from '../storage/authStorage';
import {
  canPreviewChatContent,
  canViewAttendanceHistory,
  canCloseChatWithoutAttending,
  canPickQueueChat,
  canReopenChat,
  canToggleForwardToOutputChatbot,
} from '../constants/chatAuthorization';
import { useChatFilter } from '../context/ChatFilterContext';
import { AppAvatar } from '../components/AppAvatar';
import { pt } from '../locales/pt';
import { colors } from '../theme/colors';
import { resolveImageUri } from '../utils/imageUri';

function decodeBase64Waveform(base64: string): number[] | null {
  try {
    if (typeof globalThis.atob !== 'function') return null;
    const binary = globalThis.atob(base64);
    const out: number[] = [];
    for (let i = 0; i < binary.length; i++) {
      out.push(binary.charCodeAt(i));
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function normalizeWaveformValues(arr: number[]): number[] {
  return arr.map((v) => Math.max(0.15, Math.min(1, v / 100)));
}

function parseWaveform(
  waveform: string | number[] | null | undefined
): number[] | null {
  if (!waveform) return null;
  if (typeof waveform === 'string') {
    const decoded = decodeBase64Waveform(waveform);
    return decoded && decoded.length > 0
      ? normalizeWaveformValues(decoded)
      : null;
  }
  if (Array.isArray(waveform) && waveform.length > 0) {
    return normalizeWaveformValues(waveform);
  }
  return null;
}

function formatAudioTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function isExpoGoEnvironment(): boolean {
  const constants = Constants as {
    appOwnership?: string | null;
    executionEnvironment?: string | null;
  };
  return (
    constants.appOwnership === 'expo' ||
    constants.executionEnvironment === 'storeClient'
  );
}

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return fallback;
}

function createClientMessageHash(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeRecordingMetering(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0.2;
  }
  const clamped = Math.max(-60, Math.min(0, value));
  const normalized = (clamped + 60) / 60;
  return Math.max(0.15, normalized);
}

function resolveMimeTypeFromExtension(extension: string): string {
  const ext = extension.replace(/^\./, '').toLowerCase();
  if (ext === 'ogg' || ext === 'opus') return 'audio/ogg';
  if (ext === 'aac') return 'audio/aac';
  if (ext === 'amr') return 'audio/amr';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'm4a' || ext === 'mp4') return 'audio/mp4';
  return 'audio/mp4';
}

async function appendMediaToFormData(
  formData: FormData,
  fieldName: string,
  file: {
    uri: string;
    name: string;
    mimeType: string;
  }
): Promise<void> {
  if (Platform.OS === 'web') {
    const response = await fetch(file.uri);
    const blob = await response.blob();
    formData.append(fieldName, blob, file.name);
    return;
  }

  formData.append(fieldName, {
    uri: file.uri,
    name: file.name,
    type: file.mimeType,
  } as unknown as Blob);
}

const WAVEFORM_BAR_WIDTH = 2;
const WAVEFORM_BAR_GAP = 2;
const WAVEFORM_HORIZONTAL_INSET = 2;
const WAVEFORM_FALLBACK_MAX_BARS = 28;
const VIDEO_FULLSCREEN_DISABLED = { enable: false } as const;
const VIDEO_FULLSCREEN_ENABLED = { enable: true } as const;
const CHAT_MESSAGES_PER_PAGE = 10;
const CHAT_SOCKET_SYNC_PER_PAGE = 20;
const CHAT_SOCKET_SYNC_INTERVAL_MS = 30000;
const CHAT_SOCKET_SYNC_DEBOUNCE_MS = 5000;
const ATTENDANCE_HISTORY_SKELETON_ROWS = 6;
const ATTENDANCE_HISTORY_SKELETON_MORE_ROWS = 2;
const LOAD_OLDER_SCROLL_THRESHOLD = 180;
const SHOW_SCROLL_TO_BOTTOM_THRESHOLD = 160;
const TYPING_TIMEOUT_MS = 5000;
type RemoteActivityMode = 'typing' | 'recording';
const VOICE_LOCK_SWIPE_THRESHOLD = 70;
const VOICE_RELEASE_LOCK_GRACE_MS = 220;
const VOICE_CANCEL_SWIPE_THRESHOLD = 90;
const RECORDING_WAVEFORM_MAX_BARS = 44;
const RECORDING_WAVEFORM_MIN_BARS = 26;
const MAX_DOCUMENT_SIZE_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_SIZE_BYTES = 16 * 1024 * 1024;
const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024;
const MAX_AUDIO_SIZE_BYTES = 16 * 1024 * 1024;
const MAX_CONTACTS_SELECTED = 10;
type DownloadKind = 'image' | 'video' | 'document';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let preferredNativeDownloadDirectoryUri: string | null = null;

type ChatRoomMode = 'default' | 'history_readonly';

type ProtocolType = 'A' | 'T' | 'U';

type ProtocolWithType = {
  protocol: string;
  type: ProtocolType;
};

type ChatMenuActionKey =
  | 'protocol'
  | 'label'
  | 'attendance_history'
  | 'transfer'
  | 'search_messages'
  | 'forward_to_output_chatbot'
  | 'close_service';

type ChatMenuAction = {
  key: ChatMenuActionKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  danger?: boolean;
  active?: boolean;
  onPress: () => void;
};

type TransferDestinationType = 'user' | 'sector' | null;

type TransferPickerKind =
  | 'channel'
  | 'type'
  | 'user'
  | 'sector'
  | 'sector_user'
  | null;

type TransferChannelOption = {
  value: string;
  title: string;
  name: string;
  number: string | null;
};

type SearchMessageResultItem = {
  message_id: string;
  date: string;
  message?: string | null;
};

type AttachmentActionKey =
  | 'document'
  | 'photo'
  | 'video'
  | 'audio'
  | 'contact'
  | 'location'
  | 'annotation';

type AttachmentAction = {
  key: AttachmentActionKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onPress: () => void;
};

type LocationPickerMode = 'current' | 'manual';

function formatPhoneDigits(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 0) return value;
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  }
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
}

function formatPhoneWithDdi(
  phoneValue: string,
  phoneDdi: string | null | undefined
): string {
  const phoneDigits = normalizePhoneDigits(phoneValue);
  if (!phoneDigits) return phoneValue;

  const ddiDigits = normalizePhoneDigits(phoneDdi);
  if (!ddiDigits) {
    return formatPhoneDigits(phoneDigits);
  }

  const localDigitsRaw = phoneDigits.startsWith(ddiDigits)
    ? phoneDigits.slice(ddiDigits.length)
    : phoneDigits;
  const localDigits =
    localDigitsRaw.length > 11 ? localDigitsRaw.slice(-11) : localDigitsRaw;

  if (!localDigits) {
    return `+${ddiDigits}`;
  }

  return `+${ddiDigits} ${formatPhoneDigits(localDigits)}`;
}

function resolveProtocolTypeColor(type: ProtocolType): string {
  if (type === 'T') return colors.primary;
  if (type === 'U') return '#D97706';
  return colors.success;
}

function formatSearchResultDate(dateString: string): string {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const today = now.toDateString();
  if (date.toDateString() === today) {
    return pt.today;
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return pt.yesterday;
  }
  return date.toLocaleDateString('pt-BR');
}

function calculateAttendanceTime(
  startDate: string | null | undefined,
  endDate: string | null | undefined
): string {
  if (!startDate || !endDate) return '-';

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '-';

  const diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) return '-';

  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    const hours = diffHours % 24;
    const minutes = diffMinutes % 60;
    if (hours > 0 && minutes > 0) return `${diffDays}d ${hours}h ${minutes}min`;
    if (hours > 0) return `${diffDays}d ${hours}h`;
    return `${diffDays}d ${minutes}min`;
  }

  if (diffHours > 0) {
    const minutes = diffMinutes % 60;
    if (minutes > 0) return `${diffHours}h ${minutes}min`;
    return `${diffHours}h`;
  }

  if (diffMinutes > 0) {
    const seconds = diffSeconds % 60;
    if (seconds > 0) return `${diffMinutes}min ${seconds}s`;
    return `${diffMinutes}min`;
  }

  return `${diffSeconds}s`;
}

function fitWaveformToWidth(waveform: number[], width: number): number[] {
  if (waveform.length <= 1) return waveform;

  const usableWidth = Math.max(0, width - WAVEFORM_HORIZONTAL_INSET * 2);
  const maxBars =
    usableWidth > 0
      ? Math.max(
          8,
          Math.floor(
            (usableWidth + WAVEFORM_BAR_GAP) /
              (WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP)
          )
        )
      : WAVEFORM_FALLBACK_MAX_BARS;

  if (waveform.length <= maxBars) return waveform;

  const bucketSize = waveform.length / maxBars;
  const reduced: number[] = [];

  for (let i = 0; i < maxBars; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucketSize));
    let peak = 0;

    for (let j = start; j < end && j < waveform.length; j++) {
      peak = Math.max(peak, waveform[j] ?? 0);
    }

    reduced.push(Math.max(0.15, peak));
  }

  return reduced;
}

function ChatRoomSkeleton() {
  const opacity = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const useNative = Platform.OS !== 'web';
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 600,
          useNativeDriver: useNative,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 600,
          useNativeDriver: useNative,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  const bubble = (align: 'left' | 'right') => (
    <View
      style={[
        styles.skeletonBubbleWrap,
        align === 'right' && styles.skeletonBubbleWrapRight,
      ]}
    >
      <Animated.View
        style={[
          styles.skeletonBubble,
          align === 'right' && styles.skeletonBubbleRight,
          { opacity },
        ]}
      >
        <Animated.View
          style={[
            styles.skeletonBubbleLine,
            styles.skeletonBubbleLineWide,
            { opacity },
          ]}
        />
        <Animated.View
          style={[
            styles.skeletonBubbleLine,
            styles.skeletonBubbleLineShort,
            { opacity },
          ]}
        />
      </Animated.View>
    </View>
  );
  return (
    <View style={styles.skeletonContainer}>
      <View style={styles.dateSeparatorWrap}>
        <View style={styles.skeletonDateLine} />
        <Animated.View style={[styles.skeletonDatePill, { opacity }]} />
        <View style={styles.skeletonDateLine} />
      </View>
      {bubble('left')}
      {bubble('right')}
      {bubble('left')}
      {bubble('right')}
      {bubble('left')}
    </View>
  );
}

const EMessageType = {
  text: 'text',
  image: 'image',
  video: 'video',
  video_note: 'video_note',
  audio: 'audio',
  sticker: 'sticker',
  document: 'document',
  location: 'location',
  contact_card: 'contact_card',
  contacts: 'contacts',
  system: 'system',
  annotation: 'annotation',
  view_once: 'view_once',
} as const;

function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || bytes === 0) return '';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function sanitizeFilename(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .slice(0, 80);
}

function getExtensionFromUrl(url: string): string | null {
  const withoutQuery = url.split('?')[0]?.split('#')[0] ?? '';
  const fileName = withoutQuery.split('/').pop() ?? '';
  const match = fileName.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : null;
}

function resolveMediaUri(url: string | null | undefined): string | null {
  if (!url) return null;
  return resolveImageUri(url) ?? url;
}

function resolvePreviewThumbnail(
  value: string | null | undefined
): string | null {
  const normalized = readNonEmptyString(value);
  if (!normalized) return null;

  if (
    normalized.startsWith('http://') ||
    normalized.startsWith('https://') ||
    normalized.startsWith('data:')
  ) {
    return resolveMediaUri(normalized) ?? normalized;
  }

  return `data:image/jpeg;base64,${normalized}`;
}

function resolvePreviewImage(
  preview: MessageContentLinkPreview | null | undefined
): string | null {
  if (!preview) return null;

  return (
    resolvePreviewThumbnail(preview.originalThumbnailUrl) ??
    resolvePreviewThumbnail(preview.highQualityThumbnail) ??
    resolvePreviewThumbnail(preview.jpegThumbnail)
  );
}

function resolvePreviewUrl(
  preview: MessageContentLinkPreview | null | undefined
): string | null {
  const matched = readNonEmptyString(preview?.['matched-text']);
  const canonical = readNonEmptyString(preview?.['canonical-url']);
  return matched ?? canonical;
}

function resolveDomainFromUrl(value: string | null | undefined): string {
  const normalized = readNonEmptyString(value);
  if (!normalized) return '';

  try {
    const url = new URL(normalized);
    return url.hostname.replace(/^www\./i, '');
  } catch {
    return normalized;
  }
}

function resolveExternalSourceAppName(
  sourceApp: string | null | undefined
): string {
  const normalized = readNonEmptyString(sourceApp);
  if (!normalized) return '';
  if (normalized.toLowerCase() === 'instagram') return 'Instagram';
  if (normalized.toLowerCase() === 'facebook') return 'Facebook';
  return normalized;
}

type ContactCardDisplayData = {
  name: string;
  phone: string | null;
  photoUri: string | null;
};

function buildLocationPreviewCandidates(
  latitude: number,
  longitude: number
): string[] {
  const previewZoom = 18;
  const lat = Number(latitude.toFixed(6));
  const lng = Number(longitude.toFixed(6));
  const center = `${lat},${lng}`;

  const osm = `https://staticmap.openstreetmap.de/staticmap.php?center=${encodeURIComponent(
    center
  )}&zoom=${previewZoom}&size=600x340`;
  const yandex = `https://static-maps.yandex.ru/1.x/?lang=en-US&ll=${lng},${lat}&z=${previewZoom}&l=map&size=600,340`;
  const google = `https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(
    center
  )}&zoom=${previewZoom}&size=600x340`;

  return [osm, yandex, google];
}

async function openLocationInMaps(
  latitude: number,
  longitude: number,
  label: string | null | undefined
): Promise<void> {
  const name = (label ?? pt.location).trim() || pt.location;
  const query = `${latitude},${longitude}`;
  const webUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

  if (Platform.OS === 'android') {
    const geoUrl = `geo:${latitude},${longitude}?q=${latitude},${longitude}(${encodeURIComponent(
      name
    )})`;
    try {
      await Linking.openURL(geoUrl);
      return;
    } catch {}
  }

  if (Platform.OS === 'ios') {
    const appleMapsUrl = `http://maps.apple.com/?ll=${latitude},${longitude}&q=${encodeURIComponent(
      name
    )}`;
    try {
      await Linking.openURL(appleMapsUrl);
      return;
    } catch {}
  }

  try {
    await Linking.openURL(webUrl);
  } catch {}
}

function formatVideoDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number') return '';
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const remainingSeconds = total % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function resolveVideoMeta(
  video: MessageContentVideo | null | undefined
): string {
  if (!video) return '';
  const ext =
    (video.extension ?? '').replace(/^\./, '').toUpperCase() || 'VIDEO';
  const size = formatFileSize(video.size);
  const duration = formatVideoDuration(video.duration);
  return [ext, size, duration]
    .filter((value) => value && value.length > 0)
    .join(' • ');
}

function resolveVideoDownloadName(
  video: MessageContentVideo | null | undefined
): string {
  if (!video) return 'video.mp4';
  if (video.name && video.name.trim().length > 0) {
    return sanitizeFilename(video.name);
  }
  const ext = (video.extension ?? '').replace(/^\./, '').toLowerCase() || 'mp4';
  return `video.${ext}`;
}

function resolveDocumentDownloadName(
  document: MessageContentDocument | null | undefined
): string {
  if (document?.name && document.name.trim().length > 0) {
    return sanitizeFilename(document.name);
  }
  const ext =
    (document?.extension ?? '').replace(/^\./, '').toLowerCase() || 'pdf';
  return `documento.${ext}`;
}

function isRenderableSticker(
  sticker?: {
    url?: string | null;
    mimetype?: string | null;
    extension?: string | null;
  } | null
): boolean {
  if (!sticker?.url) return false;

  const mimetype = (sticker.mimetype ?? '').trim().toLowerCase();
  const extension = (sticker.extension ?? '')
    .replace(/^\./, '')
    .trim()
    .toLowerCase();

  if (mimetype === 'application/was' || mimetype === 'application/x-tgsticker')
    return false;

  if (extension === 'was' || extension === 'tgs' || extension === 'zip') {
    return false;
  }

  if (mimetype.startsWith('image/')) return true;
  if (extension === 'webp') return true;

  return true;
}

function resolveStickerDownloadName(msg: ListMessageResult): string {
  const sticker = msg.content?.sticker;
  const ext =
    (sticker?.extension ?? '').replace(/^\./, '').toLowerCase() || 'webp';
  return `sticker-${msg.message_id.slice(-8)}.${ext}`;
}

function resolveImageDownloadName(
  msg: ListMessageResult,
  sourceUrl: string
): string {
  const image = msg.content?.image;
  const extFromPayload = image?.extension?.replace(/^\./, '').toLowerCase();
  const extension = extFromPayload || getExtensionFromUrl(sourceUrl) || 'jpg';
  const captionName = image?.caption ? sanitizeFilename(image.caption) : '';
  const fallbackName = `imagem-${msg.message_id.slice(-8)}`;
  const baseName = captionName || fallbackName;
  return `${baseName}.${extension}`;
}

function normalizePhoneDigits(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\D/g, '');
}

function isPhoneMatch(
  firstPhone: string | null | undefined,
  secondPhone: string | null | undefined
): boolean {
  const firstDigits = normalizePhoneDigits(firstPhone);
  const secondDigits = normalizePhoneDigits(secondPhone);
  if (!firstDigits || !secondDigits) return false;
  if (firstDigits === secondDigits) return true;
  if (Math.min(firstDigits.length, secondDigits.length) < 8) return false;
  return (
    firstDigits.endsWith(secondDigits) || secondDigits.endsWith(firstDigits)
  );
}

function resolveContactCardDisplayData(
  contact: MessageContentContact,
  chatInfo: ListChatsResult | null | undefined
): ContactCardDisplayData {
  const payloadName =
    [contact.name, contact.last_name].filter(Boolean).join(' ').trim() ||
    pt.contact;
  const payloadPhone = contact.phone ?? contact.phone_partial ?? null;
  const payloadPhoto = resolveMediaUri(contact.photo) ?? null;

  const systemContact = chatInfo?.contact;
  if (!systemContact) {
    return {
      name: payloadName,
      phone: payloadPhone,
      photoUri: payloadPhoto,
    };
  }

  const hasSameContactId =
    !!contact.contact_id &&
    !!systemContact.id &&
    contact.contact_id === systemContact.id;
  const hasSamePhone =
    isPhoneMatch(contact.phone, systemContact.phone) ||
    isPhoneMatch(contact.phone_partial, systemContact.phone) ||
    isPhoneMatch(contact.phone, chatInfo?.phone) ||
    isPhoneMatch(contact.phone_partial, chatInfo?.phone);

  if (!hasSameContactId && !hasSamePhone) {
    return {
      name: payloadName,
      phone: payloadPhone,
      photoUri: payloadPhoto,
    };
  }

  return {
    name: systemContact.name?.trim() || payloadName,
    phone: systemContact.phone || payloadPhone,
    photoUri: resolveMediaUri(systemContact.photo) ?? payloadPhoto,
  };
}

function buildContactCardDisplayFromLookup(
  lookup: ChatContactLookupResult | null | undefined,
  fallback: ContactCardDisplayData
): ContactCardDisplayData {
  if (!lookup) return fallback;

  const resolvedName = [lookup.name, lookup.last_name]
    .filter((value) => !!value && value.trim().length > 0)
    .join(' ')
    .trim();
  const resolvedPhone = lookup.phone ?? lookup.phone_partial ?? null;
  const resolvedPhoto = resolveMediaUri(lookup.photo) ?? null;

  return {
    name: resolvedName || fallback.name,
    phone: resolvedPhone || fallback.phone,
    photoUri: resolvedPhoto || fallback.photoUri,
  };
}

async function forceDownloadToDevice(
  sourceUrl: string,
  preferredFileName: string,
  kind: DownloadKind = 'document'
): Promise<void> {
  const fileName =
    sanitizeFilename(preferredFileName || '') || `arquivo-${Date.now()}`;

  if (Platform.OS === 'web') {
    const webDocument = (globalThis as { document?: any }).document;
    const webURL = (globalThis as { URL?: any }).URL;

    if (webDocument?.createElement && webURL?.createObjectURL) {
      try {
        const response = await fetch(sourceUrl);
        const blob = await response.blob();
        const blobUrl = webURL.createObjectURL(blob);
        const anchor = webDocument.createElement('a');
        anchor.href = blobUrl;
        anchor.download = fileName;
        anchor.style.display = 'none';
        webDocument.body?.appendChild?.(anchor);
        anchor.click();
        anchor.remove?.();
        setTimeout(() => {
          webURL.revokeObjectURL?.(blobUrl);
        }, 100);
        return;
      } catch {}
    }

    if (webDocument?.createElement) {
      const anchor = webDocument.createElement('a');
      anchor.href = sourceUrl;
      anchor.download = fileName;
      anchor.rel = 'noopener';
      anchor.target = '_blank';
      anchor.style.display = 'none';
      webDocument.body?.appendChild?.(anchor);
      anchor.click();
      anchor.remove?.();
      return;
    }

    Linking.openURL(sourceUrl);
    return;
  }

  const temporaryDirectory = new Directory(Paths.cache, 'chat-downloads');
  if (!temporaryDirectory.exists) {
    temporaryDirectory.create({ intermediates: true, idempotent: true });
  }

  const temporaryFileName = `${Date.now()}-${fileName}`;
  const temporaryFile = new File(temporaryDirectory, temporaryFileName);
  if (temporaryFile.exists) {
    temporaryFile.delete();
  }

  const downloadedFile = await File.downloadFileAsync(
    sourceUrl,
    temporaryFile,
    {
      idempotent: true,
    }
  );

  const cleanupDownloadedFile = () => {
    if (!downloadedFile.exists) return;
    try {
      downloadedFile.delete();
    } catch {}
  };

  if ((kind === 'image' || kind === 'video') && !isExpoGoEnvironment()) {
    try {
      const granularPermissions: MediaLibrary.GranularPermission[] =
        kind === 'image' ? ['photo'] : ['video'];
      const permission = await MediaLibrary.requestPermissionsAsync(
        true,
        granularPermissions
      );

      if (permission.granted) {
        await MediaLibrary.saveToLibraryAsync(downloadedFile.uri);
        cleanupDownloadedFile();
        return;
      }
    } catch {}
  }

  const copyToDirectory = (directoryUri: string): boolean => {
    try {
      const directory = new Directory(directoryUri);
      const destinationFile = new File(directory, fileName);
      if (destinationFile.exists) {
        destinationFile.delete();
      }
      downloadedFile.copy(destinationFile);
      cleanupDownloadedFile();
      return true;
    } catch {
      return false;
    }
  };

  if (preferredNativeDownloadDirectoryUri) {
    const copied = copyToDirectory(preferredNativeDownloadDirectoryUri);
    if (copied) return;
    preferredNativeDownloadDirectoryUri = null;
  }

  try {
    const pickedDirectory = await Directory.pickDirectoryAsync();
    preferredNativeDownloadDirectoryUri = pickedDirectory.uri;
    if (copyToDirectory(preferredNativeDownloadDirectoryUri)) {
      return;
    }
  } catch {}

  const fallbackDirectory = new Directory(Paths.document, 'downloads');
  if (!fallbackDirectory.exists) {
    fallbackDirectory.create({ intermediates: true, idempotent: true });
  }
  copyToDirectory(fallbackDirectory.uri);
}

function getLatestMessageText(msg: ListMessageResult): string {
  const c = msg.content;
  if (c?.message) return c.message;
  if (c?.image?.caption) return c.image.caption;
  if (c?.video?.caption) return c.video.caption;
  if (c?.audio?.url && c?.message) return c.message;
  return '';
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readIdentifier(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  const parsed = readNonEmptyString(value);
  return parsed ? parsed.toLowerCase() : null;
}

function resolveUserId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { id?: unknown; user_id?: unknown };
  return readIdentifier(record.id) ?? readIdentifier(record.user_id);
}

function checkTypingJidMatches(
  eventJid: string,
  messages: ListMessageResult[]
): boolean {
  const normalizedEventJid = eventJid.trim();
  if (!normalizedEventJid) return false;

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

  const normalizedAltEventJid = normalizedEventJid.replace(
    '@lid',
    '@s.whatsapp.net'
  );

  for (const message of messages) {
    const messageJid = message.message_key?.remote_jid;
    const messageJidAlt = message.message_key?.remote_jid_alt;
    if (
      messageJid === normalizedAltEventJid ||
      messageJidAlt === normalizedAltEventJid
    ) {
      return true;
    }
  }

  return false;
}

function resolveSocketTypingMode(
  payload: SocketTypingPayload
): RemoteActivityMode | null {
  const typingState = readNonEmptyString(
    (payload as { typing_state?: unknown }).typing_state
  );
  if (typingState === 'typing' || typingState === 'recording') {
    return typingState;
  }
  if (typingState === 'available') {
    return null;
  }

  const isRecording =
    (payload as { is_recording?: unknown }).is_recording === true;
  if (isRecording) {
    return 'recording';
  }

  if (payload.is_typing === true) {
    return 'typing';
  }

  return null;
}

function resolveTypingDisplayName(chatInfo: ListChatsResult): string {
  const contactName = chatInfo.contact?.name?.trim();
  if (contactName) return contactName;

  const chatName = chatInfo.name?.trim();
  if (chatName) return chatName;

  const phone = chatInfo.contact?.phone?.trim() || chatInfo.phone?.trim() || '';
  const ddi = chatInfo.contact?.phone_ddi?.trim() || '';

  if (ddi && phone) {
    return `+${ddi} ${phone}`;
  }

  return phone || pt.contact;
}

function resolveStoredUserName(user: unknown): string | null {
  if (!user || typeof user !== 'object') return null;

  const userRecord = user as {
    name?: unknown;
    user_name?: unknown;
    login?: unknown;
    info?: unknown;
  };

  const info =
    userRecord.info && typeof userRecord.info === 'object'
      ? (userRecord.info as { name?: unknown; last_name?: unknown })
      : null;

  const infoName = readNonEmptyString(info?.name);
  const infoLastName = readNonEmptyString(info?.last_name);
  const infoFullName = [infoName, infoLastName]
    .filter(Boolean)
    .join(' ')
    .trim();

  return (
    readNonEmptyString(infoFullName) ??
    readNonEmptyString(userRecord.name) ??
    readNonEmptyString(userRecord.user_name) ??
    readNonEmptyString(userRecord.login)
  );
}

function resolveStoredUserStatus(user: unknown): ChatUserStatus {
  if (!user || typeof user !== 'object') return 'offline';

  const userRecord = user as {
    chat_user?: unknown;
  };

  const chatUser =
    userRecord.chat_user && typeof userRecord.chat_user === 'object'
      ? (userRecord.chat_user as { status?: unknown })
      : null;

  const status = readNonEmptyString(chatUser?.status);

  if (
    status === 'online' ||
    status === 'busy' ||
    status === 'do_not_disturb' ||
    status === 'away' ||
    status === 'offline'
  ) {
    return status;
  }

  return 'offline';
}

function isForwardedMessage(
  content: MessageContent | null | undefined
): boolean {
  const contextInfo = content?.context_info;
  if (!contextInfo || typeof contextInfo !== 'object') return false;

  const normalized = contextInfo as {
    is_forwarded?: unknown;
    forwarding_score?: unknown;
  };

  if (normalized.is_forwarded === true) return true;

  if (typeof normalized.is_forwarded === 'string') {
    const value = normalized.is_forwarded.trim().toLowerCase();
    if (value === 'true' || value === '1') {
      return true;
    }
  }

  if (typeof normalized.forwarding_score === 'number') {
    return (
      Number.isFinite(normalized.forwarding_score) &&
      normalized.forwarding_score > 0
    );
  }

  if (typeof normalized.forwarding_score === 'string') {
    const parsed = Number(normalized.forwarding_score);
    return Number.isFinite(parsed) && parsed > 0;
  }

  return false;
}

function normalizeTypeUser(value: unknown): ETypeUserChat {
  if (value === ETypeUserChat.client) return ETypeUserChat.client;
  if (value === ETypeUserChat.operator) return ETypeUserChat.operator;
  if (value === ETypeUserChat.bot) return ETypeUserChat.bot;
  if (value === ETypeUserChat.system) return ETypeUserChat.system;
  return ETypeUserChat.client;
}

function normalizeSocketMessageToListMessage(
  payload: SocketMessagePayload
): ListMessageResult | null {
  const messageId = readNonEmptyString(
    (payload as { message_id?: unknown }).message_id
  );
  const chatId = readNonEmptyString((payload as { chat_id?: unknown }).chat_id);
  if (!messageId || !chatId) return null;

  const dateValue = readNonEmptyString((payload as { date?: unknown }).date);
  const deletedValue = (payload as { deleted?: unknown }).deleted;
  const hasQuotedValue = (payload as { has_quoted?: unknown }).has_quoted;

  return {
    message_id: messageId,
    chat_id: chatId,
    date: dateValue ?? new Date().toISOString(),
    type_user: normalizeTypeUser(
      (payload as { type_user?: unknown }).type_user
    ),
    user:
      (payload as { user?: unknown }).user && typeof payload.user === 'object'
        ? (payload.user as ListMessageResult['user'])
        : null,
    content:
      (payload as { content?: unknown }).content &&
      typeof payload.content === 'object'
        ? (payload.content as MessageContent)
        : null,
    summary:
      (payload as { summary?: unknown }).summary &&
      typeof payload.summary === 'object'
        ? (payload.summary as ListMessageResult['summary'])
        : null,
    message_key:
      (payload as { message_key?: unknown }).message_key &&
      typeof payload.message_key === 'object'
        ? (payload.message_key as ListMessageResult['message_key'])
        : null,
    deleted: typeof deletedValue === 'boolean' ? deletedValue : false,
    has_quoted: typeof hasQuotedValue === 'boolean' ? hasQuotedValue : false,
    hash: readNonEmptyString((payload as { hash?: unknown }).hash),
  };
}

function mergeMessageLists(
  current: ListMessageResult[],
  incoming: ListMessageResult
): ListMessageResult[] {
  const existingIndex = current.findIndex(
    (message) => message.message_id === incoming.message_id
  );

  if (existingIndex >= 0) {
    const next = [...current];
    const previous = next[existingIndex];
    const mergedContent =
      incoming.content && typeof incoming.content === 'object'
        ? {
            ...(previous.content ?? {}),
            ...incoming.content,
          }
        : previous.content;
    const mergedSummary =
      incoming.summary && typeof incoming.summary === 'object'
        ? {
            ...(previous.summary ?? {}),
            ...incoming.summary,
          }
        : previous.summary;
    const mergedMessageKey =
      incoming.message_key && typeof incoming.message_key === 'object'
        ? {
            ...(previous.message_key ?? {}),
            ...incoming.message_key,
          }
        : previous.message_key;
    const mergedUser =
      incoming.user && typeof incoming.user === 'object'
        ? {
            ...(previous.user ?? {}),
            ...incoming.user,
          }
        : previous.user;

    next[existingIndex] = {
      ...previous,
      ...incoming,
      content: mergedContent,
      summary: mergedSummary,
      message_key: mergedMessageKey,
      user: mergedUser,
    };
    return next;
  }

  const next = [...current, incoming];
  next.sort((a, b) => {
    const ta = new Date(a.date).getTime();
    const tb = new Date(b.date).getTime();
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return -1;
    if (Number.isNaN(tb)) return 1;
    return ta - tb;
  });
  return next;
}

function mergePendingSocketMessages(
  current: ListMessageResult[],
  pending: SocketMessagePayload[]
): ListMessageResult[] {
  if (pending.length === 0) return current;
  let next = current;
  for (const payload of pending) {
    const normalized = normalizeSocketMessageToListMessage(payload);
    if (!normalized) continue;
    next = mergeMessageLists(next, normalized);
  }
  return next;
}

function mergeMessageBatch(
  current: ListMessageResult[],
  incoming: ListMessageResult[]
): ListMessageResult[] {
  if (incoming.length === 0) return current;

  let next = current;
  for (const message of incoming) {
    next = mergeMessageLists(next, message);
  }
  return next;
}

type ReactionSummaryItem = { emoji: string; count: number };

function getReactionsSummary(
  reactions: MessageReaction[] | null | undefined
): ReactionSummaryItem[] {
  if (!reactions || reactions.length === 0) return [];

  const summary = new Map<string, number>();

  for (const reaction of reactions) {
    const emoji =
      typeof reaction?.emoji === 'string' ? reaction.emoji.trim() : '';
    if (!emoji) continue;
    const current = summary.get(emoji) ?? 0;
    summary.set(emoji, current + 1);
  }

  return Array.from(summary.entries())
    .map(([emoji, count]) => ({ emoji, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.emoji.localeCompare(b.emoji);
    });
}

function resolveQuotedType(quoted: MessageQuoted | null | undefined): string {
  const explicitType = readNonEmptyString(quoted?.type);
  if (explicitType) return explicitType;
  if (quoted?.image) return EMessageType.image;
  if (quoted?.video) return EMessageType.video;
  if (quoted?.audio) return EMessageType.audio;
  if (quoted?.document) return EMessageType.document;
  if (quoted?.sticker) return EMessageType.sticker;
  if (quoted?.location) return EMessageType.location;
  if (quoted?.contact) return EMessageType.contact_card;
  if (quoted?.contacts && quoted.contacts.length > 0)
    return EMessageType.contacts;
  return EMessageType.text;
}

function resolveQuotedName(
  quoted: MessageQuoted | null | undefined,
  chatInfo: ListChatsResult,
  currentUserName: string | null | undefined,
  messageSenderName: string | null | undefined
): string {
  const fromMe = quoted?.key?.from_me;
  if (fromMe === true) {
    return (
      currentUserName?.trim() ||
      messageSenderName?.trim() ||
      chatInfo.user?.name?.trim() ||
      pt.attendant
    );
  }
  if (fromMe === false) {
    return (
      chatInfo.contact?.name?.trim() ||
      chatInfo.name?.trim() ||
      chatInfo.phone ||
      pt.contact
    );
  }

  const quotedContactName = quoted?.contact
    ? [quoted.contact.name, quoted.contact.last_name]
        .filter(Boolean)
        .join(' ')
        .trim()
    : '';
  return (
    quotedContactName ||
    chatInfo.contact?.name?.trim() ||
    chatInfo.name?.trim() ||
    pt.contact
  );
}

function resolveQuotedPreviewImage(
  quoted: MessageQuoted | null | undefined,
  quotedType: string
): string | null {
  if (!quoted) return null;

  if (quotedType === EMessageType.image) {
    return resolveMediaUri(quoted.image?.thumbnail ?? quoted.image?.url);
  }
  if (quotedType === EMessageType.sticker) {
    if (!isRenderableSticker(quoted.sticker)) return null;
    return resolveMediaUri(quoted.sticker?.url);
  }
  if (
    quotedType === EMessageType.video ||
    quotedType === EMessageType.video_note
  ) {
    return resolveMediaUri(quoted.video?.thumbnail ?? quoted.video?.url);
  }

  return null;
}

function resolveQuotedText(
  quoted: MessageQuoted | null | undefined,
  quotedType: string
): string {
  if (!quoted) return '';

  if (quotedType === EMessageType.image) {
    return readNonEmptyString(quoted.image?.caption) ?? 'Foto';
  }

  if (quotedType === EMessageType.document) {
    return (
      readNonEmptyString(quoted.document?.name) ||
      readNonEmptyString(quoted.message) ||
      pt.document
    );
  }

  if (quotedType === EMessageType.video) {
    return readNonEmptyString(quoted.video?.caption) ?? 'Video';
  }

  if (quotedType === EMessageType.video_note) {
    return readNonEmptyString(quoted.video?.caption) ?? 'Video circular';
  }

  if (quotedType === EMessageType.audio) {
    return readNonEmptyString(quoted.message) ?? pt.audio;
  }

  if (quotedType === EMessageType.sticker) {
    return 'Sticker';
  }

  if (quotedType === EMessageType.location) {
    return (
      readNonEmptyString(quoted.location?.name) ||
      readNonEmptyString(quoted.location?.address) ||
      pt.location
    );
  }

  if (quotedType === EMessageType.contact_card && quoted.contact) {
    return (
      [quoted.contact.name, quoted.contact.last_name]
        .filter(Boolean)
        .join(' ')
        .trim() || pt.contact
    );
  }

  if (quotedType === EMessageType.contacts) {
    const first = quoted.contacts?.[0];
    if (first) {
      const firstName =
        [first.name, first.last_name].filter(Boolean).join(' ').trim() ||
        pt.contact;
      const extraCount = (quoted.contacts?.length ?? 0) - 1;
      if (extraCount > 0) {
        return `${firstName} e ${extraCount} ${pt.contacts_other}`;
      }
      return firstName;
    }
    return pt.contact;
  }

  return readNonEmptyString(quoted.message) ?? '';
}

function resolveQuotedMeta(
  quoted: MessageQuoted | null | undefined,
  quotedType: string
): string {
  if (!quoted) return '';

  if (quotedType === EMessageType.image) {
    const ext = quoted.image?.extension
      ? quoted.image.extension.replace(/^\./, '').toUpperCase()
      : 'IMG';
    const size = formatFileSize(quoted.image?.size);
    return [ext, size].filter(Boolean).join(' • ');
  }

  if (
    quotedType === EMessageType.video ||
    quotedType === EMessageType.video_note
  ) {
    const ext = quoted.video?.extension
      ? quoted.video.extension.replace(/^\./, '').toUpperCase()
      : 'VIDEO';
    const size = formatFileSize(quoted.video?.size);
    const duration = formatVideoDuration(quoted.video?.duration);
    return [ext, size, duration].filter(Boolean).join(' • ');
  }

  if (quotedType === EMessageType.audio) {
    const size = formatFileSize(quoted.audio?.size);
    const duration = formatVideoDuration(quoted.audio?.duration);
    return [size, duration].filter(Boolean).join(' • ');
  }

  if (quotedType === EMessageType.document) {
    const ext = quoted.document?.extension
      ? quoted.document.extension.replace(/^\./, '').toUpperCase()
      : 'FILE';
    const size = formatFileSize(quoted.document?.size);
    return [ext, size].filter(Boolean).join(' • ');
  }

  return '';
}

function resolveQuotedContactPhoto(
  quoted: MessageQuoted | null | undefined,
  quotedType: string
): string | null {
  if (!quoted) return null;

  if (quotedType === EMessageType.contact_card) {
    return resolveMediaUri(quoted.contact?.photo);
  }

  if (quotedType === EMessageType.contacts) {
    const firstContact = quoted.contacts?.[0];
    return resolveMediaUri(firstContact?.photo);
  }

  return null;
}

function isQuotedContactsGroup(
  quoted: MessageQuoted | null | undefined,
  quotedType: string
): boolean {
  if (!quoted) return false;
  if (quotedType !== EMessageType.contacts) return false;
  return (quoted.contacts?.length ?? 0) > 1;
}

function resolveQuotedTargetMessageId(
  message: ListMessageResult,
  allMessages: ListMessageResult[]
): string | null {
  const quoted = message.content?.quoted;
  if (!quoted) return null;

  const quotedKeyId = readNonEmptyString(quoted.key?.id);
  if (quotedKeyId) {
    const keyMatch = allMessages.find(
      (entry) => readNonEmptyString(entry.message_key?.id) === quotedKeyId
    );
    if (keyMatch) {
      return keyMatch.message_id;
    }
  }

  const explicitQuotedId = readNonEmptyString(
    message.content?.message_quoted_id
  );
  if (explicitQuotedId) {
    const explicitMessage = allMessages.find(
      (entry) => entry.message_id === explicitQuotedId
    );
    if (explicitMessage) {
      return explicitMessage.message_id;
    }

    const explicitByKey = allMessages.find(
      (entry) => readNonEmptyString(entry.message_key?.id) === explicitQuotedId
    );
    if (explicitByKey) {
      return explicitByKey.message_id;
    }

    if (UUID_PATTERN.test(explicitQuotedId)) {
      return explicitQuotedId;
    }

    return explicitQuotedId;
  }

  const quotedText = readNonEmptyString(quoted.message);
  if (!quotedText) return null;

  const textMatch = allMessages.find(
    (entry) => readNonEmptyString(entry.content?.message) === quotedText
  );
  return textMatch?.message_id ?? null;
}

type Props = NativeStackScreenProps<ChatStackParamList, 'ChatRoom'>;

type MessageWithSeparator =
  | { type: 'message'; message: ListMessageResult }
  | {
      type: 'separator';
      separatorDate: string;
      separatorLabel: string;
    };

type MediaViewerState = {
  visible: boolean;
  kind: 'image' | 'video';
  src: string;
  caption: string;
  downloadName: string;
};

type CameraCaptureDraft = {
  uri: string;
  kind: 'image' | 'video';
  fileName: string;
  mimeType: string;
  durationSec: number | null;
};

function formatMessageTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDateSeparator(dateString: string): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const messageDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
  if (messageDate.getTime() === today.getTime()) return pt.today;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (messageDate.getTime() === yesterday.getTime()) return pt.yesterday;
  const diffMs = today.getTime() - messageDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 7 && diffDays > 0) {
    const weekdays = [
      pt.sunday,
      pt.monday,
      pt.tuesday,
      pt.wednesday,
      pt.thursday,
      pt.friday,
      pt.saturday,
    ];
    return weekdays[date.getDay()];
  }
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function isSameDay(date1: string, date2: string): boolean {
  if (!date1 || !date2) return false;
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return (
    d1.getDate() === d2.getDate() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getFullYear() === d2.getFullYear()
  );
}

type AudioState = {
  isPlaying: boolean;
  position: number;
  duration: number;
  rate: number;
};

const DEFAULT_AUDIO_STATE: AudioState = {
  isPlaying: false,
  position: 0,
  duration: 0,
  rate: 1,
};

function useChatAudio() {
  const [state, setState] = useState<Record<string, AudioState>>({});
  const [waveformWidths, setWaveformWidths] = useState<Record<string, number>>(
    {}
  );
  const soundRefs = useRef<Record<string, AudioPlayer | null>>({});
  const waveformCache = useRef<Record<string, number[]>>({});

  const updateState = useCallback(
    (messageId: string, patch: Partial<AudioState>) => {
      setState((prev) => ({
        ...prev,
        [messageId]: { ...DEFAULT_AUDIO_STATE, ...prev[messageId], ...patch },
      }));
    },
    []
  );

  const getOrCreateSound = useCallback(
    (messageId: string, url: string): AudioPlayer | null => {
      if (soundRefs.current[messageId]) return soundRefs.current[messageId];
      try {
        const player = createAudioPlayer(url, { updateInterval: 300 });
        player.addListener('playbackStatusUpdate', (status) => {
          setState((prev) => {
            const cur = prev[messageId];
            return {
              ...prev,
              [messageId]: {
                isPlaying: status.playing,
                position: status.currentTime,
                duration: cur?.duration || status.duration || 0,
                rate: cur?.rate ?? status.playbackRate ?? 1,
              },
            };
          });
        });
        soundRefs.current[messageId] = player;
        return player;
      } catch {
        return null;
      }
    },
    []
  );

  const playPause = useCallback(
    (messageId: string, url: string) => {
      const player = getOrCreateSound(messageId, url);
      if (!player) return;
      const cur = state[messageId];
      const isPlaying = cur?.isPlaying ?? false;
      if (isPlaying) {
        player.pause();
      } else {
        const rate = cur?.rate ?? 1;
        player.setPlaybackRate(rate);
        player.play();
      }
    },
    [getOrCreateSound, state]
  );

  const seek = useCallback(
    (messageId: string, url: string, percentage: number) => {
      const player = getOrCreateSound(messageId, url);
      if (!player) return;
      const cur = state[messageId];
      const durationSec = cur?.duration ?? 0;
      if (durationSec <= 0) return;
      const positionSec = Math.max(0, Math.min(1, percentage)) * durationSec;
      player.seekTo(positionSec).then(() => {
        updateState(messageId, { position: positionSec });
      });
    },
    [getOrCreateSound, state, updateState]
  );

  const toggleSpeed = useCallback(
    (messageId: string) => {
      const cur = state[messageId];
      const currentRate = cur?.rate ?? 1;
      const nextRate = currentRate === 1 ? 1.5 : currentRate === 1.5 ? 2 : 1;
      updateState(messageId, { rate: nextRate });
      const player = soundRefs.current[messageId];
      if (player) {
        try {
          player.setPlaybackRate(nextRate);
        } catch {}
      }
    },
    [state, updateState]
  );

  const getWaveform = useCallback(
    (
      messageId: string,
      data: string | number[] | null | undefined
    ): number[] => {
      if (waveformCache.current[messageId])
        return waveformCache.current[messageId];
      const parsed = parseWaveform(data);
      if (parsed && parsed.length > 0) {
        waveformCache.current[messageId] = parsed;
        return parsed;
      }
      const placeholder = new Array(64).fill(0.3);
      waveformCache.current[messageId] = placeholder;
      return placeholder;
    },
    []
  );

  const getState = useCallback(
    (messageId: string): AudioState => {
      return state[messageId] ?? DEFAULT_AUDIO_STATE;
    },
    [state]
  );

  const getSpeedLabel = useCallback(
    (messageId: string): string => {
      const rate = state[messageId]?.rate ?? 1;
      if (rate === 1.5) return '1.5x';
      if (rate === 2) return '2x';
      return '1x';
    },
    [state]
  );

  const setWaveformWidth = useCallback((messageId: string, w: number) => {
    const nextWidth = Math.max(0, Math.round(w));
    setWaveformWidths((prev) => {
      if (prev[messageId] === nextWidth) return prev;
      return { ...prev, [messageId]: nextWidth };
    });
  }, []);
  const getWaveformWidth = useCallback(
    (messageId: string): number => {
      return waveformWidths[messageId] ?? 0;
    },
    [waveformWidths]
  );

  return {
    getState,
    getSpeedLabel,
    playPause,
    seek,
    toggleSpeed,
    getWaveform,
    setWaveformWidth,
    getWaveformWidth,
  };
}

function DateSeparator({ label }: { label: string }) {
  return (
    <View style={styles.dateSeparatorWrap}>
      <View style={styles.dateSeparatorLine} />
      <View style={styles.dateSeparatorPill}>
        <Text style={styles.dateSeparatorText}>{label}</Text>
      </View>
      <View style={styles.dateSeparatorLine} />
    </View>
  );
}

function AttendanceHistorySkeleton({ rows }: { rows: number }) {
  return (
    <View style={styles.historySkeletonWrap}>
      {Array.from({ length: rows }).map((_, index) => (
        <View
          key={`history-skeleton-${index}`}
          style={styles.historySkeletonRow}
        >
          <View style={styles.historySkeletonTitle} />
          <View style={styles.historySkeletonLine} />
          <View
            style={[
              styles.historySkeletonLine,
              styles.historySkeletonLineShort,
            ]}
          />
        </View>
      ))}
    </View>
  );
}

type AudioCtrl = ReturnType<typeof useChatAudio>;

function VideoMessagePreview({
  sourceUri,
  thumbnailUri,
  isVideoNote,
  onPress,
}: {
  sourceUri: string;
  thumbnailUri: string | null;
  isVideoNote: boolean;
  onPress: () => void;
}) {
  const [thumbnailLoadError, setThumbnailLoadError] = useState(false);
  const shouldUseVideoFramePreview = !thumbnailUri || thumbnailLoadError;

  const previewPlayer = useVideoPlayer(
    shouldUseVideoFramePreview ? { uri: sourceUri } : null,
    (player) => {
      player.loop = false;
      player.muted = true;
    }
  );

  useEffect(() => {
    if (!shouldUseVideoFramePreview) return;

    try {
      previewPlayer.pause();
      previewPlayer.currentTime = 0;
    } catch {}
  }, [previewPlayer, shouldUseVideoFramePreview]);

  return (
    <Pressable
      style={isVideoNote ? styles.videoNoteThumbWrap : styles.videoThumbWrap}
      onPress={onPress}
    >
      {shouldUseVideoFramePreview ? (
        <VideoView
          player={previewPlayer}
          style={
            isVideoNote ? styles.videoNoteThumbVideo : styles.videoThumbVideo
          }
          contentFit="cover"
          nativeControls={false}
          fullscreenOptions={VIDEO_FULLSCREEN_DISABLED}
          allowsPictureInPicture={false}
          playsInline
        />
      ) : (
        <Image
          source={{ uri: thumbnailUri || sourceUri }}
          style={isVideoNote ? styles.videoNoteThumb : styles.videoThumb}
          resizeMode="cover"
          onError={() => setThumbnailLoadError(true)}
        />
      )}

      <View style={styles.videoOverlay}>
        <Ionicons name="play-circle" size={48} color="#fff" />
      </View>
    </Pressable>
  );
}

function LocationMessagePreview({
  latitude,
  longitude,
  name,
  address,
}: {
  latitude: number;
  longitude: number;
  name: string | null | undefined;
  address: string | null | undefined;
}) {
  const [previewSourceIndex, setPreviewSourceIndex] = useState(0);
  const [previewLoadError, setPreviewLoadError] = useState(false);
  const previewCandidates = useMemo(
    () => buildLocationPreviewCandidates(latitude, longitude),
    [latitude, longitude]
  );
  const previewUri =
    previewCandidates[
      Math.min(previewSourceIndex, previewCandidates.length - 1)
    ];
  const title = name?.trim() || pt.location;

  const handleOpen = useCallback(() => {
    void openLocationInMaps(latitude, longitude, title || address);
  }, [address, latitude, longitude, title]);

  return (
    <Pressable style={styles.locationBubble} onPress={handleOpen}>
      <View style={styles.locationMapPreview}>
        {previewLoadError ? (
          <View style={styles.locationMapFallback}>
            <Ionicons name="location" size={28} color={colors.primary} />
          </View>
        ) : (
          <>
            <Image
              key={previewUri}
              source={{ uri: previewUri }}
              style={styles.locationMapImage}
              resizeMode="cover"
              onError={() => {
                if (previewSourceIndex < previewCandidates.length - 1) {
                  setPreviewSourceIndex((current) => current + 1);
                  return;
                }
                setPreviewLoadError(true);
              }}
            />
            <View style={styles.locationPinOverlay}>
              <Ionicons name="location-sharp" size={36} color="#EF4444" />
            </View>
          </>
        )}
      </View>

      <View style={styles.locationInfo}>
        <Text style={styles.locationName} numberOfLines={1}>
          {title}
        </Text>
        {address ? (
          <Text style={styles.locationAddress} numberOfLines={2}>
            {address}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function LinkPreviewMessage({
  preview,
  fromMe,
}: {
  preview: MessageContentLinkPreview;
  fromMe: boolean;
}) {
  const previewUrl = resolvePreviewUrl(preview);
  const previewImage = resolvePreviewImage(preview);
  const title = readNonEmptyString(preview.title);
  const description = readNonEmptyString(preview.description);
  const domain = resolveDomainFromUrl(
    preview['canonical-url'] ?? preview['matched-text'] ?? previewUrl
  );

  if (!title && !description && !previewImage && !previewUrl) {
    return null;
  }

  const handleOpenLink = async () => {
    if (!previewUrl) return;
    try {
      await Linking.openURL(previewUrl);
    } catch {}
  };

  return (
    <Pressable
      style={[
        styles.linkPreviewCard,
        fromMe ? styles.linkPreviewCardRight : styles.linkPreviewCardLeft,
      ]}
      onPress={() => {
        void handleOpenLink();
      }}
      disabled={!previewUrl}
    >
      <View style={styles.linkPreviewMain}>
        {previewImage ? (
          <Image
            source={{ uri: previewImage }}
            style={styles.linkPreviewThumb}
            resizeMode="cover"
          />
        ) : null}
        <View style={styles.linkPreviewText}>
          {domain ? (
            <Text style={styles.linkPreviewDomain} numberOfLines={1}>
              {domain}
            </Text>
          ) : null}
          {title ? (
            <Text style={styles.linkPreviewTitle} numberOfLines={2}>
              {title}
            </Text>
          ) : null}
          {description ? (
            <Text style={styles.linkPreviewDescription} numberOfLines={2}>
              {description}
            </Text>
          ) : null}
        </View>
      </View>
      {previewUrl ? (
        <Text style={styles.linkPreviewUrl} numberOfLines={1}>
          {previewUrl}
        </Text>
      ) : null}
    </Pressable>
  );
}

function ExternalAdReplyMessage({
  adReply,
  fromMe,
}: {
  adReply: MessageContextExternalAdReply;
  fromMe: boolean;
}) {
  const thumbnailUri = resolveMediaUri(adReply.thumbnail_url);
  const sourceApp = resolveExternalSourceAppName(adReply.source_app);
  const title = readNonEmptyString(adReply.title);
  const greetingMessage = readNonEmptyString(adReply.greeting_message_body);
  const sourceUrl = readNonEmptyString(adReply.source_url);

  if (!thumbnailUri && !sourceApp && !title && !greetingMessage && !sourceUrl) {
    return null;
  }

  const handleOpenSourceUrl = async () => {
    if (!sourceUrl) return;
    try {
      await Linking.openURL(sourceUrl);
    } catch {}
  };

  return (
    <Pressable
      style={[
        styles.externalAdCard,
        fromMe ? styles.externalAdCardRight : styles.externalAdCardLeft,
      ]}
      onPress={() => {
        void handleOpenSourceUrl();
      }}
      disabled={!sourceUrl}
    >
      <View style={styles.externalAdMain}>
        {thumbnailUri ? (
          <Image
            source={{ uri: thumbnailUri }}
            style={styles.externalAdThumb}
            resizeMode="cover"
          />
        ) : null}
        <View style={styles.externalAdInfo}>
          {sourceApp ? (
            <Text style={styles.externalAdSource} numberOfLines={1}>
              {sourceApp}
            </Text>
          ) : null}
          {title ? (
            <Text style={styles.externalAdTitle} numberOfLines={2}>
              {title}
            </Text>
          ) : null}
          {greetingMessage ? (
            <Text style={styles.externalAdDescription} numberOfLines={2}>
              {greetingMessage}
            </Text>
          ) : null}
        </View>
      </View>
      {sourceUrl ? (
        <Text style={styles.externalAdUrl} numberOfLines={1}>
          {sourceUrl}
        </Text>
      ) : null}
    </Pressable>
  );
}

function ProtectedContentPlaceholder({ fromMe }: { fromMe: boolean }) {
  const textColor = fromMe ? styles.bubbleTextRight : styles.bubbleTextLeft;

  return (
    <View style={styles.protectedContentWrap}>
      <View style={styles.protectedIconWrap}>
        <Ionicons name="lock-closed-outline" size={14} color={colors.grey700} />
      </View>
      <View style={styles.protectedContentTextWrap}>
        <Text style={[styles.protectedContentTitle, textColor]}>
          {pt.protected_content}
        </Text>
        <Text style={[styles.protectedContentSubtitle, textColor]}>
          {pt.action_unavailable_by_permission}
        </Text>
      </View>
    </View>
  );
}

function QuotedReplyPreview({
  msg,
  fromMe,
  chatInfo,
  currentUserName,
  onPressQuoted,
  obfuscateContent = false,
}: {
  msg: ListMessageResult;
  fromMe: boolean;
  chatInfo: ListChatsResult;
  currentUserName: string | null;
  onPressQuoted?: (() => void) | null;
  obfuscateContent?: boolean;
}) {
  const quoted = msg.content?.quoted ?? null;
  if (!quoted) return null;

  const quotedType = resolveQuotedType(quoted);
  const messageSenderName = readNonEmptyString(msg.user?.name);
  const quotedName = resolveQuotedName(
    quoted,
    chatInfo,
    currentUserName,
    messageSenderName
  );
  const quotedText = resolveQuotedText(quoted, quotedType);
  const quotedMeta = resolveQuotedMeta(quoted, quotedType);
  const quotedImageUri = resolveQuotedPreviewImage(quoted, quotedType);
  const quotedContactPhoto = resolveQuotedContactPhoto(quoted, quotedType);
  const isContactsGroup = isQuotedContactsGroup(quoted, quotedType);
  const isQuotedContactType =
    quotedType === EMessageType.contact_card ||
    quotedType === EMessageType.contacts;
  const showVideoOverlay =
    quotedType === EMessageType.video || quotedType === EMessageType.video_note;
  const canPressQuoted = typeof onPressQuoted === 'function';
  const quotedBlockStyle = [
    styles.quotedBlock,
    fromMe && styles.quotedBlockRight,
    canPressQuoted && styles.quotedBlockInteractive,
  ];

  if (obfuscateContent) {
    return (
      <View style={quotedBlockStyle}>
        <View style={[styles.quotedBar, fromMe && styles.quotedBarRight]} />
        <View style={styles.quotedBody}>
          <Text
            style={[styles.quotedName, fromMe && styles.quotedNameRight]}
            numberOfLines={1}
          >
            {pt.protected_content}
          </Text>
          <Text style={styles.quotedMeta} numberOfLines={1}>
            {pt.action_unavailable_by_permission}
          </Text>
        </View>
      </View>
    );
  }

  const quotedInner = (
    <>
      <View style={[styles.quotedBar, fromMe && styles.quotedBarRight]} />
      <View
        style={[
          styles.quotedBody,
          isQuotedContactType && styles.quotedBodyContact,
        ]}
      >
        <Text
          style={[
            styles.quotedName,
            fromMe && styles.quotedNameRight,
            isQuotedContactType && styles.quotedNameContact,
          ]}
          numberOfLines={1}
        >
          {quotedName}
        </Text>
        <View
          style={[
            styles.quotedContentRow,
            isQuotedContactType && styles.quotedContentRowContact,
          ]}
        >
          {quotedImageUri ? (
            <View style={styles.quotedThumbWrap}>
              <Image
                source={{ uri: quotedImageUri }}
                style={styles.quotedThumb}
                resizeMode="cover"
              />
              {showVideoOverlay ? (
                <View style={styles.quotedVideoOverlay}>
                  <Ionicons name="play" size={11} color="#FFFFFF" />
                </View>
              ) : null}
            </View>
          ) : quotedType === EMessageType.document ? (
            <Ionicons
              name="document-text-outline"
              size={18}
              color={colors.primary}
            />
          ) : quotedType === EMessageType.audio ? (
            <Ionicons name="mic-outline" size={18} color={colors.primary} />
          ) : quotedType === EMessageType.location ? (
            <Ionicons
              name="location-outline"
              size={18}
              color={colors.primary}
            />
          ) : quotedType === EMessageType.sticker ? (
            <Ionicons
              name="pricetag-outline"
              size={18}
              color={colors.primary}
            />
          ) : quotedType === EMessageType.contact_card ||
            quotedType === EMessageType.contacts ? (
            quotedContactPhoto ? (
              <Image
                source={{ uri: quotedContactPhoto }}
                style={styles.quotedContactAvatar}
                resizeMode="cover"
              />
            ) : isContactsGroup ? (
              <View style={styles.quotedContactGroupIconWrap}>
                <Ionicons
                  name="people-outline"
                  size={14}
                  color={colors.primary}
                />
              </View>
            ) : (
              <Ionicons
                name="person-outline"
                size={18}
                color={colors.primary}
              />
            )
          ) : null}

          <View
            style={[
              styles.quotedTextWrap,
              isQuotedContactType && styles.quotedTextWrapContact,
            ]}
          >
            {quotedText ? (
              <Text
                style={[
                  styles.quotedText,
                  fromMe && styles.quotedTextRight,
                  isQuotedContactType && styles.quotedTextContact,
                ]}
                numberOfLines={2}
                ellipsizeMode="tail"
              >
                {quotedText}
              </Text>
            ) : null}
            {quotedMeta ? (
              <Text style={styles.quotedMeta} numberOfLines={1}>
                {quotedMeta}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </>
  );

  if (!canPressQuoted) {
    return <View style={quotedBlockStyle}>{quotedInner}</View>;
  }

  return (
    <Pressable
      style={({ pressed }) => [
        quotedBlockStyle,
        pressed && styles.quotedBlockPressed,
      ]}
      onPress={onPressQuoted}
    >
      {quotedInner}
    </Pressable>
  );
}

function BubbleContent({
  msg,
  fromMe,
  content,
  chatInfo,
  resolvedContactDisplay,
  audioCtrl,
  onOpenImage,
  onOpenVideo,
  onTemplateButtonPress,
  disableTemplateButtons,
  obfuscateContent = false,
}: {
  msg: ListMessageResult;
  fromMe: boolean;
  content: MessageContent;
  chatInfo: ListChatsResult;
  resolvedContactDisplay?: ContactCardDisplayData;
  audioCtrl: AudioCtrl | null;
  onOpenImage: (msg: ListMessageResult) => void;
  onOpenVideo: (msg: ListMessageResult) => void;
  onTemplateButtonPress?: (
    button: MessageTemplateButton,
    message: ListMessageResult
  ) => void;
  disableTemplateButtons?: boolean;
  obfuscateContent?: boolean;
}) {
  if (obfuscateContent) {
    return <ProtectedContentPlaceholder fromMe={fromMe} />;
  }

  const type = content.type;
  const textColor = fromMe ? styles.bubbleTextRight : styles.bubbleTextLeft;
  const isViewOnce =
    msg.message_key?.is_view_once === true || type === EMessageType.view_once;
  const linkPreview = content.link_preview;
  const externalAdReply = content.context_info?.external_ad_reply;
  const hasLinkPreview = Boolean(
    linkPreview &&
    (readNonEmptyString(linkPreview.title) ||
      readNonEmptyString(linkPreview.description) ||
      resolvePreviewImage(linkPreview) ||
      resolvePreviewUrl(linkPreview))
  );
  const hasExternalAdReply = Boolean(
    externalAdReply &&
    (readNonEmptyString(externalAdReply.title) ||
      readNonEmptyString(externalAdReply.greeting_message_body) ||
      readNonEmptyString(externalAdReply.source_url) ||
      readNonEmptyString(externalAdReply.source_app) ||
      resolveMediaUri(externalAdReply.thumbnail_url))
  );
  const renderWithContextCards = (child: ReactElement | null) => {
    if (!hasLinkPreview && !hasExternalAdReply) return child;
    return (
      <View style={styles.contentStack}>
        {hasLinkPreview && linkPreview ? (
          <LinkPreviewMessage preview={linkPreview} fromMe={fromMe} />
        ) : null}
        {hasExternalAdReply && externalAdReply ? (
          <ExternalAdReplyMessage adReply={externalAdReply} fromMe={fromMe} />
        ) : null}
        {child}
      </View>
    );
  };

  if (isViewOnce) {
    return renderWithContextCards(
      <View style={styles.viewOnceWrap}>
        <Ionicons name="eye-off-outline" size={20} color={colors.grey600} />
        <Text style={styles.viewOnceText}>{pt.view_once_message}</Text>
      </View>
    );
  }

  if (type === EMessageType.image && content.image?.url) {
    const cap = content.image.caption;
    const imageUri = resolveMediaUri(content.image.url);
    if (!imageUri) return null;
    return renderWithContextCards(
      <View style={[styles.mediaBubble, styles.mediaBubbleImage]}>
        <Pressable onPress={() => onOpenImage(msg)}>
          <Image
            source={{ uri: imageUri }}
            style={styles.imageThumb}
            resizeMode="cover"
          />
        </Pressable>
        {cap ? (
          <Text style={[styles.mediaCaption, textColor]}>{cap}</Text>
        ) : null}
      </View>
    );
  }

  if (
    (type === EMessageType.video || type === EMessageType.video_note) &&
    content.video?.url
  ) {
    const cap = content.video.caption;
    const isVideoNote = type === EMessageType.video_note;
    const videoUri = resolveMediaUri(content.video.url);
    const thumbUri = resolveMediaUri(content.video.thumbnail);
    if (!videoUri) return null;
    const videoMeta = isVideoNote
      ? formatVideoDuration(content.video.duration) ||
        resolveVideoMeta(content.video)
      : resolveVideoMeta(content.video);

    return renderWithContextCards(
      <View style={styles.mediaBubble}>
        <VideoMessagePreview
          sourceUri={videoUri}
          thumbnailUri={thumbUri}
          isVideoNote={isVideoNote}
          onPress={() => onOpenVideo(msg)}
        />
        {videoMeta ? <Text style={styles.mediaMeta}>{videoMeta}</Text> : null}
        {cap ? (
          <Text style={[styles.mediaCaption, textColor]}>{cap}</Text>
        ) : null}
      </View>
    );
  }

  if (type === EMessageType.sticker && content.sticker?.url) {
    const stickerUri = resolveMediaUri(content.sticker.url);
    if (!stickerUri) return null;
    if (!isRenderableSticker(content.sticker)) {
      return renderWithContextCards(
        <Pressable
          style={styles.stickerFallback}
          onPress={() =>
            void forceDownloadToDevice(
              stickerUri,
              resolveStickerDownloadName(msg),
              'document'
            )
          }
        >
          <Ionicons name="document-outline" size={20} color={colors.grey700} />
          <Text style={styles.stickerFallbackText}>Sticker</Text>
        </Pressable>
      );
    }
    return renderWithContextCards(
      <Pressable onPress={() => onOpenImage(msg)}>
        <Image
          source={{ uri: stickerUri }}
          style={styles.stickerThumb}
          resizeMode="contain"
        />
      </Pressable>
    );
  }

  if (
    type === EMessageType.location &&
    content.location?.latitude != null &&
    content.location?.longitude != null
  ) {
    const latitude = Number(content.location.latitude);
    const longitude = Number(content.location.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    return renderWithContextCards(
      <LocationMessagePreview
        latitude={latitude}
        longitude={longitude}
        name={content.location.name}
        address={content.location.address}
      />
    );
  }

  if (type === EMessageType.audio && content.audio?.url) {
    const messageId = msg.message_id;
    const url = resolveMediaUri(content.audio.url) ?? content.audio.url;
    const cap = content.message;
    const fallbackDuration = content.audio.duration ?? 0;
    if (!audioCtrl) {
      const durStr =
        fallbackDuration > 0 ? formatAudioTime(fallbackDuration) : pt.audio;
      return renderWithContextCards(
        <View style={styles.audioWrap}>
          <Text style={[styles.audioDuration, textColor]}>{durStr}</Text>
          {cap ? (
            <Text style={[styles.mediaCaption, textColor]}>{cap}</Text>
          ) : null}
        </View>
      );
    }
    const audioState = audioCtrl.getState(messageId);
    const waveform = audioCtrl.getWaveform(
      messageId,
      content.audio.waveform ?? undefined
    );
    const durationSec =
      audioState.duration > 0 ? audioState.duration : fallbackDuration;
    const currentTime =
      audioState.isPlaying || audioState.position > 0 ? audioState.position : 0;
    const progressPercent =
      durationSec > 0
        ? Math.max(0, Math.min(100, (currentTime / durationSec) * 100))
        : 0;
    const currentTimeStr = formatAudioTime(currentTime);
    const waveformWidth = audioCtrl.getWaveformWidth(messageId);
    const waveformToRender = fitWaveformToWidth(waveform, waveformWidth);

    return renderWithContextCards(
      <View style={styles.audioBubble}>
        <View
          style={[
            styles.audioPlayerContainer,
            fromMe && styles.audioPlayerContainerRight,
          ]}
        >
          <Pressable
            style={[styles.audioSpeedBtn, fromMe && styles.audioSpeedBtnRight]}
            onPress={() => audioCtrl.toggleSpeed(messageId)}
          >
            <Text
              style={[
                styles.audioSpeedBtnText,
                fromMe && styles.audioSpeedBtnTextRight,
              ]}
            >
              {audioCtrl.getSpeedLabel(messageId)}
            </Text>
          </Pressable>
          <View style={styles.audioPlayAndTimeWrap}>
            <Pressable
              style={[
                styles.audioPlayBtnCircle,
                fromMe && styles.audioPlayBtnCircleRight,
              ]}
              onPress={() => audioCtrl.playPause(messageId, url)}
            >
              <Ionicons
                name={audioState.isPlaying ? 'pause' : 'play'}
                size={16}
                color={colors.primary}
              />
            </Pressable>
            <Text
              style={[
                styles.audioTimeBelowPlay,
                fromMe
                  ? styles.audioTimeBelowPlayRight
                  : styles.audioTimeBelowPlayLeft,
              ]}
            >
              {currentTimeStr}
            </Text>
          </View>
          <Pressable
            style={styles.audioWaveformContainer}
            onLayout={(e) => {
              audioCtrl.setWaveformWidth(messageId, e.nativeEvent.layout.width);
            }}
            onPress={(e) => {
              const ev = e.nativeEvent as unknown as {
                locationX?: number;
                clientX?: number;
                target?: HTMLElement;
              };
              let width = audioCtrl.getWaveformWidth(messageId);
              let locationX: number;
              if (typeof ev.locationX === 'number') {
                locationX = ev.locationX;
                if (!width) return;
              } else if (
                typeof ev.clientX === 'number' &&
                ev.target?.getBoundingClientRect
              ) {
                const rect = ev.target.getBoundingClientRect();
                locationX = ev.clientX - rect.left;
                if (!width) width = rect.width;
              } else {
                return;
              }
              if (!width) return;
              const percentage = Math.max(0, Math.min(1, locationX / width));
              audioCtrl.seek(messageId, url, percentage);
            }}
          >
            <View style={styles.audioWaveform}>
              {waveformToRender.map((barValue, index) => {
                const barProgress = (index / waveformToRender.length) * 100;
                const isActive = progressPercent > barProgress;
                return (
                  <View
                    key={`${messageId}-${index}`}
                    style={[
                      styles.audioWaveformBar,
                      fromMe && styles.audioWaveformBarRight,
                      isActive && styles.audioWaveformBarActive,
                      fromMe && isActive && styles.audioWaveformBarActiveRight,
                      { height: `${Math.max(8, barValue * 100)}%` },
                    ]}
                  />
                );
              })}
            </View>
            <View
              style={[
                styles.audioProgressIndicator,
                fromMe && styles.audioProgressIndicatorRight,
                { left: `${progressPercent}%` },
              ]}
            />
          </Pressable>
        </View>
        {cap ? (
          <Text style={[styles.mediaCaption, textColor, styles.audioCaption]}>
            {cap}
          </Text>
        ) : null}
      </View>
    );
  }

  if (type === EMessageType.document && content.document?.url) {
    const doc = content.document;
    const docUrl = resolveMediaUri(doc.url);
    if (!docUrl) return null;
    const ext = (doc.extension ?? '').toUpperCase() || 'FILE';
    const extLabel = ext.slice(0, 4);
    const sizeStr = formatFileSize(doc.size);
    const name = doc.name?.trim() || pt.document;
    const meta = [ext, sizeStr].filter(Boolean).join(' • ');
    const cap = content.message;
    return renderWithContextCards(
      <View>
        <View style={[styles.documentCard, fromMe && styles.documentCardRight]}>
          <Pressable
            style={styles.documentMainAction}
            onPress={() => Linking.openURL(docUrl)}
          >
            <View
              style={[
                styles.documentIconCircle,
                fromMe && styles.documentIconCircleRight,
              ]}
            >
              <Ionicons
                name="document-text-outline"
                size={18}
                color={colors.primary}
              />
              <Text style={styles.documentTypeText}>{extLabel}</Text>
            </View>
            <View style={styles.documentInfo}>
              <Text style={styles.documentName} numberOfLines={1}>
                {name}
              </Text>
              {meta ? <Text style={styles.documentMeta}>{meta}</Text> : null}
            </View>
          </Pressable>

          <Pressable
            style={[
              styles.documentDownloadBtn,
              fromMe && styles.documentDownloadBtnRight,
            ]}
            onPress={() => {
              void forceDownloadToDevice(
                docUrl,
                resolveDocumentDownloadName(doc),
                'document'
              );
            }}
            accessibilityLabel={pt.download}
          >
            <Ionicons
              name="download-outline"
              size={18}
              color={colors.primary}
            />
          </Pressable>
        </View>
        {cap ? (
          <Text
            style={[styles.mediaCaption, textColor, styles.documentCaption]}
          >
            {cap}
          </Text>
        ) : null}
      </View>
    );
  }

  if (type === EMessageType.contact_card && content.contact) {
    const contactDisplay =
      resolvedContactDisplay ??
      resolveContactCardDisplayData(content.contact, chatInfo);
    return renderWithContextCards(
      <View style={[styles.contactWrap, fromMe && styles.contactWrapRight]}>
        <View
          style={[
            styles.contactAvatarWrap,
            fromMe && styles.contactAvatarWrapRight,
          ]}
        >
          <AppAvatar
            uri={contactDisplay.photoUri}
            size={36}
            style={styles.contactAvatar}
            iconName="person"
            iconSize={18}
            iconColor={colors.primary}
          />
        </View>
        <View style={styles.contactInfo}>
          <Text style={styles.contactName} numberOfLines={2}>
            {contactDisplay.name}
          </Text>
          {contactDisplay.phone ? (
            <Text style={styles.contactPhone} numberOfLines={1}>
              {contactDisplay.phone}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  if (type === EMessageType.contacts && content.contacts?.length) {
    const list = content.contacts;
    const first = list[0];
    const name = first?.name ?? pt.contact;
    const extra =
      list.length > 1 ? ` e ${list.length - 1} ${pt.contacts_other}` : '';
    return renderWithContextCards(
      <View style={styles.contactWrap}>
        <Ionicons name="people" size={32} color={colors.primary} />
        <Text style={[styles.contactName, textColor]}>
          {name}
          {extra}
        </Text>
      </View>
    );
  }

  if (
    type === EMessageType.system &&
    (content.message || content.pin || content.ephemeral)
  ) {
    const text = getLatestMessageText(msg);
    return renderWithContextCards(
      <View style={styles.systemWrap}>
        {content.ephemeral ? (
          <Ionicons name="time" size={18} color={colors.grey600} />
        ) : null}
        {text ? <Text style={styles.systemText}>{text}</Text> : null}
      </View>
    );
  }

  if (content.template && type === EMessageType.text) {
    const t = content.template;
    const title = readNonEmptyString(t.hydratedTitleText);
    const body = readNonEmptyString(t.hydratedContentText);
    const templateButtons = (t.hydratedButtons ?? []).filter(
      (button) => !!readNonEmptyString(button?.displayText)
    );

    return renderWithContextCards(
      <View style={styles.templateWrap}>
        {title ? (
          <Text style={[styles.templateTitle, textColor]}>{title}</Text>
        ) : null}
        {body ? (
          <Text style={[styles.templateContent, textColor]}>{body}</Text>
        ) : null}
        {templateButtons.length > 0 ? (
          <View style={styles.templateButtons}>
            {templateButtons.map((button, index) => {
              const displayText =
                readNonEmptyString(button.displayText) ?? button.displayText;
              const disabled = disableTemplateButtons || !onTemplateButtonPress;

              return (
                <Pressable
                  key={`template-btn-${msg.message_id}-${button.id || index}`}
                  style={[
                    styles.templateButton,
                    fromMe && styles.templateButtonRight,
                    disabled && styles.templateButtonDisabled,
                  ]}
                  onPress={() => {
                    if (disabled) return;
                    onTemplateButtonPress?.(button, msg);
                  }}
                  disabled={disabled}
                >
                  <Ionicons
                    name="arrow-undo-outline"
                    size={16}
                    color={fromMe ? colors.primary : '#25D366'}
                  />
                  <Text
                    style={[
                      styles.templateButtonText,
                      fromMe && styles.templateButtonTextRight,
                    ]}
                    numberOfLines={2}
                  >
                    {displayText}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
    );
  }

  const text = getLatestMessageText(msg);
  if (
    text &&
    type !== EMessageType.image &&
    type !== EMessageType.video &&
    type !== EMessageType.video_note &&
    type !== EMessageType.document &&
    type !== EMessageType.contact_card &&
    type !== EMessageType.contacts &&
    type !== EMessageType.system
  ) {
    return renderWithContextCards(
      <Text style={[styles.bubbleText, textColor]} selectable>
        {text}
      </Text>
    );
  }

  return renderWithContextCards(null);
}

function MessageBubble({
  msg,
  fromMe,
  chatInfo,
  currentUserName,
  highlighted,
  onPressQuoted,
  resolvedContactDisplay,
  audioCtrl,
  onOpenImage,
  onOpenVideo,
  onTemplateButtonPress,
  disableTemplateButtons,
  obfuscateContent = false,
}: {
  msg: ListMessageResult;
  fromMe: boolean;
  chatInfo: ListChatsResult;
  currentUserName: string | null;
  highlighted?: boolean;
  onPressQuoted?: (() => void) | null;
  resolvedContactDisplay?: ContactCardDisplayData;
  audioCtrl: AudioCtrl | null;
  onOpenImage: (msg: ListMessageResult) => void;
  onOpenVideo: (msg: ListMessageResult) => void;
  onTemplateButtonPress?: (
    button: MessageTemplateButton,
    message: ListMessageResult
  ) => void;
  disableTemplateButtons?: boolean;
  obfuscateContent?: boolean;
}) {
  const content = msg.content;
  const timeStr = formatMessageTime(msg.date);
  const latestText = getLatestMessageText(msg).trim();
  const hasQuoted = !!content?.quoted;
  const isSystem = content?.type === EMessageType.system;
  const isAnnotation = content?.type === EMessageType.annotation;
  const isAudio = content?.type === EMessageType.audio && !!content.audio?.url;
  const isDocument =
    content?.type === EMessageType.document && !!content.document?.url;
  const isContactCard =
    content?.type === EMessageType.contact_card ||
    content?.type === EMessageType.contacts;
  const isForwarded = isForwardedMessage(content);
  const showForwardedIndicator = isForwarded && !isSystem && !isAnnotation;
  const reactionsSummary = getReactionsSummary(content?.reactions);
  const showReactionsSummary =
    reactionsSummary.length > 0 &&
    !isAnnotation &&
    !isSystem &&
    !obfuscateContent;
  const isShortTextMessage =
    latestText.length > 0 &&
    latestText.length <= 8 &&
    !isSystem &&
    !isAnnotation &&
    !isAudio &&
    !isDocument &&
    !isContactCard &&
    !content?.image?.url &&
    !content?.video?.url &&
    !content?.sticker?.url &&
    !content?.location &&
    !content?.template &&
    !content?.link_preview &&
    !content?.context_info?.external_ad_reply;
  const hasContent =
    content &&
    (content.type === EMessageType.system ||
      content.type === EMessageType.view_once ||
      content.image?.url ||
      content.video?.url ||
      content.sticker?.url ||
      content.link_preview ||
      content.context_info?.external_ad_reply ||
      (content.location?.latitude != null &&
        content.location?.longitude != null) ||
      content.audio?.url ||
      content.document?.url ||
      content.contact ||
      (content.contacts && content.contacts.length > 0) ||
      showForwardedIndicator ||
      content.quoted ||
      content.message ||
      content.template);

  if (!content || !hasContent) {
    return (
      <View
        style={[
          styles.bubbleWrap,
          fromMe ? styles.bubbleWrapRight : styles.bubbleWrapLeft,
        ]}
      >
        <View
          style={[
            styles.bubble,
            fromMe ? styles.bubbleRight : styles.bubbleLeft,
            isAnnotation && styles.bubbleAnnotation,
            hasQuoted && styles.bubbleQuotedMinWidth,
            isShortTextMessage && styles.bubbleShortMinWidth,
            highlighted && styles.bubbleHighlighted,
          ]}
        >
          {showForwardedIndicator ? (
            <View style={styles.forwardedIndicator}>
              <Ionicons
                name="return-up-back-outline"
                size={14}
                style={[
                  styles.forwardedIcon,
                  fromMe
                    ? styles.forwardedColorRight
                    : styles.forwardedColorLeft,
                ]}
              />
              <Text
                style={[
                  styles.forwardedText,
                  fromMe
                    ? styles.forwardedColorRight
                    : styles.forwardedColorLeft,
                ]}
              >
                {pt.forwarded}
              </Text>
            </View>
          ) : null}
          <View style={styles.bubbleMeta}>
            {timeStr ? (
              <Text
                style={[
                  styles.bubbleTime,
                  fromMe ? styles.bubbleTimeRight : styles.bubbleTimeLeft,
                ]}
              >
                {timeStr}
              </Text>
            ) : null}
            <Ionicons
              name="checkmark-done"
              size={14}
              color={fromMe ? colors.bubbleSentTime : colors.grey600}
            />
          </View>
        </View>
      </View>
    );
  }

  const wrapAlign = isSystem ? 'center' : fromMe ? 'flex-end' : 'flex-start';
  const bubbleBg = isAnnotation
    ? '#FFF3CD'
    : isSystem
      ? 'rgba(47, 43, 61, 0.08)'
      : fromMe
        ? colors.bubbleSent
        : colors.surface;

  return (
    <View
      style={[
        styles.bubbleWrap,
        wrapAlign === 'center' && styles.bubbleWrapCenter,
        wrapAlign === 'flex-end' && styles.bubbleWrapRight,
        wrapAlign === 'flex-start' && styles.bubbleWrapLeft,
      ]}
    >
      <View
        style={[
          styles.bubble,
          { backgroundColor: bubbleBg },
          isSystem && styles.bubbleSystem,
          isContactCard && styles.bubbleContact,
          isAudio && styles.bubbleAudio,
          isDocument && styles.bubbleDocument,
          hasQuoted && styles.bubbleQuotedMinWidth,
          isShortTextMessage && styles.bubbleShortMinWidth,
          highlighted && styles.bubbleHighlighted,
        ]}
      >
        {showForwardedIndicator ? (
          <View style={styles.forwardedIndicator}>
            <Ionicons
              name="return-up-back-outline"
              size={14}
              style={[
                styles.forwardedIcon,
                fromMe ? styles.forwardedColorRight : styles.forwardedColorLeft,
              ]}
            />
            <Text
              style={[
                styles.forwardedText,
                fromMe ? styles.forwardedColorRight : styles.forwardedColorLeft,
              ]}
            >
              {pt.forwarded}
            </Text>
          </View>
        ) : null}
        <QuotedReplyPreview
          msg={msg}
          fromMe={fromMe}
          chatInfo={chatInfo}
          currentUserName={currentUserName}
          onPressQuoted={onPressQuoted}
          obfuscateContent={obfuscateContent}
        />
        <BubbleContent
          msg={msg}
          fromMe={fromMe}
          content={content}
          chatInfo={chatInfo}
          resolvedContactDisplay={resolvedContactDisplay}
          audioCtrl={audioCtrl}
          onOpenImage={onOpenImage}
          onOpenVideo={onOpenVideo}
          onTemplateButtonPress={onTemplateButtonPress}
          disableTemplateButtons={disableTemplateButtons}
          obfuscateContent={obfuscateContent}
        />
        <View
          style={[
            styles.bubbleMeta,
            isAudio && styles.bubbleMetaAudio,
            isDocument && styles.bubbleMetaDocument,
          ]}
        >
          {timeStr ? (
            <Text
              style={[
                styles.bubbleTime,
                fromMe ? styles.bubbleTimeRight : styles.bubbleTimeLeft,
              ]}
            >
              {timeStr}
            </Text>
          ) : null}
          <Ionicons
            name="checkmark-done"
            size={14}
            color={fromMe ? colors.bubbleSentTime : colors.grey600}
          />
        </View>
      </View>
      {showReactionsSummary ? (
        <View
          style={[
            styles.reactionsSummary,
            fromMe ? styles.reactionsSummaryRight : styles.reactionsSummaryLeft,
            isContactCard && styles.reactionsSummaryContact,
          ]}
        >
          <View style={styles.reactionSummaryBubble}>
            {reactionsSummary.map((reaction) => (
              <View key={reaction.emoji} style={styles.reactionSummaryItem}>
                <Text style={styles.reactionSummaryEmoji}>
                  {reaction.emoji}
                </Text>
                <Text style={styles.reactionSummaryCount}>
                  {reaction.count}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function ChatRoomScreen({ route, navigation }: Props) {
  const { chat, mode = 'default' } = route.params;
  const isHistoryReadonly = mode === 'history_readonly';
  const { setChatCounts, clearAdvancedFilters } = useChatFilter();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<MessageWithSeparator> | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micPressActiveRef = useRef(false);
  const micStartXRef = useRef<number | null>(null);
  const micStartYRef = useRef<number | null>(null);
  const pendingReleaseBeforeReadyRef = useRef(false);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recordingActiveRef = useRef(false);
  const recordingStartTokenRef = useRef(0);
  const cancelArmedRef = useRef(false);
  const messageInputRef = useRef<TextInput | null>(null);
  const inputRef = useRef('');
  const sendingRef = useRef(false);
  const isQueueOrUraStatusRef = useRef(false);
  const sendingCapturedMediaRef = useRef(false);
  const sendingVoiceRecordingRef = useRef(false);
  const documentPickerActiveRef = useRef(false);
  const isRecordingVoiceRef = useRef(false);
  const isRecordingLockedRef = useRef(false);
  const isPreparingRecordingRef = useRef(false);
  const pendingScrollToBottomRef = useRef(true);
  const scrollOffsetRef = useRef(0);
  const contentHeightRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const currentPageRef = useRef(1);
  const totalPagesRef = useRef(1);
  const socketSyncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  const attendanceHistoryErrorAlertShownRef = useRef(false);
  const lastSocketSyncTimeRef = useRef(0);
  const clearSummaryAttemptedForChatRef = useRef<string | null>(null);
  const preserveScrollOnPrependRef = useRef<{
    previousOffset: number;
    previousContentHeight: number;
  } | null>(null);
  const messagesRef = useRef<ListMessageResult[]>([]);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [chatInfo, setChatInfo] = useState(chat);
  const [permissionList, setPermissionList] = useState<string[]>([]);
  const [userSectors, setUserSectors] = useState<string[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [currentUserStatus, setCurrentUserStatus] =
    useState<ChatUserStatus>('offline');
  const [inChatCountForWorker, setInChatCountForWorker] = useState(0);
  const [isAttendReopenLoading, setIsAttendReopenLoading] = useState(false);
  const [canPreviewProtectedContent, setCanPreviewProtectedContent] =
    useState(false);
  const [workerConfigForChat, setWorkerConfigForChat] =
    useState<WorkerConfigForChat | null>(null);
  const [headerPhoneDecrypted, setHeaderPhoneDecrypted] = useState<
    string | null
  >(null);
  const [isHeaderPhoneDecrypted, setIsHeaderPhoneDecrypted] = useState(false);
  const [isHeaderPhoneLoading, setIsHeaderPhoneLoading] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [protocolModalVisible, setProtocolModalVisible] = useState(false);
  const [labelModalVisible, setLabelModalVisible] = useState(false);
  const [isLoadingLabelModal, setIsLoadingLabelModal] = useState(false);
  const [isSavingLabelModal, setIsSavingLabelModal] = useState(false);
  const [labelTemplates, setLabelTemplates] = useState<LabelTemplate[]>([]);
  const [selectedLabelTemplateIds, setSelectedLabelTemplateIds] = useState<
    string[]
  >([]);
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchMessageResultItem[]>(
    []
  );
  const [searchCurrentPage, setSearchCurrentPage] = useState(1);
  const [searchTotalPages, setSearchTotalPages] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
  const [attendanceHistoryVisible, setAttendanceHistoryVisible] =
    useState(false);
  const [attendanceHistory, setAttendanceHistory] = useState<ListChatsResult[]>(
    []
  );
  const [attendanceHistoryPage, setAttendanceHistoryPage] = useState(1);
  const [attendanceHistoryTotalPages, setAttendanceHistoryTotalPages] =
    useState(0);
  const [attendanceHistoryLoading, setAttendanceHistoryLoading] =
    useState(false);
  const [attendanceHistoryLoadingMore, setAttendanceHistoryLoadingMore] =
    useState(false);
  const [transferModalVisible, setTransferModalVisible] = useState(false);
  const [transferType, setTransferType] =
    useState<TransferDestinationType>(null);
  const [transferPickerKind, setTransferPickerKind] =
    useState<TransferPickerKind>(null);
  const [transferAnnotation, setTransferAnnotation] = useState('');
  const [selectedTransferChannelId, setSelectedTransferChannelId] = useState<
    string | null
  >(null);
  const [selectedTransferUserId, setSelectedTransferUserId] = useState<
    string | null
  >(null);
  const [selectedTransferSectorId, setSelectedTransferSectorId] = useState<
    string | null
  >(null);
  const [selectedTransferSectorUserId, setSelectedTransferSectorUserId] =
    useState<string | null>(null);
  const [transferChannels, setTransferChannels] = useState<
    TransferChannelOption[]
  >([]);
  const [transferUsers, setTransferUsers] = useState<TransferUserOption[]>([]);
  const [transferSectors, setTransferSectors] = useState<
    TransferSectorOption[]
  >([]);
  const [transferSectorUsers, setTransferSectorUsers] = useState<
    TransferUserOption[]
  >([]);
  const [isLoadingTransferChannels, setIsLoadingTransferChannels] =
    useState(false);
  const [isLoadingTransferUsers, setIsLoadingTransferUsers] = useState(false);
  const [isLoadingTransferSectors, setIsLoadingTransferSectors] =
    useState(false);
  const [isLoadingTransferSectorUsers, setIsLoadingTransferSectorUsers] =
    useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [isTogglingForwardToOutput, setIsTogglingForwardToOutput] =
    useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [remoteActivityMode, setRemoteActivityMode] =
    useState<RemoteActivityMode | null>(null);
  const [showScrollToBottomButton, setShowScrollToBottomButton] =
    useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<
    string | null
  >(null);
  const [messages, setMessages] = useState<ListMessageResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [viewer, setViewer] = useState<MediaViewerState>({
    visible: false,
    kind: 'image',
    src: '',
    caption: '',
    downloadName: '',
  });
  const [cameraPickerVisible, setCameraPickerVisible] = useState(false);
  const [annotationModalVisible, setAnnotationModalVisible] = useState(false);
  const [annotationInput, setAnnotationInput] = useState('');
  const [sendingAnnotation, setSendingAnnotation] = useState(false);
  const [contactPickerVisible, setContactPickerVisible] = useState(false);
  const [contactPickerSearch, setContactPickerSearch] = useState('');
  const [debouncedContactSearch, setDebouncedContactSearch] = useState('');
  const [contactPickerItems, setContactPickerItems] = useState<
    ListChatContactResult[]
  >([]);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [contactPickerPage, setContactPickerPage] = useState(1);
  const [contactPickerTotalPages, setContactPickerTotalPages] = useState(1);
  const [loadingContactPicker, setLoadingContactPicker] = useState(false);
  const [loadingMoreContactPicker, setLoadingMoreContactPicker] =
    useState(false);
  const [locationPickerVisible, setLocationPickerVisible] = useState(false);
  const [locationPickerMode, setLocationPickerMode] =
    useState<LocationPickerMode>('current');
  const [locationLatitudeInput, setLocationLatitudeInput] = useState('');
  const [locationLongitudeInput, setLocationLongitudeInput] = useState('');
  const [locationNameInput, setLocationNameInput] = useState('');
  const [locationAddressInput, setLocationAddressInput] = useState('');
  const [locationCurrentLoading, setLocationCurrentLoading] = useState(false);
  const [locationCurrentError, setLocationCurrentError] = useState(false);
  const [sendingCapturedMedia, setSendingCapturedMedia] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [isMicPressActive, setIsMicPressActive] = useState(false);
  const [isRecordingLocked, setIsRecordingLocked] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [isPreparingRecording, setIsPreparingRecording] = useState(false);
  const [sendingVoiceRecording, setSendingVoiceRecording] = useState(false);
  const [isRecordingCancelArmed, setIsRecordingCancelArmed] = useState(false);
  const [recordingWaveform, setRecordingWaveform] = useState<number[]>([]);
  const [showRecordingHint, setShowRecordingHint] = useState(false);
  const [resolvedContactCards, setResolvedContactCards] = useState<
    Record<string, ContactCardDisplayData>
  >({});
  const resolvingContactCards = useRef<Set<string>>(new Set());
  const resolvedContactLookupDone = useRef<Set<string>>(new Set());
  const [downloadingViewerMedia, setDownloadingViewerMedia] = useState(false);
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
  const typingLabel = useMemo(() => {
    const typingStatus =
      remoteActivityMode === 'recording' ? pt.is_recording_audio : pt.is_typing;
    return `${resolveTypingDisplayName(chatInfo)} ${typingStatus}`;
  }, [
    chatInfo.contact?.name,
    chatInfo.name,
    chatInfo.contact?.phone_ddi,
    chatInfo.contact?.phone,
    chatInfo.phone,
    remoteActivityMode,
  ]);
  const audioCtrl = useChatAudio();
  const viewerVideoPlayer = useVideoPlayer(
    viewer.kind === 'video' && viewer.src ? { uri: viewer.src } : null,
    (player) => {
      player.loop = false;
    }
  );
  const activeChatLabels = useMemo<ChatLabel[]>(() => {
    if (!Array.isArray(chatInfo.label)) return [];
    return chatInfo.label;
  }, [chatInfo.label]);
  const primaryChatLabel = useMemo(
    () => activeChatLabels[0] ?? null,
    [activeChatLabels]
  );
  const remainingChatLabelsCount = Math.max(0, activeChatLabels.length - 1);
  const maskedHeaderPhone = useMemo(() => {
    const contactPhone = readNonEmptyString(chatInfo.contact?.phone);
    const contactDdi = readNonEmptyString(chatInfo.contact?.phone_ddi);
    if (contactPhone && contactDdi) {
      return `+${contactDdi} ${contactPhone}`;
    }
    if (contactPhone) return contactPhone;
    return chatInfo.phone ?? '';
  }, [chatInfo.contact?.phone, chatInfo.contact?.phone_ddi, chatInfo.phone]);
  const headerPhoneValue = useMemo(() => {
    if (!isHeaderPhoneDecrypted || !headerPhoneDecrypted) {
      return maskedHeaderPhone;
    }
    const contactDdi = readNonEmptyString(chatInfo.contact?.phone_ddi);
    return formatPhoneWithDdi(headerPhoneDecrypted, contactDdi);
  }, [
    chatInfo.contact?.phone_ddi,
    headerPhoneDecrypted,
    isHeaderPhoneDecrypted,
    maskedHeaderPhone,
  ]);
  const protocolList = useMemo<ProtocolWithType[]>(() => {
    const unique = new Map<string, ProtocolType>();
    const appendProtocols = (
      protocols: string[] | null | undefined,
      type: ProtocolType
    ) => {
      if (!Array.isArray(protocols) || protocols.length === 0) return;
      for (const item of protocols) {
        const normalized = readNonEmptyString(item);
        if (!normalized || unique.has(normalized)) continue;
        unique.set(normalized, type);
      }
    };

    appendProtocols(chatInfo.protocol_start, 'A');
    appendProtocols(chatInfo.protocol_transfer, 'T');
    appendProtocols(chatInfo.protocol_ura, 'U');
    return Array.from(unique.entries()).map(([protocol, type]) => ({
      protocol,
      type,
    }));
  }, [
    chatInfo.protocol_start,
    chatInfo.protocol_transfer,
    chatInfo.protocol_ura,
  ]);
  const primaryProtocol = protocolList[0] ?? null;
  const extraProtocolCount = Math.max(0, protocolList.length - 1);
  const showProtocolInHeader =
    workerConfigForChat?.show_protocol_in_chat === true &&
    protocolList.length > 0;

  useEffect(() => {
    setChatInfo(chat);
  }, [chat]);

  useEffect(() => {
    pendingScrollToBottomRef.current = true;
    scrollOffsetRef.current = 0;
    contentHeightRef.current = 0;
    loadingOlderRef.current = false;
    currentPageRef.current = 1;
    totalPagesRef.current = 1;
    clearSummaryAttemptedForChatRef.current = null;
    preserveScrollOnPrependRef.current = null;
    setMessages([]);
    setLoading(true);
    setHighlightedMessageId(null);
    setShowScrollToBottomButton(false);
    setLoadingOlder(false);
  }, [chatInfo.chat_id]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    getUser().then((user) => {
      if (!isMounted) return;
      const userName = resolveStoredUserName(user);
      setCurrentUserId(resolveUserId(user));
      setCurrentUserName(userName);
      setCurrentUserStatus(resolveStoredUserStatus(user));
    });

    getPermissions().then((permissions) => {
      if (!isMounted) return;
      setPermissionList(permissions);
      setCanPreviewProtectedContent(canPreviewChatContent(permissions));
    });

    getSectors().then((sectors) => {
      if (!isMounted) return;
      setUserSectors(sectors);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const workerId = readNonEmptyString(chatInfo.worker?.id);
    if (!workerId) {
      setWorkerConfigForChat(null);
      return;
    }

    let cancelled = false;
    viewWorkerConfigForChat(workerId)
      .then((config) => {
        if (cancelled) return;
        setWorkerConfigForChat(config);
      })
      .catch(() => {
        if (cancelled) return;
        setWorkerConfigForChat(null);
      });

    return () => {
      cancelled = true;
    };
  }, [chatInfo.worker?.id]);

  const isQueueOrUraStatus =
    chatInfo.status === 'queue' ||
    chatInfo.status === 'ura' ||
    chatInfo.status === 'ura_output' ||
    chatInfo.status === 'ura_schedule' ||
    chatInfo.status === 'ura_webhook';
  const isClosedStatus = chatInfo.status === 'closed';

  useEffect(() => {
    const workerId = readNonEmptyString(chatInfo.worker?.id);
    if (
      !workerId ||
      !currentUserId ||
      (!isQueueOrUraStatus && !isClosedStatus)
    ) {
      setInChatCountForWorker(0);
      return;
    }

    let cancelled = false;
    searchChats({
      search: '',
      status: 'in_chat',
      current_page: 1,
      per_page: 1,
      filter_worker_id: workerId,
      filter_user_id: currentUserId,
    })
      .then((result) => {
        if (cancelled) return;
        const total =
          typeof result?.total === 'number'
            ? result.total
            : typeof result?.count === 'number'
              ? result.count
              : 0;
        setInChatCountForWorker(total);
      })
      .catch(() => {
        if (cancelled) return;
        setInChatCountForWorker(0);
      });

    return () => {
      cancelled = true;
    };
  }, [chatInfo.worker?.id, currentUserId, isClosedStatus, isQueueOrUraStatus]);

  useEffect(() => {
    setHeaderPhoneDecrypted(null);
    setIsHeaderPhoneDecrypted(false);
    setIsHeaderPhoneLoading(false);
    setMenuVisible(false);
    setProtocolModalVisible(false);
    setLabelModalVisible(false);
    setSearchModalVisible(false);
    setAttendanceHistoryVisible(false);
    setTransferModalVisible(false);
  }, [chatInfo.chat_id]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 500);

    return () => {
      clearTimeout(timer);
    };
  }, [searchQuery]);

  const clearTypingTimeout = useCallback(() => {
    if (!typingTimeoutRef.current) return;
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = null;
  }, []);

  const setTypingIndicator = useCallback(
    (mode: RemoteActivityMode | null) => {
      clearTypingTimeout();
      if (!mode) {
        setIsTyping(false);
        setRemoteActivityMode(null);
        return;
      }

      setIsTyping(true);
      setRemoteActivityMode(mode);
      typingTimeoutRef.current = setTimeout(() => {
        setIsTyping(false);
        setRemoteActivityMode(null);
        typingTimeoutRef.current = null;
      }, TYPING_TIMEOUT_MS);
    },
    [clearTypingTimeout]
  );

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    setTypingIndicator(null);
  }, [chatInfo.chat_id, setTypingIndicator]);

  useEffect(() => {
    return () => {
      clearTypingTimeout();
    };
  }, [clearTypingTimeout]);

  useEffect(() => {
    if (viewer.visible && viewer.kind === 'video') {
      return;
    }

    try {
      viewerVideoPlayer.pause();
      viewerVideoPlayer.currentTime = 0;
    } catch {}
  }, [viewer.kind, viewer.visible, viewerVideoPlayer]);

  useEffect(() => {
    const useNative = Platform.OS !== 'web';
    if (!showRecordingHint) {
      recordingHintOpacity.stopAnimation();
      recordingHintOffset.stopAnimation();
      recordingHintOpacity.setValue(0);
      recordingHintOffset.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(recordingHintOffset, {
          toValue: -10,
          duration: 540,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: useNative,
        }),
        Animated.timing(recordingHintOffset, {
          toValue: -2,
          duration: 420,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: useNative,
        }),
      ])
    );

    Animated.timing(recordingHintOpacity, {
      toValue: 1,
      duration: 160,
      useNativeDriver: useNative,
    }).start();

    loop.start();
    return () => {
      loop.stop();
    };
  }, [recordingHintOffset, recordingHintOpacity, showRecordingHint]);

  useEffect(() => {
    const useNative = Platform.OS !== 'web';

    if (!isRecordingVoice || isRecordingPaused) {
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
          useNativeDriver: useNative,
        }),
        Animated.timing(recordingPulse, {
          toValue: 1,
          duration: 560,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: useNative,
        }),
      ])
    );

    loop.start();
    return () => {
      loop.stop();
    };
  }, [isRecordingPaused, isRecordingVoice, recordingPulse]);

  useEffect(() => {
    if (!isRecordingVoice || isRecordingPaused) return;

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
    isRecordingVoice,
    recorderState.durationMillis,
    recorderState.metering,
  ]);

  const closeMediaViewer = useCallback(() => {
    setViewer({
      visible: false,
      kind: 'image',
      src: '',
      caption: '',
      downloadName: '',
    });
    setDownloadingViewerMedia(false);
  }, []);

  const openImageViewer = useCallback((msg: ListMessageResult) => {
    const sticker = msg.content?.sticker;
    const stickerUrl = sticker?.url;
    if (stickerUrl) {
      const stickerSrc = resolveMediaUri(stickerUrl);
      if (!stickerSrc) return;
      if (!isRenderableSticker(sticker)) {
        void forceDownloadToDevice(
          stickerSrc,
          resolveStickerDownloadName(msg),
          'document'
        );
        return;
      }
      setViewer({
        visible: true,
        kind: 'image',
        src: stickerSrc,
        caption: '',
        downloadName: resolveStickerDownloadName(msg),
      });
      return;
    }

    const imageUrl = msg.content?.image?.url;
    if (!imageUrl) return;
    const imageSrc = resolveMediaUri(imageUrl);
    if (!imageSrc) return;

    setViewer({
      visible: true,
      kind: 'image',
      src: imageSrc,
      caption: msg.content?.image?.caption ?? '',
      downloadName: resolveImageDownloadName(msg, imageSrc),
    });
  }, []);

  const openVideoViewer = useCallback((msg: ListMessageResult) => {
    const video = msg.content?.video;
    if (!video?.url) return;
    const videoSrc = resolveMediaUri(video.url);
    if (!videoSrc) return;

    setViewer({
      visible: true,
      kind: 'video',
      src: videoSrc,
      caption: video.caption ?? msg.content?.message ?? '',
      downloadName: resolveVideoDownloadName(video),
    });
  }, []);

  const resolveContactCardForMessage = useCallback(
    async (message: ListMessageResult) => {
      const contact = message.content?.contact;
      if (!contact) return;

      const messageId = message.message_id;
      if (
        resolvedContactLookupDone.current.has(messageId) ||
        resolvingContactCards.current.has(messageId)
      ) {
        return;
      }

      const fallback = resolveContactCardDisplayData(contact, chatInfo);
      setResolvedContactCards((prev) =>
        prev[messageId] ? prev : { ...prev, [messageId]: fallback }
      );

      resolvingContactCards.current.add(messageId);
      try {
        let lookup: ChatContactLookupResult | null = null;
        const contactId = contact.contact_id?.trim();
        if (contactId) {
          lookup = await getChatContactById(contactId);
        }

        if (!lookup) {
          const phone = normalizePhoneDigits(
            contact.phone ?? contact.phone_partial
          );
          const phoneDdi =
            contact.phone_ddi?.trim() ||
            chatInfo.contact?.phone_ddi?.trim() ||
            '55';
          if (phone) {
            lookup = await getChatContactByPhone(phone, phoneDdi);
          }
        }

        const resolved = buildContactCardDisplayFromLookup(lookup, fallback);
        setResolvedContactCards((prev) => ({ ...prev, [messageId]: resolved }));
      } catch {
        setResolvedContactCards((prev) => ({ ...prev, [messageId]: fallback }));
      } finally {
        resolvingContactCards.current.delete(messageId);
        resolvedContactLookupDone.current.add(messageId);
      }
    },
    [chatInfo]
  );

  useEffect(() => {
    setResolvedContactCards({});
    resolvingContactCards.current.clear();
    resolvedContactLookupDone.current.clear();
  }, [chatInfo.chat_id]);

  useEffect(() => {
    for (const message of messages) {
      if (
        message.content?.type !== EMessageType.contact_card ||
        !message.content.contact
      ) {
        continue;
      }
      void resolveContactCardForMessage(message);
    }
  }, [messages, resolveContactCardForMessage]);

  const handleDownloadViewerMedia = useCallback(async () => {
    if (!viewer.src || downloadingViewerMedia) return;

    setDownloadingViewerMedia(true);
    try {
      const defaultName =
        viewer.kind === 'video'
          ? `video-${Date.now()}.mp4`
          : `imagem-${Date.now()}.jpg`;
      const fileName = viewer.downloadName || defaultName;
      await forceDownloadToDevice(viewer.src, fileName, viewer.kind);
    } catch {
    } finally {
      setDownloadingViewerMedia(false);
    }
  }, [downloadingViewerMedia, viewer.downloadName, viewer.kind, viewer.src]);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listMessages(
        chatInfo.chat_id,
        1,
        CHAT_MESSAGES_PER_PAGE
      );
      if (!res) {
        setMessages([]);
        currentPageRef.current = 1;
        totalPagesRef.current = 1;
        preserveScrollOnPrependRef.current = null;
        return;
      }

      const baseMessages = [...res.results].reverse();
      const pending = consumePendingMessages(chatInfo.chat_id);
      const mergedMessages = mergePendingSocketMessages(baseMessages, pending);

      currentPageRef.current = toPositiveInt(res.current_page, 1);
      totalPagesRef.current = toPositiveInt(res.total_pages, 1);
      preserveScrollOnPrependRef.current = null;
      pendingScrollToBottomRef.current = true;

      setMessages(mergedMessages);
    } finally {
      setLoading(false);
    }
  }, [chatInfo.chat_id]);

  const syncLatestMessages = useCallback(async () => {
    const res = await listMessages(chatInfo.chat_id, 1, CHAT_MESSAGES_PER_PAGE);
    if (!res) return;
    const latestMessages = [...res.results].reverse();
    setMessages((prev) => mergeMessageBatch(prev, latestMessages));
  }, [chatInfo.chat_id]);

  const syncMessagesStatus = useCallback(
    async (force = false) => {
      const now = Date.now();
      if (
        !force &&
        now - lastSocketSyncTimeRef.current < CHAT_SOCKET_SYNC_DEBOUNCE_MS
      ) {
        return;
      }
      lastSocketSyncTimeRef.current = now;

      const res = await listMessages(
        chatInfo.chat_id,
        1,
        CHAT_SOCKET_SYNC_PER_PAGE
      );
      if (!res) return;

      const latestMessages = [...res.results].reverse();
      setMessages((prev) => mergeMessageBatch(prev, latestMessages));
    },
    [chatInfo.chat_id]
  );

  const loadOlderMessages = useCallback(async () => {
    if (loading || loadingOlderRef.current) return;
    if (currentPageRef.current >= totalPagesRef.current) return;

    loadingOlderRef.current = true;
    setLoadingOlder(true);
    preserveScrollOnPrependRef.current = {
      previousOffset: scrollOffsetRef.current,
      previousContentHeight: contentHeightRef.current,
    };

    try {
      const nextPage = currentPageRef.current + 1;
      const res = await listMessages(
        chatInfo.chat_id,
        nextPage,
        CHAT_MESSAGES_PER_PAGE
      );

      if (!res) {
        preserveScrollOnPrependRef.current = null;
        return;
      }

      currentPageRef.current = toPositiveInt(res.current_page, nextPage);
      totalPagesRef.current = Math.max(
        currentPageRef.current,
        toPositiveInt(res.total_pages, totalPagesRef.current)
      );

      const olderMessages = [...res.results].reverse();
      if (olderMessages.length === 0) {
        preserveScrollOnPrependRef.current = null;
        return;
      }

      setMessages((prev) => mergeMessageBatch(prev, olderMessages));
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [chatInfo.chat_id, loading]);

  const handleListScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetY = event.nativeEvent.contentOffset.y;
      const viewportHeight = event.nativeEvent.layoutMeasurement.height;
      const contentHeight =
        event.nativeEvent.contentSize.height || contentHeightRef.current;
      const distanceFromBottom = Math.max(
        0,
        contentHeight - (offsetY + viewportHeight)
      );
      scrollOffsetRef.current = offsetY;

      if (pendingScrollToBottomRef.current) {
        if (distanceFromBottom <= SHOW_SCROLL_TO_BOTTOM_THRESHOLD) {
          setShowScrollToBottomButton(false);
        }
        return;
      }

      setShowScrollToBottomButton(
        distanceFromBottom > SHOW_SCROLL_TO_BOTTOM_THRESHOLD
      );

      if (offsetY <= LOAD_OLDER_SCROLL_THRESHOLD) {
        void loadOlderMessages();
      }
    },
    [loadOlderMessages]
  );

  const scrollToBottomWithRetries = useCallback((retries = 8) => {
    const attempt = (remaining: number) => {
      if (!pendingScrollToBottomRef.current) return;

      listRef.current?.scrollToEnd({ animated: false });
      setShowScrollToBottomButton(false);

      if (remaining <= 0) {
        pendingScrollToBottomRef.current = false;
        scrollOffsetRef.current = Math.max(0, contentHeightRef.current);
        return;
      }

      setTimeout(() => {
        attempt(remaining - 1);
      }, 80);
    };

    attempt(retries);
  }, []);

  const jumpToBottom = useCallback(() => {
    pendingScrollToBottomRef.current = true;
    setShowScrollToBottomButton(false);
    scrollToBottomWithRetries(12);
  }, [scrollToBottomWithRetries]);

  const handleListContentSizeChange = useCallback(
    (_width: number, height: number) => {
      contentHeightRef.current = height;

      const preserveData = preserveScrollOnPrependRef.current;
      if (preserveData && height >= preserveData.previousContentHeight) {
        const delta = height - preserveData.previousContentHeight;
        const targetOffset = Math.max(0, preserveData.previousOffset + delta);
        preserveScrollOnPrependRef.current = null;

        requestAnimationFrame(() => {
          listRef.current?.scrollToOffset({
            offset: targetOffset,
            animated: false,
          });
          scrollOffsetRef.current = targetOffset;
        });
        return;
      }

      if (pendingScrollToBottomRef.current && !loading) {
        scrollToBottomWithRetries();
      }
    },
    [loading, scrollToBottomWithRetries]
  );

  const messagesWithSeparators = useMemo((): MessageWithSeparator[] => {
    const list: MessageWithSeparator[] = [];
    let lastDate: string | null = null;
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const messageDate = message.date;
      if (!lastDate || !isSameDay(messageDate, lastDate)) {
        list.push({
          type: 'separator',
          separatorDate: messageDate,
          separatorLabel: formatDateSeparator(messageDate),
        });
        lastDate = messageDate;
      }
      list.push({ type: 'message', message });
    }
    return list;
  }, [messages]);

  const messageIdSet = useMemo(
    () => new Set(messages.map((message) => message.message_id)),
    [messages]
  );

  useEffect(() => {
    if (loading) return;
    if (!pendingScrollToBottomRef.current) return;
    if (messagesWithSeparators.length === 0) return;
    scrollToBottomWithRetries();
  }, [loading, messagesWithSeparators.length, scrollToBottomWithRetries]);

  const scrollToMessageById = useCallback(
    (targetMessageId: string) => {
      const targetIndex = messagesWithSeparators.findIndex(
        (item) =>
          item.type === 'message' && item.message.message_id === targetMessageId
      );
      if (targetIndex < 0) return;

      listRef.current?.scrollToIndex({
        index: targetIndex,
        animated: true,
        viewPosition: 0.5,
      });

      setHighlightedMessageId(targetMessageId);

      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
      highlightTimerRef.current = setTimeout(() => {
        setHighlightedMessageId((current) =>
          current === targetMessageId ? null : current
        );
        highlightTimerRef.current = null;
      }, 2200);
    },
    [messagesWithSeparators]
  );

  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      if (!listRef.current) return;

      const fallbackOffset =
        info.averageItemLength > 0 ? info.averageItemLength * info.index : 0;
      listRef.current.scrollToOffset({
        offset: Math.max(0, fallbackOffset),
        animated: true,
      });

      setTimeout(() => {
        listRef.current?.scrollToIndex({
          index: info.index,
          animated: true,
          viewPosition: 0.5,
        });
      }, 120);
    },
    []
  );

  useFocusEffect(
    useCallback(() => {
      pendingScrollToBottomRef.current = true;
      scrollOffsetRef.current = 0;
      contentHeightRef.current = 0;
      lastSocketSyncTimeRef.current = 0;
      preserveScrollOnPrependRef.current = null;
      setShowScrollToBottomButton(false);
      void loadMessages();
    }, [loadMessages])
  );

  useEffect(() => {
    const chatId = chatInfo.chat_id;
    if (!chatId) return;
    if (loading) return;
    if (clearSummaryAttemptedForChatRef.current === chatId) return;
    clearSummaryAttemptedForChatRef.current = chatId;
    void clearChatSummary(chatId).then((didClear) => {
      if (!didClear) return;
      setChatInfo((prev) => {
        if (!prev.summary) return prev;
        if (prev.summary.unread_count === 0) return prev;
        return {
          ...prev,
          summary: {
            ...prev.summary,
            unread_count: 0,
          },
        };
      });
    });
  }, [loading, chatInfo.chat_id]);

  const handleSocketMessage = useCallback(
    (payload: SocketMessagePayload) => {
      if (payload.chat_id !== chatInfo.chat_id) return;
      setTypingIndicator(null);

      const incomingMessageId = readNonEmptyString(payload.message_id);
      const shouldAutoScroll =
        !!incomingMessageId &&
        !messagesRef.current.some(
          (message) => message.message_id === incomingMessageId
        );

      if (shouldAutoScroll) {
        pendingScrollToBottomRef.current = true;
        setShowScrollToBottomButton(false);
      }

      const normalized = normalizeSocketMessageToListMessage(payload);
      if (!normalized) return;
      setMessages((prev) => mergeMessageLists(prev, normalized));

      if (shouldAutoScroll) {
        requestAnimationFrame(() => {
          scrollToBottomWithRetries(10);
        });
      }
    },
    [chatInfo.chat_id, setTypingIndicator, scrollToBottomWithRetries]
  );

  const handleSocketTyping = useCallback(
    (payload: SocketTypingPayload) => {
      const activeChatId = chatInfo.chat_id;
      if (!activeChatId) return;

      const payloadChatId = readNonEmptyString(payload.chat_id);
      if (payloadChatId && payloadChatId !== activeChatId) {
        return;
      }

      if (!payloadChatId) {
        const eventJid = readNonEmptyString(payload.jid);
        if (!eventJid) return;
        if (!checkTypingJidMatches(eventJid, messagesRef.current)) {
          return;
        }
      }

      setTypingIndicator(resolveSocketTypingMode(payload));
    },
    [chatInfo.chat_id, setTypingIndicator]
  );

  const handleSocketChatUpdate = useCallback(
    (payload: SocketChatPayload) => {
      if (payload.chat_id !== chatInfo.chat_id) return;

      setChatInfo((prev) => {
        const next = { ...prev };
        const incoming = payload as Record<string, unknown>;

        const status = readNonEmptyString(incoming.status);
        if (status) {
          next.status = status as typeof prev.status;
        }

        const name = readNonEmptyString(incoming.name);
        if (name) {
          next.name = name;
        }

        const phone = readNonEmptyString(incoming.phone);
        if (phone) {
          next.phone = phone;
        }

        const photo = readNonEmptyString(incoming.photo);
        if (photo) {
          next.photo = photo;
        }

        if (incoming.contact && typeof incoming.contact === 'object') {
          next.contact = {
            ...(next.contact ?? {}),
            ...(incoming.contact as NonNullable<typeof prev.contact>),
          };
        }

        if (incoming.user && typeof incoming.user === 'object') {
          next.user = {
            ...(next.user ?? {}),
            ...(incoming.user as NonNullable<typeof prev.user>),
          };
        }

        if (incoming.sector && typeof incoming.sector === 'object') {
          next.sector = {
            ...(next.sector ?? {}),
            ...(incoming.sector as NonNullable<typeof prev.sector>),
          };
        }

        if (incoming.label === null) {
          next.label = null;
        } else if (Array.isArray(incoming.label)) {
          next.label = incoming.label as ChatLabel[];
        }

        if (Array.isArray(incoming.protocol_start)) {
          next.protocol_start = incoming.protocol_start as string[];
        }

        if (Array.isArray(incoming.protocol_transfer)) {
          next.protocol_transfer = incoming.protocol_transfer as string[];
        }

        if (Array.isArray(incoming.protocol_ura)) {
          next.protocol_ura = incoming.protocol_ura as string[];
        }

        if (
          incoming.forward_to_output_chatbot === null ||
          typeof incoming.forward_to_output_chatbot === 'boolean'
        ) {
          next.forward_to_output_chatbot =
            incoming.forward_to_output_chatbot as boolean | null;
        }

        if (
          next.status === 'in_chat' &&
          !!currentUserId &&
          resolveUserId(next.user) === currentUserId &&
          next.summary
        ) {
          next.summary = {
            ...next.summary,
            unread_count: 0,
          };
        }

        return next;
      });

      const payloadAny = payload as Record<string, unknown>;
      const isActive =
        typeof payloadAny._active === 'boolean' ? payloadAny._active : false;
      const payloadUser =
        payloadAny.user && typeof payloadAny.user === 'object'
          ? (payloadAny.user as { id?: unknown; user_id?: unknown })
          : null;
      const payloadUserId = resolveUserId(payloadUser);

      if (isActive && payloadUserId && currentUserId === payloadUserId) {
        loadMessages();
      }
    },
    [chatInfo.chat_id, currentUserId, loadMessages]
  );

  useFocusEffect(
    useCallback(() => {
      const pendingChatUpdates = consumePendingChatUpdates(chatInfo.chat_id);
      if (pendingChatUpdates.length > 0) {
        const lastUpdate = pendingChatUpdates[pendingChatUpdates.length - 1];
        handleSocketChatUpdate(lastUpdate);
      }

      const offMessage = addChatSocketListener('message', handleSocketMessage);
      const offTyping = addChatSocketListener('typing', handleSocketTyping);
      const offChatUpdate = addChatSocketListener(
        'chatUpdate',
        handleSocketChatUpdate
      );
      const offRecoveryFailed = addChatSocketListener('recoveryFailed', () => {
        void syncMessagesStatus(true);
      });

      const runPeriodicSync = () => {
        void syncMessagesStatus();
      };
      runPeriodicSync();
      socketSyncIntervalRef.current = setInterval(
        runPeriodicSync,
        CHAT_SOCKET_SYNC_INTERVAL_MS
      );

      return () => {
        setTypingIndicator(null);
        offMessage();
        offTyping();
        offChatUpdate();
        offRecoveryFailed();
        if (socketSyncIntervalRef.current) {
          clearInterval(socketSyncIntervalRef.current);
          socketSyncIntervalRef.current = null;
        }
      };
    }, [
      chatInfo.chat_id,
      handleSocketMessage,
      handleSocketTyping,
      handleSocketChatUpdate,
      syncMessagesStatus,
      setTypingIndicator,
    ])
  );

  const isInChatStatus = chatInfo.status === 'in_chat';
  const canComposeInChat = !isHistoryReadonly && isInChatStatus;
  const canAttendByPermission = canPickQueueChat(permissionList);
  const canReopenByPermission = canReopenChat(permissionList);
  const simultaneousAttendanceLimit =
    typeof workerConfigForChat?.simultaneous_attendance === 'number' &&
    Number.isFinite(workerConfigForChat.simultaneous_attendance) &&
    workerConfigForChat.simultaneous_attendance > 0
      ? workerConfigForChat.simultaneous_attendance
      : null;
  const cannotAttendDueToStatus =
    !isHistoryReadonly &&
    (isQueueOrUraStatus || isClosedStatus) &&
    workerConfigForChat?.allow_attendance_only_online === true &&
    currentUserStatus !== 'online';
  const cannotAttendDueToLimit =
    !isHistoryReadonly &&
    (isQueueOrUraStatus || isClosedStatus) &&
    !cannotAttendDueToStatus &&
    workerConfigForChat?.simultaneous_attendance_enabled === true &&
    simultaneousAttendanceLimit !== null &&
    inChatCountForWorker >= simultaneousAttendanceLimit;
  const canAttendChatAction =
    !isHistoryReadonly &&
    isQueueOrUraStatus &&
    canAttendByPermission &&
    !cannotAttendDueToStatus &&
    !cannotAttendDueToLimit;
  const canReopenChatAction =
    !isHistoryReadonly &&
    isClosedStatus &&
    canReopenByPermission &&
    !cannotAttendDueToStatus &&
    !cannotAttendDueToLimit;
  const showAttendReopenBanner =
    !isHistoryReadonly && (isQueueOrUraStatus || isClosedStatus);
  const attendReopenBannerMessage = isClosedStatus
    ? pt.chat_closed_message
    : pt.chat_queue_message;
  const attendReopenButtonLabel = isClosedStatus ? pt.reopen : pt.attend;
  const isAttendReopenActionAllowed = isClosedStatus
    ? canReopenChatAction
    : canAttendChatAction;
  const attendReopenBlockedReason = (() => {
    if (!showAttendReopenBanner || isAttendReopenActionAllowed) return null;
    if (cannotAttendDueToStatus) return pt.attendance_only_online_required;
    if (cannotAttendDueToLimit && simultaneousAttendanceLimit !== null) {
      return pt.simultaneous_attendance_limit_message.replace(
        '{limit}',
        String(simultaneousAttendanceLimit)
      );
    }
    if (isClosedStatus && !canReopenByPermission) {
      return pt.action_unavailable_by_permission;
    }
    if (isQueueOrUraStatus && !canAttendByPermission) {
      return pt.action_unavailable_by_permission;
    }
    return pt.action_unavailable_by_permission;
  })();
  const shouldObfuscateContent =
    isQueueOrUraStatus && !canPreviewProtectedContent;
  const canViewAttendanceHistoryAction =
    canViewAttendanceHistory(permissionList);
  const canShowCloseButton =
    !isHistoryReadonly &&
    (isInChatStatus ||
      (isQueueOrUraStatus && canCloseChatWithoutAttending(permissionList)));
  const canTransferAction = !isHistoryReadonly && isInChatStatus;
  const canLabelAction = !isHistoryReadonly && isInChatStatus;
  const canToggleForwardToOutputAction =
    !isHistoryReadonly &&
    (isInChatStatus || isQueueOrUraStatus) &&
    workerConfigForChat?.has_ura_output === true &&
    canToggleForwardToOutputChatbot(permissionList);
  const isForwardToOutputActive = chatInfo.forward_to_output_chatbot !== false;

  const handleToggleHeaderPhoneVisibility = useCallback(async () => {
    const contactId = readNonEmptyString(chatInfo.contact?.id);
    if (!contactId) return;

    if (isHeaderPhoneDecrypted) {
      setHeaderPhoneDecrypted(null);
      setIsHeaderPhoneDecrypted(false);
      return;
    }

    setIsHeaderPhoneLoading(true);
    const decrypted = await getChatContactPhoneDecrypted(contactId);
    setIsHeaderPhoneLoading(false);

    if (!decrypted) return;
    setHeaderPhoneDecrypted(decrypted);
    setIsHeaderPhoneDecrypted(true);
  }, [chatInfo.contact?.id, isHeaderPhoneDecrypted]);

  const confirmCloseService = useCallback(async () => {
    const chatId = readNonEmptyString(chatInfo.chat_id);
    if (!chatId) return;

    const result = await updateChatStatusDetailed(chatId, 'closed');
    if (!result.ok) {
      Alert.alert(
        pt.error_title,
        result.message ?? pt.chat_status_update_error
      );
      return;
    }

    Alert.alert(pt.success_title, pt.close_service_success);
    navigation.goBack();
  }, [chatInfo.chat_id, navigation]);

  const handleCloseService = useCallback(() => {
    Alert.alert(pt.close_service, pt.close_service_confirmation, [
      {
        text: pt.cancel,
        style: 'cancel',
      },
      {
        text: pt.close_service,
        style: 'destructive',
        onPress: () => {
          void confirmCloseService();
        },
      },
    ]);
  }, [confirmCloseService]);

  const syncGlobalChatCounts = useCallback(async () => {
    const response = await searchChats({
      search: '',
      status: 'in_chat',
      current_page: 1,
      per_page: 1,
    });

    const counts = response?.counts;
    if (!counts) return;

    const schedule = counts.schedule ?? 0;
    const chatbotInput = counts.chatbot_input ?? 0;
    const chatbotOutput = counts.chatbot_output ?? 0;
    const chatbotWebhook = counts.chatbot_webhook ?? 0;
    const chatbotSchedule = counts.chatbot_schedule ?? schedule;
    const inChatMine = counts.in_chat_mine ?? counts.my_chats ?? 0;

    setChatCounts({
      total: counts.total ?? 0,
      queue: counts.queue ?? 0,
      in_chat: counts.in_chat ?? 0,
      chatbot: counts.chatbot ?? 0,
      schedule,
      my_chats: counts.my_chats ?? 0,
      closed: counts.closed ?? 0,
      in_chat_mine: inChatMine,
      chatbot_input: chatbotInput,
      chatbot_output: chatbotOutput,
      chatbot_schedule: chatbotSchedule,
      chatbot_webhook: chatbotWebhook,
    });
  }, [setChatCounts]);

  const handleAttendOrReopen = useCallback(async () => {
    const chatId = readNonEmptyString(chatInfo.chat_id);
    if (!chatId || isAttendReopenLoading) return;

    if (!isAttendReopenActionAllowed) {
      Alert.alert(
        pt.warning_title,
        attendReopenBlockedReason ?? pt.action_unavailable_by_permission
      );
      return;
    }

    setIsAttendReopenLoading(true);
    const result = await updateChatStatusDetailed(chatId, 'in_chat');
    setIsAttendReopenLoading(false);

    if (!result.ok) {
      Alert.alert(
        pt.error_title,
        result.message ?? pt.chat_status_update_error
      );
      return;
    }

    const updatedChat: ListChatsResult = {
      ...chatInfo,
      ...(result.data ?? {}),
      status: 'in_chat',
    };

    setChatInfo(updatedChat);

    if (isClosedStatus) {
      clearAdvancedFilters();
    }

    await syncGlobalChatCounts();

    const parentNavigation = navigation.getParent() as
      | {
          navigate: (
            routeName: string,
            params?: {
              screen?: string;
              params?: { chat: ListChatsResult };
            }
          ) => void;
        }
      | undefined;

    if (parentNavigation) {
      parentNavigation.navigate('InChat', {
        screen: 'ChatRoom',
        params: { chat: updatedChat },
      });
      return;
    }

    navigation.replace('ChatRoom', { chat: updatedChat });
  }, [
    attendReopenBlockedReason,
    chatInfo.chat_id,
    chatInfo,
    clearAdvancedFilters,
    isAttendReopenActionAllowed,
    isAttendReopenLoading,
    isClosedStatus,
    navigation,
    syncGlobalChatCounts,
  ]);

  const handleToggleForwardToOutput = useCallback(async () => {
    const chatId = readNonEmptyString(chatInfo.chat_id);
    if (!chatId || isTogglingForwardToOutput) return;

    const nextValue = chatInfo.forward_to_output_chatbot === false;
    setIsTogglingForwardToOutput(true);
    const ok = await updateForwardToOutputChatbot(chatId, nextValue);
    setIsTogglingForwardToOutput(false);
    if (!ok) {
      Alert.alert(
        pt.error_title,
        pt.chat_forward_to_output_chatbot_update_failed
      );
      return;
    }

    setChatInfo((prev) => ({
      ...prev,
      forward_to_output_chatbot: nextValue,
    }));
  }, [
    chatInfo.chat_id,
    chatInfo.forward_to_output_chatbot,
    isTogglingForwardToOutput,
  ]);

  const openLabelModal = useCallback(async () => {
    if (!canLabelAction) return;

    setLabelModalVisible(true);
    setIsLoadingLabelModal(true);
    const labels = await listLabelTemplates();
    setIsLoadingLabelModal(false);

    if (labels) {
      setLabelTemplates(labels);
    } else {
      setLabelTemplates([]);
    }

    const selectedIds =
      Array.isArray(chatInfo.label) && chatInfo.label.length > 0
        ? chatInfo.label.map((item) => item.label_template_id)
        : [];
    setSelectedLabelTemplateIds(selectedIds);
  }, [canLabelAction, chatInfo.label]);

  const handleSaveLabels = useCallback(async () => {
    const chatId = readNonEmptyString(chatInfo.chat_id);
    if (!chatId || isSavingLabelModal) return;

    setIsSavingLabelModal(true);
    const nextIds =
      selectedLabelTemplateIds.length > 0 ? selectedLabelTemplateIds : null;
    const ok = await updateChatLabel(chatId, nextIds);
    setIsSavingLabelModal(false);
    if (!ok) {
      Alert.alert(pt.error_title, pt.chat_label_update_error);
      return;
    }

    const nextLabels: ChatLabel[] | null =
      nextIds && nextIds.length > 0
        ? labelTemplates
            .filter((item) => nextIds.includes(item.label_template_id))
            .map((item) => ({
              label_template_id: item.label_template_id,
              label: item.label,
              color: item.color,
            }))
        : null;

    setChatInfo((prev) => ({
      ...prev,
      label: nextLabels && nextLabels.length > 0 ? nextLabels : null,
    }));

    setLabelModalVisible(false);
    Alert.alert(pt.success_title, pt.chat_label_update_success);
  }, [
    chatInfo.chat_id,
    isSavingLabelModal,
    selectedLabelTemplateIds,
    labelTemplates,
  ]);

  const handleClearLabels = useCallback(() => {
    setSelectedLabelTemplateIds([]);
  }, []);

  const runSearchMessages = useCallback(
    async (reset: boolean, page: number) => {
      const chatId = readNonEmptyString(chatInfo.chat_id);
      const query = debouncedSearchQuery.trim();

      if (!chatId || query.length < 3) {
        setSearchResults([]);
        setSearchCurrentPage(1);
        setSearchTotalPages(0);
        return;
      }

      if (reset) {
        setSearchLoading(true);
      } else {
        setSearchLoadingMore(true);
      }

      const response = await searchMessages(chatId, query, page, 50);
      if (reset) {
        setSearchResults(response.results);
      } else {
        setSearchResults((prev) => [...prev, ...response.results]);
      }
      setSearchCurrentPage(response.pagings.current_page);
      setSearchTotalPages(response.pagings.total_pages);

      if (reset) {
        setSearchLoading(false);
      } else {
        setSearchLoadingMore(false);
      }
    },
    [chatInfo.chat_id, debouncedSearchQuery]
  );

  useEffect(() => {
    if (!searchModalVisible) {
      setSearchQuery('');
      setDebouncedSearchQuery('');
      setSearchResults([]);
      setSearchCurrentPage(1);
      setSearchTotalPages(0);
      setSearchLoading(false);
      setSearchLoadingMore(false);
      return;
    }

    void runSearchMessages(true, 1);
  }, [searchModalVisible, debouncedSearchQuery, runSearchMessages]);

  const handleLoadMoreSearchResults = useCallback(() => {
    if (searchLoading || searchLoadingMore) return;
    if (debouncedSearchQuery.trim().length < 3) return;
    if (searchCurrentPage >= searchTotalPages) return;
    void runSearchMessages(false, searchCurrentPage + 1);
  }, [
    debouncedSearchQuery,
    runSearchMessages,
    searchCurrentPage,
    searchLoading,
    searchLoadingMore,
    searchTotalPages,
  ]);

  const handleSelectSearchedMessage = useCallback(
    (messageId: string) => {
      setSearchModalVisible(false);
      requestAnimationFrame(() => {
        scrollToMessageById(messageId);
      });
    },
    [scrollToMessageById]
  );

  const canListAllChatsForHistory = useMemo(() => {
    return permissionList.some(
      (permission) =>
        permission === 'full_access' ||
        permission === 'full_access_group' ||
        permission === 'chat_group' ||
        permission === 'list_all_chats_in_sector' ||
        permission === 'list_all_chats_without_sector_limit'
    );
  }, [permissionList]);
  const normalizedHistoryPhone = useMemo(() => {
    const primaryPhoneDigits = normalizePhoneDigits(chatInfo.phone);
    const fallbackPhoneDigits = normalizePhoneDigits(chatInfo.contact?.phone);
    const candidate = primaryPhoneDigits || fallbackPhoneDigits;
    if (!candidate) return null;

    const ddiDigits = normalizePhoneDigits(chatInfo.contact?.phone_ddi);
    if (ddiDigits && candidate.startsWith(ddiDigits) && candidate.length > 11) {
      return candidate.slice(ddiDigits.length);
    }

    return candidate;
  }, [chatInfo.phone, chatInfo.contact?.phone, chatInfo.contact?.phone_ddi]);
  const userSectorsKey = useMemo(() => userSectors.join(','), [userSectors]);

  const loadAttendanceHistory = useCallback(
    async (reset: boolean, page: number) => {
      const activePhone = normalizedHistoryPhone;
      if (!activePhone) {
        setAttendanceHistory([]);
        setAttendanceHistoryPage(1);
        setAttendanceHistoryTotalPages(0);
        return;
      }

      if (reset) {
        setAttendanceHistoryLoading(true);
      } else {
        setAttendanceHistoryLoadingMore(true);
      }

      const query: {
        current_page: number;
        per_page: number;
        search: string;
        status: string;
        filter_phone: string;
        sort_field: string;
        sort_order: string;
        filter_user_id?: string;
        filter_sector_id?: string;
      } = {
        current_page: page,
        per_page: 20,
        search: '',
        status: 'closed',
        filter_phone: activePhone,
        sort_field: 'closed_at',
        sort_order: 'desc',
      };
      const sectorIds = userSectorsKey
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);

      if (!canListAllChatsForHistory && currentUserId) {
        query.filter_user_id = currentUserId;
      }

      if (!canListAllChatsForHistory && sectorIds.length === 1) {
        query.filter_sector_id = sectorIds[0];
      }

      const response = await searchChats(query);
      if (!response) {
        if (reset) {
          setAttendanceHistory([]);
          setAttendanceHistoryPage(1);
          setAttendanceHistoryTotalPages(0);
          if (!attendanceHistoryErrorAlertShownRef.current) {
            attendanceHistoryErrorAlertShownRef.current = true;
            Alert.alert(pt.error_title, pt.attendance_history_load_error);
          }
        }
        return;
      } else if (reset) {
        setAttendanceHistory(response.results);
        setAttendanceHistoryPage(response.current_page);
        setAttendanceHistoryTotalPages(response.total_pages);
        attendanceHistoryErrorAlertShownRef.current = false;
      } else {
        setAttendanceHistory((prev) => [...prev, ...response.results]);
        setAttendanceHistoryPage(response.current_page);
        setAttendanceHistoryTotalPages(response.total_pages);
        attendanceHistoryErrorAlertShownRef.current = false;
      }

      if (reset) {
        setAttendanceHistoryLoading(false);
      } else {
        setAttendanceHistoryLoadingMore(false);
      }
    },
    [
      canListAllChatsForHistory,
      currentUserId,
      normalizedHistoryPhone,
      userSectorsKey,
    ]
  );

  useEffect(() => {
    if (!attendanceHistoryVisible) {
      setAttendanceHistory([]);
      setAttendanceHistoryPage(1);
      setAttendanceHistoryTotalPages(0);
      setAttendanceHistoryLoading(false);
      setAttendanceHistoryLoadingMore(false);
      attendanceHistoryErrorAlertShownRef.current = false;
      return;
    }

    void loadAttendanceHistory(true, 1);
  }, [attendanceHistoryVisible, loadAttendanceHistory]);

  const handleLoadMoreAttendanceHistory = useCallback(() => {
    if (attendanceHistoryLoading || attendanceHistoryLoadingMore) return;
    if (attendanceHistoryPage >= attendanceHistoryTotalPages) return;
    void loadAttendanceHistory(false, attendanceHistoryPage + 1);
  }, [
    attendanceHistoryLoading,
    attendanceHistoryLoadingMore,
    attendanceHistoryPage,
    attendanceHistoryTotalPages,
    loadAttendanceHistory,
  ]);

  const openHistoryConversation = useCallback(
    (selectedChat: ListChatsResult) => {
      setAttendanceHistoryVisible(false);
      navigation.push('ChatRoom', {
        chat: selectedChat,
        mode: 'history_readonly',
      });
    },
    [navigation]
  );

  const selectedTransferChannel = useMemo(
    () =>
      transferChannels.find(
        (item) => item.value === selectedTransferChannelId
      ) ?? null,
    [selectedTransferChannelId, transferChannels]
  );
  const selectedTransferUser = useMemo(
    () =>
      transferUsers.find((item) => item.id === selectedTransferUserId) ?? null,
    [selectedTransferUserId, transferUsers]
  );
  const selectedTransferSector = useMemo(
    () =>
      transferSectors.find((item) => item.id === selectedTransferSectorId) ??
      null,
    [selectedTransferSectorId, transferSectors]
  );
  const selectedTransferSectorUser = useMemo(
    () =>
      transferSectorUsers.find(
        (item) => item.id === selectedTransferSectorUserId
      ) ?? null,
    [selectedTransferSectorUserId, transferSectorUsers]
  );

  useEffect(() => {
    if (!transferModalVisible) {
      setTransferType(null);
      setTransferAnnotation('');
      setSelectedTransferChannelId(null);
      setSelectedTransferUserId(null);
      setSelectedTransferSectorId(null);
      setSelectedTransferSectorUserId(null);
      setTransferChannels([]);
      setTransferUsers([]);
      setTransferSectors([]);
      setTransferSectorUsers([]);
      setTransferPickerKind(null);
      setIsLoadingTransferChannels(false);
      setIsLoadingTransferUsers(false);
      setIsLoadingTransferSectors(false);
      setIsLoadingTransferSectorUsers(false);
      return;
    }

    setIsLoadingTransferChannels(true);
    setIsLoadingTransferSectors(true);

    listTransferOptions()
      .then((options) => {
        const workers = options?.workers ?? [];
        const channelItems: TransferChannelOption[] = workers.map((worker) => ({
          value: worker.id,
          title: worker.number
            ? `${worker.name} (${worker.number})`
            : worker.name,
          name: worker.name,
          number: worker.number,
        }));
        setTransferChannels(channelItems);
      })
      .finally(() => {
        setIsLoadingTransferChannels(false);
      });

    listTransferSectors()
      .then((sectors) => {
        setTransferSectors(sectors);
      })
      .finally(() => {
        setIsLoadingTransferSectors(false);
      });
  }, [transferModalVisible]);

  useEffect(() => {
    if (!transferModalVisible) return;

    setSelectedTransferUserId(null);
    setSelectedTransferSectorUserId(null);
    setTransferUsers([]);
    setTransferSectorUsers([]);

    if (!selectedTransferChannelId) return;

    setIsLoadingTransferUsers(true);
    listTransferUsers(chatInfo.chat_id, selectedTransferChannelId)
      .then((users) => {
        setTransferUsers(users);
      })
      .finally(() => {
        setIsLoadingTransferUsers(false);
      });
  }, [chatInfo.chat_id, selectedTransferChannelId, transferModalVisible]);

  useEffect(() => {
    if (!transferModalVisible) return;
    setSelectedTransferSectorUserId(null);
    setTransferSectorUsers([]);

    if (!selectedTransferSectorId || !selectedTransferChannelId) return;

    setIsLoadingTransferSectorUsers(true);
    listTransferSectorUsers(
      selectedTransferSectorId,
      chatInfo.chat_id,
      selectedTransferChannelId
    )
      .then((users) => {
        setTransferSectorUsers(users);
      })
      .finally(() => {
        setIsLoadingTransferSectorUsers(false);
      });
  }, [
    chatInfo.chat_id,
    selectedTransferChannelId,
    selectedTransferSectorId,
    transferModalVisible,
  ]);

  const transferPickerItems = useMemo(() => {
    if (transferPickerKind === 'channel') {
      return transferChannels.map((item) => ({
        value: item.value,
        label: item.title,
      }));
    }
    if (transferPickerKind === 'type') {
      return [
        { value: 'user', label: pt.transfer_type_user },
        { value: 'sector', label: pt.transfer_type_sector },
      ];
    }
    if (transferPickerKind === 'user') {
      return transferUsers.map((item) => ({
        value: item.id,
        label: item.name,
      }));
    }
    if (transferPickerKind === 'sector') {
      return transferSectors.map((item) => ({
        value: item.id,
        label: item.name,
      }));
    }
    if (transferPickerKind === 'sector_user') {
      return transferSectorUsers.map((item) => ({
        value: item.id,
        label: item.name,
      }));
    }
    return [];
  }, [
    transferChannels,
    transferPickerKind,
    transferSectorUsers,
    transferSectors,
    transferUsers,
  ]);

  const handleSelectTransferPickerValue = useCallback(
    (value: string) => {
      if (transferPickerKind === 'channel') {
        setSelectedTransferChannelId(value);
      } else if (transferPickerKind === 'type') {
        if (value === 'user' || value === 'sector') {
          setTransferType(value);
        } else {
          setTransferType(null);
        }
        setSelectedTransferUserId(null);
        setSelectedTransferSectorId(null);
        setSelectedTransferSectorUserId(null);
      } else if (transferPickerKind === 'user') {
        setSelectedTransferUserId(value);
      } else if (transferPickerKind === 'sector') {
        setSelectedTransferSectorId(value);
      } else if (transferPickerKind === 'sector_user') {
        setSelectedTransferSectorUserId(value);
      }

      setTransferPickerKind(null);
    },
    [transferPickerKind]
  );

  const submitTransfer = useCallback(async () => {
    const chatId = readNonEmptyString(chatInfo.chat_id);
    if (!chatId) return;
    if (!selectedTransferChannelId) {
      Alert.alert(pt.warning_title, pt.channel_required);
      return;
    }
    if (transferType === 'user' && !selectedTransferUserId) {
      Alert.alert(pt.warning_title, pt.user_required);
      return;
    }
    if (transferType === 'sector' && !selectedTransferSectorId) {
      Alert.alert(pt.warning_title, pt.sector_required);
      return;
    }

    const payload: TransferChatPayload = {
      worker_id: selectedTransferChannelId,
      user_id:
        transferType === 'user'
          ? selectedTransferUserId
          : transferType === 'sector'
            ? selectedTransferSectorUserId
            : null,
      sector_id: transferType === 'sector' ? selectedTransferSectorId : null,
      annotation: transferAnnotation.trim() || null,
    };

    setIsTransferring(true);
    const ok = await transferChat(chatId, payload);
    setIsTransferring(false);
    if (!ok) {
      Alert.alert(pt.error_title, pt.chat_transfer_error);
      return;
    }

    Alert.alert(pt.success_title, pt.transfer_successfully);
    setTransferModalVisible(false);
    navigation.goBack();
  }, [
    chatInfo.chat_id,
    navigation,
    selectedTransferChannelId,
    selectedTransferSectorId,
    selectedTransferSectorUserId,
    selectedTransferUserId,
    transferAnnotation,
    transferType,
  ]);

  const menuActions = useMemo<ChatMenuAction[]>(() => {
    const actions: ChatMenuAction[] = [];

    if (protocolList.length > 0) {
      actions.push({
        key: 'protocol',
        label: pt.view_protocol,
        icon: 'document-text-outline',
        onPress: () => {
          setProtocolModalVisible(true);
        },
      });
    }

    if (canLabelAction) {
      actions.push({
        key: 'label',
        label: pt.label,
        icon: 'pricetag-outline',
        onPress: () => {
          void openLabelModal();
        },
      });
    }

    if (canViewAttendanceHistoryAction) {
      actions.push({
        key: 'attendance_history',
        label: pt.attendance_history,
        icon: 'time-outline',
        onPress: () => {
          setAttendanceHistoryVisible(true);
        },
      });
    }

    if (canTransferAction) {
      actions.push({
        key: 'transfer',
        label: pt.transfer,
        icon: 'swap-horizontal-outline',
        onPress: () => {
          setTransferModalVisible(true);
        },
      });
    }

    actions.push({
      key: 'search_messages',
      label: pt.search_messages,
      icon: 'search-outline',
      onPress: () => {
        setSearchModalVisible(true);
      },
    });

    if (canToggleForwardToOutputAction) {
      actions.push({
        key: 'forward_to_output_chatbot',
        label: pt.forward_to_output_chatbot,
        icon: isForwardToOutputActive ? 'toggle' : 'toggle-outline',
        active: isForwardToOutputActive,
        onPress: () => {
          void handleToggleForwardToOutput();
        },
      });
    }

    if (canShowCloseButton) {
      actions.push({
        key: 'close_service',
        label: pt.close_service,
        icon: 'close-circle-outline',
        danger: true,
        onPress: () => {
          handleCloseService();
        },
      });
    }

    return actions;
  }, [
    canLabelAction,
    canShowCloseButton,
    canToggleForwardToOutputAction,
    canTransferAction,
    canViewAttendanceHistoryAction,
    handleCloseService,
    handleToggleForwardToOutput,
    isForwardToOutputActive,
    openLabelModal,
    protocolList.length,
  ]);

  useEffect(() => {
    inputRef.current = input;
    sendingRef.current = sending;
    isQueueOrUraStatusRef.current = !canComposeInChat;
    sendingCapturedMediaRef.current = sendingCapturedMedia;
    sendingVoiceRecordingRef.current = sendingVoiceRecording;
    isRecordingVoiceRef.current = isRecordingVoice;
    isRecordingLockedRef.current = isRecordingLocked;
    isPreparingRecordingRef.current = isPreparingRecording;
  }, [
    input,
    canComposeInChat,
    isHistoryReadonly,
    isPreparingRecording,
    isQueueOrUraStatus,
    isRecordingLocked,
    isRecordingVoice,
    sending,
    sendingCapturedMedia,
    sendingVoiceRecording,
  ]);

  const resetRecordingComposerState = useCallback(() => {
    micPressActiveRef.current = false;
    micStartXRef.current = null;
    micStartYRef.current = null;
    pendingReleaseBeforeReadyRef.current = false;
    recordingStartedAtRef.current = null;
    cancelArmedRef.current = false;
    isRecordingVoiceRef.current = false;
    isRecordingLockedRef.current = false;
    isPreparingRecordingRef.current = false;
    setIsMicPressActive(false);
    setIsRecordingVoice(false);
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
          // Avoid passing `undefined` values on Android native module.
          shouldPlayInBackground: false,
          shouldRouteThroughEarpiece: false,
          allowsBackgroundRecording: false,
        });
        return;
      }

      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        interruptionMode: 'mixWithOthers',
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
        allowsBackgroundRecording: false,
      });
    } catch {
      //
    }
  }, []);

  const stopVoiceRecorder = useCallback(async () => {
    const durationMs = Math.max(0, recorderState.durationMillis || 0);
    const durationSec = Math.max(1, Math.round(durationMs / 1000));

    try {
      await recorder.stop();
    } catch {}

    await applyRecordingAudioMode(false);

    const uri = recorder.uri ?? recorderState.url;
    if (!uri) return null;

    const recordedFile = new File(uri);
    const extension = recordedFile.extension || '.m4a';
    const normalizedExt = extension.startsWith('.')
      ? extension
      : `.${extension}`;
    const fileName = recordedFile.name || `audio-${Date.now()}${normalizedExt}`;
    const mimeType = resolveMimeTypeFromExtension(extension);

    return {
      uri,
      durationSec,
      fileName,
      mimeType,
    };
  }, [
    applyRecordingAudioMode,
    recorder,
    recorderState.durationMillis,
    recorderState.url,
  ]);

  const sendRecordedVoiceMessage = useCallback(async () => {
    if (sendingVoiceRecording) return;

    setSendingVoiceRecording(true);
    const recorded = await stopVoiceRecorder();
    resetRecordingComposerState();

    try {
      if (!recorded) return;

      const formData = new FormData();
      formData.append('type', EMessageType.audio);
      formData.append('audio_ptt', 'true');
      formData.append('audio_duration', String(recorded.durationSec));
      formData.append('hash', createClientMessageHash());
      await appendMediaToFormData(formData, 'audios', {
        uri: recorded.uri,
        name: recorded.fileName,
        mimeType: recorded.mimeType,
      });

      const result = await createMessageWithFormData(
        chatInfo.chat_id,
        formData
      );
      if (!result.ok) return;

      pendingScrollToBottomRef.current = true;
      setShowScrollToBottomButton(false);
      const createdMessage = result.message;
      if (createdMessage) {
        setMessages((prev) => mergeMessageLists(prev, createdMessage));
      } else {
        await syncLatestMessages();
      }
      requestAnimationFrame(() => {
        scrollToBottomWithRetries(10);
      });
    } finally {
      setSendingVoiceRecording(false);
    }
  }, [
    chatInfo.chat_id,
    resetRecordingComposerState,
    scrollToBottomWithRetries,
    sendingVoiceRecording,
    stopVoiceRecorder,
    syncLatestMessages,
  ]);

  const lockVoiceRecording = useCallback(() => {
    if (!isRecordingVoice) return;
    if (isRecordingLocked) return;
    isRecordingLockedRef.current = true;
    setIsRecordingLocked(true);
    setShowRecordingHint(false);
  }, [isRecordingLocked, isRecordingVoice]);

  const discardVoiceRecording = useCallback(async () => {
    if (!isRecordingVoice && !isRecordingPaused && !recorderState.url) return;

    try {
      await recorder.stop();
    } catch {}

    await applyRecordingAudioMode(false);

    resetRecordingComposerState();
  }, [
    applyRecordingAudioMode,
    isRecordingPaused,
    isRecordingVoice,
    recorder,
    recorderState.url,
    resetRecordingComposerState,
  ]);

  const togglePauseVoiceRecording = useCallback(() => {
    if (!isRecordingVoice) return;

    try {
      if (isRecordingPaused) {
        recorder.record();
        setIsRecordingPaused(false);
        return;
      }
      recorder.pause();
      setIsRecordingPaused(true);
    } catch {}
  }, [isRecordingPaused, isRecordingVoice, recorder]);

  const startVoiceRecording = useCallback(async () => {
    if (!canComposeInChat || isPreparingRecording || sendingVoiceRecording) {
      return;
    }
    if (isRecordingVoice) return;

    const startToken = ++recordingStartTokenRef.current;
    isPreparingRecordingRef.current = true;
    setIsPreparingRecording(true);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (startToken !== recordingStartTokenRef.current) return;
      if (!permission.granted) {
        resetRecordingComposerState();
        return;
      }

      await applyRecordingAudioMode(true);
      if (startToken !== recordingStartTokenRef.current) return;
      await recorder.prepareToRecordAsync(recorderOptions);
      if (startToken !== recordingStartTokenRef.current) return;
      recorder.record();

      isRecordingVoiceRef.current = true;
      isRecordingLockedRef.current = false;
      setIsRecordingVoice(true);
      setIsRecordingLocked(false);
      setIsRecordingPaused(false);
      setShowRecordingHint(true);
      setRecordingWaveform([]);
      recordingStartedAtRef.current = Date.now();

      if (pendingReleaseBeforeReadyRef.current) {
        pendingReleaseBeforeReadyRef.current = false;

        isRecordingLockedRef.current = true;
        setIsRecordingLocked(true);
        setShowRecordingHint(false);
      }
    } catch {
      resetRecordingComposerState();
      await applyRecordingAudioMode(false);
    } finally {
      isPreparingRecordingRef.current = false;
      setIsPreparingRecording(false);
    }
  }, [
    applyRecordingAudioMode,
    canComposeInChat,
    isPreparingRecording,
    isRecordingVoice,
    recorder,
    recorderOptions,
    resetRecordingComposerState,
    sendingVoiceRecording,
  ]);

  const startVoiceRecordingCbRef = useRef(startVoiceRecording);
  const sendRecordedVoiceMessageCbRef = useRef(sendRecordedVoiceMessage);
  const lockVoiceRecordingCbRef = useRef(lockVoiceRecording);
  const discardVoiceRecordingCbRef = useRef(discardVoiceRecording);

  useEffect(() => {
    startVoiceRecordingCbRef.current = startVoiceRecording;
  }, [startVoiceRecording]);

  useEffect(() => {
    sendRecordedVoiceMessageCbRef.current = sendRecordedVoiceMessage;
  }, [sendRecordedVoiceMessage]);

  useEffect(() => {
    lockVoiceRecordingCbRef.current = lockVoiceRecording;
  }, [lockVoiceRecording]);

  useEffect(() => {
    discardVoiceRecordingCbRef.current = discardVoiceRecording;
  }, [discardVoiceRecording]);

  const cancelVoiceRecording = useCallback(async () => {
    // Invalidate any in-flight `startVoiceRecording` so it can't "finish" after cancel.
    recordingStartTokenRef.current += 1;

    try {
      await recorder.stop();
    } catch {}

    await applyRecordingAudioMode(false);
    resetRecordingComposerState();
  }, [applyRecordingAudioMode, recorder, resetRecordingComposerState]);

  const handleMicPressGrant = useCallback((pageX: number, pageY: number) => {
    if (inputRef.current.trim().length > 0) return;
    if (sendingRef.current || isQueueOrUraStatusRef.current) return;
    if (sendingCapturedMediaRef.current || sendingVoiceRecordingRef.current) {
      return;
    }
    if (isPreparingRecordingRef.current || isRecordingVoiceRef.current) return;

    pendingReleaseBeforeReadyRef.current = false;
    cancelArmedRef.current = false;
    setIsRecordingCancelArmed(false);
    micPressActiveRef.current = true;
    micStartXRef.current = pageX;
    micStartYRef.current = pageY;
    setIsMicPressActive(true);
    void startVoiceRecordingCbRef.current();
  }, []);

  const handleMicPressMove = useCallback((pageX: number, pageY: number) => {
    if (!isRecordingVoiceRef.current || isRecordingLockedRef.current) return;
    const startX = micStartXRef.current;
    if (startX != null) {
      const deltaX = pageX - startX;
      const nextCancelArmed = deltaX <= -VOICE_CANCEL_SWIPE_THRESHOLD;
      if (nextCancelArmed !== cancelArmedRef.current) {
        cancelArmedRef.current = nextCancelArmed;
        setIsRecordingCancelArmed(nextCancelArmed);
        if (nextCancelArmed) {
          setShowRecordingHint(false);
        } else {
          setShowRecordingHint(true);
        }
      }
    }

    if (cancelArmedRef.current) return;

    const startY = micStartYRef.current;
    if (startY == null) return;
    const deltaY = startY - pageY;
    if (deltaY < VOICE_LOCK_SWIPE_THRESHOLD) return;

    lockVoiceRecordingCbRef.current();
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
      void cancelVoiceRecording();
      return;
    }

    if (!isRecordingVoiceRef.current) {
      pendingReleaseBeforeReadyRef.current = true;
      return;
    }
    if (isRecordingLockedRef.current) return;

    const recordingStartedAt = recordingStartedAtRef.current;
    const elapsedMs = recordingStartedAt
      ? Date.now() - recordingStartedAt
      : Number.POSITIVE_INFINITY;
    if (elapsedMs < VOICE_RELEASE_LOCK_GRACE_MS) {
      lockVoiceRecordingCbRef.current();
      return;
    }

    void sendRecordedVoiceMessageCbRef.current();
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
      void cancelVoiceRecording();
      return;
    }

    if (!isRecordingVoiceRef.current) {
      pendingReleaseBeforeReadyRef.current = true;
      return;
    }
    if (isRecordingLockedRef.current) return;

    lockVoiceRecordingCbRef.current();
  }, []);

  const micPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (event) => {
        handleMicPressGrant(event.nativeEvent.pageX, event.nativeEvent.pageY);
      },
      onPanResponderMove: (event) => {
        handleMicPressMove(event.nativeEvent.pageX, event.nativeEvent.pageY);
      },
      onPanResponderRelease: () => {
        handleMicPressRelease();
      },
      onPanResponderTerminate: () => {
        handleMicPressTerminate();
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current;

  const submitFormDataMessage = useCallback(
    async (formData: FormData): Promise<boolean> => {
      const result = await createMessageWithFormData(
        chatInfo.chat_id,
        formData
      );
      if (!result.ok) {
        Alert.alert(pt.error_title, pt.send_error);
        return false;
      }

      pendingScrollToBottomRef.current = true;
      setShowScrollToBottomButton(false);
      const createdMessage = result.message;
      if (createdMessage) {
        setMessages((prev) => mergeMessageLists(prev, createdMessage));
      } else {
        await syncLatestMessages();
      }
      requestAnimationFrame(() => {
        scrollToBottomWithRetries(10);
      });
      return true;
    },
    [chatInfo.chat_id, scrollToBottomWithRetries, syncLatestMessages]
  );

  const sendCapturedMediaDraft = useCallback(
    async (draft: CameraCaptureDraft) => {
      if (sendingCapturedMedia || isHistoryReadonly) return;

      setSendingCapturedMedia(true);
      try {
        const formData = new FormData();
        formData.append(
          'type',
          draft.kind === 'video' ? EMessageType.video : EMessageType.image
        );
        formData.append('hash', createClientMessageHash());

        if (draft.kind === 'video') {
          await appendMediaToFormData(formData, 'videos', {
            uri: draft.uri,
            name: draft.fileName,
            mimeType: draft.mimeType,
          });
          if (draft.durationSec != null) {
            formData.append('video_duration', String(draft.durationSec));
          }
        } else {
          await appendMediaToFormData(formData, 'images', {
            uri: draft.uri,
            name: draft.fileName,
            mimeType: draft.mimeType,
          });
        }

        await submitFormDataMessage(formData);
      } finally {
        setSendingCapturedMedia(false);
      }
    },
    [isHistoryReadonly, sendingCapturedMedia, submitFormDataMessage]
  );

  const extractExtension = useCallback((name: string | null | undefined) => {
    if (!name) return '';
    const ext = name.split('.').pop()?.trim().toLowerCase();
    return ext ?? '';
  }, []);

  const handlePickPhotoCapture = useCallback(async () => {
    setCameraPickerVisible(false);
    if (!canComposeInChat || sendingCapturedMedia || sendingVoiceRecording) {
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(pt.warning_title, pt.image_permission_denied);
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsMultipleSelection: false,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return;
    }

    const asset = result.assets[0];
    if (!asset?.uri) return;

    const originalName = asset.fileName?.trim();
    const fileName =
      originalName && /\.[a-z0-9]{2,5}$/i.test(originalName)
        ? originalName
        : `image-${Date.now()}.jpg`;
    const extension = extractExtension(fileName);
    const allowedExtensions = new Set(['jpg', 'jpeg', 'png', 'gif']);
    if (!allowedExtensions.has(extension)) {
      Alert.alert(pt.warning_title, pt.invalid_image_format);
      return;
    }

    if (
      typeof asset.fileSize === 'number' &&
      asset.fileSize > MAX_IMAGE_SIZE_BYTES
    ) {
      Alert.alert(pt.warning_title, pt.image_size_exceeded);
      return;
    }

    await sendCapturedMediaDraft({
      uri: asset.uri,
      kind: 'image',
      fileName,
      mimeType: asset.mimeType || 'image/jpeg',
      durationSec: null,
    });
  }, [
    canComposeInChat,
    extractExtension,
    sendCapturedMediaDraft,
    sendingCapturedMedia,
    sendingVoiceRecording,
  ]);

  const handlePickVideoCapture = useCallback(async () => {
    setCameraPickerVisible(false);
    if (!canComposeInChat || sendingCapturedMedia || sendingVoiceRecording) {
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(pt.warning_title, pt.image_permission_denied);
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      quality: 0.8,
      allowsMultipleSelection: false,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return;
    }

    const asset = result.assets[0];
    if (!asset?.uri) return;

    const originalName = asset.fileName?.trim();
    const fileName =
      originalName && /\.[a-z0-9]{2,5}$/i.test(originalName)
        ? originalName
        : `video-${Date.now()}.mp4`;
    const extension = extractExtension(fileName);
    const allowedExtensions = new Set([
      'mp4',
      'avi',
      'flv',
      'mkv',
      'mov',
      '3gp',
    ]);
    if (!allowedExtensions.has(extension)) {
      Alert.alert(pt.warning_title, pt.invalid_video_format);
      return;
    }

    if (
      typeof asset.fileSize === 'number' &&
      asset.fileSize > MAX_VIDEO_SIZE_BYTES
    ) {
      Alert.alert(pt.warning_title, pt.video_size_exceeded);
      return;
    }

    await sendCapturedMediaDraft({
      uri: asset.uri,
      kind: 'video',
      fileName,
      mimeType: asset.mimeType || 'video/mp4',
      durationSec:
        typeof asset.duration === 'number' && Number.isFinite(asset.duration)
          ? Math.max(1, Math.round(asset.duration / 1000))
          : null,
    });
  }, [
    canComposeInChat,
    extractExtension,
    sendCapturedMediaDraft,
    sendingCapturedMedia,
    sendingVoiceRecording,
  ]);

  const handlePickDocument = useCallback(async () => {
    setCameraPickerVisible(false);
    if (!canComposeInChat || sendingCapturedMedia || sendingVoiceRecording) {
      return;
    }
    if (documentPickerActiveRef.current) return;

    documentPickerActiveRef.current = true;
    await new Promise<void>((resolve) => setTimeout(resolve, 350));

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0)
        return;

      const asset = result.assets[0];
      if (!asset?.uri || !asset.name) return;
      if (
        typeof asset.size === 'number' &&
        asset.size > MAX_DOCUMENT_SIZE_BYTES
      ) {
        Alert.alert(pt.warning_title, pt.document_size_exceeded);
        return;
      }

      const formData = new FormData();
      formData.append('type', EMessageType.document);
      formData.append('hash', createClientMessageHash());
      await appendMediaToFormData(formData, 'documents', {
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType || 'application/octet-stream',
      });

      setSendingCapturedMedia(true);
      try {
        await submitFormDataMessage(formData);
      } finally {
        setSendingCapturedMedia(false);
      }
    } finally {
      documentPickerActiveRef.current = false;
    }
  }, [
    canComposeInChat,
    sendingCapturedMedia,
    sendingVoiceRecording,
    submitFormDataMessage,
  ]);

  const handlePickAudioFile = useCallback(async () => {
    setCameraPickerVisible(false);
    if (!canComposeInChat || sendingCapturedMedia || sendingVoiceRecording) {
      return;
    }
    if (documentPickerActiveRef.current) return;

    documentPickerActiveRef.current = true;
    await new Promise<void>((resolve) => setTimeout(resolve, 350));

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'audio/mpeg',
          'audio/mp3',
          'audio/aac',
          'audio/m4a',
          'audio/x-m4a',
          'audio/amr',
          'audio/amr-wb',
          'audio/ogg',
          'audio/opus',
          'audio/*',
        ],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0)
        return;

      const asset = result.assets[0];
      if (!asset?.uri || !asset.name) return;

      const extension = extractExtension(asset.name);
      const allowedExtensions = new Set([
        'mp3',
        'aac',
        'm4a',
        'amr',
        'ogg',
        'opus',
      ]);
      if (!allowedExtensions.has(extension)) {
        Alert.alert(pt.warning_title, pt.invalid_audio_format);
        return;
      }

      if (typeof asset.size === 'number' && asset.size > MAX_AUDIO_SIZE_BYTES) {
        Alert.alert(pt.warning_title, pt.audio_size_exceeded);
        return;
      }

      const formData = new FormData();
      formData.append('type', EMessageType.audio);
      formData.append('hash', createClientMessageHash());
      await appendMediaToFormData(formData, 'audios', {
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType || 'audio/mpeg',
      });

      setSendingCapturedMedia(true);
      try {
        await submitFormDataMessage(formData);
      } finally {
        setSendingCapturedMedia(false);
      }
    } finally {
      documentPickerActiveRef.current = false;
    }
  }, [
    canComposeInChat,
    extractExtension,
    sendingCapturedMedia,
    sendingVoiceRecording,
    submitFormDataMessage,
  ]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedContactSearch(contactPickerSearch.trim());
    }, 350);
    return () => clearTimeout(timer);
  }, [contactPickerSearch]);

  const loadContactPicker = useCallback(
    async (page: number, append: boolean) => {
      if (!contactPickerVisible) return;
      if (append) {
        setLoadingMoreContactPicker(true);
      } else {
        setLoadingContactPicker(true);
      }

      try {
        const response = await listChatContacts(
          page,
          25,
          debouncedContactSearch
        );
        const items = response?.results ?? [];
        if (append) {
          setContactPickerItems((previous) => {
            const map = new Map<string, ListChatContactResult>();
            for (const item of previous) {
              map.set(item.contact_id, item);
            }
            for (const item of items) {
              map.set(item.contact_id, item);
            }
            return Array.from(map.values());
          });
        } else {
          setContactPickerItems(items);
        }
        setContactPickerPage(response?.current_page ?? page);
        setContactPickerTotalPages(response?.total_pages ?? 1);
      } finally {
        if (append) {
          setLoadingMoreContactPicker(false);
        } else {
          setLoadingContactPicker(false);
        }
      }
    },
    [contactPickerVisible, debouncedContactSearch]
  );

  useEffect(() => {
    if (!contactPickerVisible) return;
    setContactPickerPage(1);
    setContactPickerTotalPages(1);
    void loadContactPicker(1, false);
  }, [contactPickerVisible, debouncedContactSearch, loadContactPicker]);

  const handleLoadMoreContactPicker = useCallback(() => {
    if (
      !contactPickerVisible ||
      loadingContactPicker ||
      loadingMoreContactPicker
    ) {
      return;
    }
    if (contactPickerPage >= contactPickerTotalPages) return;
    void loadContactPicker(contactPickerPage + 1, true);
  }, [
    contactPickerPage,
    contactPickerTotalPages,
    contactPickerVisible,
    loadContactPicker,
    loadingContactPicker,
    loadingMoreContactPicker,
  ]);

  const toggleContactSelection = useCallback((contactId: string) => {
    setSelectedContactIds((previous) => {
      if (previous.includes(contactId)) {
        return previous.filter((id) => id !== contactId);
      }
      if (previous.length >= MAX_CONTACTS_SELECTED) {
        Alert.alert(
          pt.warning_title,
          pt.max_contacts_selected.replace(
            '{count}',
            String(MAX_CONTACTS_SELECTED)
          )
        );
        return previous;
      }
      return [...previous, contactId];
    });
  }, []);

  const handleSendSelectedContacts = useCallback(async () => {
    if (selectedContactIds.length === 0) {
      Alert.alert(pt.warning_title, pt.select_at_least_one_contact);
      return;
    }

    if (sendingCapturedMedia || !canComposeInChat) return;
    setSendingCapturedMedia(true);

    try {
      for (const contactId of selectedContactIds) {
        const formData = new FormData();
        formData.append('type', EMessageType.contact_card);
        formData.append('contacts', contactId);
        formData.append('hash', createClientMessageHash());
        const ok = await submitFormDataMessage(formData);
        if (!ok) return;
      }

      setContactPickerVisible(false);
      setContactPickerSearch('');
      setSelectedContactIds([]);
    } finally {
      setSendingCapturedMedia(false);
    }
  }, [
    canComposeInChat,
    selectedContactIds,
    sendingCapturedMedia,
    submitFormDataMessage,
  ]);

  const resolveCurrentLocation = useCallback(async () => {
    setLocationCurrentLoading(true);
    setLocationCurrentError(false);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setLocationCurrentError(true);
        Alert.alert(pt.warning_title, pt.location_permission_denied);
        return;
      }

      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setLocationLatitudeInput(current.coords.latitude.toFixed(6));
      setLocationLongitudeInput(current.coords.longitude.toFixed(6));
      if (!locationNameInput.trim()) {
        setLocationNameInput(pt.location_current);
      }
    } catch {
      setLocationCurrentError(true);
    } finally {
      setLocationCurrentLoading(false);
    }
  }, [locationNameInput]);

  const handleOpenLocationPicker = useCallback(() => {
    setCameraPickerVisible(false);
    setLocationPickerMode('current');
    setLocationNameInput('');
    setLocationAddressInput('');
    setLocationPickerVisible(true);
    void resolveCurrentLocation();
  }, [resolveCurrentLocation]);

  const handleSendLocation = useCallback(async () => {
    const latitude = Number.parseFloat(locationLatitudeInput.replace(',', '.'));
    const longitude = Number.parseFloat(
      locationLongitudeInput.replace(',', '.')
    );
    const isLatitudeValid =
      Number.isFinite(latitude) && latitude >= -90 && latitude <= 90;
    const isLongitudeValid =
      Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;

    if (!isLatitudeValid || !isLongitudeValid) {
      Alert.alert(pt.warning_title, pt.location_invalid_coordinates);
      return;
    }
    if (sendingCapturedMedia || !canComposeInChat) return;

    const formData = new FormData();
    formData.append('type', EMessageType.location);
    formData.append('location_latitude', String(latitude));
    formData.append('location_longitude', String(longitude));
    const normalizedName = locationNameInput.trim();
    const normalizedAddress = locationAddressInput.trim();
    if (normalizedName.length > 0) {
      formData.append('location_name', normalizedName);
    }
    if (normalizedAddress.length > 0) {
      formData.append('location_address', normalizedAddress);
    }
    formData.append('hash', createClientMessageHash());

    setSendingCapturedMedia(true);
    try {
      const ok = await submitFormDataMessage(formData);
      if (!ok) return;
      setLocationPickerVisible(false);
    } finally {
      setSendingCapturedMedia(false);
    }
  }, [
    canComposeInChat,
    locationAddressInput,
    locationLatitudeInput,
    locationLongitudeInput,
    locationNameInput,
    sendingCapturedMedia,
    submitFormDataMessage,
  ]);

  const handleOpenAnnotationModal = useCallback(() => {
    setCameraPickerVisible(false);
    setAnnotationInput('');
    setAnnotationModalVisible(true);
  }, []);

  const handleSendAnnotation = useCallback(async () => {
    const message = annotationInput.trim();
    if (!message || sendingAnnotation || !canComposeInChat) return;

    setSendingAnnotation(true);
    try {
      const formData = new FormData();
      formData.append('type', EMessageType.annotation);
      formData.append('message', message);
      formData.append('hash', createClientMessageHash());

      const ok = await submitFormDataMessage(formData);
      if (!ok) return;

      setAnnotationModalVisible(false);
      setAnnotationInput('');
    } finally {
      setSendingAnnotation(false);
    }
  }, [
    annotationInput,
    canComposeInChat,
    sendingAnnotation,
    submitFormDataMessage,
  ]);

  const attachmentActions = useMemo<AttachmentAction[]>(
    () => [
      {
        key: 'document',
        label: pt.documents,
        icon: 'document-text-outline',
        color: '#1D9BF0',
        onPress: () => {
          void handlePickDocument();
        },
      },
      {
        key: 'photo',
        label: pt.photos,
        icon: 'image-outline',
        color: '#1D9BF0',
        onPress: () => {
          void handlePickPhotoCapture();
        },
      },
      {
        key: 'video',
        label: pt.videos,
        icon: 'videocam-outline',
        color: '#4F46E5',
        onPress: () => {
          void handlePickVideoCapture();
        },
      },
      {
        key: 'audio',
        label: pt.audio,
        icon: 'headset-outline',
        color: '#22C55E',
        onPress: () => {
          void handlePickAudioFile();
        },
      },
      {
        key: 'contact',
        label: pt.contact,
        icon: 'person-outline',
        color: '#6B7280',
        onPress: () => {
          setCameraPickerVisible(false);
          setSelectedContactIds([]);
          setContactPickerSearch('');
          setContactPickerVisible(true);
        },
      },
      {
        key: 'location',
        label: pt.location,
        icon: 'location-outline',
        color: '#10B981',
        onPress: handleOpenLocationPicker,
      },
      {
        key: 'annotation',
        label: pt.annotation,
        icon: 'reader-outline',
        color: '#E11D48',
        onPress: handleOpenAnnotationModal,
      },
    ],
    [
      handleOpenAnnotationModal,
      handleOpenLocationPicker,
      handlePickAudioFile,
      handlePickDocument,
      handlePickPhotoCapture,
      handlePickVideoCapture,
    ]
  );

  const handleOpenAttachmentPicker = useCallback(() => {
    if (
      !canComposeInChat ||
      sendingCapturedMedia ||
      sendingVoiceRecording ||
      isRecordingVoice
    ) {
      return;
    }
    setCameraPickerVisible(true);
  }, [
    canComposeInChat,
    sendingCapturedMedia,
    sendingVoiceRecording,
    isRecordingVoice,
  ]);

  const handleQuickCameraCapture = useCallback(async () => {
    if (
      !canComposeInChat ||
      sendingCapturedMedia ||
      sendingVoiceRecording ||
      isRecordingVoice
    ) {
      return;
    }

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(pt.warning_title, pt.camera_permission_denied);
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      videoMaxDuration: 120,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return;
    }

    const asset = result.assets[0];
    if (!asset?.uri) return;

    const kind = asset.type === 'video' ? 'video' : 'image';
    const fallbackExtension = kind === 'video' ? 'mp4' : 'jpg';
    const fallbackMime = kind === 'video' ? 'video/mp4' : 'image/jpeg';
    const originalName = asset.fileName?.trim();
    const hasExtension =
      typeof originalName === 'string' &&
      /\.[a-z0-9]{2,5}$/i.test(originalName);
    const fileName =
      originalName && hasExtension
        ? originalName
        : `${kind}-${Date.now()}.${fallbackExtension}`;

    await sendCapturedMediaDraft({
      uri: asset.uri,
      kind,
      fileName,
      mimeType: asset.mimeType || fallbackMime,
      durationSec:
        kind === 'video' && typeof asset.duration === 'number'
          ? Math.max(1, Math.round(asset.duration / 1000))
          : null,
    });
  }, [
    canComposeInChat,
    isRecordingVoice,
    sendCapturedMediaDraft,
    sendingCapturedMedia,
    sendingVoiceRecording,
  ]);

  const recordingDurationLabel = useMemo(() => {
    const durationSec = Math.max(0, (recorderState.durationMillis || 0) / 1000);
    return formatAudioTime(durationSec);
  }, [recorderState.durationMillis]);

  const recordingWaveformBars = useMemo(() => {
    if (recordingWaveform.length > 0) return recordingWaveform;
    return new Array(RECORDING_WAVEFORM_MIN_BARS).fill(0.2);
  }, [recordingWaveform]);

  useEffect(() => {
    recordingActiveRef.current =
      isRecordingVoice || isRecordingPaused || recorderState.isRecording;
  }, [isRecordingPaused, isRecordingVoice, recorderState.isRecording]);

  useEffect(() => {
    return () => {
      if (!recordingActiveRef.current) return;
      try {
        recorder.stop();
      } catch {}
      void applyRecordingAudioMode(false);
    };
  }, [applyRecordingAudioMode, recorder]);

  const previousChatIdRef = useRef(chatInfo.chat_id);
  useEffect(() => {
    if (previousChatIdRef.current === chatInfo.chat_id) return;
    previousChatIdRef.current = chatInfo.chat_id;
    if (!recordingActiveRef.current) return;
    void discardVoiceRecordingCbRef.current();
  }, [chatInfo.chat_id]);

  const sendTextPayload = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || sending || !canComposeInChat) return false;

      setSending(true);
      try {
        const newMsg = await createMessage(
          chatInfo.chat_id,
          EMessageType.text,
          text
        );
        if (newMsg) {
          pendingScrollToBottomRef.current = true;
          setShowScrollToBottomButton(false);
          setMessages((prev) => mergeMessageLists(prev, newMsg));
          requestAnimationFrame(() => {
            scrollToBottomWithRetries(10);
          });
          return true;
        }
      } finally {
        setSending(false);
      }
      return false;
    },
    [canComposeInChat, chatInfo.chat_id, sending, scrollToBottomWithRetries]
  );

  const handleTemplateButtonPress = useCallback(
    (button: MessageTemplateButton, _message: ListMessageResult) => {
      if (!canComposeInChat) return;
      const buttonText = readNonEmptyString(button.displayText);
      if (!buttonText) return;
      void sendTextPayload(buttonText);
    },
    [canComposeInChat, sendTextPayload]
  );

  const handleSend = async () => {
    const text = input.trim();
    if (
      !text ||
      sending ||
      isRecordingVoice ||
      sendingCapturedMedia ||
      !canComposeInChat
    ) {
      return;
    }

    setInput('');
    await sendTextPayload(text);
  };

  const hasInputText = input.trim().length > 0;
  const canFocusInput =
    canComposeInChat &&
    !sending &&
    !sendingCapturedMedia &&
    !isPreparingRecording &&
    !isRecordingVoice;
  const canUseComposerActions =
    !sending &&
    canComposeInChat &&
    !isPreparingRecording &&
    !sendingVoiceRecording &&
    !sendingCapturedMedia;
  const showRecordingHoldOverlay =
    isMicPressActive &&
    !isRecordingLocked &&
    (isPreparingRecording || isRecordingVoice);
  const showRecordingComposer =
    isRecordingVoice && (isRecordingLocked || !isMicPressActive);
  const canShowIconActions = !hasInputText && !showRecordingComposer;

  const focusComposerInput = useCallback(() => {
    if (!canFocusInput) return;
    messageInputRef.current?.focus();
  }, [canFocusInput]);

  const handleEmojiPress = useCallback(() => {
    focusComposerInput();
  }, [focusComposerInput]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={[styles.chatHeader, { paddingTop: insets.top + 8 }]}>
        <View style={styles.chatHeaderTopRow}>
          <Pressable
            style={styles.chatHeaderBackBtn}
            onPress={() => navigation.goBack()}
            accessibilityLabel={pt.close}
          >
            <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
          </Pressable>

          <View style={styles.chatHeaderContactWrap}>
            <View style={styles.chatHeaderAvatarWrap}>
              <AppAvatar
                uri={chatInfo.contact?.photo ?? chatInfo.photo}
                size={36}
                style={styles.chatHeaderAvatar}
                iconName="person"
                iconSize={20}
                iconColor={colors.grey600}
              />
            </View>

            <View style={styles.chatHeaderContactInfo}>
              <Text style={styles.chatHeaderName} numberOfLines={1}>
                {chatInfo.contact?.name ?? chatInfo.name ?? pt.contact}
              </Text>

              <View style={styles.chatHeaderPhoneRow}>
                <Text style={styles.chatHeaderPhone} numberOfLines={1}>
                  {headerPhoneValue}
                </Text>
                {chatInfo.contact?.id ? (
                  <Pressable
                    onPress={() => {
                      void handleToggleHeaderPhoneVisibility();
                    }}
                    disabled={isHeaderPhoneLoading}
                  >
                    {isHeaderPhoneLoading ? (
                      <ActivityIndicator size="small" color={colors.grey600} />
                    ) : (
                      <Ionicons
                        name={
                          isHeaderPhoneDecrypted
                            ? 'eye-off-outline'
                            : 'eye-outline'
                        }
                        size={16}
                        color={colors.grey700}
                      />
                    )}
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>

          <Pressable
            style={styles.chatHeaderMenuBtn}
            onPress={() => setMenuVisible(true)}
            accessibilityLabel={pt.settings}
          >
            <Ionicons
              name="ellipsis-vertical"
              size={20}
              color={colors.onSurface}
            />
          </Pressable>
        </View>

        <View style={styles.chatHeaderMetaRow}>
          {showProtocolInHeader && primaryProtocol ? (
            <Pressable
              style={styles.chatHeaderProtocolChip}
              onPress={() => setProtocolModalVisible(true)}
            >
              <Ionicons
                name="document-text-outline"
                size={14}
                color={colors.primary}
              />
              <Text style={styles.chatHeaderProtocolText} numberOfLines={1}>
                {pt.protocol}: {primaryProtocol.protocol}
              </Text>
              {extraProtocolCount > 0 ? (
                <View style={styles.chatHeaderCounterChip}>
                  <Text style={styles.chatHeaderCounterChipText}>
                    +{extraProtocolCount}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          ) : null}

          {primaryChatLabel ? (
            <Pressable
              style={[
                styles.chatHeaderLabelChip,
                { borderColor: primaryChatLabel.color },
              ]}
              onPress={() => {
                if (!canLabelAction) return;
                void openLabelModal();
              }}
            >
              <Ionicons
                name="pricetag-outline"
                size={14}
                color={primaryChatLabel.color}
              />
              <Text
                style={[
                  styles.chatHeaderLabelText,
                  { color: primaryChatLabel.color },
                ]}
                numberOfLines={1}
              >
                {primaryChatLabel.label}
              </Text>
              {remainingChatLabelsCount > 0 ? (
                <View
                  style={[
                    styles.chatHeaderCounterChip,
                    { backgroundColor: primaryChatLabel.color },
                  ]}
                >
                  <Text style={styles.chatHeaderCounterChipText}>
                    +{remainingChatLabelsCount}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          ) : null}

          {isHistoryReadonly ? (
            <View style={styles.chatHeaderReadonlyChip}>
              <Ionicons
                name="lock-closed-outline"
                size={13}
                color={colors.grey700}
              />
              <Text style={styles.chatHeaderReadonlyText}>
                {pt.history_readonly}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.chatBody}>
        {loading ? (
          <ChatRoomSkeleton />
        ) : (
          <>
            <FlatList
              key={chatInfo.chat_id}
              ref={listRef}
              data={messagesWithSeparators}
              keyExtractor={(item) =>
                item.type === 'separator'
                  ? `separator-${chatInfo.chat_id}-${item.separatorDate}`
                  : `message-${chatInfo.chat_id}-${item.message.message_id}`
              }
              renderItem={({ item }) => {
                if (item.type === 'separator') {
                  return <DateSeparator label={item.separatorLabel} />;
                }

                const quotedTargetId = resolveQuotedTargetMessageId(
                  item.message,
                  messages
                );
                const canGoToQuoted =
                  !!quotedTargetId && messageIdSet.has(quotedTargetId);

                return (
                  <MessageBubble
                    msg={item.message}
                    fromMe={item.message.type_user !== ETypeUserChat.client}
                    chatInfo={chatInfo}
                    currentUserName={currentUserName}
                    highlighted={
                      highlightedMessageId === item.message.message_id
                    }
                    onPressQuoted={
                      canGoToQuoted && quotedTargetId
                        ? () => scrollToMessageById(quotedTargetId)
                        : null
                    }
                    resolvedContactDisplay={
                      resolvedContactCards[item.message.message_id]
                    }
                    audioCtrl={audioCtrl}
                    onOpenImage={openImageViewer}
                    onOpenVideo={openVideoViewer}
                    onTemplateButtonPress={handleTemplateButtonPress}
                    disableTemplateButtons={!canComposeInChat || sending}
                    obfuscateContent={shouldObfuscateContent}
                  />
                );
              }}
              onScrollToIndexFailed={handleScrollToIndexFailed}
              onScroll={handleListScroll}
              scrollEventThrottle={16}
              onContentSizeChange={handleListContentSizeChange}
              contentContainerStyle={styles.listContent}
              inverted={false}
            />
            {loadingOlder ? (
              <View pointerEvents="none" style={styles.loadingOlderTopWrap}>
                <View style={styles.loadingOlderTopChip}>
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                  <Text style={styles.loadingOlderTopText}>
                    {pt.loading_more_messages}
                  </Text>
                </View>
              </View>
            ) : null}
          </>
        )}
      </View>
      {showScrollToBottomButton ? (
        <Pressable
          style={[
            styles.scrollToBottomButton,
            isTyping && styles.scrollToBottomButtonWithTyping,
          ]}
          onPress={jumpToBottom}
          accessibilityLabel={pt.scroll_to_latest}
        >
          <Ionicons name="chevron-down" size={20} color={colors.onPrimary} />
        </Pressable>
      ) : null}
      {isTyping ? (
        <View style={styles.typingIndicatorWrap}>
          <Ionicons
            name={
              remoteActivityMode === 'recording'
                ? 'mic-outline'
                : 'create-outline'
            }
            size={18}
            color={colors.primary}
          />
          <Text style={styles.typingIndicatorText} numberOfLines={1}>
            {typingLabel}
          </Text>
        </View>
      ) : null}
      {showAttendReopenBanner ? (
        <View style={styles.attendReopenBanner}>
          <Text style={styles.attendReopenBannerText}>
            {attendReopenBannerMessage}
          </Text>
          <Pressable
            style={[
              styles.attendReopenBannerAction,
              (!isAttendReopenActionAllowed || isAttendReopenLoading) &&
                styles.attendReopenBannerActionDisabled,
            ]}
            onPress={() => {
              void handleAttendOrReopen();
            }}
            disabled={!isAttendReopenActionAllowed || isAttendReopenLoading}
          >
            {isAttendReopenLoading ? (
              <ActivityIndicator size="small" color={colors.onPrimary} />
            ) : (
              <Text style={styles.attendReopenBannerActionText}>
                {attendReopenButtonLabel}
              </Text>
            )}
          </Pressable>
          {attendReopenBlockedReason ? (
            <Text style={styles.attendReopenBlockedReason}>
              {attendReopenBlockedReason}
            </Text>
          ) : null}
        </View>
      ) : null}
      {shouldObfuscateContent ? (
        <View style={styles.protectedBanner}>
          <Ionicons
            name="lock-closed-outline"
            size={14}
            color={colors.grey700}
          />
          <Text style={styles.protectedBannerText}>{pt.protected_content}</Text>
        </View>
      ) : null}
      {isHistoryReadonly ? (
        <View style={styles.readonlyFooter}>
          <Ionicons
            name="lock-closed-outline"
            size={14}
            color={colors.grey700}
          />
          <Text style={styles.readonlyFooterText}>{pt.history_readonly}</Text>
        </View>
      ) : (
        <View
          style={[
            styles.inputRow,
            isTyping && styles.inputRowWithTyping,
            showRecordingComposer && styles.inputRowRecording,
          ]}
        >
          {showRecordingComposer ? (
            <View style={styles.recordingComposerWrap}>
              {isRecordingLocked ? (
                <>
                  <Pressable
                    style={styles.recordActionBtn}
                    onPress={() => {
                      void discardVoiceRecording();
                    }}
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
                          {
                            transform: [{ scale: recordingPulse }],
                          },
                        ]}
                      />
                      <Text style={styles.recordingTimeText}>
                        {recordingDurationLabel}
                      </Text>
                    </View>

                    <View style={styles.recordingWaveformTrack}>
                      {recordingWaveformBars.map((value, index) => (
                        <View
                          key={`record-locked-${index}`}
                          style={[
                            styles.recordingWaveformBar,
                            {
                              height: `${Math.max(14, value * 100)}%`,
                            },
                          ]}
                        />
                      ))}
                    </View>
                  </View>

                  <Pressable
                    style={styles.recordActionBtn}
                    onPress={togglePauseVoiceRecording}
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
                    style={[
                      styles.recordActionBtn,
                      styles.recordSendBtn,
                      sendingVoiceRecording && styles.sendBtnDisabled,
                    ]}
                    onPress={() => {
                      void sendRecordedVoiceMessage();
                    }}
                    disabled={sendingVoiceRecording}
                    accessibilityLabel={pt.send_recording}
                  >
                    <Ionicons name="send" size={18} color="#FFFFFF" />
                  </Pressable>
                </>
              ) : (
                <>
                  <View style={styles.recordingLiveMeta}>
                    <Animated.View
                      style={[
                        styles.recordingDot,
                        {
                          transform: [{ scale: recordingPulse }],
                        },
                      ]}
                    />
                    <Text style={styles.recordingTimeText}>
                      {recordingDurationLabel}
                    </Text>
                  </View>

                  <View style={styles.recordingWaveformTrack}>
                    {recordingWaveformBars.map((value, index) => (
                      <View
                        key={`record-live-${index}`}
                        style={[
                          styles.recordingWaveformBar,
                          {
                            height: `${Math.max(12, value * 100)}%`,
                          },
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
              {!isRecordingVoice && !showRecordingHoldOverlay ? (
                <Pressable
                  style={[
                    styles.composerActionBtn,
                    styles.plusActionBtn,
                    !canUseComposerActions && styles.sendBtnDisabled,
                  ]}
                  onPress={handleOpenAttachmentPicker}
                  disabled={!canUseComposerActions}
                  accessibilityLabel={pt.open_attachments}
                >
                  <Ionicons name="add" size={20} color={colors.grey700} />
                </Pressable>
              ) : null}

              <View style={styles.inputStack}>
                <TextInput
                  ref={messageInputRef}
                  style={styles.input}
                  placeholder={pt.type_message}
                  placeholderTextColor={colors.grey500}
                  value={input}
                  onChangeText={setInput}
                  onPressIn={focusComposerInput}
                  keyboardType="default"
                  multiline
                  maxLength={65535}
                  editable={
                    canComposeInChat &&
                    !sending &&
                    !sendingCapturedMedia &&
                    !isPreparingRecording &&
                    !isRecordingVoice
                  }
                />
                {!showRecordingHoldOverlay ? (
                  <Pressable
                    style={styles.emojiInputBtn}
                    onPress={handleEmojiPress}
                    disabled={!canFocusInput}
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
                  <View
                    pointerEvents="none"
                    style={styles.recordingHoldOverlay}
                  >
                    <View style={styles.recordingHoldLeft}>
                      <Animated.View
                        style={[
                          styles.recordingDot,
                          !isRecordingVoice && styles.recordingDotPaused,
                          {
                            transform: [{ scale: recordingPulse }],
                          },
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

              {hasInputText ? (
                <Pressable
                  style={[
                    styles.sendBtn,
                    (!hasInputText || sending) && styles.sendBtnDisabled,
                  ]}
                  onPress={handleSend}
                  disabled={!hasInputText || sending}
                >
                  <Ionicons name="send" size={22} color="#fff" />
                </Pressable>
              ) : (
                <View style={styles.composerActionsWrap}>
                  {!isRecordingVoice && !showRecordingHoldOverlay ? (
                    <Pressable
                      style={[
                        styles.composerActionBtn,
                        !canUseComposerActions && styles.sendBtnDisabled,
                      ]}
                      onPress={() => {
                        void handleQuickCameraCapture();
                      }}
                      disabled={!canUseComposerActions}
                      accessibilityLabel={pt.open_camera}
                    >
                      <Ionicons
                        name="camera-outline"
                        size={21}
                        color="#FFFFFF"
                      />
                    </Pressable>
                  ) : null}

                  {canShowIconActions ? (
                    <View style={styles.micGestureWrap} collapsable={false}>
                      {showRecordingHoldOverlay && !isRecordingCancelArmed ? (
                        <Animated.View
                          pointerEvents="none"
                          style={[
                            styles.micLockHintPill,
                            {
                              opacity: recordingHintOpacity,
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
                          (isPreparingRecording || isRecordingVoice) &&
                            styles.micActionBtnRecording,
                          styles.micActionBtnLarge,
                          !canUseComposerActions && styles.sendBtnDisabled,
                          {
                            transform: [{ scale: recordingPulse }],
                          },
                        ]}
                      >
                        {isPreparingRecording ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Ionicons name="mic" size={22} color="#FFFFFF" />
                        )}
                      </Animated.View>
                    </View>
                  ) : null}
                </View>
              )}
            </>
          )}
        </View>
      )}

      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <Pressable
          style={styles.menuOverlay}
          onPress={() => setMenuVisible(false)}
        >
          <Pressable
            style={styles.menuCard}
            onPress={(event) => event.stopPropagation()}
          >
            {menuActions.map((action) => (
              <Pressable
                key={action.key}
                style={styles.menuItem}
                onPress={() => {
                  setMenuVisible(false);
                  action.onPress();
                }}
              >
                <Ionicons
                  name={action.icon}
                  size={18}
                  color={action.danger ? colors.error : colors.onSurface}
                />
                <Text
                  style={[
                    styles.menuItemText,
                    action.danger && styles.menuItemTextDanger,
                  ]}
                >
                  {action.label}
                </Text>
                {action.active ? (
                  <Ionicons
                    name="checkmark-circle"
                    size={18}
                    color={colors.primary}
                  />
                ) : null}
                {isTogglingForwardToOutput &&
                action.key === 'forward_to_output_chatbot' ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : null}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={protocolModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setProtocolModalVisible(false)}
      >
        <View style={styles.bottomSheetOverlay}>
          <Pressable
            style={styles.bottomSheetBackdrop}
            onPress={() => setProtocolModalVisible(false)}
          />
          <View style={styles.bottomSheetCard}>
            <View style={styles.bottomSheetHeader}>
              <Text style={styles.bottomSheetTitle}>{pt.protocols}</Text>
              <Pressable onPress={() => setProtocolModalVisible(false)}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <FlatList
              data={protocolList}
              keyExtractor={(item) => `${item.type}-${item.protocol}`}
              contentContainerStyle={styles.bottomSheetList}
              renderItem={({ item }) => (
                <View style={styles.protocolRow}>
                  <View
                    style={[
                      styles.protocolTypeBadge,
                      { backgroundColor: resolveProtocolTypeColor(item.type) },
                    ]}
                  >
                    <Text style={styles.protocolTypeBadgeText}>
                      {item.type}
                    </Text>
                  </View>
                  <Text style={styles.protocolRowText}>{item.protocol}</Text>
                </View>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyText}>{pt.no_results_found}</Text>
              }
            />
          </View>
        </View>
      </Modal>

      <Modal
        visible={labelModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setLabelModalVisible(false)}
      >
        <View style={styles.bottomSheetOverlay}>
          <Pressable
            style={styles.bottomSheetBackdrop}
            onPress={() => setLabelModalVisible(false)}
          />
          <View style={styles.bottomSheetCard}>
            <View style={styles.bottomSheetHeader}>
              <Text style={styles.bottomSheetTitle}>{pt.label}</Text>
              <Pressable onPress={() => setLabelModalVisible(false)}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            {isLoadingLabelModal ? (
              <View style={styles.modalLoadingWrap}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : (
              <FlatList
                data={labelTemplates}
                keyExtractor={(item) => item.label_template_id}
                contentContainerStyle={styles.bottomSheetList}
                renderItem={({ item }) => {
                  const selected = selectedLabelTemplateIds.includes(
                    item.label_template_id
                  );
                  return (
                    <Pressable
                      style={styles.labelRow}
                      onPress={() => {
                        setSelectedLabelTemplateIds((prev) => {
                          if (prev.includes(item.label_template_id)) {
                            return prev.filter(
                              (id) => id !== item.label_template_id
                            );
                          }
                          return [...prev, item.label_template_id];
                        });
                      }}
                    >
                      <View
                        style={[
                          styles.labelColorDot,
                          { backgroundColor: item.color },
                        ]}
                      />
                      <Text style={styles.labelRowText}>{item.label}</Text>
                      {selected ? (
                        <Ionicons
                          name="checkmark-circle"
                          size={18}
                          color={colors.primary}
                        />
                      ) : null}
                    </Pressable>
                  );
                }}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>{pt.no_results_found}</Text>
                }
              />
            )}

            <View style={styles.bottomSheetFooter}>
              <Pressable
                style={styles.secondaryBtn}
                onPress={handleClearLabels}
              >
                <Text style={styles.secondaryBtnText}>{pt.clear_filter}</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.primaryBtn,
                  isSavingLabelModal && styles.sendBtnDisabled,
                ]}
                onPress={() => {
                  void handleSaveLabels();
                }}
                disabled={isSavingLabelModal}
              >
                {isSavingLabelModal ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : (
                  <Text style={styles.primaryBtnText}>{pt.save}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={searchModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSearchModalVisible(false)}
      >
        <View style={styles.bottomSheetOverlay}>
          <Pressable
            style={styles.bottomSheetBackdrop}
            onPress={() => setSearchModalVisible(false)}
          />
          <View style={[styles.bottomSheetCard, styles.searchSheetCard]}>
            <View style={styles.bottomSheetHeader}>
              <Text style={styles.bottomSheetTitle}>{pt.search_messages}</Text>
              <Pressable onPress={() => setSearchModalVisible(false)}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <View style={styles.searchInputWrap}>
              <Ionicons
                name="search-outline"
                size={18}
                color={colors.grey600}
              />
              <TextInput
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={pt.search_messages_placeholder}
                placeholderTextColor={colors.grey500}
                maxLength={120}
              />
            </View>

            {debouncedSearchQuery.length > 0 &&
            debouncedSearchQuery.length < 3 ? (
              <Text style={styles.modalHintText}>
                {pt.search_minimum_characters.replace('{count}', '3')}
              </Text>
            ) : null}

            {searchLoading ? (
              <View style={styles.modalLoadingWrap}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : (
              <FlatList
                data={searchResults}
                keyExtractor={(item) => item.message_id}
                contentContainerStyle={styles.bottomSheetList}
                onEndReached={handleLoadMoreSearchResults}
                onEndReachedThreshold={0.25}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.searchResultRow}
                    onPress={() => handleSelectSearchedMessage(item.message_id)}
                  >
                    <Text style={styles.searchResultDate}>
                      {formatSearchResultDate(item.date)}
                    </Text>
                    <Text style={styles.searchResultText} numberOfLines={3}>
                      {item.message || '-'}
                    </Text>
                  </Pressable>
                )}
                ListEmptyComponent={
                  debouncedSearchQuery.trim().length >= 3 ? (
                    <Text style={styles.emptyText}>{pt.no_results_found}</Text>
                  ) : null
                }
                ListFooterComponent={
                  searchLoadingMore ? (
                    <View style={styles.modalLoadingWrap}>
                      <ActivityIndicator size="small" color={colors.primary} />
                    </View>
                  ) : null
                }
              />
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={attendanceHistoryVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAttendanceHistoryVisible(false)}
      >
        <View style={styles.bottomSheetOverlay}>
          <Pressable
            style={styles.bottomSheetBackdrop}
            onPress={() => setAttendanceHistoryVisible(false)}
          />
          <View style={[styles.bottomSheetCard, styles.searchSheetCard]}>
            <View style={styles.bottomSheetHeader}>
              <Text style={styles.bottomSheetTitle}>
                {pt.attendance_history}
              </Text>
              <Pressable onPress={() => setAttendanceHistoryVisible(false)}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            {attendanceHistoryLoading ? (
              <AttendanceHistorySkeleton
                rows={ATTENDANCE_HISTORY_SKELETON_ROWS}
              />
            ) : (
              <FlatList
                data={attendanceHistory}
                keyExtractor={(item) => item.chat_id}
                contentContainerStyle={styles.bottomSheetList}
                onEndReached={handleLoadMoreAttendanceHistory}
                onEndReachedThreshold={0.25}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.historyRow}
                    onPress={() => openHistoryConversation(item)}
                  >
                    <Text style={styles.historyRowTitle} numberOfLines={1}>
                      {item.contact?.name ?? item.name ?? item.phone}
                    </Text>
                    <Text style={styles.historyRowSubtitle}>
                      {pt.protocol}: {item.protocol_start?.[0] || '-'}
                    </Text>
                    <Text style={styles.historyRowSubtitle}>
                      {pt.attendance_time}:{' '}
                      {calculateAttendanceTime(item.started_at, item.closed_at)}
                    </Text>
                  </Pressable>
                )}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>
                    {pt.no_attendance_history}
                  </Text>
                }
                ListFooterComponent={
                  attendanceHistoryLoadingMore ? (
                    <AttendanceHistorySkeleton
                      rows={ATTENDANCE_HISTORY_SKELETON_MORE_ROWS}
                    />
                  ) : null
                }
              />
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={transferModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setTransferModalVisible(false)}
      >
        <View style={styles.bottomSheetOverlay}>
          <Pressable
            style={styles.bottomSheetBackdrop}
            onPress={() => setTransferModalVisible(false)}
          />
          <View style={[styles.bottomSheetCard, styles.transferSheetCard]}>
            <View style={styles.bottomSheetHeader}>
              <Text style={styles.bottomSheetTitle}>{pt.transfer}</Text>
              <Pressable onPress={() => setTransferModalVisible(false)}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <ScrollView
              style={styles.transferFormScroll}
              contentContainerStyle={styles.transferFormContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.formField}>
                <Text style={styles.formFieldLabel}>{pt.channel}</Text>
                <Pressable
                  style={styles.formSelector}
                  onPress={() => setTransferPickerKind('channel')}
                >
                  <Text style={styles.formSelectorText} numberOfLines={1}>
                    {selectedTransferChannel?.title ??
                      pt.transfer_select_channel}
                  </Text>
                  {isLoadingTransferChannels ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Ionicons
                      name="chevron-down"
                      size={16}
                      color={colors.grey600}
                    />
                  )}
                </Pressable>
              </View>

              <View style={styles.formField}>
                <Text style={styles.formFieldLabel}>{pt.transfer_to}</Text>
                <Pressable
                  style={styles.formSelector}
                  onPress={() => setTransferPickerKind('type')}
                >
                  <Text style={styles.formSelectorText} numberOfLines={1}>
                    {transferType === 'user'
                      ? pt.transfer_type_user
                      : transferType === 'sector'
                        ? pt.transfer_type_sector
                        : pt.transfer_to_placeholder}
                  </Text>
                  <Ionicons
                    name="chevron-down"
                    size={16}
                    color={colors.grey600}
                  />
                </Pressable>
              </View>

              {transferType === 'user' ? (
                <View style={styles.formField}>
                  <Text style={styles.formFieldLabel}>
                    {pt.transfer_type_user}
                  </Text>
                  <Pressable
                    style={styles.formSelector}
                    onPress={() => setTransferPickerKind('user')}
                  >
                    <Text style={styles.formSelectorText} numberOfLines={1}>
                      {selectedTransferUser?.name ?? pt.transfer_select_user}
                    </Text>
                    {isLoadingTransferUsers ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Ionicons
                        name="chevron-down"
                        size={16}
                        color={colors.grey600}
                      />
                    )}
                  </Pressable>
                </View>
              ) : null}

              {transferType === 'sector' ? (
                <>
                  <View style={styles.formField}>
                    <Text style={styles.formFieldLabel}>{pt.sector}</Text>
                    <Pressable
                      style={styles.formSelector}
                      onPress={() => setTransferPickerKind('sector')}
                    >
                      <Text style={styles.formSelectorText} numberOfLines={1}>
                        {selectedTransferSector?.name ??
                          pt.transfer_select_sector}
                      </Text>
                      {isLoadingTransferSectors ? (
                        <ActivityIndicator
                          size="small"
                          color={colors.primary}
                        />
                      ) : (
                        <Ionicons
                          name="chevron-down"
                          size={16}
                          color={colors.grey600}
                        />
                      )}
                    </Pressable>
                  </View>

                  <View style={styles.formField}>
                    <Text style={styles.formFieldLabel}>
                      {pt.transfer_sector_user_optional}
                    </Text>
                    <Pressable
                      style={styles.formSelector}
                      onPress={() => setTransferPickerKind('sector_user')}
                    >
                      <Text style={styles.formSelectorText} numberOfLines={1}>
                        {selectedTransferSectorUser?.name ??
                          pt.transfer_select_sector_user}
                      </Text>
                      {isLoadingTransferSectorUsers ? (
                        <ActivityIndicator
                          size="small"
                          color={colors.primary}
                        />
                      ) : (
                        <Ionicons
                          name="chevron-down"
                          size={16}
                          color={colors.grey600}
                        />
                      )}
                    </Pressable>
                  </View>
                </>
              ) : null}

              <View style={styles.formField}>
                <Text style={styles.formFieldLabel}>
                  {pt.transfer_annotation}
                </Text>
                <TextInput
                  value={transferAnnotation}
                  onChangeText={setTransferAnnotation}
                  style={styles.transferAnnotationInput}
                  placeholder={pt.transfer_annotation_placeholder}
                  placeholderTextColor={colors.grey500}
                  multiline
                  maxLength={300}
                />
              </View>
            </ScrollView>

            <View style={styles.bottomSheetFooter}>
              <Pressable
                style={styles.secondaryBtn}
                onPress={() => setTransferModalVisible(false)}
              >
                <Text style={styles.secondaryBtnText}>{pt.cancel}</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.primaryBtn,
                  isTransferring && styles.sendBtnDisabled,
                ]}
                onPress={() => {
                  void submitTransfer();
                }}
                disabled={isTransferring}
              >
                {isTransferring ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : (
                  <Text style={styles.primaryBtnText}>{pt.transfer}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={transferPickerKind !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setTransferPickerKind(null)}
      >
        <Pressable
          style={styles.pickerOverlay}
          onPress={() => setTransferPickerKind(null)}
        >
          <Pressable
            style={styles.pickerCard}
            onPress={(event) => event.stopPropagation()}
          >
            <FlatList
              data={transferPickerItems}
              keyExtractor={(item) => item.value}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.pickerRow}
                  onPress={() => handleSelectTransferPickerValue(item.value)}
                >
                  <Text style={styles.pickerRowText}>{item.label}</Text>
                </Pressable>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyText}>{pt.no_results_found}</Text>
              }
            />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={cameraPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCameraPickerVisible(false)}
      >
        <Pressable
          style={styles.cameraPickerOverlay}
          onPress={() => setCameraPickerVisible(false)}
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
                  disabled={!canUseComposerActions}
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
              onPress={() => setCameraPickerVisible(false)}
            >
              <Text style={styles.cameraPickerCancelText}>{pt.cancel}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={annotationModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAnnotationModalVisible(false)}
      >
        <View style={styles.bottomSheetOverlay}>
          <Pressable
            style={styles.bottomSheetBackdrop}
            onPress={() => setAnnotationModalVisible(false)}
          />
          <View style={[styles.bottomSheetCard, styles.annotationSheetCard]}>
            <View style={styles.bottomSheetHeader}>
              <Text style={styles.bottomSheetTitle}>{pt.annotation}</Text>
              <Pressable onPress={() => setAnnotationModalVisible(false)}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            <TextInput
              value={annotationInput}
              onChangeText={setAnnotationInput}
              style={styles.annotationInput}
              placeholder={pt.annotation_placeholder}
              placeholderTextColor={colors.grey500}
              multiline
              maxLength={5000}
            />
            <Text style={styles.modalHintText}>
              {pt.annotation_max_characters.replace('{count}', '5000')}
            </Text>
            <View style={styles.bottomSheetFooter}>
              <Pressable
                style={styles.secondaryBtn}
                onPress={() => setAnnotationModalVisible(false)}
              >
                <Text style={styles.secondaryBtnText}>{pt.cancel}</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.primaryBtn,
                  (!annotationInput.trim() || sendingAnnotation) &&
                    styles.sendBtnDisabled,
                ]}
                onPress={() => {
                  void handleSendAnnotation();
                }}
                disabled={!annotationInput.trim() || sendingAnnotation}
              >
                {sendingAnnotation ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : (
                  <Text style={styles.primaryBtnText}>{pt.send}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={contactPickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setContactPickerVisible(false)}
      >
        <View style={styles.bottomSheetOverlay}>
          <Pressable
            style={styles.bottomSheetBackdrop}
            onPress={() => setContactPickerVisible(false)}
          />
          <View style={[styles.bottomSheetCard, styles.searchSheetCard]}>
            <View style={styles.bottomSheetHeader}>
              <Text style={styles.bottomSheetTitle}>{pt.select_contacts}</Text>
              <Pressable onPress={() => setContactPickerVisible(false)}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <View style={styles.searchInputWrap}>
              <Ionicons
                name="search-outline"
                size={18}
                color={colors.grey600}
              />
              <TextInput
                style={styles.searchInput}
                value={contactPickerSearch}
                onChangeText={setContactPickerSearch}
                placeholder={pt.search_contacts}
                placeholderTextColor={colors.grey500}
                maxLength={120}
              />
            </View>

            {loadingContactPicker ? (
              <View style={styles.modalLoadingWrap}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : (
              <FlatList
                data={contactPickerItems}
                keyExtractor={(item) => item.contact_id}
                contentContainerStyle={styles.bottomSheetList}
                onEndReached={handleLoadMoreContactPicker}
                onEndReachedThreshold={0.25}
                renderItem={({ item }) => {
                  const selected = selectedContactIds.includes(item.contact_id);
                  const fullName = [item.name, item.last_name]
                    .filter(Boolean)
                    .join(' ')
                    .trim();
                  return (
                    <Pressable
                      style={styles.contactPickerRow}
                      onPress={() => toggleContactSelection(item.contact_id)}
                    >
                      <AppAvatar
                        uri={item.photo}
                        size={34}
                        style={styles.contactPickerAvatar}
                        iconName="person"
                        iconColor={colors.grey500}
                      />
                      <View style={styles.contactPickerRowInfo}>
                        <Text
                          style={styles.contactPickerRowName}
                          numberOfLines={1}
                        >
                          {fullName || pt.contact}
                        </Text>
                        <Text
                          style={styles.contactPickerRowPhone}
                          numberOfLines={1}
                        >
                          {item.phone_partial || '-'}
                        </Text>
                      </View>
                      {selected ? (
                        <Ionicons
                          name="checkmark-circle"
                          size={20}
                          color={colors.primary}
                        />
                      ) : null}
                    </Pressable>
                  );
                }}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>{pt.no_contacts_found}</Text>
                }
                ListFooterComponent={
                  loadingMoreContactPicker ? (
                    <View style={styles.modalLoadingWrap}>
                      <ActivityIndicator size="small" color={colors.primary} />
                    </View>
                  ) : null
                }
              />
            )}

            <Text style={styles.modalHintText}>
              {pt.selected_contacts
                .replace('{count}', String(selectedContactIds.length))
                .replace('{max}', String(MAX_CONTACTS_SELECTED))}
            </Text>

            <View style={styles.bottomSheetFooter}>
              <Pressable
                style={styles.secondaryBtn}
                onPress={() => setContactPickerVisible(false)}
              >
                <Text style={styles.secondaryBtnText}>{pt.cancel}</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.primaryBtn,
                  (selectedContactIds.length === 0 || sendingCapturedMedia) &&
                    styles.sendBtnDisabled,
                ]}
                onPress={() => {
                  void handleSendSelectedContacts();
                }}
                disabled={
                  selectedContactIds.length === 0 || sendingCapturedMedia
                }
              >
                {sendingCapturedMedia ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : (
                  <Text style={styles.primaryBtnText}>{pt.send}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={locationPickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setLocationPickerVisible(false)}
      >
        <View style={styles.bottomSheetOverlay}>
          <Pressable
            style={styles.bottomSheetBackdrop}
            onPress={() => setLocationPickerVisible(false)}
          />
          <View style={[styles.bottomSheetCard, styles.locationSheetCard]}>
            <View style={styles.bottomSheetHeader}>
              <Text style={styles.bottomSheetTitle}>{pt.location}</Text>
              <Pressable onPress={() => setLocationPickerVisible(false)}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <View style={styles.locationModeRow}>
              <Pressable
                style={[
                  styles.locationModeBtn,
                  locationPickerMode === 'current' &&
                    styles.locationModeBtnActive,
                ]}
                onPress={() => {
                  setLocationPickerMode('current');
                  void resolveCurrentLocation();
                }}
              >
                <Text
                  style={[
                    styles.locationModeBtnText,
                    locationPickerMode === 'current' &&
                      styles.locationModeBtnTextActive,
                  ]}
                >
                  {pt.location_current}
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.locationModeBtn,
                  locationPickerMode === 'manual' &&
                    styles.locationModeBtnActive,
                ]}
                onPress={() => setLocationPickerMode('manual')}
              >
                <Text
                  style={[
                    styles.locationModeBtnText,
                    locationPickerMode === 'manual' &&
                      styles.locationModeBtnTextActive,
                  ]}
                >
                  {pt.location_manual}
                </Text>
              </Pressable>
            </View>

            {locationCurrentLoading ? (
              <View style={styles.modalLoadingWrap}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : null}

            {locationCurrentError ? (
              <Text style={styles.locationErrorText}>{pt.location_error}</Text>
            ) : null}

            <View style={styles.locationCoordsRow}>
              <TextInput
                value={locationLatitudeInput}
                onChangeText={setLocationLatitudeInput}
                style={styles.locationCoordinateInput}
                placeholder={pt.location_latitude}
                placeholderTextColor={colors.grey500}
                keyboardType="decimal-pad"
              />
              <TextInput
                value={locationLongitudeInput}
                onChangeText={setLocationLongitudeInput}
                style={styles.locationCoordinateInput}
                placeholder={pt.location_longitude}
                placeholderTextColor={colors.grey500}
                keyboardType="decimal-pad"
              />
            </View>

            <TextInput
              value={locationNameInput}
              onChangeText={setLocationNameInput}
              style={styles.locationInput}
              placeholder={pt.location_name_placeholder}
              placeholderTextColor={colors.grey500}
              maxLength={120}
            />

            <TextInput
              value={locationAddressInput}
              onChangeText={setLocationAddressInput}
              style={styles.locationInput}
              placeholder={pt.location_address_placeholder}
              placeholderTextColor={colors.grey500}
              maxLength={180}
            />

            <View style={styles.bottomSheetFooter}>
              <Pressable
                style={styles.secondaryBtn}
                onPress={() => setLocationPickerVisible(false)}
              >
                <Text style={styles.secondaryBtnText}>{pt.cancel}</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.primaryBtn,
                  sendingCapturedMedia && styles.sendBtnDisabled,
                ]}
                onPress={() => {
                  void handleSendLocation();
                }}
                disabled={sendingCapturedMedia}
              >
                {sendingCapturedMedia ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : (
                  <Text style={styles.primaryBtnText}>{pt.send}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={viewer.visible}
        transparent
        animationType="fade"
        onRequestClose={closeMediaViewer}
        statusBarTranslucent
      >
        <Pressable style={styles.viewerOverlay} onPress={closeMediaViewer}>
          <Pressable
            style={styles.viewerContent}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.viewerActions}>
              <Pressable
                style={[
                  styles.viewerActionBtn,
                  downloadingViewerMedia && styles.viewerActionBtnDisabled,
                ]}
                onPress={handleDownloadViewerMedia}
                disabled={downloadingViewerMedia}
              >
                {downloadingViewerMedia ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="download-outline" size={20} color="#FFFFFF" />
                )}
              </Pressable>
              <Pressable
                style={styles.viewerActionBtn}
                onPress={closeMediaViewer}
              >
                <Ionicons name="close" size={20} color="#FFFFFF" />
              </Pressable>
            </View>

            <View style={styles.viewerMediaContainer}>
              {viewer.kind === 'video' ? (
                <VideoView
                  key={viewer.src}
                  player={viewerVideoPlayer}
                  style={styles.viewerVideo}
                  contentFit="contain"
                  nativeControls
                  fullscreenOptions={VIDEO_FULLSCREEN_ENABLED}
                  allowsPictureInPicture
                  playsInline
                />
              ) : (
                <Image
                  source={{ uri: viewer.src }}
                  style={styles.viewerImage}
                  resizeMode="contain"
                />
              )}
            </View>

            {viewer.caption ? (
              <Text style={styles.viewerCaption} numberOfLines={4}>
                {viewer.caption}
              </Text>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    position: 'relative',
  },
  skeletonContainer: {
    flex: 1,
    padding: 12,
    paddingBottom: 8,
  },
  skeletonDateLine: {
    flex: 0.25,
    height: 1,
    backgroundColor: 'rgba(47, 43, 61, 0.12)',
  },
  skeletonDatePill: {
    width: 80,
    height: 20,
    borderRadius: 7.5,
    backgroundColor: colors.grey300,
  },
  skeletonBubbleWrap: {
    marginVertical: 2,
    alignItems: 'flex-start',
  },
  skeletonBubbleWrapRight: {
    alignItems: 'flex-end',
  },
  skeletonBubble: {
    maxWidth: '80%',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderBottomLeftRadius: 4,
    backgroundColor: colors.grey300,
  },
  skeletonBubbleRight: {
    backgroundColor: colors.grey300,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 4,
  },
  skeletonBubbleLine: {
    height: 12,
    borderRadius: 4,
    backgroundColor: colors.grey400,
    marginBottom: 6,
  },
  skeletonBubbleLineWide: {
    width: 180,
  },
  skeletonBubbleLineShort: {
    width: 80,
    marginBottom: 0,
  },
  listContent: {
    padding: 12,
    paddingBottom: 8,
  },
  loadingOlderWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  loadingOlderTopWrap: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20,
  },
  loadingOlderTopChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: colors.primary,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  loadingOlderTopText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.onPrimary,
  },
  dateSeparatorWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 16,
    gap: 8,
  },
  dateSeparatorLine: {
    flex: 0.25,
    height: 1,
    backgroundColor: 'rgba(47, 43, 61, 0.12)',
  },
  dateSeparatorPill: {
    backgroundColor: 'rgba(47, 43, 61, 0.12)',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 7.5,
  },
  dateSeparatorText: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(47, 43, 61, 0.65)',
  },
  bubbleWrap: {
    marginVertical: 5,
  },
  bubbleWrapLeft: {
    alignItems: 'flex-start',
  },
  bubbleWrapRight: {
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    paddingRight: 28,
    borderRadius: 8,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
  },
  bubbleLeft: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 4,
  },
  bubbleRight: {
    backgroundColor: colors.bubbleSent,
    borderBottomRightRadius: 4,
  },
  bubbleQuotedMinWidth: {
    minWidth: 192,
  },
  bubbleShortMinWidth: {
    minWidth: 128,
  },
  bubbleHighlighted: {
    borderWidth: 1,
    borderColor: 'rgba(30, 90, 180, 0.42)',
  },
  bubbleText: {
    fontSize: 15,
  },
  bubbleTextLeft: {
    color: colors.onSurface,
  },
  bubbleTextRight: {
    color: 'rgba(17, 27, 33, 0.95)',
  },
  protectedContentWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
    minHeight: 36,
  },
  protectedIconWrap: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(47, 43, 61, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  protectedContentTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  protectedContentTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  protectedContentSubtitle: {
    fontSize: 11,
    opacity: 0.72,
  },
  bubbleMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 4,
  },
  bubbleTime: {
    fontSize: 11,
  },
  bubbleTimeLeft: {
    color: colors.grey600,
  },
  bubbleTimeRight: {
    color: colors.bubbleSentTime,
  },
  bubbleWrapCenter: {
    alignItems: 'center',
  },
  bubbleSystem: {
    alignSelf: 'center',
    maxWidth: '90%',
  },
  bubbleContact: {
    minWidth: 210,
  },
  bubbleAudio: {
    minWidth: 220,
    width: '70%',
    maxWidth: '70%',
    paddingRight: 12,
    overflow: 'hidden',
  },
  bubbleDocument: {
    minWidth: 250,
    maxWidth: '78%',
    paddingRight: 12,
  },
  bubbleMetaAudio: {
    marginTop: 6,
  },
  bubbleMetaDocument: {
    marginTop: 2,
  },
  forwardedIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
    opacity: 0.72,
  },
  forwardedIcon: {
    transform: [{ scaleX: -1 }],
  },
  forwardedText: {
    fontSize: 12,
    fontStyle: 'italic',
    fontWeight: '400',
  },
  forwardedColorLeft: {
    color: colors.onSurface,
  },
  forwardedColorRight: {
    color: 'rgba(17, 27, 33, 0.7)',
  },
  quotedBlock: {
    flexDirection: 'row',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.58)',
    marginBottom: 8,
    width: '100%',
    minWidth: 152,
    alignSelf: 'stretch',
  },
  quotedBlockRight: {
    backgroundColor: 'rgba(255, 255, 255, 0.62)',
  },
  quotedBlockInteractive: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(30, 90, 180, 0.32)',
  },
  quotedBlockPressed: {
    opacity: 0.88,
  },
  quotedBar: {
    width: 3,
    backgroundColor: colors.primary,
  },
  quotedBarRight: {
    backgroundColor: 'rgba(30, 90, 180, 0.95)',
  },
  quotedBody: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minWidth: 0,
  },
  quotedBodyContact: {
    paddingBottom: 15,
  },
  quotedName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: 3,
  },
  quotedNameContact: {
    marginTop: 1,
    marginBottom: 4,
    paddingRight: 6,
  },
  quotedNameRight: {
    color: '#1E5AB4',
  },
  quotedContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  quotedContentRowContact: {
    alignItems: 'flex-start',
    paddingRight: 6,
    paddingBottom: 4,
  },
  quotedThumbWrap: {
    width: 42,
    height: 42,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: 'rgba(47, 43, 61, 0.12)',
    flexShrink: 0,
  },
  quotedThumb: {
    width: '100%',
    height: '100%',
  },
  quotedContactAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    flexShrink: 0,
  },
  quotedContactGroupIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(30, 90, 180, 0.12)',
    flexShrink: 0,
  },
  quotedVideoOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.26)',
  },
  quotedTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  quotedTextWrapContact: {
    paddingBottom: 8,
  },
  quotedText: {
    fontSize: 13,
    lineHeight: 16,
    color: colors.onSurface,
  },
  quotedTextContact: {
    lineHeight: 17,
  },
  quotedTextRight: {
    color: 'rgba(17, 27, 33, 0.92)',
  },
  quotedMeta: {
    fontSize: 10,
    color: colors.grey700,
    marginTop: 2,
  },
  reactionsSummary: {
    marginTop: -2,
    zIndex: 2,
  },
  reactionsSummaryRight: {
    alignSelf: 'flex-end',
    marginRight: 12,
  },
  reactionsSummaryLeft: {
    alignSelf: 'flex-start',
    marginLeft: 12,
  },
  reactionsSummaryContact: {
    marginTop: -8,
  },
  reactionSummaryBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 8,
    minHeight: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(47, 43, 61, 0.14)',
  },
  reactionSummaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reactionSummaryEmoji: {
    fontSize: 14,
    lineHeight: 14,
  },
  reactionSummaryCount: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(47, 43, 61, 0.72)',
  },
  bubbleAnnotation: {
    backgroundColor: '#FFF3CD',
  },
  viewOnceWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  viewOnceText: {
    fontSize: 14,
    color: colors.grey600,
    fontStyle: 'italic',
  },
  contentStack: {
    gap: 8,
    width: '100%',
  },
  mediaBubble: {
    maxWidth: 232,
    overflow: 'hidden',
    borderRadius: 8,
  },
  mediaBubbleImage: {
    maxWidth: 210,
  },
  imageThumb: {
    width: '100%',
    maxWidth: 210,
    maxHeight: 280,
    aspectRatio: 1,
    borderRadius: 6,
  },
  videoThumbWrap: {
    width: '100%',
    maxWidth: 232,
    height: 144,
    position: 'relative',
    borderRadius: 6,
    overflow: 'hidden',
  },
  videoThumb: {
    width: '100%',
    height: '100%',
    maxWidth: 232,
    borderRadius: 6,
  },
  videoThumbVideo: {
    width: '100%',
    height: '100%',
    maxWidth: 232,
    borderRadius: 6,
    backgroundColor: '#000000',
  },
  videoNoteThumbWrap: {
    width: 116,
    height: 176,
    position: 'relative',
    borderRadius: 10,
    overflow: 'hidden',
  },
  videoNoteThumb: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
  },
  videoNoteThumbVideo: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
    backgroundColor: '#000000',
  },
  videoPlaceholder: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.grey200,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoNotePlaceholder: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.grey200,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 6,
  },
  mediaCaption: {
    fontSize: 14,
    marginTop: 8,
  },
  mediaMeta: {
    fontSize: 11,
    color: colors.grey600,
    marginTop: 4,
  },
  stickerThumb: {
    width: 100,
    height: 100,
    maxWidth: 100,
    maxHeight: 100,
  },
  stickerFallback: {
    width: 100,
    height: 100,
    borderRadius: 8,
    backgroundColor: 'rgba(47, 43, 61, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  stickerFallbackText: {
    fontSize: 12,
    color: colors.grey700,
    fontWeight: '500',
  },
  locationBubble: {
    width: 200,
    maxWidth: 200,
    minWidth: 175,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  locationMapPreview: {
    width: '100%',
    height: 112,
    overflow: 'hidden',
    backgroundColor: 'rgba(47, 43, 61, 0.08)',
  },
  locationMapImage: {
    width: '100%',
    height: '100%',
  },
  locationMapFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationPinOverlay: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: [{ translateX: -18 }, { translateY: -32 }],
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  locationInfo: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 0,
  },
  locationName: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(17, 27, 33, 0.95)',
  },
  locationAddress: {
    fontSize: 12,
    color: colors.grey700,
    marginTop: 3,
  },
  linkPreviewCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(47, 43, 61, 0.12)',
    padding: 10,
    gap: 8,
  },
  linkPreviewCardLeft: {
    backgroundColor: 'rgba(47, 43, 61, 0.04)',
  },
  linkPreviewCardRight: {
    backgroundColor: 'rgba(255, 255, 255, 0.36)',
  },
  linkPreviewMain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  linkPreviewThumb: {
    width: 48,
    height: 48,
    borderRadius: 6,
    backgroundColor: 'rgba(47, 43, 61, 0.08)',
    flexShrink: 0,
  },
  linkPreviewText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  linkPreviewDomain: {
    fontSize: 11,
    color: 'rgba(47, 43, 61, 0.72)',
  },
  linkPreviewTitle: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '600',
    color: colors.onSurface,
  },
  linkPreviewDescription: {
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(47, 43, 61, 0.74)',
  },
  linkPreviewUrl: {
    fontSize: 12,
    color: colors.primary,
  },
  externalAdCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(47, 43, 61, 0.12)',
    padding: 10,
    gap: 8,
  },
  externalAdCardLeft: {
    backgroundColor: 'rgba(47, 43, 61, 0.04)',
  },
  externalAdCardRight: {
    backgroundColor: 'rgba(255, 255, 255, 0.36)',
  },
  externalAdMain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  externalAdThumb: {
    width: 60,
    height: 60,
    borderRadius: 6,
    backgroundColor: 'rgba(47, 43, 61, 0.08)',
    flexShrink: 0,
  },
  externalAdInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  externalAdSource: {
    fontSize: 11,
    color: 'rgba(47, 43, 61, 0.72)',
  },
  externalAdTitle: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '600',
    color: colors.onSurface,
  },
  externalAdDescription: {
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(47, 43, 61, 0.74)',
  },
  externalAdUrl: {
    fontSize: 12,
    color: colors.primary,
  },
  audioWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  audioPlayBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(47, 43, 61, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioInfo: {
    flex: 1,
  },
  audioDuration: {
    fontSize: 14,
    fontWeight: '500',
  },
  audioBubble: {
    maxWidth: '100%',
    width: '100%',
    gap: 6,
    alignSelf: 'stretch',
    overflow: 'hidden',
  },
  audioPlayerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: '100%',
    width: '100%',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(47, 43, 61, 0.06)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(47, 43, 61, 0.1)',
    overflow: 'hidden',
  },
  audioPlayerContainerRight: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderBottomColor: 'rgba(17, 27, 33, 0.08)',
  },
  audioSpeedBtn: {
    minWidth: 34,
    height: 22,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(47, 43, 61, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  audioSpeedBtnRight: {
    borderColor: 'rgba(17, 27, 33, 0.35)',
  },
  audioSpeedBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(47, 43, 61, 0.7)',
  },
  audioSpeedBtnTextRight: {
    color: 'rgba(17, 27, 33, 0.7)',
  },
  audioPlayBtnCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioPlayBtnCircleRight: {
    backgroundColor: '#FFFFFF',
    borderColor: 'rgba(17, 27, 33, 0.25)',
  },
  audioPlayAndTimeWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    gap: 3,
  },
  audioTimeBelowPlay: {
    fontSize: 10,
    fontWeight: '500',
  },
  audioTimeBelowPlayLeft: {
    color: 'rgba(47, 43, 61, 0.6)',
  },
  audioTimeBelowPlayRight: {
    color: 'rgba(17, 27, 33, 0.6)',
  },
  audioWaveformContainer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 100,
    minWidth: 0,
    height: 34,
    position: 'relative',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  audioWaveform: {
    position: 'absolute',
    left: WAVEFORM_HORIZONTAL_INSET,
    right: WAVEFORM_HORIZONTAL_INSET,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    gap: WAVEFORM_BAR_GAP,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  audioWaveformBar: {
    width: WAVEFORM_BAR_WIDTH,
    minHeight: 4,
    backgroundColor: 'rgba(47, 43, 61, 0.4)',
    borderRadius: 2,
  },
  audioWaveformBarRight: {
    backgroundColor: 'rgba(17, 27, 33, 0.45)',
  },
  audioWaveformBarActive: {
    backgroundColor: colors.primary,
  },
  audioWaveformBarActiveRight: {
    backgroundColor: 'rgba(17, 27, 33, 0.9)',
  },
  audioProgressIndicator: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: colors.primary,
    marginLeft: -1,
    borderRadius: 1,
  },
  audioProgressIndicatorRight: {
    backgroundColor: 'rgba(17, 27, 33, 0.85)',
  },
  audioCaption: {
    marginTop: 8,
  },
  documentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(47, 43, 61, 0.04)',
    marginBottom: 6,
    width: '100%',
    minWidth: 220,
  },
  documentCardRight: {
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
  },
  documentMainAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  documentIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    backgroundColor: 'rgba(40, 101, 183, 0.12)',
  },
  documentIconCircleRight: {
    backgroundColor: 'rgba(40, 101, 183, 0.18)',
  },
  documentTypeText: {
    fontSize: 8,
    lineHeight: 10,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 0.4,
  },
  documentInfo: {
    flex: 1,
    minWidth: 0,
  },
  documentName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  documentMeta: {
    fontSize: 11,
    color: colors.grey600,
    marginTop: 2,
  },
  documentDownloadBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(40, 101, 183, 0.1)',
  },
  documentDownloadBtnRight: {
    backgroundColor: 'rgba(40, 101, 183, 0.2)',
  },
  documentCaption: {
    marginTop: 2,
  },
  contactWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    minWidth: 210,
  },
  contactWrapRight: {
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
  },
  contactAvatarWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(40, 101, 183, 0.14)',
    overflow: 'hidden',
    flexShrink: 0,
  },
  contactAvatarWrapRight: {
    backgroundColor: 'rgba(40, 101, 183, 0.2)',
  },
  contactAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 21,
  },
  contactInfo: {
    flex: 1,
    minWidth: 0,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '600',
    color: 'rgba(17, 27, 33, 0.95)',
  },
  contactPhone: {
    fontSize: 14,
    color: colors.grey700,
    marginTop: 2,
  },
  systemWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  systemText: {
    fontSize: 14,
    color: colors.grey700,
  },
  templateWrap: {
    gap: 6,
  },
  templateTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  templateContent: {
    fontSize: 14,
    lineHeight: 20,
  },
  templateButtons: {
    marginTop: 2,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(47, 43, 61, 0.14)',
    gap: 6,
  },
  templateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(37, 211, 102, 0.1)',
  },
  templateButtonRight: {
    backgroundColor: 'rgba(40, 101, 183, 0.12)',
  },
  templateButtonDisabled: {
    opacity: 0.45,
  },
  templateButtonText: {
    flex: 1,
    fontSize: 13,
    color: '#25D366',
    fontWeight: '500',
  },
  templateButtonTextRight: {
    color: colors.primary,
  },
  viewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 42 : 24,
  },
  viewerContent: {
    flex: 1,
    justifyContent: 'center',
  },
  viewerActions: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 2,
    flexDirection: 'row',
    gap: 10,
  },
  viewerActionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerActionBtnDisabled: {
    opacity: 0.7,
  },
  viewerMediaContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerImage: {
    width: '100%',
    height: '100%',
  },
  viewerVideo: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
  },
  viewerCaption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  typingIndicatorWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 2,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.grey200,
  },
  typingIndicatorText: {
    flex: 1,
    color: colors.primary,
    fontSize: 12,
    fontStyle: 'italic',
    fontWeight: '400',
  },
  protectedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: 'rgba(47, 43, 61, 0.06)',
    borderTopWidth: 1,
    borderTopColor: colors.grey200,
  },
  protectedBannerText: {
    fontSize: 12,
    color: colors.grey700,
    fontWeight: '500',
  },
  attendReopenBanner: {
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.grey200,
  },
  attendReopenBannerText: {
    fontSize: 12,
    color: colors.grey700,
    fontWeight: '500',
  },
  attendReopenBannerAction: {
    height: 34,
    alignSelf: 'flex-start',
    borderRadius: 17,
    paddingHorizontal: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attendReopenBannerActionDisabled: {
    backgroundColor: colors.grey400,
  },
  attendReopenBannerActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.onPrimary,
  },
  attendReopenBlockedReason: {
    fontSize: 12,
    color: colors.error,
    fontWeight: '500',
  },
  scrollToBottomButton: {
    position: 'absolute',
    right: 16,
    bottom: Platform.OS === 'ios' ? 88 : 74,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    zIndex: 25,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  scrollToBottomButtonWithTyping: {
    bottom: Platform.OS === 'ios' ? 112 : 98,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.grey200,
    gap: 8,
  },
  inputRowWithTyping: {
    borderTopWidth: 0,
    paddingTop: 6,
  },
  inputRowRecording: {
    alignItems: 'center',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    backgroundColor: colors.inputBg,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingRight: 46,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.onSurface,
  },
  inputStack: {
    flex: 1,
    position: 'relative',
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
    fontSize: 14,
    fontWeight: '600',
    color: colors.onSurface,
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
    fontSize: 13,
    fontWeight: '600',
    color: colors.grey600,
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
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#EF4444',
  },
  recordingDotPaused: {
    opacity: 0.45,
    backgroundColor: colors.grey500,
  },
  recordingTimeText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.onSurface,
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
    fontSize: 11,
    color: colors.primary,
    fontWeight: '500',
  },
  composerActionsWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  composerActionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  plusActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignSelf: 'center',
    backgroundColor: colors.grey200,
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
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
  chatHeader: {
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey200,
  },
  chatHeaderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chatHeaderBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatHeaderContactWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  chatHeaderAvatarWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.grey200,
    overflow: 'hidden',
  },
  chatHeaderAvatar: {
    width: '100%',
    height: '100%',
  },
  chatHeaderContactInfo: {
    flex: 1,
    minWidth: 0,
  },
  chatHeaderName: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.onSurface,
  },
  chatHeaderPhoneRow: {
    marginTop: 2,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chatHeaderPhone: {
    flexShrink: 1,
    maxWidth: 220,
    fontSize: 12,
    color: colors.grey700,
  },
  chatHeaderMenuBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatHeaderMetaRow: {
    marginTop: 10,
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  chatHeaderProtocolChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(40, 101, 183, 0.25)',
    backgroundColor: 'rgba(40, 101, 183, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: '100%',
  },
  chatHeaderProtocolText: {
    maxWidth: 220,
    fontSize: 12,
    color: colors.primary,
    fontWeight: '500',
  },
  chatHeaderCounterChip: {
    borderRadius: 999,
    backgroundColor: colors.primary,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatHeaderCounterChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  chatHeaderLabelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: '100%',
    backgroundColor: '#FFFFFF',
  },
  chatHeaderLabelText: {
    maxWidth: 180,
    fontSize: 12,
    fontWeight: '600',
  },
  chatHeaderReadonlyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(47, 43, 61, 0.08)',
  },
  chatHeaderReadonlyText: {
    fontSize: 12,
    color: colors.grey700,
    fontWeight: '500',
  },
  chatBody: {
    flex: 1,
  },
  readonlyFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 11,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.grey200,
  },
  readonlyFooterText: {
    fontSize: 13,
    color: colors.grey700,
    fontWeight: '500',
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.15)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: Platform.OS === 'ios' ? 64 : 50,
    paddingRight: 12,
  },
  menuCard: {
    minWidth: 220,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  menuItem: {
    minHeight: 42,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  menuItemText: {
    flex: 1,
    fontSize: 14,
    color: colors.onSurface,
  },
  menuItemTextDanger: {
    color: colors.error,
  },
  bottomSheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  bottomSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  bottomSheetCard: {
    maxHeight: '82%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 14,
    gap: 12,
  },
  searchSheetCard: {
    maxHeight: '88%',
  },
  transferSheetCard: {
    maxHeight: '88%',
  },
  annotationSheetCard: {
    maxHeight: '62%',
  },
  locationSheetCard: {
    maxHeight: '72%',
  },
  bottomSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 2,
  },
  bottomSheetTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.onSurface,
  },
  bottomSheetList: {
    paddingBottom: 12,
  },
  bottomSheetFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.grey200,
  },
  secondaryBtn: {
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.grey300,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.onSurface,
  },
  primaryBtn: {
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.onPrimary,
  },
  modalLoadingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  modalHintText: {
    fontSize: 12,
    color: colors.grey700,
    marginTop: -4,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 13,
    color: colors.grey600,
    paddingVertical: 18,
  },
  protocolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 42,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.grey200,
  },
  protocolTypeBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  protocolTypeBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  protocolRowText: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    color: colors.onSurface,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 42,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.grey200,
  },
  labelColorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  labelRowText: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    color: colors.onSurface,
  },
  searchInputWrap: {
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.inputBg,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.onSurface,
    paddingVertical: 0,
  },
  searchResultRow: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 8,
    backgroundColor: 'rgba(40, 101, 183, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(40, 101, 183, 0.1)',
  },
  searchResultDate: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '600',
  },
  searchResultText: {
    marginTop: 4,
    fontSize: 13,
    color: colors.onSurface,
    lineHeight: 18,
  },
  historyRow: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 8,
    backgroundColor: 'rgba(47, 43, 61, 0.04)',
  },
  historyRowTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.onSurface,
  },
  historyRowSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: colors.grey700,
  },
  historySkeletonWrap: {
    gap: 8,
    paddingBottom: 8,
  },
  historySkeletonRow: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: 'rgba(47, 43, 61, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(47, 43, 61, 0.08)',
  },
  historySkeletonTitle: {
    width: '45%',
    height: 16,
    borderRadius: 5,
    backgroundColor: colors.grey300,
  },
  historySkeletonLine: {
    marginTop: 8,
    width: '70%',
    height: 13,
    borderRadius: 5,
    backgroundColor: colors.grey300,
  },
  historySkeletonLineShort: {
    width: '52%',
  },
  transferFormScroll: {
    flexShrink: 1,
    minHeight: 0,
  },
  transferFormContent: {
    gap: 12,
    paddingBottom: 4,
  },
  formField: {
    gap: 6,
  },
  formFieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.grey700,
  },
  formSelector: {
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.grey300,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  formSelectorText: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    color: colors.onSurface,
  },
  transferAnnotationInput: {
    minHeight: 86,
    maxHeight: 130,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.grey300,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.onSurface,
    textAlignVertical: 'top',
  },
  annotationInput: {
    minHeight: 140,
    maxHeight: 260,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.grey300,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.onSurface,
    textAlignVertical: 'top',
  },
  contactPickerRow: {
    minHeight: 54,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(40, 101, 183, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(40, 101, 183, 0.12)',
  },
  contactPickerAvatar: {
    borderRadius: 17,
    overflow: 'hidden',
  },
  contactPickerRowInfo: {
    flex: 1,
    minWidth: 0,
  },
  contactPickerRowName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.onSurface,
  },
  contactPickerRowPhone: {
    marginTop: 2,
    fontSize: 12,
    color: colors.grey700,
  },
  locationModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  locationModeBtn: {
    flex: 1,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: colors.grey300,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  locationModeBtnActive: {
    backgroundColor: 'rgba(40, 101, 183, 0.12)',
    borderColor: 'rgba(40, 101, 183, 0.3)',
  },
  locationModeBtnText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.grey700,
  },
  locationModeBtnTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  locationErrorText: {
    fontSize: 12,
    color: colors.error,
  },
  locationCoordsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  locationCoordinateInput: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.grey300,
    backgroundColor: colors.inputBg,
    fontSize: 14,
    color: colors.onSurface,
    paddingHorizontal: 12,
  },
  locationInput: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.grey300,
    backgroundColor: colors.inputBg,
    fontSize: 14,
    color: colors.onSurface,
    paddingHorizontal: 12,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  pickerCard: {
    width: '88%',
    maxHeight: '62%',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    paddingVertical: 6,
  },
  pickerRow: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.grey200,
  },
  pickerRowText: {
    fontSize: 14,
    color: colors.onSurface,
  },
  cameraPickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  cameraPickerSheet: {
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
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
    fontSize: 14,
    fontWeight: '500',
    color: colors.onSurface,
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
  cameraPickerActionText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.onSurface,
  },
  cameraPickerCancel: {
    justifyContent: 'center',
    backgroundColor: 'rgba(47, 43, 61, 0.08)',
  },
  cameraPickerCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.onSurface,
  },
});
