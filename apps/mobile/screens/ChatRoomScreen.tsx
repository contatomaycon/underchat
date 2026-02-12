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
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Directory, File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import {
  listMessages,
  createMessage,
  getChatContactById,
  getChatContactByPhone,
  type ChatContactLookupResult,
} from '../api/chatApi';
import {
  addChatSocketListener,
  consumePendingChatUpdates,
  consumePendingMessages,
  type SocketChatPayload,
  type SocketMessagePayload,
} from '../socket/chatSocket';
import { getUser } from '../storage/authStorage';
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

const WAVEFORM_BAR_WIDTH = 2;
const WAVEFORM_BAR_GAP = 2;
const WAVEFORM_HORIZONTAL_INSET = 2;
const WAVEFORM_FALLBACK_MAX_BARS = 28;
const VIDEO_FULLSCREEN_DISABLED = { enable: false } as const;
const VIDEO_FULLSCREEN_ENABLED = { enable: true } as const;
const CHAT_MESSAGES_PER_PAGE = 50;
const LOAD_OLDER_SCROLL_THRESHOLD = 180;
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

function resolvePreviewThumbnail(value: string | null | undefined): string | null {
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
    } catch {
      //
    }
  }

  if (Platform.OS === 'ios') {
    const appleMapsUrl = `http://maps.apple.com/?ll=${latitude},${longitude}&q=${encodeURIComponent(
      name
    )}`;
    try {
      await Linking.openURL(appleMapsUrl);
      return;
    } catch {
      //
    }
  }

  try {
    await Linking.openURL(webUrl);
  } catch {
    //
  }
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
      } catch {
        //
      }
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
    } catch {
      //
    }
  };

  if (kind === 'image' || kind === 'video') {
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
    } catch {
      //
    }
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
  } catch {
    //
  }

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
        } catch {
          //
        }
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
    } catch {
      //
    }
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
    } catch {
      //
    }
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
    } catch {
      //
    }
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

function QuotedReplyPreview({
  msg,
  fromMe,
  chatInfo,
  currentUserName,
  onPressQuoted,
}: {
  msg: ListMessageResult;
  fromMe: boolean;
  chatInfo: ListChatsResult;
  currentUserName: string | null;
  onPressQuoted?: (() => void) | null;
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
}) {
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
              const disabled =
                disableTemplateButtons || !onTemplateButtonPress;

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
    reactionsSummary.length > 0 && !isAnnotation && !isSystem;
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
  const pendingScrollToBottomRef = useRef(true);
  const scrollOffsetRef = useRef(0);
  const contentHeightRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const currentPageRef = useRef(1);
  const totalPagesRef = useRef(1);
  const preserveScrollOnPrependRef = useRef<{
    previousOffset: number;
    previousContentHeight: number;
  } | null>(null);
  const [chatInfo, setChatInfo] = useState(chat);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
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
  const [resolvedContactCards, setResolvedContactCards] = useState<
    Record<string, ContactCardDisplayData>
  >({});
  const resolvingContactCards = useRef<Set<string>>(new Set());
  const resolvedContactLookupDone = useRef<Set<string>>(new Set());
  const [downloadingViewerMedia, setDownloadingViewerMedia] = useState(false);
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
    preserveScrollOnPrependRef.current = null;
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
      const userId =
        user && typeof user === 'object'
          ? (user as { user_id?: unknown }).user_id
          : null;
      const userName = resolveStoredUserName(user);
      setCurrentUserId(
        typeof userId === 'string' && userId.trim().length > 0 ? userId : null
      );
      setCurrentUserName(userName);
    });
  }, []);

  useEffect(() => {
    if (viewer.visible && viewer.kind === 'video') {
      return;
    }

    try {
      viewerVideoPlayer.pause();
      viewerVideoPlayer.currentTime = 0;
    } catch {
      //
    }
  }, [viewer.kind, viewer.visible, viewerVideoPlayer]);

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
    const stickerUrl = msg.content?.sticker?.url;
    if (stickerUrl) {
      const stickerSrc = resolveMediaUri(stickerUrl);
      if (!stickerSrc) return;
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
      //
    } finally {
      setDownloadingViewerMedia(false);
    }
  }, [downloadingViewerMedia, viewer.downloadName, viewer.kind, viewer.src]);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listMessages(chatInfo.chat_id, 1, CHAT_MESSAGES_PER_PAGE);
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
      scrollOffsetRef.current = offsetY;

      if (offsetY <= LOAD_OLDER_SCROLL_THRESHOLD) {
        void loadOlderMessages();
      }
    },
    [loadOlderMessages]
  );

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
        pendingScrollToBottomRef.current = false;

        requestAnimationFrame(() => {
          listRef.current?.scrollToEnd({ animated: false });
          requestAnimationFrame(() => {
            listRef.current?.scrollToEnd({ animated: false });
          });
        });
      }
    },
    [loading]
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

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  const handleSocketMessage = useCallback(
    (payload: SocketMessagePayload) => {
      if (payload.chat_id !== chatInfo.chat_id) return;
      const normalized = normalizeSocketMessageToListMessage(payload);
      if (!normalized) return;
      setMessages((prev) => mergeMessageLists(prev, normalized));
    },
    [chatInfo.chat_id]
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

        return next;
      });

      const payloadAny = payload as Record<string, unknown>;
      const isActive =
        typeof payloadAny._active === 'boolean' ? payloadAny._active : false;
      const payloadUser =
        payloadAny.user && typeof payloadAny.user === 'object'
          ? (payloadAny.user as { id?: unknown })
          : null;
      const payloadUserId = readNonEmptyString(payloadUser?.id);

      if (isActive && payloadUserId && currentUserId === payloadUserId) {
        loadMessages();
      }
    },
    [chatInfo.chat_id, currentUserId, loadMessages]
  );

  useFocusEffect(
    useCallback(() => {
      const pendingMessages = consumePendingMessages(chatInfo.chat_id);
      if (pendingMessages.length > 0) {
        setMessages((prev) =>
          mergePendingSocketMessages(prev, pendingMessages)
        );
      }

      const pendingChatUpdates = consumePendingChatUpdates(chatInfo.chat_id);
      if (pendingChatUpdates.length > 0) {
        const lastUpdate = pendingChatUpdates[pendingChatUpdates.length - 1];
        handleSocketChatUpdate(lastUpdate);
      }

      const offMessage = addChatSocketListener('message', handleSocketMessage);
      const offChatUpdate = addChatSocketListener(
        'chatUpdate',
        handleSocketChatUpdate
      );

      return () => {
        offMessage();
        offChatUpdate();
      };
    }, [chatInfo.chat_id, handleSocketMessage, handleSocketChatUpdate])
  );

  const isQueueOrUraStatus =
    chatInfo.status === 'queue' ||
    chatInfo.status === 'ura' ||
    chatInfo.status === 'ura_output' ||
    chatInfo.status === 'ura_schedule' ||
    chatInfo.status === 'ura_webhook';

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
          setMessages((prev) => mergeMessageLists(prev, newMsg));
          return true;
        }
      } finally {
        setSending(false);
      }
      return false;
    },
    [chatInfo.chat_id, sending]
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
    if (!text || sending) return;

    setInput('');
    await sendTextPayload(text);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {loading ? (
        <ChatRoomSkeleton />
      ) : (
        <FlatList
          ref={listRef}
          data={messagesWithSeparators}
          keyExtractor={(item) =>
            item.type === 'separator'
              ? `separator-${item.separatorDate}`
              : `message-${item.message.message_id}`
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
              />
            );
          }}
          onScrollToIndexFailed={handleScrollToIndexFailed}
          onScroll={handleListScroll}
          scrollEventThrottle={16}
          onContentSizeChange={handleListContentSizeChange}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            loadingOlder ? (
              <View style={styles.loadingOlderWrap}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : null
          }
          inverted={false}
        />
      )}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder={pt.type_message}
          placeholderTextColor={colors.grey500}
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={65535}
          editable={!sending}
        />
        <Pressable
          style={[
            styles.sendBtn,
            (!input.trim() || sending) && styles.sendBtnDisabled,
          ]}
          onPress={handleSend}
          disabled={!input.trim() || sending}
        >
          <Ionicons name="send" size={22} color="#fff" />
        </Pressable>
      </View>
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
});
