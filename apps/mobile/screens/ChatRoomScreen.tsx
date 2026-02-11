import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatStackParamList } from '../navigation/types';
import {
  type ListMessageResult,
  type MessageContent,
  ETypeUserChat,
} from '../types/chat';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { listMessages, createMessage } from '../api/chatApi';
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

const WAVEFORM_BAR_WIDTH = 2;
const WAVEFORM_BAR_GAP = 2;
const WAVEFORM_HORIZONTAL_INSET = 2;
const WAVEFORM_FALLBACK_MAX_BARS = 28;

function fitWaveformToWidth(
  waveform: number[],
  width: number
): number[] {
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
          style={[styles.skeletonBubbleLine, styles.skeletonBubbleLineWide, { opacity }]}
        />
        <Animated.View
          style={[styles.skeletonBubbleLine, styles.skeletonBubbleLineShort, { opacity }]}
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

function resolveImageDownloadName(msg: ListMessageResult, sourceUrl: string): string {
  const image = msg.content?.image;
  const extFromPayload = image?.extension?.replace(/^\./, '').toLowerCase();
  const extension = extFromPayload || getExtensionFromUrl(sourceUrl) || 'jpg';
  const captionName = image?.caption ? sanitizeFilename(image.caption) : '';
  const fallbackName = `imagem-${msg.message_id.slice(-8)}`;
  const baseName = captionName || fallbackName;
  return `${baseName}.${extension}`;
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
    type_user: normalizeTypeUser((payload as { type_user?: unknown }).type_user),
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
    next[existingIndex] = { ...next[existingIndex], ...incoming };
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

type Props = NativeStackScreenProps<ChatStackParamList, 'ChatRoom'>;

type MessageWithSeparator =
  | { type: 'message'; message: ListMessageResult }
  | {
      type: 'separator';
      separatorDate: string;
      separatorLabel: string;
    };

type ImageViewerState = {
  visible: boolean;
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
  const getWaveformWidth = useCallback((messageId: string): number => {
    return waveformWidths[messageId] ?? 0;
  }, [waveformWidths]);

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

function BubbleContent({
  msg,
  fromMe,
  content,
  audioCtrl,
  onOpenImage,
}: {
  msg: ListMessageResult;
  fromMe: boolean;
  content: MessageContent;
  audioCtrl: AudioCtrl | null;
  onOpenImage: (msg: ListMessageResult) => void;
}) {
  const type = content.type;
  const textColor = fromMe ? styles.bubbleTextRight : styles.bubbleTextLeft;
  const isViewOnce = msg.message_key?.is_view_once === true;

  if (isViewOnce) {
    return (
      <View style={styles.viewOnceWrap}>
        <Ionicons name="eye-off-outline" size={20} color={colors.grey600} />
        <Text style={styles.viewOnceText}>{pt.view_once_message}</Text>
      </View>
    );
  }

  if (type === EMessageType.image && content.image?.url) {
    const cap = content.image.caption;
    const imageUri = resolveImageUri(content.image.url);
    if (!imageUri) return null;
    return (
      <View style={styles.mediaBubble}>
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
    const videoUrl = resolveImageUri(content.video.url) ?? content.video.url;
    const thumbUri = resolveImageUri(content.video.thumbnail);
    return (
      <View style={styles.mediaBubble}>
        <Pressable
          style={styles.videoThumbWrap}
          onPress={() => videoUrl && Linking.openURL(videoUrl)}
        >
          {thumbUri ? (
            <Image
              source={{ uri: thumbUri }}
              style={styles.videoThumb}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.videoPlaceholder}>
              <Ionicons name="videocam" size={40} color={colors.grey500} />
            </View>
          )}
          <View style={styles.videoOverlay}>
            <Ionicons name="play-circle" size={48} color="#fff" />
          </View>
        </Pressable>
        {content.video.duration != null ? (
          <Text style={styles.mediaMeta}>
            {Math.floor((content.video.duration ?? 0) / 60)}:
            {String(Math.floor((content.video.duration ?? 0) % 60)).padStart(
              2,
              '0'
            )}
          </Text>
        ) : null}
        {cap ? (
          <Text style={[styles.mediaCaption, textColor]}>{cap}</Text>
        ) : null}
      </View>
    );
  }

  if (type === EMessageType.sticker && content.sticker?.url) {
    const stickerUri = resolveImageUri(content.sticker.url);
    if (!stickerUri) return null;
    return (
      <Image
        source={{ uri: stickerUri }}
        style={styles.stickerThumb}
        resizeMode="contain"
      />
    );
  }

  if (
    type === EMessageType.location &&
    content.location?.latitude != null &&
    content.location?.longitude != null
  ) {
    const lat = content.location.latitude!;
    const lng = content.location.longitude!;
    const url = `https://www.google.com/maps?q=${lat},${lng}`;
    const name = content.location.name ?? pt.location;
    const address = content.location.address;
    return (
      <Pressable onPress={() => Linking.openURL(url)}>
        <View style={styles.locationWrap}>
          <Ionicons name="location" size={24} color={colors.primary} />
          <View style={styles.locationText}>
            <Text style={[styles.locationName, textColor]}>{name}</Text>
            {address ? (
              <Text style={styles.locationAddress}>{address}</Text>
            ) : null}
          </View>
        </View>
      </Pressable>
    );
  }

  if (type === EMessageType.audio && content.audio?.url) {
    const messageId = msg.message_id;
    const url = content.audio.url;
    const cap = content.message;
    const fallbackDuration = content.audio.duration ?? 0;
    if (!audioCtrl) {
      const durStr =
        fallbackDuration > 0 ? formatAudioTime(fallbackDuration) : pt.audio;
      return (
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
    const progressPercent = durationSec > 0
      ? Math.max(0, Math.min(100, (currentTime / durationSec) * 100))
      : 0;
    const currentTimeStr = formatAudioTime(currentTime);
    const waveformWidth = audioCtrl.getWaveformWidth(messageId);
    const waveformToRender = fitWaveformToWidth(waveform, waveformWidth);

    return (
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
    const ext = (doc.extension ?? '').toUpperCase() || 'FILE';
    const sizeStr = formatFileSize(doc.size);
    const name = doc.name ?? pt.document;
    const cap = content.message;
    return (
      <View>
        <Pressable
          style={styles.documentWrap}
          onPress={() => Linking.openURL(doc.url!)}
        >
          <Ionicons name="document" size={32} color={colors.primary} />
          <View style={styles.documentInfo}>
            <Text style={[styles.documentName, textColor]} numberOfLines={2}>
              {name}
            </Text>
            <Text style={styles.documentMeta}>
              {ext}
              {sizeStr ? ` • ${sizeStr}` : ''}
            </Text>
          </View>
          <Ionicons name="download-outline" size={22} color={colors.grey600} />
        </Pressable>
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
    const name =
      [content.contact.name, content.contact.last_name]
        .filter(Boolean)
        .join(' ') || pt.contact;
    const phone = content.contact.phone ?? content.contact.phone_partial;
    return (
      <View style={styles.contactWrap}>
        <Ionicons name="person-circle" size={32} color={colors.primary} />
        <View style={styles.contactInfo}>
          <Text style={[styles.contactName, textColor]}>{name}</Text>
          {phone ? <Text style={styles.contactPhone}>{phone}</Text> : null}
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
    return (
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
    return (
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
    const title = t.hydratedTitleText;
    const body = t.hydratedContentText;
    return (
      <View style={styles.templateWrap}>
        {title ? (
          <Text style={[styles.templateTitle, textColor]}>{title}</Text>
        ) : null}
        {body ? (
          <Text style={[styles.bubbleText, textColor]}>{body}</Text>
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
    return (
      <Text style={[styles.bubbleText, textColor]} selectable>
        {text}
      </Text>
    );
  }

  return null;
}

function MessageBubble({
  msg,
  fromMe,
  audioCtrl,
  onOpenImage,
}: {
  msg: ListMessageResult;
  fromMe: boolean;
  audioCtrl: AudioCtrl | null;
  onOpenImage: (msg: ListMessageResult) => void;
}) {
  const content = msg.content;
  const timeStr = formatMessageTime(msg.date);
  const isSystem = content?.type === EMessageType.system;
  const isAnnotation = content?.type === EMessageType.annotation;
  const isAudio = content?.type === EMessageType.audio && !!content.audio?.url;
  const isContactCard =
    content?.type === EMessageType.contact_card ||
    content?.type === EMessageType.contacts;
  const hasContent =
    content &&
    (content.type === EMessageType.system ||
      content.type === EMessageType.view_once ||
      content.image?.url ||
      content.video?.url ||
      content.sticker?.url ||
      (content.location?.latitude != null &&
        content.location?.longitude != null) ||
      content.audio?.url ||
      content.document?.url ||
      content.contact ||
      (content.contacts && content.contacts.length > 0) ||
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
          ]}
        >
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
        ]}
      >
        <BubbleContent
          msg={msg}
          fromMe={fromMe}
          content={content}
          audioCtrl={audioCtrl}
          onOpenImage={onOpenImage}
        />
        <View style={[styles.bubbleMeta, isAudio && styles.bubbleMetaAudio]}>
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

export function ChatRoomScreen({ route, navigation }: Props) {
  const { chat } = route.params;
  const [chatInfo, setChatInfo] = useState(chat);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ListMessageResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [viewer, setViewer] = useState<ImageViewerState>({
    visible: false,
    src: '',
    caption: '',
    downloadName: '',
  });
  const [downloadingViewerImage, setDownloadingViewerImage] = useState(false);
  const audioCtrl = useChatAudio();

  useEffect(() => {
    setChatInfo(chat);
  }, [chat]);

  useEffect(() => {
    getUser().then((user) => {
      const userId =
        user && typeof user === 'object'
          ? (user as { user_id?: unknown }).user_id
          : null;
      setCurrentUserId(
        typeof userId === 'string' && userId.trim().length > 0 ? userId : null
      );
    });
  }, []);

  const closeImageViewer = useCallback(() => {
    setViewer({
      visible: false,
      src: '',
      caption: '',
      downloadName: '',
    });
    setDownloadingViewerImage(false);
  }, []);

  const openImageViewer = useCallback((msg: ListMessageResult) => {
    const imageUrl = msg.content?.image?.url;
    if (!imageUrl) return;
    const imageSrc = resolveImageUri(imageUrl) ?? imageUrl;
    if (!imageSrc) return;

    setViewer({
      visible: true,
      src: imageSrc,
      caption: msg.content?.image?.caption ?? '',
      downloadName: resolveImageDownloadName(msg, imageSrc),
    });
  }, []);

  const handleDownloadViewerImage = useCallback(async () => {
    if (!viewer.src || downloadingViewerImage) return;

    setDownloadingViewerImage(true);
    try {
      if (Platform.OS === 'web') {
        Linking.openURL(viewer.src);
        return;
      }

      const downloadDirectory = new Directory(Paths.document, 'downloads');
      if (!downloadDirectory.exists) {
        downloadDirectory.create({ intermediates: true, idempotent: true });
      }

      const fileName =
        sanitizeFilename(viewer.downloadName || '') || `imagem-${Date.now()}.jpg`;
      const destinationFile = new File(downloadDirectory, fileName);

      await File.downloadFileAsync(viewer.src, destinationFile, {
        idempotent: true,
      });
      Alert.alert(pt.download, pt.image_download_success);
    } catch {
      Alert.alert(pt.download, pt.image_download_error);
    } finally {
      setDownloadingViewerImage(false);
    }
  }, [downloadingViewerImage, viewer.downloadName, viewer.src]);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    const res = await listMessages(chatInfo.chat_id, 1, 50);
    setLoading(false);
    if (res?.results) {
      const baseMessages = res.results.reverse();
      const pending = consumePendingMessages(chatInfo.chat_id);
      setMessages(mergePendingSocketMessages(baseMessages, pending));
    }
  }, [chatInfo.chat_id]);

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

  useEffect(() => {
    navigation.setOptions({
      title: chatInfo.name ?? chatInfo.contact?.name ?? chatInfo.phone ?? 'Chat',
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
        setMessages((prev) => mergePendingSocketMessages(prev, pendingMessages));
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

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    setInput('');
    const newMsg = await createMessage(chatInfo.chat_id, 'text', text);
    setSending(false);
    if (newMsg) {
      setMessages((prev) => [...prev, newMsg]);
    }
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
          data={messagesWithSeparators}
          keyExtractor={(item) =>
            item.type === 'separator'
              ? `separator-${item.separatorDate}`
              : `message-${item.message.message_id}`
          }
          renderItem={({ item }) =>
            item.type === 'separator' ? (
              <DateSeparator label={item.separatorLabel} />
            ) : (
              <MessageBubble
                msg={item.message}
                fromMe={item.message.type_user !== ETypeUserChat.client}
                audioCtrl={audioCtrl}
                onOpenImage={openImageViewer}
              />
            )
          }
          contentContainerStyle={styles.listContent}
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
        onRequestClose={closeImageViewer}
        statusBarTranslucent
      >
        <Pressable style={styles.viewerOverlay} onPress={closeImageViewer}>
          <Pressable
            style={styles.viewerContent}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.viewerActions}>
              <Pressable
                style={[
                  styles.viewerActionBtn,
                  downloadingViewerImage && styles.viewerActionBtnDisabled,
                ]}
                onPress={handleDownloadViewerImage}
                disabled={downloadingViewerImage}
              >
                {downloadingViewerImage ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="download-outline" size={20} color="#FFFFFF" />
                )}
              </Pressable>
              <Pressable style={styles.viewerActionBtn} onPress={closeImageViewer}>
                <Ionicons name="close" size={20} color="#FFFFFF" />
              </Pressable>
            </View>

            <View style={styles.viewerMediaContainer}>
              <Image
                source={{ uri: viewer.src }}
                style={styles.viewerImage}
                resizeMode="contain"
              />
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
    minWidth: 160,
  },
  bubbleAudio: {
    minWidth: 220,
    width: '70%',
    maxWidth: '70%',
    paddingRight: 12,
    overflow: 'hidden',
  },
  bubbleMetaAudio: {
    marginTop: 6,
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
  mediaBubble: {
    maxWidth: 260,
    overflow: 'hidden',
    borderRadius: 8,
  },
  imageThumb: {
    width: '100%',
    maxWidth: 260,
    maxHeight: 360,
    aspectRatio: 1,
    borderRadius: 6,
  },
  videoThumbWrap: {
    width: '100%',
    maxWidth: 260,
    height: 160,
    position: 'relative',
    borderRadius: 6,
  },
  videoThumb: {
    width: '100%',
    height: '100%',
    maxWidth: 260,
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
  locationWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  locationText: {
    flex: 1,
  },
  locationName: {
    fontSize: 15,
    fontWeight: '500',
  },
  locationAddress: {
    fontSize: 12,
    color: colors.grey600,
    marginTop: 2,
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
  documentWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  documentInfo: {
    flex: 1,
    minWidth: 0,
  },
  documentName: {
    fontSize: 14,
    fontWeight: '500',
  },
  documentMeta: {
    fontSize: 11,
    color: colors.grey600,
    marginTop: 2,
  },
  documentCaption: {
    marginTop: 8,
  },
  contactWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: 15,
    fontWeight: '500',
  },
  contactPhone: {
    fontSize: 12,
    color: colors.grey600,
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
