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
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatStackParamList } from '../navigation/types';
import {
  type ListChatsResult,
  type ListMessageResult,
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
import Constants from 'expo-constants';
import {
  listMessages,
  createMessage,
  createMessageWithFormData,
  clearChatSummary,
  getChatContactById,
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
import { getUser, getPermissions } from '../storage/authStorage';
import { canPreviewChatContent } from '../constants/chatAuthorization';
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
const LOAD_OLDER_SCROLL_THRESHOLD = 180;
const SHOW_SCROLL_TO_BOTTOM_THRESHOLD = 160;
const TYPING_TIMEOUT_MS = 5000;
type RemoteActivityMode = 'typing' | 'recording';
const VOICE_LOCK_SWIPE_THRESHOLD = 70;
const VOICE_RELEASE_LOCK_GRACE_MS = 220;
const VOICE_CANCEL_SWIPE_THRESHOLD = 90;
const RECORDING_WAVEFORM_MAX_BARS = 44;
const RECORDING_WAVEFORM_MIN_BARS = 26;
type DownloadKind = 'image' | 'video' | 'document';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let preferredNativeDownloadDirectoryUri: string | null = null;

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
          {contactDisplay.photoUri ? (
            <Image
              source={{ uri: contactDisplay.photoUri }}
              style={styles.contactAvatar}
              resizeMode="cover"
            />
          ) : (
            <Ionicons name="person" size={18} color={colors.primary} />
          )}
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
    reactionsSummary.length > 0 && !isAnnotation && !isSystem && !obfuscateContent;
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
  const { chat } = route.params;
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
  const inputRef = useRef('');
  const sendingRef = useRef(false);
  const isQueueOrUraStatusRef = useRef(false);
  const sendingCapturedMediaRef = useRef(false);
  const sendingVoiceRecordingRef = useRef(false);
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
  const lastSocketSyncTimeRef = useRef(0);
  const clearSummaryAttemptedForChatRef = useRef<string | null>(null);
  const preserveScrollOnPrependRef = useRef<{
    previousOffset: number;
    previousContentHeight: number;
  } | null>(null);
  const messagesRef = useRef<ListMessageResult[]>([]);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [chatInfo, setChatInfo] = useState(chat);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [canPreviewProtectedContent, setCanPreviewProtectedContent] =
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
    getUser().then((user) => {
      const userName = resolveStoredUserName(user);
      setCurrentUserId(resolveUserId(user));
      setCurrentUserName(userName);
    });

    getPermissions().then((permissions) => {
      setCanPreviewProtectedContent(canPreviewChatContent(permissions));
    });
  }, []);

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

  useEffect(() => {
    navigation.setOptions({
      title:
        chatInfo.name ?? chatInfo.contact?.name ?? chatInfo.phone ?? 'Chat',
    });
  }, [navigation, chatInfo.name, chatInfo.contact?.name, chatInfo.phone]);

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

  const isQueueOrUraStatus =
    chatInfo.status === 'queue' ||
    chatInfo.status === 'ura' ||
    chatInfo.status === 'ura_output' ||
    chatInfo.status === 'ura_schedule' ||
    chatInfo.status === 'ura_webhook';
  const shouldObfuscateContent =
    isQueueOrUraStatus && !canPreviewProtectedContent;

  useEffect(() => {
    inputRef.current = input;
    sendingRef.current = sending;
    isQueueOrUraStatusRef.current = isQueueOrUraStatus;
    sendingCapturedMediaRef.current = sendingCapturedMedia;
    sendingVoiceRecordingRef.current = sendingVoiceRecording;
    isRecordingVoiceRef.current = isRecordingVoice;
    isRecordingLockedRef.current = isRecordingLocked;
    isPreparingRecordingRef.current = isPreparingRecording;
  }, [
    input,
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
    if (isQueueOrUraStatus || isPreparingRecording || sendingVoiceRecording) {
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
    isPreparingRecording,
    isQueueOrUraStatus,
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

  const sendCapturedMediaDraft = useCallback(
    async (draft: CameraCaptureDraft) => {
      if (sendingCapturedMedia) return;

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
        setSendingCapturedMedia(false);
      }
    },
    [
      chatInfo.chat_id,
      scrollToBottomWithRetries,
      sendingCapturedMedia,
      syncLatestMessages,
    ]
  );

  const launchCameraCapture = useCallback(
    async (mediaType: 'images' | 'videos') => {
      if (isQueueOrUraStatus || sendingCapturedMedia || sendingVoiceRecording) {
        return;
      }

      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return;

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: [mediaType],
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
            ? Math.round(asset.duration / 1000)
            : null,
      });
    },
    [
      isQueueOrUraStatus,
      sendCapturedMediaDraft,
      sendingCapturedMedia,
      sendingVoiceRecording,
    ]
  );

  const handleOpenCameraPicker = useCallback(() => {
    if (
      isQueueOrUraStatus ||
      sendingCapturedMedia ||
      sendingVoiceRecording ||
      isRecordingVoice
    ) {
      return;
    }
    setCameraPickerVisible(true);
  }, [
    isQueueOrUraStatus,
    sendingCapturedMedia,
    sendingVoiceRecording,
    isRecordingVoice,
  ]);

  const handlePickPhotoCapture = useCallback(() => {
    setCameraPickerVisible(false);
    void launchCameraCapture('images');
  }, [launchCameraCapture]);

  const handlePickVideoCapture = useCallback(() => {
    setCameraPickerVisible(false);
    void launchCameraCapture('videos');
  }, [launchCameraCapture]);

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
      if (!text || sending) return false;

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
    [chatInfo.chat_id, sending, scrollToBottomWithRetries]
  );

  const handleTemplateButtonPress = useCallback(
    (button: MessageTemplateButton, _message: ListMessageResult) => {
      if (isQueueOrUraStatus) return;
      const buttonText = readNonEmptyString(button.displayText);
      if (!buttonText) return;
      void sendTextPayload(buttonText);
    },
    [isQueueOrUraStatus, sendTextPayload]
  );

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending || isRecordingVoice || sendingCapturedMedia) return;

    setInput('');
    await sendTextPayload(text);
  };

  const hasInputText = input.trim().length > 0;
  const canUseComposerActions =
    !sending &&
    !isQueueOrUraStatus &&
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

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
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
                  highlighted={highlightedMessageId === item.message.message_id}
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
                  disableTemplateButtons={isQueueOrUraStatus || sending}
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
      {shouldObfuscateContent ? (
        <View style={styles.protectedBanner}>
          <Ionicons name="lock-closed-outline" size={14} color={colors.grey700} />
          <Text style={styles.protectedBannerText}>
            {pt.protected_content}
          </Text>
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
            <View style={styles.inputStack}>
              <TextInput
                style={styles.input}
                placeholder={pt.type_message}
                placeholderTextColor={colors.grey500}
                value={input}
                onChangeText={setInput}
                multiline
                maxLength={65535}
                editable={
                  !sending &&
                  !sendingCapturedMedia &&
                  !isPreparingRecording &&
                  !isRecordingVoice
                }
              />
              {showRecordingHoldOverlay ? (
                <View pointerEvents="none" style={styles.recordingHoldOverlay}>
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
                    onPress={handleOpenCameraPicker}
                    disabled={!canUseComposerActions}
                    accessibilityLabel={pt.open_camera}
                  >
                    <Ionicons name="camera-outline" size={21} color="#FFFFFF" />
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
            <Pressable
              style={styles.cameraPickerAction}
              onPress={handlePickPhotoCapture}
            >
              <Ionicons
                name="camera-outline"
                size={18}
                color={colors.primary}
              />
              <Text style={styles.cameraPickerActionText}>{pt.take_photo}</Text>
            </Pressable>
            <Pressable
              style={styles.cameraPickerAction}
              onPress={handlePickVideoCapture}
            >
              <Ionicons
                name="videocam-outline"
                size={18}
                color={colors.primary}
              />
              <Text style={styles.cameraPickerActionText}>
                {pt.record_video}
              </Text>
            </Pressable>
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
    alignItems: 'flex-end',
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
    paddingVertical: 10,
    fontSize: 15,
    color: colors.onSurface,
  },
  inputStack: {
    flex: 1,
    position: 'relative',
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
  cameraPickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  cameraPickerSheet: {
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    padding: 8,
    gap: 6,
  },
  cameraPickerAction: {
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(40, 101, 183, 0.08)',
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
