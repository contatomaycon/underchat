<script lang="ts" setup>
import { ref, reactive, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useChatStore } from '@/@webcore/stores/chat';
import {
  LinkPreview,
  ListMessageResult,
  DocumentMessageChat,
  VideoMessageChat,
  AudioMessageChat,
} from '@core/schema/chat/listMessageChats/response.schema';
import { isTypeUser } from '@core/common/functions/isTypeUser';
import { EMessageType } from '@core/common/enums/EMessageType';
import { EColor } from '@core/common/enums/EColor';
import { IReaction } from '@core/common/interfaces/IChatMessage';
import { Picker, EmojiIndex } from 'emoji-mart-vue-fast/src';
import data from 'emoji-mart-vue-fast/data/all.json';
import 'emoji-mart-vue-fast/css/emoji-mart.css';
import { formatDate } from '@/@webcore/utils/formatters';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const chatStore = useChatStore();
const chatLogContainer = ref<HTMLElement | null>(null);

const reactionEmojiIndex = new EmojiIndex(data);

const viewerOpen = ref(false);
const viewerSrc = ref<string>('');
const viewerCaption = ref<string>('');
const viewerDownloadName = ref<string>('');
const viewerKind = ref<'image' | 'video'>('image');

const audioPlayers = ref<Map<string, HTMLAudioElement>>(new Map());
const audioPlayStates = reactive<Record<string, boolean>>({});
const audioCurrentTimes = reactive<Record<string, number>>({});
const audioDurations = reactive<Record<string, number>>({});
const audioWaveforms = reactive<Record<string, number[]>>({});

const resolveFeedbackIcon = (
  message: ListMessageResult
): { icon: string; color: string | undefined } => {
  if (isMessageUploadError(message))
    return { icon: 'tabler-alert-triangle', color: 'error' };
  if (message.summary?.is_sent_to_internal === false)
    return { icon: 'tabler-clock', color: undefined };
  if (message.summary?.is_seen)
    return { icon: 'tabler-checks', color: 'success' };
  if (message.summary?.is_delivered)
    return { icon: 'tabler-checks', color: undefined };
  return { icon: 'tabler-check', color: undefined };
};

const resolvePhoto = (message: ListMessageResult): string => {
  if (isTypeUser(message) && chatStore.activeChat?.photo)
    return chatStore.activeChat.photo;
  if (!isTypeUser(message) && message.user?.photo) return message.user.photo;
  if (!isTypeUser(message) && chatStore.user?.info.photo)
    return chatStore.user.info.photo;
  return '';
};

const isPhotoExist = (message: ListMessageResult): boolean =>
  !!resolvePhoto(message);

const avatarText = (name?: string) => {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
};

const avatarChat = (message: ListMessageResult) => {
  if (isTypeUser(message) && chatStore.activeChat?.name)
    return avatarText(chatStore.activeChat.name);
  const name = message.user?.name ?? chatStore.user?.info.name;
  return avatarText(name);
};

const resolvePreviewImage = (lp?: LinkPreview): string => {
  if (!lp) return '';
  if (lp.originalThumbnailUrl) return lp.originalThumbnailUrl;
  if (lp.jpegThumbnail) return `data:image/jpeg;base64,${lp.jpegThumbnail}`;
  return '';
};

const domainFromUrl = (u?: string | null): string => {
  if (!u) return '';
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

const resolvePreviewUrl = (lp?: LinkPreview): string =>
  lp?.['matched-text'] ?? lp?.['canonical-url'] ?? '';

const isDeleted = (m: ListMessageResult): boolean => m.deleted === true;

const canInteractWithMessage = (m: ListMessageResult): boolean => {
  if (m.deleted) return false;
  if (m.summary?.is_sent_to_internal === false) return false;
  return true;
};

const onReply = (m: ListMessageResult) => {
  if (isDeleted(m)) return;

  chatStore.setMessageReply(m);
  (globalThis as Window & typeof globalThis).dispatchEvent(
    new CustomEvent('focus-composer')
  );
};

const onCopy = async (m: ListMessageResult) => {
  if (isDeleted(m)) return;

  const text =
    m.content?.message ||
    m.content?.link_preview?.['matched-text'] ||
    m.content?.link_preview?.['canonical-url'] ||
    '';
  if (text) await navigator.clipboard.writeText(text);
};

const hoveredMessageId = ref<string | null>(null);
const showReactionPicker = ref<string | null>(null);
const showEmojiPicker = ref<string | null>(null);

const quickReactions = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const ignoreOutsideOnce = ref(false);

const onReact = async (m: ListMessageResult, emoji: string) => {
  if (isDeleted(m)) return;
  if (!chatStore.activeChat?.chat_id) return;

  const success = await chatStore.reactToMessage(
    chatStore.activeChat.chat_id,
    m.message_id,
    emoji
  );

  if (success) {
    showReactionPicker.value = null;
    showEmojiPicker.value = null;
  }
};

const onMouseEnter = (message: ListMessageResult) => {
  if (isDeleted(message)) return;

  hoveredMessageId.value = message.message_id;
};

const onMouseLeave = () => {
  hoveredMessageId.value = null;
};

const toggleReactionPicker = (message: ListMessageResult) => {
  if (isDeleted(message)) return;

  const wasOpen = showReactionPicker.value === message.message_id;

  showReactionPicker.value = wasOpen ? null : message.message_id;
  showEmojiPicker.value = null;

  if (!wasOpen) {
    ignoreOutsideOnce.value = true;
    setTimeout(() => {
      ignoreOutsideOnce.value = false;
    }, 0);
  }
};

const onClickOutside = (event: MouseEvent) => {
  if (ignoreOutsideOnce.value) {
    return;
  }
  const target = event.target as HTMLElement;

  const isInsidePicker = target.closest('.reaction-picker');
  const isInsideTrigger = target.closest('.reaction-trigger');

  if (!isInsidePicker && !isInsideTrigger) {
    showReactionPicker.value = null;
    showEmojiPicker.value = null;
  }
};

const toggleEmojiPicker = (messageId: string) => {
  const wasOpen = showEmojiPicker.value === messageId;

  if (wasOpen) {
    showEmojiPicker.value = null;
    return;
  }

  showEmojiPicker.value = messageId;
  ignoreOutsideOnce.value = true;
  setTimeout(() => {
    ignoreOutsideOnce.value = false;
  }, 0);
};

const onSelectReactionEmoji = async (
  m: ListMessageResult,
  emoji: { native?: string; id?: string }
) => {
  const value = emoji?.native ?? emoji?.id;
  if (!value) return;

  await onReact(m, value);
  showEmojiPicker.value = null;
};

const getReactionsSummary = (
  reactions?: IReaction[] | null
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

type LocalUploadState = {
  status: 'uploading' | 'error';
  progress: number;
  errorMessage?: string;
};

const getLocalMessageState = (
  message: ListMessageResult
): LocalUploadState | null => {
  if (!message.hash) return null;
  return chatStore.localMessageState[message.hash] ?? null;
};

const isMessageUploadError = (message: ListMessageResult): boolean => {
  return getLocalMessageState(message)?.status === 'error';
};

const retryMessage = (message: ListMessageResult) => {
  if (!message.hash) return;
  const event = new CustomEvent('retry-message', {
    detail: { message },
  });
  globalThis.dispatchEvent(event);
};

const isTextMessage = (message: ListMessageResult): boolean => {
  if (!message.content) return false;
  return message.content.type === EMessageType.text;
};

const isDownloadableDocument = (message: ListMessageResult): boolean => {
  const doc = message.content?.document;
  if (!doc) return false;
  if (!doc.url) return false;
  if (message.content?.type !== EMessageType.document) return false;
  return true;
};

const isDownloadableImage = (message: ListMessageResult): boolean => {
  const image = message.content?.image;
  if (!image) return false;
  if (!image.url) return false;
  if (message.message_key?.is_view_once) return false;
  return message.content?.type === EMessageType.image;
};

const isDownloadableVideo = (message: ListMessageResult): boolean => {
  const video = message.content?.video;
  if (!video) return false;
  if (!video.url) return false;
  if (message.message_key?.is_view_once) return false;
  return message.content?.type === EMessageType.video;
};

const isDownloadableAudio = (message: ListMessageResult): boolean => {
  const audio = message.content?.audio;
  if (!audio) return false;
  if (!audio.url) return false;
  if (message.message_key?.is_view_once) return false;
  return message.content?.type === EMessageType.audio;
};

const isDownloadableSticker = (message: ListMessageResult): boolean => {
  const sticker = message.content?.sticker;
  if (!sticker) return false;
  if (!sticker.url) return false;
  return message.content?.type === EMessageType.sticker;
};

const shouldShowCopy = (message: ListMessageResult): boolean => {
  if (message.content?.type === EMessageType.contact_card) return false;
  if (isDownloadableDocument(message)) return false;
  if (isDownloadableImage(message)) return false;
  if (isDownloadableVideo(message)) return false;
  if (isDownloadableAudio(message)) return false;
  if (isDownloadableSticker(message)) return false;
  return isTextMessage(message);
};

const shouldShowDownload = (message: ListMessageResult): boolean => {
  if (isDownloadableDocument(message)) return true;
  if (isDownloadableImage(message)) return true;
  if (isDownloadableVideo(message)) return true;
  if (isDownloadableAudio(message)) return true;
  if (isDownloadableSticker(message)) return true;
  return false;
};

const stickerDownloadName = (sticker?: {
  extension?: string | null;
  mimetype?: string | null;
}): string => {
  const ext = sticker?.extension || 'webp';
  return `sticker.${ext}`;
};

const downloadMessage = (message: ListMessageResult) => {
  const audio = message.content?.audio;
  if (audio?.url && isDownloadableAudio(message)) {
    downloadAudio(audio.url, audioDownloadName(audio));
    return;
  }
  const docUrl = message.content?.document?.url;
  if (docUrl) {
    globalThis.open(docUrl, '_blank');
    return;
  }
  const video = message.content?.video;
  if (video?.url) {
    downloadVideo(video.url, videoDownloadName(video));
    return;
  }
  const sticker = message.content?.sticker;
  if (sticker?.url && isDownloadableSticker(message)) {
    downloadImage(sticker.url, stickerDownloadName(sticker));
    return;
  }
  const imageUrl = message.content?.image?.url;
  if (imageUrl) {
    downloadImage(
      imageUrl,
      viewerDownloadName.value || message.content?.image?.caption
    );
  }
};

const documentIconMap: Record<string, string> = {
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

const resolveDocumentIcon = (doc?: DocumentMessageChat | null): string => {
  if (!doc) return 'tabler-file-description';
  const ext = doc.extension?.toLowerCase();
  if (ext && documentIconMap[ext]) {
    return documentIconMap[ext];
  }

  const mimetype = doc.mimetype ?? '';
  if (mimetype.includes('pdf')) return 'tabler-file-type-pdf';
  if (mimetype.includes('word')) return 'tabler-file-type-doc';
  if (mimetype.includes('sheet') || mimetype.includes('excel'))
    return 'tabler-file-type-xls';
  if (mimetype.includes('presentation')) return 'tabler-file-type-ppt';
  if (mimetype.includes('zip') || mimetype.includes('compressed'))
    return 'tabler-file-type-zip';

  return 'tabler-file-description';
};

const formatDocumentSize = (size?: number | null): string => {
  if (!size) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(
    Math.floor(Math.log(size) / Math.log(1024)),
    units.length - 1
  );
  const value = size / Math.pow(1024, exponent);
  let formatted: string;
  if (value >= 100) {
    formatted = value.toFixed(0);
    return `${formatted} ${units[exponent]}`;
  }
  if (value >= 10) {
    formatted = value.toFixed(1);
    return `${formatted} ${units[exponent]}`;
  }
  formatted = value.toFixed(2);
  return `${formatted} ${units[exponent]}`;
};

const truncateDocumentName = (name?: string | null, max = 36): string => {
  if (!name) return t('document_label');
  if (name.length <= max) return name;
  const extIndex = name.lastIndexOf('.');
  if (extIndex <= 0) {
    return `${name.slice(0, max - 3)}...`;
  }

  const ext = name.slice(extIndex);
  const base = name.slice(0, max - ext.length - 3);
  return `${base}...${ext}`;
};

const documentDownloadName = (doc?: DocumentMessageChat | null): string => {
  if (!doc?.name) return t('document_label');
  return doc.name;
};

const videoDownloadName = (video?: VideoMessageChat | null): string => {
  if (!video) return 'video.mp4';
  if (video.name) return video.name;
  const ext = video.extension ? video.extension.toLowerCase() : 'mp4';
  return `video.${ext}`;
};

const audioDownloadName = (audio?: AudioMessageChat | null): string => {
  if (!audio) return 'audio.ogg';
  if (audio.name) return audio.name;
  const ext = audio.extension ? audio.extension.toLowerCase() : 'ogg';
  return `audio.${ext}`;
};

const resolveVideoMeta = (video?: VideoMessageChat | null): string => {
  if (!video) return '';
  const ext = video.extension ? video.extension.toUpperCase() : 'VIDEO';
  const size = video.size ? formatDocumentSize(video.size) : null;
  const duration = formatVideoDuration(video.duration);
  return [ext, size, duration].filter(Boolean).join(' • ');
};

const normalizeTimeValue = (value?: number | null): number | null => {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  if (value < 0) return null;
  return value;
};

const formatAudioTime = (seconds?: number | null): string => {
  const totalSeconds = Math.floor(normalizeTimeValue(seconds) ?? 0);
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

const getOrCreateAudioPlayer = (
  messageId: string,
  url: string
): HTMLAudioElement => {
  if (audioPlayers.value.has(messageId)) {
    return audioPlayers.value.get(messageId)!;
  }

  const audio = new Audio(url);
  audio.preload = 'metadata';
  audioPlayers.value.set(messageId, audio);

  audio.addEventListener('loadedmetadata', () => {
    const duration = normalizeTimeValue(audio.duration);
    if (duration !== null) {
      audioDurations[messageId] = duration;
    }
  });

  audio.addEventListener('timeupdate', () => {
    const currentTime = normalizeTimeValue(audio.currentTime);
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
  audio.play().catch(() => {
    audioPlayStates[messageId] = false;
  });
};

const decodeBase64Waveform = (base64String: string): number[] | null => {
  try {
    const binaryString = atob(base64String);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      const codePoint = binaryString.codePointAt(i);
      bytes[i] = codePoint ?? 0;
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

const createDefaultWaveform = (): number[] => {
  return new Array(64).fill(0.3);
};

const parseWaveform = (
  waveform: string | number[] | null | undefined
): number[] | null => {
  if (!waveform) {
    return null;
  }

  if (typeof waveform === 'string') {
    return decodeBase64Waveform(waveform);
  }

  if (Array.isArray(waveform) && waveform.length > 0) {
    return waveform;
  }

  return null;
};

const loadAudioWaveform = (
  messageId: string,
  waveform: string | number[] | null | undefined
): void => {
  if (audioWaveforms[messageId]) return;

  const waveformArray = parseWaveform(waveform);

  if (waveformArray && waveformArray.length > 0) {
    audioWaveforms[messageId] = normalizeWaveformValues(waveformArray);
    return;
  }

  audioWaveforms[messageId] = createDefaultWaveform();
};

const getAudioProgress = (messageId: string): number => {
  const currentTime = normalizeTimeValue(audioCurrentTimes[messageId]) ?? 0;
  const duration = normalizeTimeValue(audioDurations[messageId]) ?? 0;
  if (duration === 0) return 0;
  return (currentTime / duration) * 100;
};

const isAudioPlaying = (messageId: string): boolean => {
  return !!audioPlayStates[messageId];
};

const getDisplayTime = (
  messageId: string,
  fallbackDuration?: number | null
): string => {
  const isPlaying = isAudioPlaying(messageId);
  const currentTime = normalizeTimeValue(audioCurrentTimes[messageId]);
  const duration =
    normalizeTimeValue(audioDurations[messageId]) ??
    normalizeTimeValue(fallbackDuration);

  if (isPlaying) {
    if (currentTime !== null) {
      return formatAudioTime(currentTime);
    }
    if (duration !== null) {
      return formatAudioTime(duration);
    }
    return '0:00';
  }

  return formatAudioTime(duration);
};

onUnmounted(() => {
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
});
const formatVideoDuration = (duration?: number | null): string => {
  if (!duration || duration <= 0) return '';
  const totalSeconds = Math.floor(duration);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const onDelete = async (m: ListMessageResult) => {
  if (isDeleted(m)) return;
  if (!chatStore.activeChat?.chat_id) return;

  if (hoveredMessageId.value === m.message_id) {
    hoveredMessageId.value = null;
  }
  if (showReactionPicker.value === m.message_id) {
    showReactionPicker.value = null;
    showEmojiPicker.value = null;
  }

  const success = await chatStore.deleteMessage(
    chatStore.activeChat.chat_id,
    m.message_id
  );

  if (success) {
    chatStore.showSnackbar(t('chat_delete_success'), EColor.success);
    return;
  }

  chatStore.showSnackbar(t('chat_delete_error'), EColor.error);
};

const showQuoted = (m: ListMessageResult) => !!m.content?.quoted;

const resolveQuotedName = (m: ListMessageResult): string => {
  const fromMe = m.content?.quoted?.key?.from_me ?? null;
  if (fromMe === true) return chatStore.user?.info.name ?? '';
  if (fromMe === false) return chatStore.activeChat?.name ?? '';
  return '';
};

const resolveQuotedText = (m: ListMessageResult): string => {
  if (!m.content?.quoted) {
    return '';
  }

  if (m.content.quoted.type === EMessageType.image || m.content.quoted.image) {
    return m.content.quoted.image?.caption || t('photo_label');
  }

  if (
    m.content.quoted.type === EMessageType.document &&
    m.content.quoted.document
  ) {
    return m.content.quoted.message ?? '';
  }

  if (m.content.quoted.type === EMessageType.video) {
    return m.content.quoted.video?.caption || '';
  }

  if (m.content.quoted.type === EMessageType.audio) {
    return m.content.quoted.message ?? t('audio_label');
  }

  if (m.content.quoted.type === EMessageType.sticker) {
    return t('sticker_label', 'Sticker');
  }

  return m.content.quoted.message ?? '';
};

const resolveQuotedImageSrc = (m: ListMessageResult): string => {
  const image = m.content?.quoted?.image;
  if (!image) return '';
  return image.url || image.thumbnail || '';
};

const resolveQuotedStickerSrc = (m: ListMessageResult): string => {
  return m.content?.quoted?.sticker?.url || '';
};

const resolveQuotedVideoUrl = (m: ListMessageResult): string => {
  return m.content?.quoted?.video?.url ?? '';
};

const resolveQuotedVideoPoster = (m: ListMessageResult): string => {
  const poster = m.content?.quoted?.video?.thumbnail;
  if (!poster) return '';
  return poster;
};

const hasQuotedImage = (m: ListMessageResult): boolean => {
  const image = m.content?.quoted?.image;
  if (!image) return false;
  return !!(image.url || image.thumbnail);
};

const hasQuotedDocument = (m: ListMessageResult): boolean => {
  if (!m.content?.quoted) return false;
  return (
    m.content.quoted.type === EMessageType.document &&
    !!m.content.quoted.document
  );
};

const hasQuotedVideo = (m: ListMessageResult): boolean =>
  !!m.content?.quoted?.video;

const hasQuotedAudio = (m: ListMessageResult): boolean =>
  !!m.content?.quoted?.audio;

const hasQuotedSticker = (m: ListMessageResult): boolean =>
  !!m.content?.quoted?.sticker;

const hasQuotedContact = (m: ListMessageResult): boolean =>
  !!(
    m.content?.quoted?.type === EMessageType.contact_card &&
    m.content.quoted.contact
  );

const resolveQuotedDocumentIcon = (m: ListMessageResult): string => {
  const ext = m.content?.quoted?.document?.extension?.toLowerCase();
  if (ext && documentIconMap[ext]) {
    return documentIconMap[ext];
  }

  const mimetype = m.content?.quoted?.document?.mimetype ?? '';
  if (mimetype.includes('pdf')) return 'tabler-file-type-pdf';
  if (mimetype.includes('word')) return 'tabler-file-type-doc';
  if (mimetype.includes('sheet') || mimetype.includes('excel'))
    return 'tabler-file-type-xls';
  if (mimetype.includes('presentation')) return 'tabler-file-type-ppt';
  if (mimetype.includes('zip') || mimetype.includes('compressed'))
    return 'tabler-file-type-zip';

  return 'tabler-file-description';
};

const resolveQuotedDocumentName = (m: ListMessageResult): string =>
  m.content?.quoted?.document?.name ?? t('document_label');

const resolveQuotedDocumentMeta = (m: ListMessageResult): string => {
  const doc = m.content?.quoted?.document;
  if (!doc) return '';
  const ext = doc.extension ? doc.extension.toUpperCase() : 'FILE';
  if (!doc.size) return ext;
  return `${ext} • ${formatDocumentSize(doc.size)}`;
};

const resolveQuotedImageName = (m: ListMessageResult): string => {
  return t('photo_label');
};

const resolveQuotedImageMeta = (m: ListMessageResult): string => {
  const image = m.content?.quoted?.image;
  if (!image) return '';
  const ext = image.extension ? image.extension.toUpperCase() : 'IMAGE';
  const size = image.size ? formatDocumentSize(image.size) : null;
  return [ext, size].filter(Boolean).join(' • ');
};

const resolveQuotedVideoName = (m: ListMessageResult): string => {
  return t('video_label');
};

const resolveQuotedVideoMeta = (m: ListMessageResult): string => {
  const video = m.content?.quoted?.video;
  if (!video) return '';
  const ext = video.extension ? video.extension.toUpperCase() : 'VIDEO';
  const size = video.size ? formatDocumentSize(video.size) : null;
  const duration = formatVideoDuration(video.duration);
  return [ext, size, duration].filter(Boolean).join(' • ');
};

const resolveQuotedAudioName = (m: ListMessageResult): string => {
  return t('audio_label');
};

const resolveQuotedAudioMeta = (m: ListMessageResult): string => {
  const audio = m.content?.quoted?.audio;
  if (!audio) return '';
  const size = audio.size ? formatDocumentSize(audio.size) : null;
  const duration = formatVideoDuration(audio.duration);
  return [size, duration].filter(Boolean).join(' • ');
};

const getQuotedTargetId = (m: ListMessageResult): string | null => {
  const byExplicitId = m.content?.message_quoted_id || null;
  if (byExplicitId) return String(byExplicitId);

  const byKeyId = m.content?.quoted?.key?.id || null;
  if (byKeyId) {
    const matchByKey = chatStore.listMessages.find(
      (x) => x.message_key?.id === byKeyId
    );
    if (matchByKey) {
      return matchByKey.message_id;
    }
  }

  const text = m.content?.quoted?.message?.trim();
  if (!text) return null;

  const found = chatStore.listMessages.find(
    (x) => x.content?.message?.trim() === text
  );
  return found?.message_id || null;
};

const goToQuoted = (m: ListMessageResult) => {
  if (isDeleted(m)) return;

  const targetId = getQuotedTargetId(m);
  if (!targetId) return;

  (globalThis as Window & typeof globalThis).dispatchEvent(
    new CustomEvent('scroll-to-message', { detail: targetId })
  );
};

const openImage = (m: ListMessageResult) => {
  viewerKind.value = 'image';
  if (m.content?.sticker?.url) {
    viewerSrc.value = m.content.sticker.url;
    viewerCaption.value = '';
    viewerDownloadName.value = stickerDownloadName(m.content.sticker);
  } else {
    viewerSrc.value = m.content?.image?.url || '';
    viewerCaption.value = m.content?.image?.caption || '';
    viewerDownloadName.value = documentDownloadName({
      url: viewerSrc.value,
      name: m.content?.image?.caption ?? undefined,
      mimetype: m.content?.image?.mimetype ?? undefined,
      extension: m.content?.image?.extension ?? undefined,
    } as DocumentMessageChat);
  }
  viewerOpen.value = true;
};

const openVideo = (m: ListMessageResult) => {
  const video = m.content?.video;
  if (!video?.url) return;

  viewerKind.value = 'video';
  viewerSrc.value = video.url;
  viewerCaption.value = video.caption || m.content?.message || '';
  viewerDownloadName.value = videoDownloadName(video);
  viewerOpen.value = true;
};

const downloadImage = async (
  url: string,
  filename: string | null = 'image.jpg'
) => {
  if (!url) return;

  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = globalThis.URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = filename || 'image.jpg';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => {
      globalThis.URL.revokeObjectURL(blobUrl);
    }, 100);
  } catch {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.download = filename || 'image.jpg';
    anchor.rel = 'noopener';
    anchor.click();
  }
};

const downloadVideo = async (
  url: string,
  filename: string | null = 'video.mp4'
) => {
  if (!url) return;

  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = globalThis.URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = filename || 'video.mp4';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => {
      globalThis.URL.revokeObjectURL(blobUrl);
    }, 100);
  } catch {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.download = filename || 'video.mp4';
    anchor.rel = 'noopener';
    anchor.click();
  }
};

const downloadAudio = async (
  url: string,
  filename: string | null = 'audio.ogg'
) => {
  if (!url) return;

  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = globalThis.URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = filename || 'audio.ogg';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => {
      globalThis.URL.revokeObjectURL(blobUrl);
    }, 100);
  } catch {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.download = filename || 'audio.ogg';
    anchor.rel = 'noopener';
    anchor.click();
  }
};

const downloadViewerMedia = () => {
  if (!viewerSrc.value) return;
  if (viewerKind.value === 'video') {
    downloadVideo(viewerSrc.value, viewerDownloadName.value);
    return;
  }
  downloadImage(viewerSrc.value, viewerDownloadName.value);
};

const handleScroll = async (e: Event) => {
  const target = e.target as HTMLElement;
  if (!target) return;

  const scrollTop = target.scrollTop;
  const threshold = 200;

  if (
    scrollTop < threshold &&
    !chatStore.loadingMoreMessages &&
    chatStore.currentPage < chatStore.totalPages
  ) {
    const previousScrollHeight = target.scrollHeight;
    const previousScrollTop = target.scrollTop;

    const success = await chatStore.loadMoreMessages();

    if (success) {
      await nextTick();
      const newScrollHeight = target.scrollHeight;
      const scrollDifference = newScrollHeight - previousScrollHeight;
      target.scrollTop = previousScrollTop + scrollDifference;
    }
  }
};

watch(
  () => chatStore.listMessages,
  (messages) => {
    nextTick(() => {
      for (const msg of messages) {
        if (
          msg.content?.type === EMessageType.audio &&
          msg.content?.audio?.url &&
          !audioWaveforms[msg.message_id]
        ) {
          loadAudioWaveform(msg.message_id, msg.content.audio.waveform);
        }
      }
    });
  },
  { deep: true, immediate: true }
);

onMounted(() => {
  nextTick(() => {
    const psContainer = chatLogContainer.value?.closest('.ps') as HTMLElement;
    const scrollElement =
      (psContainer?.querySelector('.ps__rail-y')
        ?.parentElement as HTMLElement) || psContainer;

    if (scrollElement) {
      scrollElement.addEventListener('scroll', handleScroll, { passive: true });
    }

    document.addEventListener('click', onClickOutside);

    for (const msg of chatStore.listMessages) {
      if (
        msg.content?.type === EMessageType.audio &&
        msg.content?.audio?.url &&
        !audioWaveforms[msg.message_id]
      ) {
        loadAudioWaveform(msg.message_id, msg.content.audio.waveform);
      }
    }
  });
});

onUnmounted(() => {
  const psContainer = chatLogContainer.value?.closest('.ps') as HTMLElement;
  const scrollElement =
    (psContainer?.querySelector('.ps__rail-y')?.parentElement as HTMLElement) ||
    psContainer;

  if (scrollElement) {
    scrollElement.removeEventListener('scroll', handleScroll);
  }

  document.removeEventListener('click', onClickOutside);
});
</script>

<template>
  <div ref="chatLogContainer" class="chat-log pa-6">
    <div
      v-if="chatStore.loadingMoreMessages"
      class="d-flex justify-center align-center py-4"
    >
      <VChip color="primary" variant="flat" size="small">
        <VIcon start icon="tabler-loader-2" class="spin" />
        {{ t('loading_more_messages') }}
      </VChip>
    </div>

    <div
      v-for="(msgGrp, index) in chatStore.listMessages"
      :key="msgGrp.message_id"
      :id="`msg-${msgGrp.message_id}`"
      :data-message-id="msgGrp.message_id"
      class="chat-group d-flex align-start position-relative"
      :class="[
        {
          'flex-row-reverse': !isTypeUser(msgGrp),
          'mb-6': chatStore.listMessages.length - 1 !== index,
        },
      ]"
      @mouseenter="onMouseEnter(msgGrp)"
      @mouseleave="onMouseLeave"
    >
      <div class="chat-avatar" :class="!isTypeUser(msgGrp) ? 'ms-4' : 'me-4'">
        <VAvatar
          size="32"
          :variant="!isPhotoExist(msgGrp) ? 'tonal' : undefined"
        >
          <VImg v-if="isPhotoExist(msgGrp)" :src="resolvePhoto(msgGrp)" />
          <span v-if="!isPhotoExist(msgGrp)" class="text-1xl">
            {{ avatarChat(msgGrp) }}
          </span>
        </VAvatar>
      </div>

      <div
        class="chat-body d-inline-flex flex-column position-relative"
        :class="!isTypeUser(msgGrp) ? 'align-end' : 'align-start'"
      >
        <div
          class="chat-content-wrapper"
          :class="!isTypeUser(msgGrp) ? 'wrapper-operator' : 'wrapper-client'"
        >
          <div
            v-if="
              hoveredMessageId === msgGrp.message_id &&
              canInteractWithMessage(msgGrp) &&
              showReactionPicker !== msgGrp.message_id
            "
            :class="[
              'reaction-trigger-container',
              !isTypeUser(msgGrp) ? 'wrapper-operator' : 'wrapper-client',
            ]"
            @click.stop="toggleReactionPicker(msgGrp)"
          >
            <VBtn
              icon
              size="32"
              variant="flat"
              class="reaction-trigger-btn"
              color="grey-600"
              tabindex="-1"
            >
              <VIcon size="22">tabler-mood-smile</VIcon>
            </VBtn>
          </div>

          <div
            v-if="isMessageUploadError(msgGrp)"
            :class="[
              'retry-trigger-container',
              !isTypeUser(msgGrp) ? 'wrapper-operator' : 'wrapper-client',
            ]"
            @click.stop="retryMessage(msgGrp)"
          >
            <VBtn
              icon
              size="32"
              variant="flat"
              class="retry-trigger-btn"
              color="error"
              tabindex="-1"
            >
              <VIcon size="22">tabler-refresh</VIcon>
            </VBtn>
          </div>

          <div
            class="chat-content py-2 px-2 elevation-2"
            :class="[
              isTypeUser(msgGrp) ? 'chat-left' : 'chat-right',
              {
                'is-deleted': msgGrp.deleted,
                'has-actions': !msgGrp.deleted,
              },
            ]"
            :style="{
              backgroundColor: isTypeUser(msgGrp)
                ? 'rgb(var(--v-theme-surface))'
                : 'rgb(217, 253, 211)',
            }"
          >
            <div v-if="canInteractWithMessage(msgGrp)" class="message-actions">
              <VMenu
                :close-on-content-click="true"
                location="bottom end"
                offset="6"
              >
                <template #activator="{ props }">
                  <VBtn
                    v-bind="props"
                    icon
                    size="24"
                    density="comfortable"
                    variant="text"
                    :color="
                      isTypeUser(msgGrp)
                        ? 'rgb(var(--v-theme-on-surface))'
                        : 'rgb(var(--v-theme-title))'
                    "
                  >
                    <VIcon size="18">tabler-chevron-down</VIcon>
                  </VBtn>
                </template>

                <VList density="compact" min-width="180">
                  <VListItem @click="onReply(msgGrp)">
                    <template #prepend>
                      <VIcon size="18">tabler-corner-up-left</VIcon>
                    </template>
                    <VListItemTitle>Responder</VListItemTitle>
                  </VListItem>

                  <VListItem
                    v-if="shouldShowCopy(msgGrp)"
                    @click="onCopy(msgGrp)"
                  >
                    <template #prepend>
                      <VIcon size="18">tabler-copy</VIcon>
                    </template>
                    <VListItemTitle>Copiar</VListItemTitle>
                  </VListItem>

                  <VListItem
                    v-if="shouldShowDownload(msgGrp)"
                    @click="downloadMessage(msgGrp)"
                  >
                    <template #prepend>
                      <VIcon size="18">tabler-download</VIcon>
                    </template>
                    <VListItemTitle>{{
                      t('chat_action_download')
                    }}</VListItemTitle>
                  </VListItem>

                  <VListItem @click="toggleReactionPicker(msgGrp)">
                    <template #prepend>
                      <VIcon size="18">tabler-mood-smile</VIcon>
                    </template>
                    <VListItemTitle>Reagir</VListItemTitle>
                  </VListItem>

                  <VListItem
                    v-if="!isTypeUser(msgGrp)"
                    @click="onDelete(msgGrp)"
                  >
                    <template #prepend>
                      <VIcon size="18">tabler-trash</VIcon>
                    </template>
                    <VListItemTitle>Apagar</VListItemTitle>
                  </VListItem>
                </VList>
              </VMenu>
            </div>

            <div class="message-block">
              <div
                v-if="showQuoted(msgGrp)"
                class="quoted-block"
                :class="{
                  'is-right': !isTypeUser(msgGrp),
                  'is-clickable': !msgGrp.deleted,
                }"
                @click="goToQuoted(msgGrp)"
              >
                <div class="quoted-name">
                  {{ resolveQuotedName(msgGrp) }}
                </div>

                <div class="quoted-content">
                  <div
                    v-if="hasQuotedImage(msgGrp)"
                    class="quoted-media quoted-media--image"
                  >
                    <VImg
                      :src="resolveQuotedImageSrc(msgGrp)"
                      width="44"
                      height="44"
                      cover
                    />
                  </div>

                  <div
                    v-if="hasQuotedSticker(msgGrp)"
                    class="quoted-media quoted-media--image"
                  >
                    <VImg
                      :src="resolveQuotedStickerSrc(msgGrp)"
                      width="44"
                      height="44"
                      contain
                    />
                  </div>

                  <div v-if="hasQuotedDocument(msgGrp)" class="quoted-document">
                    <VIcon
                      :icon="resolveQuotedDocumentIcon(msgGrp)"
                      size="26"
                      color="primary"
                    />
                    <div class="quoted-document-info">
                      <span class="quoted-document-name">
                        {{ resolveQuotedDocumentName(msgGrp) }}
                      </span>
                      <span class="quoted-document-meta">
                        {{ resolveQuotedDocumentMeta(msgGrp) }}
                      </span>
                    </div>
                  </div>

                  <div
                    v-if="hasQuotedVideo(msgGrp)"
                    class="quoted-media quoted-media--video"
                  >
                    <template v-if="resolveQuotedVideoUrl(msgGrp)">
                      <video
                        :src="resolveQuotedVideoUrl(msgGrp)"
                        :poster="resolveQuotedVideoPoster(msgGrp) || undefined"
                        class="quoted-video-thumb"
                        preload="metadata"
                        muted
                        playsinline
                      >
                        <track kind="captions" />
                      </video>
                      <div class="quoted-video-overlay">
                        <VIcon size="16">tabler-player-play</VIcon>
                      </div>
                    </template>
                    <div
                      v-if="!resolveQuotedVideoUrl(msgGrp)"
                      class="quoted-video-placeholder"
                    >
                      <VIcon size="20">tabler-player-play</VIcon>
                    </div>
                  </div>

                  <div v-if="hasQuotedVideo(msgGrp)" class="quoted-video-info">
                    <span class="quoted-video-name">
                      {{ resolveQuotedVideoName(msgGrp) }}
                    </span>
                    <span
                      v-if="resolveQuotedVideoMeta(msgGrp)"
                      class="quoted-video-meta"
                    >
                      {{ resolveQuotedVideoMeta(msgGrp) }}
                    </span>
                  </div>

                  <div v-if="hasQuotedAudio(msgGrp)" class="quoted-audio">
                    <VIcon size="22" color="primary">tabler-microphone</VIcon>
                    <div class="quoted-audio-info">
                      <span class="quoted-audio-name">
                        {{ resolveQuotedAudioName(msgGrp) }}
                      </span>
                      <span
                        v-if="resolveQuotedAudioMeta(msgGrp)"
                        class="quoted-audio-meta"
                      >
                        {{ resolveQuotedAudioMeta(msgGrp) }}
                      </span>
                    </div>
                  </div>

                  <div v-if="hasQuotedContact(msgGrp)" class="quoted-contact">
                    <VIcon size="22" color="primary">tabler-user</VIcon>
                    <div class="quoted-contact-info">
                      <span class="quoted-contact-name">
                        {{
                          msgGrp.content?.quoted?.contact?.name
                            ? `${msgGrp.content.quoted.contact.name} ${msgGrp.content.quoted.contact.last_name || ''}`.trim()
                            : 'Contato'
                        }}
                      </span>
                    </div>
                  </div>

                  <div v-if="hasQuotedImage(msgGrp)" class="quoted-image-info">
                    <span class="quoted-image-name">
                      {{ resolveQuotedImageName(msgGrp) }}
                    </span>
                    <span
                      v-if="resolveQuotedImageMeta(msgGrp)"
                      class="quoted-image-meta"
                    >
                      {{ resolveQuotedImageMeta(msgGrp) }}
                    </span>
                  </div>

                  <div
                    v-if="
                      resolveQuotedText(msgGrp) &&
                      msgGrp.content?.quoted?.type !== EMessageType.video &&
                      msgGrp.content?.quoted?.type !== EMessageType.image &&
                      msgGrp.content?.quoted?.type !== EMessageType.audio &&
                      msgGrp.content?.quoted?.type !== EMessageType.sticker &&
                      msgGrp.content?.quoted?.type !== EMessageType.contact_card
                    "
                    class="quoted-text"
                    :style="{
                      color: isTypeUser(msgGrp)
                        ? 'rgb(var(--v-theme-on-surface))'
                        : 'rgb(var(--v-theme-title))',
                    }"
                  >
                    {{ resolveQuotedText(msgGrp) }}
                  </div>
                </div>
              </div>

              <div
                v-if="msgGrp.content?.link_preview?.title"
                class="link-preview rounded"
                :class="
                  !isTypeUser(msgGrp)
                    ? 'link-preview--right'
                    : 'link-preview--left'
                "
                :style="{
                  backgroundColor: isTypeUser(msgGrp)
                    ? 'rgb(var(--v-theme-grey-200))'
                    : 'rgb(214, 243, 207)',
                  color: isTypeUser(msgGrp)
                    ? 'rgb(var(--v-theme-on-grey))'
                    : 'rgb(var(--v-theme-title))',
                }"
              >
                <div class="lp-main d-flex">
                  <div v-if="resolvePreviewImage(msgGrp.content.link_preview)">
                    <div class="lp-thumb me-3">
                      <img
                        :src="resolvePreviewImage(msgGrp.content.link_preview)"
                        alt=""
                      />
                    </div>
                  </div>

                  <div class="lp-text">
                    <div class="lp-domain text-xs mb-1">
                      {{
                        domainFromUrl(
                          msgGrp.content.link_preview['canonical-url'] ||
                            msgGrp.content.link_preview['matched-text']
                        )
                      }}
                    </div>

                    <div class="lp-title text-sm mb-1">
                      {{ msgGrp.content.link_preview.title }}
                    </div>

                    <div class="lp-desc text-xs">
                      {{ msgGrp.content.link_preview.description }}
                    </div>
                  </div>
                </div>

                <a
                  v-if="resolvePreviewUrl(msgGrp.content.link_preview)"
                  class="lp-url d-block mt-2 text-sm"
                  :href="resolvePreviewUrl(msgGrp.content.link_preview)"
                  target="_blank"
                  rel="noopener"
                >
                  {{ resolvePreviewUrl(msgGrp.content.link_preview) }}
                </a>
              </div>

              <div
                v-if="
                  msgGrp.content?.type === EMessageType.image &&
                  msgGrp.content?.image?.url &&
                  !msgGrp.message_key?.is_view_once
                "
                :class="[
                  'image-bubble',
                  !isTypeUser(msgGrp)
                    ? 'image-bubble--right'
                    : 'image-bubble--left',
                  { 'is-deleted': msgGrp.deleted },
                ]"
                @click="openImage(msgGrp)"
              >
                <VImg
                  :src="msgGrp.content.image.url"
                  :aspect-ratio="
                    msgGrp.content.image.width && msgGrp.content.image.height
                      ? msgGrp.content.image.width / msgGrp.content.image.height
                      : undefined
                  "
                  class="image-thumb"
                  width="120"
                  cover
                />

                <p
                  v-if="msgGrp.content.image.caption"
                  class="image-caption mt-2"
                  :style="{
                    color: isTypeUser(msgGrp)
                      ? 'rgb(var(--v-theme-on-surface))'
                      : 'rgb(var(--v-theme-title))',
                  }"
                >
                  {{ msgGrp.content.image.caption }}
                </p>
              </div>

              <div
                v-if="
                  msgGrp.content?.type === EMessageType.video &&
                  msgGrp.content?.video?.url &&
                  !msgGrp.message_key?.is_view_once
                "
                :class="[
                  'video-bubble',
                  !isTypeUser(msgGrp)
                    ? 'video-bubble--right'
                    : 'video-bubble--left',
                  { 'is-deleted': msgGrp.deleted },
                ]"
                @click="openVideo(msgGrp)"
              >
                <div class="video-thumb-wrapper">
                  <video
                    :src="msgGrp.content.video.url"
                    class="video-thumb"
                    preload="metadata"
                    muted
                    playsinline
                  >
                    <track kind="captions" />
                  </video>
                  <div class="video-play-overlay">
                    <VIcon size="28">tabler-player-play</VIcon>
                  </div>
                </div>
                <div class="video-details">
                  <span class="video-meta text-caption text-disabled">
                    {{ resolveVideoMeta(msgGrp.content.video) }}
                  </span>
                </div>
                <p
                  v-if="msgGrp.content.video.caption"
                  class="video-caption mt-2"
                  :style="{
                    color: isTypeUser(msgGrp)
                      ? 'rgb(var(--v-theme-on-surface))'
                      : 'rgb(var(--v-theme-title))',
                  }"
                >
                  {{ msgGrp.content.video.caption }}
                </p>
              </div>

              <div
                v-if="
                  msgGrp.content?.type === EMessageType.sticker &&
                  msgGrp.content?.sticker?.url
                "
                :class="[
                  'sticker-bubble',
                  !isTypeUser(msgGrp)
                    ? 'sticker-bubble--right'
                    : 'sticker-bubble--left',
                  { 'is-deleted': msgGrp.deleted },
                ]"
                @click="openImage(msgGrp)"
              >
                <VImg
                  v-if="!msgGrp.content.sticker.is_animated"
                  :src="msgGrp.content.sticker.url"
                  class="sticker-thumb"
                  max-width="100"
                  max-height="100"
                  contain
                />
                <img
                  v-else
                  :src="msgGrp.content.sticker.url"
                  class="sticker-thumb sticker-thumb--animated"
                  style="
                    max-width: 100px;
                    max-height: 100px;
                    object-fit: contain;
                  "
                />
              </div>

              <div
                v-if="
                  msgGrp.content?.type === EMessageType.audio &&
                  msgGrp.content?.audio?.url
                "
                :class="[
                  'audio-bubble',
                  !isTypeUser(msgGrp)
                    ? 'audio-bubble--right'
                    : 'audio-bubble--left',
                  { 'is-deleted': msgGrp.deleted },
                ]"
              >
                <div class="audio-player-container">
                  <VBtn
                    icon
                    size="36"
                    variant="text"
                    class="audio-play-btn"
                    @click="
                      toggleAudioPlay(
                        msgGrp.message_id,
                        msgGrp.content.audio.url
                      )
                    "
                  >
                    <VIcon size="18">
                      {{
                        isAudioPlaying(msgGrp.message_id)
                          ? 'tabler-player-pause'
                          : 'tabler-player-play'
                      }}
                    </VIcon>
                  </VBtn>

                  <div class="audio-waveform-container">
                    <template
                      v-if="
                        (() => {
                          const waveform = audioWaveforms[msgGrp.message_id];
                          return (
                            waveform &&
                            Array.isArray(waveform) &&
                            waveform.length > 0
                          );
                        })()
                      "
                    >
                      <div class="audio-waveform">
                        <div
                          v-for="(barValue, index) in audioWaveforms[
                            msgGrp.message_id
                          ]"
                          :key="`${msgGrp.message_id}-${index}`"
                          class="audio-waveform-bar"
                          :class="{
                            'audio-waveform-bar--active':
                              getAudioProgress(msgGrp.message_id) >
                              (index /
                                (audioWaveforms[msgGrp.message_id]?.length ||
                                  80)) *
                                100,
                          }"
                          :style="{
                            height: `${Math.max(2, barValue * 100)}%`,
                          }"
                        ></div>
                      </div>
                      <div
                        class="audio-progress-indicator"
                        :style="{
                          left: `${getAudioProgress(msgGrp.message_id)}%`,
                        }"
                      ></div>
                    </template>
                    <div v-else class="audio-waveform-placeholder">
                      <div
                        v-for="i in 80"
                        :key="`placeholder-${msgGrp.message_id}-${i}`"
                        class="audio-waveform-bar-placeholder"
                      ></div>
                    </div>
                  </div>
                </div>

                <p
                  v-if="msgGrp.content?.message"
                  class="audio-caption mt-2"
                  :style="{
                    color: isTypeUser(msgGrp)
                      ? 'rgb(var(--v-theme-on-surface))'
                      : 'rgb(var(--v-theme-title))',
                  }"
                >
                  {{ msgGrp.content.message }}
                </p>
              </div>

              <div
                v-if="
                  msgGrp.content?.type === EMessageType.contact_card &&
                  msgGrp.content?.contact
                "
                :class="[
                  'contact-bubble',
                  !isTypeUser(msgGrp)
                    ? 'contact-bubble--right'
                    : 'contact-bubble--left',
                  { 'is-deleted': msgGrp.deleted },
                ]"
              >
                <div
                  class="contact-item d-flex align-center gap-3 pa-3"
                  :style="{
                    backgroundColor: isTypeUser(msgGrp)
                      ? 'rgba(var(--v-theme-surface), 0.5)'
                      : 'rgba(255, 255, 255, 0.3)',
                    borderRadius: '8px',
                  }"
                >
                  <VAvatar size="40" color="primary" variant="tonal">
                    <VIcon size="20">tabler-user</VIcon>
                  </VAvatar>
                  <div class="flex-grow-1">
                    <div
                      class="text-body-1 font-weight-medium"
                      :style="{
                        color: isTypeUser(msgGrp)
                          ? 'rgb(var(--v-theme-on-surface))'
                          : 'rgb(var(--v-theme-title))',
                      }"
                    >
                      {{ msgGrp.content.contact.name }}
                      {{ msgGrp.content.contact.last_name || '' }}
                    </div>
                    <div
                      v-if="msgGrp.content.contact.phone_partial"
                      class="text-caption text-disabled"
                    >
                      {{ msgGrp.content.contact.phone_partial }}
                    </div>
                  </div>
                </div>
                <p
                  v-if="msgGrp.content?.message"
                  class="contact-caption mt-2"
                  :style="{
                    color: isTypeUser(msgGrp)
                      ? 'rgb(var(--v-theme-on-surface))'
                      : 'rgb(var(--v-theme-title))',
                  }"
                >
                  {{ msgGrp.content.message }}
                </p>
              </div>

              <div
                v-if="
                  msgGrp.content?.message &&
                  msgGrp.content?.type !== EMessageType.image &&
                  msgGrp.content?.type !== EMessageType.video &&
                  msgGrp.content?.type !== EMessageType.document &&
                  msgGrp.content?.type !== EMessageType.contact_card &&
                  !msgGrp.message_key?.is_view_once
                "
              >
                <p
                  class="mb-2 mr-6 text-base message-text"
                  :style="{
                    color: isTypeUser(msgGrp)
                      ? 'rgb(var(--v-theme-on-surface))'
                      : 'rgb(var(--v-theme-title))',
                  }"
                >
                  {{ msgGrp.content?.message }}
                </p>
              </div>

              <div
                v-if="
                  msgGrp.content?.type === EMessageType.document &&
                  msgGrp.content?.document?.url
                "
                :class="[
                  'document-bubble',
                  !isTypeUser(msgGrp)
                    ? 'document-bubble--right'
                    : 'document-bubble--left',
                  { 'is-deleted': msgGrp.deleted },
                ]"
              >
                <div class="document-icon">
                  <VIcon
                    :icon="resolveDocumentIcon(msgGrp.content?.document)"
                    size="30"
                    color="primary"
                  />
                </div>
                <div class="document-details">
                  <VTooltip location="bottom">
                    <template #activator="{ props }">
                      <a
                        v-bind="props"
                        class="document-name"
                        :href="msgGrp.content.document.url"
                        :download="
                          documentDownloadName(msgGrp.content.document)
                        "
                        target="_blank"
                        rel="noopener"
                      >
                        {{ truncateDocumentName(msgGrp.content.document.name) }}
                      </a>
                    </template>
                    <span>{{ msgGrp.content.document.name }}</span>
                  </VTooltip>

                  <span class="document-meta text-caption text-disabled">
                    {{
                      (msgGrp.content.document.extension || '').toUpperCase() ||
                      'FILE'
                    }}
                    •
                    {{ formatDocumentSize(msgGrp.content.document.size) }}
                  </span>
                </div>
                <a
                  class="document-download"
                  :href="msgGrp.content.document.url"
                  :download="documentDownloadName(msgGrp.content.document)"
                  target="_blank"
                  rel="noopener"
                >
                  <VIcon size="22">tabler-download</VIcon>
                </a>
              </div>

              <div
                v-if="
                  msgGrp.content?.reactions &&
                  msgGrp.content.reactions.length > 0
                "
                :class="[
                  'reactions-summary',
                  !isTypeUser(msgGrp)
                    ? 'reactions-summary--right'
                    : 'reactions-summary--left',
                ]"
              >
                <div class="reaction-summary-bubble">
                  <div
                    v-for="(reaction, idx) in getReactionsSummary(
                      msgGrp.content.reactions
                    )"
                    :key="idx"
                    class="reaction-summary-item"
                  >
                    <span class="reaction-summary-emoji">
                      {{ reaction.emoji }}
                    </span>
                    <span class="reaction-summary-count">
                      {{ reaction.count }}
                    </span>
                  </div>
                </div>
              </div>

              <div v-if="msgGrp.deleted" class="deleted-label-wrapper">
                <span
                  class="deleted-label"
                  :style="{
                    color: isTypeUser(msgGrp)
                      ? 'rgba(var(--v-theme-on-surface), 0.65)'
                      : 'rgba(var(--v-theme-title), 0.65)',
                  }"
                >
                  {{ t('chat_deleted_message_label') }}
                </span>
              </div>

              <div
                v-if="
                  showReactionPicker === msgGrp.message_id &&
                  canInteractWithMessage(msgGrp)
                "
                class="reaction-picker"
                :class="
                  !isTypeUser(msgGrp)
                    ? 'reaction-picker-operator'
                    : 'reaction-picker-client'
                "
                @click.stop
              >
                <div class="reaction-picker-content d-flex align-center ga-1">
                  <VBtn
                    v-for="emoji in quickReactions"
                    :key="emoji"
                    icon
                    size="32"
                    variant="text"
                    class="reaction-btn"
                    @click="onReact(msgGrp, emoji)"
                  >
                    <span class="text-h6">{{ emoji }}</span>
                  </VBtn>
                  <VDivider vertical class="mx-1" />
                  <div
                    class="reaction-btn-container"
                    @click.stop="toggleEmojiPicker(msgGrp.message_id)"
                  >
                    <VBtn
                      icon
                      size="32"
                      variant="text"
                      class="reaction-btn reaction-btn-emoji"
                      tabindex="-1"
                    >
                      <VIcon size="20">tabler-plus</VIcon>
                    </VBtn>
                  </div>
                </div>
                <div
                  v-if="showEmojiPicker === msgGrp.message_id"
                  class="reaction-picker-full"
                >
                  <Picker
                    :data="reactionEmojiIndex"
                    :per-line="8"
                    :show-preview="false"
                    :show-skin-tones="false"
                    :show-search="true"
                    @select="onSelectReactionEmoji(msgGrp, $event)"
                  />
                </div>
              </div>

              <div
                :class="[
                  'message-meta',
                  {
                    'message-meta--audio':
                      msgGrp.content?.type === EMessageType.audio &&
                      msgGrp.content?.audio?.url,
                  },
                ]"
              >
                <span
                  v-if="
                    msgGrp.content?.type === EMessageType.audio &&
                    msgGrp.content?.audio?.url
                  "
                  class="message-audio-duration"
                >
                  {{
                    getDisplayTime(
                      msgGrp.message_id,
                      msgGrp.content.audio.duration
                    )
                  }}
                </span>
                <span class="message-time">
                  {{
                    formatDate(msgGrp.date, {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })
                  }}
                </span>
                <VIcon size="16" :color="resolveFeedbackIcon(msgGrp).color">
                  {{ resolveFeedbackIcon(msgGrp).icon }}
                </VIcon>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <VDialog
    v-model="viewerOpen"
    fullscreen
    scrim="rgba(0,0,0,.9)"
    :scrollable="false"
  >
    <div class="viewer-wrap" @click="viewerOpen = false">
      <div class="viewer-box" @click.stop>
        <div class="viewer-media-container">
          <img
            v-if="viewerKind === 'image'"
            :src="viewerSrc"
            alt=""
            class="viewer-img"
            loading="eager"
            decoding="async"
          />
          <video
            v-if="viewerKind === 'video'"
            :src="viewerSrc"
            class="viewer-video"
            controls
            playsinline
          >
            <track kind="captions" />
          </video>

          <div class="viewer-actions">
            <VBtn
              v-if="viewerSrc"
              class="viewer-download"
              icon
              size="36"
              variant="text"
              @click.stop="downloadViewerMedia"
            >
              <VIcon size="20">tabler-download</VIcon>
            </VBtn>
            <VBtn
              class="viewer-close"
              icon
              size="36"
              variant="text"
              @click="viewerOpen = false"
            >
              <VIcon size="20">tabler-x</VIcon>
            </VBtn>
          </div>
        </div>

        <div v-if="viewerCaption" class="viewer-caption">
          {{ viewerCaption }}
        </div>
      </div>
    </div>
  </VDialog>
</template>

<style lang="scss">
.chat-log {
  .chat-body {
    max-inline-size: calc(100% - 6.75rem);
    .chat-content-wrapper {
      position: relative;
      display: inline-flex;
    }

    .message-text {
      white-space: pre-line;
    }

    .chat-content {
      position: relative;
      border-end-end-radius: 6px;
      border-end-start-radius: 6px;
      padding-right: 1.8rem !important;
      padding-bottom: 1.4rem !important;

      p {
        overflow-wrap: anywhere;
      }

      &.chat-left {
        border-start-end-radius: 6px;
        .message-meta {
          color: rgba(var(--v-theme-on-surface), 0.6);
        }
      }

      &.chat-right {
        border-start-start-radius: 6px;
        .message-meta {
          color: rgba(17, 27, 33, 0.6);
        }
      }

      &.is-deleted {
        opacity: 0.7;
      }

      &.is-deleted .message-text,
      &.is-deleted .image-caption {
        text-decoration: line-through;
      }

      &.is-deleted .link-preview,
      &.is-deleted .quoted-block {
        pointer-events: none;
        cursor: default;
        opacity: 0.75;
      }

      &.is-deleted a {
        pointer-events: none;
        cursor: default;
      }

      .message-actions {
        position: absolute;
        top: 2px;
        right: 1px !important;
        inset-inline-end: 6px;
        opacity: 0;
        visibility: hidden;
        z-index: 2;
        transition: opacity 0.15s ease;

        .v-btn {
          width: 28px !important;
          height: 28px !important;
          min-width: 28px !important;
        }
      }

      &:hover .message-actions {
        opacity: 1;
        visibility: visible;
      }

      &.has-actions {
        padding-inline-end: 36px;
      }

      .quoted-block {
        display: flex;
        flex-direction: column;
        gap: 6px;
        background: rgba(var(--v-theme-primary), 0.08);
        border-inline-start: 3px solid rgb(var(--v-theme-primary));
        border-radius: 8px;
        padding: 8px 10px;
        margin-bottom: 6px;
      }

      .quoted-block.is-clickable {
        cursor: pointer;
      }

      .quoted-content {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .quoted-media {
        inline-size: 44px;
        block-size: 44px;
        border-radius: 6px;
        overflow: hidden;
        flex-shrink: 0;

        .v-img {
          inline-size: 100%;
          block-size: 100%;
        }
      }

      .quoted-media--image {
        position: relative;
        background: rgba(var(--v-theme-primary), 0.12);

        .v-img {
          inline-size: 100%;
          block-size: 100%;
        }
      }

      .quoted-media--video {
        position: relative;
        background: rgba(var(--v-theme-primary), 0.12);

        video {
          inline-size: 100%;
          block-size: 100%;
          object-fit: cover;
          border-radius: 6px;
        }

        .quoted-video-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;

          .v-icon {
            color: #fff;
            background: rgba(0, 0, 0, 0.45);
            border-radius: 999px;
            padding: 4px;
          }
        }

        .quoted-video-placeholder {
          inline-size: 100%;
          block-size: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: rgb(var(--v-theme-primary));
          background: rgba(var(--v-theme-primary), 0.15);
        }
      }

      .quoted-image-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .quoted-image-name {
        font-size: 0.8rem;
        font-weight: 600;
        color: rgb(var(--v-theme-primary));
      }

      .quoted-image-meta {
        font-size: 0.7rem;
        color: rgba(var(--v-theme-on-surface), 0.6);
      }

      .quoted-video-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .quoted-video-name {
        font-size: 0.8rem;
        font-weight: 600;
        color: rgb(var(--v-theme-primary));
      }

      .quoted-video-meta {
        font-size: 0.7rem;
        color: rgba(var(--v-theme-on-surface), 0.6);
      }

      .quoted-audio {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .quoted-audio-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .quoted-audio-name {
        font-size: 0.8rem;
        font-weight: 600;
        color: rgb(var(--v-theme-primary));
        max-width: 180px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .quoted-audio-meta {
        font-size: 0.7rem;
        color: rgba(var(--v-theme-on-surface), 0.6);
      }

      .quoted-document {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        background: rgba(var(--v-theme-primary), 0.12);
        padding: 6px 10px;
        border-radius: 6px;
        flex-shrink: 0;
      }

      .quoted-document-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .quoted-document-name {
        font-size: 0.8rem;
        font-weight: 600;
        color: rgb(var(--v-theme-primary));
      }

      .quoted-document-meta {
        font-size: 0.7rem;
        color: rgba(var(--v-theme-on-surface), 0.6);
      }

      .quoted-body {
        min-inline-size: 0;
        flex: 1;
      }

      .quoted-name {
        color: rgb(var(--v-theme-primary));
        font-weight: 600;
        font-size: 0.85rem;
        margin-bottom: 4px;
        line-height: 1.1;
      }

      .quoted-text {
        font-size: 0.9rem;
        color: rgb(var(--v-theme-on-surface));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .link-preview {
        padding: 10px;
        border-radius: 8px;
        border: 1px solid rgb(var(--v-theme-on-secondary));
        transition: border-color 0.2s ease;

        .lp-thumb img {
          inline-size: 48px;
          block-size: 48px;
          object-fit: cover;
          border-radius: 6px;
          display: block;
        }

        .lp-title {
          font-weight: 600;
          overflow: hidden;
          display: -webkit-box;
          -webkit-box-orient: vertical;
        }

        .lp-desc {
          opacity: 0.8;
          overflow: hidden;
          display: -webkit-box;
          -webkit-box-orient: vertical;
        }

        .lp-url {
          word-break: break-all;
          text-decoration: none;
        }
      }

      .image-bubble {
        max-inline-size: 260px;
        inline-size: 100%;
        cursor: zoom-in;

        .image-thumb {
          border-radius: 8px;
          inline-size: 100%;
          max-inline-size: 260px;
          max-block-size: 360px;
        }

        .image-caption {
          font-size: 0.95rem;
          line-height: 1.25rem;
          white-space: pre-line;
          margin-bottom: 0 !important;
        }

        &.is-deleted {
          cursor: default;
          pointer-events: none;
          filter: grayscale(0.85);
          opacity: 0.6;
        }
      }

      .image-bubble--left .image-thumb {
        border-start-end-radius: 6px;
      }

      .image-bubble--right .image-thumb {
        border-start-start-radius: 6px;
      }

      .video-bubble {
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-inline-size: 260px;
        inline-size: 100%;
        cursor: pointer;
        border-radius: 10px;
        background: rgba(var(--v-theme-on-surface), 0.04);
        padding: 10px;
      }

      .video-bubble--left {
        border-start-end-radius: 6px;
      }

      .video-bubble--right {
        border-start-start-radius: 6px;
      }

      .video-bubble.is-deleted {
        pointer-events: none;
        opacity: 0.7;
      }

      .audio-bubble {
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-inline-size: 380px;
        inline-size: 100%;
        position: relative;
      }

      .audio-bubble--left {
        border-start-end-radius: 6px;
      }

      .audio-bubble--right {
        border-start-start-radius: 6px;
      }

      .audio-bubble.is-deleted {
        pointer-events: none;
        opacity: 0.7;
      }

      .audio-player-container {
        display: flex;
        align-items: center;
        gap: 12px;
        inline-size: 100%;
        padding: 8px 14px;
        border-radius: 20px;
      }

      .audio-play-btn {
        flex-shrink: 0;
        min-width: 36px;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.95);
        border: 2px solid rgb(var(--v-theme-primary));
        color: rgb(var(--v-theme-primary));
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

        :deep(.v-icon) {
          color: rgb(var(--v-theme-primary));
          font-size: 18px;
        }
      }

      .audio-bubble--right .audio-play-btn {
        background: rgba(255, 255, 255, 0.95);
        border: 2px solid rgba(255, 255, 255, 0.8);
        color: rgb(var(--v-theme-primary));
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);

        :deep(.v-icon) {
          color: rgb(var(--v-theme-primary));
          font-size: 18px;
        }
      }

      .audio-waveform-container {
        position: relative;
        flex: 1 1 auto;
        height: 36px;
        display: flex;
        align-items: center;
        overflow: hidden;
        min-width: 100px;
      }

      .audio-waveform {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 3px;
        padding: 6px 0;
        z-index: 1;
        height: 100%;
        width: 100%;
      }

      .audio-waveform-placeholder {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 3px;
        padding: 6px 0;
      }

      .audio-waveform-bar-placeholder {
        flex: 1;
        min-width: 3px;
        max-width: 4px;
        height: 20%;
        background: rgba(var(--v-theme-on-surface), 0.2);
        border-radius: 2px;
        animation: pulse 1.5s ease-in-out infinite;
      }

      .audio-bubble--right .audio-waveform-bar-placeholder {
        background: rgba(17, 27, 33, 0.35);
      }

      @keyframes pulse {
        0%,
        100% {
          opacity: 0.3;
        }
        50% {
          opacity: 0.6;
        }
      }

      .audio-waveform-bar {
        flex: 1 1 0;
        min-width: 3px;
        max-width: 4px;
        min-height: 4px;
        background: rgba(var(--v-theme-on-surface), 0.4);
        border-radius: 2px;
        transition:
          background 0.2s ease,
          height 0.1s ease;
      }

      .audio-bubble--right .audio-waveform-bar {
        background: rgba(17, 27, 33, 0.45);
      }

      .audio-waveform-bar--active {
        background: rgb(var(--v-theme-primary));
      }

      .audio-bubble--right .audio-waveform-bar--active {
        background: rgba(17, 27, 33, 0.9);
      }

      .audio-progress-indicator {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 2px;
        background: rgb(var(--v-theme-primary));
        transform: translateX(-50%);
        z-index: 1;
        border-radius: 1px;
      }

      .audio-bubble--right .audio-progress-indicator {
        background: rgba(17, 27, 33, 0.85);
      }

      .audio-caption {
        font-size: 0.95rem;
        line-height: 1.25rem;
        white-space: pre-line;
        margin-bottom: 0 !important;
        margin-top: 8px;
      }

      .video-thumb-wrapper {
        position: relative;
        inline-size: 100%;
        block-size: 160px;
        border-radius: 8px;
        overflow: hidden;
        background: #000;
      }

      .video-thumb {
        inline-size: 100%;
        block-size: 100%;
        object-fit: cover;
        display: block;
      }

      .video-play-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: rgba(255, 255, 255, 0.95);
        background: rgba(0, 0, 0, 0.3);
        pointer-events: none;
        z-index: 1;
        transition: background 0.3s ease;
      }

      .video-bubble:hover .video-play-overlay {
        background: rgba(0, 0, 0, 0.4);
      }

      .video-play-overlay .v-icon {
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
        transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        transform: scale(1);
      }

      .video-bubble:hover .video-play-overlay .v-icon {
        transform: scale(1.2);
      }

      .video-details {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .video-name {
        font-weight: 600;
        color: rgb(var(--v-theme-primary));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .video-meta {
        color: rgba(var(--v-theme-on-surface), 0.65);
      }

      .video-caption {
        font-size: 0.95rem;
        line-height: 1.25rem;
        white-space: pre-line;
        margin-bottom: 0 !important;
      }

      .document-bubble {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        border-radius: 10px;
        background: rgba(var(--v-theme-on-surface), 0.04);
        margin-bottom: 6px;
      }

      .document-bubble--left {
        border-start-end-radius: 6px;
      }

      .document-bubble--right {
        border-start-start-radius: 6px;
      }

      .document-bubble.is-deleted {
        pointer-events: none;
        opacity: 0.7;
      }

      .document-icon {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        inline-size: 40px;
        block-size: 40px;
        border-radius: 50%;
        background: rgba(var(--v-theme-primary), 0.12);
      }

      .document-details {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-inline-size: 0;
      }

      .document-name {
        font-weight: 600;
        color: rgb(var(--v-theme-primary));
        text-decoration: none;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .document-meta {
        white-space: nowrap;
      }

      .document-download {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: 34px;
        block-size: 34px;
        border-radius: 50%;
        background: rgba(var(--v-theme-primary), 0.1);
        color: rgb(var(--v-theme-primary));
        text-decoration: none;
        transition: background-color 0.2s ease;
      }

      .document-download:hover {
        background: rgba(var(--v-theme-primary), 0.18);
      }

      .pending-content {
        min-inline-size: 280px;
        max-inline-size: min(100%, 360px);
      }

      .pending-document {
        position: relative;
        padding-inline-end: 12px;
      }

      .pending-actions {
        margin-inline-start: auto;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .pending-progress {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .pending-progress-label {
        font-size: 0.72rem;
        font-weight: 600;
        color: rgb(var(--v-theme-primary));
      }

      .pending-error {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .pending-dismiss {
        min-width: 28px !important;
        width: 28px !important;
        height: 28px !important;
      }

      .pending-image-wrapper {
        position: relative;
        inline-size: clamp(160px, 40vw, 220px);
        block-size: clamp(160px, 40vw, 220px);
        border-radius: 12px;
        overflow: hidden;
        display: flex;
      }

      .pending-video-wrapper {
        position: relative;
        inline-size: clamp(180px, 45vw, 260px);
        block-size: clamp(160px, 40vw, 220px);
        border-radius: 12px;
        overflow: hidden;
        background: #000;
      }

      .pending-video-thumb {
        inline-size: 100%;
        block-size: 100%;
        object-fit: cover;
        display: block;
      }

      .pending-video-overlay,
      .pending-video-error {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.25);
      }

      .pending-video-error {
        background: rgba(0, 0, 0, 0.35);
      }

      .pending-video-dismiss {
        position: absolute;
        inset-block-start: 6px;
        inset-inline-end: 6px;
        min-width: 28px !important;
        width: 28px !important;
        height: 28px !important;
        background: rgba(0, 0, 0, 0.35) !important;
        color: rgb(var(--v-theme-on-primary)) !important;
      }

      .pending-video-meta {
        color: rgba(var(--v-theme-on-surface), 0.6);
      }

      .pending-audio-wrapper {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 8px;
        inline-size: clamp(200px, 45vw, 260px);
        border-radius: 12px;
        padding: 16px;
        background: rgba(var(--v-theme-on-surface), 0.04);
      }

      .pending-audio-player {
        inline-size: 100%;
      }

      .pending-audio-overlay,
      .pending-audio-error {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 12px;
      }

      .pending-audio-overlay {
        background: rgba(0, 0, 0, 0.25);
        pointer-events: none;
      }

      .pending-audio-error {
        background: rgba(0, 0, 0, 0.2);
      }

      .pending-audio-dismiss {
        position: absolute;
        inset-block-start: 6px;
        inset-inline-end: 6px;
        min-width: 28px !important;
        width: 28px !important;
        height: 28px !important;
        background: rgba(0, 0, 0, 0.35) !important;
        color: rgb(var(--v-theme-on-primary)) !important;
      }

      .pending-audio-meta {
        color: rgba(var(--v-theme-on-surface), 0.6);
      }

      .pending-image-thumb {
        inline-size: 100%;
        block-size: 100%;
      }

      .pending-image-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.3);
      }

      .pending-image-error {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.15);
      }

      .pending-image-dismiss {
        position: absolute;
        inset-block-start: 6px;
        inset-inline-end: 6px;
        min-width: 28px !important;
        width: 28px !important;
        height: 28px !important;
        background: rgba(0, 0, 0, 0.35) !important;
        color: rgb(var(--v-theme-on-primary)) !important;
      }

      .pending-image-meta {
        color: rgba(var(--v-theme-on-surface), 0.6);
      }

      .pending-caption {
        color: rgba(var(--v-theme-on-surface), 0.75);
        margin: 0;
      }

      .pending-status {
        margin-top: 6px;
        color: rgba(var(--v-theme-on-surface), 0.6);
      }

      .pending-status--error {
        color: rgb(var(--v-theme-error));
        font-weight: 600;
      }

      .deleted-label-wrapper {
        display: flex;
        justify-content: flex-end;
        padding-inline-end: 32px;
        margin-top: 6px;
        margin-bottom: 18px;
      }

      .deleted-label {
        font-style: italic;
        font-size: 0.75rem;
        margin: 0;
      }
    }
  }

  .reaction-trigger-container {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 12;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    cursor: pointer;

    &:hover .reaction-trigger-btn {
      transform: scale(1.08);
    }

    * {
      pointer-events: none;
    }
  }

  .reaction-trigger-btn {
    min-width: 28px !important;
    height: 28px !important;
    border-radius: 999px;
    background: #fff !important;
    border: 1px solid rgba(0, 0, 0, 0.08) !important;
    box-shadow:
      0 4px 10px rgba(15, 15, 15, 0.12),
      0 2px 4px rgba(15, 15, 15, 0.08);
    color: #1f1f1f !important;
    pointer-events: none;
    transition: transform 0.2s ease;

    .v-btn__content {
      width: 100%;
      height: 100%;
    }

    .v-icon {
      font-size: 20px !important;
    }
  }

  .reaction-picker {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 11;
    background: rgb(var(--v-theme-surface));
    border-radius: 24px;
    padding: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);

    .reaction-picker-content {
      .reaction-btn-container {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        cursor: pointer;
        transition: transform 0.2s;
        margin: -4px;

        &:hover {
          transform: scale(1.1);
        }

        * {
          pointer-events: none !important;
        }
      }

      .reaction-btn {
        min-width: 36px;
        height: 36px;
        border-radius: 50%;
        transition: transform 0.2s;

        &:hover {
          transform: scale(1.1);
        }
      }
    }
  }

  .retry-trigger-container {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 12;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    cursor: pointer;

    &:hover .retry-trigger-btn {
      transform: scale(1.08);
    }

    * {
      pointer-events: none;
    }
  }

  .retry-trigger-btn {
    min-width: 28px !important;
    height: 28px !important;
    border-radius: 999px;
    background: #fff !important;
    border: 1px solid rgba(0, 0, 0, 0.08) !important;
    box-shadow:
      0 4px 10px rgba(15, 15, 15, 0.12),
      0 2px 4px rgba(15, 15, 15, 0.08);
    color: rgb(var(--v-theme-error)) !important;
    pointer-events: none;
    transition: transform 0.2s ease;

    .v-btn__content {
      width: 100%;
      height: 100%;
    }

    .v-icon {
      font-size: 20px !important;
    }
  }

  .wrapper-operator {
    .reaction-trigger-container {
      right: calc(100% + 4px);
    }

    .retry-trigger-container {
      right: calc(100% + 4px);
    }

    .reaction-picker {
      right: calc(100% + 4px);
    }
  }

  .wrapper-client {
    .reaction-trigger-container {
      left: calc(100% + 4px);
    }

    .retry-trigger-container {
      left: calc(100% + 4px);
    }

    .reaction-picker {
      left: calc(100% + 4px);
    }
  }

  :global(.v-theme--dark) & {
    .reaction-trigger-container {
      width: 34px;
      height: 34px;
    }

    .reaction-trigger-btn {
      background: rgba(255, 255, 255, 0.14) !important;
      border: 1px solid rgba(255, 255, 255, 0.22) !important;
      box-shadow:
        0 6px 16px rgba(0, 0, 0, 0.5),
        0 2px 6px rgba(0, 0, 0, 0.35);
      color: rgba(var(--v-theme-on-surface), 0.92) !important;
    }

    .retry-trigger-container {
      width: 34px;
      height: 34px;
    }

    .retry-trigger-btn {
      background: rgba(255, 255, 255, 0.14) !important;
      border: 1px solid rgba(255, 255, 255, 0.22) !important;
      box-shadow:
        0 6px 16px rgba(0, 0, 0, 0.5),
        0 2px 6px rgba(0, 0, 0, 0.35);
    }
  }

  .reaction-picker-operator {
    right: calc(100% + 4px);
  }

  .reaction-picker-client {
    left: calc(100% + 4px);
  }

  .reactions-summary {
    position: absolute;
    display: inline-flex;
    gap: 4px;
    bottom: -2px;
    transform: translateY(60%);
    margin-inline-start: auto;

    &--right {
      justify-content: flex-end;
      right: 16px;
    }

    &--left {
      justify-content: flex-start;
      margin-inline-start: 0;
      left: 16px;
    }

    .reaction-summary-bubble {
      display: inline-flex;
      align-items: center;
      background: rgb(var(--v-theme-surface));
      border-radius: 999px;
      padding: 2px 8px;
      min-height: 22px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
      border: 0.5px solid rgba(var(--v-theme-on-surface), 0.08);
      gap: 8px;
    }

    .reaction-summary-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .reaction-summary-emoji {
      font-size: 0.9rem;
      line-height: 1;
    }

    .reaction-summary-count {
      font-size: 0.7rem;
      font-weight: 600;
      color: rgba(var(--v-theme-on-surface), 0.7);
    }
  }

  .message-meta {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 6px;
    display: flex;
    align-items: center;
    gap: 4px;
    justify-content: flex-end;
    padding-inline: 16px 12px;
    font-size: 0.75rem;

    .v-icon {
      font-size: 0.95rem;
    }

    .message-time {
      line-height: 1;
    }

    .message-audio-duration {
      margin-right: auto;
      font-weight: 500;
    }
  }

  .message-meta--audio {
    padding-inline-start: 70px;
  }
}

.viewer-wrap {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: transparent;
  padding: 16px;
  overflow: hidden;
}

.viewer-box {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  max-width: 90vw;
  max-height: 90vh;
}

.viewer-media-container {
  position: relative;
  display: inline-block;
  max-width: 100%;
  max-height: 100%;
}

.viewer-img {
  display: block;
  width: auto;
  height: auto;
  max-width: 90vw;
  max-height: 85vh;
  object-fit: contain;
  border-radius: 12px;
}

.viewer-video {
  display: block;
  max-width: 90vw;
  max-height: 85vh;
  border-radius: 12px;
  background: #000;
}

.viewer-actions {
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 10;
}

.viewer-close,
.viewer-download {
  color: white !important;
  background: rgba(0, 0, 0, 0.5) !important;
  border-radius: 50%;
  min-width: 36px;
  height: 36px;

  &:hover {
    background: rgba(0, 0, 0, 0.7) !important;
  }
}

.viewer-caption {
  color: white;
  text-align: center;
  margin: 12px;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
