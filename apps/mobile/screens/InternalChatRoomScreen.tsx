import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  Image,
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
  useWindowDimensions,
  View,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextStyle,
  type TextInputContentSizeChangeEvent,
} from 'react-native';
import { PanGestureHandler, State } from 'react-native-gesture-handler';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
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
  createAudioPlayer,
  type AudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Directory, File, Paths } from 'expo-file-system';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { AppAvatar } from '../components/AppAvatar';
import { BottomSheetModal } from '../components/BottomSheetModal';
import { LocationMessagePreview } from '../components/LocationMessagePreview';
import {
  ContactFormModal,
  type ContactFormInitialValues,
} from '../components/ContactFormModal';
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
} from '../api/internalChatApi';
import { getChatContactById, getChatContactByPhone } from '../api/chatApi';
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
import type {
  MessageContent,
  MessageContentContact,
  MessageContentDocument,
  MessageContentLinkPreview,
  MessageContentVideo,
  MessageQuoted,
  MessageReaction,
} from '../types/chat';
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
  parseWhatsAppTextTokens,
  type WhatsAppTextToken,
} from '../utils/whatsAppTextFormat';
import {
  LONG_TEXT_COLLAPSE_LINES,
  resolveLongTextCollapse,
} from '../utils/longTextCollapse';
import {
  createFlatWaveformPlaceholder,
  parseWaveform,
  type WaveformInput,
} from '../utils/audioWaveform';
import {
  isInternalChatSystemMessage,
  resolveInternalChatMessageText,
  resolveInternalChatSenderName,
  resolveInternalChatTextTag,
} from '../utils/internalChatText';
import { addSessionUpdatedListener } from '../utils/appResumeBus';
import { normalizeLocationCoordinate } from '../utils/locationPreview';

type Navigation = NativeStackNavigationProp<InternalChatStackParamList>;
type ScreenRoute = RouteProp<InternalChatStackParamList, 'InternalChatRoom'>;
type PendingGroupAction =
  | { type: 'remove'; member: InternalChatParticipant }
  | { type: 'transfer'; member: InternalChatParticipant }
  | { type: 'leave' };
type DownloadKind = 'image' | 'video' | 'document';
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

type InternalUploadFormFields = Record<
  string,
  string | number | boolean | null | undefined
>;

const VIDEO_FULLSCREEN_ENABLED = { enable: true } as const;
const MAX_DOCUMENT_SIZE_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_SIZE_BYTES = 16 * 1024 * 1024;
const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024;
const MAX_AUDIO_SIZE_BYTES = 16 * 1024 * 1024;
const VIEWER_SWIPE_CLOSE_DISTANCE = 120;
const VIEWER_SWIPE_CLOSE_VELOCITY = 1.05;
const VIEWER_SWIPE_ACTIVATION_DISTANCE = 10;
const WAVEFORM_BAR_WIDTH = 2;
const WAVEFORM_BAR_GAP = 2;
const WAVEFORM_HORIZONTAL_INSET = 2;
const WAVEFORM_FALLBACK_MAX_BARS = 28;
const AUDIO_WAVEFORM_DEFAULT_BARS = 64;
const AUDIO_FINISH_THRESHOLD_SECONDS = 0.05;
const CHAT_LIST_HORIZONTAL_PADDING = 12;
const CHAT_BUBBLE_MAX_WIDTH_RATIO = 0.9;
const CHAT_DOCUMENT_BUBBLE_MAX_WIDTH_RATIO = 0.84;
const CHAT_DOCUMENT_BUBBLE_MIN_WIDTH = 224;
const LOAD_OLDER_SCROLL_THRESHOLD = 180;
const SHOW_SCROLL_TO_BOTTOM_THRESHOLD = 160;
const SOFT_WRAP_TOKEN_MIN_LENGTH = 24;
const SOFT_WRAP_BREAK_CHAR = '\u200B';
const VOICE_LOCK_SWIPE_THRESHOLD = 70;
const VOICE_RELEASE_LOCK_GRACE_MS = 220;
const VOICE_CANCEL_SWIPE_THRESHOLD = 90;
const RECORDING_WAVEFORM_MAX_BARS = 44;
const RECORDING_WAVEFORM_MIN_BARS = 26;
const COMPOSER_INPUT_LINE_HEIGHT = 20;
const COMPOSER_INPUT_VERTICAL_PADDING = 10;
const COMPOSER_INPUT_MIN_HEIGHT =
  COMPOSER_INPUT_LINE_HEIGHT + COMPOSER_INPUT_VERTICAL_PADDING * 2;
const COMPOSER_INPUT_MAX_HEIGHT =
  COMPOSER_INPUT_LINE_HEIGHT * 5 + COMPOSER_INPUT_VERTICAL_PADDING * 2;
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

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeInlineUrl(url: string): string {
  return url.startsWith('www.') ? `https://${url}` : url;
}

type TextChunk = {
  text: string;
  url: string | null;
};

function splitTextChunksWithLinks(text: string): TextChunk[] {
  if (!text) return [];

  const chunks: TextChunk[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(
    /((?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?])/gi
  )) {
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

function insertSoftWrapOpportunities(text: string): string {
  if (!text) return text;

  return text.replace(
    new RegExp(`\\S{${SOFT_WRAP_TOKEN_MIN_LENGTH},}`, 'g'),
    (token) => {
      let out = '';
      for (
        let index = 0;
        index < token.length;
        index += SOFT_WRAP_TOKEN_MIN_LENGTH
      ) {
        if (index > 0) out += SOFT_WRAP_BREAK_CHAR;
        out += token.slice(index, index + SOFT_WRAP_TOKEN_MIN_LENGTH);
      }
      return out;
    }
  );
}

async function openExternalTextUrl(url: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {}
}

function renderWhatsAppTextToken(
  token: WhatsAppTextToken,
  tokenIndex: number,
  onLinkLongPress?: (url: string) => void
): ReactElement | string | Array<ReactElement | null> {
  if (token.type === 'newline') return '\n';

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
    const chunkText = insertSoftWrapOpportunities(chunk.text);

    if (chunk.url) {
      const url = chunk.url;
      return (
        <Text
          key={`internal-whatsapp-token-${tokenIndex}-${chunkIndex}`}
          style={[tokenStyle, styles.whatsAppLink]}
          onPress={() => {
            void openExternalTextUrl(url);
          }}
          onLongPress={() => {
            onLinkLongPress?.(url);
          }}
          suppressHighlighting
        >
          {chunkText}
        </Text>
      );
    }

    return (
      <Text
        key={`internal-whatsapp-token-${tokenIndex}-${chunkIndex}`}
        style={tokenStyle}
      >
        {chunkText}
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
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  ellipsizeMode?: 'head' | 'middle' | 'tail' | 'clip';
  selectable?: boolean;
  onTextLayout?: (event: NativeSyntheticEvent<{ lines?: unknown[] }>) => void;
  onLinkLongPress?: (url: string) => void;
}) {
  const tokens = useMemo(() => parseWhatsAppTextTokens(text), [text]);

  return (
    <Text
      style={style}
      numberOfLines={numberOfLines}
      ellipsizeMode={ellipsizeMode}
      textBreakStrategy="highQuality"
      selectable={selectable}
      onTextLayout={onTextLayout}
    >
      {tokens.map((token, tokenIndex) =>
        renderWhatsAppTextToken(token, tokenIndex, onLinkLongPress)
      )}
    </Text>
  );
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

function createBaseFormData(
  type: string,
  hash: string,
  replyId?: string | null
) {
  const formData = new FormData();
  formData.append('type', type);
  formData.append('hash', hash);
  if (replyId) formData.append('message_quoted_id', replyId);
  return formData;
}

function appendUploadFields(
  formData: FormData,
  fields?: InternalUploadFormFields
): void {
  if (!fields) return;
  Object.entries(fields).forEach(([key, value]) => {
    if (value == null) return;
    formData.append(key, String(value));
  });
}

function resolveMediaUri(url: string | null | undefined): string | null {
  if (!url) return null;
  return resolveImageUri(url) ?? url;
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

function extractFileExtension(name: string | null | undefined): string {
  if (!name) return '';
  const ext = name.split('.').pop()?.trim().toLowerCase();
  return ext ?? '';
}

function getExtensionFromUrl(url: string): string | null {
  const withoutQuery = url.split('?')[0]?.split('#')[0] ?? '';
  const fileName = withoutQuery.split('/').pop() ?? '';
  const match = fileName.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : null;
}

function isDirectoryPickerCancellationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as {
    code?: unknown;
    message?: unknown;
    name?: unknown;
  };
  const code = typeof record.code === 'string' ? record.code : '';
  const name = typeof record.name === 'string' ? record.name : '';
  const message = typeof record.message === 'string' ? record.message : '';
  const normalized = `${code} ${name} ${message}`.toLowerCase();
  return (
    normalized.includes('cancel') ||
    normalized.includes('aborted') ||
    normalized.includes('user')
  );
}

function splitFileNameParts(fileName: string): {
  base: string;
  extension: string;
} {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return { base: fileName, extension: '' };
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
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${base} (${index})${extension}`;
    if (!new File(directory, candidate).exists) {
      return candidate;
    }
  }

  return `${base}-${Date.now()}${extension}`;
}

function resolveDownloadMimeType(fileName: string, kind: DownloadKind): string {
  const extension = extractFileExtension(fileName);
  if (kind === 'image') {
    if (extension === 'png') return 'image/png';
    if (extension === 'gif') return 'image/gif';
    if (extension === 'webp') return 'image/webp';
    return 'image/jpeg';
  }
  if (kind === 'video') {
    if (extension === 'mov') return 'video/quicktime';
    if (extension === 'webm') return 'video/webm';
    return 'video/mp4';
  }
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'txt') return 'text/plain';
  if (extension === 'csv') return 'text/csv';
  if (extension === 'json') return 'application/json';
  if (extension === 'mp3') return 'audio/mpeg';
  if (extension === 'm4a' || extension === 'aac') return 'audio/mp4';
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
      if (destinationFile.exists) destinationFile.delete();
    } catch {}
    throw error;
  }
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

    void Linking.openURL(sourceUrl);
    return;
  }

  const temporaryDirectory = new Directory(Paths.cache, 'internal-downloads');
  if (!temporaryDirectory.exists) {
    temporaryDirectory.create({ intermediates: true, idempotent: true });
  }

  const temporaryFile = new File(
    temporaryDirectory,
    `${Date.now()}-${fileName}`
  );
  if (temporaryFile.exists) temporaryFile.delete();

  let downloadedFile: File | null = null;

  const cleanupDownloadedFile = () => {
    if (!downloadedFile?.exists) return;
    try {
      downloadedFile.delete();
    } catch {}
  };

  try {
    downloadedFile = await File.downloadFileAsync(sourceUrl, temporaryFile, {
      idempotent: true,
    });
    await saveDownloadedFileToPickedDirectory(downloadedFile, fileName, kind);
    Alert.alert(pt.success_title, resolveDownloadSuccessMessage(kind));
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

function resolveDocumentDisplayName(
  document: MessageContentDocument | null | undefined
): string {
  const explicitName = readNonEmptyString(document?.name);
  if (explicitName) {
    const sanitizedName = sanitizeFilename(explicitName);
    if (sanitizedName.length > 0) return sanitizedName;
  }

  const documentUrl = readNonEmptyString(document?.url);
  if (documentUrl) {
    const nameFromUrl = sanitizeFilename(getFileNameFromUri(documentUrl, ''));
    if (nameFromUrl.length > 0) return nameFromUrl;
  }

  return pt.document;
}

function resolveDocumentExtensionLabel(
  document: MessageContentDocument | null | undefined
): string {
  const extensionFromPayload = readNonEmptyString(document?.extension)?.replace(
    /^\./,
    ''
  );
  if (extensionFromPayload) return extensionFromPayload.toUpperCase();

  const extensionFromName = extractFileExtension(document?.name).toUpperCase();
  if (extensionFromName) return extensionFromName;

  const extensionFromUrl = getExtensionFromUrl(document?.url ?? '');
  if (extensionFromUrl) return extensionFromUrl.toUpperCase();

  return 'FILE';
}

function resolveVideoMeta(
  video: MessageContentVideo | null | undefined
): string {
  if (!video) return '';
  const ext =
    (video.extension ?? '').replace(/^\./, '').toUpperCase() || 'VIDEO';
  const size = formatFileSize(video.size);
  const duration = formatAudioTime(video.duration ?? 0);
  return [ext, size, duration === '0:00' ? '' : duration]
    .filter(Boolean)
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

function resolveImageDownloadName(
  message: InternalChatMessage,
  sourceUrl: string
): string {
  const image = message.content?.image;
  const extFromPayload = image?.extension?.replace(/^\./, '').toLowerCase();
  const extension = extFromPayload || getExtensionFromUrl(sourceUrl) || 'jpg';
  const captionName = image?.caption ? sanitizeFilename(image.caption) : '';
  const fallbackName = `imagem-${message.message_id.slice(-8)}`;
  const baseName = captionName || fallbackName;
  return `${baseName}.${extension}`;
}

function resolveMessageDownloadInfo(
  message: InternalChatMessage
): { url: string; name: string; kind: DownloadKind } | null {
  const content = message.content;
  const imageUrl = resolveMediaUri(content?.image?.url);
  if (imageUrl) {
    return {
      url: imageUrl,
      name: resolveImageDownloadName(message, imageUrl),
      kind: 'image',
    };
  }

  const videoUrl = resolveMediaUri(content?.video?.url);
  if (videoUrl) {
    return {
      url: videoUrl,
      name: resolveVideoDownloadName(content?.video),
      kind: 'video',
    };
  }

  const documentUrl = resolveMediaUri(content?.document?.url);
  if (documentUrl) {
    return {
      url: documentUrl,
      name: resolveDocumentDisplayName(content?.document),
      kind: 'document',
    };
  }

  const audioUrl = resolveMediaUri(content?.audio?.url);
  if (audioUrl) {
    const audioName =
      readNonEmptyString(content?.audio?.name) ??
      `audio-${message.message_id.slice(-8)}.${
        content?.audio?.extension?.replace(/^\./, '') || 'm4a'
      }`;
    return {
      url: audioUrl,
      name: sanitizeFilename(audioName),
      kind: 'document',
    };
  }

  return null;
}

function normalizePhoneDigits(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\D/g, '');
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
    email: readNonEmptyString(contact.email) ?? null,
  };
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

function createWaveformCacheSignature(data: WaveformInput): string {
  if (!data) return 'waveform:empty';
  if (typeof data === 'string') return `waveform:string:${data.trim()}`;
  return `waveform:array:${data.length}:${data.join(',')}`;
}

function isAudioPlaybackNearEnd(position: number, duration: number): boolean {
  if (!Number.isFinite(position) || !Number.isFinite(duration)) return false;
  if (duration <= 0) return false;
  return position >= Math.max(0, duration - AUDIO_FINISH_THRESHOLD_SECONDS);
}

const PLAYBACK_AUDIO_MODE = {
  allowsRecording: false,
  playsInSilentMode: true,
  interruptionMode: 'mixWithOthers',
  shouldPlayInBackground: false,
  shouldRouteThroughEarpiece: false,
  allowsBackgroundRecording: false,
} as const;

async function ensureIosPlaybackAudioMode(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    await setAudioModeAsync(PLAYBACK_AUDIO_MODE);
  } catch {}
}

type InternalAudioState = {
  isPlaying: boolean;
  position: number;
  duration: number;
  rate: number;
  isLoading: boolean;
  isBuffering: boolean;
};

const DEFAULT_INTERNAL_AUDIO_STATE: InternalAudioState = {
  isPlaying: false,
  position: 0,
  duration: 0,
  rate: 1,
  isLoading: false,
  isBuffering: false,
};

function useInternalChatAudio() {
  const [state, setState] = useState<Record<string, InternalAudioState>>({});
  const [waveformWidths, setWaveformWidths] = useState<Record<string, number>>(
    {}
  );
  const soundRefs = useRef<Record<string, AudioPlayer | null>>({});
  const listenerRefs = useRef<Record<string, { remove?: () => void } | null>>(
    {}
  );
  const waveformCache = useRef<Record<string, number[]>>({});
  const waveformCacheSignature = useRef<Record<string, string>>({});
  const pendingAutoPlayRef = useRef<Record<string, boolean>>({});
  const pendingAutoPlayRateRef = useRef<Record<string, number>>({});
  const finishedPlaybackRef = useRef<Record<string, boolean>>({});

  const updateState = useCallback(
    (messageId: string, patch: Partial<InternalAudioState>) => {
      setState((prev) => ({
        ...prev,
        [messageId]: {
          ...DEFAULT_INTERNAL_AUDIO_STATE,
          ...prev[messageId],
          ...patch,
        },
      }));
    },
    []
  );

  const releaseSound = useCallback((messageId: string) => {
    pendingAutoPlayRef.current[messageId] = false;
    delete pendingAutoPlayRateRef.current[messageId];
    delete finishedPlaybackRef.current[messageId];
    delete waveformCache.current[messageId];
    delete waveformCacheSignature.current[messageId];

    const listener = listenerRefs.current[messageId];
    if (listener?.remove) {
      try {
        listener.remove();
      } catch {}
    }
    delete listenerRefs.current[messageId];

    const player = soundRefs.current[messageId];
    if (player) {
      try {
        player.pause();
      } catch {}
      try {
        player.remove();
      } catch {}
    }
    delete soundRefs.current[messageId];
  }, []);

  const disposeAllPlayers = useCallback(() => {
    for (const messageId of Object.keys(soundRefs.current)) {
      releaseSound(messageId);
    }
    waveformCache.current = {};
    waveformCacheSignature.current = {};
  }, [releaseSound]);

  const resetPlaybackToStart = useCallback(
    (messageId: string, player: AudioPlayer, durationHint: number) => {
      finishedPlaybackRef.current[messageId] = true;
      pendingAutoPlayRef.current[messageId] = false;
      const durationSec =
        durationHint > 0 ? durationHint : player.duration || 0;

      const applyReset = () => {
        const patch: Partial<InternalAudioState> = {
          isPlaying: false,
          position: 0,
          isLoading: false,
          isBuffering: false,
        };
        if (durationSec > 0) patch.duration = durationSec;
        updateState(messageId, patch);
      };

      try {
        player.pause();
      } catch {}

      try {
        player.seekTo(0).then(applyReset).catch(applyReset);
      } catch {
        applyReset();
      }
    },
    [updateState]
  );

  const getOrCreateSound = useCallback(
    (messageId: string, url: string): AudioPlayer | null => {
      if (soundRefs.current[messageId]) return soundRefs.current[messageId];
      try {
        const player = createAudioPlayer(url, {
          updateInterval: 300,
          downloadFirst: true,
          preferredForwardBufferDuration: 10,
        });
        player.loop = false;
        const initialDuration = player.duration || 0;
        const initialPatch: Partial<InternalAudioState> = {
          isLoading: !player.isLoaded,
          isBuffering: player.isBuffering,
        };
        if (initialDuration > 0) initialPatch.duration = initialDuration;
        updateState(messageId, initialPatch);

        const subscription = player.addListener(
          'playbackStatusUpdate',
          (status) => {
            const statusDuration = status.duration || player.duration || 0;
            const statusPosition = status.currentTime || 0;
            const didFinish =
              status.didJustFinish ||
              (!status.playing &&
                isAudioPlaybackNearEnd(statusPosition, statusDuration));

            if (didFinish) {
              resetPlaybackToStart(messageId, player, statusDuration);
              return;
            }

            setState((prev) => {
              const cur = prev[messageId];
              const nextRate =
                cur?.rate ??
                status.playbackRate ??
                pendingAutoPlayRateRef.current[messageId] ??
                1;
              return {
                ...prev,
                [messageId]: {
                  ...DEFAULT_INTERNAL_AUDIO_STATE,
                  ...cur,
                  isPlaying: status.playing,
                  position: statusPosition,
                  duration:
                    statusDuration > 0 ? statusDuration : (cur?.duration ?? 0),
                  rate: nextRate,
                  isLoading: !status.isLoaded,
                  isBuffering: status.isBuffering,
                },
              };
            });

            if (
              status.isLoaded &&
              pendingAutoPlayRef.current[messageId] &&
              !finishedPlaybackRef.current[messageId] &&
              !status.playing
            ) {
              pendingAutoPlayRef.current[messageId] = false;
              const rate = pendingAutoPlayRateRef.current[messageId] ?? 1;
              try {
                player.setPlaybackRate(rate);
                player.play();
              } catch {}
            }
          }
        );
        listenerRefs.current[messageId] = subscription ?? null;
        soundRefs.current[messageId] = player;
        return player;
      } catch {
        return null;
      }
    },
    [resetPlaybackToStart, updateState]
  );

  const playPause = useCallback(
    (messageId: string, url: string) => {
      const runPlaybackToggle = async () => {
        const player = getOrCreateSound(messageId, url);
        if (!player) return;
        const cur = state[messageId] ?? DEFAULT_INTERNAL_AUDIO_STATE;

        if (cur.isPlaying) {
          pendingAutoPlayRef.current[messageId] = false;
          player.pause();
          updateState(messageId, {
            isPlaying: false,
            isLoading: false,
            isBuffering: false,
          });
          return;
        }

        await ensureIosPlaybackAudioMode();

        const rate = cur.rate ?? 1;
        finishedPlaybackRef.current[messageId] = false;
        pendingAutoPlayRateRef.current[messageId] = rate;

        const startPlayback = () => {
          try {
            player.setPlaybackRate(rate);
          } catch {}

          if (player.isLoaded && !player.isBuffering) {
            pendingAutoPlayRef.current[messageId] = false;
            updateState(messageId, {
              isLoading: false,
              isBuffering: false,
            });
            try {
              player.play();
            } catch {}
            return;
          }

          pendingAutoPlayRef.current[messageId] = true;
          updateState(messageId, {
            isLoading: true,
            isBuffering: player.isBuffering,
          });

          if (player.isLoaded) {
            try {
              player.play();
            } catch {}
          }
        };

        const durationSec =
          cur.duration > 0 ? cur.duration : player.duration || 0;
        const positionSec =
          cur.position > 0 ? cur.position : player.currentTime || 0;
        if (isAudioPlaybackNearEnd(positionSec, durationSec)) {
          try {
            player.seekTo(0).then(() => {
              updateState(messageId, { position: 0 });
              startPlayback();
            });
            return;
          } catch {}
        }

        startPlayback();
      };

      void runPlaybackToggle();
    },
    [getOrCreateSound, state, updateState]
  );

  const seek = useCallback(
    (messageId: string, url: string, percentage: number) => {
      const player = getOrCreateSound(messageId, url);
      if (!player) return;
      finishedPlaybackRef.current[messageId] = false;
      pendingAutoPlayRef.current[messageId] = false;

      const cur = state[messageId];
      const durationSec =
        (cur?.duration && cur.duration > 0 ? cur.duration : player.duration) ||
        0;
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
      pendingAutoPlayRateRef.current[messageId] = nextRate;
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
    (messageId: string, data: WaveformInput): number[] => {
      const signature = createWaveformCacheSignature(data);
      if (
        waveformCache.current[messageId] &&
        waveformCacheSignature.current[messageId] === signature
      ) {
        return waveformCache.current[messageId];
      }
      const parsed = parseWaveform(data);
      if (parsed && parsed.length > 0) {
        waveformCache.current[messageId] = parsed;
        waveformCacheSignature.current[messageId] = signature;
        return parsed;
      }
      const placeholder = createFlatWaveformPlaceholder(
        AUDIO_WAVEFORM_DEFAULT_BARS
      );
      waveformCache.current[messageId] = placeholder;
      waveformCacheSignature.current[messageId] = signature;
      return placeholder;
    },
    []
  );

  const getState = useCallback(
    (messageId: string): InternalAudioState => {
      return state[messageId] ?? DEFAULT_INTERNAL_AUDIO_STATE;
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

  const setWaveformWidth = useCallback((messageId: string, width: number) => {
    const nextWidth = Math.max(0, Math.round(width));
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

  useEffect(() => {
    return () => {
      disposeAllPlayers();
    };
  }, [disposeAllPlayers]);

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

type InternalAudioCtrl = ReturnType<typeof useInternalChatAudio>;

function InternalVideoMessagePreview({
  sourceUri,
  thumbnailUri,
  onPress,
  onLongPress,
}: {
  sourceUri: string;
  thumbnailUri: string | null;
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
        if (active) setGeneratedThumbnailUri(result.uri);
      })
      .catch(() => {
        if (active) setGeneratedThumbnailUri(null);
      })
      .finally(() => {
        if (active) setGeneratingThumbnail(false);
      });

    return () => {
      active = false;
    };
  }, [shouldGenerateThumbnail, sourceUri]);

  const previewUri = shouldGenerateThumbnail
    ? generatedThumbnailUri
    : thumbnailUri;

  return (
    <Pressable
      style={styles.videoThumbWrap}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={220}
    >
      {previewUri ? (
        <Image
          source={{ uri: previewUri }}
          style={styles.videoThumb}
          resizeMode="cover"
          onError={() => setThumbnailLoadError(true)}
        />
      ) : (
        <View style={styles.videoPlaceholder}>
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

function InternalLinkPreviewMessage({
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
  const domain = resolveDomainFromUrl(
    preview['canonical-url'] ?? preview['matched-text'] ?? previewUrl
  );

  if (!title && !description && !previewImage && !previewUrl) return null;

  return (
    <Pressable
      style={[
        styles.linkPreviewCard,
        fromMe ? styles.linkPreviewCardRight : styles.linkPreviewCardLeft,
      ]}
      onPress={() => {
        if (previewUrl) void Linking.openURL(previewUrl);
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
              {insertSoftWrapOpportunities(domain)}
            </Text>
          ) : null}
          {title ? (
            <Text style={styles.linkPreviewTitle} numberOfLines={2}>
              {insertSoftWrapOpportunities(title)}
            </Text>
          ) : null}
          {description ? (
            <Text style={styles.linkPreviewDescription} numberOfLines={2}>
              {insertSoftWrapOpportunities(description)}
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
            {insertSoftWrapOpportunities(
              formatPreviewUrlForDisplay(previewUrl)
            )}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

type ReactionSummaryItem = {
  emoji: string;
  count: number;
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
    summary.set(emoji, (summary.get(emoji) ?? 0) + 1);
  }

  return Array.from(summary.entries())
    .map(([emoji, count]) => ({ emoji, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.emoji.localeCompare(b.emoji);
    });
}

function resolveInternalMessageContentType(
  content: MessageContent | null | undefined
): string {
  const explicitType = readNonEmptyString(content?.type);
  if (explicitType) return explicitType;
  if (content?.image) return INTERNAL_MESSAGE_TYPE.image;
  if (content?.video) return INTERNAL_MESSAGE_TYPE.video;
  if (content?.audio) return INTERNAL_MESSAGE_TYPE.audio;
  if (content?.document) return INTERNAL_MESSAGE_TYPE.document;
  if (content?.location) return INTERNAL_MESSAGE_TYPE.location;
  if (content?.contact) return INTERNAL_MESSAGE_TYPE.contact_card;
  if (content?.contacts && content.contacts.length > 0) {
    return INTERNAL_MESSAGE_TYPE.contacts;
  }
  return INTERNAL_MESSAGE_TYPE.text;
}

function resolveQuotedType(quoted: MessageQuoted | null | undefined): string {
  const explicitType = readNonEmptyString(quoted?.type);
  if (explicitType) return explicitType;
  if (quoted?.image) return INTERNAL_MESSAGE_TYPE.image;
  if (quoted?.video) return INTERNAL_MESSAGE_TYPE.video;
  if (quoted?.audio) return INTERNAL_MESSAGE_TYPE.audio;
  if (quoted?.document) return INTERNAL_MESSAGE_TYPE.document;
  if (quoted?.location) return INTERNAL_MESSAGE_TYPE.location;
  if (quoted?.contact) return INTERNAL_MESSAGE_TYPE.contact_card;
  if (quoted?.contacts && quoted.contacts.length > 0) {
    return INTERNAL_MESSAGE_TYPE.contacts;
  }
  return INTERNAL_MESSAGE_TYPE.text;
}

function resolveQuotedText(
  quoted: MessageQuoted | null | undefined,
  quotedType: string
): string {
  if (!quoted) return '';
  if (quotedType === INTERNAL_MESSAGE_TYPE.image) {
    return readNonEmptyString(quoted.image?.caption) ?? 'Foto';
  }
  if (quotedType === INTERNAL_MESSAGE_TYPE.document) {
    return (
      readNonEmptyString(quoted.document?.name) ||
      readNonEmptyString(quoted.message) ||
      pt.document
    );
  }
  if (quotedType === INTERNAL_MESSAGE_TYPE.video) {
    return readNonEmptyString(quoted.video?.caption) ?? 'Vídeo';
  }
  if (quotedType === INTERNAL_MESSAGE_TYPE.audio) {
    return readNonEmptyString(quoted.message) ?? pt.audio;
  }
  if (quotedType === INTERNAL_MESSAGE_TYPE.location) {
    return (
      readNonEmptyString(quoted.location?.name) ||
      readNonEmptyString(quoted.location?.address) ||
      pt.location
    );
  }
  if (quotedType === INTERNAL_MESSAGE_TYPE.contact_card && quoted.contact) {
    return (
      [quoted.contact.name, quoted.contact.last_name]
        .filter(Boolean)
        .join(' ')
        .trim() || pt.contact
    );
  }
  if (quotedType === INTERNAL_MESSAGE_TYPE.contacts) {
    const first = quoted.contacts?.[0];
    if (!first) return pt.contact;
    const firstName =
      [first.name, first.last_name].filter(Boolean).join(' ').trim() ||
      pt.contact;
    const extraCount = (quoted.contacts?.length ?? 0) - 1;
    return extraCount > 0
      ? `${firstName} e ${extraCount} ${pt.contacts_other}`
      : firstName;
  }
  return (
    resolveInternalChatTextTag(quoted.message) ??
    readNonEmptyString(quoted.message) ??
    ''
  );
}

function resolveQuotedMeta(
  quoted: MessageQuoted | null | undefined,
  quotedType: string
): string {
  if (!quoted) return '';
  if (quotedType === INTERNAL_MESSAGE_TYPE.image) {
    const ext = quoted.image?.extension
      ? quoted.image.extension.replace(/^\./, '').toUpperCase()
      : 'IMG';
    return [ext, formatFileSize(quoted.image?.size)]
      .filter(Boolean)
      .join(' • ');
  }
  if (quotedType === INTERNAL_MESSAGE_TYPE.video) {
    const ext = quoted.video?.extension
      ? quoted.video.extension.replace(/^\./, '').toUpperCase()
      : 'VIDEO';
    return [
      ext,
      formatFileSize(quoted.video?.size),
      formatAudioTime(quoted.video?.duration ?? 0),
    ]
      .filter((value) => value && value !== '0:00')
      .join(' • ');
  }
  if (quotedType === INTERNAL_MESSAGE_TYPE.audio) {
    return [
      formatFileSize(quoted.audio?.size),
      formatAudioTime(quoted.audio?.duration ?? 0),
    ]
      .filter((value) => value && value !== '0:00')
      .join(' • ');
  }
  if (quotedType === INTERNAL_MESSAGE_TYPE.document) {
    const ext = quoted.document?.extension
      ? quoted.document.extension.replace(/^\./, '').toUpperCase()
      : 'FILE';
    return [ext, formatFileSize(quoted.document?.size)]
      .filter(Boolean)
      .join(' • ');
  }
  return '';
}

function resolveQuotedPreviewImage(
  quoted: MessageQuoted | null | undefined,
  quotedType: string
): string | null {
  if (!quoted) return null;
  if (quotedType === INTERNAL_MESSAGE_TYPE.image) {
    return resolveMediaUri(quoted.image?.thumbnail ?? quoted.image?.url);
  }
  if (quotedType === INTERNAL_MESSAGE_TYPE.video) {
    return resolveMediaUri(quoted.video?.thumbnail ?? quoted.video?.url);
  }
  return null;
}

function resolveQuotedContactPhoto(
  quoted: MessageQuoted | null | undefined,
  quotedType: string
): string | null {
  if (!quoted) return null;
  if (quotedType === INTERNAL_MESSAGE_TYPE.contact_card) {
    return resolveMediaUri(quoted.contact?.photo);
  }
  if (quotedType === INTERNAL_MESSAGE_TYPE.contacts) {
    return resolveMediaUri(quoted.contacts?.[0]?.photo);
  }
  return null;
}

function InternalQuotedReplyPreview({
  quoted,
  fromMe,
}: {
  quoted: MessageQuoted | null | undefined;
  fromMe: boolean;
}) {
  if (!quoted) return null;
  const quotedType = resolveQuotedType(quoted);
  const quotedText = resolveQuotedText(quoted, quotedType);
  const quotedMeta = resolveQuotedMeta(quoted, quotedType);
  const quotedImageUri = resolveQuotedPreviewImage(quoted, quotedType);
  const quotedContactPhoto = resolveQuotedContactPhoto(quoted, quotedType);
  const isContactType =
    quotedType === INTERNAL_MESSAGE_TYPE.contact_card ||
    quotedType === INTERNAL_MESSAGE_TYPE.contacts;
  const showVideoOverlay = quotedType === INTERNAL_MESSAGE_TYPE.video;

  return (
    <View style={[styles.quotedBlock, fromMe && styles.quotedBlockRight]}>
      <View style={[styles.quotedBar, fromMe && styles.quotedBarRight]} />
      <View
        style={[styles.quotedBody, isContactType && styles.quotedBodyContact]}
      >
        <Text
          style={[
            styles.quotedName,
            fromMe && styles.quotedNameRight,
            isContactType && styles.quotedNameContact,
          ]}
          numberOfLines={1}
        >
          Resposta
        </Text>
        <View
          style={[
            styles.quotedContentRow,
            isContactType && styles.quotedContentRowContact,
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
          ) : quotedType === INTERNAL_MESSAGE_TYPE.document ? (
            <Ionicons
              name="document-text-outline"
              size={18}
              color={colors.primary}
            />
          ) : quotedType === INTERNAL_MESSAGE_TYPE.audio ? (
            <Ionicons name="mic-outline" size={18} color={colors.primary} />
          ) : quotedType === INTERNAL_MESSAGE_TYPE.location ? (
            <Ionicons
              name="location-outline"
              size={18}
              color={colors.primary}
            />
          ) : isContactType ? (
            quotedContactPhoto ? (
              <Image
                source={{ uri: quotedContactPhoto }}
                style={styles.quotedContactAvatar}
                resizeMode="cover"
              />
            ) : (
              <Ionicons
                name={
                  quotedType === INTERNAL_MESSAGE_TYPE.contacts
                    ? 'people-outline'
                    : 'person-outline'
                }
                size={18}
                color={colors.primary}
              />
            )
          ) : null}
          <View
            style={[
              styles.quotedTextWrap,
              isContactType && styles.quotedTextWrapContact,
            ]}
          >
            {quotedText ? (
              <WhatsAppFormattedText
                text={quotedText}
                style={[
                  styles.quotedText,
                  fromMe && styles.quotedTextRight,
                  isContactType && styles.quotedTextContact,
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
    </View>
  );
}

function InternalMessageContent({
  msg,
  fromMe,
  audioCtrl,
  onOpenActions,
  onOpenImage,
  onOpenVideo,
  onPressContactCard,
  onPressContactsGroup,
}: {
  msg: InternalChatMessage;
  fromMe: boolean;
  audioCtrl: InternalAudioCtrl;
  onOpenActions: (message: InternalChatMessage) => void;
  onOpenImage: (message: InternalChatMessage) => void;
  onOpenVideo: (message: InternalChatMessage) => void;
  onPressContactCard: (
    message: InternalChatMessage,
    contact: MessageContentContact
  ) => void;
  onPressContactsGroup: (
    message: InternalChatMessage,
    contacts: MessageContentContact[]
  ) => void;
}) {
  const [isLongTextExpanded, setIsLongTextExpanded] = useState(false);
  const [longTextLineCount, setLongTextLineCount] = useState<number | null>(
    null
  );
  const renderedText = getMessageText(msg);

  useEffect(() => {
    setIsLongTextExpanded(false);
    setLongTextLineCount(null);
  }, [msg.message_id, renderedText]);

  const content = msg.content;
  const type = resolveInternalMessageContentType(content);
  const textColor = fromMe ? styles.bubbleTextRight : styles.bubbleTextLeft;
  const linkPreview = content?.link_preview;
  const hasLinkPreview = Boolean(
    linkPreview &&
    (readNonEmptyString(linkPreview.title) ||
      readNonEmptyString(linkPreview.description) ||
      resolvePreviewImage(linkPreview) ||
      resolvePreviewUrl(linkPreview))
  );
  const renderWithContextCards = (child: ReactElement | null) => {
    if (!hasLinkPreview || !linkPreview) return child;
    return (
      <View style={styles.contentStack}>
        <InternalLinkPreviewMessage
          preview={linkPreview}
          fromMe={fromMe}
          onLongPress={() => onOpenActions(msg)}
        />
        {child}
      </View>
    );
  };

  if (msg.deleted) {
    return renderWithContextCards(
      <WhatsAppFormattedText
        text={renderedText}
        style={[styles.bubbleText, textColor, styles.messageDeletedText]}
      />
    );
  }

  if (type === INTERNAL_MESSAGE_TYPE.system) {
    const text = renderedText;
    return renderWithContextCards(
      <View style={styles.systemWrap}>
        <WhatsAppFormattedText text={text} style={styles.systemText} />
      </View>
    );
  }

  if (type === INTERNAL_MESSAGE_TYPE.image && content?.image?.url) {
    const imageUri = resolveMediaUri(content.image.url);
    if (!imageUri) return null;
    const cap = content.image.caption;
    return renderWithContextCards(
      <View style={[styles.mediaBubble, styles.mediaBubbleImage]}>
        <Pressable
          onPress={() => onOpenImage(msg)}
          onLongPress={() => onOpenActions(msg)}
          delayLongPress={220}
        >
          <ExpoImage
            source={{ uri: imageUri }}
            style={styles.imageThumb}
            contentFit="cover"
          />
        </Pressable>
        {cap ? (
          <WhatsAppFormattedText
            text={cap}
            style={[styles.mediaCaption, textColor]}
            onLinkLongPress={() => onOpenActions(msg)}
          />
        ) : null}
      </View>
    );
  }

  if (type === INTERNAL_MESSAGE_TYPE.video && content?.video?.url) {
    const videoUri = resolveMediaUri(content.video.url);
    if (!videoUri) return null;
    const thumbUri = resolveMediaUri(content.video.thumbnail);
    const cap = content.video.caption;
    const videoMeta = resolveVideoMeta(content.video);

    return renderWithContextCards(
      <View style={styles.mediaBubble}>
        <InternalVideoMessagePreview
          sourceUri={videoUri}
          thumbnailUri={thumbUri}
          onPress={() => onOpenVideo(msg)}
          onLongPress={() => onOpenActions(msg)}
        />
        {videoMeta ? <Text style={styles.mediaMeta}>{videoMeta}</Text> : null}
        {cap ? (
          <WhatsAppFormattedText
            text={cap}
            style={[styles.mediaCaption, textColor]}
            onLinkLongPress={() => onOpenActions(msg)}
          />
        ) : null}
      </View>
    );
  }

  if (type === INTERNAL_MESSAGE_TYPE.location && content?.location) {
    const coordinate = normalizeLocationCoordinate(
      content.location.latitude,
      content.location.longitude
    );
    if (!coordinate) return null;

    return renderWithContextCards(
      <LocationMessagePreview
        latitude={coordinate.latitude}
        longitude={coordinate.longitude}
        name={content.location.name}
        address={content.location.address}
        onLongPress={() => onOpenActions(msg)}
      />
    );
  }

  if (type === INTERNAL_MESSAGE_TYPE.audio && content?.audio?.url) {
    const messageId = msg.message_id;
    const url = resolveMediaUri(content.audio.url) ?? content.audio.url;
    const cap = readNonEmptyString(content.message);
    const fallbackDuration = content.audio.duration ?? 0;
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
            onLongPress={() => onOpenActions(msg)}
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
              onLongPress={() => onOpenActions(msg)}
              delayLongPress={220}
            >
              {audioState.isLoading || audioState.isBuffering ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons
                  name={audioState.isPlaying ? 'pause' : 'play'}
                  size={16}
                  color={colors.primary}
                />
              )}
            </Pressable>
            <Text
              style={[
                styles.audioTimeBelowPlay,
                fromMe
                  ? styles.audioTimeBelowPlayRight
                  : styles.audioTimeBelowPlayLeft,
              ]}
            >
              {formatAudioTime(currentTime)}
            </Text>
          </View>
          <Pressable
            style={styles.audioWaveformContainer}
            onLayout={(event) => {
              audioCtrl.setWaveformWidth(
                messageId,
                event.nativeEvent.layout.width
              );
            }}
            onLongPress={() => onOpenActions(msg)}
            delayLongPress={220}
            onPress={(event) => {
              const width = audioCtrl.getWaveformWidth(messageId);
              if (!width) return;
              const locationX = event.nativeEvent.locationX;
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
            onLinkLongPress={() => onOpenActions(msg)}
          />
        ) : null}
      </View>
    );
  }

  if (type === INTERNAL_MESSAGE_TYPE.document && content?.document?.url) {
    const doc = content.document;
    const docUrl = resolveMediaUri(doc.url);
    if (!docUrl) return null;
    const ext = resolveDocumentExtensionLabel(doc);
    const extLabel = ext.slice(0, 4);
    const sizeStr = formatFileSize(doc.size);
    const name = resolveDocumentDisplayName(doc);
    const meta = [ext, sizeStr].filter(Boolean).join(' • ');
    const cap = readNonEmptyString(content.message);

    return renderWithContextCards(
      <View>
        <View style={[styles.documentCard, fromMe && styles.documentCardRight]}>
          <Pressable
            style={styles.documentMainAction}
            onPress={() => {
              void Linking.openURL(docUrl);
            }}
            onLongPress={() => onOpenActions(msg)}
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
              {meta ? (
                <Text style={styles.documentMeta} numberOfLines={1}>
                  {meta}
                </Text>
              ) : null}
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
                resolveDocumentDisplayName(doc),
                'document'
              );
            }}
            onLongPress={() => onOpenActions(msg)}
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
            onLinkLongPress={() => onOpenActions(msg)}
          />
        ) : null}
      </View>
    );
  }

  if (type === INTERNAL_MESSAGE_TYPE.contact_card && content?.contact) {
    return renderWithContextCards(
      <InternalContactCard
        contact={content.contact}
        fromMe={fromMe}
        onPress={() => onPressContactCard(msg, content.contact!)}
        onLongPress={() => onOpenActions(msg)}
      />
    );
  }

  if (type === INTERNAL_MESSAGE_TYPE.contacts && content?.contacts?.length) {
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
        onPress={() => onPressContactsGroup(msg, list)}
        onLongPress={() => onOpenActions(msg)}
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

  const text = renderedText;
  if (text) {
    const longTextState = resolveLongTextCollapse({
      text,
      isExpanded: isLongTextExpanded,
      measuredLineCount: longTextLineCount,
    });

    return renderWithContextCards(
      <View style={styles.bubbleTextWrap}>
        <WhatsAppFormattedText
          text={text}
          style={[styles.bubbleText, textColor]}
          selectable={false}
          numberOfLines={longTextState.numberOfLines}
          onLinkLongPress={() => onOpenActions(msg)}
          onTextLayout={(event) => {
            const lineCount = event.nativeEvent.lines?.length ?? 0;
            if (lineCount > LONG_TEXT_COLLAPSE_LINES) {
              setLongTextLineCount((previous) =>
                previous === lineCount ? previous : lineCount
              );
            }
          }}
        />
        {longTextState.canToggle ? (
          <Pressable
            onPress={() => setIsLongTextExpanded((previous) => !previous)}
            hitSlop={8}
            style={styles.readMoreButton}
          >
            <Text style={styles.readMoreText}>
              {longTextState.toggleLabel === 'more'
                ? pt.read_more
                : pt.read_less}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return renderWithContextCards(null);
}

function InternalContactCard({
  contact,
  fromMe,
  onPress,
  onLongPress,
}: {
  contact: MessageContentContact;
  fromMe: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const contactName =
    [contact.name, contact.last_name].filter(Boolean).join(' ').trim() ||
    pt.contact;
  const photoUri = resolveMediaUri(contact.photo);
  const phone =
    readNonEmptyString(contact.phone) ??
    readNonEmptyString(contact.phone_partial);
  const phoneDisplay = phone
    ? `${contact.phone_ddi ? `+${contact.phone_ddi} ` : ''}${phone}`
    : readNonEmptyString(contact.email_partial);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.contactWrap,
        fromMe && styles.contactWrapRight,
        pressed && styles.contactWrapPressed,
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={220}
    >
      <View
        style={[
          styles.contactAvatarWrap,
          fromMe && styles.contactAvatarWrapRight,
        ]}
      >
        <AppAvatar
          uri={photoUri}
          size={36}
          style={styles.contactAvatar}
          iconName="person"
          iconSize={18}
          iconColor={colors.primary}
        />
      </View>
      <View style={styles.contactInfo}>
        <Text style={styles.contactName} numberOfLines={2}>
          {contactName}
        </Text>
        {phoneDisplay ? (
          <Text style={styles.contactPhone} numberOfLines={1}>
            {phoneDisplay}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function InternalChatRoomSkeleton({ compact = false }: { compact?: boolean }) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const useNativeDriver = Platform.OS !== 'web';
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 600,
          useNativeDriver,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 600,
          useNativeDriver,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  const bubble = (align: 'left' | 'right', index: number) => (
    <View
      key={`internal-room-skeleton-${align}-${index}`}
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

  const sequence: Array<'left' | 'right'> = compact
    ? ['left', 'right']
    : ['left', 'right', 'left', 'right', 'left', 'right'];

  return (
    <View
      style={[
        styles.skeletonRoomContainer,
        compact && styles.skeletonRoomContainerCompact,
      ]}
    >
      {!compact ? (
        <View style={styles.skeletonDateRow}>
          <View style={styles.skeletonDateLine} />
          <Animated.View style={[styles.skeletonDatePill, { opacity }]} />
          <View style={styles.skeletonDateLine} />
        </View>
      ) : null}
      {sequence.map((align, index) => bubble(align, index))}
    </View>
  );
}

function InternalSearchResultsSkeleton({ rows = 5 }: { rows?: number }) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const useNativeDriver = Platform.OS !== 'web';
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 600,
          useNativeDriver,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 600,
          useNativeDriver,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <View style={styles.searchSkeletonList}>
      {Array.from({ length: rows }).map((_, index) => (
        <View
          key={`internal-search-skeleton-${index}`}
          style={styles.searchSkeletonRow}
        >
          <Animated.View style={[styles.searchSkeletonDate, { opacity }]} />
          <Animated.View style={[styles.searchSkeletonText, { opacity }]} />
          <Animated.View
            style={[styles.searchSkeletonTextShort, { opacity }]}
          />
        </View>
      ))}
    </View>
  );
}

function InternalMessageBubble({
  msg,
  fromMe,
  showAvatar,
  bubbleMaxWidth,
  documentBubbleWidth,
  highlighted,
  audioCtrl,
  onOpenActions,
  onOpenImage,
  onOpenVideo,
  onPressContactCard,
  onPressContactsGroup,
}: {
  msg: InternalChatMessage;
  fromMe: boolean;
  showAvatar: boolean;
  bubbleMaxWidth: number;
  documentBubbleWidth: number;
  highlighted?: boolean;
  audioCtrl: InternalAudioCtrl;
  onOpenActions: (message: InternalChatMessage) => void;
  onOpenImage: (message: InternalChatMessage) => void;
  onOpenVideo: (message: InternalChatMessage) => void;
  onPressContactCard: (
    message: InternalChatMessage,
    contact: MessageContentContact
  ) => void;
  onPressContactsGroup: (
    message: InternalChatMessage,
    contacts: MessageContentContact[]
  ) => void;
}) {
  const content = msg.content;
  const type = resolveInternalMessageContentType(content);
  const latestText = getMessageText(msg).trim();
  const isSystem = isInternalChatSystemMessage(msg);
  const isAudio = type === INTERNAL_MESSAGE_TYPE.audio && !!content?.audio?.url;
  const isDocument =
    type === INTERNAL_MESSAGE_TYPE.document && !!content?.document?.url;
  const isContactCard =
    type === INTERNAL_MESSAGE_TYPE.contact_card ||
    type === INTERNAL_MESSAGE_TYPE.contacts;
  const hasQuoted = !!content?.quoted;
  const isShortTextMessage =
    latestText.length > 0 &&
    latestText.length <= 8 &&
    !isSystem &&
    !isAudio &&
    !isDocument &&
    !isContactCard &&
    !content?.image?.url &&
    !content?.video?.url &&
    !content?.location &&
    !content?.link_preview;
  const reactionsSummary = getReactionsSummary(content?.reactions);
  const bubbleBg = isSystem
    ? 'rgba(47, 43, 61, 0.08)'
    : fromMe
      ? colors.bubbleSent
      : colors.surface;

  return (
    <View
      style={[
        styles.messageBubbleWrap,
        isSystem && styles.messageBubbleWrapCenter,
        !isSystem &&
          (fromMe
            ? styles.messageBubbleWrapRight
            : styles.messageBubbleWrapLeft),
      ]}
    >
      <View
        style={[
          styles.messageBubbleRow,
          fromMe && styles.messageBubbleRowRight,
          isSystem && styles.messageBubbleRowCenter,
        ]}
      >
        {showAvatar && !isSystem ? (
          <AppAvatar uri={msg.user?.photo ?? null} size={28} />
        ) : null}
        <Pressable
          style={({ pressed }) => [
            styles.bubble,
            { maxWidth: bubbleMaxWidth, backgroundColor: bubbleBg },
            isSystem && styles.bubbleSystem,
            isContactCard && styles.bubbleContact,
            isAudio && styles.bubbleAudio,
            isDocument && styles.bubbleDocument,
            isDocument && {
              minWidth: documentBubbleWidth,
              width: documentBubbleWidth,
              maxWidth: documentBubbleWidth,
            },
            hasQuoted && styles.bubbleQuotedMinWidth,
            isShortTextMessage && styles.bubbleShortMinWidth,
            highlighted && styles.bubbleHighlighted,
            msg.deleted && styles.bubbleDeleted,
            pressed && styles.bubblePressed,
          ]}
          onLongPress={() => onOpenActions(msg)}
          delayLongPress={220}
        >
          {!fromMe && !isSystem && showAvatar ? (
            <Text
              style={[
                styles.senderName,
                isInternalChatSystemMessage(msg) && styles.systemSenderName,
              ]}
              numberOfLines={1}
            >
              {resolveInternalChatSenderName(msg)}
            </Text>
          ) : null}
          <InternalQuotedReplyPreview
            quoted={content?.quoted}
            fromMe={fromMe}
          />
          <InternalMessageContent
            msg={msg}
            fromMe={fromMe}
            audioCtrl={audioCtrl}
            onOpenActions={onOpenActions}
            onOpenImage={onOpenImage}
            onOpenVideo={onOpenVideo}
            onPressContactCard={onPressContactCard}
            onPressContactsGroup={onPressContactsGroup}
          />
          <View
            style={[
              styles.bubbleMeta,
              isAudio && styles.bubbleMetaAudio,
              isDocument && styles.bubbleMetaDocument,
            ]}
          >
            {msg.local_status === 'sending' ? (
              <Text style={styles.bubbleEditedBadgeLeft}>enviando</Text>
            ) : msg.local_status === 'error' ? (
              <Text style={styles.errorMetaText}>erro</Text>
            ) : null}
            <Text
              style={[
                styles.bubbleTime,
                fromMe ? styles.bubbleTimeRight : styles.bubbleTimeLeft,
              ]}
            >
              {formatMessageTime(msg.date)}
            </Text>
          </View>
        </Pressable>
      </View>
      {reactionsSummary.length > 0 && !isSystem ? (
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

export function InternalChatRoomScreen() {
  const navigation = useNavigation<Navigation>();
  const route = useRoute<ScreenRoute>();
  const insets = useSafeAreaInsets();
  const { width: viewportWidth } = useWindowDimensions();
  const audioCtrl = useInternalChatAudio();
  const listRef = useRef<FlatList<InternalChatMessage>>(null);
  const pendingScrollToBottomRef = useRef(true);
  const scrollOffsetRef = useRef(0);
  const contentHeightRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const isNearBottomRef = useRef(true);
  const previousMessagesLengthRef = useRef(0);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preserveScrollOnPrependRef = useRef<{
    previousOffset: number;
    previousContentHeight: number;
  } | null>(null);
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
    state.activeConversation?.conversation_id ===
    routeConversation.conversation_id
      ? state.activeConversation
      : routeConversation;
  const conversationId = activeConversation.conversation_id;
  const messages = state.messages[conversationId] ?? [];
  const paging = state.messagesPaging[conversationId];
  const messageIdSet = useMemo(
    () => new Set(messages.map((message) => message.message_id)),
    [messages]
  );

  const [composerText, setComposerText] = useState('');
  const [composerInputHeight, setComposerInputHeight] = useState(
    COMPOSER_INPUT_MIN_HEIGHT
  );
  const [replyTo, setReplyTo] = useState<InternalChatMessage | null>(null);
  const [editingMessage, setEditingMessage] =
    useState<InternalChatMessage | null>(null);
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
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<
    InternalChatSearchMessageResult[]
  >([]);
  const [searchCurrentPage, setSearchCurrentPage] = useState(1);
  const [searchTotalPages, setSearchTotalPages] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [openingSearchMessageId, setOpeningSearchMessageId] = useState<
    string | null
  >(null);
  const [pendingSearchScrollMessageId, setPendingSearchScrollMessageId] =
    useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<
    string | null
  >(null);
  const [contactsVisible, setContactsVisible] = useState(false);
  const [contacts, setContacts] = useState<InternalChatContact[]>([]);
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
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
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
  const [downloadingViewerMedia, setDownloadingViewerMedia] = useState(false);
  const viewerVideoPlayer = useVideoPlayer(
    viewer.kind === 'video' && viewer.src ? { uri: viewer.src } : null,
    (player) => {
      player.loop = false;
    }
  );

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

  useEffect(() => {
    if (viewer.visible && viewer.kind === 'video') return;
    try {
      viewerVideoPlayer.pause();
      viewerVideoPlayer.currentTime = 0;
    } catch {}
  }, [viewer.kind, viewer.visible, viewerVideoPlayer]);

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
      if (safeIndex === previous.activeIndex) return previous;

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
      viewerTranslateY.setValue(Math.max(0, translationY));
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

      if (oldState !== State.ACTIVE) return;

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
    (message: InternalChatMessage) => {
      const imageUrl = message.content?.image?.url;
      if (!imageUrl) return;
      const imageSrc = resolveMediaUri(imageUrl);
      if (!imageSrc) return;

      openImageViewerFromItems([
        {
          src: imageSrc,
          caption: message.content?.image?.caption ?? '',
          downloadName: resolveImageDownloadName(message, imageSrc),
        },
      ]);
    },
    [openImageViewerFromItems]
  );

  const openVideoViewer = useCallback(
    (message: InternalChatMessage) => {
      const video = message.content?.video;
      if (!video?.url) return;
      const videoSrc = resolveMediaUri(video.url);
      if (!videoSrc) return;

      viewerTranslateY.stopAnimation();
      viewerTranslateY.setValue(0);

      setViewer({
        visible: true,
        kind: 'video',
        src: videoSrc,
        caption: video.caption ?? message.content?.message ?? '',
        downloadName: resolveVideoDownloadName(video),
        items: [
          {
            src: videoSrc,
            caption: video.caption ?? message.content?.message ?? '',
            downloadName: resolveVideoDownloadName(video),
          },
        ],
        activeIndex: 0,
      });
      setDownloadingViewerMedia(false);
    },
    [viewerTranslateY]
  );

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
      await forceDownloadToDevice(
        viewerSrc,
        viewerDownloadName || defaultName,
        viewer.kind
      );
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

  const openContactFormFromMessageContact = useCallback(
    async (contact: MessageContentContact) => {
      dismissKeyboard();

      const fallbackPhoneDdi = readNonEmptyString(contact.phone_ddi) ?? '55';
      const initialValues = buildContactFormInitialValues(
        contact,
        fallbackPhoneDdi
      );

      let lookup: Awaited<ReturnType<typeof getChatContactById>> = null;
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
    []
  );

  const handlePressMessageContactCard = useCallback(
    (_message: InternalChatMessage, contact: MessageContentContact) => {
      void openContactFormFromMessageContact(contact);
    },
    [openContactFormFromMessageContact]
  );

  const handlePressMessageContactsGroup = useCallback(
    (_message: InternalChatMessage, contactsList: MessageContentContact[]) => {
      if (!Array.isArray(contactsList) || contactsList.length === 0) return;

      if (contactsList.length === 1) {
        void openContactFormFromMessageContact(contactsList[0]);
        return;
      }

      dismissKeyboard();
      setMessageContactsSheetItems(contactsList);
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
  }, []);

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

  const handleComposerContentSizeChange = useCallback(
    (event: TextInputContentSizeChangeEvent) => {
      const nextHeight = Math.min(
        COMPOSER_INPUT_MAX_HEIGHT,
        Math.max(
          COMPOSER_INPUT_MIN_HEIGHT,
          Math.ceil(event.nativeEvent.contentSize.height)
        )
      );

      setComposerInputHeight((currentHeight) =>
        currentHeight === nextHeight ? currentHeight : nextHeight
      );
    },
    []
  );

  const responsiveBubbleMaxWidth = useMemo(
    () =>
      Math.max(
        0,
        Math.floor(
          Math.max(0, viewportWidth - CHAT_LIST_HORIZONTAL_PADDING * 2) *
            CHAT_BUBBLE_MAX_WIDTH_RATIO
        )
      ),
    [viewportWidth]
  );
  const documentBubbleWidth = useMemo(() => {
    const minWidth = Math.min(
      CHAT_DOCUMENT_BUBBLE_MIN_WIDTH,
      responsiveBubbleMaxWidth
    );
    const maxWidth = Math.min(
      responsiveBubbleMaxWidth,
      Math.floor(
        Math.max(0, viewportWidth - CHAT_LIST_HORIZONTAL_PADDING * 2) *
          CHAT_DOCUMENT_BUBBLE_MAX_WIDTH_RATIO
      )
    );
    return Math.max(minWidth, maxWidth);
  }, [responsiveBubbleMaxWidth, viewportWidth]);

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
    pendingScrollToBottomRef.current = true;
    scrollOffsetRef.current = 0;
    contentHeightRef.current = 0;
    loadingOlderRef.current = false;
    isNearBottomRef.current = true;
    previousMessagesLengthRef.current = 0;
    preserveScrollOnPrependRef.current = null;
    setLoadingOlderMessages(false);
  }, [conversationId]);

  useEffect(() => {
    if (messages.length === 0) {
      previousMessagesLengthRef.current = 0;
      return;
    }

    const previousLength = previousMessagesLengthRef.current;
    previousMessagesLengthRef.current = messages.length;

    if (preserveScrollOnPrependRef.current) return;
    if (previousLength === 0 || isNearBottomRef.current) {
      pendingScrollToBottomRef.current = true;
    }
  }, [messages.length]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim());
    }, 500);

    return () => {
      clearTimeout(timer);
    };
  }, [searchTerm]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
    };
  }, []);

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
    return addSessionUpdatedListener(() => {
      void getPermissions().then((permissions) => {
        setCanUpdateGroup(canUpdateInternalChatGroup(permissions));
        setCanManageMembers(canManageInternalChatGroupMembers(permissions));
        setCanTransferLeader(canTransferInternalChatGroupLeader(permissions));
      });
    });
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
    if (composerText.length === 0) {
      setComposerInputHeight(COMPOSER_INPUT_MIN_HEIGHT);
    }
  }, [composerText]);

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

  const scrollToEnd = useCallback((animated = true, retries = 6) => {
    pendingScrollToBottomRef.current = true;

    const attempt = (remaining: number) => {
      if (!pendingScrollToBottomRef.current) return;

      listRef.current?.scrollToEnd({
        animated: remaining === retries ? animated : false,
      });

      if (remaining <= 0) {
        pendingScrollToBottomRef.current = false;
        isNearBottomRef.current = true;
        scrollOffsetRef.current = Math.max(0, contentHeightRef.current);
        return;
      }

      setTimeout(() => {
        attempt(remaining - 1);
      }, 80);
    };

    requestAnimationFrame(() => {
      attempt(retries);
    });
  }, []);

  const handleMessagesContentSizeChange = useCallback(
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

      if (pendingScrollToBottomRef.current && !loadingOlderMessages) {
        scrollToEnd(false);
      }
    },
    [loadingOlderMessages, scrollToEnd]
  );

  const scrollToMessageById = useCallback(
    (targetMessageId: string): boolean => {
      const targetIndex = messages.findIndex(
        (message) => message.message_id === targetMessageId
      );
      if (targetIndex < 0) return false;

      pendingScrollToBottomRef.current = false;
      preserveScrollOnPrependRef.current = null;

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

      return true;
    },
    [messages]
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

  useEffect(() => {
    if (!pendingSearchScrollMessageId || searchVisible) return;
    if (!messageIdSet.has(pendingSearchScrollMessageId)) return;

    const timer = setTimeout(() => {
      if (scrollToMessageById(pendingSearchScrollMessageId)) {
        setPendingSearchScrollMessageId(null);
      }
    }, 120);

    return () => {
      clearTimeout(timer);
    };
  }, [
    messageIdSet,
    pendingSearchScrollMessageId,
    scrollToMessageById,
    searchVisible,
  ]);

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
      fields?: InternalUploadFormFields;
    }) => {
      const hash = createInternalChatMessageHash();
      const formData = createBaseFormData(
        input.type,
        hash,
        replyTo?.message_id ?? null
      );
      appendUploadFields(formData, input.fields);
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
      const result = await sendFormDataMessage(
        conversationId,
        formData,
        optimistic
      );
      if (!result.message) {
        Alert.alert(pt.error_title, result.error ?? pt.send_error);
      }
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
        asset.fileName ||
        getFileNameFromUri(asset.uri, `imagem-${Date.now()}.jpg`);
      const mimeType =
        asset.mimeType || getMimeTypeFromName(name, 'image/jpeg');
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
        asset.fileName ||
        getFileNameFromUri(asset.uri, `video-${Date.now()}.mp4`);
      const mimeType = asset.mimeType || getMimeTypeFromName(name, 'video/mp4');
      const durationSec =
        typeof asset.duration === 'number' && Number.isFinite(asset.duration)
          ? Math.max(1, Math.round(asset.duration / 1000))
          : null;
      await sendUpload({
        type: INTERNAL_MESSAGE_TYPE.video,
        field: 'videos',
        file: { uri: asset.uri, name, mimeType },
        fields: {
          video_duration: durationSec,
        },
        content: {
          type: INTERNAL_MESSAGE_TYPE.video,
          video: {
            url: asset.uri,
            name,
            mimetype: mimeType,
            duration: durationSec,
          },
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
    const mimeType =
      asset.mimeType || getMimeTypeFromName(name, 'application/octet-stream');
    await sendUpload({
      type: INTERNAL_MESSAGE_TYPE.document,
      field: 'documents',
      file: { uri: asset.uri, name, mimeType },
      content: {
        type: INTERNAL_MESSAGE_TYPE.document,
        document: {
          url: asset.uri,
          name,
          mimetype: mimeType,
          size: asset.size,
        },
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
      fields: {
        audio_ptt: false,
      },
      content: {
        type: INTERNAL_MESSAGE_TYPE.audio,
        audio: {
          url: asset.uri,
          name,
          mimetype: mimeType,
          ptt: false,
        },
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
    const data = await listInternalChatContacts({
      currentPage: 1,
      perPage: 50,
    });
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
    void publishActivity(
      conversationId,
      INTERNAL_CHAT_ACTIVITY_STATE.available
    );

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
        fields: {
          audio_ptt: true,
          audio_duration: recorded.durationSec,
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
    void publishActivity(
      conversationId,
      INTERNAL_CHAT_ACTIVITY_STATE.available
    );
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
      void publishActivity(
        conversationId,
        INTERNAL_CHAT_ACTIVITY_STATE.recording
      );

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
          handleMicPressGrant(event.nativeEvent.pageX, event.nativeEvent.pageY);
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

  const loadOlder = useCallback(async () => {
    if (
      loadingMessages ||
      loadingOlderRef.current ||
      messages.length === 0 ||
      !paging ||
      paging.current_page >= paging.total_pages
    ) {
      return;
    }

    loadingOlderRef.current = true;
    setLoadingOlderMessages(true);
    preserveScrollOnPrependRef.current = {
      previousOffset: scrollOffsetRef.current,
      previousContentHeight: contentHeightRef.current,
    };

    try {
      const loaded = await loadMessages(conversationId, {
        page: paging.current_page + 1,
        append: true,
      });
      if (loaded.length === 0) {
        preserveScrollOnPrependRef.current = null;
      }
    } catch {
      preserveScrollOnPrependRef.current = null;
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlderMessages(false);
    }
  }, [conversationId, loadMessages, loadingMessages, messages.length, paging]);

  const handleMessagesScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetY = Math.max(0, event.nativeEvent.contentOffset.y);
      const viewportHeight = event.nativeEvent.layoutMeasurement.height;
      const contentHeight =
        event.nativeEvent.contentSize.height || contentHeightRef.current;
      const distanceFromBottom = Math.max(
        0,
        contentHeight - (offsetY + viewportHeight)
      );

      scrollOffsetRef.current = offsetY;
      isNearBottomRef.current =
        distanceFromBottom <= SHOW_SCROLL_TO_BOTTOM_THRESHOLD;

      if (pendingScrollToBottomRef.current) return;
      if (offsetY <= LOAD_OLDER_SCROLL_THRESHOLD) {
        void loadOlder();
      }
    },
    [loadOlder]
  );

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
        const items = await viewMessageHistory(
          conversationId,
          target.message_id
        );
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
        const downloadInfo = resolveMessageDownloadInfo(target);
        if (downloadInfo) {
          await forceDownloadToDevice(
            downloadInfo.url,
            downloadInfo.name,
            downloadInfo.kind
          );
        }
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

  const runSearch = useCallback(
    async (reset: boolean, page: number) => {
      const normalized = debouncedSearchTerm.trim();
      if (normalized.length < 3) {
        setSearchResults([]);
        setSearchCurrentPage(1);
        setSearchTotalPages(0);
        setSearchError(null);
        return;
      }

      if (reset) {
        setSearchLoading(true);
      } else {
        setSearchLoadingMore(true);
      }
      setSearchError(null);

      try {
        const result = await searchMessages(conversationId, normalized, {
          page,
          perPage: 30,
        });

        if (reset) {
          setSearchResults(result.results);
        } else {
          setSearchResults((current) => [...current, ...result.results]);
        }
        setSearchCurrentPage(result.current_page);
        setSearchTotalPages(result.total_pages);
      } catch {
        if (reset) {
          setSearchResults([]);
        }
        setSearchError(pt.search_messages_error);
      } finally {
        if (reset) {
          setSearchLoading(false);
        } else {
          setSearchLoadingMore(false);
        }
      }
    },
    [conversationId, debouncedSearchTerm, searchMessages]
  );

  useEffect(() => {
    if (!searchVisible) {
      setSearchTerm('');
      setDebouncedSearchTerm('');
      setSearchResults([]);
      setSearchCurrentPage(1);
      setSearchTotalPages(0);
      setSearchLoading(false);
      setSearchLoadingMore(false);
      setSearchError(null);
      setOpeningSearchMessageId(null);
      return;
    }

    void runSearch(true, 1);
  }, [debouncedSearchTerm, runSearch, searchVisible]);

  const loadMoreSearchResults = useCallback(() => {
    if (searchLoading || searchLoadingMore) return;
    if (debouncedSearchTerm.trim().length < 3) return;
    if (searchCurrentPage >= searchTotalPages) return;

    void runSearch(false, searchCurrentPage + 1);
  }, [
    debouncedSearchTerm,
    runSearch,
    searchCurrentPage,
    searchLoading,
    searchLoadingMore,
    searchTotalPages,
  ]);

  const ensureSearchedMessageLoaded = useCallback(
    async (messageId: string): Promise<boolean> => {
      if (messageIdSet.has(messageId)) return true;

      pendingScrollToBottomRef.current = false;
      isNearBottomRef.current = false;
      preserveScrollOnPrependRef.current = null;

      let nextPage = (paging?.current_page ?? 1) + 1;
      const totalPages = paging?.total_pages ?? 1;

      while (nextPage <= totalPages) {
        const loaded = await loadMessages(conversationId, {
          page: nextPage,
          append: true,
        });

        if (loaded.some((message) => message.message_id === messageId)) {
          return true;
        }

        nextPage += 1;
      }

      return false;
    },
    [conversationId, loadMessages, messageIdSet, paging]
  );

  const openSearchResult = useCallback(
    async (item: InternalChatSearchMessageResult) => {
      if (openingSearchMessageId) return;

      setOpeningSearchMessageId(item.message_id);
      try {
        const found = await ensureSearchedMessageLoaded(item.message_id);
        if (!found) {
          Alert.alert(
            pt.warning_title,
            'Não foi possível abrir a mensagem encontrada.'
          );
          return;
        }

        setSearchVisible(false);
        setPendingSearchScrollMessageId(item.message_id);
      } finally {
        setOpeningSearchMessageId(null);
      }
    },
    [ensureSearchedMessageLoaded, openingSearchMessageId]
  );

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
    if (!updated)
      Alert.alert(pt.error_title, 'Não foi possível atualizar o grupo.');
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

      return (
        <View>
          {showDate ? (
            <View style={styles.dateSeparator}>
              <Text style={styles.dateSeparatorText}>
                {formatDateSeparator(item.date)}
              </Text>
            </View>
          ) : null}
          <InternalMessageBubble
            msg={item}
            fromMe={own}
            showAvatar={!own && isGroup}
            bubbleMaxWidth={responsiveBubbleMaxWidth}
            documentBubbleWidth={documentBubbleWidth}
            highlighted={highlightedMessageId === item.message_id}
            audioCtrl={audioCtrl}
            onOpenActions={setActionMessage}
            onOpenImage={openImageViewer}
            onOpenVideo={openVideoViewer}
            onPressContactCard={handlePressMessageContactCard}
            onPressContactsGroup={handlePressMessageContactsGroup}
          />
        </View>
      );
    },
    [
      audioCtrl,
      currentUserId,
      documentBubbleWidth,
      isGroup,
      messages,
      handlePressMessageContactCard,
      handlePressMessageContactsGroup,
      highlightedMessageId,
      openImageViewer,
      openVideoViewer,
      responsiveBubbleMaxWidth,
    ]
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
        <Pressable
          style={styles.headerContact}
          onPress={() => setInfoVisible(true)}
        >
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

      {initialMessagesLoading ? (
        <InternalChatRoomSkeleton />
      ) : (
        <View style={styles.messagesListWrap}>
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.message_id}
            renderItem={renderMessage}
            style={styles.messagesList}
            contentContainerStyle={styles.messagesContent}
            onScroll={handleMessagesScroll}
            scrollEventThrottle={16}
            onContentSizeChange={handleMessagesContentSizeChange}
            onScrollToIndexFailed={handleScrollToIndexFailed}
          />
          {loadingOlderMessages ? (
            <View pointerEvents="none" style={styles.loadingOlderTopWrap}>
              <View style={styles.loadingOlderTopChip}>
                <ActivityIndicator size="small" color={colors.onPrimary} />
                <Text style={styles.loadingOlderTopText}>
                  Carregando mensagens
                </Text>
              </View>
            </View>
          ) : null}
        </View>
      )}

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
                    isRecordingPaused ? pt.resume_recording : pt.pause_recording
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
                style={[styles.composerInput, { height: composerInputHeight }]}
                value={composerText}
                onChangeText={setComposerText}
                onContentSizeChange={handleComposerContentSizeChange}
                placeholder={pt.type_message}
                placeholderTextColor={colors.grey500}
                multiline
                textAlignVertical="top"
                scrollEnabled={composerInputHeight >= COMPOSER_INPUT_MAX_HEIGHT}
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
                    <Ionicons name="camera-outline" size={21} color="#FFFFFF" />
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
        <Pressable
          style={styles.centerOverlay}
          onPress={() => setActionMessage(null)}
        >
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
              ['download-outline', pt.download, 'download'],
              ['create-outline', 'Editar', 'edit'],
              ['time-outline', 'Histórico', 'history'],
              ['trash-outline', 'Apagar', 'delete'],
            ].map(([icon, label, action]) => {
              const target = actionMessage;
              const own = !!target && target.user?.id === currentUserId;
              if ((action === 'edit' || action === 'delete') && !own)
                return null;
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

      <Modal
        visible={contactsVisible}
        animationType="slide"
        onRequestClose={() => setContactsVisible(false)}
      >
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
              <Pressable
                style={styles.memberRow}
                onPress={() => void sendContact(item)}
              >
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

      <BottomSheetModal
        visible={messageContactsSheetVisible}
        onClose={() => {
          setMessageContactsSheetVisible(false);
          setMessageContactsSheetItems([]);
        }}
        title={pt.received_contacts}
        cardStyle={styles.contactsSheetCard}
        avoidKeyboard={false}
      >
        <FlatList
          data={messageContactsSheetItems}
          keyExtractor={(item, index) =>
            `${item.contact_id ?? 'received'}-${
              item.phone ?? item.phone_partial ?? index
            }`
          }
          renderItem={({ item }) => {
            const fullName =
              [item.name, item.last_name].filter(Boolean).join(' ').trim() ||
              pt.contact;
            const phone = item.phone ?? item.phone_partial ?? '';

            return (
              <Pressable
                style={styles.memberRow}
                onPress={() => handleSelectMessageGroupContact(item)}
              >
                <AppAvatar
                  uri={resolveMediaUri(item.photo)}
                  size={42}
                  iconName="person"
                />
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName} numberOfLines={1}>
                    {fullName}
                  </Text>
                  <Text style={styles.memberSub} numberOfLines={1}>
                    {phone || item.email_partial || pt.contact}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.grey600}
                />
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <Text style={styles.emptyContactsText}>{pt.no_contacts_found}</Text>
          }
        />
      </BottomSheetModal>

      <ContactFormModal
        visible={contactFormVisible}
        mode={contactFormMode}
        contactId={contactFormContactId}
        initialValues={contactFormInitialValues}
        onClose={handleCloseContactForm}
        onSuccess={handleContactFormSuccess}
      />

      <Modal
        visible={infoVisible}
        animationType="slide"
        onRequestClose={() => setInfoVisible(false)}
      >
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
                <Pressable
                  style={styles.groupSaveBtn}
                  onPress={updateGroupName}
                >
                  <Ionicons
                    name="checkmark"
                    size={22}
                    color={colors.onPrimary}
                  />
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
                  const openingDirect =
                    openingMemberDirectId === member.user_id;
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
                            <ActivityIndicator
                              size="small"
                              color={colors.error}
                            />
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

      <BottomSheetModal
        visible={searchVisible}
        onClose={() => setSearchVisible(false)}
        title={pt.search_messages}
        cardStyle={styles.searchSheetCard}
        noScroll
      >
        <View style={styles.searchInputWrap}>
          <Ionicons name="search-outline" size={18} color={colors.grey600} />
          <TextInput
            style={styles.searchInput}
            value={searchTerm}
            onChangeText={setSearchTerm}
            placeholder={pt.search_messages_placeholder}
            placeholderTextColor={colors.grey500}
            returnKeyType="search"
            maxLength={120}
            onSubmitEditing={() => setDebouncedSearchTerm(searchTerm.trim())}
          />
        </View>

        {debouncedSearchTerm.length > 0 && debouncedSearchTerm.length < 3 ? (
          <Text style={styles.modalHintText}>
            {pt.search_minimum_characters.replace('{count}', '3')}
          </Text>
        ) : null}

        {searchError ? (
          <Text style={styles.searchErrorText}>{searchError}</Text>
        ) : null}

        {openingSearchMessageId ? (
          <View style={styles.searchOpeningStatus}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.searchOpeningStatusText}>
              Abrindo mensagem...
            </Text>
          </View>
        ) : null}

        {searchLoading ? (
          <InternalSearchResultsSkeleton />
        ) : (
          <FlatList
            data={searchResults}
            keyExtractor={(item) => item.message_id}
            contentContainerStyle={styles.searchResultsList}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onEndReached={loadMoreSearchResults}
            onEndReachedThreshold={0.25}
            renderItem={({ item }) => (
              <Pressable
                style={styles.searchResultRow}
                onPress={dismissKeyboardAnd(() => void openSearchResult(item))}
                disabled={!!openingSearchMessageId}
              >
                <View style={styles.searchResultContent}>
                  <Text style={styles.searchResultDate}>
                    {formatDateSeparator(item.date)}{' '}
                    {formatMessageTime(item.date)}
                  </Text>
                  <Text style={styles.searchResultText} numberOfLines={3}>
                    {resolveInternalChatTextTag(item.message) ||
                      item.message ||
                      'Mensagem'}
                  </Text>
                </View>
                {openingSearchMessageId === item.message_id ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.grey600}
                  />
                )}
              </Pressable>
            )}
            ListEmptyComponent={
              debouncedSearchTerm.trim().length >= 3 ? (
                <Text style={styles.emptyText}>{pt.no_results_found}</Text>
              ) : null
            }
            ListFooterComponent={
              searchLoadingMore ? (
                <InternalSearchResultsSkeleton rows={2} />
              ) : null
            }
          />
        )}
      </BottomSheetModal>

      <Modal
        visible={historyVisible}
        animationType="slide"
        onRequestClose={() => setHistoryVisible(false)}
      >
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
                  {formatDateSeparator(item.date)}{' '}
                  {formatMessageTime(item.date)}
                </Text>
              </View>
            )}
          />
        </View>
      </Modal>

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
                  onPress={() => void handleDownloadViewerMedia()}
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
                          key={`internal-viewer-image-${index}-${item.src}`}
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
  messagesListWrap: {
    flex: 1,
    position: 'relative',
  },
  messagesList: {
    flex: 1,
  },
  messagesContent: {
    paddingHorizontal: 10,
    paddingVertical: 12,
    flexGrow: 1,
  },
  skeletonRoomContainer: {
    flex: 1,
    padding: 12,
    paddingBottom: 8,
  },
  skeletonRoomContainerCompact: {
    flex: 0,
    paddingVertical: 8,
  },
  skeletonDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginVertical: 8,
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
    marginVertical: 3,
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
  loadingOlderTopWrap: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
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
  messageBubbleWrap: {
    marginVertical: 5,
  },
  messageBubbleWrapLeft: {
    alignItems: 'flex-start',
  },
  messageBubbleWrapRight: {
    alignItems: 'flex-end',
  },
  messageBubbleWrapCenter: {
    alignItems: 'center',
  },
  messageBubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  messageBubbleRowRight: {
    justifyContent: 'flex-end',
  },
  messageBubbleRowCenter: {
    justifyContent: 'center',
  },
  bubble: {
    maxWidth: '100%',
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
    paddingRight: 28,
    borderRadius: 8,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    overflow: 'hidden',
  },
  bubbleSystem: {
    alignSelf: 'center',
    maxWidth: '100%',
  },
  bubbleContact: {
    minWidth: 0,
  },
  bubbleAudio: {
    minWidth: 0,
    width: '70%',
    maxWidth: '70%',
    paddingRight: 12,
    overflow: 'hidden',
  },
  bubbleDocument: {
    minWidth: 0,
    paddingRight: 12,
    paddingBottom: 10,
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
  bubbleDeleted: {
    opacity: 0.72,
  },
  senderName: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 5,
  },
  systemSenderName: {
    color: colors.grey600,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 21,
    minWidth: 0,
    maxWidth: '100%',
    flexShrink: 1,
  },
  bubbleTextWrap: {
    minWidth: 0,
    maxWidth: '100%',
    flexShrink: 1,
  },
  bubbleTextLeft: {
    color: colors.onSurface,
  },
  bubbleTextRight: {
    color: 'rgba(17, 27, 33, 0.95)',
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
    flexShrink: 1,
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
    fontSize: 12,
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
  contentStack: {
    gap: 8,
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
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
  linkPreviewCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(47, 43, 61, 0.12)',
    padding: 10,
    gap: 8,
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
    overflow: 'hidden',
  },
  linkPreviewCardLeft: {
    backgroundColor: 'rgba(47, 43, 61, 0.04)',
  },
  linkPreviewCardRight: {
    backgroundColor: 'rgba(255, 255, 255, 0.36)',
    alignSelf: 'stretch',
    minWidth: 0,
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
    maxWidth: '100%',
    fontSize: 12,
    lineHeight: 17,
    color: colors.primary,
    flexShrink: 1,
    includeFontPadding: false,
  },
  messageDeletedText: {
    color: colors.grey600,
    fontStyle: 'italic',
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
    justifyContent: 'space-between',
    gap: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(47, 43, 61, 0.04)',
    marginBottom: 6,
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
  },
  documentCardRight: {
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
  },
  documentMainAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    flexGrow: 1,
    flexShrink: 1,
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
    flexShrink: 0,
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
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  documentName: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.primary,
    maxWidth: '100%',
  },
  documentMeta: {
    fontSize: 11,
    lineHeight: 14,
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
    flexShrink: 0,
  },
  documentDownloadBtnRight: {
    backgroundColor: 'rgba(40, 101, 183, 0.2)',
  },
  documentCaption: {
    marginTop: 4,
  },
  contactWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    width: 220,
    minWidth: 0,
    maxWidth: '100%',
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
    color: colors.grey700,
    lineHeight: 20,
  },
  bubbleMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 4,
  },
  bubbleMetaAudio: {
    marginTop: 6,
  },
  bubbleMetaDocument: {
    marginTop: 6,
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
  bubbleEditedBadgeLeft: {
    color: colors.grey600,
    fontSize: 11,
    fontWeight: '600',
  },
  errorMetaText: {
    color: colors.error,
    fontSize: 11,
    fontWeight: '800',
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
  contactsSheetCard: {
    maxHeight: '70%',
  },
  emptyContactsText: {
    color: colors.grey600,
    textAlign: 'center',
    paddingHorizontal: 18,
    paddingVertical: 22,
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
    width: '100%',
    minHeight: COMPOSER_INPUT_MIN_HEIGHT,
    maxHeight: COMPOSER_INPUT_MAX_HEIGHT,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingRight: 46,
    paddingVertical: COMPOSER_INPUT_VERTICAL_PADDING,
    backgroundColor: colors.inputBg,
    color: colors.onSurface,
    fontSize: 15,
    lineHeight: COMPOSER_INPUT_LINE_HEIGHT,
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
  searchSheetCard: {
    maxHeight: '88%',
  },
  searchInputWrap: {
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
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
  modalHintText: {
    fontSize: 12,
    color: colors.grey700,
    marginBottom: 10,
  },
  searchErrorText: {
    fontSize: 12,
    color: colors.error,
    marginBottom: 10,
  },
  searchOpeningStatus: {
    minHeight: 36,
    borderRadius: 10,
    marginBottom: 10,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(40, 101, 183, 0.08)',
  },
  searchOpeningStatusText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  searchResultsList: {
    paddingBottom: 16,
  },
  searchResultRow: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(40, 101, 183, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(40, 101, 183, 0.1)',
  },
  searchResultContent: {
    flex: 1,
    minWidth: 0,
  },
  searchResultText: {
    marginTop: 4,
    color: colors.onSurface,
    fontSize: 13,
    lineHeight: 18,
  },
  searchResultDate: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '600',
  },
  searchSkeletonList: {
    paddingBottom: 4,
  },
  searchSkeletonRow: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 8,
    backgroundColor: 'rgba(40, 101, 183, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(40, 101, 183, 0.1)',
  },
  searchSkeletonDate: {
    width: 88,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.grey300,
  },
  searchSkeletonText: {
    width: '86%',
    height: 12,
    borderRadius: 6,
    marginTop: 8,
    backgroundColor: colors.grey300,
  },
  searchSkeletonTextShort: {
    width: '56%',
    height: 12,
    borderRadius: 6,
    marginTop: 6,
    backgroundColor: colors.grey300,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 13,
    color: colors.grey600,
    paddingVertical: 18,
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
