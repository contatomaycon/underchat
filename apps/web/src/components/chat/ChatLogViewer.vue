<script lang="ts" setup>
import {
  computed,
  ref,
  reactive,
  onUnmounted,
  watch,
  onErrorCaptured,
} from 'vue';
import { ListMessageResult } from '@core/schema/chat/listMessageChats/response.schema';
import { isTypeUser } from '@core/common/functions/isTypeUser';
import { EMessageType } from '@core/common/enums/EMessageType';
import { formatDate } from '@/@webcore/utils/formatters';
import { useI18n } from 'vue-i18n';
import { MglMap, MglMarker } from 'vue-maplibre-gl';
import { useChatStore } from '@/@webcore/stores/chat';
import { EColor } from '@core/common/enums/EColor';
import GroupContactMessageCard from '@/components/chat/GroupContactMessageCard.vue';
import { CreateContactRequest } from '@core/schema/contact/createContact/request.schema';

interface Props {
  messages: ListMessageResult[];
  clientName?: string;
  operatorName?: string;
  loading?: boolean;
  clientPhoto?: string | null;
}

const props = withDefaults(defineProps<Props>(), {
  clientName: '',
  operatorName: '',
  loading: false,
  clientPhoto: null,
});

const { t } = useI18n();
const chatStore = useChatStore();

const audioPlayers = ref<Map<string, HTMLAudioElement>>(new Map());
const audioPlayStates = reactive<Record<string, boolean>>({});
const audioCurrentTimes = reactive<Record<string, number>>({});
const audioDurations = reactive<Record<string, number>>({});
const audioWaveforms = reactive<Record<string, number[]>>({});

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

const isAudioPlaying = (messageId: string): boolean => {
  return !!audioPlayStates[messageId];
};

const getAudioProgress = (messageId: string): number => {
  const currentTime = normalizeTimeValue(audioCurrentTimes[messageId]) ?? 0;
  const duration = normalizeTimeValue(audioDurations[messageId]) ?? 0;
  if (duration === 0) return 0;
  return (currentTime / duration) * 100;
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

watch(
  () => props.messages,
  (messages) => {
    for (const msg of messages) {
      if (
        msg.content?.type === EMessageType.audio &&
        msg.content?.audio?.url &&
        !audioWaveforms[msg.message_id]
      ) {
        loadAudioWaveform(msg.message_id, msg.content.audio.waveform);
      }
    }
  },
  { deep: true, immediate: true }
);

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

const mapStyle = computed(() => {
  return {
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
  };
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

const webGLSupported = ref(isWebGLSupported());
const mapErrors = reactive<Record<string, boolean>>({});

const handleMapError = (messageId: string) => {
  mapErrors[messageId] = true;
};

onErrorCaptured((err, instance) => {
  if (
    err.message &&
    (err.message.includes('WebGL') ||
      err.message.includes('webglcontextcreationerror') ||
      err.message.includes('Failed to initialize WebGL'))
  ) {
    webGLSupported.value = false;
    if (instance && (instance as any).$props?.key) {
      const messageId = (instance as any).$props.key.replace('map-', '');
      if (messageId) {
        handleMapError(messageId);
      }
    }
    return false;
  }
  return true;
});

const formatWhatsAppText = (text: string): string => {
  if (!text) return '';

  const escapeHtml = (str: string) => {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  };

  let formatted = escapeHtml(text);

  formatted = formatted.replaceAll(/`([^`]+?)`/g, '<code>$1</code>');
  formatted = formatted.replaceAll(/~([^~]+?)~/g, '<s>$1</s>');
  formatted = formatted.replaceAll(/(?<!_)_([^_\n]+?)_(?!_)/g, '<em>$1</em>');
  formatted = formatted.replaceAll(
    /(?<!\*)\*([^*\n]+?)\*(?!\*)/g,
    '<strong>$1</strong>'
  );

  return formatted;
};

const getPinMessageText = (message: ListMessageResult): string | null => {
  if (!message.content?.pin) return null;

  const pin = message.content.pin;
  const hasPinData = pin.pin_action || pin.pin_user_name || pin.pin_user_phone;
  if (!hasPinData) return null;

  const pinAction = pin.pin_action;
  const isUnpin =
    pinAction === '2' || pinAction === 'UNPIN_FOR_ALL' || pinAction === 'UNPIN';

  if (pin.pin_user_name) {
    if (isUnpin) return t('message_unpinned_by_user', { name: pin.pin_user_name });
    return t('message_pinned_by_user', { name: pin.pin_user_name });
  }

  if (pin.pin_user_phone) {
    if (isUnpin)
      return t('message_unpinned_by_phone', { phone: pin.pin_user_phone });
    return t('message_pinned_by_phone', { phone: pin.pin_user_phone });
  }

  if (isUnpin) return t('message_unpinned_default');
  return t('message_pinned_default');
};

const getLatestMessageText = (message: ListMessageResult): string => {
  if (!message.content) return '';

  const versions = message.content.version ?? [];
  if (versions.length > 0) {
    const sortedVersions = [...versions].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    return sortedVersions[0].message || '';
  }

  const hasMessageContent = !!message.content.message?.trim();
  if (message.content.type === EMessageType.system && !hasMessageContent) {
    const pinText = getPinMessageText(message);
    if (pinText) return pinText;
  }

  return message.content.message || '';
};

const hasMessageVersions = (message: ListMessageResult): boolean => {
  return !!(message.content?.version && message.content.version.length > 0);
};

const getMessageEditHistory = (
  message: ListMessageResult
): Array<{
  text: string;
  date: string;
  isOriginal: boolean;
}> => {
  if (!message.content) return [];

  const history: Array<{ text: string; date: string; isOriginal: boolean }> =
    [];

  const versions = message.content.version ?? [];
  const sortedVersions = [...versions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  for (const version of sortedVersions) {
    if (version.message) {
      history.push({
        text: version.message,
        date: version.date,
        isOriginal: false,
      });
    }
  }

  if (message.content.message) {
    history.push({
      text: message.content.message,
      date: message.date,
      isOriginal: true,
    });
  }

  return history;
};

const editHistoryModalOpen = ref(false);
const viewingEditHistory = ref<ListMessageResult | null>(null);

const contactsGroupModalOpen = ref(false);
const contactsGroupData = ref<ListMessageResult | null>(null);
const savingContacts = ref<Set<string>>(new Set());

const onViewEditHistory = (m: ListMessageResult) => {
  if (!hasMessageVersions(m)) return;

  viewingEditHistory.value = m;
  editHistoryModalOpen.value = true;
};

const handleContactsGroupClick = (message: ListMessageResult) => {
  if (!message.content?.contacts || message.content.contacts.length === 0) {
    return;
  }
  contactsGroupData.value = message;
  contactsGroupModalOpen.value = true;
};

const saveContactFromGroup = async (
  contact: {
    contact_id: string | null;
    name: string;
    last_name?: string | null;
    phone?: string | null;
    phone_partial?: string | null;
    phone_ddi?: string | null;
    email?: string | null;
    email_partial?: string | null;
    photo?: string | null;
  }
) => {
  const contactKey = contact.contact_id || `${contact.phone}_${contact.phone_ddi}`;
  if (savingContacts.value.has(contactKey)) return;

  if (contact.contact_id) {
    emit('openContact', contact.contact_id);
    return;
  }

  const phone = contact.phone ?? contact.phone_partial;
  const phoneDdi = contact.phone_ddi ?? '55';

  if (!phone) return;

  savingContacts.value.add(contactKey);

  try {
    const phoneSearch = phone.replaceAll(/\D/g, '');
    const foundContact = await chatStore.getChatContactByPhone(
      phoneSearch,
      phoneDdi
    );

    if (foundContact) {
      savingContacts.value.delete(contactKey);
      emit('openContact', foundContact.contact_id);
      return;
    }

    const createContactData: CreateContactRequest = {
      name: contact.name,
      last_name: contact.last_name ?? null,
      phone: phoneSearch,
      phone_ddi: phoneDdi,
      email: contact.email ?? null,
    };

    globalThis.dispatchEvent(
      new CustomEvent('open-add-contact-modal', {
        detail: createContactData,
      })
    );

    savingContacts.value.delete(contactKey);
  } catch (error) {
    savingContacts.value.delete(contactKey);
    chatStore.showSnackbar(
      t('error_saving_contact') || 'Erro ao salvar contato',
      EColor.error
    );
  }
};

const shouldFormatMessage = (message: ListMessageResult): boolean => {
  const messageType = message.content?.type;
  return (
    messageType === EMessageType.text ||
    messageType === EMessageType.system ||
    messageType === EMessageType.annotation
  );
};

const resolvePhoto = (message: ListMessageResult): string => {
  if (isTypeUser(message)) {
    if (message.content?.contact?.photo) {
      return message.content.contact.photo;
    }
    if (props.clientPhoto) {
      return props.clientPhoto;
    }
    return '/images/svg/avatar-default.svg';
  }
  if (message.user?.photo) return message.user.photo;
  return '/images/svg/avatar-default.svg';
};

const isPhotoExist = (message: ListMessageResult): boolean => {
  const photo = resolvePhoto(message);
  return Boolean(photo && photo !== '/images/svg/avatar-default.svg');
};

const formatDateSeparator = (dateString: string): string => {
  if (!dateString) return '';

  const date = new Date(dateString);
  const now = new Date();

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const messageDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );

  if (messageDate.getTime() === today.getTime()) {
    return t('today');
  }

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (messageDate.getTime() === yesterday.getTime()) {
    return t('yesterday');
  }

  const diffMs = today.getTime() - messageDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 7 && diffDays > 0) {
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

const isSameDay = (date1: string, date2: string): boolean => {
  if (!date1 || !date2) return false;

  const d1 = new Date(date1);
  const d2 = new Date(date2);

  return (
    d1.getDate() === d2.getDate() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getFullYear() === d2.getFullYear()
  );
};

type MessageWithSeparator = {
  type: 'message' | 'separator';
  message?: ListMessageResult;
  separatorDate?: string;
  separatorLabel?: string;
};

const messagesWithSeparators = computed<MessageWithSeparator[]>(() => {
  const messages = props.messages;

  if (messages.length === 0) return [];

  const result: MessageWithSeparator[] = [];
  let lastDate: string | null = null;

  for (const message of messages) {
    const messageDate = message.date;

    if (!lastDate || !isSameDay(messageDate, lastDate)) {
      result.push({
        type: 'separator',
        separatorDate: messageDate,
        separatorLabel: formatDateSeparator(messageDate),
      });
      lastDate = messageDate;
    }

    result.push({
      type: 'message',
      message,
    });
  }

  return result;
});

const resolveQuotedName = (m: ListMessageResult): string => {
  const fromMe = m.content?.quoted?.key?.from_me ?? null;
  if (fromMe === true) return props.operatorName || t('operator');
  if (fromMe === false) return props.clientName || t('client');
  return '';
};

const showQuoted = (m: ListMessageResult) => !!m.content?.quoted;

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

  if (
    m.content.quoted.type === EMessageType.video ||
    m.content.quoted.type === EMessageType.video_note
  ) {
    return m.content.quoted.video?.caption || '';
  }

  if (m.content.quoted.type === EMessageType.audio) {
    return m.content.quoted.message ?? t('audio_label');
  }

  if (m.content.quoted.type === EMessageType.sticker) {
    return t('sticker_label', 'Sticker');
  }

  if (m.content.quoted.type === EMessageType.location) {
    return (
      m.content.quoted.location?.name ||
      m.content.quoted.location?.address ||
      t('location_label', 'Localização')
    );
  }

  return m.content.quoted.message ?? '';
};

const resolveQuotedImageSrc = (m: ListMessageResult): string => {
  const image = m.content?.quoted?.image;
  if (!image) return '';
  return image.url || image.thumbnail || '';
};

const hasQuotedImage = (m: ListMessageResult): boolean => {
  const image = m.content?.quoted?.image;
  if (!image) return false;
  return !!(image.url || image.thumbnail);
};

const hasQuotedVideo = (m: ListMessageResult): boolean =>
  !!m.content?.quoted?.video;

const hasQuotedAudio = (m: ListMessageResult): boolean =>
  !!m.content?.quoted?.audio;

const hasQuotedSticker = (m: ListMessageResult): boolean =>
  !!m.content?.quoted?.sticker;

const hasQuotedLocation = (m: ListMessageResult): boolean =>
  !!(
    m.content?.quoted?.type === EMessageType.location &&
    m.content.quoted.location
  );

const hasQuotedContact = (m: ListMessageResult): boolean => {
  if (!m.content?.quoted) return false;
  
  if (m.content.quoted.type === EMessageType.contact_card && m.content.quoted.contact) {
    return true;
  }
  
  if (m.content.quoted.type === EMessageType.contacts) {
    const quotedContent = m.content.quoted as any;
    if (quotedContent?.contacts && quotedContent.contacts.length > 0) {
      return true;
    }
    return true;
  }
  
  return false;
};

const resolveQuotedContactName = (m: ListMessageResult): string => {
  if (!m.content?.quoted) return '';
  
  if (m.content.quoted.type === EMessageType.contact_card && m.content.quoted.contact) {
    return m.content.quoted.contact.name || '';
  }
  
  if (m.content.quoted.type === EMessageType.contacts) {
    const quotedContent = m.content.quoted as any;
    if (quotedContent?.contacts && quotedContent.contacts.length > 0) {
      const firstContact = quotedContent.contacts[0];
      if (quotedContent.contacts.length === 1) {
        return firstContact.name || '';
      }
      return `${firstContact.name}${
        quotedContent.contacts.length > 1
          ? ` e ${quotedContent.contacts.length - 1}`
          : ''
      }${
        quotedContent.contacts.length > 1
          ? ' outro contato'
          : ''
      }`;
    }
    
    if (m.content.quoted.message) {
      return m.content.quoted.message;
    }
    
    return t('contact_label', 'Contato');
  }
  
  return '';
};

const resolveQuotedContactPhoto = (m: ListMessageResult): string | null => {
  if (!m.content?.quoted) return null;
  
  if (m.content.quoted.type === EMessageType.contact_card && m.content.quoted.contact) {
    return m.content.quoted.contact.photo || null;
  }
  
  return null;
};

const isQuotedContactGroup = (m: ListMessageResult): boolean => {
  if (!m.content?.quoted) return false;
  
  if (m.content.quoted.type === EMessageType.contacts) {
    const quotedContent = m.content.quoted as any;
    if (quotedContent?.contacts && quotedContent.contacts.length > 0) {
      return quotedContent.contacts.length > 1;
    }
    return true;
  }
  
  return false;
};

const hasQuotedDocument = (m: ListMessageResult): boolean => {
  if (!m.content?.quoted) return false;
  return (
    m.content.quoted.type === EMessageType.document &&
    !!m.content.quoted.document
  );
};

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

const documentIconMap: Record<string, string> = {
  pdf: 'tabler-file-type-pdf',
  doc: 'tabler-file-type-doc',
  docx: 'tabler-file-type-doc',
  xls: 'tabler-file-type-xls',
  xlsx: 'tabler-file-type-xls',
  csv: 'tabler-file-type-xls',
  ppt: 'tabler-file-type-ppt',
  pptx: 'tabler-file-type-ppt',
  zip: 'tabler-file-type-zip',
  rar: 'tabler-file-type-zip',
  '7z': 'tabler-file-type-zip',
};

const resolveDocumentIcon = (document?: {
  extension?: string | null;
  mimetype?: string | null;
}): string => {
  if (!document) return 'tabler-file-description';

  const ext = document.extension?.toLowerCase();
  if (ext && documentIconMap[ext]) {
    return documentIconMap[ext];
  }

  const mimetype = document.mimetype ?? '';
  if (mimetype.includes('pdf')) return 'tabler-file-type-pdf';
  if (mimetype.includes('word')) return 'tabler-file-type-doc';
  if (mimetype.includes('sheet') || mimetype.includes('excel'))
    return 'tabler-file-type-xls';
  if (mimetype.includes('presentation')) return 'tabler-file-type-ppt';
  if (mimetype.includes('zip') || mimetype.includes('compressed'))
    return 'tabler-file-type-zip';

  return 'tabler-file-description';
};

const formatDocumentSize = (bytes?: number | null): string => {
  if (!bytes) return '';
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
};

const resolveQuotedDocumentMeta = (m: ListMessageResult): string => {
  const doc = m.content?.quoted?.document;
  if (!doc) return '';
  const ext = doc.extension ? doc.extension.toUpperCase() : 'FILE';
  if (!doc.size) return ext;
  return `${ext} • ${formatDocumentSize(doc.size)}`;
};

const resolveDocumentMeta = (document?: {
  extension?: string | null;
  size?: number | null;
}): string => {
  if (!document) return '';
  const ext = document.extension ? document.extension.toUpperCase() : 'FILE';
  if (!document.size) return ext;
  return `${ext} • ${formatDocumentSize(document.size)}`;
};

const truncateDocumentName = (name?: string | null): string => {
  if (!name) return t('document_label');
  if (name.length <= 30) return name;
  return `${name.substring(0, 27)}...`;
};

const documentDownloadName = (document?: {
  name?: string | null;
  extension?: string | null;
  mimetype?: string | null;
}): string => {
  if (!document) return 'document';
  if (document.name) return document.name;
  const ext = document.extension || 'file';
  return `document.${ext}`;
};

const formatVideoDuration = (duration?: number | null): string => {
  if (!duration || duration <= 0) return '';
  const totalSeconds = Math.floor(duration);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const resolveVideoMeta = (video?: {
  extension?: string | null;
  size?: number | null;
  duration?: number | null;
}): string => {
  if (!video) return '';
  const parts: string[] = [];

  if (video.extension) {
    parts.push(video.extension.toUpperCase());
  }

  if (video.size) {
    parts.push(formatDocumentSize(video.size));
  }

  if (video.duration) {
    parts.push(formatVideoDuration(video.duration));
  }

  return parts.join(' • ');
};

const resolveVideoNoteMeta = (video?: {
  duration?: number | null;
}): string => {
  if (!video) return '';
  const duration = formatVideoDuration(video.duration);
  if (duration) return duration;
  return resolveVideoMeta(video);
};

const isVideoNoteMessage = (message: ListMessageResult): boolean => {
  const type = message.content?.type;
  if (type === EMessageType.video_note) return true;
  if (type !== EMessageType.video) return false;

  const video = message.content?.video;
  if (!video) return false;

  const width = video.width ?? null;
  if (!width) return false;

  const height = video.height ?? null;
  if (!height) return false;

  if (width !== height) return false;

  const duration = video.duration ?? null;
  if (!duration) return false;
  if (duration > 60) return false;

  return true;
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
  if (m.content?.quoted?.type === EMessageType.video_note) {
    return t('video_note_label');
  }
  return t('video_label');
};

const resolveQuotedVideoUrl = (m: ListMessageResult): string => {
  return m.content?.quoted?.video?.url ?? '';
};

const resolveQuotedVideoPoster = (m: ListMessageResult): string => {
  return m.content?.quoted?.video?.thumbnail ?? '';
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

const resolveQuotedStickerSrc = (m: ListMessageResult): string => {
  return m.content?.quoted?.sticker?.url || '';
};

const resolvePreviewImage = (linkPreview?: {
  jpegThumbnail?: string | null;
  highQualityThumbnail?: string | null;
  originalThumbnailUrl?: string | null;
}): string => {
  return (
    linkPreview?.originalThumbnailUrl ||
    linkPreview?.highQualityThumbnail ||
    linkPreview?.jpegThumbnail ||
    ''
  );
};

const resolvePreviewUrl = (linkPreview?: {
  'canonical-url'?: string | null;
  'matched-text'?: string | null;
}): string => {
  return linkPreview?.['canonical-url'] || linkPreview?.['matched-text'] || '';
};

const domainFromUrl = (url: string): string => {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return url;
  }
};

interface IReaction {
  emoji?: string | null;
}

type FeedbackIcon = { icon: string; color?: string };

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

const resolveFeedbackIcon = (message: ListMessageResult): FeedbackIcon => {
  if (message.content?.type === EMessageType.annotation)
    return { icon: 'tabler-file', color: undefined };

  if (message.summary?.is_sent_to_internal === false)
    return { icon: 'tabler-clock', color: undefined };

  if (isTypeUser(message)) {
    if (message.summary?.is_seen)
      return { icon: 'tabler-checks', color: 'primary' };
    if (message.summary?.is_delivered)
      return { icon: 'tabler-checks', color: undefined };
    if (message.summary?.is_sent)
      return { icon: 'tabler-check', color: undefined };
    return { icon: 'tabler-check', color: undefined };
  }

  if (message.summary?.is_seen)
    return { icon: 'tabler-checks', color: 'primary' };
  if (message.summary?.is_delivered)
    return { icon: 'tabler-checks', color: undefined };
  return { icon: 'tabler-check', color: undefined };
};

const emit = defineEmits<{
  openImage: [src: string, caption?: string];
  openVideo: [src: string, caption?: string];
  openLocation: [
    data: {
      latitude: number;
      longitude: number;
      name?: string | null;
      address?: string | null;
    },
  ];
  openContact: [contactId: string];
}>();

const handleOpenImage = (message: ListMessageResult) => {
  if (message.content?.sticker?.url) {
    emit('openImage', message.content.sticker.url);
    return;
  }
  const imageUrl = message.content?.image?.url || '';
  const caption = message.content?.image?.caption || '';
  emit('openImage', imageUrl, caption);
};

const handleOpenVideo = (message: ListMessageResult) => {
  const video = message.content?.video;
  if (!video?.url) return;
  emit('openVideo', video.url, video.caption || message.content?.message || '');
};

const handleOpenLocation = (message: ListMessageResult) => {
  const location = message.content?.location;
  if (!location?.latitude || !location?.longitude) return;
  emit('openLocation', {
    latitude: location.latitude,
    longitude: location.longitude,
    name: location.name ?? null,
    address: location.address ?? null,
  });
};

const handleContactClick = (message: ListMessageResult) => {
  if (!message.content?.contact?.contact_id) return;
  emit('openContact', message.content.contact.contact_id);
};
</script>

<template>
  <div class="chat-log-viewer" style="min-height: 100%">
    <div
      v-if="loading"
      class="d-flex justify-center align-center"
      style="height: 100%; min-height: 500px"
    >
      <VProgressCircular indeterminate color="primary" size="64" width="4" />
    </div>

    <div
      v-else-if="messages.length === 0"
      class="d-flex justify-center align-center"
      style="height: 100%"
    >
      <div class="text-body-1 text-medium-emphasis">
        {{ t('no_messages_found') }}
      </div>
    </div>

    <div v-else class="d-flex flex-column">
      <template
        v-for="(item, index) in messagesWithSeparators"
        :key="
          item.type === 'separator'
            ? `separator-${item.separatorDate}`
            : `msg-${item.message?.message_id}`
        "
      >
        <div
          v-if="item.type === 'separator'"
          class="d-flex justify-center align-center my-4 date-separator-wrapper"
          style="width: 100%; gap: 8px"
        >
          <div
            class="date-separator-line"
            style="
              flex: 0.25;
              height: 1px;
              background-color: rgba(var(--v-theme-on-surface), 0.12);
            "
          ></div>
          <div
            class="date-separator"
            style="
              font-size: 0.75rem;
              font-weight: 500;
              background-color: rgba(var(--v-theme-on-surface), 0.12);
              color: rgba(var(--v-theme-on-surface), 0.65);
              padding: 4px 12px;
              border-radius: 7.5px;
              display: inline-block;
              min-width: fit-content;
              white-space: nowrap;
            "
          >
            {{ item.separatorLabel }}
          </div>
          <div
            class="date-separator-line"
            style="
              flex: 0.25;
              height: 1px;
              background-color: rgba(var(--v-theme-on-surface), 0.12);
            "
          ></div>
        </div>
        <div
          v-else-if="item.type === 'message' && item.message"
          :id="`msg-${item.message.message_id}`"
          class="chat-group d-flex align-start position-relative"
          :class="[
            {
              'flex-row-reverse':
                !isTypeUser(item.message) &&
                item.message.content?.type !== EMessageType.system,
              'justify-center':
                item.message.content?.type === EMessageType.system,
              'mb-6':
                index < messagesWithSeparators.length - 1 &&
                messagesWithSeparators[index + 1]?.type === 'message',
            },
          ]"
        >
          <div
            v-if="item.message.content?.type !== EMessageType.system"
            class="chat-avatar"
            :class="!isTypeUser(item.message) ? 'ms-4' : 'me-4'"
          >
            <VTooltip
              v-if="!isTypeUser(item.message) && item.message.user?.name"
              location="top"
              :text="item.message.user.name"
            >
              <template #activator="{ props }">
                <VAvatar
                  v-bind="props"
                  size="32"
                  :variant="!isPhotoExist(item.message) ? 'tonal' : undefined"
                >
                  <VImg :src="resolvePhoto(item.message)" />
                </VAvatar>
              </template>
            </VTooltip>
            <VAvatar
              v-else
              size="32"
              :variant="!isPhotoExist(item.message) ? 'tonal' : undefined"
            >
              <VImg :src="resolvePhoto(item.message)" />
            </VAvatar>
          </div>

          <div
            class="chat-body d-inline-flex flex-column position-relative"
            :class="
              item.message.content?.type === EMessageType.system
                ? 'align-center'
                : !isTypeUser(item.message)
                  ? 'align-end'
                  : 'align-start'
            "
          >
            <div
              class="chat-content-wrapper"
              :class="
                !isTypeUser(item.message)
                  ? 'wrapper-operator'
                  : 'wrapper-client'
              "
            >
              <div
                class="chat-content py-2 px-2 elevation-2"
                :class="[
                  item.message.content?.type === EMessageType.system
                    ? 'chat-center'
                    : isTypeUser(item.message)
                      ? 'chat-left'
                      : 'chat-right',
                  {
                    'is-deleted': item.message.deleted,
                    'has-actions': !item.message.deleted,
                    'has-contact-card':
                      item.message.content?.type === EMessageType.contact_card ||
                      item.message.content?.type === EMessageType.contacts,
                    'has-reactions':
                      item.message.content?.reactions &&
                      item.message.content.reactions.length > 0 &&
                      item.message.content?.type !== EMessageType.annotation,
                    'has-edit-history':
                      hasMessageVersions(item.message) && !item.message.deleted,
                  },
                ]"
                @click.stop="
                  hasMessageVersions(item.message) && !item.message.deleted
                    ? onViewEditHistory(item.message)
                    : null
                "
                :style="{
                  backgroundColor:
                    item.message.content?.type === EMessageType.annotation
                      ? 'rgb(255, 243, 205)'
                      : item.message.content?.type === EMessageType.system
                        ? 'rgb(227, 242, 253)'
                        : isTypeUser(item.message)
                          ? 'rgb(var(--v-theme-surface))'
                          : 'rgb(217, 253, 211)',
                }"
              >
                <div class="message-block">
                  <div
                    v-if="item.message.content?.context_info?.is_forwarded"
                    class="forwarded-indicator"
                    :class="{
                      'forwarded-indicator--left': isTypeUser(item.message),
                      'forwarded-indicator--right': !isTypeUser(item.message),
                    }"
                  >
                    <VIcon size="14" class="forwarded-icon">
                      tabler-corner-up-right
                    </VIcon>
                    <span class="forwarded-text">{{ t('forwarded') }}</span>
                  </div>
                  <div
                    v-if="showQuoted(item.message)"
                    class="quoted-block"
                    :class="{
                      'is-right': !isTypeUser(item.message),
                      'is-clickable': !item.message.deleted,
                    }"
                  >
                    <div class="quoted-name">
                      {{ resolveQuotedName(item.message) }}
                    </div>

                    <div class="quoted-content">
                      <div
                        v-if="hasQuotedImage(item.message)"
                        class="quoted-media quoted-media--image"
                      >
                        <VImg
                          :src="resolveQuotedImageSrc(item.message)"
                          width="44"
                          height="44"
                          cover
                        />
                      </div>

                      <div
                        v-if="hasQuotedLocation(item.message)"
                        class="quoted-location"
                      >
                        <VIcon size="22" color="primary">tabler-map-pin</VIcon>
                        <div class="quoted-location-info">
                          <span class="quoted-location-name">
                            {{ t('location_label') }}
                          </span>
                        </div>
                      </div>

                      <div
                        v-if="hasQuotedDocument(item.message)"
                        class="quoted-document"
                      >
                        <VIcon
                          :icon="resolveQuotedDocumentIcon(item.message)"
                          size="26"
                          color="primary"
                        />
                        <div class="quoted-document-info">
                          <span class="quoted-document-name">
                            {{ resolveQuotedDocumentName(item.message) }}
                          </span>
                          <span class="quoted-document-meta">
                            {{ resolveQuotedDocumentMeta(item.message) }}
                          </span>
                        </div>
                      </div>

                      <div
                        v-if="hasQuotedSticker(item.message)"
                        class="quoted-sticker"
                      >
                        <div class="quoted-media quoted-media--image">
                          <img
                            :src="resolveQuotedStickerSrc(item.message)"
                            alt="Sticker"
                            style="
                              width: 44px;
                              height: 44px;
                              object-fit: contain;
                            "
                          />
                        </div>
                      </div>

                      <div
                        v-if="hasQuotedVideo(item.message)"
                        class="quoted-media quoted-media--video"
                      >
                        <template v-if="resolveQuotedVideoUrl(item.message)">
                          <video
                            :src="resolveQuotedVideoUrl(item.message)"
                            :poster="
                              resolveQuotedVideoPoster(item.message) ||
                              undefined
                            "
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
                          v-if="!resolveQuotedVideoUrl(item.message)"
                          class="quoted-video-placeholder"
                        >
                          <VIcon size="20">tabler-player-play</VIcon>
                        </div>
                      </div>

                      <div
                        v-if="hasQuotedVideo(item.message)"
                        class="quoted-video-info"
                      >
                        <span class="quoted-video-name">
                          {{ resolveQuotedVideoName(item.message) }}
                        </span>
                        <span
                          v-if="resolveQuotedVideoMeta(item.message)"
                          class="quoted-video-meta"
                        >
                          {{ resolveQuotedVideoMeta(item.message) }}
                        </span>
                      </div>

                      <div
                        v-if="hasQuotedAudio(item.message)"
                        class="quoted-audio"
                      >
                        <VIcon size="22" color="primary"
                          >tabler-microphone</VIcon
                        >
                        <div class="quoted-audio-info">
                          <span class="quoted-audio-name">
                            {{ resolveQuotedAudioName(item.message) }}
                          </span>
                          <span
                            v-if="resolveQuotedAudioMeta(item.message)"
                            class="quoted-audio-meta"
                          >
                            {{ resolveQuotedAudioMeta(item.message) }}
                          </span>
                        </div>
                      </div>

                      <div
                        v-if="hasQuotedContact(item.message)"
                        class="quoted-contact"
                      >
                        <VAvatar
                          v-if="resolveQuotedContactPhoto(item.message)"
                          size="22"
                          class="quoted-contact-avatar"
                        >
                          <VImg
                            :src="resolveQuotedContactPhoto(item.message) || ''"
                            :alt="resolveQuotedContactName(item.message)"
                          />
                        </VAvatar>
                        <div
                          v-else-if="isQuotedContactGroup(item.message)"
                          class="quoted-contact-group-icon"
                        >
                          <svg
                            width="22"
                            height="22"
                            viewBox="0 0 24 24"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d="M16 11c1.66 0 3-1.34 3-3S17.66 5 16 5s-3 1.34-3 3s1.34 3 3 3Zm-8 0c1.66 0 3-1.34 3-3S9.66 5 8 5S5 6.34 5 8s1.34 3 3 3Zm0 2c-2.33 0-7 1.17-7 3.5V20h14v-3.5C15 14.17 10.33 13 8 13Zm8 0c-.29 0-.62.02-.97.05c1.16.84 1.97 1.96 1.97 3.45V20h7v-3.5c0-2.33-4.67-3.5-7-3.5Z"
                              fill="currentColor"
                            />
                          </svg>
                        </div>
                        <VIcon
                          v-else
                          size="22"
                          color="primary"
                          icon="tabler-user"
                        ></VIcon>
                        <div class="quoted-contact-info">
                          <span class="quoted-contact-name">
                            {{ resolveQuotedContactName(item.message) || t('contact_label') }}
                          </span>
                          <span
                            v-if="item.message.content?.quoted?.message"
                            class="quoted-contact-message"
                            v-html="formatWhatsAppText(item.message.content.quoted.message)"
                          ></span>
                        </div>
                      </div>

                      <div
                        v-if="hasQuotedImage(item.message)"
                        class="quoted-image-info"
                      >
                        <span class="quoted-image-name">
                          {{ resolveQuotedImageName(item.message) }}
                        </span>
                        <span
                          v-if="resolveQuotedImageMeta(item.message)"
                          class="quoted-image-meta"
                        >
                          {{ resolveQuotedImageMeta(item.message) }}
                        </span>
                      </div>

                      <div
                        v-if="
                          resolveQuotedText(item.message) &&
                          item.message.content?.quoted?.type !==
                            EMessageType.video_note &&
                          item.message.content?.quoted?.type !==
                            EMessageType.video &&
                          item.message.content?.quoted?.type !==
                            EMessageType.image &&
                          item.message.content?.quoted?.type !==
                            EMessageType.audio &&
                          item.message.content?.quoted?.type !==
                            EMessageType.sticker &&
                          item.message.content?.quoted?.type !==
                            EMessageType.location &&
                          item.message.content?.quoted?.type !==
                            EMessageType.contact_card &&
                          item.message.content?.quoted?.type !==
                            EMessageType.contacts
                        "
                        class="quoted-text"
                        :style="{
                          color: isTypeUser(item.message)
                            ? 'rgb(var(--v-theme-on-surface))'
                            : 'rgb(var(--v-theme-title))',
                        }"
                      >
                        <span
                          v-if="
                            item.message.content?.quoted?.type ===
                              EMessageType.text ||
                            item.message.content?.quoted?.type ===
                              EMessageType.system ||
                            item.message.content?.quoted?.type ===
                              EMessageType.annotation
                          "
                          v-html="
                            formatWhatsAppText(resolveQuotedText(item.message))
                          "
                        ></span>
                        <span v-else>{{
                          resolveQuotedText(item.message)
                        }}</span>
                      </div>
                    </div>
                  </div>

                  <div
                    v-if="item.message.content?.link_preview?.title"
                    class="link-preview rounded"
                    :class="
                      !isTypeUser(item.message)
                        ? 'link-preview--right'
                        : 'link-preview--left'
                    "
                    :style="{
                      backgroundColor: isTypeUser(item.message)
                        ? 'rgb(var(--v-theme-grey-200))'
                        : 'rgb(214, 243, 207)',
                      color: isTypeUser(item.message)
                        ? 'rgb(var(--v-theme-on-grey))'
                        : 'rgb(var(--v-theme-title))',
                    }"
                  >
                    <div class="lp-main d-flex">
                      <div
                        v-if="
                          resolvePreviewImage(item.message.content.link_preview)
                        "
                      >
                        <div class="lp-thumb me-3">
                          <img
                            :src="
                              resolvePreviewImage(
                                item.message.content.link_preview
                              )
                            "
                            alt=""
                          />
                        </div>
                      </div>

                      <div class="lp-text">
                        <div class="lp-domain text-xs mb-1">
                          {{
                            domainFromUrl(
                              item.message.content.link_preview?.[
                                'canonical-url'
                              ] ||
                                item.message.content.link_preview?.[
                                  'matched-text'
                                ] ||
                                ''
                            )
                          }}
                        </div>

                        <div class="lp-title text-sm mb-1">
                          {{ item.message.content.link_preview.title }}
                        </div>

                        <div class="lp-desc text-xs">
                          {{ item.message.content.link_preview.description }}
                        </div>
                      </div>
                    </div>

                    <a
                      v-if="
                        resolvePreviewUrl(item.message.content.link_preview)
                      "
                      class="lp-url d-block mt-2 text-sm"
                      :href="
                        resolvePreviewUrl(item.message.content.link_preview)
                      "
                      target="_blank"
                      rel="noopener"
                    >
                      {{ resolvePreviewUrl(item.message.content.link_preview) }}
                    </a>
                  </div>

                  <div
                    v-if="item.message.content?.context_info?.external_ad_reply"
                    class="context-info-ad rounded mt-2"
                    :class="
                      !isTypeUser(item.message)
                        ? 'context-info-ad--right'
                        : 'context-info-ad--left'
                    "
                    :style="{
                      backgroundColor: isTypeUser(item.message)
                        ? 'rgb(var(--v-theme-grey-200))'
                        : 'rgb(214, 243, 207)',
                      color: isTypeUser(item.message)
                        ? 'rgb(var(--v-theme-on-grey))'
                        : 'rgb(var(--v-theme-title))',
                    }"
                  >
                    <div class="d-flex">
                      <div
                        v-if="
                          item.message.content.context_info.external_ad_reply
                            .thumbnail_url
                        "
                        class="me-3"
                      >
                        <div class="context-ad-thumb">
                          <img
                            :src="
                              item.message.content.context_info.external_ad_reply
                                .thumbnail_url
                            "
                            alt=""
                            style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px;"
                          />
                        </div>
                      </div>

                      <div class="flex-grow-1">
                        <div
                          v-if="
                            item.message.content.context_info.external_ad_reply
                              .source_app
                          "
                          class="text-xs mb-1 opacity-75"
                        >
                          {{
                            item.message.content.context_info.external_ad_reply
                              .source_app === 'instagram'
                              ? 'Instagram'
                              : item.message.content.context_info
                                  .external_ad_reply.source_app === 'facebook'
                                ? 'Facebook'
                                : item.message.content.context_info
                                    .external_ad_reply.source_app
                          }}
                        </div>

                        <div
                          v-if="
                            item.message.content.context_info.external_ad_reply
                              .title
                          "
                          class="text-sm font-weight-medium mb-1"
                        >
                          {{
                            item.message.content.context_info.external_ad_reply
                              .title
                          }}
                        </div>

                        <div
                          v-if="
                            item.message.content.context_info.external_ad_reply
                              .greeting_message_body
                          "
                          class="text-xs opacity-75"
                        >
                          {{
                            item.message.content.context_info.external_ad_reply
                              .greeting_message_body
                          }}
                        </div>
                      </div>
                    </div>

                    <a
                      v-if="
                        item.message.content.context_info.external_ad_reply
                          .source_url
                      "
                      class="d-block mt-2 text-sm"
                      :href="
                        item.message.content.context_info.external_ad_reply
                          .source_url
                      "
                      target="_blank"
                      rel="noopener"
                      :style="{
                        color: isTypeUser(item.message)
                          ? 'rgb(var(--v-theme-primary))'
                          : 'rgb(var(--v-theme-primary))',
                      }"
                    >
                      {{
                        item.message.content.context_info.external_ad_reply
                          .source_url
                      }}
                    </a>
                  </div>

                  <div
                    v-if="item.message.content?.type === EMessageType.view_once"
                    class="view-once-message"
                  >
                    <VIcon size="20" class="mr-2">tabler-eye-off</VIcon>
                    <p
                      class="mb-0 text-sm"
                      :style="{
                        color: isTypeUser(item.message)
                          ? 'rgb(var(--v-theme-on-surface))'
                          : 'rgb(var(--v-theme-title))',
                      }"
                    >
                      {{ t('view_once_message') }}
                    </p>
                  </div>

                  <div
                    v-if="
                      item.message.content?.type === EMessageType.image &&
                      item.message.content?.image?.url
                    "
                    :class="[
                      'image-bubble',
                      !isTypeUser(item.message)
                        ? 'image-bubble--right'
                        : 'image-bubble--left',
                      { 'is-deleted': item.message.deleted },
                    ]"
                    @click="handleOpenImage(item.message)"
                  >
                    <VImg
                      :src="item.message.content.image.url"
                      :aspect-ratio="
                        item.message.content.image.width &&
                        item.message.content.image.height
                          ? item.message.content.image.width /
                            item.message.content.image.height
                          : undefined
                      "
                      class="image-thumb"
                      width="120"
                      cover
                    />

                    <div
                      v-if="item.message.content.image.caption || item.message.content?.pin"
                      class="d-flex align-center mt-2"
                    >
                      <p
                        v-if="item.message.content.image.caption"
                        class="image-caption mb-0"
                        :class="{
                          'mr-2': item.message.content?.pin,
                        }"
                        :style="{
                          color: isTypeUser(item.message)
                            ? 'rgb(var(--v-theme-on-surface))'
                            : 'rgb(var(--v-theme-title))',
                        }"
                      >
                        <span
                          v-html="
                            formatWhatsAppText(item.message.content.image.caption)
                          "
                        ></span>
                      </p>
                      <VIcon
                        v-if="item.message.content?.pin"
                        size="16"
                        color="grey-600"
                        class="pin-icon"
                      >
                        tabler-pin
                      </VIcon>
                    </div>
                  </div>

                  <div
                    v-if="
                      item.message.content?.type === EMessageType.video &&
                      item.message.content?.video?.url &&
                      !isVideoNoteMessage(item.message)
                    "
                    :class="[
                      'video-bubble',
                      !isTypeUser(item.message)
                        ? 'video-bubble--right'
                        : 'video-bubble--left',
                      { 'is-deleted': item.message.deleted },
                    ]"
                    @click="handleOpenVideo(item.message)"
                  >
                    <div class="video-thumb-wrapper">
                      <video
                        :src="item.message.content.video.url"
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
                        {{ resolveVideoMeta(item.message.content.video) }}
                      </span>
                    </div>
                    <div
                      v-if="item.message.content.video.caption || item.message.content?.pin"
                      class="d-flex align-center mt-2"
                    >
                      <p
                        v-if="item.message.content.video.caption"
                        class="video-caption mb-0"
                        :class="{
                          'mr-2': item.message.content?.pin,
                        }"
                        :style="{
                          color: isTypeUser(item.message)
                            ? 'rgb(var(--v-theme-on-surface))'
                            : 'rgb(var(--v-theme-title))',
                        }"
                      >
                        <span
                          v-html="
                            formatWhatsAppText(item.message.content.video.caption)
                          "
                        ></span>
                      </p>
                      <VIcon
                        v-if="item.message.content?.pin"
                        size="16"
                        color="grey-600"
                        class="pin-icon"
                      >
                        tabler-pin
                      </VIcon>
                    </div>
                  </div>

                  <div
                    v-if="
                      item.message.content?.video?.url &&
                      isVideoNoteMessage(item.message)
                    "
                    :class="[
                      'video-note-bubble',
                      !isTypeUser(item.message)
                        ? 'video-note-bubble--right'
                        : 'video-note-bubble--left',
                      { 'is-deleted': item.message.deleted },
                    ]"
                    @click="handleOpenVideo(item.message)"
                  >
                    <div class="video-note-thumb-wrapper">
                      <video
                        :src="item.message.content.video.url"
                        class="video-note-thumb"
                        preload="metadata"
                        muted
                        playsinline
                      >
                        <track kind="captions" />
                      </video>
                      <div class="video-play-overlay video-note-play-overlay">
                        <VIcon size="28">tabler-player-play</VIcon>
                      </div>
                    </div>
                    <div class="video-note-details">
                      <span class="video-meta text-caption text-disabled">
                        {{ resolveVideoNoteMeta(item.message.content.video) }}
                      </span>
                    </div>
                    <div
                      v-if="item.message.content.video.caption || item.message.content?.pin"
                      class="d-flex align-center mt-2"
                    >
                      <p
                        v-if="item.message.content.video.caption"
                        class="video-caption mb-0"
                        :class="{
                          'mr-2': item.message.content?.pin,
                        }"
                        :style="{
                          color: isTypeUser(item.message)
                            ? 'rgb(var(--v-theme-on-surface))'
                            : 'rgb(var(--v-theme-title))',
                        }"
                      >
                        <span
                          v-html="
                            formatWhatsAppText(item.message.content.video.caption)
                          "
                        ></span>
                      </p>
                      <VIcon
                        v-if="item.message.content?.pin"
                        size="16"
                        color="grey-600"
                        class="pin-icon"
                      >
                        tabler-pin
                      </VIcon>
                    </div>
                  </div>

                  <div
                    v-if="
                      item.message.content?.type === EMessageType.sticker &&
                      item.message.content?.sticker?.url
                    "
                    :class="[
                      'sticker-bubble',
                      !isTypeUser(item.message)
                        ? 'sticker-bubble--right'
                        : 'sticker-bubble--left',
                      { 'is-deleted': item.message.deleted },
                    ]"
                    @click="handleOpenImage(item.message)"
                  >
                    <img
                      :src="item.message.content.sticker.url"
                      :alt="
                        item.message.content.sticker.is_animated
                          ? 'Sticker animado'
                          : 'Sticker'
                      "
                      :class="[
                        'sticker-thumb',
                        item.message.content.sticker.is_animated
                          ? 'sticker-thumb--animated'
                          : '',
                      ]"
                      style="
                        max-width: 100px;
                        max-height: 100px;
                        object-fit: contain;
                      "
                    />
                  </div>

                  <div
                    v-if="
                      item.message.content?.type === EMessageType.location &&
                      item.message.content?.location?.latitude &&
                      item.message.content?.location?.longitude
                    "
                    :class="[
                      'location-bubble',
                      !isTypeUser(item.message)
                        ? 'location-bubble--right'
                        : 'location-bubble--left',
                      { 'is-deleted': item.message.deleted },
                    ]"
                    @click="handleOpenLocation(item.message)"
                  >
                    <div class="location-map-preview">
                      <div
                        v-if="
                          !webGLSupported || mapErrors[item.message.message_id]
                        "
                        class="location-map-fallback"
                      >
                        <VIcon size="32" color="primary">tabler-map-pin</VIcon>
                        <span class="text-caption mt-2">
                          {{
                            t('location_map_unavailable', 'Mapa indisponível')
                          }}
                        </span>
                      </div>
                      <MglMap
                        v-else
                        :key="`map-${item.message.message_id}`"
                        :map-style="mapStyle"
                        :center="[
                          item.message.content.location.longitude,
                          item.message.content.location.latitude,
                        ]"
                        :zoom="15"
                        :interactive="false"
                        :attribution-control="false"
                        :navigation-control="false"
                        class="location-map-preview-map"
                        :style="{ width: '100%', height: '112px' }"
                      >
                        <MglMarker
                          :coordinates="[
                            item.message.content.location.longitude,
                            item.message.content.location.latitude,
                          ]"
                          color="#ef4444"
                        />
                      </MglMap>
                    </div>
                    <div class="location-info">
                      <div
                        v-if="item.message.content.location.name"
                        class="location-name"
                        :style="{
                          color: isTypeUser(item.message)
                            ? 'rgb(var(--v-theme-on-surface))'
                            : 'rgb(var(--v-theme-title))',
                        }"
                      >
                        {{ item.message.content.location.name }}
                      </div>
                      <div
                        v-if="item.message.content.location.address"
                        class="location-address text-caption"
                        :style="{
                          color: isTypeUser(item.message)
                            ? 'rgba(var(--v-theme-on-surface), 0.7)'
                            : 'rgba(var(--v-theme-title), 0.7)',
                        }"
                      >
                        {{ item.message.content.location.address }}
                      </div>
                    </div>
                  </div>

                  <div
                    v-if="
                      item.message.content?.type ===
                        EMessageType.contact_card &&
                      item.message.content?.contact
                    "
                    :class="[
                      'contact-bubble',
                      !isTypeUser(item.message)
                        ? 'contact-bubble--right'
                        : 'contact-bubble--left',
                      { 'is-deleted': item.message.deleted },
                    ]"
                  >
                    <GroupContactMessageCard
                      :title="item.message.content.contact.name || ''"
                      :time="
                        formatDate(item.message.date, {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        })
                      "
                      :seen="!!item.message.summary?.is_seen"
                      :align="isTypeUser(item.message) ? 'left' : 'right'"
                      :is-group="false"
                      :photo="item.message.content.contact.photo"
                      @toggle="handleContactClick(item.message)"
                      @view-all="handleContactClick(item.message)"
                    />

                    <p
                      v-if="item.message.content?.message"
                      class="contact-caption mt-2"
                      :style="{
                        color: isTypeUser(item.message)
                          ? 'rgb(var(--v-theme-on-surface))'
                          : 'rgb(var(--v-theme-title))',
                      }"
                    >
                      <span
                        v-if="shouldFormatMessage(item.message)"
                        v-html="
                          formatWhatsAppText(getLatestMessageText(item.message))
                        "
                      ></span>
                      <span v-else>{{
                        getLatestMessageText(item.message)
                      }}</span>
                    </p>
                  </div>

                  <div
                    v-if="
                      item.message.content?.type === EMessageType.contacts &&
                      item.message.content?.contacts &&
                      item.message.content.contacts.length > 0
                    "
                    :class="[
                      'contact-bubble',
                      !isTypeUser(item.message)
                        ? 'contact-bubble--right'
                        : 'contact-bubble--left',
                      { 'is-deleted': item.message.deleted },
                    ]"
                  >
                    <GroupContactMessageCard
                      :title="
                        `${item.message.content.contacts[0].name}${
                          item.message.content.contacts.length > 1
                            ? ` e ${item.message.content.contacts.length - 1}`
                            : ''
                        }${
                          item.message.content.contacts.length > 1
                            ? ' outro contato'
                            : ''
                        }`
                      "
                      :time="
                        formatDate(item.message.date, {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        })
                      "
                      :seen="!!item.message.summary?.is_seen"
                      :align="isTypeUser(item.message) ? 'left' : 'right'"
                      :is-group="true"
                      @toggle="handleContactsGroupClick(item.message)"
                      @view-all="handleContactsGroupClick(item.message)"
                    />
                  </div>

                  <div
                    v-if="
                      getLatestMessageText(item.message) &&
                      item.message.content?.type !== EMessageType.image &&
                      item.message.content?.type !== EMessageType.video_note &&
                      item.message.content?.type !== EMessageType.video &&
                      item.message.content?.type !== EMessageType.document &&
                      item.message.content?.type !==
                        EMessageType.contact_card &&
                      item.message.content?.type !== EMessageType.contacts &&
                      item.message.content?.type !== EMessageType.audio &&
                      !item.message.message_key?.is_view_once
                    "
                    class="d-flex align-center"
                  >
                    <p
                      v-if="shouldFormatMessage(item.message)"
                      class="mr-6 text-base message-text"
                      :class="{
                        'mb-2':
                          !hasMessageVersions(item.message) &&
                          !item.message.deleted,
                        'mb-6':
                          hasMessageVersions(item.message) ||
                          item.message.deleted,
                        'mr-2': item.message.content?.pin,
                      }"
                      :style="{
                        color: isTypeUser(item.message)
                          ? 'rgb(var(--v-theme-on-surface))'
                          : 'rgb(var(--v-theme-title))',
                      }"
                      v-html="
                        formatWhatsAppText(getLatestMessageText(item.message))
                      "
                    ></p>
                    <p
                      v-else
                      class="mr-6 text-base message-text"
                      :class="{
                        'mb-2':
                          !hasMessageVersions(item.message) &&
                          !item.message.deleted,
                        'mb-6':
                          hasMessageVersions(item.message) ||
                          item.message.deleted,
                        'mr-2': item.message.content?.pin,
                      }"
                      :style="{
                        color: isTypeUser(item.message)
                          ? 'rgb(var(--v-theme-on-surface))'
                          : 'rgb(var(--v-theme-title))',
                      }"
                    >
                      {{ getLatestMessageText(item.message) }}
                    </p>
                    <VIcon
                      v-if="
                        item.message.content?.pin &&
                        item.message.content?.message?.trim()
                      "
                      size="16"
                      color="grey-600"
                      class="pin-icon"
                    >
                      tabler-pin
                    </VIcon>
                  </div>

                  <div
                    v-if="
                      item.message.content?.type === EMessageType.document &&
                      item.message.content?.document?.url
                    "
                    :class="[
                      'document-bubble',
                      !isTypeUser(item.message)
                        ? 'document-bubble--right'
                        : 'document-bubble--left',
                      { 'is-deleted': item.message.deleted },
                    ]"
                  >
                    <div class="document-icon">
                      <VIcon
                        :icon="
                          resolveDocumentIcon(item.message.content?.document)
                        "
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
                            :href="item.message.content.document.url"
                            :download="
                              documentDownloadName(
                                item.message.content.document
                              )
                            "
                            target="_blank"
                            rel="noopener"
                          >
                            {{
                              truncateDocumentName(
                                item.message.content.document.name
                              )
                            }}
                          </a>
                        </template>
                        <span>{{ item.message.content.document.name }}</span>
                      </VTooltip>

                      <span class="document-meta text-caption text-disabled">
                        {{ resolveDocumentMeta(item.message.content.document) }}
                      </span>
                    </div>
                    <a
                      class="document-download"
                      :href="item.message.content.document.url"
                      :download="
                        documentDownloadName(item.message.content.document)
                      "
                      target="_blank"
                      rel="noopener"
                    >
                      <VIcon size="22">tabler-download</VIcon>
                    </a>
                  </div>

                  <div
                    v-if="
                      item.message.content?.type === EMessageType.document &&
                      (item.message.content?.message || item.message.content?.pin)
                    "
                    class="d-flex align-center mt-2"
                  >
                    <p
                      v-if="item.message.content?.message"
                      class="chat-text mb-0"
                      :class="{
                        'mr-2': item.message.content?.pin,
                      }"
                      v-html="
                        formatWhatsAppText(item.message.content.message)
                      "
                    />
                    <VIcon
                      v-if="item.message.content?.pin"
                      size="16"
                      color="grey-600"
                      class="pin-icon"
                    >
                      tabler-pin
                    </VIcon>
                  </div>

                  <div
                    v-if="
                      item.message.content?.type === EMessageType.audio &&
                      item.message.content?.audio?.url
                    "
                    :class="[
                      'audio-bubble',
                      !isTypeUser(item.message)
                        ? 'audio-bubble--right'
                        : 'audio-bubble--left',
                      { 'is-deleted': item.message.deleted },
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
                            item.message.message_id,
                            item.message.content.audio.url
                          )
                        "
                      >
                        <VIcon size="18">
                          {{
                            isAudioPlaying(item.message.message_id)
                              ? 'tabler-player-pause'
                              : 'tabler-player-play'
                          }}
                        </VIcon>
                      </VBtn>

                      <div class="audio-waveform-container">
                        <template
                          v-if="
                            (() => {
                              const waveform =
                                audioWaveforms[item.message.message_id];
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
                                item.message.message_id
                              ]"
                              :key="`${item.message.message_id}-${index}`"
                              class="audio-waveform-bar"
                              :class="{
                                'audio-waveform-bar--active':
                                  getAudioProgress(item.message.message_id) >
                                  (index /
                                    (audioWaveforms[item.message.message_id]
                                      ?.length || 80)) *
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
                              left: `${getAudioProgress(item.message.message_id)}%`,
                            }"
                          ></div>
                        </template>
                        <div v-else class="audio-waveform-placeholder">
                          <div
                            v-for="i in 80"
                            :key="`placeholder-${item.message.message_id}-${i}`"
                            class="audio-waveform-bar-placeholder"
                          ></div>
                        </div>
                      </div>
                    </div>

                    <div
                      v-if="item.message.content?.message || item.message.content?.pin"
                      class="d-flex align-center mt-2"
                    >
                      <p
                        v-if="item.message.content?.message"
                        class="audio-caption mb-0"
                        :class="{
                          'mr-2': item.message.content?.pin,
                        }"
                        :style="{
                          color: isTypeUser(item.message)
                            ? 'rgb(var(--v-theme-on-surface))'
                            : 'rgb(var(--v-theme-title))',
                        }"
                      >
                        <span
                          v-if="shouldFormatMessage(item.message)"
                          v-html="
                            formatWhatsAppText(
                              getLatestMessageText(item.message)
                            )
                          "
                        ></span>
                        <span v-else>{{
                          getLatestMessageText(item.message)
                        }}</span>
                      </p>
                      <VIcon
                        v-if="item.message.content?.pin"
                        size="16"
                        color="grey-600"
                        class="pin-icon"
                      >
                        tabler-pin
                      </VIcon>
                    </div>
                  </div>

                  <div
                    v-if="
                      item.message.content?.reactions &&
                      item.message.content.reactions.length > 0 &&
                      item.message.content?.type !== EMessageType.annotation
                    "
                    :class="[
                      'reactions-summary',
                      item.message.content?.type === EMessageType.system
                        ? 'reactions-summary--center'
                        : !isTypeUser(item.message)
                          ? 'reactions-summary--right'
                          : 'reactions-summary--left',
                      {
                        'reactions-summary--contact':
                          item.message.content?.type === EMessageType.contact_card ||
                          item.message.content?.type === EMessageType.contacts,
                      },
                    ]"
                  >
                    <div class="reaction-summary-bubble">
                      <div
                        v-for="(reaction, idx) in getReactionsSummary(
                          item.message.content.reactions
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

                  <div
                    v-if="
                      item.message.content?.type !== EMessageType.contact_card &&
                      item.message.content?.type !== EMessageType.contacts
                    "
                    :class="[
                      'message-meta',
                      {
                        'message-meta--audio':
                          item.message.content?.type === EMessageType.audio &&
                          item.message.content?.audio?.url,
                      },
                    ]"
                  >
                    <span
                      v-if="
                        item.message.content?.type === EMessageType.audio &&
                        item.message.content?.audio?.url
                      "
                      class="message-audio-duration"
                    >
                      {{
                        getDisplayTime(
                          item.message.message_id,
                          item.message.content.audio.duration
                        )
                      }}
                    </span>
                    <div class="message-meta-content">
                      <span
                        v-if="item.message.deleted"
                        class="message-deleted-badge"
                        :title="t('chat_deleted_message_label')"
                      >
                        {{ t('chat_deleted_message_label') }}
                      </span>
                      <span
                        v-else-if="hasMessageVersions(item.message)"
                        class="message-edited-badge"
                        :title="t('chat_edited')"
                      >
                        {{ t('chat_edited') }}
                      </span>
                      <div class="message-meta-row">
                        <span class="message-time">
                          {{
                            formatDate(item.message.date, {
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false,
                            })
                          }}
                        </span>
                        <VIcon
                          size="16"
                          :color="resolveFeedbackIcon(item.message).color"
                        >
                          {{ resolveFeedbackIcon(item.message).icon }}
                        </VIcon>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>

  <VDialog
    v-model="contactsGroupModalOpen"
    max-width="600"
    :scrollable="true"
  >
    <VCard v-if="contactsGroupData?.content?.contacts">
      <VCardTitle class="d-flex align-center justify-space-between">
        <div>
          <div class="text-h6">
            {{ t('contacts_group') }}
          </div>
          <div class="text-caption text-disabled mt-1">
            {{
              contactsGroupData.content.contacts.length === 1
                ? t('contact_count_singular') || '1 contato'
                : `${contactsGroupData.content.contacts.length} ${t('contacts') || 'contatos'}`
            }}
          </div>
        </div>
        <VBtn icon variant="text" size="small" @click="contactsGroupModalOpen = false">
          <VIcon>tabler-x</VIcon>
        </VBtn>
      </VCardTitle>
      <VDivider />
      <VCardText>
        <div class="d-flex flex-column gap-2">
          <div
            v-for="(contact, idx) in contactsGroupData.content.contacts"
            :key="idx"
            class="contact-item-modal d-flex align-center gap-3 pa-3"
            :style="{
              backgroundColor: 'rgba(var(--v-theme-surface), 0.5)',
              borderRadius: '8px',
              cursor: 'pointer',
            }"
            @click="saveContactFromGroup(contact)"
          >
            <VOverlay
              :model-value="
                savingContacts.has(
                  contact.contact_id ||
                    `${contact.phone}_${contact.phone_ddi}`
                )
              "
              contained
              class="align-center justify-center"
              scrim="rgba(var(--v-theme-surface), 0.7)"
              style="border-radius: 8px"
            >
              <VProgressCircular indeterminate color="primary" />
            </VOverlay>
            <VAvatar
              size="48"
              :variant="contact.photo ? undefined : 'tonal'"
              :color="contact.photo ? undefined : 'primary'"
            >
              <VImg
                v-if="contact.photo"
                :src="contact.photo"
                :alt="contact.name"
              />
              <VIcon v-else size="24">tabler-user</VIcon>
            </VAvatar>
            <div class="flex-grow-1">
              <div class="text-body-1 font-weight-medium">
                {{ contact.name }}
                {{ contact.last_name || '' }}
              </div>
              <div
                v-if="contact.phone_partial"
                class="text-caption text-disabled"
              >
                {{ contact.phone_partial }}
              </div>
              <div
                v-if="contact.email_partial"
                class="text-caption text-disabled"
              >
                {{ contact.email_partial }}
              </div>
            </div>
            <VBtn
              icon
              variant="text"
              size="small"
              :disabled="
                savingContacts.has(
                  contact.contact_id ||
                    `${contact.phone}_${contact.phone_ddi}`
                )
              "
              @click.stop="saveContactFromGroup(contact)"
            >
              <VIcon :color="contact.contact_id ? 'warning' : 'success'">
                {{
                  contact.contact_id
                    ? 'tabler-user-edit'
                    : 'tabler-user-plus'
                }}
              </VIcon>
            </VBtn>
          </div>
        </div>
      </VCardText>
      <VDivider />
      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          @click="contactsGroupModalOpen = false"
        >
          {{ t('close') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>

  <VDialog v-model="editHistoryModalOpen" max-width="600" :scrollable="false">
    <VCard v-if="viewingEditHistory">
      <VCardTitle class="d-flex align-center justify-space-between">
        <span>{{ t('chat_edit_history') }}</span>
        <VBtn
          icon
          variant="text"
          size="small"
          @click="editHistoryModalOpen = false"
        >
          <VIcon size="20">tabler-x</VIcon>
        </VBtn>
      </VCardTitle>
      <VCardText>
        <div class="edit-history-list">
          <div
            v-for="(item, index) in getMessageEditHistory(viewingEditHistory)"
            :key="index"
            class="edit-history-item"
            :class="{
              'edit-history-item--current': index === 0 && !item.isOriginal,
              'edit-history-item--original': item.isOriginal,
            }"
          >
            <div class="edit-history-header">
              <span class="edit-history-label">
                {{
                  item.isOriginal
                    ? t('chat_original_message')
                    : t('chat_edited_version')
                }}
              </span>
              <span class="edit-history-date">
                {{
                  formatDate(item.date, {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  })
                }}
              </span>
            </div>
            <div class="edit-history-text">{{ item.text }}</div>
          </div>
        </div>
      </VCardText>
      <VCardText class="d-flex justify-end">
        <VBtn
          variant="tonal"
          color="secondary"
          @click="editHistoryModalOpen = false"
        >
          {{ t('close', 'Fechar') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style lang="scss" scoped>
.chat-log-viewer {
  width: 100%;
  min-height: 100%;

  .chat-group {
    margin-bottom: 0;
    overflow: visible !important;
  }

  .chat-avatar {
    flex-shrink: 0;
  }

  .chat-body {
    max-inline-size: calc(100% - 6.75rem);
    min-width: 0;
    overflow: visible !important;
  }

  .chat-content-wrapper {
    position: relative;
    display: inline-flex;
    max-width: 100%;
    min-width: 0;
    overflow: visible !important;
  }

  .chat-content {
    border-radius: 6px;
    border-end-end-radius: 6px;
    border-end-start-radius: 6px;
    padding-right: 1.8rem !important;
    padding-bottom: 1.4rem !important;
    word-wrap: break-word;
    word-break: break-word;
    overflow-wrap: anywhere;
    position: relative;
    max-width: 100%;
    min-width: 0;
    min-height: 40px;
    overflow: visible !important;

    &.has-contact-card {
      padding: 8px 8px 8px 0 !important;
      padding-bottom: 8px !important;
      box-shadow: none !important;
      background: transparent !important;
    }

    &.is-deleted {
      opacity: 0.7;
    }

    &.is-deleted .message-text,
    &.is-deleted .image-caption {
      text-decoration: line-through;
    }

    &:has(.image-bubble),
    &:has(.video-bubble),
    &:has(.video-note-bubble),
    &:has(.sticker-bubble),
    &:has(.document-bubble),
    &:has(.location-bubble),
    &:has(.contact-bubble) {
      padding-bottom: 0.5rem !important;
    }

    &:has(.audio-bubble) {
      padding-bottom: 1.6rem !important;
    }

    &.has-reactions {
      min-width: 120px;
      padding-left: 0.75rem !important;
      padding-right: 0.75rem !important;
    }

    &.has-edit-history {
      cursor: pointer;
      transition: opacity 0.2s ease;

      &:hover {
        opacity: 0.95;
      }
    }

    &.chat-left {
      border-start-end-radius: 6px;

      .message-meta {
        color: rgba(var(--v-theme-on-surface), 0.6);

        .message-time {
          color: rgba(var(--v-theme-on-surface), 0.6);
        }
      }
    }

    &.chat-right {
      border-start-start-radius: 6px;

      .message-meta {
        color: rgba(17, 27, 33, 0.6);

        .message-time {
          color: rgba(17, 27, 33, 0.6);
        }
      }
    }

    &.chat-center {
      border-radius: 6px;
      text-align: center;
      margin: 0 auto;

      .message-meta {
        color: rgba(17, 27, 33, 0.6);

        .message-time {
          color: rgba(17, 27, 33, 0.6);
        }
      }
    }
  }

  .message-block {
    position: static;
    width: 100%;
  }

  .message-text {
    white-space: pre-line;
    word-break: break-word;
    overflow-wrap: anywhere;
    line-height: 1.5;
    margin: 0;
    max-width: 100%;
  }

  .message-meta {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 6px;
    display: flex;
    align-items: flex-end;
    gap: 4px;
    justify-content: flex-end;
    padding-inline: 16px 12px;
    font-size: 0.75rem;
    pointer-events: none;
    z-index: 10;

    .v-icon {
      font-size: 0.95rem;
    }

    .message-audio-duration {
      margin-right: auto;
      font-weight: 500;
    }

    .message-meta-content {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
    }

    .message-meta-row {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .message-time {
      line-height: 1;
      white-space: nowrap;
    }

    .message-edited-badge,
    .message-deleted-badge {
      font-size: 0.65rem;
      color: rgba(var(--v-theme-on-surface), 0.5);
      font-style: italic;
      line-height: 1;
    }
  }

  .message-meta--audio {
    padding-inline-start: 62px;
  }

  .forwarded-indicator {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    font-style: italic;
    margin-bottom: 4px;
    opacity: 0.7;
  }

  .forwarded-indicator--left {
    color: rgb(var(--v-theme-on-surface));
  }

  .forwarded-indicator--right {
    color: rgba(17, 27, 33, 0.7);
  }

  .forwarded-icon {
    transform: scaleX(-1);
  }

  .forwarded-text {
    font-weight: 400;
  }

  .quoted-block {
    border-inline-start: 3px solid rgba(var(--v-theme-primary), 0.5);
    padding-inline-start: 8px;
    margin-bottom: 8px;
    padding-block: 4px;
    border-radius: 4px;
    background: rgba(var(--v-theme-on-surface), 0.04);

    &.is-right {
      border-inline-start: none;
      border-inline-end: 3px solid rgba(var(--v-theme-primary), 0.5);
      padding-inline-start: 0;
      padding-inline-end: 8px;
    }

    .quoted-name {
      font-size: 0.75rem;
      font-weight: 600;
      color: rgba(var(--v-theme-primary), 0.9);
      margin-bottom: 2px;
    }

    .quoted-content {
      font-size: 0.8rem;
      color: rgba(var(--v-theme-on-surface), 0.7);
    }

    .quoted-media {
      width: 44px;
      height: 44px;
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 4px;

      &.quoted-media--video {
        position: relative;
      }
    }

    .quoted-location,
    .quoted-document,
    .quoted-audio,
    .quoted-contact,
    .quoted-sticker {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .quoted-document-info,
    .quoted-audio-info,
    .quoted-video-info,
    .quoted-image-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .quoted-document-name,
    .quoted-audio-name,
    .quoted-video-name,
    .quoted-image-name {
      font-size: 0.8rem;
      font-weight: 600;
      color: rgb(var(--v-theme-primary));
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .quoted-document-meta,
    .quoted-audio-meta,
    .quoted-video-meta,
    .quoted-image-meta {
      font-size: 0.7rem;
      color: rgba(var(--v-theme-on-surface), 0.6);
    }

    .quoted-video-thumb {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .quoted-video-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.3);
    }

    .quoted-video-placeholder {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(var(--v-theme-on-surface), 0.1);
    }

    .quoted-contact-avatar {
      flex-shrink: 0;
    }

    .quoted-contact-group-icon {
      width: 22px;
      height: 22px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: rgb(var(--v-theme-primary));

      svg {
        width: 100%;
        height: 100%;
      }
    }

    .quoted-contact-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex: 1;
      min-width: 0;
    }

    .quoted-contact-name {
      font-size: 0.8rem;
      font-weight: 600;
      color: rgb(var(--v-theme-primary));
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .quoted-contact-message {
      font-size: 0.75rem;
      color: rgba(var(--v-theme-on-surface), 0.7);
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .quoted-text {
      word-wrap: break-word;
      word-break: break-word;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
      max-width: 100%;
    }
  }

  .link-preview {
    padding: 12px;
    margin-bottom: 8px;
    max-width: 100%;

    .lp-main {
      gap: 12px;
    }

    .lp-thumb {
      width: 80px;
      height: 80px;
      border-radius: 4px;
      overflow: hidden;
      flex-shrink: 0;

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }

    .lp-text {
      flex: 1;
      min-width: 0;
    }

    .lp-domain {
      color: rgba(var(--v-theme-on-surface), 0.6);
    }

    .lp-title {
      font-weight: 600;
      line-height: 1.3;
    }

    .lp-desc {
      color: rgba(var(--v-theme-on-surface), 0.7);
      line-height: 1.4;
    }

    .lp-url {
      color: rgba(var(--v-theme-primary), 0.9);
      text-decoration: none;
      word-break: break-all;

      &:hover {
        text-decoration: underline;
      }
    }
  }

  .image-bubble,
  .video-bubble,
  .sticker-bubble {
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
    transition: opacity 0.2s;
    max-width: 100%;
    position: relative;
    padding-bottom: 24px;

    &:hover {
      opacity: 0.9;
    }

    &.is-deleted {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  .image-thumb {
    max-width: 100%;
    height: auto;
    display: block;
  }

  .image-caption {
    margin-top: 8px;
    white-space: pre-wrap;
    word-break: break-word;
    padding-bottom: 0;
  }

  .video-thumb-wrapper {
    position: relative;
    width: 100%;
    max-width: 300px;
  }

  .video-thumb {
    width: 100%;
    height: auto;
    display: block;
    border-radius: 8px 8px 0 0;
  }

  .video-play-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 8px 8px 0 0;
  }

  .video-details {
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.1);
  }

  .video-meta {
    color: rgba(255, 255, 255, 0.8);
  }

  .video-caption {
    font-size: 0.95rem;
    line-height: 1.25rem;
    white-space: pre-line;
    margin-bottom: 0 !important;
    padding: 8px 12px;
    padding-bottom: 0;
  }

  .video-note-bubble {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-inline-size: 180px;
    inline-size: 100%;
    cursor: pointer;
    border-radius: 10px;
    background: rgba(var(--v-theme-on-surface), 0.04);
    padding: 10px;
    align-items: center;

    &.is-deleted {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  .video-note-bubble--left {
    border-start-end-radius: 6px;
  }

  .video-note-bubble--right {
    border-start-start-radius: 6px;
  }

  .video-note-thumb-wrapper {
    position: relative;
    inline-size: 120px;
    block-size: 120px;
    border-radius: 9999px;
    overflow: hidden;
    background: #000;
  }

  .video-note-thumb {
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
    display: block;
    border-radius: 9999px;
  }

  .video-note-play-overlay {
    border-radius: 9999px;
  }

  .video-note-details {
    inline-size: 100%;
    padding: 0 12px;
  }

  .sticker-thumb {
    display: block;
  }

  .document-bubble {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border-radius: 10px;
    background: rgba(var(--v-theme-on-surface), 0.04);
    margin-bottom: 16px;
    max-width: 100%;
    position: relative;
    padding-bottom: 12px;

    &.is-deleted {
      pointer-events: none;
      opacity: 0.7;
    }
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
    flex: 1;
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
    flex-shrink: 0;

    &:hover {
      background: rgba(var(--v-theme-primary), 0.18);
    }
  }

  .location-bubble {
    width: 200px;
    max-width: 100%;
    min-width: 175px;
    border-radius: 8px;
    cursor: pointer;
    transition: opacity 0.2s;
    overflow: hidden;
    position: relative;
    padding-bottom: 0;
    margin-bottom: 0;

    &:hover {
      opacity: 0.9;
    }

    &.is-deleted {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .location-map-preview {
      width: 100%;
      height: 112px;
      position: relative;
      overflow: hidden;
      border-radius: 8px 8px 0 0;

      .location-map-preview-map {
        width: 100% !important;
        height: 112px !important;
        pointer-events: none;
      }

      .location-map-fallback {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: rgba(var(--v-theme-on-surface), 0.05);
        color: rgba(var(--v-theme-on-surface), 0.6);
      }
    }

    .location-info {
      padding: 12px;
      flex: 1;
      min-width: 0;
    }

    .location-name {
      font-weight: 500;
      margin-bottom: 4px;
    }

    .location-address {
      word-break: break-word;
    }
  }

  .contact-bubble {
    max-width: 100%;
    margin-bottom: 0;
    padding: 0;
    background: transparent !important;
    box-shadow: none !important;
    position: relative;

    &.is-deleted {
      opacity: 0.7;
    }
  }

  .contact-bubble--left {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    margin-right: auto;
  }

  .contact-bubble--right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    margin-left: auto;
  }

  .contact-bubble--left .group-contact-card {
    margin-right: 0;
    margin-left: 0;
    width: 100%;
    max-width: 380px;
  }

  .contact-bubble--right .group-contact-card {
    margin-left: 0;
    margin-right: 0;
    width: 100%;
    max-width: 380px;
  }

  .chat-content.has-contact-card.has-actions {
    .group-contact-card {
      margin-top: 0;
      position: relative;
    }

    .group-contact-card__title-row {
      padding-right: 44px;
    }
  }

  .contact-caption {
    margin-top: 8px;
    padding: 0 4px;
    font-size: 0.875rem;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .contact-item-modal {
    position: relative;
    transition:
      opacity 0.2s ease,
      transform 0.2s ease;

    &:hover {
      opacity: 0.9;
      transform: scale(1.01);
    }

    &:active {
      transform: scale(0.99);
    }
  }

  .audio-bubble {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-inline-size: 380px;
    inline-size: 100%;
    position: relative;
    padding-bottom: 0;
    margin-bottom: 0;

    &.audio-bubble--left {
      border-start-end-radius: 6px;
    }

    &.audio-bubble--right {
      border-start-start-radius: 6px;
    }

    &.is-deleted {
      pointer-events: none;
      opacity: 0.7;
    }
  }

  .audio-player-container {
    display: flex;
    align-items: center;
    gap: 12px;
    inline-size: 100%;
    padding: 8px 14px;
    border-radius: 0;
    background: rgba(var(--v-theme-on-surface), 0.04);
    position: relative;
    border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  }

  .audio-play-btn {
    flex-shrink: 0;
    min-width: 36px !important;
    width: 36px !important;
    height: 36px !important;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.95);
    border: 2px solid rgb(var(--v-theme-primary));
    color: rgb(var(--v-theme-primary)) !important;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

    :deep(.v-icon) {
      color: rgb(var(--v-theme-primary));
      font-size: 18px;
    }
  }

  .audio-bubble--right .audio-play-btn {
    background: rgba(255, 255, 255, 0.95);
    border: 2px solid rgba(255, 255, 255, 0.8);
    color: rgb(var(--v-theme-primary)) !important;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);

    :deep(.v-icon) {
      color: rgb(var(--v-theme-primary));
      font-size: 18px;
    }
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

  .audio-waveform-container {
    position: relative;
    flex: 1 1 auto;
    height: 36px;
    display: flex;
    align-items: center;
    overflow: hidden;
    min-width: 100px;
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

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.3;
    }
    50% {
      opacity: 0.6;
    }
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
    padding-bottom: 0;
  }

  .reactions-summary {
    position: absolute;
    display: inline-flex;
    gap: 4px;
    bottom: -2px;
    transform: translateY(60%);
    margin-inline-start: auto;
    z-index: 11;

    &--right {
      justify-content: flex-end;
      right: 16px;
    }

    &--left {
      justify-content: flex-start;
      margin-inline-start: 0;
      left: 16px;
    }

    &--center {
      justify-content: center;
      left: 50%;
      transform: translateX(-50%) translateY(60%);
    }

    &--contact {
      bottom: auto;
      top: calc(100% - 16px);
      left: 20px;
      transform: translateY(0);
      z-index: 10;

      &.reactions-summary--right {
        transform: translateY(0);
      }

      &.reactions-summary--left {
        transform: translateY(0);
      }

      &.reactions-summary--center {
        transform: translateX(-50%) translateY(0);
      }
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

  .view-once-message {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    border-radius: 8px;
    background: rgba(var(--v-theme-surface), 0.05);
    min-width: 200px;
    max-width: 400px;
  }
}

.edit-history-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.edit-history-item {
  padding: 12px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.1);

  &.edit-history-item--current {
    background: rgba(var(--v-theme-primary), 0.1);
    border-color: rgba(var(--v-theme-primary), 0.3);
  }

  &.edit-history-item--original {
    background: rgba(var(--v-theme-on-surface), 0.02);
  }
}

.edit-history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.edit-history-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.edit-history-date {
  font-size: 0.7rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.edit-history-text {
  font-size: 0.875rem;
  line-height: 1.5;
  color: rgb(var(--v-theme-on-surface));
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
