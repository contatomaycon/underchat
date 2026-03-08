import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ComponentType,
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
  Keyboard,
  Switch,
  NativeEventEmitter,
  NativeModules,
  type StyleProp,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  PanGestureHandler,
  State,
  Swipeable,
} from 'react-native-gesture-handler';
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
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Location from 'expo-location';
import * as Clipboard from 'expo-clipboard';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Image as ExpoImage } from 'expo-image';
import Constants from 'expo-constants';
import { requireOptionalNativeModule } from 'expo-modules-core';
import VideoTrimModule, {
  showEditor,
  isValidFile,
  type Spec as VideoTrimSpec,
} from 'react-native-video-trim';
import {
  listMessages,
  createMessage,
  createMessageWithFormData,
  clearChatSummary,
  generateLinkPreview,
  updateChatStatusDetailed,
  transferChat,
  joinChat,
  leaveChat,
  viewChatAttendants,
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
  listQuickMessageTemplates,
  type LabelTemplate,
  type ChatUserStatus,
  type WorkerConfigForChat,
  type TransferChatPayload,
  type TransferUserOption,
  type TransferSectorOption,
  type ViewChatAttendantsResponse,
  type QuickMessageTemplate,
  listChatContacts,
  type ListChatContactResult,
  getChatContactById,
  getChatContactPhoneDecrypted,
  getChatContactByPhone,
  reactToMessage,
  editMessage,
  deleteMessage,
  forwardMessage,
  type MessageForwardPayload,
  type ChatContactLookupResult,
  generateAiReply,
  transcribeAudioMessage,
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
  canDisableSendMessageOnFinishAttendance,
  canToggleForwardToOutputChatbot,
  isChatParticipant,
  isChatPrimary,
  isChatSecondary,
  isMasterOrAdministratorUser,
  canManageInChatLifecyclePermission,
  canViewChatAttendantsInfoPermission,
} from '../constants/chatAuthorization';
import { useChatFilter } from '../context/ChatFilterContext';
import { AppAvatar } from '../components/AppAvatar';
import {
  ContactFormModal,
  type ContactFormInitialValues,
} from '../components/ContactFormModal';
import { LottieSticker } from '../components/LottieSticker';
import {
  SelectField,
  SelectSheet,
  type SelectOption,
} from '../components/select';
import { BottomSheetModal } from '../components/BottomSheetModal';
import { pt } from '../locales/pt';
import { colors } from '../theme/colors';
import { resolveImageUri } from '../utils/imageUri';
import { extractFirstUrl } from '../utils/extractFirstUrl';
import {
  parseWhatsAppTextTokens,
  type WhatsAppTextToken,
} from '../utils/whatsAppTextFormat';
import {
  dismissKeyboard,
  dismissKeyboardAnd,
  getKeyboardVerticalOffset,
  keyboardAvoidingBehavior,
} from '../utils/keyboard';
import { addAppResumeListener } from '../utils/appResumeBus';
import { syncGlobalChatCounts } from '../utils/chatCountsSync';

type EmojiDatasetEntry = {
  unified?: string;
  obsoleted_by?: string;
  category?: string;
  short_name?: string;
  short_names?: string[];
  sort_order?: number;
};

const EMOJI_DATASET =
  require('emoji-datasource/emoji.json') as EmojiDatasetEntry[];

const INLINE_URL_PATTERN = /((?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?])/gi;

type TextChunk = {
  text: string;
  url: string | null;
};

function normalizeInlineUrl(url: string): string {
  return url.startsWith('www.') ? `https://${url}` : url;
}

function splitTextChunksWithLinks(text: string): TextChunk[] {
  if (!text) return [];

  const chunks: TextChunk[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(INLINE_URL_PATTERN)) {
    const urlText = match[0];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      chunks.push({ text: text.slice(lastIndex, index), url: null });
    }

    chunks.push({ text: urlText, url: normalizeInlineUrl(urlText) });
    lastIndex = index + urlText.length;
  }

  if (lastIndex < text.length) {
    chunks.push({ text: text.slice(lastIndex), url: null });
  }

  return chunks.length > 0 ? chunks : [{ text, url: null }];
}

async function openExternalTextUrl(url: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {}
}

function hasMeaningfulLinkPreview(
  preview: MessageContentLinkPreview | null | undefined
): preview is MessageContentLinkPreview {
  if (!preview) return false;

  return Boolean(
    readNonEmptyString(preview.title) ||
    readNonEmptyString(preview.description) ||
    readNonEmptyString(preview['canonical-url']) ||
    readNonEmptyString(preview['matched-text']) ||
    readNonEmptyString(preview.jpegThumbnail) ||
    readNonEmptyString(preview.highQualityThumbnail) ||
    readNonEmptyString(preview.originalThumbnailUrl)
  );
}

type WhatsAppFormattedTextProps = {
  text: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  ellipsizeMode?: 'head' | 'middle' | 'tail' | 'clip';
  selectable?: boolean;
  onTextLayout?: (event: NativeSyntheticEvent<{ lines?: unknown[] }>) => void;
  onLinkLongPress?: (url: string) => void;
};

function renderWhatsAppTextToken(
  token: WhatsAppTextToken,
  tokenIndex: number,
  onLinkLongPress?: (url: string) => void
): ReactElement | string | Array<ReactElement | null> {
  if (token.type === 'newline') {
    return '\n';
  }

  const tokenStyle =
    token.type === 'bold'
      ? styles.whatsAppBold
      : token.type === 'italic'
        ? styles.whatsAppItalic
        : token.type === 'strike'
          ? styles.whatsAppStrike
          : token.type === 'code'
            ? styles.whatsAppCode
            : null;

  const chunks = splitTextChunksWithLinks(token.text);
  return chunks.map((chunk, chunkIndex) => {
    if (!chunk.text) return null;

    if (chunk.url) {
      const url = chunk.url;
      return (
        <Text
          key={`whatsapp-token-${tokenIndex}-${chunkIndex}`}
          style={[tokenStyle, styles.whatsAppLink]}
          onPress={() => {
            void openExternalTextUrl(url);
          }}
          onLongPress={() => {
            onLinkLongPress?.(url);
          }}
          suppressHighlighting
        >
          {chunk.text}
        </Text>
      );
    }

    return (
      <Text
        key={`whatsapp-token-${tokenIndex}-${chunkIndex}`}
        style={tokenStyle}
      >
        {chunk.text}
      </Text>
    );
  });
}

function WhatsAppFormattedText({
  text,
  style,
  numberOfLines,
  ellipsizeMode,
  selectable,
  onTextLayout,
  onLinkLongPress,
}: WhatsAppFormattedTextProps) {
  const tokens = useMemo(() => parseWhatsAppTextTokens(text), [text]);

  return (
    <Text
      style={style}
      numberOfLines={numberOfLines}
      ellipsizeMode={ellipsizeMode}
      selectable={selectable}
      onTextLayout={onTextLayout}
    >
      {tokens.map((token, tokenIndex) =>
        renderWhatsAppTextToken(token, tokenIndex, onLinkLongPress)
      )}
    </Text>
  );
}

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

function isDirectoryPickerCancellationError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'string') {
    return /cancel|canceled|cancelled|dismissed|abort/i.test(error);
  }

  if (typeof error !== 'object') return false;

  const parsed = error as {
    code?: unknown;
    name?: unknown;
    message?: unknown;
  };

  const values = [parsed.code, parsed.name, parsed.message];
  return values.some(
    (value) =>
      typeof value === 'string' &&
      /cancel|canceled|cancelled|dismissed|abort/i.test(value)
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

function normalizeLocalFileUri(uri: string): string {
  if (!uri) return uri;
  if (/^[a-z][a-z0-9+\-.]*:/i.test(uri)) {
    return uri;
  }
  if (uri.startsWith('/')) {
    return `file://${uri}`;
  }
  return uri;
}

function resolveFileNameFromUri(uri: string, fallback: string): string {
  if (!uri) return fallback;
  const normalizedUri = uri.split('?')[0]?.split('#')[0] ?? uri;
  const fromPath = normalizedUri.split('/').pop()?.trim();
  if (!fromPath) return fallback;
  const decoded = decodeURIComponent(fromPath);
  if (decoded.length === 0) return fallback;
  return decoded;
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
const MAX_VIDEO_TRIM_DURATION_SECONDS = 120;
const VIDEO_EDITOR_OPENING_MIN_VISIBLE_MS = 250;
const ATTACHMENT_PICKER_TRANSITION_DELAY_MS = 350;
const IMAGE_ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif']);
const VIDEO_ALLOWED_EXTENSIONS = new Set([
  'mp4',
  'avi',
  'flv',
  'mkv',
  'mov',
  '3gp',
]);
const VIDEO_TRIM_EVENT_NAME = 'VideoTrim';
const MAX_CONTACTS_SELECTED = 10;
const MESSAGE_SWIPE_REPLY_ACTION_WIDTH = 84;
const MESSAGE_SWIPE_REPLY_THRESHOLD = 44;
const MESSAGE_SWIPE_FRICTION = 1.8;
const MESSAGE_SWIPE_DRAG_OFFSET = 18;
const VIEWER_SWIPE_CLOSE_DISTANCE = 120;
const VIEWER_SWIPE_CLOSE_VELOCITY = 1.05;
const VIEWER_SWIPE_ACTIVATION_DISTANCE = 10;
const EMOJI_PICKER_DISMISS_DY_THRESHOLD = 24;
const EMOJI_PICKER_DISMISS_VY_THRESHOLD = 0.55;
type DownloadKind = 'image' | 'video' | 'document';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ChatRoomMode = 'default' | 'history_readonly';

type ProtocolType = 'A' | 'T' | 'U';

type ProtocolWithType = {
  protocol: string;
  type: ProtocolType;
};

type ChatMenuActionKey =
  | 'attendants_info'
  | 'protocol'
  | 'label'
  | 'attendance_history'
  | 'transfer'
  | 'leave_conversation'
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

type MessageActionKey =
  | 'reply'
  | 'copy'
  | 'download'
  | 'forward'
  | 'retry'
  | 'react'
  | 'edit'
  | 'view_edits'
  | 'delete'
  | 'transcribe'
  | 'ai_reply';

type MessageAction = {
  key: MessageActionKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  danger?: boolean;
  onPress: () => void;
};

type MessageOverlayAnchor = {
  showReactions: boolean;
};

type MessageEditHistoryItem = {
  text: string;
  date: string;
  isOriginal: boolean;
};

type ForwardStatusType = 'in_chat' | 'queue' | 'all' | null;

type ForwardTargetItem = {
  value: string;
  title: string;
};

type ForwardPickerKind = 'channel' | null;

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

type LocationSearchResult = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
};

type LocationMapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

type LocationMapStatus = 'idle' | 'loading' | 'ready' | 'failed';

type MapPressCoordinateEvent = {
  geometry?: {
    coordinates?: number[];
  };
  nativeEvent?: {
    coordinate?: {
      latitude?: number;
      longitude?: number;
    };
  };
};

type MapLibreModule = {
  MapView?: ComponentType<Record<string, unknown>>;
  Camera?: ComponentType<Record<string, unknown>>;
  PointAnnotation?: ComponentType<Record<string, unknown>>;
};

let mapLibreLoadError: string | null = null;

const mapLibreModule = (() => {
  try {
    return require('@maplibre/maplibre-react-native') as MapLibreModule;
  } catch (error) {
    mapLibreLoadError = error instanceof Error ? error.message : String(error);
    return null;
  }
})();

const NativeMapView = mapLibreModule?.MapView ?? null;
const NativeMapCamera = mapLibreModule?.Camera ?? null;
const NativeMapPointAnnotation = mapLibreModule?.PointAnnotation ?? null;

const isExpoGoStoreClient =
  (Constants as { executionEnvironment?: string | null })
    .executionEnvironment === 'storeClient';

const MAPLIBRE_DEFAULT_STYLE_URL =
  'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';

const mapLibreStyleUrl = (() => {
  const expoConfig = (
    Constants as {
      expoConfig?: {
        extra?: {
          mapLibreStyleUrl?: unknown;
        };
      };
    }
  ).expoConfig;
  const styleUrl = expoConfig?.extra?.mapLibreStyleUrl;
  if (typeof styleUrl === 'string' && styleUrl.trim().length > 0) {
    return styleUrl.trim();
  }
  return MAPLIBRE_DEFAULT_STYLE_URL;
})();

function readMapLoadErrorMessage(error: unknown): string | null {
  if (typeof error === 'string') {
    const normalized = error.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (!error || typeof error !== 'object') return null;

  const eventRecord = error as {
    message?: unknown;
    error?: unknown;
    nativeEvent?: {
      message?: unknown;
      error?: unknown;
      payload?: {
        message?: unknown;
      };
    };
  };

  const candidates: unknown[] = [
    eventRecord.nativeEvent?.message,
    eventRecord.nativeEvent?.error,
    eventRecord.nativeEvent?.payload?.message,
    eventRecord.message,
    eventRecord.error,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.trim();
    if (normalized.length > 0) return normalized;
  }

  return null;
}

const mapDebugSupportInfo = [
  `platform=${Platform.OS}`,
  `exec=${
    (Constants as { executionEnvironment?: string | null })
      .executionEnvironment ?? 'null'
  }`,
  `appOwnership=${
    (Constants as { appOwnership?: string | null }).appOwnership ?? 'null'
  }`,
  `provider=maplibre`,
  `nativeMapView=${NativeMapView ? 'yes' : 'no'}`,
  `nativeCamera=${NativeMapCamera ? 'yes' : 'no'}`,
  `nativePointAnnotation=${NativeMapPointAnnotation ? 'yes' : 'no'}`,
  `styleUrl=${mapLibreStyleUrl}`,
  `expoGoStoreClient=${isExpoGoStoreClient ? 'yes' : 'no'}`,
  `loadError=${mapLibreLoadError ?? 'none'}`,
].join(' | ');

const hasNativeMapSupport =
  NativeMapView != null && Platform.OS !== 'web' && !isExpoGoStoreClient;

const blurModuleExpoBlur = requireOptionalNativeModule('ExpoBlur');
const blurModuleExpoBlurView = requireOptionalNativeModule('ExpoBlurView');
const hasNativeBlurSupport =
  Platform.OS !== 'web' &&
  (blurModuleExpoBlur != null ||
    blurModuleExpoBlurView != null ||
    !isExpoGoStoreClient);

const LOCATION_MAP_DEFAULT_REGION: LocationMapRegion = {
  latitude: -14.235004,
  longitude: -51.92528,
  latitudeDelta: 28,
  longitudeDelta: 28,
};

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

function parseCoordinateInput(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
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

function formatAttendantEnteredAt(
  enteredAt: string | null | undefined
): string {
  if (!enteredAt) return '-';

  const date = new Date(enteredAt);
  if (Number.isNaN(date.getTime())) return '-';

  return date.toLocaleString('pt-BR');
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

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const REACTION_RECENT_STORAGE_KEY = 'chat_reaction_recent_emojis_v1';
const REACTION_FALLBACK_EMOJIS = [
  '😀',
  '😂',
  '😍',
  '👍',
  '🙏',
  '🎉',
  '🔥',
  '❤️',
] as const;
const REACTION_CATEGORY_DEFINITIONS = [
  {
    key: 'recent',
    icon: 'time-outline',
    sourceCategories: [] as string[],
  },
  {
    key: 'smileys',
    icon: 'happy-outline',
    sourceCategories: ['Smileys & Emotion', 'People & Body'],
  },
  {
    key: 'animals',
    icon: 'paw-outline',
    sourceCategories: ['Animals & Nature'],
  },
  {
    key: 'foods',
    icon: 'pizza-outline',
    sourceCategories: ['Food & Drink'],
  },
  {
    key: 'activities',
    icon: 'football-outline',
    sourceCategories: ['Activities', 'Activity'],
  },
  {
    key: 'travel',
    icon: 'car-outline',
    sourceCategories: ['Travel & Places'],
  },
  {
    key: 'objects',
    icon: 'bulb-outline',
    sourceCategories: ['Objects'],
  },
  {
    key: 'symbols',
    icon: 'at-outline',
    sourceCategories: ['Symbols'],
  },
  {
    key: 'flags',
    icon: 'flag-outline',
    sourceCategories: ['Flags'],
  },
] as const;
type ReactionCategoryKey =
  (typeof REACTION_CATEGORY_DEFINITIONS)[number]['key'];
type ReactionCategoryConfig = {
  key: ReactionCategoryKey;
  icon: keyof typeof Ionicons.glyphMap;
  sourceCategories: readonly string[];
};
const LONG_TEXT_COLLAPSE_LINES = 8;
const LONG_TEXT_COLLAPSE_CHAR_THRESHOLD = 420;
const FALLBACK_GALLERY_WINDOW_MS = 5000;
const MAX_IMAGE_GALLERY_THUMBNAILS = 4;

function unifiedToEmoji(unified: string): string | null {
  if (!unified) return null;
  const codepoints = unified
    .split('-')
    .map((hex) => Number.parseInt(hex, 16))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (codepoints.length === 0) return null;
  return String.fromCodePoint(...codepoints);
}

function normalizeEmojiDatasetEntry(entry: EmojiDatasetEntry): string | null {
  const unified = entry.obsoleted_by || entry.unified;
  if (!unified) return null;
  return unifiedToEmoji(unified);
}

function matchesEmojiSearch(entry: EmojiDatasetEntry, query: string): boolean {
  if (!query) return true;
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const shortName = (entry.short_name ?? '').toLowerCase();
  if (shortName.includes(normalized)) return true;
  return (entry.short_names ?? []).some((name) =>
    name.toLowerCase().includes(normalized)
  );
}

const FORWARD_ALLOWED_TYPES = new Set<string>([
  EMessageType.text,
  EMessageType.image,
  EMessageType.document,
  EMessageType.audio,
  EMessageType.video,
  EMessageType.video_note,
  EMessageType.sticker,
  EMessageType.location,
  EMessageType.contact_card,
  EMessageType.contacts,
]);

type GalleryImageItem = {
  message: ListMessageResult;
  src: string;
  caption: string;
  downloadName: string;
  width: number | null;
  height: number | null;
};

type GalleryImageGroup = {
  id: string;
  items: GalleryImageItem[];
};

type GalleryMembership = {
  groupId: string;
  index: number;
  isHead: boolean;
};

type ImageGalleryLookup = {
  groupsById: Record<string, GalleryImageGroup>;
  membershipByMessageId: Record<string, GalleryMembership>;
};

type WorkingGalleryGroup = {
  mode: 'metadata' | 'fallback';
  albumId: string | null;
  direction: 'incoming' | 'outgoing';
  lastTimestamp: number | null;
  items: GalleryImageItem[];
};

function isGalleryImageMessage(message: ListMessageResult): boolean {
  return (
    message.content?.type === EMessageType.image &&
    typeof message.content?.image?.url === 'string' &&
    message.content.image.url.trim().length > 0
  );
}

function getGalleryDirection(
  message: ListMessageResult
): 'incoming' | 'outgoing' {
  return message.type_user === ETypeUserChat.client ? 'incoming' : 'outgoing';
}

function getGalleryAlbumId(message: ListMessageResult): string | null {
  const albumId = message.content?.album?.id;
  if (typeof albumId !== 'string') return null;
  const trimmed = albumId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getMessageTimestampMs(message: ListMessageResult): number | null {
  const timestamp = new Date(message.date).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getAlbumItemIndex(message: ListMessageResult): number | null {
  const value = message.content?.album?.item_index;
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  return value;
}

function toGalleryImageItem(
  message: ListMessageResult
): GalleryImageItem | null {
  const image = message.content?.image;
  const imageSrc = resolveMediaUri(image?.url);
  if (!imageSrc) return null;

  return {
    message,
    src: imageSrc,
    caption: image?.caption ?? '',
    downloadName: resolveImageDownloadName(message, imageSrc),
    width: image?.width ?? null,
    height: image?.height ?? null,
  };
}

function flushWorkingGalleryGroup(
  state: WorkingGalleryGroup | null,
  groupsById: Record<string, GalleryImageGroup>,
  membershipByMessageId: Record<string, GalleryMembership>
): void {
  if (!state || state.items.length < 2) {
    return;
  }

  const sortedItems =
    state.mode === 'metadata'
      ? state.items
          .map((item, index) => ({ item, index }))
          .sort((a, b) => {
            const aIndex = getAlbumItemIndex(a.item.message);
            const bIndex = getAlbumItemIndex(b.item.message);

            if (aIndex !== null && bIndex !== null && aIndex !== bIndex) {
              return aIndex - bIndex;
            }

            if (aIndex !== null && bIndex === null) return -1;
            if (aIndex === null && bIndex !== null) return 1;

            return a.index - b.index;
          })
          .map(({ item }) => item)
      : state.items;

  const firstMessageId = sortedItems[0]?.message.message_id;
  if (!firstMessageId) {
    return;
  }

  const groupId = `${state.mode}:${state.albumId ?? 'fallback'}:${firstMessageId}`;
  groupsById[groupId] = {
    id: groupId,
    items: sortedItems,
  };

  sortedItems.forEach((item, index) => {
    membershipByMessageId[item.message.message_id] = {
      groupId,
      index,
      isHead: index === 0,
    };
  });
}

function buildImageGalleryLookup(
  messages: ListMessageResult[]
): ImageGalleryLookup {
  const groupsById: Record<string, GalleryImageGroup> = {};
  const membershipByMessageId: Record<string, GalleryMembership> = {};

  let currentGroup: WorkingGalleryGroup | null = null;

  const flushCurrentGroup = () => {
    flushWorkingGalleryGroup(currentGroup, groupsById, membershipByMessageId);
    currentGroup = null;
  };

  for (const message of messages) {
    if (!isGalleryImageMessage(message)) {
      flushCurrentGroup();
      continue;
    }

    const galleryItem = toGalleryImageItem(message);
    if (!galleryItem) {
      flushCurrentGroup();
      continue;
    }

    const albumId = getGalleryAlbumId(message);
    const mode: WorkingGalleryGroup['mode'] = albumId ? 'metadata' : 'fallback';
    const direction = getGalleryDirection(message);
    const timestamp = getMessageTimestampMs(message);

    const shouldJoinGroup = (() => {
      if (!currentGroup) return false;
      if (currentGroup.mode !== mode) return false;
      if (currentGroup.direction !== direction) return false;

      if (mode === 'metadata') {
        return (
          currentGroup.albumId !== null && currentGroup.albumId === albumId
        );
      }

      if (currentGroup.albumId !== null || albumId !== null) {
        return false;
      }

      if (currentGroup.lastTimestamp === null || timestamp === null) {
        return false;
      }

      return (
        timestamp - currentGroup.lastTimestamp <= FALLBACK_GALLERY_WINDOW_MS
      );
    })();

    const activeGroup = currentGroup;

    if (!shouldJoinGroup || !activeGroup) {
      flushCurrentGroup();
      currentGroup = {
        mode,
        albumId,
        direction,
        lastTimestamp: timestamp,
        items: [galleryItem],
      };
      continue;
    }

    activeGroup.items.push(galleryItem);
    activeGroup.lastTimestamp = timestamp;
  }

  flushCurrentGroup();

  return {
    groupsById,
    membershipByMessageId,
  };
}

function isDeletedMessage(message: ListMessageResult): boolean {
  return message.deleted === true;
}

function canInteractWithMessage(message: ListMessageResult): boolean {
  if (isDeletedMessage(message)) return false;
  if (message.summary?.is_sent_to_internal === false) return false;
  if (message.content?.type === EMessageType.view_once) return false;
  if (message.content?.type === EMessageType.annotation) return false;
  if (message.content?.type === EMessageType.system) return false;
  return true;
}

function isRetryableFailedVideoMessage(message: ListMessageResult): boolean {
  if (isDeletedMessage(message)) return false;
  if (message.type_user === ETypeUserChat.client) return false;
  if (message.summary?.is_sent_to_internal !== false) return false;
  if (message.content?.type !== EMessageType.video) return false;
  if (!readNonEmptyString(message.hash)) return false;
  return !!readNonEmptyString(message.content?.video?.url);
}

function isTextMessage(message: ListMessageResult): boolean {
  return message.content?.type === EMessageType.text;
}

function isDownloadableImage(message: ListMessageResult): boolean {
  return !!message.content?.image?.url;
}

function isDownloadableDocument(message: ListMessageResult): boolean {
  return !!message.content?.document?.url;
}

function isDownloadableVideo(message: ListMessageResult): boolean {
  if (!message.content?.video?.url) return false;
  if (message.message_key?.is_view_once) return false;
  return (
    message.content?.type === EMessageType.video ||
    message.content?.type === EMessageType.video_note
  );
}

function isDownloadableAudio(message: ListMessageResult): boolean {
  if (!message.content?.audio?.url) return false;
  if (message.message_key?.is_view_once) return false;
  return message.content?.type === EMessageType.audio;
}

function isDownloadableSticker(message: ListMessageResult): boolean {
  return (
    message.content?.type === EMessageType.sticker &&
    !!message.content?.sticker?.url
  );
}

function shouldShowCopyAction(message: ListMessageResult): boolean {
  if (message.content?.type === EMessageType.contact_card) return false;
  if (isDownloadableDocument(message)) return false;
  if (isDownloadableImage(message)) return false;
  if (isDownloadableVideo(message)) return false;
  if (isDownloadableAudio(message)) return false;
  if (isDownloadableSticker(message)) return false;
  return (
    isTextMessage(message) || message.content?.type === EMessageType.system
  );
}

function shouldShowDownloadAction(message: ListMessageResult): boolean {
  return (
    isDownloadableDocument(message) ||
    isDownloadableImage(message) ||
    isDownloadableVideo(message) ||
    isDownloadableAudio(message) ||
    isDownloadableSticker(message)
  );
}

function canForwardMessage(message: ListMessageResult): boolean {
  if (isDeletedMessage(message)) return false;
  if (!message.content?.type) return false;
  if (message.content.type === EMessageType.view_once) return false;
  if (message.message_key?.is_view_once) return false;
  return FORWARD_ALLOWED_TYPES.has(message.content.type);
}

function canEditMessage(message: ListMessageResult, fromMe: boolean): boolean {
  if (!fromMe) return false;
  if (!isTextMessage(message)) return false;
  if (isDeletedMessage(message)) return false;

  const messageDate = new Date(message.date);
  const now = new Date();
  const diffInMinutes = (now.getTime() - messageDate.getTime()) / (1000 * 60);

  return diffInMinutes < 10;
}

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

function splitFileNameParts(fileName: string): {
  base: string;
  extension: string;
} {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return {
      base: fileName,
      extension: '',
    };
  }

  return {
    base: fileName.slice(0, dotIndex),
    extension: fileName.slice(dotIndex),
  };
}

function resolveUniqueFileName(
  directory: Directory,
  requestedFileName: string
): string {
  if (!new File(directory, requestedFileName).exists) {
    return requestedFileName;
  }

  const { base, extension } = splitFileNameParts(requestedFileName);
  let index = 1;
  while (index < 10_000) {
    const candidate = `${base} (${index})${extension}`;
    if (!new File(directory, candidate).exists) {
      return candidate;
    }
    index += 1;
  }

  return `${base}-${Date.now()}${extension}`;
}

function resolveDownloadMimeType(fileName: string, kind: DownloadKind): string {
  const extension = extractFileExtension(fileName);

  if (kind === 'image') {
    if (extension === 'png') return 'image/png';
    if (extension === 'webp') return 'image/webp';
    if (extension === 'gif') return 'image/gif';
    return 'image/jpeg';
  }

  if (kind === 'video') {
    if (extension === 'webm') return 'video/webm';
    if (extension === 'mov') return 'video/quicktime';
    if (extension === 'mkv') return 'video/x-matroska';
    return 'video/mp4';
  }

  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'txt') return 'text/plain';
  if (extension === 'csv') return 'text/csv';
  if (extension === 'json') return 'application/json';
  if (extension === 'zip') return 'application/zip';
  if (extension === 'mp3') return 'audio/mpeg';
  if (extension === 'm4a') return 'audio/mp4';
  if (extension === 'ogg' || extension === 'opus') return 'audio/ogg';

  return 'application/octet-stream';
}

function resolveDownloadSuccessMessage(kind: DownloadKind): string {
  if (kind === 'image') return pt.image_download_success;
  if (kind === 'video') return pt.video_download_success;
  return pt.file_download_success;
}

function resolveDownloadErrorMessage(kind: DownloadKind): string {
  if (kind === 'image') return pt.image_download_error;
  if (kind === 'video') return pt.video_download_error;
  return pt.file_download_error;
}

async function saveDownloadedFileToPickedDirectory(
  downloadedFile: File,
  requestedFileName: string,
  kind: DownloadKind
): Promise<void> {
  const pickedDirectory = await Directory.pickDirectoryAsync();
  const targetFileName = resolveUniqueFileName(
    pickedDirectory,
    requestedFileName
  );
  const mimeType = resolveDownloadMimeType(targetFileName, kind);
  const destinationFile = pickedDirectory.createFile(targetFileName, mimeType);

  try {
    const bytes = await downloadedFile.bytes();
    destinationFile.write(bytes);
    const savedSize = destinationFile.size;
    if (typeof savedSize === 'number' && savedSize <= 0) {
      throw new Error('saved-file-empty');
    }
  } catch (error) {
    try {
      if (destinationFile.exists) {
        destinationFile.delete();
      }
    } catch {}
    throw error;
  }
}

function getExtensionFromUrl(url: string): string | null {
  const withoutQuery = url.split('?')[0]?.split('#')[0] ?? '';
  const fileName = withoutQuery.split('/').pop() ?? '';
  const match = fileName.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : null;
}

function extractFileExtension(name: string | null | undefined): string {
  if (!name) return '';
  const ext = name.split('.').pop()?.trim().toLowerCase();
  return ext ?? '';
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

function formatPreviewUrlForDisplay(value: string | null | undefined): string {
  const normalized = readNonEmptyString(value);
  if (!normalized) return '';
  return normalized.replace(/([/:?&=#._-])/g, '$1\u200B');
}

function generateQuickMessageProtocolFallback(): string {
  const now = new Date();
  const year = now.getFullYear().toString();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const randomDigits = Array.from({ length: 7 }, () =>
    Math.floor(Math.random() * 10).toString()
  ).join('');
  return `${year}${month}${day}${randomDigits}`;
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

  if (isLottieSticker(sticker)) return true;

  const mimetype = (sticker.mimetype ?? '').trim().toLowerCase();
  const extension = (sticker.extension ?? '')
    .replace(/^\./, '')
    .trim()
    .toLowerCase();

  if (extension === 'zip') {
    return false;
  }

  if (mimetype.startsWith('image/')) return true;
  if (extension === 'webp') return true;

  return true;
}

function isLottieSticker(
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
    return true;

  if (extension === 'was' || extension === 'tgs') return true;

  return false;
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

function buildContactFormInitialValues(
  contact: MessageContentContact,
  defaultPhoneDdi: string
): ContactFormInitialValues {
  const resolvedName = readNonEmptyString(contact.name) ?? '';
  const resolvedLastName = readNonEmptyString(contact.last_name) ?? '';
  const resolvedPhoneDdi =
    readNonEmptyString(contact.phone_ddi) ?? defaultPhoneDdi;
  const rawPhone = contact.phone ?? contact.phone_partial ?? '';

  return {
    name: resolvedName,
    lastName: resolvedLastName,
    phoneDdi: resolvedPhoneDdi,
    phone: normalizePhoneDigits(rawPhone),
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

  try {
    await saveDownloadedFileToPickedDirectory(downloadedFile, fileName, kind);
    Alert.alert(pt.success_title, resolveDownloadSuccessMessage(kind));
    return;
  } catch (error) {
    if (isDirectoryPickerCancellationError(error)) {
      Alert.alert(pt.warning_title, pt.download_cancelled);
      return;
    }
    Alert.alert(pt.error_title, resolveDownloadErrorMessage(kind));
  } finally {
    cleanupDownloadedFile();
  }
}

function getLatestMessageText(msg: ListMessageResult): string {
  const c = msg.content;
  const versions = c?.version;
  if (versions && versions.length > 0) {
    const sortedVersions = [...versions].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    const latestVersion = sortedVersions[0]?.message?.trim();
    if (latestVersion) return latestVersion;
  }

  if (c?.message) return c.message;
  if (c?.image?.caption) return c.image.caption;
  if (c?.video?.caption) return c.video.caption;
  if (c?.audio?.url && c?.message) return c.message;
  return '';
}

function hasMessageVersions(message: ListMessageResult): boolean {
  return !!(message.content?.version && message.content.version.length > 0);
}

function getMessageEditHistory(
  message: ListMessageResult
): MessageEditHistoryItem[] {
  const content = message.content;
  if (!content) return [];

  const history: MessageEditHistoryItem[] = [];
  const versions = content.version ?? [];
  const sortedVersions = [...versions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  for (const version of sortedVersions) {
    const text = version.message?.trim();
    if (!text) continue;
    history.push({
      text,
      date: version.date,
      isOriginal: false,
    });
  }

  const originalText = content.message?.trim();
  if (originalText) {
    history.push({
      text: originalText,
      date: message.date,
      isOriginal: true,
    });
  }

  return history;
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

function normalizeMessageSummary(
  summary: ListMessageResult['summary'] | null | undefined
): ListMessageResult['summary'] | null {
  if (!summary) {
    return null;
  }

  const isSeen = summary.is_seen === true;
  const isDelivered = summary.is_delivered === true || isSeen;
  const isSent = summary.is_sent === true || isDelivered;

  return {
    is_sent: isSent,
    is_delivered: isDelivered,
    is_seen: isSeen,
    is_sent_to_internal: summary.is_sent_to_internal === true,
  };
}

function mergeMessageSummary(
  previous: ListMessageResult['summary'] | null | undefined,
  incoming: ListMessageResult['summary'] | null | undefined
): ListMessageResult['summary'] | null | undefined {
  const normalizedPrevious = normalizeMessageSummary(previous);
  const normalizedIncoming = normalizeMessageSummary(incoming);

  if (!normalizedPrevious && !normalizedIncoming) {
    return undefined;
  }
  if (!normalizedPrevious) {
    return normalizedIncoming;
  }
  if (!normalizedIncoming) {
    return normalizedPrevious;
  }

  const previousFailed = normalizedPrevious.is_sent_to_internal === false;
  const incomingFailed = normalizedIncoming.is_sent_to_internal === false;

  if (incomingFailed) {
    return {
      is_sent: false,
      is_delivered: false,
      is_seen: false,
      is_sent_to_internal: false,
    };
  }

  if (previousFailed) {
    return normalizedIncoming;
  }

  const isSeen = normalizedPrevious.is_seen || normalizedIncoming.is_seen;
  const isDelivered =
    normalizedPrevious.is_delivered ||
    normalizedIncoming.is_delivered ||
    isSeen;
  const isSent =
    normalizedPrevious.is_sent || normalizedIncoming.is_sent || isDelivered;

  return {
    is_sent: isSent,
    is_delivered: isDelivered,
    is_seen: isSeen,
    is_sent_to_internal: true,
  };
}

function mergeMessageLists(
  current: ListMessageResult[],
  incoming: ListMessageResult
): ListMessageResult[] {
  const incomingHash = readNonEmptyString(incoming.hash);
  const existingIndexByHash = incomingHash
    ? current.findIndex(
        (message) => readNonEmptyString(message.hash) === incomingHash
      )
    : -1;
  const existingIndex =
    existingIndexByHash >= 0
      ? existingIndexByHash
      : current.findIndex(
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
        ? mergeMessageSummary(previous.summary, incoming.summary)
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

    const merged = {
      ...previous,
      ...incoming,
      content: mergedContent,
      summary: mergedSummary,
      message_key: mergedMessageKey,
      user: mergedUser,
      hash:
        readNonEmptyString(incoming.hash) ?? readNonEmptyString(previous.hash),
    };
    next[existingIndex] = merged;
    const mergedHash = readNonEmptyString(merged.hash);
    return next.filter((message, index) => {
      if (index === existingIndex) return true;
      if (message.message_id === merged.message_id) return false;
      if (
        mergedHash &&
        readNonEmptyString(message.hash) &&
        readNonEmptyString(message.hash) === mergedHash
      ) {
        return false;
      }
      return true;
    });
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
type ReplyComposerPreviewModel = {
  name: string;
  text: string;
  meta: string;
  type: string;
  thumbUri: string | null;
  contactPhotoUri: string | null;
  showContactGroupIcon: boolean;
  showDocumentIcon: boolean;
  showVideoIcon: boolean;
  showAudioIcon: boolean;
  showLocationIcon: boolean;
  showStickerFallbackIcon: boolean;
};

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

function resolveReplyComposerType(
  content: MessageContent | null | undefined
): string {
  const explicitType = readNonEmptyString(content?.type);
  if (explicitType) return explicitType;
  if (content?.image) return EMessageType.image;
  if (content?.video) return EMessageType.video;
  if (content?.audio) return EMessageType.audio;
  if (content?.document) return EMessageType.document;
  if (content?.sticker) return EMessageType.sticker;
  if (content?.location) return EMessageType.location;
  if (content?.contact) return EMessageType.contact_card;
  if (content?.contacts && content.contacts.length > 0)
    return EMessageType.contacts;
  return EMessageType.text;
}

function resolveReplyComposerName(
  message: ListMessageResult,
  chatInfo: ListChatsResult,
  currentUserName: string | null | undefined
): string {
  if (message.type_user === ETypeUserChat.client) {
    return resolveTypingDisplayName(chatInfo);
  }

  return (
    readNonEmptyString(message.user?.name) ||
    readNonEmptyString(currentUserName) ||
    readNonEmptyString(chatInfo.user?.name) ||
    pt.attendant
  );
}

function resolveReplyComposerText(
  message: ListMessageResult,
  replyType: string
): string {
  const content = message.content;
  if (!content) return '';

  if (replyType === EMessageType.image) {
    return readNonEmptyString(content.image?.caption) ?? 'Foto';
  }

  if (replyType === EMessageType.document) {
    return (
      readNonEmptyString(content.document?.name) ||
      readNonEmptyString(content.message) ||
      pt.document
    );
  }

  if (replyType === EMessageType.video) {
    return readNonEmptyString(content.video?.caption) ?? 'Vídeo';
  }

  if (replyType === EMessageType.video_note) {
    return readNonEmptyString(content.video?.caption) ?? 'Vídeo circular';
  }

  if (replyType === EMessageType.audio) {
    return readNonEmptyString(content.message) ?? pt.audio;
  }

  if (replyType === EMessageType.sticker) {
    return 'Sticker';
  }

  if (replyType === EMessageType.location) {
    return (
      readNonEmptyString(content.location?.name) ||
      readNonEmptyString(content.location?.address) ||
      pt.location
    );
  }

  if (replyType === EMessageType.contact_card && content.contact) {
    const contactName =
      [content.contact.name, content.contact.last_name]
        .filter(Boolean)
        .join(' ')
        .trim() || pt.contact;
    const contactMessage = readNonEmptyString(content.message);
    return contactMessage ? `${contactName} - ${contactMessage}` : contactName;
  }

  if (replyType === EMessageType.contacts) {
    const firstContact = content.contacts?.[0];
    if (firstContact) {
      const firstName =
        [firstContact.name, firstContact.last_name]
          .filter(Boolean)
          .join(' ')
          .trim() || pt.contact;
      const extraCount = (content.contacts?.length ?? 0) - 1;
      const groupName =
        extraCount > 0
          ? `${firstName} e ${extraCount} ${pt.contacts_other}`
          : firstName;
      const groupedMessage = readNonEmptyString(content.message);
      return groupedMessage ? `${groupName} - ${groupedMessage}` : groupName;
    }
    return pt.contact;
  }

  return (
    readNonEmptyString(content.message) ||
    readNonEmptyString(content.link_preview?.['matched-text']) ||
    readNonEmptyString(content.link_preview?.['canonical-url']) ||
    ''
  );
}

function resolveReplyComposerMeta(
  message: ListMessageResult,
  replyType: string
): string {
  const content = message.content;
  if (!content) return '';

  if (replyType === EMessageType.document) {
    const ext = content.document?.extension
      ? content.document.extension.replace(/^\./, '').toUpperCase()
      : '';
    const size = formatFileSize(content.document?.size);
    return [ext, size].filter(Boolean).join(' • ');
  }

  if (
    replyType === EMessageType.video ||
    replyType === EMessageType.video_note
  ) {
    const ext = content.video?.extension
      ? content.video.extension.replace(/^\./, '').toUpperCase()
      : '';
    const size = formatFileSize(content.video?.size);
    return [ext, size].filter(Boolean).join(' • ');
  }

  if (replyType === EMessageType.audio) {
    const size = formatFileSize(content.audio?.size);
    const duration = formatVideoDuration(content.audio?.duration);
    return [size, duration].filter(Boolean).join(' • ');
  }

  return '';
}

function resolveReplyComposerThumbUri(
  message: ListMessageResult,
  replyType: string
): string | null {
  const content = message.content;
  if (!content) return null;

  if (replyType === EMessageType.image) {
    return resolveMediaUri(content.image?.thumbnail ?? content.image?.url);
  }

  if (replyType === EMessageType.sticker) {
    if (isLottieSticker(content.sticker)) return null;
    if (!isRenderableSticker(content.sticker)) return null;
    return resolveMediaUri(content.sticker?.url);
  }

  return null;
}

function resolveReplyComposerContactPhoto(
  message: ListMessageResult,
  replyType: string
): string | null {
  const content = message.content;
  if (!content) return null;

  if (replyType === EMessageType.contact_card) {
    return resolveMediaUri(content.contact?.photo);
  }

  if (replyType === EMessageType.contacts) {
    return resolveMediaUri(content.contacts?.[0]?.photo);
  }

  return null;
}

function buildReplyComposerPreviewModel(
  message: ListMessageResult,
  chatInfo: ListChatsResult,
  currentUserName: string | null | undefined
): ReplyComposerPreviewModel {
  const type = resolveReplyComposerType(message.content);
  const thumbUri = resolveReplyComposerThumbUri(message, type);
  const contactPhotoUri = resolveReplyComposerContactPhoto(message, type);

  return {
    name: resolveReplyComposerName(message, chatInfo, currentUserName),
    text: resolveReplyComposerText(message, type) || pt.type_message,
    meta: resolveReplyComposerMeta(message, type),
    type,
    thumbUri,
    contactPhotoUri,
    showContactGroupIcon:
      type === EMessageType.contacts &&
      !contactPhotoUri &&
      (message.content?.contacts?.length ?? 0) > 1,
    showDocumentIcon: type === EMessageType.document,
    showVideoIcon:
      type === EMessageType.video || type === EMessageType.video_note,
    showAudioIcon: type === EMessageType.audio,
    showLocationIcon: type === EMessageType.location,
    showStickerFallbackIcon: type === EMessageType.sticker && !thumbUri,
  };
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
    if (isLottieSticker(quoted.sticker)) return null;
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

type ViewerMediaItem = {
  src: string;
  caption: string;
  downloadName: string;
};

type MediaViewerState = {
  visible: boolean;
  kind: 'image' | 'video';
  src: string;
  caption: string;
  downloadName: string;
  items: ViewerMediaItem[];
  activeIndex: number;
};

type CameraCaptureDraft = {
  uri: string;
  kind: 'image' | 'video';
  fileName: string;
  mimeType: string;
  durationSec: number | null;
  fileSize?: number | null;
};

type VideoTrimSessionResult =
  | {
      kind: 'success';
      outputPath: string;
      startTime: number;
      endTime: number;
      duration: number;
    }
  | { kind: 'cancel' }
  | { kind: 'error'; message: string };

type PendingVideoUploadDraft = {
  hash: string;
  uri: string;
  fileName: string;
  mimeType: string;
  durationSec: number | null;
  fileSize: number | null;
  replyMessageId: string | null;
  localMessageId: string;
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
  onLongPress,
}: {
  sourceUri: string;
  thumbnailUri: string | null;
  isVideoNote: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const [thumbnailLoadError, setThumbnailLoadError] = useState(false);
  const [generatedThumbnailUri, setGeneratedThumbnailUri] = useState<
    string | null
  >(null);
  const [generatingThumbnail, setGeneratingThumbnail] = useState(false);

  const shouldGenerateThumbnail = !thumbnailUri || thumbnailLoadError;

  useEffect(() => {
    setThumbnailLoadError(false);
  }, [sourceUri, thumbnailUri]);

  useEffect(() => {
    if (!shouldGenerateThumbnail) {
      setGeneratedThumbnailUri(null);
      setGeneratingThumbnail(false);
      return;
    }

    let active = true;
    setGeneratingThumbnail(true);
    setGeneratedThumbnailUri(null);

    void VideoThumbnails.getThumbnailAsync(sourceUri, {
      time: 1000,
      quality: 0.7,
    })
      .then((result) => {
        if (!active) return;
        setGeneratedThumbnailUri(result.uri);
      })
      .catch(() => {
        if (!active) return;
        setGeneratedThumbnailUri(null);
      })
      .finally(() => {
        if (!active) return;
        setGeneratingThumbnail(false);
      });

    return () => {
      active = false;
    };
  }, [shouldGenerateThumbnail, sourceUri]);

  const previewUri = shouldGenerateThumbnail
    ? generatedThumbnailUri
    : thumbnailUri;
  const showImagePreview = !!previewUri;

  return (
    <Pressable
      style={isVideoNote ? styles.videoNoteThumbWrap : styles.videoThumbWrap}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={220}
    >
      {showImagePreview ? (
        <Image
          source={{ uri: previewUri }}
          style={isVideoNote ? styles.videoNoteThumb : styles.videoThumb}
          resizeMode="cover"
          onError={() => setThumbnailLoadError(true)}
        />
      ) : (
        <View
          style={
            isVideoNote ? styles.videoNotePlaceholder : styles.videoPlaceholder
          }
        >
          {generatingThumbnail ? (
            <ActivityIndicator size="small" color={colors.grey600} />
          ) : (
            <Ionicons
              name="videocam-outline"
              size={28}
              color={colors.grey600}
            />
          )}
        </View>
      )}

      <View style={styles.videoOverlay}>
        <Ionicons name="play-circle" size={48} color="#fff" />
      </View>
    </Pressable>
  );
}

function StickerMessagePreview({
  stickerUri,
  isLottie,
  onOpenActions,
}: {
  stickerUri: string;
  isLottie: boolean;
  onOpenActions?: () => void;
}) {
  const [hasImageError, setHasImageError] = useState(false);

  if (isLottie) {
    return (
      <Pressable onLongPress={onOpenActions} delayLongPress={220}>
        <LottieSticker src={stickerUri} size={100} />
      </Pressable>
    );
  }

  if (hasImageError) {
    return (
      <Pressable
        style={styles.stickerFallback}
        onLongPress={onOpenActions}
        delayLongPress={220}
      >
        <Ionicons name="document-outline" size={20} color={colors.grey700} />
        <Text style={styles.stickerFallbackText}>Sticker</Text>
      </Pressable>
    );
  }

  return (
    <Pressable onLongPress={onOpenActions} delayLongPress={220}>
      <ExpoImage
        source={{ uri: stickerUri }}
        style={styles.stickerThumb}
        contentFit="contain"
        onError={(error) => {
          console.warn('[Sticker] image render error', {
            uri: stickerUri,
            error: error?.error ?? 'unknown',
          });
          setHasImageError(true);
        }}
      />
    </Pressable>
  );
}

function LocationMessagePreview({
  latitude,
  longitude,
  name,
  address,
  onLongPress,
}: {
  latitude: number;
  longitude: number;
  name: string | null | undefined;
  address: string | null | undefined;
  onLongPress?: () => void;
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
  const previewCoordinateLngLat = useMemo<[number, number]>(
    () => [longitude, latitude],
    [latitude, longitude]
  );
  const title = name?.trim() || pt.location;

  const handleOpen = useCallback(() => {
    void openLocationInMaps(latitude, longitude, title || address);
  }, [address, latitude, longitude, title]);

  return (
    <Pressable
      style={styles.locationBubble}
      onPress={handleOpen}
      onLongPress={onLongPress}
      delayLongPress={220}
    >
      <View style={styles.locationMapPreview}>
        {hasNativeMapSupport && NativeMapView && NativeMapCamera ? (
          <>
            <NativeMapView
              style={styles.locationMapImage}
              mapStyle={mapLibreStyleUrl}
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              pointerEvents="none"
            >
              <NativeMapCamera
                centerCoordinate={previewCoordinateLngLat}
                zoomLevel={15}
                animationDuration={0}
              />
              {NativeMapPointAnnotation ? (
                <NativeMapPointAnnotation
                  id={`location-preview-${latitude}-${longitude}`}
                  coordinate={previewCoordinateLngLat}
                >
                  <View style={styles.locationMapMarker}>
                    <Ionicons name="location-sharp" size={30} color="#EF4444" />
                  </View>
                </NativeMapPointAnnotation>
              ) : (
                <View style={styles.locationPinOverlay}>
                  <Ionicons name="location-sharp" size={36} color="#EF4444" />
                </View>
              )}
            </NativeMapView>
          </>
        ) : previewLoadError ? (
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
  onLongPress,
}: {
  preview: MessageContentLinkPreview;
  fromMe: boolean;
  onLongPress?: () => void;
}) {
  const previewUrl = resolvePreviewUrl(preview);
  const previewImage = resolvePreviewImage(preview);
  const title = readNonEmptyString(preview.title);
  const description = readNonEmptyString(preview.description);
  const previewUrlDisplay = formatPreviewUrlForDisplay(previewUrl);
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
      onLongPress={onLongPress}
      delayLongPress={220}
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
        <View
          style={[
            styles.linkPreviewUrlContainer,
            previewImage && styles.linkPreviewUrlContainerWithThumb,
          ]}
        >
          <Text
            style={styles.linkPreviewUrl}
            numberOfLines={2}
            ellipsizeMode="tail"
            textBreakStrategy="highQuality"
          >
            {previewUrlDisplay}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function ExternalAdReplyMessage({
  adReply,
  fromMe,
  onLongPress,
}: {
  adReply: MessageContextExternalAdReply;
  fromMe: boolean;
  onLongPress?: () => void;
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
      onLongPress={onLongPress}
      delayLongPress={220}
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
              <WhatsAppFormattedText
                text={quotedText}
                style={[
                  styles.quotedText,
                  fromMe && styles.quotedTextRight,
                  isQuotedContactType && styles.quotedTextContact,
                ]}
                numberOfLines={2}
                ellipsizeMode="tail"
              />
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
  imageGallery,
  chatInfo,
  resolvedContactDisplay,
  audioCtrl,
  onOpenImage,
  onOpenVideo,
  onOpenActions,
  onPressContactCard,
  onPressContactsGroup,
  onTemplateButtonPress,
  disableTemplateButtons,
  forceCollapsedLongText = false,
  obfuscateContent = false,
}: {
  msg: ListMessageResult;
  fromMe: boolean;
  content: MessageContent;
  imageGallery?: GalleryImageGroup | null;
  chatInfo: ListChatsResult;
  resolvedContactDisplay?: ContactCardDisplayData;
  audioCtrl: AudioCtrl | null;
  onOpenImage: (msg: ListMessageResult, galleryIndex?: number) => void;
  onOpenVideo: (msg: ListMessageResult) => void;
  onOpenActions?: (message: ListMessageResult) => void;
  onPressContactCard?: (
    message: ListMessageResult,
    contact: MessageContentContact
  ) => void;
  onPressContactsGroup?: (
    message: ListMessageResult,
    contacts: MessageContentContact[]
  ) => void;
  onTemplateButtonPress?: (
    button: MessageTemplateButton,
    message: ListMessageResult
  ) => void;
  disableTemplateButtons?: boolean;
  forceCollapsedLongText?: boolean;
  obfuscateContent?: boolean;
}) {
  const [isLongTextExpanded, setIsLongTextExpanded] = useState(false);
  const [isLongTextByLines, setIsLongTextByLines] = useState(false);

  useEffect(() => {
    setIsLongTextExpanded(false);
    setIsLongTextByLines(false);
  }, [msg.message_id, forceCollapsedLongText]);

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
          <LinkPreviewMessage
            preview={linkPreview}
            fromMe={fromMe}
            onLongPress={() => onOpenActions?.(msg)}
          />
        ) : null}
        {hasExternalAdReply && externalAdReply ? (
          <ExternalAdReplyMessage
            adReply={externalAdReply}
            fromMe={fromMe}
            onLongPress={() => onOpenActions?.(msg)}
          />
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
    if (imageGallery && imageGallery.items.length >= 2) {
      const visibleItems = imageGallery.items.slice(
        0,
        MAX_IMAGE_GALLERY_THUMBNAILS
      );
      const hiddenCount = Math.max(
        0,
        imageGallery.items.length - MAX_IMAGE_GALLERY_THUMBNAILS
      );

      return renderWithContextCards(
        <View style={[styles.mediaBubble, styles.mediaBubbleImageGallery]}>
          <View style={styles.imageGalleryGrid}>
            {visibleItems.map((galleryItem, galleryIndex) => {
              const isLastVisibleItem =
                galleryIndex === MAX_IMAGE_GALLERY_THUMBNAILS - 1;
              const showHiddenOverlay = hiddenCount > 0 && isLastVisibleItem;

              return (
                <Pressable
                  key={`gallery-${msg.message_id}-${galleryItem.message.message_id}`}
                  style={[
                    styles.imageGalleryItem,
                    visibleItems.length === 1 && styles.imageGalleryItemSingle,
                  ]}
                  onPress={() => onOpenImage(msg, galleryIndex)}
                  onLongPress={() => onOpenActions?.(msg)}
                  delayLongPress={220}
                >
                  <Image
                    source={{ uri: galleryItem.src }}
                    style={styles.imageGalleryThumb}
                    resizeMode="cover"
                  />
                  {showHiddenOverlay ? (
                    <View style={styles.imageGalleryHiddenOverlay}>
                      <Text style={styles.imageGalleryHiddenText}>
                        +{hiddenCount}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      );
    }

    const cap = content.image.caption;
    const imageUri = resolveMediaUri(content.image.url);
    if (!imageUri) return null;
    return renderWithContextCards(
      <View style={[styles.mediaBubble, styles.mediaBubbleImage]}>
        <Pressable
          onPress={() => onOpenImage(msg, 0)}
          onLongPress={() => onOpenActions?.(msg)}
          delayLongPress={220}
        >
          <Image
            source={{ uri: imageUri }}
            style={styles.imageThumb}
            resizeMode="cover"
          />
        </Pressable>
        {cap ? (
          <WhatsAppFormattedText
            text={cap}
            style={[styles.mediaCaption, textColor]}
            onLinkLongPress={() => onOpenActions?.(msg)}
          />
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
          onLongPress={() => onOpenActions?.(msg)}
        />
        {videoMeta ? <Text style={styles.mediaMeta}>{videoMeta}</Text> : null}
        {cap ? (
          <WhatsAppFormattedText
            text={cap}
            style={[styles.mediaCaption, textColor]}
            onLinkLongPress={() => onOpenActions?.(msg)}
          />
        ) : null}
      </View>
    );
  }

  if (type === EMessageType.sticker && content.sticker?.url) {
    const stickerUri = resolveMediaUri(content.sticker.url);
    if (!stickerUri) return null;
    const isLottie = isLottieSticker(content.sticker);

    if (!isLottie && !isRenderableSticker(content.sticker)) {
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
          onLongPress={() => onOpenActions?.(msg)}
          delayLongPress={220}
        >
          <Ionicons name="document-outline" size={20} color={colors.grey700} />
          <Text style={styles.stickerFallbackText}>Sticker</Text>
        </Pressable>
      );
    }

    return renderWithContextCards(
      <StickerMessagePreview
        stickerUri={stickerUri}
        isLottie={isLottie}
        onOpenActions={() => onOpenActions?.(msg)}
      />
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
        onLongPress={() => onOpenActions?.(msg)}
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
            <WhatsAppFormattedText
              text={cap}
              style={[styles.mediaCaption, textColor]}
              onLinkLongPress={() => onOpenActions?.(msg)}
            />
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
            onLongPress={() => onOpenActions?.(msg)}
            delayLongPress={220}
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
              onLongPress={() => onOpenActions?.(msg)}
              delayLongPress={220}
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
            onLongPress={() => onOpenActions?.(msg)}
            delayLongPress={220}
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
          <WhatsAppFormattedText
            text={cap}
            style={[styles.mediaCaption, textColor, styles.audioCaption]}
            onLinkLongPress={() => onOpenActions?.(msg)}
          />
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
            onLongPress={() => onOpenActions?.(msg)}
            delayLongPress={220}
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
            onLongPress={() => onOpenActions?.(msg)}
            delayLongPress={220}
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
          <WhatsAppFormattedText
            text={cap}
            style={[styles.mediaCaption, textColor, styles.documentCaption]}
            onLinkLongPress={() => onOpenActions?.(msg)}
          />
        ) : null}
      </View>
    );
  }

  if (type === EMessageType.contact_card && content.contact) {
    const messageContact = content.contact;
    const contactDisplay =
      resolvedContactDisplay ??
      resolveContactCardDisplayData(messageContact, chatInfo);
    return renderWithContextCards(
      <Pressable
        style={({ pressed }) => [
          styles.contactWrap,
          fromMe && styles.contactWrapRight,
          pressed && styles.contactWrapPressed,
        ]}
        onPress={() => onPressContactCard?.(msg, messageContact)}
        onLongPress={() => onOpenActions?.(msg)}
        delayLongPress={220}
      >
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
      </Pressable>
    );
  }

  if (type === EMessageType.contacts && content.contacts?.length) {
    const list = content.contacts;
    const first = list[0];
    const name = first?.name ?? pt.contact;
    const extra =
      list.length > 1 ? ` e ${list.length - 1} ${pt.contacts_other}` : '';
    return renderWithContextCards(
      <Pressable
        style={({ pressed }) => [
          styles.contactWrap,
          fromMe && styles.contactWrapRight,
          pressed && styles.contactWrapPressed,
        ]}
        onPress={() => onPressContactsGroup?.(msg, list)}
        onLongPress={() => onOpenActions?.(msg)}
        delayLongPress={220}
      >
        <Ionicons name="people" size={32} color={colors.primary} />
        <Text style={[styles.contactName, textColor]}>
          {name}
          {extra}
        </Text>
      </Pressable>
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
        {text ? (
          <WhatsAppFormattedText
            text={text}
            style={styles.systemText}
            onLinkLongPress={() => onOpenActions?.(msg)}
          />
        ) : null}
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
          <WhatsAppFormattedText
            text={title}
            style={[styles.templateTitle, textColor]}
            onLinkLongPress={() => onOpenActions?.(msg)}
          />
        ) : null}
        {body ? (
          <WhatsAppFormattedText
            text={body}
            style={[styles.templateContent, textColor]}
            onLinkLongPress={() => onOpenActions?.(msg)}
          />
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
    const isLongByLength = text.length > LONG_TEXT_COLLAPSE_CHAR_THRESHOLD;
    const shouldCollapse = forceCollapsedLongText || !isLongTextExpanded;
    const canExpand = isLongByLength || isLongTextByLines;
    const canToggleExpanded = canExpand && !forceCollapsedLongText;

    return renderWithContextCards(
      <View style={styles.bubbleTextWrap}>
        <WhatsAppFormattedText
          text={text}
          style={[styles.bubbleText, textColor]}
          selectable={false}
          numberOfLines={shouldCollapse ? LONG_TEXT_COLLAPSE_LINES : undefined}
          onLinkLongPress={() => onOpenActions?.(msg)}
          onTextLayout={(event) => {
            if (isLongTextByLines || !text) return;
            if (
              (event.nativeEvent.lines?.length ?? 0) > LONG_TEXT_COLLAPSE_LINES
            ) {
              setIsLongTextByLines(true);
            }
          }}
        />
        {canExpand ? (
          <Pressable
            onPress={() => {
              if (!canToggleExpanded) return;
              setIsLongTextExpanded((previous) => !previous);
            }}
            hitSlop={8}
            style={styles.readMoreButton}
            disabled={!canToggleExpanded}
          >
            <Text style={styles.readMoreText}>
              {shouldCollapse ? pt.read_more : pt.read_less}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return renderWithContextCards(null);
}

function resolveMessageFeedbackIcon(
  message: ListMessageResult,
  fromMe: boolean
): { name: keyof typeof Ionicons.glyphMap; color: string } | null {
  if (!fromMe) return null;
  if (message.content?.type === EMessageType.annotation) return null;

  if (message.summary?.is_sent_to_internal === false) {
    return {
      name: 'alert-circle',
      color: colors.error,
    };
  }

  if (message.summary?.is_seen === true) {
    return {
      name: 'checkmark-done',
      color: colors.primary,
    };
  }

  if (message.summary?.is_delivered === true) {
    return {
      name: 'checkmark-done',
      color: colors.bubbleSentTime,
    };
  }

  return {
    name: 'checkmark',
    color: colors.bubbleSentTime,
  };
}

function MessageBubble({
  msg,
  fromMe,
  chatInfo,
  imageGallery,
  currentUserName,
  highlighted,
  onPressQuoted,
  resolvedContactDisplay,
  audioCtrl,
  onOpenImage,
  onOpenVideo,
  onPressContactCard,
  onPressContactsGroup,
  onTemplateButtonPress,
  disableTemplateButtons,
  canInteract,
  onOpenActions,
  forceCollapsedLongText = false,
  obfuscateContent = false,
}: {
  msg: ListMessageResult;
  fromMe: boolean;
  chatInfo: ListChatsResult;
  imageGallery?: GalleryImageGroup | null;
  currentUserName: string | null;
  highlighted?: boolean;
  onPressQuoted?: (() => void) | null;
  resolvedContactDisplay?: ContactCardDisplayData;
  audioCtrl: AudioCtrl | null;
  onOpenImage: (msg: ListMessageResult, galleryIndex?: number) => void;
  onOpenVideo: (msg: ListMessageResult) => void;
  onPressContactCard?: (
    message: ListMessageResult,
    contact: MessageContentContact
  ) => void;
  onPressContactsGroup?: (
    message: ListMessageResult,
    contacts: MessageContentContact[]
  ) => void;
  onTemplateButtonPress?: (
    button: MessageTemplateButton,
    message: ListMessageResult
  ) => void;
  disableTemplateButtons?: boolean;
  canInteract?: boolean;
  onOpenActions?: (message: ListMessageResult) => void;
  forceCollapsedLongText?: boolean;
  obfuscateContent?: boolean;
}) {
  const content = msg.content;
  const timeStr = formatMessageTime(msg.date);
  const latestText = getLatestMessageText(msg).trim();
  const hasInlineLinkInText = splitTextChunksWithLinks(latestText).some(
    (chunk) => !!chunk.url
  );
  const hasAnyLinkContent = Boolean(
    content?.link_preview ||
    content?.context_info?.external_ad_reply ||
    hasInlineLinkInText
  );
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
  const hasEditedVersions = hasMessageVersions(msg);
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
  const feedbackIcon = resolveMessageFeedbackIcon(msg, fromMe);

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
            fromMe && hasAnyLinkContent && styles.bubbleRightWithLink,
            !fromMe && hasAnyLinkContent && styles.bubbleLeftWithLink,
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
            {feedbackIcon ? (
              <Ionicons
                name={feedbackIcon.name}
                size={14}
                color={feedbackIcon.color}
              />
            ) : null}
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
      <Pressable
        style={({ pressed }) => [
          styles.bubble,
          { backgroundColor: bubbleBg },
          isSystem && styles.bubbleSystem,
          isContactCard && styles.bubbleContact,
          isAudio && styles.bubbleAudio,
          isDocument && styles.bubbleDocument,
          fromMe && hasAnyLinkContent && styles.bubbleRightWithLink,
          !fromMe && hasAnyLinkContent && styles.bubbleLeftWithLink,
          hasQuoted && styles.bubbleQuotedMinWidth,
          isShortTextMessage && styles.bubbleShortMinWidth,
          highlighted && styles.bubbleHighlighted,
          pressed && canInteract && styles.bubblePressed,
        ]}
        onLongPress={() => {
          if (!canInteract) return;
          onOpenActions?.(msg);
        }}
        delayLongPress={220}
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
          imageGallery={imageGallery}
          chatInfo={chatInfo}
          resolvedContactDisplay={resolvedContactDisplay}
          audioCtrl={audioCtrl}
          onOpenImage={onOpenImage}
          onOpenVideo={onOpenVideo}
          onPressContactCard={onPressContactCard}
          onPressContactsGroup={onPressContactsGroup}
          onOpenActions={onOpenActions}
          onTemplateButtonPress={onTemplateButtonPress}
          disableTemplateButtons={disableTemplateButtons}
          forceCollapsedLongText={forceCollapsedLongText}
          obfuscateContent={obfuscateContent}
        />
        <View
          style={[
            styles.bubbleMeta,
            fromMe && hasAnyLinkContent && styles.bubbleMetaRightWithLink,
            isAudio && styles.bubbleMetaAudio,
            isDocument && styles.bubbleMetaDocument,
          ]}
        >
          {!msg.deleted && hasEditedVersions ? (
            <Text
              style={[
                styles.bubbleEditedBadge,
                fromMe
                  ? styles.bubbleEditedBadgeRight
                  : styles.bubbleEditedBadgeLeft,
              ]}
              numberOfLines={1}
            >
              {pt.chat_edited}
            </Text>
          ) : null}
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
          {feedbackIcon ? (
            <Ionicons
              name={feedbackIcon.name}
              size={14}
              color={feedbackIcon.color}
            />
          ) : null}
        </View>
      </Pressable>
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
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<MessageWithSeparator> | null>(null);
  const openedMessageSwipeableRef = useRef<Swipeable | null>(null);
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
  const mediaPickerActiveRef = useRef(false);
  const documentPickerActiveRef = useRef(false);
  const videoTrimSessionRef = useRef<{
    settled: boolean;
    resolve: (result: VideoTrimSessionResult) => void;
  } | null>(null);
  const videoEditorOpeningStartedAtRef = useRef<number | null>(null);
  const videoEditorOpeningHideTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const pendingVideoUploadsRef = useRef<Map<string, PendingVideoUploadDraft>>(
    new Map()
  );
  const sendPendingVideoDraftRef = useRef<
    | ((
        draft: PendingVideoUploadDraft,
        options?: { isRetry?: boolean }
      ) => Promise<boolean>)
    | null
  >(null);
  const uploadingVideoHashesRef = useRef<Set<string>>(new Set());
  const quickMessageSearchRequestRef = useRef(0);
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
  const [
    isCurrentUserMasterOrAdministrator,
    setIsCurrentUserMasterOrAdministrator,
  ] = useState(false);
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
  const [attendantsInfoVisible, setAttendantsInfoVisible] = useState(false);
  const [attendantsInfoLoading, setAttendantsInfoLoading] = useState(false);
  const [attendantsInfo, setAttendantsInfo] =
    useState<ViewChatAttendantsResponse | null>(null);
  const [closeServiceModalVisible, setCloseServiceModalVisible] =
    useState(false);
  const [
    closeServiceSendMessageOnFinishAttendance,
    setCloseServiceSendMessageOnFinishAttendance,
  ] = useState(true);
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
  const [transferKeepInChat, setTransferKeepInChat] = useState(false);
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
  const [isLeavingConversation, setIsLeavingConversation] = useState(false);
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
  const imageGalleryLookup = useMemo(
    () => buildImageGalleryLookup(messages),
    [messages]
  );
  const [messageActionTarget, setMessageActionTarget] =
    useState<ListMessageResult | null>(null);
  const [messageOverlayAnchor, setMessageOverlayAnchor] =
    useState<MessageOverlayAnchor | null>(null);
  const [reactionPickerVisible, setReactionPickerVisible] = useState(false);
  const [reactionCategory, setReactionCategory] =
    useState<ReactionCategoryKey>('recent');
  const [reactionSearch, setReactionSearch] = useState('');
  const [recentReactionEmojis, setRecentReactionEmojis] = useState<string[]>(
    []
  );
  const [composerEmojiPickerVisible, setComposerEmojiPickerVisible] =
    useState(false);
  const [composerEmojiCategory, setComposerEmojiCategory] =
    useState<ReactionCategoryKey>('recent');
  const [composerEmojiSearch, setComposerEmojiSearch] = useState('');
  const [replyMessageTarget, setReplyMessageTarget] =
    useState<ListMessageResult | null>(null);
  const [editingMessageTarget, setEditingMessageTarget] =
    useState<ListMessageResult | null>(null);
  const [editingMessageText, setEditingMessageText] = useState('');
  const [savingEditedMessage, setSavingEditedMessage] = useState(false);
  const [viewingEditHistoryMessage, setViewingEditHistoryMessage] =
    useState<ListMessageResult | null>(null);
  const [forwardModalVisible, setForwardModalVisible] = useState(false);
  const [forwardSourceMessage, setForwardSourceMessage] =
    useState<ListMessageResult | null>(null);
  const [aiReplyTarget, setAiReplyTarget] = useState<ListMessageResult | null>(
    null
  );
  const [aiReplyResponseType, setAiReplyResponseType] = useState<
    'text' | 'audio'
  >('text');
  const [aiReplyInstructions, setAiReplyInstructions] = useState('');
  const [aiReplyGenerating, setAiReplyGenerating] = useState(false);
  const [aiReplyResult, setAiReplyResult] = useState<{
    text: string;
    audio_url?: string | null;
    audio_duration?: number | null;
  } | null>(null);
  const [aiReplyError, setAiReplyError] = useState(false);
  const [transcribeTarget, setTranscribeTarget] =
    useState<ListMessageResult | null>(null);
  const [transcribeResult, setTranscribeResult] = useState<string | null>(null);
  const [transcribeCached, setTranscribeCached] = useState(false);
  const [transcribeLoading, setTranscribeLoading] = useState(false);
  const [transcribeError, setTranscribeError] = useState(false);

  const [forwardStatus, setForwardStatus] =
    useState<ForwardStatusType>('in_chat');
  const [forwardSearch, setForwardSearch] = useState('');
  const [forwardPickerKind, setForwardPickerKind] =
    useState<ForwardPickerKind>(null);
  const [forwardChannels, setForwardChannels] = useState<
    TransferChannelOption[]
  >([]);
  const [selectedForwardChannelId, setSelectedForwardChannelId] = useState<
    string | null
  >(null);
  const [forwardChannelsLoading, setForwardChannelsLoading] = useState(false);
  const [forwardItems, setForwardItems] = useState<ForwardTargetItem[]>([]);
  const [forwardSelectedIds, setForwardSelectedIds] = useState<string[]>([]);
  const [forwardCurrentPage, setForwardCurrentPage] = useState(1);
  const [forwardTotalPages, setForwardTotalPages] = useState(1);
  const [forwardLoading, setForwardLoading] = useState(false);
  const [forwardLoadingMore, setForwardLoadingMore] = useState(false);
  const [forwardSubmitting, setForwardSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [input, setInput] = useState('');
  const [showQuickMessageList, setShowQuickMessageList] = useState(false);
  const [quickMessageTemplates, setQuickMessageTemplates] = useState<
    QuickMessageTemplate[]
  >([]);
  const [quickMessageLoading, setQuickMessageLoading] = useState(false);
  const [selectedQuickMessage, setSelectedQuickMessage] =
    useState<QuickMessageTemplate | null>(null);
  const [quickMessageInputDirty, setQuickMessageInputDirty] = useState(false);
  const [sendingQuickMessage, setSendingQuickMessage] = useState(false);
  const [sending, setSending] = useState(false);
  const [viewer, setViewer] = useState<MediaViewerState>({
    visible: false,
    kind: 'image',
    src: '',
    caption: '',
    downloadName: '',
    items: [],
    activeIndex: 0,
  });
  const viewerImageScrollRef = useRef<ScrollView | null>(null);
  const viewerTranslateY = useRef(new Animated.Value(0)).current;
  const [viewerMediaWidth, setViewerMediaWidth] = useState(1);
  const [cameraPickerVisible, setCameraPickerVisible] = useState(false);
  const [isOpeningVideoEditor, setIsOpeningVideoEditor] = useState(false);
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
  const [contactFormVisible, setContactFormVisible] = useState(false);
  const [contactFormMode, setContactFormMode] = useState<'create' | 'edit'>(
    'create'
  );
  const [contactFormContactId, setContactFormContactId] = useState<
    string | null
  >(null);
  const [contactFormInitialValues, setContactFormInitialValues] =
    useState<ContactFormInitialValues | null>(null);
  const [messageContactsSheetVisible, setMessageContactsSheetVisible] =
    useState(false);
  const [messageContactsSheetItems, setMessageContactsSheetItems] = useState<
    MessageContentContact[]
  >([]);
  const [locationPickerVisible, setLocationPickerVisible] = useState(false);
  const [locationLatitudeInput, setLocationLatitudeInput] = useState('');
  const [locationLongitudeInput, setLocationLongitudeInput] = useState('');
  const [locationNameInput, setLocationNameInput] = useState('');
  const [locationAddressInput, setLocationAddressInput] = useState('');
  const [locationSearchInput, setLocationSearchInput] = useState('');
  const [locationSearchLoading, setLocationSearchLoading] = useState(false);
  const [locationSearchResults, setLocationSearchResults] = useState<
    LocationSearchResult[]
  >([]);
  const [locationCurrentAccuracy, setLocationCurrentAccuracy] = useState<
    number | null
  >(null);
  const [locationMapRegion, setLocationMapRegion] =
    useState<LocationMapRegion | null>(null);
  const [locationMapStatus, setLocationMapStatus] =
    useState<LocationMapStatus>('idle');
  const [locationMapErrorMessage, setLocationMapErrorMessage] = useState<
    string | null
  >(null);
  const [locationMapStyleUrl, setLocationMapStyleUrl] =
    useState(mapLibreStyleUrl);
  const [locationMapUsedDefaultFallback, setLocationMapUsedDefaultFallback] =
    useState(false);
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
  const replyComposerPreview = useMemo(() => {
    if (!replyMessageTarget) return null;
    return buildReplyComposerPreviewModel(
      replyMessageTarget,
      chatInfo,
      currentUserName
    );
  }, [chatInfo, currentUserName, replyMessageTarget]);
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
    quickMessageSearchRequestRef.current += 1;
    setShowQuickMessageList(false);
    setQuickMessageTemplates([]);
    setQuickMessageLoading(false);
    setSelectedQuickMessage(null);
    setQuickMessageInputDirty(false);
    setInput('');
    setSendingQuickMessage(false);
    setAttendantsInfoVisible(false);
    setAttendantsInfoLoading(false);
    setAttendantsInfo(null);
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
      setIsCurrentUserMasterOrAdministrator(isMasterOrAdministratorUser(user));
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
    setContactFormVisible(false);
    setContactFormContactId(null);
    setContactFormInitialValues(null);
    setMessageContactsSheetVisible(false);
    setMessageContactsSheetItems([]);
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
    if (
      Platform.OS !== 'android' ||
      !viewer.visible ||
      viewer.kind !== 'video' ||
      !viewer.src
    ) {
      return;
    }

    const subscription = (
      viewerVideoPlayer as unknown as {
        addListener?: (
          event: string,
          listener: (status: unknown) => void
        ) => { remove?: () => void } | void;
      }
    ).addListener?.('playbackStatusUpdate', (status) => {
      if (!status || typeof status !== 'object') {
        return;
      }

      const statusRecord = status as {
        error?: unknown;
        isLoaded?: unknown;
      };

      if (statusRecord.error) {
        console.warn('[VideoViewer][Android] playback error', {
          src: viewer.src,
          error: statusRecord.error,
        });
      }

      if (statusRecord.isLoaded === false) {
        console.warn('[VideoViewer][Android] media not loaded', {
          src: viewer.src,
        });
      }
    });

    return () => {
      if (subscription && typeof subscription === 'object') {
        subscription.remove?.();
      }
    };
  }, [viewer.kind, viewer.src, viewer.visible, viewerVideoPlayer]);

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

  const openImageViewerFromItems = useCallback(
    (items: ViewerMediaItem[], initialIndex = 0) => {
      if (items.length === 0) return;
      const safeIndex = Math.max(0, Math.min(initialIndex, items.length - 1));
      const activeItem = items[safeIndex];

      viewerTranslateY.stopAnimation();
      viewerTranslateY.setValue(0);

      setViewer({
        visible: true,
        kind: 'image',
        src: activeItem.src,
        caption: activeItem.caption,
        downloadName: activeItem.downloadName,
        items,
        activeIndex: safeIndex,
      });
      setDownloadingViewerMedia(false);
    },
    [viewerTranslateY]
  );

  const setActiveViewerIndex = useCallback((index: number) => {
    setViewer((previous) => {
      if (previous.kind !== 'image') return previous;
      const items = previous.items;
      if (items.length === 0) return previous;

      const safeIndex = Math.max(0, Math.min(index, items.length - 1));
      if (safeIndex === previous.activeIndex) {
        return previous;
      }

      const activeItem = items[safeIndex];
      return {
        ...previous,
        activeIndex: safeIndex,
        src: activeItem.src,
        caption: activeItem.caption,
        downloadName: activeItem.downloadName,
      };
    });
  }, []);

  const closeMediaViewer = useCallback(() => {
    viewerTranslateY.stopAnimation();
    viewerTranslateY.setValue(0);

    setViewer({
      visible: false,
      kind: 'image',
      src: '',
      caption: '',
      downloadName: '',
      items: [],
      activeIndex: 0,
    });
    setDownloadingViewerMedia(false);
  }, [viewerTranslateY]);

  const resetViewerSwipeOffset = useCallback(() => {
    Animated.timing(viewerTranslateY, {
      toValue: 0,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [viewerTranslateY]);

  const handleViewerPanGestureEvent = useCallback(
    (event: {
      nativeEvent: {
        translationX: number;
        translationY: number;
      };
    }) => {
      if (!viewer.visible) return;
      const { translationX, translationY } = event.nativeEvent;
      if (Math.abs(translationX) > Math.abs(translationY)) {
        viewerTranslateY.setValue(0);
        return;
      }
      const nextY = Math.max(0, translationY);
      viewerTranslateY.setValue(nextY);
    },
    [viewer.visible, viewerTranslateY]
  );

  const handleViewerPanStateChange = useCallback(
    (event: {
      nativeEvent: {
        state: number;
        oldState: number;
        translationX: number;
        translationY: number;
        velocityY: number;
      };
    }) => {
      if (!viewer.visible) return;

      const { state, oldState, translationX, translationY, velocityY } =
        event.nativeEvent;

      if (state === State.CANCELLED || state === State.FAILED) {
        resetViewerSwipeOffset();
        return;
      }

      if (oldState !== State.ACTIVE) {
        return;
      }

      if (Math.abs(translationX) > Math.abs(translationY)) {
        resetViewerSwipeOffset();
        return;
      }

      const shouldClose =
        translationY >= VIEWER_SWIPE_CLOSE_DISTANCE ||
        velocityY >= VIEWER_SWIPE_CLOSE_VELOCITY;

      if (shouldClose) {
        closeMediaViewer();
        return;
      }

      resetViewerSwipeOffset();
    },
    [closeMediaViewer, resetViewerSwipeOffset, viewer.visible]
  );

  const openImageViewer = useCallback(
    (msg: ListMessageResult, galleryIndex = 0) => {
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
        openImageViewerFromItems([
          {
            src: stickerSrc,
            caption: '',
            downloadName: resolveStickerDownloadName(msg),
          },
        ]);
        return;
      }

      const galleryMembership =
        imageGalleryLookup.membershipByMessageId[msg.message_id];
      if (galleryMembership) {
        const group = imageGalleryLookup.groupsById[galleryMembership.groupId];
        if (group?.items.length) {
          openImageViewerFromItems(
            group.items.map((item) => ({
              src: item.src,
              caption: item.caption,
              downloadName: item.downloadName,
            })),
            galleryIndex
          );
          return;
        }
      }

      const imageUrl = msg.content?.image?.url;
      if (!imageUrl) return;
      const imageSrc = resolveMediaUri(imageUrl);
      if (!imageSrc) return;

      openImageViewerFromItems([
        {
          src: imageSrc,
          caption: msg.content?.image?.caption ?? '',
          downloadName: resolveImageDownloadName(msg, imageSrc),
        },
      ]);
    },
    [imageGalleryLookup, openImageViewerFromItems]
  );

  const openVideoViewer = useCallback(
    (msg: ListMessageResult) => {
      const video = msg.content?.video;
      if (!video?.url) return;
      const videoSrc = resolveMediaUri(video.url);
      if (!videoSrc) return;

      viewerTranslateY.stopAnimation();
      viewerTranslateY.setValue(0);

      setViewer({
        visible: true,
        kind: 'video',
        src: videoSrc,
        caption: video.caption ?? msg.content?.message ?? '',
        downloadName: resolveVideoDownloadName(video),
        items: [
          {
            src: videoSrc,
            caption: video.caption ?? msg.content?.message ?? '',
            downloadName: resolveVideoDownloadName(video),
          },
        ],
        activeIndex: 0,
      });
    },
    [viewerTranslateY]
  );

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

  const openContactFormFromMessageContact = useCallback(
    async (contact: MessageContentContact) => {
      dismissKeyboard();

      const fallbackPhoneDdi =
        readNonEmptyString(contact.phone_ddi) ??
        readNonEmptyString(chatInfo.contact?.phone_ddi) ??
        '55';
      const initialValues = buildContactFormInitialValues(
        contact,
        fallbackPhoneDdi
      );

      let lookup: ChatContactLookupResult | null = null;
      const payloadContactId = readNonEmptyString(contact.contact_id);
      if (payloadContactId) {
        try {
          lookup = await getChatContactById(payloadContactId);
        } catch {}
      }

      if (!lookup) {
        const normalizedPhone = normalizePhoneDigits(
          contact.phone ?? contact.phone_partial
        );
        if (normalizedPhone.length >= 8) {
          try {
            lookup = await getChatContactByPhone(
              normalizedPhone,
              fallbackPhoneDdi
            );
          } catch {}
        }
      }

      if (lookup?.contact_id) {
        setContactFormMode('edit');
        setContactFormContactId(lookup.contact_id);
        setContactFormInitialValues(null);
      } else {
        setContactFormMode('create');
        setContactFormContactId(null);
        setContactFormInitialValues(initialValues);
      }

      setContactFormVisible(true);
    },
    [chatInfo.contact?.phone_ddi]
  );

  const handlePressChatHeaderContact = useCallback(() => {
    dismissKeyboard();

    const contactId = readNonEmptyString(chatInfo.contact?.id);
    if (contactId) {
      setContactFormMode('edit');
      setContactFormContactId(contactId);
      setContactFormInitialValues(null);
      setContactFormVisible(true);
      return;
    }

    const resolvedName =
      readNonEmptyString(chatInfo.contact?.name) ??
      readNonEmptyString(chatInfo.name) ??
      '';
    const resolvedPhoneDdi =
      readNonEmptyString(chatInfo.contact?.phone_ddi) ?? '55';
    const resolvedPhone = normalizePhoneDigits(
      chatInfo.contact?.phone ?? chatInfo.phone
    );

    setContactFormMode('create');
    setContactFormContactId(null);
    setContactFormInitialValues({
      name: resolvedName,
      lastName: '',
      phoneDdi: resolvedPhoneDdi,
      phone: resolvedPhone,
    });
    setContactFormVisible(true);
  }, [
    chatInfo.contact?.id,
    chatInfo.contact?.name,
    chatInfo.contact?.phone,
    chatInfo.contact?.phone_ddi,
    chatInfo.name,
    chatInfo.phone,
  ]);

  const handlePressMessageContactCard = useCallback(
    (_message: ListMessageResult, contact: MessageContentContact) => {
      void openContactFormFromMessageContact(contact);
    },
    [openContactFormFromMessageContact]
  );

  const handlePressMessageContactsGroup = useCallback(
    (_message: ListMessageResult, contacts: MessageContentContact[]) => {
      if (!Array.isArray(contacts) || contacts.length === 0) return;

      if (contacts.length === 1) {
        void openContactFormFromMessageContact(contacts[0]);
        return;
      }

      dismissKeyboard();
      setMessageContactsSheetItems(contacts);
      setMessageContactsSheetVisible(true);
    },
    [openContactFormFromMessageContact]
  );

  const handleSelectMessageGroupContact = useCallback(
    (contact: MessageContentContact) => {
      setMessageContactsSheetVisible(false);
      setMessageContactsSheetItems([]);
      void openContactFormFromMessageContact(contact);
    },
    [openContactFormFromMessageContact]
  );

  const handleCloseContactForm = useCallback(() => {
    setContactFormVisible(false);
    setContactFormContactId(null);
    setContactFormInitialValues(null);
  }, []);

  const handleContactFormSuccess = useCallback(() => {
    setContactFormVisible(false);
    setContactFormContactId(null);
    setContactFormInitialValues(null);
    resolvedContactLookupDone.current.clear();
    resolvingContactCards.current.clear();
    setResolvedContactCards({});

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
    const activeViewerItem = viewer.items[viewer.activeIndex] ?? null;
    const viewerSrc = activeViewerItem?.src || viewer.src;
    const viewerDownloadName =
      activeViewerItem?.downloadName || viewer.downloadName;

    if (!viewerSrc || downloadingViewerMedia) return;

    setDownloadingViewerMedia(true);
    try {
      const defaultName =
        viewer.kind === 'video'
          ? `video-${Date.now()}.mp4`
          : `imagem-${Date.now()}.jpg`;
      const fileName = viewerDownloadName || defaultName;
      await forceDownloadToDevice(viewerSrc, fileName, viewer.kind);
    } catch {
    } finally {
      setDownloadingViewerMedia(false);
    }
  }, [
    downloadingViewerMedia,
    viewer.activeIndex,
    viewer.downloadName,
    viewer.items,
    viewer.kind,
    viewer.src,
  ]);

  const canGoToPreviousViewerImage =
    viewer.kind === 'image' && viewer.activeIndex > 0;
  const canGoToNextViewerImage =
    viewer.kind === 'image' && viewer.activeIndex < viewer.items.length - 1;

  const goToPreviousViewerImage = useCallback(() => {
    if (!canGoToPreviousViewerImage) return;
    setActiveViewerIndex(viewer.activeIndex - 1);
  }, [canGoToPreviousViewerImage, setActiveViewerIndex, viewer.activeIndex]);

  const goToNextViewerImage = useCallback(() => {
    if (!canGoToNextViewerImage) return;
    setActiveViewerIndex(viewer.activeIndex + 1);
  }, [canGoToNextViewerImage, setActiveViewerIndex, viewer.activeIndex]);

  useEffect(() => {
    if (
      !viewer.visible ||
      viewer.kind !== 'image' ||
      viewer.items.length <= 1
    ) {
      return;
    }

    requestAnimationFrame(() => {
      viewerImageScrollRef.current?.scrollTo({
        x: viewer.activeIndex * viewerMediaWidth,
        y: 0,
        animated: false,
      });
    });
  }, [
    viewer.activeIndex,
    viewer.items.length,
    viewer.kind,
    viewer.visible,
    viewerMediaWidth,
  ]);

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
      const galleryMembership =
        imageGalleryLookup.membershipByMessageId[message.message_id];
      if (galleryMembership && !galleryMembership.isHead) {
        continue;
      }

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
  }, [imageGalleryLookup.membershipByMessageId, messages]);

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
    if (chatInfo.status !== 'in_chat') return;
    if (!isChatParticipant(chatInfo, currentUserId)) return;
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
  }, [loading, chatInfo, currentUserId]);

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

        if (Array.isArray(incoming.secondary_users)) {
          next.secondary_users = incoming.secondary_users as NonNullable<
            typeof prev.secondary_users
          >;
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
          isChatParticipant(next, currentUserId) &&
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
      const payloadSecondaryUserIds = Array.isArray(payloadAny.secondary_users)
        ? payloadAny.secondary_users
            .map((secondaryUser) => resolveUserId(secondaryUser))
            .filter(
              (secondaryUserId): secondaryUserId is string => !!secondaryUserId
            )
        : [];
      const isPayloadParticipant =
        !!currentUserId &&
        ((!!payloadUserId && payloadUserId === currentUserId) ||
          payloadSecondaryUserIds.includes(currentUserId));

      if (isActive && isPayloadParticipant) {
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

  useEffect(() => {
    return addAppResumeListener(() => {
      if (!isFocused) return;
      void loadMessages();
      void syncMessagesStatus(true);
    });
  }, [isFocused, loadMessages, syncMessagesStatus]);

  useFocusEffect(
    useCallback(() => {
      void syncGlobalChatCounts(setChatCounts);
    }, [setChatCounts])
  );

  const isInChatStatus = chatInfo.status === 'in_chat';
  const isCurrentUserParticipantInChat = isChatParticipant(
    chatInfo,
    currentUserId
  );
  const isCurrentUserPrimaryInChat = isChatPrimary(chatInfo, currentUserId);
  const isCurrentUserSecondaryInChat = isChatSecondary(chatInfo, currentUserId);
  const hasManageInChatLifecyclePermission =
    canManageInChatLifecyclePermission(permissionList);
  const canManageInChatLifecycle =
    isCurrentUserPrimaryInChat ||
    isCurrentUserMasterOrAdministrator ||
    hasManageInChatLifecyclePermission;
  const canComposeInChat =
    !isHistoryReadonly && isInChatStatus && isCurrentUserParticipantInChat;
  const canJoinConversationAction =
    !isHistoryReadonly && isInChatStatus && !isCurrentUserParticipantInChat;
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
    !isHistoryReadonly &&
    (isQueueOrUraStatus || isClosedStatus || canJoinConversationAction);
  const attendReopenBannerMessage = canJoinConversationAction
    ? pt.must_join_conversation_to_reply
    : isClosedStatus
      ? pt.chat_closed_message
      : pt.chat_queue_message;
  const attendReopenButtonLabel = canJoinConversationAction
    ? pt.join_conversation
    : isClosedStatus
      ? pt.reopen
      : pt.attend;
  const isAttendReopenActionAllowed = canJoinConversationAction
    ? true
    : isClosedStatus
      ? canReopenChatAction
      : canAttendChatAction;
  const attendReopenBlockedReason = (() => {
    if (!showAttendReopenBanner || isAttendReopenActionAllowed) return null;
    if (canJoinConversationAction) return null;
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
    ((isInChatStatus && canManageInChatLifecycle) ||
      (isQueueOrUraStatus && canCloseChatWithoutAttending(permissionList)));
  const canDisableSendMessageOnFinishAttendanceAction =
    canDisableSendMessageOnFinishAttendance(permissionList);
  const canViewChatAttendantsInfoAction =
    canViewChatAttendantsInfoPermission(permissionList);
  const shouldShowCloseServiceSendMessageToggle =
    workerConfigForChat?.send_message_on_finish_attendance_enabled === true &&
    canDisableSendMessageOnFinishAttendanceAction;
  const canTransferAction =
    !isHistoryReadonly && isInChatStatus && canManageInChatLifecycle;
  const canLeaveConversationAction =
    !isHistoryReadonly &&
    isInChatStatus &&
    isCurrentUserSecondaryInChat &&
    !isCurrentUserPrimaryInChat;
  const canLabelAction =
    !isHistoryReadonly && isInChatStatus && isCurrentUserParticipantInChat;
  const canToggleForwardToOutputAction =
    !isHistoryReadonly &&
    (isInChatStatus || isQueueOrUraStatus) &&
    workerConfigForChat?.has_ura_output === true &&
    canToggleForwardToOutputChatbot(permissionList);
  const isForwardToOutputActive = chatInfo.forward_to_output_chatbot !== false;
  const attendantsPrimaryUser = attendantsInfo?.primary_user ?? null;
  const attendantsSecondaryUsers = Array.isArray(
    attendantsInfo?.secondary_users
  )
    ? attendantsInfo.secondary_users
    : [];

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

    if (isInChatStatus && !canManageInChatLifecycle) {
      Alert.alert(pt.warning_title, pt.only_primary_can_close);
      return;
    }

    const result = await updateChatStatusDetailed(
      chatId,
      'closed',
      shouldShowCloseServiceSendMessageToggle
        ? {
            send_message_on_finish_attendance:
              closeServiceSendMessageOnFinishAttendance,
          }
        : undefined
    );
    if (!result.ok) {
      Alert.alert(
        pt.error_title,
        result.message ?? pt.chat_status_update_error
      );
      return;
    }

    setCloseServiceModalVisible(false);
    Alert.alert(pt.success_title, pt.close_service_success);
    navigation.goBack();
  }, [
    chatInfo.chat_id,
    closeServiceSendMessageOnFinishAttendance,
    canManageInChatLifecycle,
    isInChatStatus,
    navigation,
    shouldShowCloseServiceSendMessageToggle,
  ]);

  const handleCloseService = useCallback(() => {
    setCloseServiceSendMessageOnFinishAttendance(true);
    setCloseServiceModalVisible(true);
  }, []);

  const confirmLeaveConversation = useCallback(async () => {
    const chatId = readNonEmptyString(chatInfo.chat_id);
    if (!chatId || isLeavingConversation) return;

    if (
      !isInChatStatus ||
      !isCurrentUserSecondaryInChat ||
      isCurrentUserPrimaryInChat
    ) {
      Alert.alert(pt.warning_title, pt.only_secondary_can_leave);
      return;
    }

    setIsLeavingConversation(true);
    const leaveResult = await leaveChat(chatId);
    setIsLeavingConversation(false);

    if (!leaveResult.ok) {
      Alert.alert(
        pt.error_title,
        leaveResult.message ?? pt.leave_conversation_error
      );
      return;
    }

    if (leaveResult.chat) {
      setChatInfo((prev) => ({
        ...prev,
        ...leaveResult.chat,
      }));
    }

    await syncGlobalChatCounts(setChatCounts);
    Alert.alert(pt.success_title, pt.leave_conversation_success);
    navigation.goBack();
  }, [
    chatInfo.chat_id,
    isInChatStatus,
    isCurrentUserSecondaryInChat,
    isCurrentUserPrimaryInChat,
    isLeavingConversation,
    navigation,
    setChatCounts,
  ]);

  const handleLeaveConversation = useCallback(() => {
    Alert.alert(pt.leave_conversation, pt.leave_conversation_confirmation, [
      {
        text: pt.cancel,
        style: 'cancel',
      },
      {
        text: pt.leave_conversation,
        style: 'destructive',
        onPress: () => {
          void confirmLeaveConversation();
        },
      },
    ]);
  }, [confirmLeaveConversation]);

  const openAttendantsInfo = useCallback(async () => {
    const chatId = readNonEmptyString(chatInfo.chat_id);
    if (!chatId || attendantsInfoLoading) return;

    setAttendantsInfoLoading(true);
    const response = await viewChatAttendants(chatId);
    setAttendantsInfoLoading(false);

    if (!response) {
      Alert.alert(pt.error_title, pt.attendants_info_error);
      return;
    }

    setAttendantsInfo(response);
    setAttendantsInfoVisible(true);
  }, [attendantsInfoLoading, chatInfo.chat_id]);

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

    if (canJoinConversationAction) {
      setIsAttendReopenLoading(true);
      const joinResult = await joinChat(chatId);
      setIsAttendReopenLoading(false);

      if (!joinResult.ok || !joinResult.chat) {
        Alert.alert(pt.error_title, pt.join_conversation_error);
        return;
      }

      const updatedChat: ListChatsResult = {
        ...chatInfo,
        ...joinResult.chat,
      };

      setChatInfo(updatedChat);
      await syncGlobalChatCounts(setChatCounts);
      Alert.alert(pt.success_title, pt.join_conversation_success);
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

    await syncGlobalChatCounts(setChatCounts);

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
    canJoinConversationAction,
    chatInfo.chat_id,
    chatInfo,
    clearAdvancedFilters,
    isAttendReopenActionAllowed,
    isAttendReopenLoading,
    isClosedStatus,
    navigation,
    setChatCounts,
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

      try {
        const response = await searchMessages(chatId, query, page, 50);
        if (reset) {
          setSearchResults(response.results);
        } else {
          setSearchResults((prev) => [...prev, ...response.results]);
        }
        setSearchCurrentPage(response.pagings.current_page);
        setSearchTotalPages(response.pagings.total_pages);
      } catch {
      } finally {
        if (reset) {
          setSearchLoading(false);
        } else {
          setSearchLoadingMore(false);
        }
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
        setAttendanceHistoryLoading(false);
        setAttendanceHistoryLoadingMore(false);
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

      try {
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
        }

        if (reset) {
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
      } catch {
        if (reset && !attendanceHistoryErrorAlertShownRef.current) {
          attendanceHistoryErrorAlertShownRef.current = true;
          Alert.alert(pt.error_title, pt.attendance_history_load_error);
        }
      } finally {
        if (reset) {
          setAttendanceHistoryLoading(false);
        } else {
          setAttendanceHistoryLoadingMore(false);
        }
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
  const selectedForwardChannel = useMemo(
    () =>
      forwardChannels.find((item) => item.value === selectedForwardChannelId) ??
      null,
    [forwardChannels, selectedForwardChannelId]
  );

  useEffect(() => {
    if (!transferModalVisible) {
      setTransferType(null);
      setTransferAnnotation('');
      setTransferKeepInChat(false);
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

    setTransferKeepInChat(false);

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
        setTransferUsers(
          users.filter((user) => user.id !== (chatInfo.user?.id ?? null))
        );
      })
      .finally(() => {
        setIsLoadingTransferUsers(false);
      });
  }, [
    chatInfo.chat_id,
    chatInfo.user?.id,
    selectedTransferChannelId,
    transferModalVisible,
  ]);

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
        setTransferSectorUsers(
          users.filter((user) => user.id !== (chatInfo.user?.id ?? null))
        );
      })
      .finally(() => {
        setIsLoadingTransferSectorUsers(false);
      });
  }, [
    chatInfo.chat_id,
    chatInfo.user?.id,
    selectedTransferChannelId,
    selectedTransferSectorId,
    transferModalVisible,
  ]);

  const transferPickerItems = useMemo<SelectOption[]>(() => {
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

  const transferPickerTitle = useMemo(() => {
    if (transferPickerKind === 'channel') return pt.channel;
    if (transferPickerKind === 'type') return pt.transfer_to;
    if (transferPickerKind === 'user') return pt.transfer_type_user;
    if (transferPickerKind === 'sector') return pt.sector;
    if (transferPickerKind === 'sector_user') {
      return pt.transfer_sector_user_optional;
    }
    return pt.select_option;
  }, [transferPickerKind]);

  const selectedTransferPickerValue = useMemo(() => {
    if (transferPickerKind === 'channel') return selectedTransferChannelId;
    if (transferPickerKind === 'type') return transferType;
    if (transferPickerKind === 'user') return selectedTransferUserId;
    if (transferPickerKind === 'sector') return selectedTransferSectorId;
    if (transferPickerKind === 'sector_user')
      return selectedTransferSectorUserId;
    return null;
  }, [
    selectedTransferChannelId,
    selectedTransferSectorId,
    selectedTransferSectorUserId,
    selectedTransferUserId,
    transferPickerKind,
    transferType,
  ]);

  const forwardPickerOptions = useMemo<SelectOption[]>(
    () =>
      forwardChannels.map((item) => ({
        value: item.value,
        label: item.title,
      })),
    [forwardChannels]
  );

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

    if (!canManageInChatLifecycle) {
      Alert.alert(pt.warning_title, pt.only_primary_can_transfer);
      return;
    }

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

    const targetUserId =
      transferType === 'user'
        ? selectedTransferUserId
        : transferType === 'sector'
          ? selectedTransferSectorUserId
          : null;
    const currentPrimaryUserId = chatInfo.user?.id ?? null;
    if (
      targetUserId &&
      currentPrimaryUserId &&
      targetUserId === currentPrimaryUserId
    ) {
      Alert.alert(pt.warning_title, pt.cannot_transfer_to_current_primary);
      return;
    }

    const payload: TransferChatPayload = {
      worker_id: selectedTransferChannelId,
      user_id: targetUserId,
      sector_id: transferType === 'sector' ? selectedTransferSectorId : null,
      annotation: transferAnnotation.trim() || null,
      keep_in_chat: transferKeepInChat,
    };

    setIsTransferring(true);
    const transferResult = await transferChat(chatId, payload);
    setIsTransferring(false);
    if (!transferResult.ok) {
      Alert.alert(
        pt.error_title,
        transferResult.message ?? pt.chat_transfer_error
      );
      return;
    }

    Alert.alert(pt.success_title, pt.transfer_successfully);
    setTransferModalVisible(false);
    navigation.goBack();
  }, [
    chatInfo.chat_id,
    navigation,
    canManageInChatLifecycle,
    selectedTransferChannelId,
    selectedTransferSectorId,
    selectedTransferSectorUserId,
    selectedTransferUserId,
    transferAnnotation,
    transferKeepInChat,
    transferType,
  ]);

  const menuActions = useMemo<ChatMenuAction[]>(() => {
    const actions: ChatMenuAction[] = [];

    if (canViewChatAttendantsInfoAction) {
      actions.push({
        key: 'attendants_info',
        label: pt.attendants_info,
        icon: 'people-outline',
        onPress: () => {
          void openAttendantsInfo();
        },
      });
    }

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

    if (canLeaveConversationAction) {
      actions.push({
        key: 'leave_conversation',
        label: pt.leave_conversation,
        icon: 'exit-outline',
        danger: true,
        onPress: () => {
          handleLeaveConversation();
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
    canViewChatAttendantsInfoAction,
    canLabelAction,
    canShowCloseButton,
    canToggleForwardToOutputAction,
    canTransferAction,
    canLeaveConversationAction,
    canViewAttendanceHistoryAction,
    handleLeaveConversation,
    handleCloseService,
    handleToggleForwardToOutput,
    isForwardToOutputActive,
    openAttendantsInfo,
    openLabelModal,
    protocolList.length,
  ]);

  const handleCopyMessageContent = useCallback(
    async (message: ListMessageResult) => {
      const text =
        message.content?.message ||
        message.content?.link_preview?.['matched-text'] ||
        message.content?.link_preview?.['canonical-url'] ||
        '';
      if (!text) return;
      await Clipboard.setStringAsync(text);
    },
    []
  );

  const handleDownloadMessage = useCallback(
    async (message: ListMessageResult) => {
      const audioUrl = readNonEmptyString(message.content?.audio?.url);
      if (audioUrl && isDownloadableAudio(message)) {
        await forceDownloadToDevice(
          resolveMediaUri(audioUrl) ?? audioUrl,
          `audio-${message.message_id.slice(-8)}.${(message.content?.audio?.extension ?? 'mp3').replace(/^\./, '')}`,
          'document'
        );
        return;
      }

      const documentUrl = readNonEmptyString(message.content?.document?.url);
      if (documentUrl && isDownloadableDocument(message)) {
        await forceDownloadToDevice(
          resolveMediaUri(documentUrl) ?? documentUrl,
          resolveDocumentDownloadName(message.content?.document),
          'document'
        );
        return;
      }

      const videoUrl = readNonEmptyString(message.content?.video?.url);
      if (videoUrl && isDownloadableVideo(message)) {
        await forceDownloadToDevice(
          resolveMediaUri(videoUrl) ?? videoUrl,
          resolveVideoDownloadName(message.content?.video),
          'video'
        );
        return;
      }

      const stickerUrl = readNonEmptyString(message.content?.sticker?.url);
      if (stickerUrl && isDownloadableSticker(message)) {
        await forceDownloadToDevice(
          resolveMediaUri(stickerUrl) ?? stickerUrl,
          resolveStickerDownloadName(message),
          'document'
        );
        return;
      }

      const imageUrl = readNonEmptyString(message.content?.image?.url);
      if (imageUrl && isDownloadableImage(message)) {
        await forceDownloadToDevice(
          resolveMediaUri(imageUrl) ?? imageUrl,
          resolveImageDownloadName(message, imageUrl),
          'image'
        );
      }
    },
    []
  );

  const applyLocalReaction = useCallback(
    (messageId: string, emoji: string, userId: string, userName: string) => {
      setMessages((previous) =>
        previous.map((entry) => {
          if (entry.message_id !== messageId) return entry;
          const baseContent: MessageContent = {
            ...(entry.content ?? { type: EMessageType.text }),
          };
          const filtered = (baseContent.reactions ?? []).filter(
            (reaction) => reaction?.user_id !== userId
          );
          const nextReactions = emoji
            ? [
                ...filtered,
                {
                  emoji,
                  user_id: userId,
                  user_name: userName,
                },
              ]
            : filtered;
          return {
            ...entry,
            content: {
              ...baseContent,
              reactions: nextReactions.length > 0 ? nextReactions : null,
            },
          };
        })
      );
    },
    []
  );

  const closeForwardModal = useCallback(() => {
    setForwardModalVisible(false);
    setForwardPickerKind(null);
  }, []);

  const handleForwardRequestClose = useCallback(() => {
    dismissKeyboard();
    if (forwardPickerKind !== null) {
      setForwardPickerKind(null);
      return;
    }
    setForwardModalVisible(false);
  }, [forwardPickerKind]);

  const loadForwardTargets = useCallback(
    async (page: number, append: boolean) => {
      if (
        !forwardModalVisible ||
        !forwardSourceMessage ||
        !forwardStatus ||
        !selectedForwardChannelId
      ) {
        if (!append) {
          setForwardItems([]);
          setForwardCurrentPage(1);
          setForwardTotalPages(1);
        }
        return;
      }

      if (append) {
        setForwardLoadingMore(true);
      } else {
        setForwardLoading(true);
      }

      const search = forwardSearch.trim();
      const targetItems: ForwardTargetItem[] = [];

      try {
        if (forwardStatus === 'all') {
          const response = await listChatContacts(page, 20, search, {
            filter_is_valided: 'true',
            filter_channel_id: selectedForwardChannelId,
          });
          if (!response) {
            if (!append) {
              setForwardItems([]);
              setForwardCurrentPage(1);
              setForwardTotalPages(1);
            }
            return;
          }
          const currentContactId = readNonEmptyString(chatInfo.contact?.id);

          for (const contact of response.results ?? []) {
            if (!contact.contact_id) continue;
            if (currentContactId && contact.contact_id === currentContactId) {
              continue;
            }
            const fullName = [contact.name, contact.last_name]
              .filter(Boolean)
              .join(' ')
              .trim();
            const title = `${fullName || pt.contact} - ${contact.phone_partial || contact.contact_id}`;
            targetItems.push({
              value: contact.contact_id,
              title,
            });
          }

          setForwardCurrentPage(response.current_page ?? page);
          setForwardTotalPages(response.total_pages ?? 1);
        } else {
          const response = await searchChats({
            search,
            status: forwardStatus,
            current_page: page,
            per_page: 20,
            filter_worker_id: selectedForwardChannelId,
          });
          if (!response) {
            if (!append) {
              setForwardItems([]);
              setForwardCurrentPage(1);
              setForwardTotalPages(1);
            }
            return;
          }

          for (const chatItem of response.results ?? []) {
            if (!chatItem.chat_id || chatItem.chat_id === chatInfo.chat_id)
              continue;
            const title = `${chatItem.name ?? chatItem.contact?.name ?? pt.contact} - ${chatItem.phone || chatItem.chat_id}`;
            targetItems.push({
              value: chatItem.chat_id,
              title,
            });
          }

          setForwardCurrentPage(response.current_page ?? page);
          setForwardTotalPages(response.total_pages ?? 1);
        }

        if (!append) {
          setForwardItems(targetItems);
          return;
        }

        setForwardItems((previous) => {
          const map = new Map<string, ForwardTargetItem>();
          for (const item of previous) map.set(item.value, item);
          for (const item of targetItems) map.set(item.value, item);
          return Array.from(map.values());
        });
      } catch {
        if (!append) {
          setForwardItems([]);
          setForwardCurrentPage(1);
          setForwardTotalPages(1);
        }
      } finally {
        if (append) {
          setForwardLoadingMore(false);
        } else {
          setForwardLoading(false);
        }
      }
    },
    [
      chatInfo.chat_id,
      chatInfo.contact?.id,
      forwardModalVisible,
      forwardSearch,
      forwardSourceMessage,
      forwardStatus,
      selectedForwardChannelId,
    ]
  );

  useEffect(() => {
    if (!forwardModalVisible) {
      setForwardSourceMessage(null);
      setForwardStatus('in_chat');
      setForwardSearch('');
      setForwardItems([]);
      setForwardSelectedIds([]);
      setForwardCurrentPage(1);
      setForwardTotalPages(1);
      setForwardLoading(false);
      setForwardLoadingMore(false);
      setForwardSubmitting(false);
      setForwardChannels([]);
      setSelectedForwardChannelId(null);
      setForwardPickerKind(null);
      setForwardChannelsLoading(false);
      return;
    }

    let isActive = true;
    setForwardChannelsLoading(true);

    listTransferOptions()
      .then((options) => {
        if (!isActive) return;
        const workers = options?.workers ?? [];
        const channelItems: TransferChannelOption[] = workers.map((worker) => ({
          value: worker.id,
          title: worker.number
            ? `${worker.name} (${worker.number})`
            : worker.name,
          name: worker.name,
          number: worker.number,
        }));
        setForwardChannels(channelItems);
        if (channelItems.length === 0) {
          setSelectedForwardChannelId(null);
          return;
        }

        const currentWorkerId = readNonEmptyString(chatInfo.worker?.id);
        const preferredChannelId =
          (currentWorkerId &&
            channelItems.find((item) => item.value === currentWorkerId)
              ?.value) ??
          channelItems[0]?.value ??
          null;
        setSelectedForwardChannelId(preferredChannelId);
      })
      .finally(() => {
        if (!isActive) return;
        setForwardChannelsLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [chatInfo.worker?.id, forwardModalVisible]);

  useEffect(() => {
    if (!forwardModalVisible) return;

    setForwardSelectedIds([]);
    setForwardItems([]);
    setForwardCurrentPage(1);
    setForwardTotalPages(1);
  }, [forwardModalVisible, forwardStatus, selectedForwardChannelId]);

  useEffect(() => {
    if (!forwardModalVisible || !selectedForwardChannelId) return;
    const timer = setTimeout(() => {
      void loadForwardTargets(1, false);
    }, 300);
    return () => clearTimeout(timer);
  }, [
    forwardModalVisible,
    forwardSearch,
    forwardStatus,
    loadForwardTargets,
    selectedForwardChannelId,
  ]);

  useEffect(() => {
    const loadRecentReactions = async () => {
      try {
        const saved = await AsyncStorage.getItem(REACTION_RECENT_STORAGE_KEY);
        if (!saved) return;
        const parsed = JSON.parse(saved) as unknown;
        if (!Array.isArray(parsed)) return;
        const sanitized = parsed
          .filter((item): item is string => typeof item === 'string')
          .slice(0, 40);
        setRecentReactionEmojis(sanitized);
      } catch {}
    };

    void loadRecentReactions();
  }, []);

  useEffect(() => {
    void AsyncStorage.setItem(
      REACTION_RECENT_STORAGE_KEY,
      JSON.stringify(recentReactionEmojis.slice(0, 40))
    ).catch(() => {});
  }, [recentReactionEmojis]);

  const closeMessageOverlay = useCallback(() => {
    setMessageActionTarget(null);
    setMessageOverlayAnchor(null);
    setReactionPickerVisible(false);
    setReactionSearch('');
    setReactionCategory('recent');
  }, []);

  const closeOpenedMessageSwipeable = useCallback(() => {
    openedMessageSwipeableRef.current?.close();
    openedMessageSwipeableRef.current = null;
  }, []);

  const emojiEntriesSorted = useMemo(() => {
    return [...EMOJI_DATASET].sort((a, b) => {
      const orderA = typeof a.sort_order === 'number' ? a.sort_order : 999999;
      const orderB = typeof b.sort_order === 'number' ? b.sort_order : 999999;
      return orderA - orderB;
    });
  }, []);

  const reactionCategoryConfigs =
    REACTION_CATEGORY_DEFINITIONS as readonly ReactionCategoryConfig[];

  const reactionEmojisByCategory = useMemo(() => {
    if (reactionCategory === 'recent') {
      if (recentReactionEmojis.length > 0) {
        return recentReactionEmojis;
      }
      return [...QUICK_REACTIONS, ...REACTION_FALLBACK_EMOJIS].filter(
        (emoji, index, arr) => arr.indexOf(emoji) === index
      );
    }

    const categoryConfig = reactionCategoryConfigs.find(
      (cfg) => cfg.key === reactionCategory
    );
    if (!categoryConfig) return [];

    const available = emojiEntriesSorted
      .filter((entry) =>
        categoryConfig.sourceCategories.includes(entry.category ?? '')
      )
      .filter((entry) => matchesEmojiSearch(entry, reactionSearch))
      .map((entry) => normalizeEmojiDatasetEntry(entry))
      .filter((emoji): emoji is string => !!emoji);

    return available.filter(
      (emoji, index, arr) => arr.indexOf(emoji) === index
    );
  }, [
    emojiEntriesSorted,
    reactionCategory,
    reactionCategoryConfigs,
    reactionSearch,
    recentReactionEmojis,
  ]);

  const composerEmojisByCategory = useMemo(() => {
    if (composerEmojiCategory === 'recent') {
      if (recentReactionEmojis.length > 0) {
        return recentReactionEmojis;
      }
      return [...QUICK_REACTIONS, ...REACTION_FALLBACK_EMOJIS].filter(
        (emoji, index, arr) => arr.indexOf(emoji) === index
      );
    }

    const categoryConfig = reactionCategoryConfigs.find(
      (cfg) => cfg.key === composerEmojiCategory
    );
    if (!categoryConfig) return [];

    const available = emojiEntriesSorted
      .filter((entry) =>
        categoryConfig.sourceCategories.includes(entry.category ?? '')
      )
      .filter((entry) => matchesEmojiSearch(entry, composerEmojiSearch))
      .map((entry) => normalizeEmojiDatasetEntry(entry))
      .filter((emoji): emoji is string => !!emoji);

    return available.filter(
      (emoji, index, arr) => arr.indexOf(emoji) === index
    );
  }, [
    composerEmojiCategory,
    composerEmojiSearch,
    emojiEntriesSorted,
    reactionCategoryConfigs,
    recentReactionEmojis,
  ]);

  const handleQuickReaction = useCallback(
    async (emoji: string) => {
      const target = messageActionTarget;
      if (!target) return;

      const previousReactions = target.content?.reactions ?? null;
      const messageWorkerId = currentUserId ?? '';
      const messageWorkerName = currentUserName ?? '';

      closeMessageOverlay();
      setRecentReactionEmojis((previous) => {
        const next = [emoji, ...previous.filter((item) => item !== emoji)];
        return next.slice(0, 40);
      });
      applyLocalReaction(
        target.message_id,
        emoji,
        messageWorkerId,
        messageWorkerName
      );

      const ok = await reactToMessage(
        chatInfo.chat_id,
        target.message_id,
        emoji
      );
      if (ok) return;

      setMessages((previous) =>
        previous.map((entry) => {
          if (entry.message_id !== target.message_id) {
            return entry;
          }

          return {
            ...entry,
            content: {
              ...(entry.content ?? { type: EMessageType.text }),
              reactions: previousReactions,
            },
          };
        })
      );
      Alert.alert(pt.error_title, pt.chat_react_error);
    },
    [
      applyLocalReaction,
      chatInfo.chat_id,
      closeMessageOverlay,
      currentUserId,
      currentUserName,
      messageActionTarget,
    ]
  );

  const handleReplyFromMessage = useCallback(
    (message: ListMessageResult) => {
      if (!canComposeInChat || isHistoryReadonly || shouldObfuscateContent) {
        return;
      }
      if (!canInteractWithMessage(message)) return;

      closeOpenedMessageSwipeable();
      closeMessageOverlay();
      setComposerEmojiPickerVisible(false);
      setReplyMessageTarget(message);
      requestAnimationFrame(() => {
        messageInputRef.current?.focus();
      });
    },
    [
      canComposeInChat,
      closeMessageOverlay,
      closeOpenedMessageSwipeable,
      isHistoryReadonly,
      shouldObfuscateContent,
    ]
  );

  const handleRetryFailedVideoMessage = useCallback(
    async (message: ListMessageResult) => {
      if (
        !isRetryableFailedVideoMessage(message) ||
        sendingCapturedMedia ||
        sendingCapturedMediaRef.current
      ) {
        return;
      }

      const hash = readNonEmptyString(message.hash);
      if (!hash) return;

      const previousDraft = pendingVideoUploadsRef.current.get(hash);
      const fallbackUri = readNonEmptyString(message.content?.video?.url);
      const uri = normalizeLocalFileUri(
        previousDraft?.uri ?? fallbackUri ?? ''
      );
      if (!uri) {
        Alert.alert(pt.warning_title, pt.video_retry_source_missing);
        return;
      }

      const localFile = new File(uri);
      if (!localFile.exists) {
        Alert.alert(pt.warning_title, pt.video_retry_source_missing);
        return;
      }

      const fallbackName = resolveFileNameFromUri(
        uri,
        `video-${Date.now()}.mp4`
      );
      const fileName =
        previousDraft?.fileName ||
        readNonEmptyString(message.content?.video?.name) ||
        fallbackName;
      const extension = extractFileExtension(fileName);
      if (!VIDEO_ALLOWED_EXTENSIONS.has(extension)) {
        Alert.alert(pt.warning_title, pt.invalid_video_format);
        return;
      }

      const fileSize =
        previousDraft?.fileSize ??
        (typeof localFile.size === 'number' ? localFile.size : null);
      if (typeof fileSize === 'number' && fileSize > MAX_VIDEO_SIZE_BYTES) {
        Alert.alert(pt.warning_title, pt.video_size_exceeded);
        return;
      }
      const messageVideoDuration = message.content?.video?.duration;

      const draft: PendingVideoUploadDraft = {
        hash,
        uri,
        fileName,
        mimeType:
          previousDraft?.mimeType ||
          readNonEmptyString(message.content?.video?.mimetype) ||
          'video/mp4',
        durationSec:
          previousDraft?.durationSec ??
          (typeof messageVideoDuration === 'number' &&
          Number.isFinite(messageVideoDuration)
            ? Math.max(1, Math.round(messageVideoDuration))
            : null),
        fileSize: fileSize ?? null,
        replyMessageId:
          previousDraft?.replyMessageId ??
          readNonEmptyString(message.content?.message_quoted_id),
        localMessageId: message.message_id,
      };
      pendingVideoUploadsRef.current.set(hash, draft);

      const submitRetry = sendPendingVideoDraftRef.current;
      if (!submitRetry) return;
      await submitRetry(draft, { isRetry: true });
    },
    [sendingCapturedMedia]
  );

  const messageActions = useMemo<MessageAction[]>(() => {
    const target = messageActionTarget;
    if (!target) return [];

    const fromMe = target.type_user !== ETypeUserChat.client;
    const canViewEditHistory =
      hasMessageVersions(target) &&
      !isHistoryReadonly &&
      !shouldObfuscateContent &&
      target.content?.type !== EMessageType.annotation &&
      target.content?.type !== EMessageType.system;
    const canInteract =
      canInteractWithMessage(target) &&
      !isHistoryReadonly &&
      !shouldObfuscateContent;
    const canRetryFailedVideo =
      !isHistoryReadonly &&
      !shouldObfuscateContent &&
      isRetryableFailedVideoMessage(target);

    if (!canInteract && !canViewEditHistory && !canRetryFailedVideo) return [];

    const actions: MessageAction[] = [];

    if (canRetryFailedVideo) {
      actions.push({
        key: 'retry',
        label: pt.retry,
        icon: 'refresh-outline',
        onPress: () => {
          closeMessageOverlay();
          void handleRetryFailedVideoMessage(target);
        },
      });
    }

    if (canComposeInChat && canInteract) {
      actions.push({
        key: 'reply',
        label: pt.reply,
        icon: 'arrow-undo-outline',
        onPress: () => {
          handleReplyFromMessage(target);
        },
      });
    }

    if (canInteract && shouldShowCopyAction(target)) {
      actions.push({
        key: 'copy',
        label: pt.copy,
        icon: 'copy-outline',
        onPress: () => {
          void handleCopyMessageContent(target);
          closeMessageOverlay();
        },
      });
    }

    if (canInteract && shouldShowDownloadAction(target)) {
      actions.push({
        key: 'download',
        label: pt.download,
        icon: 'download-outline',
        onPress: () => {
          void handleDownloadMessage(target);
          closeMessageOverlay();
        },
      });
    }

    if (
      canInteract &&
      target.content?.type === EMessageType.audio &&
      target.content?.audio?.url
    ) {
      actions.push({
        key: 'transcribe',
        label: pt.chat_action_transcribe,
        icon: 'document-text-outline',
        onPress: () => {
          setTranscribeTarget(target);
          closeMessageOverlay();
        },
      });
    }

    if (canInteract) {
      actions.push({
        key: 'ai_reply',
        label: pt.chat_action_ai_reply,
        icon: 'sparkles-outline',
        onPress: () => {
          setAiReplyTarget(target);
          closeMessageOverlay();
        },
      });
    }

    if (canInteract && canForwardMessage(target)) {
      actions.push({
        key: 'forward',
        label: pt.forward,
        icon: 'arrow-redo-outline',
        onPress: () => {
          setForwardSourceMessage(target);
          setForwardModalVisible(true);
          closeMessageOverlay();
        },
      });
    }

    if (canInteract && canEditMessage(target, fromMe)) {
      actions.push({
        key: 'edit',
        label: pt.edit,
        icon: 'create-outline',
        onPress: () => {
          setEditingMessageTarget(target);
          setEditingMessageText(getLatestMessageText(target));
          closeMessageOverlay();
        },
      });
    }

    if (canViewEditHistory) {
      actions.push({
        key: 'view_edits',
        label: pt.chat_view_edits,
        icon: 'time-outline',
        onPress: () => {
          setViewingEditHistoryMessage(target);
          closeMessageOverlay();
        },
      });
    }

    if (canInteract && fromMe && target.content?.type !== EMessageType.system) {
      actions.push({
        key: 'delete',
        label: pt.delete,
        icon: 'trash-outline',
        danger: true,
        onPress: () => {
          closeMessageOverlay();

          const previousDeleted = target.deleted === true;
          setMessages((previous) =>
            previous.map((entry) =>
              entry.message_id === target.message_id
                ? { ...entry, deleted: true }
                : entry
            )
          );

          void (async () => {
            const ok = await deleteMessage(chatInfo.chat_id, target.message_id);
            if (ok) return;

            setMessages((previous) =>
              previous.map((entry) =>
                entry.message_id === target.message_id
                  ? { ...entry, deleted: previousDeleted }
                  : entry
              )
            );
            Alert.alert(pt.error_title, pt.chat_delete_error);
          })();
        },
      });
    }

    return actions;
  }, [
    canComposeInChat,
    chatInfo.chat_id,
    closeMessageOverlay,
    handleReplyFromMessage,
    handleRetryFailedVideoMessage,
    handleCopyMessageContent,
    handleDownloadMessage,
    isHistoryReadonly,
    messageActionTarget,
    shouldObfuscateContent,
  ]);

  const canOpenActionsForMessage = useCallback(
    (message: ListMessageResult): boolean => {
      if (isHistoryReadonly || shouldObfuscateContent) return false;

      if (
        hasMessageVersions(message) &&
        message.content?.type !== EMessageType.annotation &&
        message.content?.type !== EMessageType.system
      ) {
        return true;
      }

      if (isRetryableFailedVideoMessage(message)) {
        return true;
      }

      return canInteractWithMessage(message);
    },
    [isHistoryReadonly, shouldObfuscateContent]
  );

  const handleSubmitForward = useCallback(async () => {
    if (!forwardSourceMessage || forwardSelectedIds.length === 0) return;
    if (!selectedForwardChannelId) {
      Alert.alert(pt.warning_title, pt.channel_required);
      return;
    }

    let payload: MessageForwardPayload;
    if (forwardStatus === 'all') {
      payload = {
        target_contact_ids: forwardSelectedIds,
        worker_id: selectedForwardChannelId,
      };
    } else {
      payload = {
        target_chat_ids: forwardSelectedIds,
      };
    }

    setForwardSubmitting(true);
    const response = await forwardMessage(
      chatInfo.chat_id,
      forwardSourceMessage.message_id,
      payload
    );
    setForwardSubmitting(false);

    if (!response) {
      Alert.alert(pt.error_title, pt.chat_forward_error);
      return;
    }

    if (response.failed > 0 && response.sent > 0) {
      Alert.alert(
        pt.warning_title,
        pt.chat_forward_partial_success
          .replace('{sent}', String(response.sent))
          .replace('{failed}', String(response.failed))
      );
    } else if (response.sent > 0) {
      Alert.alert(pt.success_title, pt.chat_forward_success);
    } else {
      const firstFailureMessage =
        response.results.find((item) => item.status === 'failed')?.reason ??
        null;
      Alert.alert(pt.error_title, firstFailureMessage || pt.chat_forward_error);
    }

    closeForwardModal();
  }, [
    chatInfo.chat_id,
    closeForwardModal,
    forwardSelectedIds,
    forwardSourceMessage,
    forwardStatus,
    selectedForwardChannelId,
  ]);

  const handleSaveEditedMessage = useCallback(async () => {
    const target = editingMessageTarget;
    const editedText = editingMessageText.trim();
    if (!target || !editedText || savingEditedMessage) return;

    const previous = target;

    setMessages((entries) =>
      entries.map((entry) => {
        if (entry.message_id !== target.message_id) return entry;
        const previousVersions = entry.content?.version ?? [];
        return {
          ...entry,
          content: {
            ...(entry.content ?? { type: EMessageType.text }),
            version: [
              ...previousVersions,
              {
                type: entry.content?.type ?? EMessageType.text,
                message: editedText,
                date: new Date().toISOString(),
              },
            ],
          },
        };
      })
    );

    setSavingEditedMessage(true);
    const ok = await editMessage(
      chatInfo.chat_id,
      target.message_id,
      editedText
    );
    setSavingEditedMessage(false);

    if (!ok) {
      setMessages((entries) =>
        entries.map((entry) =>
          entry.message_id === previous.message_id ? previous : entry
        )
      );
      Alert.alert(pt.error_title, pt.chat_edit_error);
      return;
    }

    setEditingMessageTarget(null);
    setEditingMessageText('');
  }, [
    chatInfo.chat_id,
    editingMessageTarget,
    editingMessageText,
    savingEditedMessage,
  ]);

  const sendTextPayload = useCallback(
    async (
      rawText: string,
      options?: {
        quickMessageTemplateId?: string | null;
      }
    ) => {
      const text = rawText.trim();
      if (!text || sending || !canComposeInChat) return false;
      const replyMessageId = replyMessageTarget?.message_id;
      const firstUrl = extractFirstUrl(text);
      if (replyMessageId) {
        setReplyMessageTarget(null);
      }

      setSending(true);
      try {
        let linkPreviewPayload: MessageContentLinkPreview | null = null;
        if (firstUrl) {
          linkPreviewPayload = await generateLinkPreview(firstUrl);
        }

        const result = await createMessage(
          chatInfo.chat_id,
          EMessageType.text,
          text,
          replyMessageId,
          hasMeaningfulLinkPreview(linkPreviewPayload)
            ? linkPreviewPayload
            : undefined,
          options?.quickMessageTemplateId
        );
        if (!result.ok) {
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
      } finally {
        setSending(false);
      }
      return false;
    },
    [
      canComposeInChat,
      chatInfo.chat_id,
      replyMessageTarget?.message_id,
      sending,
      scrollToBottomWithRetries,
      syncLatestMessages,
    ]
  );

  const handleGenerateAiReply = useCallback(async () => {
    const target = aiReplyTarget;
    if (!target || aiReplyGenerating) return;

    setAiReplyGenerating(true);
    setAiReplyError(false);
    setAiReplyResult(null);

    const result = await generateAiReply(
      chatInfo.chat_id,
      target.message_id,
      aiReplyResponseType,
      aiReplyInstructions.trim() || undefined
    );

    setAiReplyGenerating(false);

    if (result) {
      setAiReplyResult(result);
    } else {
      setAiReplyError(true);
    }
  }, [
    aiReplyTarget,
    aiReplyGenerating,
    aiReplyResponseType,
    aiReplyInstructions,
    chatInfo.chat_id,
  ]);

  const handleSendAiReply = useCallback(async () => {
    if (!aiReplyResult) return;

    if (aiReplyResult.audio_url) {
      try {
        const response = await fetch(aiReplyResult.audio_url);
        if (!response.ok) throw new Error('Failed to fetch audio');
        const blob = await response.blob();
        const mimeType = blob.type || 'audio/mpeg';
        const formData = new FormData();
        formData.append('type', EMessageType.audio);
        formData.append('audio_ptt', 'true');
        if (aiReplyResult.audio_duration) {
          formData.append(
            'audio_duration',
            String(Math.round(aiReplyResult.audio_duration))
          );
        }
        formData.append('hash', `ai-audio-${Date.now()}-${Math.random()}`);
        (formData as any).append('audios', {
          uri: aiReplyResult.audio_url,
          name: `ai-audio-${Date.now()}.mp3`,
          type: mimeType,
        });
        await createMessageWithFormData(chatInfo.chat_id, formData);
      } catch {
        Alert.alert(pt.error_title, pt.chat_ai_reply_send_audio_error);
      }
    } else {
      await sendTextPayload(aiReplyResult.text);
    }

    setAiReplyTarget(null);
    setAiReplyResult(null);
    setAiReplyInstructions('');
    setAiReplyResponseType('text');
  }, [aiReplyResult, chatInfo.chat_id, sendTextPayload]);

  const closeAiReplyModal = useCallback(() => {
    if (aiReplyGenerating) return;
    setAiReplyTarget(null);
    setAiReplyResult(null);
    setAiReplyInstructions('');
    setAiReplyResponseType('text');
    setAiReplyError(false);
  }, [aiReplyGenerating]);

  const handleStartTranscription = useCallback(async () => {
    const target = transcribeTarget;
    if (!target) return;

    const existing = target.content?.audio?.transcription;
    if (existing) {
      setTranscribeResult(existing);
      setTranscribeCached(true);
      return;
    }

    setTranscribeLoading(true);
    setTranscribeError(false);
    setTranscribeResult(null);

    const result = await transcribeAudioMessage(
      chatInfo.chat_id,
      target.message_id
    );

    setTranscribeLoading(false);

    if (result) {
      setTranscribeResult(result.transcription);
      setTranscribeCached(result.cached);
    } else {
      setTranscribeError(true);
    }
  }, [transcribeTarget, chatInfo.chat_id]);

  const closeTranscribeModal = useCallback(() => {
    if (transcribeLoading) return;
    setTranscribeTarget(null);
    setTranscribeResult(null);
    setTranscribeCached(false);
    setTranscribeError(false);
  }, [transcribeLoading]);

  useEffect(() => {
    if (transcribeTarget) {
      void handleStartTranscription();
    }
  }, [transcribeTarget]);

  const toggleForwardTarget = useCallback((targetId: string) => {
    setForwardSelectedIds((previous) => {
      if (previous.includes(targetId)) {
        return previous.filter((id) => id !== targetId);
      }
      return [...previous, targetId];
    });
  }, []);

  const handleLoadMoreForwardTargets = useCallback(() => {
    if (!forwardModalVisible || forwardLoading || forwardLoadingMore) return;
    if (!selectedForwardChannelId) return;
    if (forwardCurrentPage >= forwardTotalPages) return;
    void loadForwardTargets(forwardCurrentPage + 1, true);
  }, [
    forwardCurrentPage,
    forwardLoading,
    forwardLoadingMore,
    forwardModalVisible,
    forwardTotalPages,
    loadForwardTargets,
    selectedForwardChannelId,
  ]);
  const canInteractWithForwardTargets =
    !!selectedForwardChannelId && forwardChannels.length > 0;

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
    } catch {}
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
      const replyMessageId = replyMessageTarget?.message_id;
      if (replyMessageId && !formData.get('message_quoted_id')) {
        formData.append('message_quoted_id', replyMessageId);
      }

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
      if (replyMessageId) {
        setReplyMessageTarget(null);
      }
      requestAnimationFrame(() => {
        scrollToBottomWithRetries(10);
      });
      return true;
    },
    [
      chatInfo.chat_id,
      replyMessageTarget?.message_id,
      scrollToBottomWithRetries,
      syncLatestMessages,
    ]
  );

  const finishVideoTrimSession = useCallback(
    (result: VideoTrimSessionResult) => {
      const session = videoTrimSessionRef.current;
      if (!session || session.settled) return;
      session.settled = true;
      videoTrimSessionRef.current = null;
      session.resolve(result);
    },
    []
  );

  useEffect(() => {
    const subscriptions: Array<{ remove: () => void }> = [];
    const onFinish = (payload: {
      outputPath: string;
      startTime: number;
      endTime: number;
      duration: number;
    }) => {
      finishVideoTrimSession({
        kind: 'success',
        outputPath: payload.outputPath,
        startTime: payload.startTime,
        endTime: payload.endTime,
        duration: payload.duration,
      });
    };
    const onCancel = () => {
      finishVideoTrimSession({ kind: 'cancel' });
    };
    const onError = (payload: { message?: string }) => {
      finishVideoTrimSession({
        kind: 'error',
        message: payload?.message?.trim() || pt.video_trim_error,
      });
    };
    const onHide = () => {
      finishVideoTrimSession({ kind: 'cancel' });
    };

    const nativeVideoTrim = VideoTrimModule as Partial<VideoTrimSpec>;
    if (typeof nativeVideoTrim.onFinishTrimming === 'function') {
      subscriptions.push(nativeVideoTrim.onFinishTrimming(onFinish));
      if (typeof nativeVideoTrim.onCancel === 'function') {
        subscriptions.push(nativeVideoTrim.onCancel(onCancel));
      }
      if (typeof nativeVideoTrim.onCancelTrimming === 'function') {
        subscriptions.push(nativeVideoTrim.onCancelTrimming(onCancel));
      }
      if (typeof nativeVideoTrim.onError === 'function') {
        subscriptions.push(nativeVideoTrim.onError(onError));
      }
      if (typeof nativeVideoTrim.onHide === 'function') {
        subscriptions.push(nativeVideoTrim.onHide(onHide));
      }
    } else if (NativeModules.VideoTrim) {
      const emitter = new NativeEventEmitter(NativeModules.VideoTrim);
      subscriptions.push(
        emitter.addListener(VIDEO_TRIM_EVENT_NAME, (event: any) => {
          switch (event?.name) {
            case 'onFinishTrimming':
              onFinish(event);
              break;
            case 'onCancel':
            case 'onCancelTrimming':
              onCancel();
              break;
            case 'onError':
              onError(event);
              break;
            case 'onHide':
              onHide();
              break;
            default:
              break;
          }
        })
      );
    }

    return () => {
      for (const subscription of subscriptions) {
        try {
          subscription.remove();
        } catch {}
      }
      finishVideoTrimSession({ kind: 'cancel' });
    };
  }, [finishVideoTrimSession]);

  const buildVideoDraft = useCallback(
    (input: {
      uri: string;
      fileName?: string | null;
      mimeType?: string | null;
      durationSec?: number | null;
      fileSize?: number | null;
    }): CameraCaptureDraft | null => {
      const uri = normalizeLocalFileUri(input.uri);
      if (!uri) return null;

      const fallbackName = resolveFileNameFromUri(
        uri,
        `video-${Date.now()}.mp4`
      );
      const baseName = input.fileName?.trim() || fallbackName;
      const extension =
        extractFileExtension(baseName) || getExtensionFromUrl(uri) || 'mp4';
      if (!VIDEO_ALLOWED_EXTENSIONS.has(extension)) {
        Alert.alert(pt.warning_title, pt.invalid_video_format);
        return null;
      }

      const hasKnownExtension = /\.[a-z0-9]{2,5}$/i.test(baseName);
      const fileName = hasKnownExtension
        ? baseName
        : `${baseName}.${extension}`;
      const fileSize = input.fileSize ?? null;
      if (typeof fileSize === 'number' && fileSize > MAX_VIDEO_SIZE_BYTES) {
        Alert.alert(pt.warning_title, pt.video_size_exceeded);
        return null;
      }

      const durationSec =
        typeof input.durationSec === 'number' &&
        Number.isFinite(input.durationSec)
          ? Math.max(1, Math.round(input.durationSec))
          : null;

      return {
        uri,
        kind: 'video',
        fileName,
        mimeType: input.mimeType || 'video/mp4',
        durationSec,
        fileSize,
      };
    },
    []
  );

  const buildOptimisticVideoMessage = useCallback(
    (draft: PendingVideoUploadDraft): ListMessageResult => {
      const extension = extractFileExtension(draft.fileName);
      return {
        message_id: draft.localMessageId,
        chat_id: chatInfo.chat_id,
        type_user: ETypeUserChat.operator,
        user:
          currentUserId && currentUserName
            ? { id: currentUserId, name: currentUserName }
            : null,
        content: {
          type: EMessageType.video,
          message_quoted_id: draft.replyMessageId,
          video: {
            url: draft.uri,
            thumbnail: draft.uri,
            caption: '',
            name: draft.fileName,
            mimetype: draft.mimeType,
            extension: extension ? `.${extension}` : '.mp4',
            size: draft.fileSize,
            duration: draft.durationSec,
          },
        },
        summary: {
          is_sent: false,
          is_delivered: false,
          is_seen: false,
          is_sent_to_internal: true,
        },
        date: new Date().toISOString(),
        hash: draft.hash,
      };
    },
    [chatInfo.chat_id, currentUserId, currentUserName]
  );

  const clearVideoEditorOpeningHideTimeout = useCallback(() => {
    if (!videoEditorOpeningHideTimeoutRef.current) return;
    clearTimeout(videoEditorOpeningHideTimeoutRef.current);
    videoEditorOpeningHideTimeoutRef.current = null;
  }, []);

  const startVideoEditorOpening = useCallback(() => {
    clearVideoEditorOpeningHideTimeout();
    videoEditorOpeningStartedAtRef.current = Date.now();
    setIsOpeningVideoEditor(true);
  }, [clearVideoEditorOpeningHideTimeout]);

  const stopVideoEditorOpening = useCallback(() => {
    const openedAt = videoEditorOpeningStartedAtRef.current;
    const elapsedMs =
      typeof openedAt === 'number'
        ? Math.max(0, Date.now() - openedAt)
        : VIDEO_EDITOR_OPENING_MIN_VISIBLE_MS;
    const remainingMs = Math.max(
      0,
      VIDEO_EDITOR_OPENING_MIN_VISIBLE_MS - elapsedMs
    );

    const hideOverlay = () => {
      videoEditorOpeningStartedAtRef.current = null;
      setIsOpeningVideoEditor(false);
    };

    clearVideoEditorOpeningHideTimeout();
    if (remainingMs === 0) {
      hideOverlay();
      return;
    }

    videoEditorOpeningHideTimeoutRef.current = setTimeout(() => {
      videoEditorOpeningHideTimeoutRef.current = null;
      hideOverlay();
    }, remainingMs);
  }, [clearVideoEditorOpeningHideTimeout]);

  useEffect(() => {
    return () => {
      clearVideoEditorOpeningHideTimeout();
      videoEditorOpeningStartedAtRef.current = null;
    };
  }, [clearVideoEditorOpeningHideTimeout]);

  const openVideoTrimEditor = useCallback(
    async (uri: string): Promise<VideoTrimSessionResult> => {
      const normalizedUri = normalizeLocalFileUri(uri);
      if (!normalizedUri) {
        return { kind: 'error', message: pt.video_trim_error };
      }

      try {
        const validation = await isValidFile(normalizedUri);
        if (!validation?.isValid) {
          return { kind: 'error', message: pt.invalid_video_format };
        }
      } catch {}

      if (videoTrimSessionRef.current) {
        return { kind: 'error', message: pt.video_trim_busy };
      }

      return await new Promise<VideoTrimSessionResult>((resolve) => {
        videoTrimSessionRef.current = {
          settled: false,
          resolve,
        };

        try {
          showEditor(normalizedUri, {
            type: 'video',
            maxDuration: MAX_VIDEO_TRIM_DURATION_SECONDS,
            minDuration: 1,
            autoplay: true,
            closeWhenFinish: true,
            fullScreenModalIOS: true,
            saveToPhoto: false,
            openDocumentsOnFinish: false,
            openShareSheetOnFinish: false,
            cancelButtonText: pt.cancel,
            saveButtonText: pt.done,
            cancelTrimmingButtonText: pt.cancel,
            headerText: pt.videos,
            enableCancelDialog: false,
            enableSaveDialog: false,
            enableCancelTrimmingDialog: false,
          });
          requestAnimationFrame(() => {
            stopVideoEditorOpening();
          });
        } catch {
          videoTrimSessionRef.current = null;
          resolve({ kind: 'error', message: pt.video_trim_error });
        }
      });
    },
    [stopVideoEditorOpening]
  );

  const sendPendingVideoDraft = useCallback(
    async (
      draft: PendingVideoUploadDraft,
      options?: { isRetry?: boolean }
    ): Promise<boolean> => {
      if (isHistoryReadonly) return false;
      if (uploadingVideoHashesRef.current.has(draft.hash)) return false;

      uploadingVideoHashesRef.current.add(draft.hash);
      pendingVideoUploadsRef.current.set(draft.hash, draft);
      setSendingCapturedMedia(true);
      setMessages((previous) =>
        previous.map((entry) => {
          if (readNonEmptyString(entry.hash) !== draft.hash) {
            return entry;
          }

          return {
            ...entry,
            message_id: draft.localMessageId,
            date: new Date().toISOString(),
            summary: {
              is_sent: false,
              is_delivered: false,
              is_seen: false,
              is_sent_to_internal: true,
            },
            content: {
              ...(entry.content ?? { type: EMessageType.video }),
              type: EMessageType.video,
              message_quoted_id: draft.replyMessageId,
              video: {
                ...(entry.content?.video ?? {}),
                url: draft.uri,
                thumbnail: draft.uri,
                name: draft.fileName,
                mimetype: draft.mimeType,
                size: draft.fileSize,
                duration: draft.durationSec,
              },
            },
          };
        })
      );

      try {
        const formData = new FormData();
        formData.append('type', EMessageType.video);
        formData.append('hash', draft.hash);
        if (draft.replyMessageId) {
          formData.append('message_quoted_id', draft.replyMessageId);
        }
        await appendMediaToFormData(formData, 'videos', {
          uri: draft.uri,
          name: draft.fileName,
          mimeType: draft.mimeType,
        });
        if (draft.durationSec != null) {
          formData.append('video_duration', String(draft.durationSec));
        }

        const result = await createMessageWithFormData(
          chatInfo.chat_id,
          formData
        );
        if (!result.ok) {
          setMessages((previous) =>
            previous.map((entry) =>
              readNonEmptyString(entry.hash) === draft.hash
                ? {
                    ...entry,
                    summary: {
                      is_sent: false,
                      is_delivered: false,
                      is_seen: false,
                      is_sent_to_internal: false,
                    },
                  }
                : entry
            )
          );
          Alert.alert(pt.error_title, pt.send_error);
          return false;
        }

        pendingScrollToBottomRef.current = true;
        setShowScrollToBottomButton(false);
        const createdMessage = result.message;
        if (createdMessage) {
          setMessages((previous) =>
            mergeMessageLists(previous, createdMessage)
          );
        } else {
          await syncLatestMessages();
        }
        pendingVideoUploadsRef.current.delete(draft.hash);
        requestAnimationFrame(() => {
          scrollToBottomWithRetries(10);
        });
        if (!options?.isRetry && draft.replyMessageId) {
          setReplyMessageTarget(null);
        }
        return true;
      } catch {
        setMessages((previous) =>
          previous.map((entry) =>
            readNonEmptyString(entry.hash) === draft.hash
              ? {
                  ...entry,
                  summary: {
                    is_sent: false,
                    is_delivered: false,
                    is_seen: false,
                    is_sent_to_internal: false,
                  },
                }
              : entry
          )
        );
        Alert.alert(pt.error_title, pt.send_error);
        return false;
      } finally {
        uploadingVideoHashesRef.current.delete(draft.hash);
        setSendingCapturedMedia(false);
      }
    },
    [
      chatInfo.chat_id,
      isHistoryReadonly,
      scrollToBottomWithRetries,
      syncLatestMessages,
    ]
  );

  useEffect(() => {
    sendPendingVideoDraftRef.current = sendPendingVideoDraft;
  }, [sendPendingVideoDraft]);

  const sendCapturedMediaDraft = useCallback(
    async (draft: CameraCaptureDraft) => {
      if (
        sendingCapturedMedia ||
        sendingCapturedMediaRef.current ||
        isHistoryReadonly
      ) {
        return;
      }

      if (draft.kind === 'video') {
        const hash = createClientMessageHash();
        const replyMessageId = replyMessageTarget?.message_id ?? null;
        const pendingDraft: PendingVideoUploadDraft = {
          hash,
          uri: normalizeLocalFileUri(draft.uri),
          fileName: draft.fileName,
          mimeType: draft.mimeType,
          durationSec: draft.durationSec,
          fileSize: draft.fileSize ?? null,
          replyMessageId,
          localMessageId: `local-${hash}`,
        };

        pendingVideoUploadsRef.current.set(hash, pendingDraft);
        setMessages((previous) =>
          mergeMessageLists(previous, buildOptimisticVideoMessage(pendingDraft))
        );
        pendingScrollToBottomRef.current = true;
        setShowScrollToBottomButton(false);
        requestAnimationFrame(() => {
          scrollToBottomWithRetries(10);
        });
        if (replyMessageId) {
          setReplyMessageTarget(null);
        }
        await sendPendingVideoDraft(pendingDraft);
        return;
      }

      setSendingCapturedMedia(true);
      try {
        const formData = new FormData();
        formData.append('type', EMessageType.image);
        formData.append('hash', createClientMessageHash());
        await appendMediaToFormData(formData, 'images', {
          uri: draft.uri,
          name: draft.fileName,
          mimeType: draft.mimeType,
        });

        await submitFormDataMessage(formData);
      } finally {
        setSendingCapturedMedia(false);
      }
    },
    [
      buildOptimisticVideoMessage,
      isHistoryReadonly,
      replyMessageTarget?.message_id,
      scrollToBottomWithRetries,
      sendPendingVideoDraft,
      sendingCapturedMedia,
      submitFormDataMessage,
    ]
  );

  const extractExtension = useCallback((name: string | null | undefined) => {
    return extractFileExtension(name);
  }, []);

  const withAttachmentSheetDismissed = useCallback(
    async (work: () => Promise<void>) => {
      if (mediaPickerActiveRef.current) return;
      mediaPickerActiveRef.current = true;
      setCameraPickerVisible(false);
      await new Promise<void>((resolve) =>
        setTimeout(resolve, ATTACHMENT_PICKER_TRANSITION_DELAY_MS)
      );

      try {
        await work();
      } finally {
        mediaPickerActiveRef.current = false;
      }
    },
    []
  );

  const handleTrimmedVideoAsset = useCallback(
    async (asset: ImagePicker.ImagePickerAsset) => {
      if (!asset?.uri) return;
      const initialDraft = buildVideoDraft({
        uri: asset.uri,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        fileSize: typeof asset.fileSize === 'number' ? asset.fileSize : null,
        durationSec:
          typeof asset.duration === 'number' && Number.isFinite(asset.duration)
            ? asset.duration / 1000
            : null,
      });
      if (!initialDraft) return;

      let trimResult: VideoTrimSessionResult = { kind: 'cancel' };
      startVideoEditorOpening();
      try {
        trimResult = await openVideoTrimEditor(initialDraft.uri);
      } finally {
        stopVideoEditorOpening();
      }
      if (trimResult.kind === 'cancel') return;
      if (trimResult.kind === 'error') {
        Alert.alert(pt.error_title, trimResult.message || pt.video_trim_error);
        return;
      }

      const trimmedUri = normalizeLocalFileUri(trimResult.outputPath);
      const trimmedFile = new File(trimmedUri);
      if (!trimmedFile.exists) {
        Alert.alert(pt.error_title, pt.video_trim_error);
        return;
      }

      const trimmedDurationSec =
        typeof trimResult.duration === 'number' &&
        Number.isFinite(trimResult.duration)
          ? Math.max(
              1,
              Math.round(
                trimResult.duration > 1000
                  ? trimResult.duration / 1000
                  : trimResult.duration
              )
            )
          : initialDraft.durationSec;

      const trimmedDraft = buildVideoDraft({
        uri: trimmedUri,
        fileName: trimmedFile.name || initialDraft.fileName,
        mimeType: initialDraft.mimeType,
        fileSize:
          typeof trimmedFile.size === 'number' ? trimmedFile.size : null,
        durationSec: trimmedDurationSec,
      });
      if (!trimmedDraft) return;

      try {
        const validation = await isValidFile(trimmedDraft.uri);
        if (!validation?.isValid) {
          Alert.alert(pt.warning_title, pt.invalid_video_format);
          return;
        }
      } catch {
        Alert.alert(pt.error_title, pt.video_trim_error);
        return;
      }

      await sendCapturedMediaDraft(trimmedDraft);
    },
    [
      buildVideoDraft,
      openVideoTrimEditor,
      sendCapturedMediaDraft,
      startVideoEditorOpening,
      stopVideoEditorOpening,
    ]
  );

  const handlePickPhotoCapture = useCallback(async () => {
    if (
      !canComposeInChat ||
      sendingCapturedMedia ||
      sendingVoiceRecording ||
      sendingCapturedMediaRef.current ||
      sendingVoiceRecordingRef.current
    ) {
      return;
    }

    await withAttachmentSheetDismissed(async () => {
      try {
        const permission =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(pt.warning_title, pt.image_permission_denied);
          return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: 'images',
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
        if (!IMAGE_ALLOWED_EXTENSIONS.has(extension)) {
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
          fileSize: typeof asset.fileSize === 'number' ? asset.fileSize : null,
        });
      } catch {
        Alert.alert(pt.error_title, pt.media_picker_open_error);
      }
    });
  }, [
    canComposeInChat,
    extractExtension,
    sendCapturedMediaDraft,
    sendingCapturedMedia,
    sendingVoiceRecording,
    withAttachmentSheetDismissed,
  ]);

  const pickVideoFromLibrary = useCallback(async () => {
    if (sendingCapturedMediaRef.current || sendingVoiceRecordingRef.current) {
      return;
    }

    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(pt.warning_title, pt.image_permission_denied);
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'videos',
        quality: 0.8,
        allowsMultipleSelection: false,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      await handleTrimmedVideoAsset(result.assets[0]);
    } catch {
      Alert.alert(pt.error_title, pt.media_picker_open_error);
    }
  }, [handleTrimmedVideoAsset]);

  const captureVideoFromCamera = useCallback(async () => {
    if (sendingCapturedMediaRef.current || sendingVoiceRecordingRef.current) {
      return;
    }

    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(pt.warning_title, pt.camera_permission_denied);
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: 'videos',
        quality: 0.8,
        videoMaxDuration: 120,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      await handleTrimmedVideoAsset(result.assets[0]);
    } catch {
      Alert.alert(pt.error_title, pt.media_picker_open_error);
    }
  }, [handleTrimmedVideoAsset]);

  const handlePickVideoCapture = useCallback(async () => {
    if (
      !canComposeInChat ||
      sendingCapturedMedia ||
      sendingVoiceRecording ||
      sendingCapturedMediaRef.current ||
      sendingVoiceRecordingRef.current
    ) {
      return;
    }

    await withAttachmentSheetDismissed(async () => {
      Alert.alert(pt.pick_video_source_title, pt.pick_video_source_message, [
        {
          text: pt.video_source_gallery,
          onPress: () => {
            void pickVideoFromLibrary();
          },
        },
        {
          text: pt.video_source_camera,
          onPress: () => {
            void captureVideoFromCamera();
          },
        },
        {
          text: pt.cancel,
          style: 'cancel',
        },
      ]);
    });
  }, [
    canComposeInChat,
    captureVideoFromCamera,
    pickVideoFromLibrary,
    sendingCapturedMedia,
    sendingVoiceRecording,
    withAttachmentSheetDismissed,
  ]);

  const handlePickDocument = useCallback(async () => {
    setCameraPickerVisible(false);
    if (!canComposeInChat || sendingCapturedMedia || sendingVoiceRecording) {
      return;
    }
    if (documentPickerActiveRef.current) return;

    documentPickerActiveRef.current = true;
    await new Promise<void>((resolve) =>
      setTimeout(resolve, ATTACHMENT_PICKER_TRANSITION_DELAY_MS)
    );

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
    await new Promise<void>((resolve) =>
      setTimeout(resolve, ATTACHMENT_PICKER_TRANSITION_DELAY_MS)
    );

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
        if (!response) {
          if (!append) {
            setContactPickerItems([]);
            setContactPickerPage(1);
            setContactPickerTotalPages(1);
          }
          return;
        }
        const items = response.results ?? [];
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
        setContactPickerPage(response.current_page ?? page);
        setContactPickerTotalPages(response.total_pages ?? 1);
      } catch {
        if (!append) {
          setContactPickerItems([]);
          setContactPickerPage(1);
          setContactPickerTotalPages(1);
        }
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

  const submitLocationPayload = useCallback(
    async (payload: {
      latitude: number;
      longitude: number;
      name?: string;
      address?: string;
    }) => {
      if (sendingCapturedMedia || !canComposeInChat) return false;

      const formData = new FormData();
      formData.append('type', EMessageType.location);
      formData.append('location_latitude', String(payload.latitude));
      formData.append('location_longitude', String(payload.longitude));

      const normalizedName = payload.name?.trim() ?? '';
      const normalizedAddress = payload.address?.trim() ?? '';
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
        if (!ok) return false;
        setLocationPickerVisible(false);
        return true;
      } finally {
        setSendingCapturedMedia(false);
      }
    },
    [canComposeInChat, sendingCapturedMedia, submitFormDataMessage]
  );

  const applyLocationSelection = useCallback(
    (payload: {
      latitude: number;
      longitude: number;
      name?: string;
      address?: string;
      accuracy?: number | null;
    }) => {
      setLocationLatitudeInput(payload.latitude.toFixed(6));
      setLocationLongitudeInput(payload.longitude.toFixed(6));
      if (payload.name !== undefined) {
        setLocationNameInput(payload.name);
      }
      if (payload.address !== undefined) {
        setLocationAddressInput(payload.address);
      }
      setLocationCurrentAccuracy(payload.accuracy ?? null);
      setLocationMapRegion({
        latitude: payload.latitude,
        longitude: payload.longitude,
        latitudeDelta: 0.006,
        longitudeDelta: 0.006,
      });
    },
    []
  );

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

      const latitude = Number(current.coords.latitude.toFixed(6));
      const longitude = Number(current.coords.longitude.toFixed(6));
      const resolvedName = locationNameInput.trim() || pt.location_current;
      let resolvedAddress = locationAddressInput.trim();

      try {
        const reverseResult = await Location.reverseGeocodeAsync({
          latitude,
          longitude,
        });
        const currentAddress = reverseResult[0];
        if (currentAddress) {
          const formattedAddress = [
            currentAddress.name,
            currentAddress.street,
            currentAddress.streetNumber,
            currentAddress.district,
            currentAddress.city,
            currentAddress.region,
          ]
            .filter(
              (part) => typeof part === 'string' && part.trim().length > 0
            )
            .join(', ');
          if (formattedAddress) {
            resolvedAddress = formattedAddress;
          }
        }
      } catch {}

      applyLocationSelection({
        latitude,
        longitude,
        name: resolvedName,
        address: resolvedAddress,
        accuracy: current.coords.accuracy,
      });
    } catch {
      setLocationCurrentError(true);
    } finally {
      setLocationCurrentLoading(false);
    }
  }, [applyLocationSelection, locationAddressInput, locationNameInput]);

  const handleSearchLocation = useCallback(async () => {
    const query = locationSearchInput.trim();
    if (query.length < 3) {
      setLocationSearchResults([]);
      return;
    }

    setLocationSearchLoading(true);
    setLocationCurrentError(false);
    try {
      const geocoded = await Location.geocodeAsync(query);
      const results: LocationSearchResult[] = geocoded
        .slice(0, 5)
        .map((item) => {
          const latitude = Number(item.latitude.toFixed(6));
          const longitude = Number(item.longitude.toFixed(6));
          return {
            id: `${latitude}-${longitude}`,
            name: query,
            address: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
            latitude,
            longitude,
          };
        });

      setLocationSearchResults(results);
      const firstResult = results[0];
      if (firstResult) {
        applyLocationSelection({
          latitude: firstResult.latitude,
          longitude: firstResult.longitude,
          name: firstResult.name,
          address: firstResult.address,
        });
      }
    } catch {
      setLocationCurrentError(true);
      setLocationSearchResults([]);
    } finally {
      setLocationSearchLoading(false);
    }
  }, [applyLocationSelection, locationSearchInput]);

  const handleSelectSearchResult = useCallback(
    (result: LocationSearchResult) => {
      applyLocationSelection({
        latitude: result.latitude,
        longitude: result.longitude,
        name: result.name,
        address: result.address,
      });
    },
    [applyLocationSelection]
  );

  const handleMapPress = useCallback(
    (event: MapPressCoordinateEvent) => {
      const geometryCoordinates = event.geometry?.coordinates;
      const coordinatesFromGeometry =
        Array.isArray(geometryCoordinates) &&
        geometryCoordinates.length >= 2 &&
        Number.isFinite(geometryCoordinates[0]) &&
        Number.isFinite(geometryCoordinates[1])
          ? {
              longitude: Number(geometryCoordinates[0]),
              latitude: Number(geometryCoordinates[1]),
            }
          : null;

      const nativeCoordinate = event.nativeEvent?.coordinate;
      const coordinatesFromNative =
        nativeCoordinate &&
        Number.isFinite(nativeCoordinate.latitude) &&
        Number.isFinite(nativeCoordinate.longitude)
          ? {
              latitude: Number(nativeCoordinate.latitude),
              longitude: Number(nativeCoordinate.longitude),
            }
          : null;

      const resolvedCoordinate =
        coordinatesFromGeometry ?? coordinatesFromNative;
      if (!resolvedCoordinate) return;

      const { latitude, longitude } = resolvedCoordinate;
      applyLocationSelection({
        latitude,
        longitude,
        name: locationNameInput.trim() || pt.location_current,
        address:
          locationAddressInput.trim() ||
          `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
      });
    },
    [applyLocationSelection, locationAddressInput, locationNameInput]
  );

  const handleSendCurrentLocation = useCallback(async () => {
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
      const latitude = Number(current.coords.latitude.toFixed(6));
      const longitude = Number(current.coords.longitude.toFixed(6));
      const name = pt.location_current;
      const address = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;

      applyLocationSelection({
        latitude,
        longitude,
        name,
        address,
        accuracy: current.coords.accuracy,
      });

      await submitLocationPayload({
        latitude,
        longitude,
        name,
        address,
      });
    } catch {
      setLocationCurrentError(true);
    } finally {
      setLocationCurrentLoading(false);
    }
  }, [applyLocationSelection, submitLocationPayload]);

  const handleOpenLocationPicker = useCallback(() => {
    setCameraPickerVisible(false);
    setLocationNameInput('');
    setLocationAddressInput('');
    setLocationSearchInput('');
    setLocationSearchResults([]);
    setLocationCurrentAccuracy(null);
    setLocationMapRegion(null);
    setLocationMapStatus(hasNativeMapSupport ? 'loading' : 'failed');
    setLocationMapErrorMessage(null);
    setLocationMapStyleUrl(mapLibreStyleUrl);
    setLocationMapUsedDefaultFallback(false);
    setLocationPickerVisible(true);
    void resolveCurrentLocation();
  }, [resolveCurrentLocation]);

  const handleSendLocation = useCallback(async () => {
    const latitude = parseCoordinateInput(locationLatitudeInput);
    const longitude = parseCoordinateInput(locationLongitudeInput);
    const isLatitudeValid =
      typeof latitude === 'number' && latitude >= -90 && latitude <= 90;
    const isLongitudeValid =
      typeof longitude === 'number' && longitude >= -180 && longitude <= 180;

    if (!isLatitudeValid || !isLongitudeValid) {
      Alert.alert(pt.warning_title, pt.location_invalid_coordinates);
      return;
    }

    await submitLocationPayload({
      latitude,
      longitude,
      name: locationNameInput,
      address: locationAddressInput,
    });
  }, [
    locationAddressInput,
    locationLatitudeInput,
    locationLongitudeInput,
    locationNameInput,
    submitLocationPayload,
  ]);

  const selectedLatitude = useMemo(
    () => parseCoordinateInput(locationLatitudeInput),
    [locationLatitudeInput]
  );

  const selectedLongitude = useMemo(
    () => parseCoordinateInput(locationLongitudeInput),
    [locationLongitudeInput]
  );

  const selectedCoordinate = useMemo(() => {
    if (
      selectedLatitude === null ||
      selectedLongitude === null ||
      selectedLatitude < -90 ||
      selectedLatitude > 90 ||
      selectedLongitude < -180 ||
      selectedLongitude > 180
    ) {
      return null;
    }
    return {
      latitude: selectedLatitude,
      longitude: selectedLongitude,
    };
  }, [selectedLatitude, selectedLongitude]);

  const selectedCoordinateLngLat = useMemo<[number, number] | null>(() => {
    if (!selectedCoordinate) return null;
    return [selectedCoordinate.longitude, selectedCoordinate.latitude];
  }, [selectedCoordinate]);

  const mapCenterCoordinateLngLat = useMemo<[number, number]>(() => {
    const region = locationMapRegion ?? LOCATION_MAP_DEFAULT_REGION;
    return [region.longitude, region.latitude];
  }, [locationMapRegion]);

  const locationMapDebugInfo = useMemo(() => {
    const details = [
      mapDebugSupportInfo,
      `pickerStatus=${locationMapStatus}`,
      `pickerStyleUrl=${locationMapStyleUrl}`,
    ];

    if (locationMapErrorMessage) {
      details.push(`pickerError=${locationMapErrorMessage}`);
    }

    return details.join(' | ');
  }, [locationMapErrorMessage, locationMapStatus, locationMapStyleUrl]);

  const handleLocationMapWillStartLoading = useCallback(() => {
    setLocationMapStatus('loading');
    setLocationMapErrorMessage(null);
  }, []);

  const handleLocationMapDidFinishLoading = useCallback(() => {
    setLocationMapStatus('ready');
    setLocationMapErrorMessage(null);
  }, []);

  const handleLocationMapDidFailLoading = useCallback(
    (event: unknown) => {
      const errorMessage =
        readMapLoadErrorMessage(event) ?? 'MapLibre style loading failed.';

      if (
        !locationMapUsedDefaultFallback &&
        locationMapStyleUrl !== MAPLIBRE_DEFAULT_STYLE_URL
      ) {
        if (__DEV__) {
          console.log(
            'MapLibre [location-picker] style failed, retrying default',
            {
              failedStyleUrl: locationMapStyleUrl,
              fallbackStyleUrl: MAPLIBRE_DEFAULT_STYLE_URL,
              errorMessage,
            }
          );
        }
        setLocationMapUsedDefaultFallback(true);
        setLocationMapStyleUrl(MAPLIBRE_DEFAULT_STYLE_URL);
        setLocationMapStatus('loading');
        setLocationMapErrorMessage(
          `Falha no estilo configurado. Tentando estilo padrão. ${errorMessage}`
        );
        return;
      }

      if (__DEV__) {
        console.log('MapLibre [location-picker] style failed', {
          styleUrl: locationMapStyleUrl,
          errorMessage,
        });
      }

      setLocationMapStatus('failed');
      setLocationMapErrorMessage(errorMessage);
    },
    [locationMapStyleUrl, locationMapUsedDefaultFallback]
  );

  const handleRetryLocationMap = useCallback(() => {
    setLocationMapStatus('loading');
    setLocationMapErrorMessage(null);
    setLocationMapStyleUrl((currentStyle) =>
      currentStyle.trim().length > 0 ? currentStyle : MAPLIBRE_DEFAULT_STYLE_URL
    );
  }, []);

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
      mediaTypes: ['images', 'videos'],
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

    if (kind === 'video') {
      await handleTrimmedVideoAsset(asset);
      return;
    }

    await sendCapturedMediaDraft({
      uri: asset.uri,
      kind,
      fileName,
      mimeType: asset.mimeType || fallbackMime,
      durationSec: null,
    });
  }, [
    canComposeInChat,
    handleTrimmedVideoAsset,
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

  const getQuickMessageGreeting = useCallback(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return pt.good_morning;
    if (hour >= 12 && hour < 18) return pt.good_afternoon;
    return pt.good_evening;
  }, []);

  const getCurrentProtocol = useCallback(() => {
    const protocolStart = chatInfo.protocol_start;
    if (Array.isArray(protocolStart) && protocolStart.length > 0) {
      return protocolStart[protocolStart.length - 1] ?? '';
    }

    const protocolTransfer = chatInfo.protocol_transfer;
    if (Array.isArray(protocolTransfer) && protocolTransfer.length > 0) {
      return protocolTransfer[protocolTransfer.length - 1] ?? '';
    }

    const protocolUra = chatInfo.protocol_ura;
    if (Array.isArray(protocolUra) && protocolUra.length > 0) {
      return protocolUra[protocolUra.length - 1] ?? '';
    }

    return generateQuickMessageProtocolFallback();
  }, [
    chatInfo.protocol_start,
    chatInfo.protocol_transfer,
    chatInfo.protocol_ura,
  ]);

  const replaceTagsInQuickMessage = useCallback(
    (message: string | null | undefined) => {
      if (!message) return '';

      const contactName = chatInfo.name || '';
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
      const greeting = getQuickMessageGreeting();
      const accountName = chatInfo.account?.name || '';
      const phoneDigits = normalizePhoneDigits(chatInfo.phone);
      const phone = phoneDigits ? formatPhoneDigits(phoneDigits) : '';
      const channelName = chatInfo.worker?.name || '';

      let replaced = message;
      replaced = replaced.replaceAll(/\{\{\s*greeting\s*\}\}/gi, greeting);
      replaced = replaced.replaceAll(/\{\{\s*name\s*\}\}/gi, contactName);
      replaced = replaced.replaceAll(/\{\{\s*protocol\s*\}\}/gi, protocol);
      replaced = replaced.replaceAll(/\{\{\s*protocolo\s*\}\}/gi, protocol);
      replaced = replaced.replaceAll(/\{\{\s*date\s*\}\}/gi, date);
      replaced = replaced.replaceAll(/\{\{\s*time\s*\}\}/gi, time);
      replaced = replaced.replaceAll(
        /\{\{\s*account_name\s*\}\}/gi,
        accountName
      );
      replaced = replaced.replaceAll(
        /\{\{\s*accountname\s*\}\}/gi,
        accountName
      );
      replaced = replaced.replaceAll(/\{\{\s*phone\s*\}\}/gi, phone);
      replaced = replaced.replaceAll(
        /\{\{\s*channel_name\s*\}\}/gi,
        channelName
      );
      replaced = replaced.replaceAll(
        /\{\{\s*channelname\s*\}\}/gi,
        channelName
      );

      return replaced;
    },
    [
      chatInfo.account?.name,
      chatInfo.name,
      chatInfo.phone,
      chatInfo.worker?.name,
      getCurrentProtocol,
      getQuickMessageGreeting,
    ]
  );

  const sendQuickMessageTemplate = useCallback(
    async (template: QuickMessageTemplate, messageOverride?: string | null) => {
      if (!canComposeInChat || sendingQuickMessage) return false;

      const hasMessageOverride = typeof messageOverride === 'string';
      const messageValue = hasMessageOverride
        ? messageOverride
        : replaceTagsInQuickMessage(template.message);

      if (template.type === EMessageType.text) {
        const normalizedMessage = messageValue.trim();
        if (!normalizedMessage) return false;

        return await sendTextPayload(normalizedMessage, {
          quickMessageTemplateId: template.message_template_id,
        });
      }

      if (!template.attachment_url) return false;

      const formData = new FormData();
      formData.append('type', template.type);
      formData.append('hash', createClientMessageHash());
      formData.append(
        'quick_message_template_id',
        template.message_template_id
      );

      const normalizedMessage = messageValue.trim();
      if (normalizedMessage) {
        formData.append('message', normalizedMessage);
      } else if (hasMessageOverride) {
        formData.append('message', '');
      }

      return await submitFormDataMessage(formData);
    },
    [
      canComposeInChat,
      replaceTagsInQuickMessage,
      sendTextPayload,
      sendingQuickMessage,
      submitFormDataMessage,
    ]
  );

  const handleSelectQuickMessage = useCallback(
    async (template: QuickMessageTemplate) => {
      setShowQuickMessageList(false);
      if (template.auto_send) {
        setInput('');
        setQuickMessageInputDirty(false);
        setQuickMessageTemplates([]);
        setSelectedQuickMessage(null);
        setSendingQuickMessage(true);
        try {
          await sendQuickMessageTemplate(template);
        } finally {
          setSendingQuickMessage(false);
        }
        return;
      }

      setSelectedQuickMessage(template);
      setInput(replaceTagsInQuickMessage(template.message));
      setQuickMessageInputDirty(false);
      setQuickMessageTemplates([]);
      setComposerEmojiPickerVisible(false);
      Keyboard.dismiss();
    },
    [replaceTagsInQuickMessage, sendQuickMessageTemplate]
  );

  const handleCancelQuickMessage = useCallback(() => {
    setSelectedQuickMessage(null);
    setInput('');
    setQuickMessageInputDirty(false);
  }, []);

  const handleComposerInputChange = useCallback(
    (value: string) => {
      setInput(value);

      if (selectedQuickMessage) {
        setQuickMessageInputDirty(true);
        quickMessageSearchRequestRef.current += 1;
        setShowQuickMessageList(false);
        setQuickMessageTemplates([]);
        setQuickMessageLoading(false);
        return;
      }

      if (value.startsWith('/')) {
        const searchTerm = value.slice(1).trim();
        const requestId = quickMessageSearchRequestRef.current + 1;
        quickMessageSearchRequestRef.current = requestId;

        setShowQuickMessageList(true);

        void (async () => {
          setQuickMessageLoading(true);
          const templates = await listQuickMessageTemplates(
            searchTerm || null,
            chatInfo.worker?.id ?? null
          );
          if (quickMessageSearchRequestRef.current !== requestId) return;
          setQuickMessageTemplates(templates);
          setQuickMessageLoading(false);
        })();

        return;
      }

      quickMessageSearchRequestRef.current += 1;
      setShowQuickMessageList(false);
      setQuickMessageTemplates([]);
      setQuickMessageLoading(false);
    },
    [chatInfo.worker?.id, selectedQuickMessage]
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
    if (selectedQuickMessage) {
      if (
        sending ||
        sendingQuickMessage ||
        isRecordingVoice ||
        sendingCapturedMedia ||
        !canComposeInChat
      ) {
        return;
      }

      if (
        selectedQuickMessage.type === EMessageType.text &&
        input.trim().length === 0
      ) {
        return;
      }

      setSendingQuickMessage(true);
      try {
        const sent = await sendQuickMessageTemplate(
          selectedQuickMessage,
          input
        );
        if (sent) {
          setSelectedQuickMessage(null);
          setInput('');
          setQuickMessageInputDirty(false);
        }
      } finally {
        setSendingQuickMessage(false);
      }

      return;
    }

    const text = input.trim();
    if (
      !text ||
      sending ||
      sendingQuickMessage ||
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
    !sendingQuickMessage &&
    !sendingCapturedMedia &&
    !isPreparingRecording &&
    !isRecordingVoice;
  const canUseComposerActions =
    !sending &&
    !selectedQuickMessage &&
    !sendingQuickMessage &&
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
  const hydratedSelectedQuickMessageText = useMemo(() => {
    if (!selectedQuickMessage) return '';
    return replaceTagsInQuickMessage(selectedQuickMessage.message);
  }, [replaceTagsInQuickMessage, selectedQuickMessage]);
  const quickMessagePreviewText = useMemo(() => {
    if (!selectedQuickMessage) return '';
    if (quickMessageInputDirty) {
      return input;
    }
    return input || hydratedSelectedQuickMessageText;
  }, [
    hydratedSelectedQuickMessageText,
    input,
    quickMessageInputDirty,
    selectedQuickMessage,
  ]);
  const canSendSelectedQuickMessage = useMemo(() => {
    if (!selectedQuickMessage) return false;
    if (!canComposeInChat || sending || sendingQuickMessage) return false;

    if (selectedQuickMessage.type === EMessageType.text) {
      return input.trim().length > 0;
    }

    return !!selectedQuickMessage.attachment_url;
  }, [
    canComposeInChat,
    input,
    selectedQuickMessage,
    sending,
    sendingQuickMessage,
  ]);
  const shouldShowComposerSendButton =
    hasInputText || selectedQuickMessage !== null;
  const isComposerSendDisabled = selectedQuickMessage
    ? !canSendSelectedQuickMessage || sending || sendingQuickMessage
    : !hasInputText || sending || sendingQuickMessage;

  const focusComposerInput = useCallback(() => {
    if (!canFocusInput) return;
    setComposerEmojiPickerVisible(false);
    messageInputRef.current?.focus();
  }, [canFocusInput]);

  const closeComposerEmojiPicker = useCallback(() => {
    setComposerEmojiPickerVisible(false);
  }, []);

  const handleChatBodyTouchStart = useCallback(() => {
    dismissKeyboard();
    closeOpenedMessageSwipeable();
    if (composerEmojiPickerVisible) {
      closeComposerEmojiPicker();
    }
  }, [
    closeComposerEmojiPicker,
    closeOpenedMessageSwipeable,
    composerEmojiPickerVisible,
  ]);

  const handleMessageListScrollBeginDrag = useCallback(() => {
    dismissKeyboard();
    closeOpenedMessageSwipeable();
    if (composerEmojiPickerVisible) {
      closeComposerEmojiPicker();
    }
  }, [
    closeComposerEmojiPicker,
    closeOpenedMessageSwipeable,
    composerEmojiPickerVisible,
  ]);

  const composerEmojiDismissPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_event, gestureState) => {
          if (!composerEmojiPickerVisible) return false;
          if (gestureState.dy <= 4) return false;
          return Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
        },
        onPanResponderRelease: (_event, gestureState) => {
          if (
            gestureState.dy >= EMOJI_PICKER_DISMISS_DY_THRESHOLD ||
            gestureState.vy >= EMOJI_PICKER_DISMISS_VY_THRESHOLD
          ) {
            closeComposerEmojiPicker();
          }
        },
        onPanResponderTerminate: (_event, gestureState) => {
          if (
            gestureState.dy >= EMOJI_PICKER_DISMISS_DY_THRESHOLD ||
            gestureState.vy >= EMOJI_PICKER_DISMISS_VY_THRESHOLD
          ) {
            closeComposerEmojiPicker();
          }
        },
        onPanResponderTerminationRequest: () => true,
      }),
    [closeComposerEmojiPicker, composerEmojiPickerVisible]
  );

  const handleEmojiPress = useCallback(() => {
    if (!canFocusInput) return;

    setComposerEmojiPickerVisible((previous) => {
      if (previous) {
        messageInputRef.current?.focus();
        return false;
      }

      setComposerEmojiCategory('recent');
      setComposerEmojiSearch('');
      Keyboard.dismiss();
      return true;
    });
  }, [canFocusInput]);

  const handleSelectComposerEmoji = useCallback(
    (emoji: string) => {
      if (selectedQuickMessage) {
        setQuickMessageInputDirty(true);
      }

      setInput((previous) => `${previous}${emoji}`);
      setRecentReactionEmojis((previous) => {
        const next = [emoji, ...previous.filter((item) => item !== emoji)];
        return next.slice(0, 40);
      });
    },
    [selectedQuickMessage]
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={keyboardAvoidingBehavior}
      keyboardVerticalOffset={getKeyboardVerticalOffset(0)}
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

          <Pressable
            style={styles.chatHeaderContactWrap}
            onPress={handlePressChatHeaderContact}
            accessibilityRole="button"
            accessibilityLabel={pt.contact}
          >
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
                    onPress={(event) => {
                      event.stopPropagation();
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
          </Pressable>

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

      <View style={styles.chatBody} onTouchStart={handleChatBodyTouchStart}>
        {loading ? (
          <ChatRoomSkeleton />
        ) : (
          <>
            <FlatList
              key={chatInfo.chat_id}
              ref={listRef}
              data={messagesWithSeparators}
              keyboardDismissMode="on-drag"
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
                const canSwipeReply =
                  canComposeInChat &&
                  !isHistoryReadonly &&
                  !shouldObfuscateContent &&
                  canInteractWithMessage(item.message);
                const galleryMembership =
                  imageGalleryLookup.membershipByMessageId[
                    item.message.message_id
                  ];
                const imageGallery = galleryMembership
                  ? (imageGalleryLookup.groupsById[galleryMembership.groupId] ??
                    null)
                  : null;

                const bubble = (
                  <MessageBubble
                    msg={item.message}
                    fromMe={item.message.type_user !== ETypeUserChat.client}
                    chatInfo={chatInfo}
                    imageGallery={imageGallery}
                    currentUserName={currentUserName}
                    highlighted={
                      highlightedMessageId === item.message.message_id ||
                      messageActionTarget?.message_id ===
                        item.message.message_id
                    }
                    canInteract={canOpenActionsForMessage(item.message)}
                    onOpenActions={(message) => {
                      closeOpenedMessageSwipeable();
                      setMessageActionTarget(message);
                      setMessageOverlayAnchor({
                        showReactions: canInteractWithMessage(message),
                      });
                      setReactionPickerVisible(false);
                    }}
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
                    onPressContactCard={handlePressMessageContactCard}
                    onPressContactsGroup={handlePressMessageContactsGroup}
                    onTemplateButtonPress={handleTemplateButtonPress}
                    disableTemplateButtons={!canComposeInChat || sending}
                    obfuscateContent={shouldObfuscateContent}
                  />
                );

                if (!canSwipeReply) {
                  return bubble;
                }

                let rowSwipeable: Swipeable | null = null;

                return (
                  <Swipeable
                    ref={(instance) => {
                      rowSwipeable = instance;
                    }}
                    friction={MESSAGE_SWIPE_FRICTION}
                    leftThreshold={MESSAGE_SWIPE_REPLY_THRESHOLD}
                    overshootLeft={false}
                    dragOffsetFromLeftEdge={MESSAGE_SWIPE_DRAG_OFFSET}
                    containerStyle={styles.messageSwipeContainer}
                    onSwipeableWillOpen={(direction) => {
                      if (direction !== 'left') return;
                      if (
                        openedMessageSwipeableRef.current &&
                        openedMessageSwipeableRef.current !== rowSwipeable
                      ) {
                        openedMessageSwipeableRef.current.close();
                      }
                    }}
                    onSwipeableOpen={(direction) => {
                      if (direction !== 'left') return;
                      openedMessageSwipeableRef.current = rowSwipeable;
                      rowSwipeable?.close();
                      handleReplyFromMessage(item.message);
                    }}
                    onSwipeableClose={(direction) => {
                      if (
                        direction === 'left' &&
                        openedMessageSwipeableRef.current === rowSwipeable
                      ) {
                        openedMessageSwipeableRef.current = null;
                      }
                    }}
                    renderLeftActions={(progress, dragX) => {
                      const translateX = dragX.interpolate({
                        inputRange: [0, MESSAGE_SWIPE_REPLY_ACTION_WIDTH],
                        outputRange: [-MESSAGE_SWIPE_REPLY_ACTION_WIDTH, 0],
                        extrapolate: 'clamp',
                      });
                      const opacity = progress.interpolate({
                        inputRange: [0, 0.35, 1],
                        outputRange: [0.1, 0.65, 1],
                        extrapolate: 'clamp',
                      });

                      return (
                        <Animated.View
                          style={[
                            styles.messageSwipeRightAction,
                            {
                              width: MESSAGE_SWIPE_REPLY_ACTION_WIDTH,
                              opacity,
                              transform: [{ translateX }],
                            },
                          ]}
                        >
                          <View style={styles.messageSwipeRightActionInner}>
                            <Ionicons
                              name="arrow-undo-outline"
                              size={18}
                              color={colors.primary}
                            />
                            <Text style={styles.messageSwipeRightActionText}>
                              {pt.reply}
                            </Text>
                          </View>
                        </Animated.View>
                      );
                    }}
                  >
                    {bubble}
                  </Swipeable>
                );
              }}
              onScrollToIndexFailed={handleScrollToIndexFailed}
              onScroll={handleListScroll}
              onScrollBeginDrag={handleMessageListScrollBeginDrag}
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
        <>
          {replyComposerPreview ? (
            <View style={styles.replyComposerPreview}>
              <View style={styles.replyComposerPreviewBar} />
              {replyComposerPreview.thumbUri ? (
                <Image
                  source={{ uri: replyComposerPreview.thumbUri }}
                  style={styles.replyComposerPreviewMedia}
                  resizeMode="cover"
                />
              ) : replyComposerPreview.type === EMessageType.contact_card ||
                replyComposerPreview.type === EMessageType.contacts ? (
                replyComposerPreview.contactPhotoUri ? (
                  <Image
                    source={{ uri: replyComposerPreview.contactPhotoUri }}
                    style={styles.replyComposerPreviewContactAvatar}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.replyComposerPreviewDocIcon}>
                    <Ionicons
                      name={
                        replyComposerPreview.showContactGroupIcon
                          ? 'people-outline'
                          : 'person-outline'
                      }
                      size={20}
                      color={colors.primary}
                    />
                  </View>
                )
              ) : replyComposerPreview.showDocumentIcon ? (
                <View style={styles.replyComposerPreviewDocIcon}>
                  <Ionicons
                    name="document-text-outline"
                    size={20}
                    color={colors.primary}
                  />
                </View>
              ) : replyComposerPreview.showVideoIcon ? (
                <View style={styles.replyComposerPreviewDocIcon}>
                  <Ionicons
                    name="play-circle-outline"
                    size={20}
                    color={colors.primary}
                  />
                </View>
              ) : replyComposerPreview.showAudioIcon ? (
                <View style={styles.replyComposerPreviewDocIcon}>
                  <Ionicons
                    name="mic-outline"
                    size={20}
                    color={colors.primary}
                  />
                </View>
              ) : replyComposerPreview.showLocationIcon ? (
                <View style={styles.replyComposerPreviewDocIcon}>
                  <Ionicons
                    name="location-outline"
                    size={20}
                    color={colors.primary}
                  />
                </View>
              ) : replyComposerPreview.showStickerFallbackIcon ? (
                <View style={styles.replyComposerPreviewDocIcon}>
                  <Ionicons
                    name="pricetag-outline"
                    size={20}
                    color={colors.primary}
                  />
                </View>
              ) : null}

              <View style={styles.replyComposerPreviewContent}>
                <Text style={styles.replyComposerPreviewName} numberOfLines={1}>
                  {replyComposerPreview.name}
                </Text>
                <Text style={styles.replyComposerPreviewText} numberOfLines={1}>
                  {replyComposerPreview.text}
                </Text>
                {replyComposerPreview.meta ? (
                  <Text
                    style={styles.replyComposerPreviewMeta}
                    numberOfLines={1}
                  >
                    {replyComposerPreview.meta}
                  </Text>
                ) : null}
              </View>
              <Pressable
                style={styles.replyComposerPreviewClose}
                onPress={() => setReplyMessageTarget(null)}
                accessibilityLabel={pt.cancel_reply}
              >
                <Ionicons name="close" size={18} color={colors.grey700} />
              </Pressable>
            </View>
          ) : null}

          {showQuickMessageList &&
          quickMessageTemplates.length > 0 &&
          !selectedQuickMessage ? (
            <View style={styles.quickMessageListCard}>
              {quickMessageLoading ? (
                <View style={styles.quickMessageListLoading}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : null}
              <ScrollView
                style={styles.quickMessageListScroll}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={
                  Platform.OS === 'ios' ? 'interactive' : 'on-drag'
                }
              >
                {quickMessageTemplates.map((template) => (
                  <Pressable
                    key={template.message_template_id}
                    style={styles.quickMessageListItem}
                    onPress={() => {
                      void handleSelectQuickMessage(template);
                    }}
                  >
                    <Text style={styles.quickMessageListCommand}>
                      /{template.command}
                    </Text>
                    <Text
                      style={styles.quickMessageListMessage}
                      numberOfLines={1}
                    >
                      {replaceTagsInQuickMessage(template.message) ||
                        pt.quick_message_no_text}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {selectedQuickMessage ? (
            <View style={styles.quickMessagePreviewCard}>
              <View style={styles.quickMessagePreviewHeader}>
                <Text style={styles.quickMessagePreviewTitle} numberOfLines={1}>
                  /{selectedQuickMessage.command}
                </Text>
                <Pressable
                  style={styles.quickMessagePreviewCloseBtn}
                  onPress={handleCancelQuickMessage}
                  accessibilityLabel={pt.close}
                >
                  <Ionicons name="close" size={17} color={colors.grey700} />
                </Pressable>
              </View>

              {selectedQuickMessage.type === EMessageType.image &&
              selectedQuickMessage.attachment_url ? (
                <Image
                  source={{
                    uri:
                      resolveMediaUri(selectedQuickMessage.attachment_url) ??
                      selectedQuickMessage.attachment_url,
                  }}
                  style={styles.quickMessagePreviewImage}
                  resizeMode="cover"
                />
              ) : null}

              {(selectedQuickMessage.type === EMessageType.video ||
                selectedQuickMessage.type === EMessageType.audio) &&
              selectedQuickMessage.attachment_url ? (
                <View style={styles.quickMessagePreviewMediaBadge}>
                  <Ionicons
                    name={
                      selectedQuickMessage.type === EMessageType.video
                        ? 'videocam-outline'
                        : 'musical-notes-outline'
                    }
                    size={16}
                    color={colors.primary}
                  />
                  <Text style={styles.quickMessagePreviewMediaText}>
                    {selectedQuickMessage.type === EMessageType.video
                      ? pt.videos
                      : pt.audio}
                  </Text>
                </View>
              ) : null}

              <ScrollView
                style={styles.quickMessagePreviewTextScroll}
                contentContainerStyle={
                  styles.quickMessagePreviewTextScrollContent
                }
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={
                  Platform.OS === 'ios' ? 'interactive' : 'on-drag'
                }
              >
                <Text style={styles.quickMessagePreviewText}>
                  {quickMessagePreviewText || pt.quick_message_no_text}
                </Text>
              </ScrollView>

              <View style={styles.quickMessagePreviewActions}>
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={handleCancelQuickMessage}
                >
                  <Text style={styles.secondaryBtnText}>{pt.cancel}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

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
                      <Ionicons
                        name="trash-outline"
                        size={20}
                        color="#EF4444"
                      />
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
                    onChangeText={handleComposerInputChange}
                    onPressIn={focusComposerInput}
                    keyboardType="default"
                    multiline
                    maxLength={65535}
                    editable={
                      canComposeInChat &&
                      !sendingQuickMessage &&
                      !sending &&
                      !sendingCapturedMedia &&
                      !isPreparingRecording &&
                      !isRecordingVoice
                    }
                  />
                  {!showRecordingHoldOverlay ? (
                    <Pressable
                      style={[
                        styles.emojiInputBtn,
                        composerEmojiPickerVisible &&
                          styles.emojiInputBtnActive,
                      ]}
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

                {shouldShowComposerSendButton ? (
                  <Pressable
                    style={[
                      styles.sendBtn,
                      isComposerSendDisabled && styles.sendBtnDisabled,
                    ]}
                    onPress={handleSend}
                    disabled={isComposerSendDisabled}
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
                                transform: [
                                  { translateY: recordingHintOffset },
                                ],
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

          {composerEmojiPickerVisible ? (
            <View style={styles.composerEmojiPickerWrap}>
              <View style={styles.composerEmojiPickerCard}>
                <View
                  style={styles.reactionPickerHandle}
                  {...composerEmojiDismissPanResponder.panHandlers}
                />

                <View style={styles.reactionPickerSearchWrap}>
                  <Ionicons
                    name="search-outline"
                    size={22}
                    color={colors.grey500}
                  />
                  <TextInput
                    value={composerEmojiSearch}
                    onChangeText={setComposerEmojiSearch}
                    placeholder="Pesquisar emoji"
                    placeholderTextColor={colors.grey500}
                    style={styles.reactionPickerSearchInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>

                <ScrollView
                  style={styles.reactionPickerEmojiScroll}
                  contentContainerStyle={styles.reactionPickerEmojiGrid}
                  showsVerticalScrollIndicator
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode={
                    Platform.OS === 'ios' ? 'interactive' : 'on-drag'
                  }
                >
                  {composerEmojisByCategory.map((emoji, index) => (
                    <Pressable
                      key={`composer-emoji-${composerEmojiCategory}-${emoji}-${index}`}
                      style={styles.reactionPickerEmojiBtn}
                      onPress={() => handleSelectComposerEmoji(emoji)}
                    >
                      <Text style={styles.reactionPickerEmojiText}>
                        {emoji}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>

                <View style={styles.reactionPickerTabs}>
                  {reactionCategoryConfigs.map((category) => (
                    <Pressable
                      key={`composer-reaction-category-${category.key}`}
                      style={[
                        styles.reactionPickerTab,
                        composerEmojiCategory === category.key &&
                          styles.reactionPickerTabActive,
                      ]}
                      onPress={() => setComposerEmojiCategory(category.key)}
                    >
                      <Ionicons
                        name={category.icon}
                        size={21}
                        color={
                          composerEmojiCategory === category.key
                            ? colors.primary
                            : colors.grey600
                        }
                      />
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
          ) : null}
        </>
      )}

      {isOpeningVideoEditor ? (
        <View style={styles.videoEditorOpeningOverlay}>
          <View style={styles.videoEditorOpeningCard}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.videoEditorOpeningText}>
              {pt.video_editor_opening}
            </Text>
          </View>
        </View>
      ) : null}

      <Modal
        visible={messageActionTarget !== null}
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        animationType="fade"
        onRequestClose={closeMessageOverlay}
      >
        <KeyboardAvoidingView
          style={styles.keyboardAvoiding}
          behavior={keyboardAvoidingBehavior}
          keyboardVerticalOffset={getKeyboardVerticalOffset(insets.bottom + 8)}
        >
          <View
            style={[
              styles.messageOverlayRoot,
              { paddingBottom: insets.bottom },
            ]}
          >
            <Pressable
              style={styles.messageOverlayBackdropPress}
              onPress={() => {
                if (reactionPickerVisible) {
                  setReactionPickerVisible(false);
                  return;
                }
                closeMessageOverlay();
              }}
            >
              {hasNativeBlurSupport ? (
                <BlurView
                  intensity={40}
                  tint="dark"
                  style={styles.messageOverlayBlur}
                />
              ) : null}
              <View style={styles.messageOverlayDim} />
            </Pressable>

            <View style={styles.messageOverlayCenterWrap}>
              {messageOverlayAnchor?.showReactions !== false ? (
                <View style={styles.messageOverlayReactions}>
                  {QUICK_REACTIONS.map((emoji) => (
                    <Pressable
                      key={`overlay-reaction-${emoji}`}
                      style={styles.messageOverlayReactionBtn}
                      onPress={() => {
                        void handleQuickReaction(emoji);
                      }}
                    >
                      <Text style={styles.messageOverlayReactionEmoji}>
                        {emoji}
                      </Text>
                    </Pressable>
                  ))}
                  <Pressable
                    style={styles.messageOverlayReactionMoreBtn}
                    onPress={() => {
                      setReactionCategory('recent');
                      setReactionSearch('');
                      setReactionPickerVisible(true);
                    }}
                    accessibilityLabel={pt.more_actions}
                  >
                    <Ionicons name="add" size={18} color={colors.grey700} />
                  </Pressable>
                </View>
              ) : null}

              {messageActionTarget ? (
                <ScrollView
                  style={styles.messageOverlaySelectedScroll}
                  contentContainerStyle={
                    styles.messageOverlayContentScrollInner
                  }
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.messageOverlaySelectedWrap}>
                    <MessageBubble
                      msg={messageActionTarget}
                      fromMe={
                        messageActionTarget.type_user !== ETypeUserChat.client
                      }
                      chatInfo={chatInfo}
                      currentUserName={currentUserName}
                      highlighted
                      canInteract={false}
                      onOpenActions={() => {}}
                      onPressQuoted={null}
                      resolvedContactDisplay={
                        resolvedContactCards[messageActionTarget.message_id]
                      }
                      audioCtrl={audioCtrl}
                      imageGallery={null}
                      onOpenImage={openImageViewer}
                      onOpenVideo={openVideoViewer}
                      onTemplateButtonPress={handleTemplateButtonPress}
                      disableTemplateButtons={!canComposeInChat || sending}
                      forceCollapsedLongText
                      obfuscateContent={shouldObfuscateContent}
                    />
                  </View>
                </ScrollView>
              ) : null}

              <View style={styles.messageOverlayMenu}>
                {messageActions.map((action) => (
                  <Pressable
                    key={action.key}
                    style={styles.messageOverlayMenuItem}
                    onPress={action.onPress}
                  >
                    <Text
                      style={[
                        styles.messageOverlayMenuItemText,
                        action.danger && styles.menuItemTextDanger,
                      ]}
                    >
                      {action.label}
                    </Text>
                    <Ionicons
                      name={action.icon}
                      size={20}
                      color={action.danger ? colors.error : colors.grey700}
                    />
                  </Pressable>
                ))}
              </View>

              {reactionPickerVisible ? (
                <View style={styles.reactionPickerOverlayInline}>
                  <View style={styles.reactionPickerCard}>
                    <View style={styles.reactionPickerHandle} />

                    <View style={styles.reactionPickerSearchWrap}>
                      <Ionicons
                        name="search-outline"
                        size={22}
                        color={colors.grey500}
                      />
                      <TextInput
                        value={reactionSearch}
                        onChangeText={setReactionSearch}
                        placeholder="Pesquisar emoji"
                        placeholderTextColor={colors.grey500}
                        style={styles.reactionPickerSearchInput}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    </View>

                    <ScrollView
                      style={styles.reactionPickerEmojiScroll}
                      contentContainerStyle={styles.reactionPickerEmojiGrid}
                      showsVerticalScrollIndicator
                    >
                      {reactionEmojisByCategory.map((emoji, index) => (
                        <Pressable
                          key={`reaction-picker-${reactionCategory}-${emoji}-${index}`}
                          style={styles.reactionPickerEmojiBtn}
                          onPress={() => {
                            setReactionPickerVisible(false);
                            void handleQuickReaction(emoji);
                          }}
                        >
                          <Text style={styles.reactionPickerEmojiText}>
                            {emoji}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>

                    <View style={styles.reactionPickerTabs}>
                      {reactionCategoryConfigs.map((category) => (
                        <Pressable
                          key={`reaction-category-${category.key}`}
                          style={[
                            styles.reactionPickerTab,
                            reactionCategory === category.key &&
                              styles.reactionPickerTabActive,
                          ]}
                          onPress={() => setReactionCategory(category.key)}
                        >
                          <Ionicons
                            name={category.icon}
                            size={21}
                            color={
                              reactionCategory === category.key
                                ? colors.primary
                                : colors.grey600
                            }
                          />
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </View>
              ) : null}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <BottomSheetModal
        visible={editingMessageTarget !== null}
        onClose={() => setEditingMessageTarget(null)}
        title={pt.edit_message}
        cardStyle={styles.annotationSheetCard}
        footer={
          <>
            <Pressable
              style={styles.secondaryBtn}
              onPress={dismissKeyboardAnd(() => setEditingMessageTarget(null))}
            >
              <Text style={styles.secondaryBtnText}>{pt.cancel}</Text>
            </Pressable>
            <Pressable
              style={[
                styles.primaryBtn,
                (!editingMessageText.trim() || savingEditedMessage) &&
                  styles.sendBtnDisabled,
              ]}
              onPress={dismissKeyboardAnd(() => {
                void handleSaveEditedMessage();
              })}
              disabled={!editingMessageText.trim() || savingEditedMessage}
            >
              {savingEditedMessage ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <Text style={styles.primaryBtnText}>{pt.save}</Text>
              )}
            </Pressable>
          </>
        }
      >
        <TextInput
          value={editingMessageText}
          onChangeText={setEditingMessageText}
          style={styles.annotationInput}
          placeholder={pt.type_message}
          placeholderTextColor={colors.grey500}
          multiline
          maxLength={65535}
        />
      </BottomSheetModal>

      <Modal
        visible={viewingEditHistoryMessage !== null}
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        animationType="fade"
        onRequestClose={() => setViewingEditHistoryMessage(null)}
      >
        <View
          style={[styles.editHistoryOverlay, { paddingBottom: insets.bottom }]}
        >
          <Pressable
            style={styles.editHistoryBackdrop}
            onPress={() => setViewingEditHistoryMessage(null)}
          />
          <View style={styles.editHistoryCard}>
            <View style={styles.editHistoryHeader}>
              <Text style={styles.editHistoryTitle}>
                {pt.chat_edit_history}
              </Text>
              <Pressable onPress={() => setViewingEditHistoryMessage(null)}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.editHistoryList}
              contentContainerStyle={styles.editHistoryListContent}
            >
              {viewingEditHistoryMessage
                ? getMessageEditHistory(viewingEditHistoryMessage).map(
                    (item, index) => (
                      <View
                        key={`edit-history-${index}-${item.date}`}
                        style={[
                          styles.editHistoryItem,
                          index === 0 &&
                            !item.isOriginal &&
                            styles.editHistoryItemCurrent,
                          item.isOriginal && styles.editHistoryItemOriginal,
                        ]}
                      >
                        <View style={styles.editHistoryItemHeader}>
                          <Text style={styles.editHistoryItemLabel}>
                            {item.isOriginal
                              ? pt.chat_original_message
                              : pt.chat_edited_version}
                          </Text>
                          <Text style={styles.editHistoryItemDate}>
                            {formatMessageTime(item.date)}
                          </Text>
                        </View>
                        <Text style={styles.editHistoryItemText}>
                          {item.text}
                        </Text>
                      </View>
                    )
                  )
                : null}
            </ScrollView>

            <View style={styles.editHistoryFooter}>
              <Pressable
                style={styles.primaryBtn}
                onPress={() => setViewingEditHistoryMessage(null)}
              >
                <Text style={styles.primaryBtnText}>{pt.close}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <BottomSheetModal
        visible={forwardModalVisible}
        onClose={handleForwardRequestClose}
        title={pt.forward}
        cardStyle={styles.searchSheetCard}
        noScroll
        extraContent={
          <SelectSheet
            visible={forwardPickerKind === 'channel'}
            title={pt.channel}
            options={forwardPickerOptions}
            selectedValue={selectedForwardChannelId}
            emptyText={pt.no_results_found}
            searchPlaceholder={pt.select_search_placeholder}
            onRequestClose={dismissKeyboardAnd(() =>
              setForwardPickerKind(null)
            )}
            onSelectValue={(value) => {
              setSelectedForwardChannelId(value);
              setForwardPickerKind(null);
            }}
          />
        }
        footer={
          <>
            <Pressable
              style={styles.secondaryBtn}
              onPress={dismissKeyboardAnd(closeForwardModal)}
            >
              <Text style={styles.secondaryBtnText}>{pt.cancel}</Text>
            </Pressable>
            <Pressable
              style={[
                styles.primaryBtn,
                (!canInteractWithForwardTargets ||
                  forwardSelectedIds.length === 0 ||
                  forwardSubmitting) &&
                  styles.sendBtnDisabled,
              ]}
              onPress={dismissKeyboardAnd(() => {
                void handleSubmitForward();
              })}
              disabled={
                !canInteractWithForwardTargets ||
                forwardSelectedIds.length === 0 ||
                forwardSubmitting
              }
            >
              {forwardSubmitting ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <Text style={styles.primaryBtnText}>{pt.forward}</Text>
              )}
            </Pressable>
          </>
        }
      >
        <View style={styles.formField}>
          <SelectField
            label={pt.channel}
            valueLabel={selectedForwardChannel?.title ?? null}
            placeholder={pt.transfer_select_channel}
            onPress={dismissKeyboardAnd(() => setForwardPickerKind('channel'))}
            disabled={forwardChannelsLoading || forwardChannels.length === 0}
            loading={forwardChannelsLoading}
          />
        </View>

        <View style={styles.forwardStatusRow}>
          {(
            [
              { value: 'in_chat', label: pt.in_chat },
              { value: 'queue', label: pt.queue },
              { value: 'all', label: pt.all },
            ] as const
          ).map((option) => (
            <Pressable
              key={option.value}
              style={[
                styles.forwardStatusChip,
                forwardStatus === option.value &&
                  styles.forwardStatusChipActive,
                !canInteractWithForwardTargets &&
                  styles.forwardStatusChipDisabled,
              ]}
              disabled={!canInteractWithForwardTargets}
              onPress={dismissKeyboardAnd(() => {
                setForwardStatus(option.value);
              })}
            >
              <Text
                style={[
                  styles.forwardStatusChipText,
                  forwardStatus === option.value &&
                    styles.forwardStatusChipTextActive,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.searchInputWrap}>
          <Ionicons name="search-outline" size={18} color={colors.grey600} />
          <TextInput
            style={styles.searchInput}
            value={forwardSearch}
            onChangeText={setForwardSearch}
            placeholder={pt.search_contacts}
            placeholderTextColor={colors.grey500}
            maxLength={120}
            editable={canInteractWithForwardTargets}
          />
        </View>

        {forwardChannelsLoading ? (
          <View style={styles.modalLoadingWrap}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : !canInteractWithForwardTargets ? (
          <Text style={styles.emptyText}>{pt.channel_required}</Text>
        ) : forwardLoading ? (
          <View style={styles.modalLoadingWrap}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : (
          <FlatList
            data={forwardItems}
            keyExtractor={(item) => item.value}
            contentContainerStyle={styles.bottomSheetList}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onEndReached={handleLoadMoreForwardTargets}
            onEndReachedThreshold={0.25}
            renderItem={({ item }) => {
              const selected = forwardSelectedIds.includes(item.value);
              return (
                <Pressable
                  style={styles.forwardTargetRow}
                  onPress={dismissKeyboardAnd(() =>
                    toggleForwardTarget(item.value)
                  )}
                >
                  <Text style={styles.forwardTargetText} numberOfLines={2}>
                    {item.title}
                  </Text>
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
            ListFooterComponent={
              forwardLoadingMore ? (
                <View style={styles.modalLoadingWrap}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : null
            }
          />
        )}

        <Text style={styles.modalHintText}>
          {pt.selected_contacts
            .replace('{count}', String(forwardSelectedIds.length))
            .replace('{max}', '∞')}
        </Text>
      </BottomSheetModal>

      <Modal
        visible={menuVisible}
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <Pressable
          style={[styles.menuOverlay, { paddingBottom: insets.bottom }]}
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

      <BottomSheetModal
        visible={attendantsInfoVisible}
        onClose={() => setAttendantsInfoVisible(false)}
        title={pt.attendants_info}
        cardStyle={styles.attendantsInfoSheetCard}
        avoidKeyboard={false}
      >
        {attendantsInfoLoading ? (
          <View style={styles.modalLoadingWrap}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : (
          <>
            {attendantsPrimaryUser ? (
              <View style={styles.attendantsPrimaryCard}>
                <View style={styles.attendantsRowHeader}>
                  <AppAvatar
                    uri={attendantsPrimaryUser.photo ?? null}
                    size={42}
                    iconName="person"
                    iconSize={20}
                  />
                  <View style={styles.attendantsUserMain}>
                    <View style={styles.attendantsPrimaryTitleRow}>
                      <Text style={styles.attendantsPrimaryName}>
                        {attendantsPrimaryUser.name}
                      </Text>
                      <View style={styles.attendantsPrimaryBadge}>
                        <Text style={styles.attendantsPrimaryBadgeText}>
                          {pt.primary_attendant}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.attendantsEnteredAtText}>
                      {pt.entered_at_label}:{' '}
                      {formatAttendantEnteredAt(
                        attendantsPrimaryUser.entered_at
                      )}
                    </Text>
                  </View>
                </View>
              </View>
            ) : (
              <Text style={styles.emptyText}>
                {pt.primary_attendant_not_available}
              </Text>
            )}

            <View style={styles.attendantsSectionDivider} />

            <Text style={styles.attendantsSectionTitle}>
              {pt.secondary_attendants}
            </Text>

            {attendantsSecondaryUsers.length > 0 ? (
              attendantsSecondaryUsers.map((secondaryUser) => (
                <View
                  key={secondaryUser.id}
                  style={styles.attendantsSecondaryRow}
                >
                  <AppAvatar
                    uri={secondaryUser.photo ?? null}
                    size={36}
                    iconName="person"
                    iconSize={18}
                  />
                  <View style={styles.attendantsUserMain}>
                    <Text style={styles.attendantsSecondaryName}>
                      {secondaryUser.name}
                    </Text>
                    <Text style={styles.attendantsEnteredAtText}>
                      {pt.entered_at_label}:{' '}
                      {formatAttendantEnteredAt(secondaryUser.entered_at)}
                    </Text>
                  </View>
                </View>
              ))
            ) : (
              <Text style={styles.emptyText}>{pt.no_secondary_attendants}</Text>
            )}
          </>
        )}
      </BottomSheetModal>

      <BottomSheetModal
        visible={closeServiceModalVisible}
        onClose={() => setCloseServiceModalVisible(false)}
        title={pt.close_service}
        cardStyle={styles.annotationSheetCard}
        avoidKeyboard={false}
        footer={
          <>
            <Pressable
              style={styles.secondaryBtn}
              onPress={() => setCloseServiceModalVisible(false)}
            >
              <Text style={styles.secondaryBtnText}>{pt.cancel}</Text>
            </Pressable>
            <Pressable
              style={styles.closeServiceConfirmBtn}
              onPress={dismissKeyboardAnd(() => void confirmCloseService())}
            >
              <Text style={styles.primaryBtnText}>{pt.close_service}</Text>
            </Pressable>
          </>
        }
      >
        <Text style={styles.closeServiceMessage}>
          {pt.close_service_confirmation}
        </Text>

        {shouldShowCloseServiceSendMessageToggle ? (
          <View style={styles.closeServiceToggleRow}>
            <View style={styles.closeServiceToggleTextWrap}>
              <Text style={styles.closeServiceToggleLabel}>
                {pt.close_service_send_message_toggle_label}
              </Text>
              <Text style={styles.closeServiceToggleDescription}>
                {pt.close_service_send_message_toggle_description}
              </Text>
            </View>
            <Switch
              value={closeServiceSendMessageOnFinishAttendance}
              onValueChange={setCloseServiceSendMessageOnFinishAttendance}
              trackColor={{
                false: colors.grey400,
                true: colors.primary,
              }}
              thumbColor="#FFFFFF"
            />
          </View>
        ) : null}
      </BottomSheetModal>

      <BottomSheetModal
        visible={protocolModalVisible}
        onClose={() => setProtocolModalVisible(false)}
        title={pt.protocols}
        avoidKeyboard={false}
        noScroll
      >
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
                <Text style={styles.protocolTypeBadgeText}>{item.type}</Text>
              </View>
              <Text style={styles.protocolRowText}>{item.protocol}</Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>{pt.no_results_found}</Text>
          }
        />
      </BottomSheetModal>

      <BottomSheetModal
        visible={labelModalVisible}
        onClose={() => setLabelModalVisible(false)}
        title={pt.label}
        avoidKeyboard={false}
        noScroll
        footer={
          <>
            <Pressable style={styles.secondaryBtn} onPress={handleClearLabels}>
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
          </>
        }
      >
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
      </BottomSheetModal>

      <BottomSheetModal
        visible={searchModalVisible}
        onClose={() => setSearchModalVisible(false)}
        title={pt.search_messages}
        cardStyle={styles.searchSheetCard}
        noScroll
      >
        <View style={styles.searchInputWrap}>
          <Ionicons name="search-outline" size={18} color={colors.grey600} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={pt.search_messages_placeholder}
            placeholderTextColor={colors.grey500}
            maxLength={120}
          />
        </View>

        {debouncedSearchQuery.length > 0 && debouncedSearchQuery.length < 3 ? (
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
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onEndReached={handleLoadMoreSearchResults}
            onEndReachedThreshold={0.25}
            renderItem={({ item }) => (
              <Pressable
                style={styles.searchResultRow}
                onPress={dismissKeyboardAnd(() =>
                  handleSelectSearchedMessage(item.message_id)
                )}
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
      </BottomSheetModal>

      <BottomSheetModal
        visible={attendanceHistoryVisible}
        onClose={() => setAttendanceHistoryVisible(false)}
        title={pt.attendance_history}
        cardStyle={styles.searchSheetCard}
        avoidKeyboard={false}
        noScroll
      >
        {attendanceHistoryLoading ? (
          <AttendanceHistorySkeleton rows={ATTENDANCE_HISTORY_SKELETON_ROWS} />
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
              <Text style={styles.emptyText}>{pt.no_attendance_history}</Text>
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
      </BottomSheetModal>

      <BottomSheetModal
        visible={transferModalVisible}
        onClose={() => setTransferModalVisible(false)}
        title={pt.transfer}
        cardStyle={styles.transferSheetCard}
        noScroll
        extraContent={
          <SelectSheet
            visible={transferPickerKind !== null}
            title={transferPickerTitle}
            options={transferPickerItems}
            selectedValue={selectedTransferPickerValue}
            emptyText={pt.no_results_found}
            searchPlaceholder={pt.select_search_placeholder}
            onRequestClose={dismissKeyboardAnd(() =>
              setTransferPickerKind(null)
            )}
            onSelectValue={dismissKeyboardAnd((value: string) => {
              handleSelectTransferPickerValue(value);
            })}
          />
        }
        footer={
          <>
            <Pressable
              style={styles.secondaryBtn}
              onPress={dismissKeyboardAnd(() => setTransferModalVisible(false))}
            >
              <Text style={styles.secondaryBtnText}>{pt.cancel}</Text>
            </Pressable>
            <Pressable
              style={[
                styles.primaryBtn,
                isTransferring && styles.sendBtnDisabled,
              ]}
              onPress={dismissKeyboardAnd(() => {
                void submitTransfer();
              })}
              disabled={isTransferring}
            >
              {isTransferring ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <Text style={styles.primaryBtnText}>{pt.transfer}</Text>
              )}
            </Pressable>
          </>
        }
      >
        <ScrollView
          style={styles.transferFormScroll}
          contentContainerStyle={styles.transferFormContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={
            Platform.OS === 'ios' ? 'interactive' : 'on-drag'
          }
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.formField}>
            <SelectField
              label={pt.channel}
              valueLabel={selectedTransferChannel?.title ?? null}
              placeholder={pt.transfer_select_channel}
              onPress={dismissKeyboardAnd(() =>
                setTransferPickerKind('channel')
              )}
              loading={isLoadingTransferChannels}
              disabled={isLoadingTransferChannels}
            />
          </View>

          <View style={styles.formField}>
            <SelectField
              label={pt.transfer_to}
              valueLabel={
                transferType === 'user'
                  ? pt.transfer_type_user
                  : transferType === 'sector'
                    ? pt.transfer_type_sector
                    : null
              }
              placeholder={pt.transfer_to_placeholder}
              onPress={dismissKeyboardAnd(() => setTransferPickerKind('type'))}
            />
          </View>

          {transferType === 'user' ? (
            <View style={styles.formField}>
              <SelectField
                label={pt.transfer_type_user}
                valueLabel={selectedTransferUser?.name ?? null}
                placeholder={pt.transfer_select_user}
                onPress={dismissKeyboardAnd(() =>
                  setTransferPickerKind('user')
                )}
                loading={isLoadingTransferUsers}
                disabled={isLoadingTransferUsers}
              />
            </View>
          ) : null}

          {transferType === 'sector' ? (
            <>
              <View style={styles.formField}>
                <SelectField
                  label={pt.sector}
                  valueLabel={selectedTransferSector?.name ?? null}
                  placeholder={pt.transfer_select_sector}
                  onPress={dismissKeyboardAnd(() =>
                    setTransferPickerKind('sector')
                  )}
                  loading={isLoadingTransferSectors}
                  disabled={isLoadingTransferSectors}
                />
              </View>

              <View style={styles.formField}>
                <SelectField
                  label={pt.transfer_sector_user_optional}
                  valueLabel={selectedTransferSectorUser?.name ?? null}
                  placeholder={pt.transfer_select_sector_user}
                  onPress={dismissKeyboardAnd(() =>
                    setTransferPickerKind('sector_user')
                  )}
                  loading={isLoadingTransferSectorUsers}
                  disabled={isLoadingTransferSectorUsers}
                />
              </View>
            </>
          ) : null}

          <View style={styles.formField}>
            <Text style={styles.formFieldLabel}>{pt.transfer_annotation}</Text>
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

          <View style={styles.closeServiceToggleRow}>
            <View style={styles.closeServiceToggleTextWrap}>
              <Text style={styles.closeServiceToggleLabel}>
                {pt.keep_in_chat}
              </Text>
              <Text style={styles.closeServiceToggleDescription}>
                {pt.keep_in_chat_description}
              </Text>
            </View>
            <Switch
              value={transferKeepInChat}
              onValueChange={setTransferKeepInChat}
              trackColor={{ false: colors.grey300, true: colors.primary }}
              thumbColor={colors.onPrimary}
            />
          </View>
        </ScrollView>
      </BottomSheetModal>

      <Modal
        visible={cameraPickerVisible}
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        animationType="fade"
        onRequestClose={() => setCameraPickerVisible(false)}
      >
        <Pressable
          style={[
            styles.cameraPickerOverlay,
            { paddingBottom: 16 + insets.bottom },
          ]}
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

      <BottomSheetModal
        visible={annotationModalVisible}
        onClose={() => setAnnotationModalVisible(false)}
        title={pt.annotation}
        cardStyle={styles.annotationSheetCard}
        footer={
          <>
            <Pressable
              style={styles.secondaryBtn}
              onPress={dismissKeyboardAnd(() =>
                setAnnotationModalVisible(false)
              )}
            >
              <Text style={styles.secondaryBtnText}>{pt.cancel}</Text>
            </Pressable>
            <Pressable
              style={[
                styles.primaryBtn,
                (!annotationInput.trim() || sendingAnnotation) &&
                  styles.sendBtnDisabled,
              ]}
              onPress={dismissKeyboardAnd(() => {
                void handleSendAnnotation();
              })}
              disabled={!annotationInput.trim() || sendingAnnotation}
            >
              {sendingAnnotation ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <Text style={styles.primaryBtnText}>{pt.send}</Text>
              )}
            </Pressable>
          </>
        }
      >
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
      </BottomSheetModal>

      {/* AI Reply Modal */}
      <BottomSheetModal
        visible={aiReplyTarget !== null}
        onClose={closeAiReplyModal}
        title={pt.chat_ai_reply_title}
        cardStyle={styles.annotationSheetCard}
        avoidKeyboard
        footer={
          aiReplyResult ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                style={[styles.secondaryBtn, { flex: 1 }]}
                onPress={dismissKeyboardAnd(closeAiReplyModal)}
              >
                <Text style={styles.secondaryBtnText}>{pt.cancel}</Text>
              </Pressable>
              <Pressable
                style={[styles.secondaryBtn, { flex: 1 }]}
                onPress={dismissKeyboardAnd(() => {
                  setAiReplyResult(null);
                  setAiReplyError(false);
                })}
              >
                <Text style={styles.secondaryBtnText}>
                  {pt.chat_ai_reply_regenerate}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.primaryBtn, { flex: 1 }]}
                onPress={dismissKeyboardAnd(() => {
                  void handleSendAiReply();
                })}
              >
                <Text style={styles.primaryBtnText}>{pt.send}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                style={[styles.secondaryBtn, { flex: 1 }]}
                onPress={dismissKeyboardAnd(closeAiReplyModal)}
                disabled={aiReplyGenerating}
              >
                <Text style={styles.secondaryBtnText}>{pt.cancel}</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.primaryBtn,
                  { flex: 1 },
                  aiReplyGenerating && styles.sendBtnDisabled,
                ]}
                onPress={dismissKeyboardAnd(() => {
                  void handleGenerateAiReply();
                })}
                disabled={aiReplyGenerating}
              >
                {aiReplyGenerating ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : (
                  <Text style={styles.primaryBtnText}>
                    {pt.chat_ai_reply_generate}
                  </Text>
                )}
              </Pressable>
            </View>
          )
        }
      >
        {/* Reference message preview */}
        <View
          style={{
            backgroundColor: colors.grey200,
            borderRadius: 8,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              color: colors.grey500,
              marginBottom: 4,
            }}
          >
            {pt.chat_ai_reply_reference_message}
          </Text>
          <Text
            style={{ fontSize: 14, color: colors.grey900 }}
            numberOfLines={3}
          >
            {aiReplyTarget?.content?.message ||
              (aiReplyTarget?.content?.type === 'audio'
                ? `🎤 ${pt.audio}`
                : pt.chat_ai_reply_message)}
          </Text>
        </View>

        {/* Response type selector */}
        <View style={{ marginBottom: 12 }}>
          <Text
            style={{
              fontSize: 13,
              color: colors.grey600,
              marginBottom: 6,
            }}
          >
            {pt.chat_ai_reply_response_type}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 8,
                borderWidth: 1,
                borderColor:
                  aiReplyResponseType === 'text'
                    ? colors.primary
                    : colors.grey300,
                backgroundColor:
                  aiReplyResponseType === 'text'
                    ? colors.primary + '15'
                    : 'transparent',
                alignItems: 'center',
              }}
              onPress={() => setAiReplyResponseType('text')}
              disabled={aiReplyGenerating || !!aiReplyResult}
            >
              <Text
                style={{
                  color:
                    aiReplyResponseType === 'text'
                      ? colors.primary
                      : colors.grey600,
                  fontWeight: '600',
                }}
              >
                {pt.chat_ai_reply_type_text}
              </Text>
            </Pressable>
            <Pressable
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 8,
                borderWidth: 1,
                borderColor:
                  aiReplyResponseType === 'audio'
                    ? colors.primary
                    : colors.grey300,
                backgroundColor:
                  aiReplyResponseType === 'audio'
                    ? colors.primary + '15'
                    : 'transparent',
                alignItems: 'center',
              }}
              onPress={() => setAiReplyResponseType('audio')}
              disabled={aiReplyGenerating || !!aiReplyResult}
            >
              <Text
                style={{
                  color:
                    aiReplyResponseType === 'audio'
                      ? colors.primary
                      : colors.grey600,
                  fontWeight: '600',
                }}
              >
                {pt.chat_ai_reply_type_audio}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Instructions input */}
        <TextInput
          value={aiReplyInstructions}
          onChangeText={setAiReplyInstructions}
          style={styles.annotationInput}
          placeholder={pt.chat_ai_reply_instructions_placeholder}
          placeholderTextColor={colors.grey500}
          multiline
          maxLength={1000}
          editable={!aiReplyGenerating}
        />

        {/* Generating indicator */}
        {aiReplyGenerating && (
          <View style={{ alignItems: 'center', paddingVertical: 16 }}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text
              style={{
                marginTop: 8,
                fontSize: 13,
                color: colors.grey500,
              }}
            >
              {pt.chat_ai_reply_generating}
            </Text>
          </View>
        )}

        {/* Error */}
        {aiReplyError && !aiReplyGenerating && (
          <View
            style={{
              backgroundColor: '#FEE2E2',
              borderRadius: 8,
              padding: 12,
              marginTop: 8,
            }}
          >
            <Text style={{ color: '#DC2626', fontSize: 13 }}>
              {pt.chat_ai_reply_error}
            </Text>
          </View>
        )}

        {/* Result preview */}
        {aiReplyResult && (
          <View style={{ marginTop: 12 }}>
            <Text
              style={{
                fontSize: 11,
                color: colors.grey500,
                marginBottom: 6,
              }}
            >
              {pt.chat_ai_reply_preview}
            </Text>
            <View
              style={{
                backgroundColor: colors.grey200,
                borderRadius: 8,
                padding: 12,
              }}
            >
              <Text style={{ fontSize: 14, color: colors.grey900 }}>
                {aiReplyResult.text}
              </Text>
              {aiReplyResult.audio_url ? (
                <View
                  style={{
                    marginTop: 8,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Ionicons
                    name="volume-medium-outline"
                    size={16}
                    color={colors.primary}
                  />
                  <Text
                    style={{
                      fontSize: 12,
                      color: colors.primary,
                    }}
                  >
                    {pt.chat_ai_reply_audio_attached}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        )}
      </BottomSheetModal>

      {/* Transcribe Modal */}
      <BottomSheetModal
        visible={transcribeTarget !== null}
        onClose={closeTranscribeModal}
        title={pt.chat_transcribe_title}
        cardStyle={styles.annotationSheetCard}
        footer={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {transcribeResult ? (
              <Pressable
                style={styles.secondaryBtn}
                onPress={() => {
                  if (transcribeResult) {
                    void Clipboard.setStringAsync(transcribeResult);
                    Alert.alert('', pt.chat_transcribe_copied);
                  }
                }}
              >
                <Text style={styles.secondaryBtnText}>
                  {pt.chat_transcribe_copy}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              style={styles.secondaryBtn}
              onPress={closeTranscribeModal}
              disabled={transcribeLoading}
            >
              <Text style={styles.secondaryBtnText}>{pt.close}</Text>
            </Pressable>
          </View>
        }
      >
        {transcribeLoading && (
          <View style={{ alignItems: 'center', paddingVertical: 24 }}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text
              style={{
                marginTop: 8,
                fontSize: 13,
                color: colors.grey500,
              }}
            >
              {pt.chat_transcribe_processing}
            </Text>
          </View>
        )}

        {transcribeError && !transcribeLoading && (
          <View
            style={{
              backgroundColor: '#FEE2E2',
              borderRadius: 8,
              padding: 12,
            }}
          >
            <Text style={{ color: '#DC2626', fontSize: 13 }}>
              {pt.chat_transcribe_error}
            </Text>
            <Pressable
              style={{
                marginTop: 8,
                paddingVertical: 6,
                paddingHorizontal: 12,
                backgroundColor: '#DC2626',
                borderRadius: 6,
                alignSelf: 'flex-start',
              }}
              onPress={() => void handleStartTranscription()}
            >
              <Text style={{ color: '#fff', fontSize: 13 }}>
                {pt.chat_transcribe_retry}
              </Text>
            </Pressable>
          </View>
        )}

        {transcribeResult && (
          <View>
            {transcribeCached && (
              <View
                style={{
                  backgroundColor: colors.primary + '20',
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 4,
                  alignSelf: 'flex-start',
                  marginBottom: 8,
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    color: colors.primary,
                  }}
                >
                  {pt.chat_transcribe_cached}
                </Text>
              </View>
            )}
            <View
              style={{
                backgroundColor: colors.grey200,
                borderRadius: 8,
                padding: 12,
              }}
            >
              <Text style={{ fontSize: 14, color: colors.grey900 }}>
                {transcribeResult}
              </Text>
            </View>
          </View>
        )}
      </BottomSheetModal>

      <BottomSheetModal
        visible={messageContactsSheetVisible}
        onClose={() => {
          setMessageContactsSheetVisible(false);
          setMessageContactsSheetItems([]);
        }}
        title={pt.received_contacts}
        cardStyle={styles.searchSheetCard}
        noScroll
        footer={
          <Pressable
            style={styles.secondaryBtn}
            onPress={dismissKeyboardAnd(() => {
              setMessageContactsSheetVisible(false);
              setMessageContactsSheetItems([]);
            })}
          >
            <Text style={styles.secondaryBtnText}>{pt.cancel}</Text>
          </Pressable>
        }
      >
        <FlatList
          data={messageContactsSheetItems}
          keyExtractor={(item, index) =>
            `${item.contact_id ?? 'received'}-${item.phone ?? item.phone_partial ?? index}`
          }
          contentContainerStyle={styles.bottomSheetList}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => {
            const fullName = [item.name, item.last_name]
              .filter(Boolean)
              .join(' ')
              .trim();
            const phoneLabel = item.phone_partial ?? item.phone ?? '-';

            return (
              <Pressable
                style={styles.contactPickerRow}
                onPress={dismissKeyboardAnd(() => {
                  handleSelectMessageGroupContact(item);
                })}
              >
                <AppAvatar
                  uri={item.photo}
                  size={34}
                  style={styles.contactPickerAvatar}
                  iconName="person"
                  iconColor={colors.grey500}
                />
                <View style={styles.contactPickerRowInfo}>
                  <Text style={styles.contactPickerRowName} numberOfLines={1}>
                    {fullName || pt.contact}
                  </Text>
                  <Text style={styles.contactPickerRowPhone} numberOfLines={1}>
                    {phoneLabel}
                  </Text>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <Text style={styles.emptyText}>{pt.no_contacts_found}</Text>
          }
        />

        <Text style={styles.modalHintText}>{pt.select_received_contact}</Text>
      </BottomSheetModal>

      <ContactFormModal
        visible={contactFormVisible}
        mode={contactFormMode}
        contactId={contactFormContactId}
        initialValues={contactFormInitialValues}
        createChatId={chatInfo.chat_id}
        onClose={handleCloseContactForm}
        onSuccess={handleContactFormSuccess}
      />

      <BottomSheetModal
        visible={contactPickerVisible}
        onClose={() => setContactPickerVisible(false)}
        title={pt.select_contacts}
        cardStyle={styles.searchSheetCard}
        noScroll
        footer={
          <>
            <Pressable
              style={styles.secondaryBtn}
              onPress={dismissKeyboardAnd(() => setContactPickerVisible(false))}
            >
              <Text style={styles.secondaryBtnText}>{pt.cancel}</Text>
            </Pressable>
            <Pressable
              style={[
                styles.primaryBtn,
                (selectedContactIds.length === 0 || sendingCapturedMedia) &&
                  styles.sendBtnDisabled,
              ]}
              onPress={dismissKeyboardAnd(() => {
                void handleSendSelectedContacts();
              })}
              disabled={selectedContactIds.length === 0 || sendingCapturedMedia}
            >
              {sendingCapturedMedia ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <Text style={styles.primaryBtnText}>{pt.send}</Text>
              )}
            </Pressable>
          </>
        }
      >
        <View style={styles.searchInputWrap}>
          <Ionicons name="search-outline" size={18} color={colors.grey600} />
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
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
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
                  onPress={dismissKeyboardAnd(() =>
                    toggleContactSelection(item.contact_id)
                  )}
                >
                  <AppAvatar
                    uri={item.photo}
                    size={34}
                    style={styles.contactPickerAvatar}
                    iconName="person"
                    iconColor={colors.grey500}
                  />
                  <View style={styles.contactPickerRowInfo}>
                    <Text style={styles.contactPickerRowName} numberOfLines={1}>
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
      </BottomSheetModal>

      <BottomSheetModal
        visible={locationPickerVisible}
        onClose={() => setLocationPickerVisible(false)}
        title={pt.send_location}
        cardStyle={styles.locationSheetCard}
        statusBarTranslucent={Platform.OS !== 'android'}
        hardwareAccelerated={Platform.OS === 'android'}
        footerStyle={styles.locationFooter}
        footer={
          <>
            <Pressable
              style={[
                styles.locationSendCurrentBtn,
                sendingCapturedMedia && styles.sendBtnDisabled,
              ]}
              onPress={dismissKeyboardAnd(() => {
                void handleSendLocation();
              })}
              disabled={sendingCapturedMedia}
            >
              {sendingCapturedMedia ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <Text style={styles.primaryBtnText}>
                  {pt.send_location_current}
                </Text>
              )}
            </Pressable>

            <Pressable
              style={styles.secondaryBtn}
              onPress={dismissKeyboardAnd(() =>
                setLocationPickerVisible(false)
              )}
            >
              <Text style={styles.secondaryBtnText}>{pt.cancel}</Text>
            </Pressable>
          </>
        }
      >
        <View style={styles.searchInputWrap}>
          <Ionicons name="search-outline" size={18} color={colors.grey600} />
          <TextInput
            value={locationSearchInput}
            onChangeText={setLocationSearchInput}
            onSubmitEditing={dismissKeyboardAnd(() => {
              void handleSearchLocation();
            })}
            style={styles.searchInput}
            placeholder={pt.location_search_placeholder}
            placeholderTextColor={colors.grey500}
            returnKeyType="search"
          />
          <Pressable
            onPress={dismissKeyboardAnd(() => {
              void handleSearchLocation();
            })}
            style={styles.locationSearchBtn}
            disabled={locationSearchLoading}
          >
            {locationSearchLoading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="arrow-forward" size={18} color={colors.primary} />
            )}
          </Pressable>
        </View>

        <View style={styles.locationMapWrap}>
          {hasNativeMapSupport &&
          NativeMapView &&
          NativeMapCamera &&
          locationMapStatus !== 'failed' ? (
            <NativeMapView
              style={styles.locationMap}
              mapStyle={locationMapStyleUrl}
              onWillStartLoadingMap={handleLocationMapWillStartLoading}
              onDidFinishLoadingMap={handleLocationMapDidFinishLoading}
              onDidFinishLoadingStyle={handleLocationMapDidFinishLoading}
              onDidFailLoadingMap={handleLocationMapDidFailLoading}
              onPress={handleMapPress}
            >
              <NativeMapCamera
                centerCoordinate={mapCenterCoordinateLngLat}
                zoomLevel={14}
                animationDuration={250}
              />
              {selectedCoordinateLngLat && NativeMapPointAnnotation ? (
                <NativeMapPointAnnotation
                  id="location-picker-selected"
                  coordinate={selectedCoordinateLngLat}
                >
                  <View style={styles.locationMapMarker}>
                    <Ionicons name="location-sharp" size={30} color="#EF4444" />
                  </View>
                </NativeMapPointAnnotation>
              ) : null}
            </NativeMapView>
          ) : (
            <View style={styles.locationPickerMapFallback}>
              <Ionicons name="map-outline" size={28} color={colors.grey600} />
              <Text style={styles.locationMapFallbackText}>
                {pt.location_map_unavailable}
              </Text>
              {hasNativeMapSupport ? (
                <Pressable
                  style={styles.locationMapRetryBtn}
                  onPress={handleRetryLocationMap}
                >
                  <Text style={styles.locationMapRetryBtnText}>{pt.retry}</Text>
                </Pressable>
              ) : null}
              {__DEV__ ? (
                <Text style={styles.locationMapFallbackDebugText}>
                  {locationMapDebugInfo}
                </Text>
              ) : null}
            </View>
          )}
        </View>

        {locationCurrentError ? (
          <Text style={styles.locationErrorText}>{pt.location_error}</Text>
        ) : null}

        <Text style={styles.locationSectionTitle}>
          {pt.location_nearby_places}
        </Text>

        <Pressable
          style={styles.locationCurrentRow}
          onPress={() => {
            void handleSendCurrentLocation();
          }}
          disabled={sendingCapturedMedia || locationCurrentLoading}
        >
          <View style={styles.locationCurrentIconWrap}>
            <Ionicons name="locate" size={16} color={colors.primary} />
          </View>
          <View style={styles.locationCurrentContent}>
            <Text style={styles.locationCurrentTitle}>
              {pt.location_current}
            </Text>
            <Text style={styles.locationCurrentSubtitle}>
              {locationCurrentAccuracy !== null
                ? pt.location_precision_meters.replace(
                    '{meters}',
                    String(Math.max(1, Math.round(locationCurrentAccuracy)))
                  )
                : pt.location_searching}
            </Text>
          </View>
          {locationCurrentLoading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons name="chevron-forward" size={18} color={colors.grey600} />
          )}
        </Pressable>

        {locationSearchLoading ? (
          <View style={styles.locationSearchLoadingRow}>
            <Text style={styles.locationSearchLoadingText}>
              {pt.location_searching}
            </Text>
            <ActivityIndicator size="small" color={colors.grey600} />
          </View>
        ) : null}

        {locationSearchResults.map((result) => (
          <Pressable
            key={result.id}
            style={styles.locationSearchResultRow}
            onPress={() => handleSelectSearchResult(result)}
          >
            <Ionicons
              name="location-outline"
              size={18}
              color={colors.primary}
            />
            <View style={styles.locationSearchResultContent}>
              <Text style={styles.locationSearchResultTitle} numberOfLines={1}>
                {result.name}
              </Text>
              <Text
                style={styles.locationSearchResultSubtitle}
                numberOfLines={1}
              >
                {result.address}
              </Text>
            </View>
          </Pressable>
        ))}

        {!locationSearchLoading &&
        locationSearchInput.trim().length >= 3 &&
        locationSearchResults.length === 0 ? (
          <Text style={styles.locationSearchEmptyText}>
            {pt.location_search_no_results}
          </Text>
        ) : null}
      </BottomSheetModal>

      <Modal
        visible={viewer.visible}
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        animationType="fade"
        onRequestClose={closeMediaViewer}
      >
        <View style={[styles.viewerOverlay, { paddingBottom: insets.bottom }]}>
          <Pressable style={styles.viewerBackdrop} onPress={closeMediaViewer} />
          <PanGestureHandler
            enabled={viewer.visible}
            activeOffsetY={[
              -VIEWER_SWIPE_ACTIVATION_DISTANCE,
              VIEWER_SWIPE_ACTIVATION_DISTANCE,
            ]}
            onGestureEvent={handleViewerPanGestureEvent}
            onHandlerStateChange={handleViewerPanStateChange}
          >
            <Animated.View
              style={[
                styles.viewerContent,
                { transform: [{ translateY: viewerTranslateY }] },
              ]}
            >
              <View style={styles.viewerActions}>
                {viewer.kind === 'image' && viewer.items.length > 1 ? (
                  <View style={styles.viewerCounterBadge}>
                    <Text style={styles.viewerCounterText}>
                      {viewer.activeIndex + 1} / {viewer.items.length}
                    </Text>
                  </View>
                ) : null}
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
                    <Ionicons
                      name="download-outline"
                      size={20}
                      color="#FFFFFF"
                    />
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
                {viewer.kind === 'video' && viewer.src ? (
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
                ) : viewer.kind === 'image' && viewer.items.length > 0 ? (
                  <>
                    <ScrollView
                      ref={viewerImageScrollRef}
                      horizontal
                      pagingEnabled
                      showsHorizontalScrollIndicator={false}
                      style={styles.viewerImagePager}
                      scrollEventThrottle={16}
                      onLayout={(event) => {
                        const width = event.nativeEvent.layout.width;
                        if (!Number.isFinite(width) || width <= 0) return;
                        setViewerMediaWidth(width);
                      }}
                      onMomentumScrollEnd={(event) => {
                        const width = event.nativeEvent.layoutMeasurement.width;
                        if (!Number.isFinite(width) || width <= 0) return;
                        const nextIndex = Math.round(
                          event.nativeEvent.contentOffset.x / width
                        );
                        setActiveViewerIndex(nextIndex);
                      }}
                    >
                      {viewer.items.map((item, index) => (
                        <View
                          key={`viewer-image-${index}-${item.src}`}
                          style={[
                            styles.viewerImagePage,
                            { width: viewerMediaWidth },
                          ]}
                        >
                          <Image
                            source={{ uri: item.src }}
                            style={styles.viewerImage}
                            resizeMode="contain"
                          />
                        </View>
                      ))}
                    </ScrollView>

                    {viewer.items.length > 1 ? (
                      <>
                        <Pressable
                          style={[
                            styles.viewerNavButton,
                            styles.viewerNavButtonLeft,
                            !canGoToPreviousViewerImage &&
                              styles.viewerNavButtonDisabled,
                          ]}
                          onPress={goToPreviousViewerImage}
                          disabled={!canGoToPreviousViewerImage}
                          accessibilityLabel="Anterior"
                        >
                          <Ionicons
                            name="chevron-back"
                            size={26}
                            color="#FFFFFF"
                          />
                        </Pressable>

                        <Pressable
                          style={[
                            styles.viewerNavButton,
                            styles.viewerNavButtonRight,
                            !canGoToNextViewerImage &&
                              styles.viewerNavButtonDisabled,
                          ]}
                          onPress={goToNextViewerImage}
                          disabled={!canGoToNextViewerImage}
                          accessibilityLabel="Próxima"
                        >
                          <Ionicons
                            name="chevron-forward"
                            size={26}
                            color="#FFFFFF"
                          />
                        </Pressable>
                      </>
                    ) : null}
                  </>
                ) : null}
              </View>

              {viewer.caption ? (
                <Text style={styles.viewerCaption} numberOfLines={4}>
                  {viewer.caption}
                </Text>
              ) : null}
            </Animated.View>
          </PanGestureHandler>
        </View>
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
  messageSwipeContainer: {
    overflow: 'visible',
  },
  messageSwipeRightAction: {
    marginVertical: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messageSwipeRightActionInner: {
    width: 64,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(47, 43, 61, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  messageSwipeRightActionText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.primary,
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
  bubbleLeftWithLink: {
    maxWidth: '90%',
    paddingRight: 20,
  },
  bubbleRightWithLink: {
    maxWidth: '90%',
    minWidth: 220,
    paddingRight: 18,
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
  bubblePressed: {
    opacity: 0.92,
  },
  messageActionSide: {
    position: 'absolute',
    top: 6,
    flexDirection: 'column',
    gap: 4,
  },
  messageActionSideLeft: {
    right: -36,
  },
  messageActionSideRight: {
    left: -36,
  },
  messageActionSideBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(47, 43, 61, 0.18)',
  },
  quickReactionStrip: {
    position: 'absolute',
    top: -34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(47, 43, 61, 0.18)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    zIndex: 20,
  },
  quickReactionStripLeft: {
    left: 8,
  },
  quickReactionStripRight: {
    right: 8,
  },
  quickReactionBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickReactionEmoji: {
    fontSize: 16,
    lineHeight: 16,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 21,
  },
  bubbleTextWrap: {
    minWidth: 0,
  },
  readMoreButton: {
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  readMoreText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  whatsAppBold: {
    fontWeight: '700',
  },
  whatsAppItalic: {
    fontStyle: 'italic',
  },
  whatsAppStrike: {
    textDecorationLine: 'line-through',
  },
  whatsAppCode: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    backgroundColor: 'rgba(47, 43, 61, 0.1)',
    borderRadius: 4,
    paddingHorizontal: 2,
  },
  whatsAppLink: {
    color: colors.primary,
    textDecorationLine: 'underline',
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
  bubbleMetaRightWithLink: {
    gap: 3,
  },
  bubbleTime: {
    fontSize: 11,
  },
  bubbleEditedBadge: {
    fontSize: 11,
    fontWeight: '600',
  },
  bubbleEditedBadgeLeft: {
    color: colors.grey600,
  },
  bubbleEditedBadgeRight: {
    color: colors.bubbleSentTime,
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
    paddingVertical: 3,
    paddingHorizontal: 8,
    minHeight: 26,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(47, 43, 61, 0.14)',
  },
  reactionSummaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 18,
  },
  reactionSummaryEmoji: {
    fontSize: 15,
    lineHeight: 20,
    textAlignVertical: 'center',
  },
  reactionSummaryCount: {
    fontSize: 11,
    lineHeight: 14,
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
  mediaBubbleImageGallery: {
    maxWidth: 232,
  },
  imageGalleryGrid: {
    width: 232,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
  },
  imageGalleryItem: {
    width: 115,
    height: 115,
    borderRadius: 6,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: colors.grey200,
  },
  imageGalleryItemSingle: {
    width: 232,
    height: 232,
  },
  imageGalleryThumb: {
    width: '100%',
    height: '100%',
  },
  imageGalleryHiddenOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageGalleryHiddenText: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
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
    lineHeight: 20,
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
  locationMapMarker: {
    alignItems: 'center',
    justifyContent: 'center',
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
    alignSelf: 'stretch',
    minWidth: 280,
  },
  linkPreviewMain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    width: '100%',
    minWidth: 0,
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
  linkPreviewUrlContainer: {
    width: '100%',
    minWidth: 0,
    marginTop: 0,
  },
  linkPreviewUrlContainerWithThumb: {
    paddingLeft: 0,
    paddingBottom: 10,
  },
  linkPreviewUrl: {
    width: '100%',
    minWidth: 0,
    fontSize: 12,
    lineHeight: 17,
    color: colors.primary,
    flexShrink: 1,
    includeFontPadding: false,
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
  contactWrapPressed: {
    opacity: 0.72,
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
    lineHeight: 20,
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
  viewerBackdrop: {
    ...StyleSheet.absoluteFillObject,
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
    alignItems: 'center',
    gap: 10,
  },
  viewerCounterBadge: {
    minHeight: 28,
    borderRadius: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  viewerCounterText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
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
  viewerImagePager: {
    width: '100%',
    height: '100%',
  },
  viewerImagePage: {
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerImage: {
    width: '100%',
    height: '100%',
  },
  viewerNavButton: {
    position: 'absolute',
    top: '50%',
    marginTop: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    zIndex: 3,
  },
  viewerNavButtonLeft: {
    left: 8,
  },
  viewerNavButtonRight: {
    right: 8,
  },
  viewerNavButtonDisabled: {
    opacity: 0.35,
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
  quickMessageListCard: {
    marginHorizontal: 10,
    marginTop: 8,
    marginBottom: 2,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(47, 43, 61, 0.2)',
    overflow: 'hidden',
  },
  quickMessageListLoading: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(47, 43, 61, 0.12)',
  },
  quickMessageListScroll: {
    maxHeight: 260,
  },
  quickMessageListItem: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(47, 43, 61, 0.12)',
  },
  quickMessageListCommand: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  quickMessageListMessage: {
    fontSize: 12,
    color: colors.grey700,
  },
  quickMessagePreviewCard: {
    marginHorizontal: 10,
    marginTop: 8,
    marginBottom: 2,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(47, 43, 61, 0.2)',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 8,
  },
  quickMessagePreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  quickMessagePreviewTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  quickMessagePreviewCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(47, 43, 61, 0.08)',
  },
  quickMessagePreviewImage: {
    width: '100%',
    height: 180,
    borderRadius: 10,
    backgroundColor: colors.inputBg,
  },
  quickMessagePreviewMediaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: 'rgba(40, 101, 183, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  quickMessagePreviewMediaText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
  },
  quickMessagePreviewText: {
    fontSize: 14,
    color: colors.onSurface,
    lineHeight: 20,
  },
  quickMessagePreviewTextScroll: {
    maxHeight: 220,
  },
  quickMessagePreviewTextScrollContent: {
    paddingRight: 4,
  },
  quickMessagePreviewActions: {
    marginTop: 4,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  replyComposerPreview: {
    position: 'relative',
    marginHorizontal: 10,
    marginTop: 8,
    marginBottom: 8,
    minHeight: 56,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(47, 43, 61, 0.16)',
    paddingLeft: 12,
    paddingRight: 36,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  replyComposerPreviewBar: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 999,
    backgroundColor: colors.primary,
    flexShrink: 0,
  },
  replyComposerPreviewMedia: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: 'rgba(47, 43, 61, 0.12)',
    flexShrink: 0,
  },
  replyComposerPreviewContactAvatar: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: 'rgba(47, 43, 61, 0.12)',
    flexShrink: 0,
  },
  replyComposerPreviewDocIcon: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: 'rgba(40, 101, 183, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  replyComposerPreviewContent: {
    flex: 1,
    minWidth: 0,
  },
  replyComposerPreviewName: {
    fontSize: 14,
    lineHeight: 16,
    fontWeight: '600',
    color: colors.primary,
  },
  replyComposerPreviewText: {
    marginTop: 2,
    fontSize: 13,
    color: colors.onSurface,
  },
  replyComposerPreviewMeta: {
    marginTop: 2,
    fontSize: 12,
    color: colors.grey600,
  },
  replyComposerPreviewClose: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
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
  emojiInputBtnActive: {
    backgroundColor: 'rgba(40, 101, 183, 0.1)',
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
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 12 : 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(47, 43, 61, 0.16)',
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
  messageOverlayRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messageOverlayBackdropPress: {
    ...StyleSheet.absoluteFillObject,
  },
  messageOverlayBlur: {
    ...StyleSheet.absoluteFillObject,
  },
  messageOverlayDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.10)',
  },
  messageOverlayReactions: {
    width: '100%',
    maxWidth: 336,
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(47, 43, 61, 0.16)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    marginBottom: 10,
  },
  messageOverlayReactionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageOverlayReactionEmoji: {
    fontSize: 26,
    lineHeight: 31,
    marginTop: -1,
  },
  messageOverlayReactionMoreBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(47, 43, 61, 0.08)',
    marginLeft: 2,
  },
  messageOverlayMenu: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(47, 43, 61, 0.16)',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
    marginTop: 10,
  },
  messageOverlayCenterWrap: {
    width: '92%',
    maxWidth: 360,
    alignItems: 'center',
    maxHeight: '92%',
  },
  messageOverlaySelectedScroll: {
    width: '100%',
    maxHeight: '48%',
  },
  messageOverlayContentScrollInner: {
    width: '100%',
    alignItems: 'center',
    paddingBottom: 4,
  },
  messageOverlaySelectedWrap: {
    width: '100%',
    alignItems: 'center',
  },
  reactionPickerOverlayInline: {
    width: '100%',
    marginTop: 10,
  },
  reactionPickerCard: {
    width: '100%',
    maxWidth: 360,
    maxHeight: 430,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 16 : 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(47, 43, 61, 0.16)',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  reactionPickerHandle: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.grey300,
    alignSelf: 'center',
    marginBottom: 10,
  },
  reactionPickerSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: colors.grey100,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  reactionPickerSearchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.onSurface,
    paddingVertical: 0,
  },
  reactionPickerEmojiScroll: {
    maxHeight: 270,
  },
  reactionPickerEmojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingBottom: 16,
  },
  reactionPickerEmojiBtn: {
    width: '14.2857%',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionPickerEmojiText: {
    fontSize: 34,
    lineHeight: 36,
  },
  reactionPickerTabs: {
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.grey300,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 8,
  },
  reactionPickerTab: {
    minWidth: 44,
    minHeight: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionPickerTabActive: {
    backgroundColor: 'rgba(40, 101, 183, 0.12)',
  },
  messageOverlayMenuItem: {
    minHeight: 46,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(47, 43, 61, 0.12)',
  },
  messageOverlayMenuItemText: {
    flex: 1,
    fontSize: 16,
    color: colors.onSurface,
    fontWeight: '500',
  },
  keyboardAvoiding: {
    flex: 1,
  },

  editHistoryOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  editHistoryBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  editHistoryCard: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '76%',
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(47, 43, 61, 0.16)',
  },
  editHistoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  editHistoryTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.onSurface,
    lineHeight: 24,
  },
  editHistoryList: {
    maxHeight: 390,
  },
  editHistoryListContent: {
    gap: 10,
    paddingBottom: 8,
  },
  editHistoryItem: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.grey200,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 6,
  },
  editHistoryItemCurrent: {
    backgroundColor: 'rgba(40, 101, 183, 0.08)',
    borderColor: 'rgba(40, 101, 183, 0.2)',
  },
  editHistoryItemOriginal: {
    backgroundColor: 'rgba(47, 43, 61, 0.02)',
  },
  editHistoryItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  editHistoryItemLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.grey700,
  },
  editHistoryItemDate: {
    fontSize: 12,
    color: colors.grey600,
  },
  editHistoryItemText: {
    fontSize: 16,
    lineHeight: 22,
    color: colors.onSurface,
  },
  editHistoryFooter: {
    flexDirection: 'row' as const,
    justifyContent: 'flex-end' as const,
    gap: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.grey200,
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
  attendantsInfoSheetCard: {
    maxHeight: '78%',
  },
  attendantsInfoContent: {
    gap: 10,
    paddingBottom: 10,
  },
  attendantsPrimaryCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(40, 101, 183, 0.24)',
    backgroundColor: 'rgba(40, 101, 183, 0.06)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  attendantsRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  attendantsUserMain: {
    flex: 1,
    minWidth: 0,
  },
  attendantsPrimaryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  attendantsPrimaryName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.onSurface,
  },
  attendantsPrimaryBadge: {
    borderRadius: 999,
    backgroundColor: 'rgba(40, 101, 183, 0.16)',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  attendantsPrimaryBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
  },
  attendantsEnteredAtText: {
    marginTop: 2,
    fontSize: 12,
    color: colors.grey700,
  },
  attendantsSectionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.grey300,
    marginVertical: 2,
  },
  attendantsSectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.grey700,
  },
  attendantsSecondaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(47, 43, 61, 0.03)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  attendantsSecondaryName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.onSurface,
  },
  locationSheetCard: {
    maxHeight: '90%',
  },
  locationFooter: {
    flexDirection: 'column',
    gap: 8,
  },

  bottomSheetList: {
    paddingBottom: 16,
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
  closeServiceConfirmBtn: {
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.error,
  },
  closeServiceMessage: {
    fontSize: 14,
    color: colors.onSurface,
    lineHeight: 20,
  },
  closeServiceToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 8,
  },
  closeServiceToggleTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  closeServiceToggleLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.onSurface,
  },
  closeServiceToggleDescription: {
    marginTop: 2,
    fontSize: 12,
    color: colors.grey700,
    lineHeight: 16,
  },
  modalLoadingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  videoEditorOpeningOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    elevation: 50,
    backgroundColor: 'rgba(0, 0, 0, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  videoEditorOpeningCard: {
    minHeight: 68,
    minWidth: 220,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  videoEditorOpeningText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.onSurface,
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
  forwardStatusRow: {
    flexDirection: 'row',
    gap: 8,
  },
  forwardStatusChip: {
    flex: 1,
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.grey300,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  forwardStatusChipActive: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(40, 101, 183, 0.08)',
  },
  forwardStatusChipDisabled: {
    opacity: 0.55,
  },
  forwardStatusChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.grey700,
  },
  forwardStatusChipTextActive: {
    color: colors.primary,
  },
  forwardTargetRow: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 8,
    backgroundColor: 'rgba(40, 101, 183, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(40, 101, 183, 0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  forwardTargetText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    color: colors.onSurface,
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
    paddingBottom: 16,
  },
  formField: {
    gap: 6,
  },
  formFieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.grey700,
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
    minHeight: 100,
    maxHeight: 220,
    flexShrink: 1,
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
  locationSearchBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  locationMapWrap: {
    height: 300,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.grey300,
  },
  locationMap: {
    flex: 1,
  },
  locationPickerMapFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.inputBg,
    paddingHorizontal: 16,
  },
  locationMapFallbackText: {
    fontSize: 13,
    color: colors.grey700,
    textAlign: 'center',
  },
  locationMapRetryBtn: {
    minHeight: 34,
    borderRadius: 17,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: '#FFFFFF',
  },
  locationMapRetryBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  locationMapFallbackDebugText: {
    marginTop: 8,
    fontSize: 10,
    lineHeight: 14,
    color: colors.grey700,
    textAlign: 'center',
  },
  locationSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.onSurface,
  },
  locationCurrentRow: {
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.grey300,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
  },
  locationCurrentIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.inputBg,
  },
  locationCurrentContent: {
    flex: 1,
    minWidth: 0,
  },
  locationCurrentTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.onSurface,
  },
  locationCurrentSubtitle: {
    fontSize: 13,
    color: colors.grey700,
    marginTop: 2,
  },
  locationSearchLoadingRow: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.grey300,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  locationSearchLoadingText: {
    fontSize: 16,
    color: colors.grey700,
  },
  locationSearchResultRow: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.grey300,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
  },
  locationSearchResultContent: {
    flex: 1,
    minWidth: 0,
  },
  locationSearchResultTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.onSurface,
  },
  locationSearchResultSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: colors.grey700,
  },
  locationSearchEmptyText: {
    fontSize: 13,
    color: colors.grey700,
    textAlign: 'center',
    paddingVertical: 4,
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
  locationSendCurrentBtn: {
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
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
