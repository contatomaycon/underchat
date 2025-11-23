<script lang="ts" setup>
import { computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { PerfectScrollbar } from 'vue3-perfect-scrollbar';
import { useDisplay, useTheme } from 'vuetify';
import { themes } from '@/plugins/vuetify/theme';
import ChatActiveChatUserProfileSidebarContent from '@/components/chat/ChatActiveChatUserProfileSidebarContent.vue';
import ChatLeftSidebarContent from '@/components/chat/ChatLeftSidebarContent.vue';
import ChatLog from '@/components/chat/ChatLog.vue';
import ChatUserProfileSidebarContent from '@/components/chat/ChatUserProfileSidebarContent.vue';
import AppContactPicker from '@/components/chat/AppContactPicker.vue';
import AppAddContact from '@/components/contact/AppAddContact.vue';
import AppEditContact from '@/components/contact/AppEditContact.vue';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EContactPermissions } from '@core/common/enums/EPermissions/contact';
import { can } from '@layouts/plugins/casl';
import { ListChatsResult } from '@core/schema/chat/listChats/response.schema';
import { useChatStore } from '@/@webcore/stores/chat';
import { useContactStore } from '@/@webcore/stores/contact';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import { ViewContactResponse } from '@core/schema/contact/viewContact/response.schema';
import { CreateContactRequest } from '@core/schema/contact/createContact/request.schema';
import { ListMessageChatsQuery } from '@core/schema/chat/listMessageChats/request.schema';
import {
  ContentMessageChat,
  ListMessageResult,
} from '@core/schema/chat/listMessageChats/response.schema';
import { onMessage, unsubscribe } from '@/@webcore/centrifugo';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { CreateMessageChatsBody } from '@core/schema/chat/createMessageChats/request.schema';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EColor } from '@core/common/enums/EColor';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import {
  IChatMessage,
  IQuotedMessage,
} from '@core/common/interfaces/IChatMessage';
import { IChat } from '@core/common/interfaces/IChat';
import { IChatTyping } from '@core/common/interfaces/IChatTyping';
import {
  ISelectedPhotoPreview,
  ISelectedDocumentPreview,
  ISelectedVideoPreview,
  ISelectedAudioPreview,
  ISelectedContactPreview,
} from '@core/common/interfaces/IChatFilePreview';
import { extractFirstUrl } from '@core/common/functions/extractFirstUrl';
import { ViewLinkPreviewResponse } from '@core/schema/chat/viewLinkPreview/response.schema';
import { refDebounced, useDebounceFn } from '@vueuse/core';
import { getOffsetTop } from '@core/common/functions/getOffsetTop';
import { Picker, EmojiIndex } from 'emoji-mart-vue-fast/src';
import data from 'emoji-mart-vue-fast/data/all.json';
import 'emoji-mart-vue-fast/css/emoji-mart.css';
import { useI18n } from 'vue-i18n';
import { MglMap, MglMarker } from 'vue-maplibre-gl';

const emojiIndex = new EmojiIndex(data);
const { t } = useI18n();

const MAX_DOCUMENT_SIZE_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_SIZE_BYTES = 16 * 1024 * 1024;
const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024;
const MAX_AUDIO_SIZE_BYTES = 16 * 1024 * 1024;

definePage({
  meta: {
    layoutWrapperClasses: 'layout-content-height-fixed',
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
      EChatPermissions.chat_access,
    ],
  },
});

const chatStore = useChatStore();
const contactStore = useContactStore();
const { name } = useTheme();
const vuetifyDisplays = useDisplay();

const contact_id = ref('contact-id');
const { isLeftSidebarOpen } = useResponsiveLeftSidebar(
  vuetifyDisplays.smAndDown
);

const currentPage = ref(1);
const perPage = ref(10);
const chatLogPS = ref();
const resizeHandler = ref<(() => void) | null>(null);
const q = ref('');
const msg = ref('');
const isUserProfileSidebarOpen = ref(false);
const isActiveChatUserProfileSidebarOpen = ref(false);
const linkPreview = ref<ViewLinkPreviewResponse | null>(null);
const composerRef = ref();

const fileDocRef = ref<HTMLInputElement | null>(null);
const filePhotoRef = ref<HTMLInputElement | null>(null);
const fileVideoRef = ref<HTMLInputElement | null>(null);
const fileAudioRef = ref<HTMLInputElement | null>(null);
const isEmojiOpen = ref(false);
const isContactPickerOpen = ref(false);
const isLocationPickerOpen = ref(false);
const isContactViewModalOpen = ref(false);
const selectedContactDetails = ref<ViewContactResponse | null>(null);
const isAddContactModalOpen = ref(false);
const addContactInitialData = ref<Partial<CreateContactRequest> | null>(null);
const isEditContactModalOpen = ref(false);
const editContactId = ref<string | null>(null);
const viewContactEmail = ref<string | null>(null);
const viewContactEmailPartial = ref<string | null>(null);
const viewContactPhone = ref<string | null>(null);
const viewContactPhonePartial = ref<string | null>(null);
const isViewEmailDecrypted = ref(false);
const isViewPhoneDecrypted = ref(false);
const isLoadingViewEmail = ref(false);
const isLoadingViewPhone = ref(false);
const isTyping = ref(false);
const typingTimeout = ref<NodeJS.Timeout | null>(null);
const selectedPhotos = ref<ISelectedPhotoPreview[]>([]);
const selectedDocuments = ref<ISelectedDocumentPreview[]>([]);
const selectedVideos = ref<ISelectedVideoPreview[]>([]);
const selectedAudios = ref<ISelectedAudioPreview[]>([]);
const selectedContacts = ref<ISelectedContactPreview[]>([]);
const selectedLocation = ref<{
  latitude: number;
  longitude: number;
  name?: string | null;
  address?: string | null;
} | null>(null);

const locationPickerLatitude = ref<number | null>(null);
const locationPickerLongitude = ref<number | null>(null);
const locationPickerName = ref<string>('');
const locationPickerAddress = ref<string>('');
const locationPickerMode = ref<'current' | 'map' | 'manual'>('current');
const locationMapRef = ref<any>(null);
const locationInputLatitude = ref<string>('');
const locationInputLongitude = ref<string>('');

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

const locationMapCenter = computed<[number, number]>(() => {
  if (
    locationPickerLatitude.value !== null &&
    locationPickerLongitude.value !== null
  ) {
    return [locationPickerLongitude.value, locationPickerLatitude.value];
  }
  return [0, 0];
});

const locationMarkerPosition = computed<[number, number]>(() => {
  if (
    locationPickerLatitude.value !== null &&
    locationPickerLongitude.value !== null
  ) {
    return [locationPickerLongitude.value, locationPickerLatitude.value];
  }
  return [0, 0];
});

const getCurrentLocation = (): Promise<GeolocationPosition> => {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported'));
      return;
    }
    const options: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    };
    navigator.geolocation.getCurrentPosition(resolve, reject, options); // NOSONAR: S5604 - Geolocalização é necessária para funcionalidade de envio de localização
  });
};

const useCurrentLocation = async () => {
  try {
    const position = await getCurrentLocation();
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;

    locationPickerLatitude.value = lat;
    locationPickerLongitude.value = lng;

    await nextTick();

    locationPickerMode.value = 'map';

    await nextTick();

    const updateMapCenter = () => {
      if (locationMapRef.value?.map) {
        const map = locationMapRef.value.map;
        map.setCenter([lng, lat]);
        return true;
      }
      return false;
    };

    if (updateMapCenter()) {
      return;
    }

    await nextTick();
    setTimeout(() => {
      if (updateMapCenter()) {
        return;
      }
      setTimeout(() => {
        updateMapCenter();
      }, 200);
    }, 100);
  } catch (error) {
    console.error('Error getting current location:', error);
  }
};

const onLocationMapClick = (event: any) => {
  if (!event?.lngLat) return;

  const lngLat = event.lngLat;
  locationPickerLatitude.value = lngLat.lat;
  locationPickerLongitude.value = lngLat.lng;
};

const useManualCoordinates = () => {
  const lat = Number.parseFloat(locationInputLatitude.value);
  const lng = Number.parseFloat(locationInputLongitude.value);

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return;
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return;
  }

  locationPickerLatitude.value = lat;
  locationPickerLongitude.value = lng;
  locationPickerMode.value = 'map';

  nextTick(() => {
    if (locationMapRef.value?.map) {
      const map = locationMapRef.value.map;
      const currentZoom = map.getZoom();
      map.setCenter([lng, lat]);
      map.setZoom(currentZoom);
    }
  });
};

const confirmLocation = async () => {
  if (!locationPickerLatitude.value || !locationPickerLongitude.value) {
    return;
  }

  selectedLocation.value = {
    latitude: locationPickerLatitude.value,
    longitude: locationPickerLongitude.value,
    name: locationPickerName.value || null,
    address: locationPickerAddress.value || null,
  };

  isLocationPickerOpen.value = false;
  locationPickerLatitude.value = null;
  locationPickerLongitude.value = null;
  locationPickerName.value = '';
  locationPickerAddress.value = '';
  locationInputLatitude.value = '';
  locationInputLongitude.value = '';
  locationPickerMode.value = 'current';

  await nextTick();
  await sendLocationMessage();
  finalizeSend();
};

const getGeolocationCallbacks = () => {
  const onSuccess = (position: GeolocationPosition) => {
    locationPickerLatitude.value = position.coords.latitude;
    locationPickerLongitude.value = position.coords.longitude;
    if (locationMapRef.value?.map) {
      locationMapRef.value.map.setCenter([
        position.coords.longitude,
        position.coords.latitude,
      ]);
      locationMapRef.value.map.setZoom(15);
    }
  };

  const onError = () => {
    locationPickerLatitude.value = -15.459175;
    locationPickerLongitude.value = -47.602219;
    if (locationMapRef.value?.map) {
      locationMapRef.value.map.setCenter([-47.602219, -15.459175]);
      locationMapRef.value.map.setZoom(15);
    }
  };

  return { onSuccess, onError };
};

const onLocationMapLoad = () => {
  if (!locationMapRef.value?.map) return;

  const map = locationMapRef.value.map;
  map.resize();

  map.doubleClickZoom.disable();
  if (map.boxZoom) {
    map.boxZoom.disable();
  }

  map.on('click', (e: any) => {
    if (!e?.lngLat) return;

    const lngLat = e.lngLat;
    locationPickerLatitude.value = lngLat.lat;
    locationPickerLongitude.value = lngLat.lng;
  });

  if (locationPickerLatitude.value && locationPickerLongitude.value) {
    map.setCenter([
      locationPickerLongitude.value,
      locationPickerLatitude.value,
    ]);
    map.setZoom(15);
    return;
  }

  if (navigator.geolocation) {
    const { onSuccess, onError } = getGeolocationCallbacks();

    navigator.geolocation.getCurrentPosition(onSuccess, onError); // NOSONAR: S5604 - Geolocalização é necessária para funcionalidade de envio de localização
  }
};

watch(isLocationPickerOpen, async (isOpen) => {
  if (isOpen) {
    await nextTick();
    if (locationPickerMode.value === 'current') {
      await useCurrentLocation();
    }
  }
});

watch(
  () => [
    locationPickerMode.value,
    locationPickerLatitude.value,
    locationPickerLongitude.value,
  ],
  async ([mode, lat, lng]) => {
    if (
      mode === 'map' &&
      lat !== null &&
      lng !== null &&
      typeof lat === 'number' &&
      typeof lng === 'number'
    ) {
      await nextTick();
      setTimeout(() => {
        if (locationMapRef.value?.map) {
          const map = locationMapRef.value.map;
          const currentCenter = map.getCenter();
          const currentZoom = map.getZoom();
          const centerLng = Number(currentCenter.lng);
          const centerLat = Number(currentCenter.lat);
          const distance = Math.sqrt(
            Math.pow(centerLng - Number(lng), 2) +
              Math.pow(centerLat - Number(lat), 2)
          );
          if (distance > 0.001) {
            map.setCenter([Number(lng), Number(lat)]);
            map.setZoom(currentZoom);
          }
        }
      }, 100);
    }
  }
);

const isRecordingAudio = ref(false);
const isRecordingPaused = ref(false);
const audioViewOnce = ref(false);
const audioPendingViewOnce = ref(false);
const audioRecordingStartAt = ref<number | null>(null);
const audioRecordingAccumulated = ref(0);
const audioRecordingElapsedMs = ref(0);
const audioRecordingTimerId = ref<number | null>(null);
const audioRecordingRAFId = ref<number | null>(null);
const mediaRecorderRef = ref<MediaRecorder | null>(null);
const audioStreamRef = ref<MediaStream | null>(null);
const audioContextRef = ref<AudioContext | null>(null);
const audioAnalyserRef = ref<AnalyserNode | null>(null);
const audioDataArrayRef = ref<Uint8Array | null>(null);
const audioCanvasRef = ref<HTMLCanvasElement | null>(null);
const audioChunksRef = ref<Blob[]>([]);
const shouldPersistRecording = ref(false);
const recordedAudioBlob = ref<Blob | null>(null);
const recordedAudioUrl = ref<string | null>(null);
const audioRecordingDurationSeconds = ref<number | null>(null);

const viewerOpen = ref(false);
const viewerSrc = ref<string>('');
const viewerCaption = ref<string>('');
const viewerDownloadName = ref<string>('');
const viewerKind = ref<'image' | 'video'>('image');

const hasContent = computed(() => !!msg.value && msg.value.trim().length > 0);

const isQueueStatus = computed(
  () => chatStore.activeChat?.status === EChatStatus.queue
);

const handleAttendChat = async () => {
  if (!chatStore.activeChat?.chat_id) return;

  await chatStore.updateChatStatus(
    chatStore.activeChat.chat_id,
    EChatStatus.in_chat
  );
};

const canAccessContacts = computed(() => {
  const permissions = [
    EGeneralPermissions.full_access,
    EGeneralPermissions.full_access_group,
    EContactPermissions.contact_group,
    EContactPermissions.contact_view,
  ];
  return can(permissions);
});

const hasAttachmentsOrContent = computed(
  () =>
    hasContent.value ||
    selectedPhotos.value.length > 0 ||
    selectedDocuments.value.length > 0 ||
    selectedVideos.value.length > 0 ||
    selectedAudios.value.length > 0 ||
    (canAccessContacts.value && selectedContacts.value.length > 0) ||
    isRecordingAudio.value
);

const createMessageHash = () => crypto.randomUUID();

const cloneLinkPreview = (): ViewLinkPreviewResponse | undefined => {
  const preview = linkPreview.value;
  if (!preview) return undefined;

  return structuredClone(preview);
};

const buildQuotedPayload = (
  replyMessage?: ListMessageResult | null
): IQuotedMessage | null => {
  const reply = replyMessage ?? chatStore.messageReply;
  if (!reply) return null;

  const key = {
    remote_jid: reply.message_key?.remote_jid ?? null,
    remote_jid_alt: reply.message_key?.remote_jid_alt ?? null,
    from_me: reply.message_key?.from_me ?? null,
    id: reply.message_key?.id ?? reply.message_id,
    participant: reply.message_key?.participant ?? null,
    participant_alt: reply.message_key?.participant_alt ?? null,
    addressing_mode: reply.message_key?.addressing_mode ?? null,
    is_view_once: reply.message_key?.is_view_once ?? false,
  } satisfies IQuotedMessage['key'];

  const quotedType = reply.content?.type as EMessageType | undefined;

  return {
    key,
    message: reply.content?.message ?? null,
    type: quotedType ?? undefined,
    image: reply.content?.image ?? null,
    video: reply.content?.video ?? null,
    document: reply.content?.document ?? null,
    audio: reply.content?.audio ?? null,
    sticker: reply.content?.sticker ?? null,
    location: reply.content?.location ?? null,
    contact: reply.content?.contact ?? null,
  } satisfies IQuotedMessage;
};

const getQuotedContent = (
  replyMessage?: ListMessageResult | null
): ContentMessageChat['quoted'] | undefined => {
  const payload = buildQuotedPayload(replyMessage);
  if (!payload) return undefined;

  const { type, ...rest } = payload;

  return {
    ...rest,
    type: type ?? undefined,
  } as ContentMessageChat['quoted'];
};

const createLocalMessageSummary = () => ({
  is_sent: false,
  is_delivered: false,
  is_seen: false,
  is_sent_to_internal: false,
});

const createLocalMessageEntry = (
  content: ContentMessageChat,
  hash: string
): ListMessageResult => {
  if (!chatStore.activeChat?.chat_id) {
    throw new Error('Cannot create local message without an active chat.');
  }

  const userInfo = chatStore.user?.info;

  return {
    message_id: hash,
    chat_id: chatStore.activeChat.chat_id,
    type_user: ETypeUserChat.operator,
    user: userInfo
      ? {
          id: userInfo.user_info_id,
          name: userInfo.name,
          photo: userInfo.photo ?? null,
        }
      : null,
    content,
    summary: createLocalMessageSummary(),
    date: new Date().toISOString(),
    deleted: false,
    has_quoted: Boolean(content.message_quoted_id),
    hash,
  };
};

const registerLocalMessage = async (
  content: ContentMessageChat,
  hash: string
) => {
  const entry = createLocalMessageEntry(content, hash);
  chatStore.initializeLocalMessageState(hash);
  chatStore.upsertLocalMessage(entry);
  await nextTick();
  scrollToBottomInChatLog();
};

const markUploadProgress = (hash: string, progress: number) => {
  chatStore.updateLocalMessageProgress(hash, progress);
};

const markUploadError = (hash: string, message?: string) => {
  chatStore.markLocalMessageError(hash, message);
};

const getComposerMessage = (): string | null => {
  if (!msg.value) return null;
  return msg.value.trim().length > 0 ? msg.value : null;
};
function formatRecordingLabel(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

const formattedRecordingTime = computed(() => {
  if (!isRecordingAudio.value && !audioRecordingElapsedMs.value) {
    return '00:00';
  }
  return formatRecordingLabel(audioRecordingElapsedMs.value) ?? '00:00';
});
const forceReflow = (el: HTMLElement): number => el.offsetWidth;

const scrollToBottomInChatLog = async (smooth: boolean = false) => {
  if (!chatLogPS.value) return;

  const scrollEl = chatLogPS.value.$el || chatLogPS.value;
  if (!scrollEl) return;

  const psContainer =
    (scrollEl.querySelector('.ps') as HTMLElement) ||
    (scrollEl.closest('.ps') as HTMLElement) ||
    scrollEl;

  if (!psContainer) return;

  const foundElement =
    (psContainer.querySelector('.ps__rail-y')?.parentElement as HTMLElement) ||
    (psContainer.querySelector('.ps__container') as HTMLElement) ||
    psContainer;

  if (!foundElement) return;

  foundElement.scrollTop = foundElement.scrollHeight;

  await nextTick();

  requestAnimationFrame(() => {
    foundElement.scrollTop = foundElement.scrollHeight;
    chatLogPS.value?.update?.();
  });
};

const highlightedMessageTimers = new Map<string, number>();

const applyPersistentHighlight = (target: HTMLElement, id: string) => {
  target.classList.add('message-target-persistent');

  const chatContent = target.querySelector('.chat-content') as HTMLElement;
  if (chatContent) {
    chatContent.classList.add('message-target-persistent-content');
  }

  const existingTimer = highlightedMessageTimers.get(id);
  if (existingTimer) clearTimeout(existingTimer);

  const timeoutId = globalThis.setTimeout(() => {
    target.classList.remove('message-target-persistent');
    if (chatContent) {
      chatContent.classList.remove('message-target-persistent-content');
    }
    highlightedMessageTimers.delete(id);
  }, 30_000) as unknown as number;

  highlightedMessageTimers.set(id, timeoutId);
};

const isMessageLoaded = (id: string): boolean =>
  chatStore.listMessages.some((message) => message.message_id === id);

const isMessageLoadedByKeyId = (keyId: string): boolean =>
  chatStore.listMessages.some((message) => message.message_key?.id === keyId);

const findMessageIdByKeyId = (keyId: string): string | null => {
  const message = chatStore.listMessages.find(
    (m) => m.message_key?.id === keyId
  );
  return message?.message_id || null;
};

const checkMessageLoaded = (id: string, isUuid: boolean): boolean => {
  return isUuid ? isMessageLoaded(id) : isMessageLoadedByKeyId(id);
};

const ensureMessageLoaded = async (id: string): Promise<boolean> => {
  if (!id) return false;

  const isUuid = !!id.match(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );

  if (checkMessageLoaded(id, isUuid)) return true;

  while (chatStore.currentPage < chatStore.totalPages) {
    const loaded = await chatStore.loadMoreMessages();
    if (!loaded) break;
    await nextTick();

    if (checkMessageLoaded(id, isUuid)) return true;
  }

  return checkMessageLoaded(id, isUuid);
};

const scrollToMessageById = async (
  id?: string,
  options: { highlight?: boolean } = {}
) => {
  await nextTick();

  const container: HTMLElement = chatLogPS.value?.$el || chatLogPS.value;
  if (!container) return;

  if (!id) {
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    chatLogPS.value?.update?.();

    return;
  }

  const isUuid = !!id.match(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );

  let targetMessageId = id;
  if (isUuid) {
    const messageReady = await ensureMessageLoaded(targetMessageId);
    if (!messageReady) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      chatLogPS.value?.update?.();
      return;
    }
  } else {
    await ensureMessageLoaded(id);

    const foundMessageId = findMessageIdByKeyId(id);
    if (foundMessageId) {
      targetMessageId = foundMessageId;
    }
  }

  await nextTick();

  let target =
    (container.querySelector(
      `[data-message-id="${targetMessageId}"]`
    ) as HTMLElement) ||
    (document.getElementById(`msg-${targetMessageId}`) as HTMLElement);

  if (!target && !isUuid) {
    const message = chatStore.listMessages.find(
      (m) => m.message_key?.id === id
    );
    if (message) {
      target =
        (container.querySelector(
          `[data-message-id="${message.message_id}"]`
        ) as HTMLElement) ||
        (document.getElementById(`msg-${message.message_id}`) as HTMLElement);
    }
  }

  if (target) {
    const top = getOffsetTop(container, target) - 60;

    container.scrollTo({ top, behavior: 'auto' });

    requestAnimationFrame(() => {
      container.scrollTo({ top, behavior: 'smooth' });
      chatLogPS.value?.update?.();

      if (options.highlight) {
        target.classList.remove(
          'message-target-flash',
          'message-target-persistent'
        );
        const existingChatContent = target.querySelector(
          '.chat-content'
        ) as HTMLElement;
        if (existingChatContent) {
          existingChatContent.classList.remove(
            'message-target-persistent-content'
          );
        }

        applyPersistentHighlight(target, targetMessageId);
      }
    });

    return;
  }

  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  chatLogPS.value?.update?.();
};

const highlightAndScrollToMessage = async (id: string) => {
  if (!id) return;
  await scrollToMessageById(id, { highlight: true });
};

const startConversation = () => {
  if (vuetifyDisplays.mdAndUp.value) return;
  isLeftSidebarOpen.value = true;
};

const createImageFormData = (
  photo: ISelectedPhotoPreview,
  messageValue: string | null,
  quotedId: string | null,
  hash: string
): FormData => {
  const formData = new FormData();
  formData.append('type', EMessageType.image);
  if (messageValue) {
    formData.append('message', messageValue);
  }

  if (quotedId) {
    formData.append('message_quoted_id', quotedId);
  }

  formData.append('images', photo.file);
  formData.append('hash', hash);

  return formData;
};

const createDocumentFormData = (
  doc: ISelectedDocumentPreview,
  messageValue: string | null,
  quotedId: string | null,
  hash: string
): FormData => {
  const formData = new FormData();
  formData.append('type', EMessageType.document);
  if (messageValue) {
    formData.append('message', messageValue);
  }

  if (quotedId) {
    formData.append('message_quoted_id', quotedId);
  }

  formData.append('documents', doc.file);
  formData.append('hash', hash);

  return formData;
};

const createVideoFormData = (
  video: ISelectedVideoPreview,
  messageValue: string | null,
  quotedId: string | null,
  hash: string
): FormData => {
  const formData = new FormData();
  formData.append('type', EMessageType.video);
  if (messageValue) {
    formData.append('message', messageValue);
  }

  if (quotedId) {
    formData.append('message_quoted_id', quotedId);
  }

  formData.append('videos', video.file);
  if (typeof video.duration === 'number' && !Number.isNaN(video.duration)) {
    formData.append('video_duration', Math.round(video.duration).toString());
  }

  formData.append('hash', hash);

  return formData;
};

const createAudioFormData = (
  audio: {
    blob: Blob;
    fileName: string;
    mimeType: string;
  },
  messageValue: string | null,
  quotedId: string | null,
  viewOnce: boolean,
  duration: number | null,
  hash: string,
  ptt: boolean = false
): FormData => {
  const formData = new FormData();
  formData.append('type', EMessageType.audio);
  if (messageValue) {
    formData.append('message', messageValue);
  }

  if (quotedId) {
    formData.append('message_quoted_id', quotedId);
  }

  formData.append('audios', audio.blob, audio.fileName);
  if (typeof duration === 'number' && !Number.isNaN(duration)) {
    formData.append('audio_duration', Math.round(duration).toString());
  }
  if (viewOnce) {
    formData.append('audio_view_once', 'true');
  }
  formData.append('audio_ptt', ptt ? 'true' : 'false');

  formData.append('hash', hash);

  return formData;
};

const createTextMessageBody = (
  hash: string,
  messageText?: string,
  linkPreviewData?: ViewLinkPreviewResponse | null,
  replyMessage?: ListMessageResult | null
): CreateMessageChatsBody => {
  const messageValue = messageText ?? msg.value;
  const preview = linkPreviewData ?? linkPreview.value;
  const replyId =
    replyMessage?.message_id ?? chatStore.messageReply?.message_id;

  const inputCreateMessage: CreateMessageChatsBody = {
    type: EMessageType.text,
    message: messageValue,
    link_preview: preview?.title
      ? (preview as ViewLinkPreviewResponse)
      : undefined,
    hash,
  };

  if (replyId) {
    inputCreateMessage.message_quoted_id = replyId;
  }

  return inputCreateMessage;
};

const revokeVideoPreview = (preview: string) => {
  if (preview && preview.startsWith('blob:')) {
    URL.revokeObjectURL(preview);
  }
};

const removeVideo = (index: number) => {
  const video = selectedVideos.value[index];
  if (video) {
    revokeVideoPreview(video.preview);
  }
  selectedVideos.value.splice(index, 1);
};

const clearSelectedVideos = () => {
  selectedVideos.value = [];
};

const clearSelectedAudios = () => {
  for (const audio of selectedAudios.value) {
    if (audio.preview && audio.preview.startsWith('blob:')) {
      URL.revokeObjectURL(audio.preview);
    }
  }
  selectedAudios.value = [];
};

const clearSelectedContacts = () => {
  selectedContacts.value = [];
};

const clearMessageFields = () => {
  msg.value = '';
  linkPreview.value = null;
  clearSelectedVideos();
  clearSelectedAudios();
  clearSelectedContacts();
  selectedPhotos.value = [];
  selectedDocuments.value = [];
  selectedLocation.value = null;
  chatStore.clearMessageReply();
};

const canSendMessage = (): boolean => {
  return !!(
    msg.value ||
    selectedPhotos.value.length > 0 ||
    selectedDocuments.value.length > 0 ||
    selectedVideos.value.length > 0 ||
    selectedAudios.value.length > 0 ||
    selectedContacts.value.length > 0 ||
    selectedLocation.value !== null
  );
};

const hasActiveChat = (): boolean => {
  return !!chatStore.activeChat?.worker?.id;
};

const sendImageMessage = async (
  photosToSend?: ISelectedPhotoPreview[],
  messageText?: string | null,
  replyMessage?: ListMessageResult | null
): Promise<void> => {
  if (!chatStore.activeChat?.chat_id) return;
  const photos = photosToSend ?? [...selectedPhotos.value];
  if (photos.length === 0) return;

  const replyId =
    replyMessage?.message_id ?? chatStore.messageReply?.message_id ?? null;
  const quotedPayload = getQuotedContent(replyMessage || null);
  const messageValue = messageText ?? getComposerMessage();

  const messagesWithHashes = await Promise.all(
    photos.map(async (photo) => {
      const hash = createMessageHash();
      const extension = (photo.file.name.split('.').pop() || '').toLowerCase();
      const content: ContentMessageChat = {
        type: EMessageType.image,
        message: messageValue,
        message_quoted_id: replyId ?? undefined,
        quoted: quotedPayload,
        image: {
          url: photo.preview,
          caption: messageValue,
          mimetype: photo.file.type,
          size: photo.file.size,
          extension: extension || null,
        },
      };

      await registerLocalMessage(content, hash);
      return { photo, hash };
    })
  );

  await Promise.all(
    messagesWithHashes.map(async ({ photo, hash }) => {
      const formData = createImageFormData(photo, messageValue, replyId, hash);

      const success = await chatStore.createMessageWithImages(formData, {
        skipLoading: true,
        onUploadProgress: (progress) => {
          markUploadProgress(hash, progress);
        },
      });

      if (!success) {
        markUploadError(hash);
      }
    })
  );
};

const sendVideoMessage = async (
  videosToSend?: ISelectedVideoPreview[],
  messageText?: string | null,
  replyMessage?: ListMessageResult | null
): Promise<void> => {
  if (!chatStore.activeChat?.chat_id) return;
  const videos = videosToSend ?? [...selectedVideos.value];
  if (videos.length === 0) return;

  const replyId =
    replyMessage?.message_id ?? chatStore.messageReply?.message_id ?? null;
  const quotedPayload = getQuotedContent(replyMessage || null);
  const messageValue = messageText ?? getComposerMessage();

  const messagesWithHashes = await Promise.all(
    videos.map(async (video) => {
      const hash = createMessageHash();
      const extension = (video.name.split('.').pop() || '').toLowerCase();
      const content: ContentMessageChat = {
        type: EMessageType.video,
        message: messageValue,
        message_quoted_id: replyId ?? undefined,
        quoted: quotedPayload,
        video: {
          url: video.preview,
          caption: messageValue,
          mimetype: video.type,
          size: video.size,
          duration: video.duration ?? null,
          name: video.name,
          extension: extension || null,
        },
      };

      await registerLocalMessage(content, hash);
      return { video, hash };
    })
  );

  await Promise.all(
    messagesWithHashes.map(async ({ video, hash }) => {
      const formData = createVideoFormData(video, messageValue, replyId, hash);

      const success = await chatStore.createMessageWithVideos(formData, {
        skipLoading: true,
        onUploadProgress: (progress) => {
          markUploadProgress(hash, progress);
        },
      });

      if (!success) {
        markUploadError(hash);
      }
    })
  );
};

const sendAudioMessage = async (
  blob: Blob,
  mimeType: string,
  duration: number | null,
  viewOnce: boolean,
  messageText?: string | null,
  replyMessage?: ListMessageResult | null
): Promise<void> => {
  if (!chatStore.activeChat?.chat_id) return;

  if (blob.size > MAX_AUDIO_SIZE_BYTES) {
    chatStore.showSnackbar(t('audio_size_exceeded'), EColor.error);
    return;
  }

  const replyId =
    replyMessage?.message_id ?? chatStore.messageReply?.message_id ?? null;
  const quotedPayload = getQuotedContent(replyMessage || null);
  const messageValue = messageText ?? getComposerMessage();
  const hash = createMessageHash();

  let extensionFromMime =
    mimeType.split('/')[1]?.split(';')[0]?.trim() || 'ogg';

  const mimeToExtension: Record<string, string> = {
    mpeg: 'mp3',
    mp3: 'mp3',
    aac: 'aac',
    m4a: 'm4a',
    'x-m4a': 'm4a',
    amr: 'amr',
    'amr-wb': 'amr',
    ogg: 'ogg',
    opus: 'opus',
  };

  extensionFromMime = mimeToExtension[extensionFromMime] || extensionFromMime;
  const fileName = `audio-${Date.now()}.${extensionFromMime}`;
  const localUrl = URL.createObjectURL(blob);

  const content: ContentMessageChat = {
    type: EMessageType.audio,
    message: messageValue,
    message_quoted_id: replyId ?? undefined,
    quoted: quotedPayload,
    audio: {
      url: localUrl,
      name: fileName,
      mimetype: mimeType,
      size: blob.size,
      duration: duration ?? null,
      extension: extensionFromMime,
      view_once: viewOnce ? true : undefined,
    },
  };

  await registerLocalMessage(content, hash);

  const formData = createAudioFormData(
    { blob, fileName, mimeType },
    messageValue,
    replyId,
    viewOnce,
    duration,
    hash,
    true
  );

  const success = await chatStore.createMessageWithAudios(formData, {
    skipLoading: true,
    onUploadProgress: (progress) => {
      markUploadProgress(hash, progress);
    },
  });

  if (!success) {
    markUploadError(hash);
    return;
  }
  chatStore.clearMessageReply();
};

const sendAudioFilesMessage = async (
  audiosToSend?: ISelectedAudioPreview[],
  messageText?: string | null,
  replyMessage?: ListMessageResult | null
): Promise<void> => {
  if (!chatStore.activeChat?.chat_id) return;
  const audios = audiosToSend ?? [...selectedAudios.value];
  if (audios.length === 0) return;

  const replyId =
    replyMessage?.message_id ?? chatStore.messageReply?.message_id ?? null;
  const quotedPayload = getQuotedContent(replyMessage || null);
  const messageValue = messageText ?? getComposerMessage();

  const messagesWithHashes = await Promise.all(
    audios.map(async (audio) => {
      const hash = createMessageHash();
      const extension = (audio.name.split('.').pop() || '').toLowerCase();
      const content: ContentMessageChat = {
        type: EMessageType.audio,
        message: messageValue,
        message_quoted_id: replyId ?? undefined,
        quoted: quotedPayload,
        audio: {
          url: audio.preview,
          mimetype: audio.type,
          size: audio.size,
          duration: audio.duration ?? null,
          name: audio.name,
          extension: extension || null,
        },
      };

      await registerLocalMessage(content, hash);
      return { audio, hash };
    })
  );

  await Promise.all(
    messagesWithHashes.map(async ({ audio, hash }) => {
      const formData = createAudioFormData(
        {
          blob: audio.file,
          fileName: audio.name,
          mimeType: audio.type,
        },
        messageValue,
        replyId,
        false,
        audio.duration,
        hash,
        false
      );

      const success = await chatStore.createMessageWithAudios(formData, {
        skipLoading: true,
        onUploadProgress: (progress) => {
          markUploadProgress(hash, progress);
        },
      });

      if (!success) {
        markUploadError(hash);
      }
    })
  );
};

const sendDocumentMessage = async (
  documentsToSend?: ISelectedDocumentPreview[],
  messageText?: string | null,
  replyMessage?: ListMessageResult | null
): Promise<void> => {
  if (!chatStore.activeChat?.chat_id) return;
  const docs = documentsToSend ?? [...selectedDocuments.value];
  if (docs.length === 0) return;

  const replyId =
    replyMessage?.message_id ?? chatStore.messageReply?.message_id ?? null;
  const quotedPayload = getQuotedContent(replyMessage || null);
  const messageValue = messageText ?? getComposerMessage();

  const messagesWithHashes = await Promise.all(
    docs.map(async (doc) => {
      const hash = createMessageHash();
      const localUrl = URL.createObjectURL(doc.file);
      const content: ContentMessageChat = {
        type: EMessageType.document,
        message: messageValue,
        message_quoted_id: replyId ?? undefined,
        quoted: quotedPayload,
        document: {
          url: localUrl,
          name: doc.name,
          mimetype: doc.type,
          extension: doc.extension,
          size: doc.size,
        },
      };

      await registerLocalMessage(content, hash);
      return { doc, hash };
    })
  );

  await Promise.all(
    messagesWithHashes.map(async ({ doc, hash }) => {
      const formData = createDocumentFormData(doc, messageValue, replyId, hash);

      const success = await chatStore.createMessageWithDocuments(formData, {
        skipLoading: true,
        onUploadProgress: (progress) => {
          markUploadProgress(hash, progress);
        },
      });

      if (!success) {
        markUploadError(hash);
      }
    })
  );
};

const sendContactsMessage = async (
  contactsToSend?: ISelectedContactPreview[],
  messageText?: string | null,
  replyMessage?: ListMessageResult | null
): Promise<void> => {
  if (!chatStore.activeChat?.chat_id) return;
  const contacts = contactsToSend ?? [...selectedContacts.value];
  if (contacts.length === 0) return;

  const replyId =
    replyMessage?.message_id ?? chatStore.messageReply?.message_id ?? null;
  const quotedPayload = getQuotedContent(replyMessage || null);
  const messageValue = messageText ?? getComposerMessage();

  const messagesWithHashes = await Promise.all(
    contacts.map(async (contact) => {
      const hash = createMessageHash();
      const content: ContentMessageChat = {
        type: EMessageType.contact_card,
        message: messageValue,
        message_quoted_id: replyId ?? undefined,
        quoted: quotedPayload,
        contact: {
          contact_id: contact.contact_id,
          name: contact.name,
          last_name: contact.last_name ?? null,
          phone: contact.phone_partial ?? null,
          email_partial: contact.email_partial ?? null,
        },
      };

      await registerLocalMessage(content, hash);
      return { contact, hash };
    })
  );

  await Promise.all(
    messagesWithHashes.map(async ({ contact, hash }) => {
      const formData = new FormData();
      formData.append('type', EMessageType.contact_card);
      if (messageValue) {
        formData.append('message', messageValue);
      }
      if (replyId) {
        formData.append('message_quoted_id', replyId);
      }
      formData.append('contacts', contact.contact_id);
      formData.append('hash', hash);

      const success = await chatStore.createMessageWithContacts(formData, {
        skipLoading: true,
      });

      if (!success) {
        markUploadError(hash);
      }
    })
  );

  if (contactsToSend === undefined) {
    chatStore.clearMessageReply();
    clearSelectedContacts();
  }
};

const sendLocationMessage = async (
  locationToSend?: typeof selectedLocation.value,
  messageText?: string | null,
  replyMessage?: ListMessageResult | null
): Promise<void> => {
  if (!chatStore.activeChat?.chat_id) return;
  const location = locationToSend ?? selectedLocation.value;
  if (!location) return;

  const hash = createMessageHash();
  const replyId =
    replyMessage?.message_id ?? chatStore.messageReply?.message_id ?? null;
  const quotedPayload = getQuotedContent(replyMessage || null);
  const messageValue = messageText ?? getComposerMessage();

  const content: ContentMessageChat = {
    type: EMessageType.location,
    message: messageValue,
    message_quoted_id: replyId ?? undefined,
    quoted: quotedPayload,
    location: {
      latitude: location.latitude,
      longitude: location.longitude,
      name: location.name ?? null,
      address: location.address ?? null,
    },
  };

  await registerLocalMessage(content, hash);

  const formData = new FormData();
  formData.append('type', EMessageType.location);
  if (messageValue) {
    formData.append('message', messageValue);
  }
  if (replyId) {
    formData.append('message_quoted_id', replyId);
  }
  formData.append('location_latitude', location.latitude.toString());
  formData.append('location_longitude', location.longitude.toString());
  if (location.name) {
    formData.append('location_name', location.name);
  }
  if (location.address) {
    formData.append('location_address', location.address);
  }
  formData.append('hash', hash);

  const success = await chatStore.createMessageWithLocation(formData, {
    skipLoading: true,
  });

  if (!success) {
    markUploadError(hash);
  }

  if (locationToSend === undefined) {
    chatStore.clearMessageReply();
    selectedLocation.value = null;
  }
};

const onContactsSelected = (contacts: ISelectedContactPreview[]) => {
  const existingIds = new Set(selectedContacts.value.map((c) => c.contact_id));
  const newContacts = contacts.filter((c) => !existingIds.has(c.contact_id));
  selectedContacts.value = [...selectedContacts.value, ...newContacts];
};

const sendTextMessage = async (
  messageText?: string,
  linkPreviewData?: ViewLinkPreviewResponse | null,
  replyMessage?: ListMessageResult | null
): Promise<void> => {
  if (!chatStore.activeChat?.chat_id) return;
  const hash = createMessageHash();
  const messageValue = messageText ?? msg.value;
  const replyId =
    replyMessage?.message_id ?? chatStore.messageReply?.message_id ?? null;

  const quotedPayload = getQuotedContent(replyMessage || null);
  const preview = linkPreviewData ?? cloneLinkPreview();

  const content: ContentMessageChat = {
    type: EMessageType.text,
    message: messageValue,
    message_quoted_id: replyId ?? undefined,
    quoted: quotedPayload,
    link_preview: preview,
  };

  await registerLocalMessage(content, hash);

  const messageBody = createTextMessageBody(
    hash,
    messageValue,
    preview,
    replyMessage || null
  );
  const success = await chatStore.createMessage(messageBody);

  if (!success) {
    markUploadError(hash);
  }
};

const finalizeSend = () => {
  nextTick(() => {
    const scrollEl = chatLogPS.value?.$el || chatLogPS.value;
    if (scrollEl) {
      const scrollTop = scrollEl.scrollTop;
      const scrollHeight = scrollEl.scrollHeight;
      const clientHeight = scrollEl.clientHeight;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      const isNearBottom = distanceFromBottom < 200;

      scrollToBottomInChatLog(!isNearBottom);
    } else {
      scrollToBottomInChatLog(true);
    }

    setTimeout(() => {
      const scrollEl = chatLogPS.value?.$el || chatLogPS.value;
      if (scrollEl) {
        scrollEl.scrollTop = scrollEl.scrollHeight;
        chatLogPS.value?.update?.();
      }
    }, 300);
  });
};

const sendMessage = async () => {
  if (!canSendMessage()) return;
  if (!hasActiveChat()) return;
  if (isQueueStatus.value) return;

  const savedMsg = msg.value;
  const savedLinkPreview = linkPreview.value ? { ...linkPreview.value } : null;
  const savedPhotos = [...selectedPhotos.value];
  const savedDocuments = [...selectedDocuments.value];
  const savedVideos = [...selectedVideos.value];
  const savedAudios = [...selectedAudios.value];
  const savedContacts = [...selectedContacts.value];
  const savedLocation = selectedLocation.value;
  const savedReply = chatStore.messageReply;

  chatStore.clearMessageReply();

  msg.value = '';
  linkPreview.value = null;
  clearSelectedVideos();
  clearSelectedAudios();
  clearSelectedContacts();
  selectedPhotos.value = [];
  selectedDocuments.value = [];
  selectedLocation.value = null;

  if (savedDocuments.length > 0) {
    await sendDocumentMessage(
      savedDocuments,
      savedMsg,
      savedReply || undefined
    );
    finalizeSend();
    return;
  }

  if (savedVideos.length > 0) {
    await sendVideoMessage(savedVideos, savedMsg, savedReply || undefined);
    finalizeSend();
    return;
  }

  if (savedAudios.length > 0) {
    await sendAudioFilesMessage(savedAudios, savedMsg, savedReply || undefined);
    finalizeSend();
    return;
  }

  if (savedContacts.length > 0) {
    await sendContactsMessage(savedContacts, savedMsg, savedReply || undefined);
    finalizeSend();
    return;
  }

  if (savedLocation) {
    await sendLocationMessage(savedLocation, savedMsg, savedReply || undefined);
    finalizeSend();
    return;
  }

  if (savedPhotos.length > 0) {
    await sendImageMessage(savedPhotos, savedMsg, savedReply || undefined);
    finalizeSend();
    return;
  }

  await sendTextMessage(savedMsg, savedLinkPreview, savedReply || undefined);

  finalizeSend();
};

const openChat = async (chatId: ListChatsResult['chat_id']) => {
  if (chatStore.activeChat?.chat_id === chatId) return;

  if (chatLogPS.value) {
    const scrollEl = chatLogPS.value.$el || chatLogPS.value;
    if (scrollEl) {
      scrollEl.scrollTop = 0;
    }
  }

  chatStore.setActiveChat(chatId);

  const requestQueue: ListMessageChatsQuery = {
    current_page: currentPage.value,
    per_page: perPage.value,
  };

  await chatStore.getChatById(requestQueue);

  if (vuetifyDisplays.smAndDown.value) {
    isLeftSidebarOpen.value = false;
  }

  await nextTick();

  requestAnimationFrame(() => {
    scrollToBottomInChatLog();
  });
};

const chatContentContainerBg = computed(() => {
  let color = 'transparent';

  if (themes) {
    color = themes?.[name.value].colors?.background as string;
  }

  return color;
});

const previewDomain = computed(() => {
  const u =
    linkPreview.value?.['canonical-url'] ||
    linkPreview.value?.['matched-text'] ||
    '';
  if (!u) return '';
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
});

const previewHref = computed(() => {
  return (
    linkPreview.value?.['canonical-url'] ||
    linkPreview.value?.['matched-text'] ||
    ''
  );
});

const previewImage = computed(() => {
  const p = linkPreview.value;
  if (!p) {
    return null;
  }
  const cand =
    p.highQualityThumbnail || p.originalThumbnailUrl || p.jpegThumbnail || '';
  if (!cand) return null;
  if (cand.startsWith('http')) return cand;
  return `data:image/jpeg;base64,${cand}`;
});

const openAttach = (
  type: 'document' | 'photo' | 'video' | 'audio' | 'contact' | 'location'
) => {
  switch (type) {
    case 'document':
      fileDocRef.value?.click();
      break;
    case 'photo':
      filePhotoRef.value?.click();
      break;
    case 'video':
      fileVideoRef.value?.click();
      break;
    case 'audio':
      fileAudioRef.value?.click();
      break;
    case 'contact':
      if (canAccessContacts.value) {
        isContactPickerOpen.value = true;
      }
      break;
    case 'location':
      isLocationPickerOpen.value = true;
      break;
  }
};

const onPickDoc = (e: Event) => {
  const target = e.target as HTMLInputElement;
  const files = target.files;

  if (!files || files.length === 0) {
    target.value = '';
    return;
  }

  if (selectedVideos.value.length > 0) {
    chatStore.showSnackbar(t('clear_videos_before_documents'), EColor.warning);
    target.value = '';
    return;
  }

  if (selectedPhotos.value.length > 0) {
    chatStore.showSnackbar(t('clear_images_before_documents'), EColor.warning);
    target.value = '';
    return;
  }

  const limit = 10;
  const currentCount = selectedDocuments.value.length;
  if (currentCount >= limit) {
    chatStore.showSnackbar(t('max_documents_selected'), EColor.warning);
    target.value = '';
    return;
  }

  const spaceLeft = limit - currentCount;
  const filesArray = Array.from(files);
  const filesToAdd = filesArray.slice(0, spaceLeft);
  if (filesArray.length > spaceLeft) {
    chatStore.showSnackbar(
      t('can_select_more_documents', { count: spaceLeft }),
      EColor.warning
    );
  }

  const oversizedDocs = filesToAdd.filter(
    (file) => file.size > MAX_DOCUMENT_SIZE_BYTES
  );
  const validDocs = filesToAdd.filter(
    (file) => file.size <= MAX_DOCUMENT_SIZE_BYTES
  );

  if (oversizedDocs.length > 0) {
    chatStore.showSnackbar(t('document_size_exceeded'), EColor.error);
  }

  for (const file of validDocs) {
    selectedDocuments.value.push({
      file,
      name: file.name,
      size: file.size,
      extension: (file.name.split('.').pop() || '').toLowerCase(),
      type: file.type,
    });
  }

  target.value = '';
};
const onPickPhoto = (e: Event) => {
  const target = e.target as HTMLInputElement;
  const files = target.files;

  if (!files || files.length === 0) {
    target.value = '';
    return;
  }

  if (selectedVideos.value.length > 0) {
    chatStore.showSnackbar(t('clear_videos_before_images'), EColor.warning);
    target.value = '';
    return;
  }

  if (selectedDocuments.value.length > 0) {
    chatStore.showSnackbar(t('clear_documents_before_images'), EColor.warning);
    target.value = '';
    return;
  }

  const allowedImageTypes = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
  ]);
  const allowedExtensions = new Set(['jpg', 'jpeg', 'png', 'gif']);

  const imageFiles = Array.from(files).filter((file) => {
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    return (
      allowedImageTypes.has(file.type) ||
      (fileExtension && allowedExtensions.has(fileExtension))
    );
  });

  if (imageFiles.length === 0) {
    chatStore.showSnackbar(t('invalid_image_format'), EColor.error);
    target.value = '';
    return;
  }

  const invalidImages = Array.from(files).filter((file) => {
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    return (
      !allowedImageTypes.has(file.type) &&
      (!fileExtension || !allowedExtensions.has(fileExtension))
    );
  });

  if (invalidImages.length > 0) {
    chatStore.showSnackbar(t('invalid_image_format'), EColor.error);
  }

  const oversizedImages = imageFiles.filter(
    (file) => file.size > MAX_IMAGE_SIZE_BYTES
  );
  const validImages = imageFiles.filter(
    (file) => file.size <= MAX_IMAGE_SIZE_BYTES
  );

  if (oversizedImages.length > 0) {
    chatStore.showSnackbar(t('image_size_exceeded'), EColor.error);
  }

  if (validImages.length === 0) {
    target.value = '';
    return;
  }

  const currentCount = selectedPhotos.value.length;
  const totalAfterSelection = currentCount + validImages.length;

  if (totalAfterSelection > 10) {
    chatStore.showSnackbar(t('max_images_selected'), EColor.warning);
    target.value = '';
    return;
  }

  const remainingSlots = 10 - currentCount;

  if (validImages.length > remainingSlots) {
    chatStore.showSnackbar(
      t('can_select_more_images', { count: remainingSlots }),
      EColor.warning
    );
    target.value = '';
    return;
  }

  for (const file of validImages) {
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        selectedPhotos.value.push({
          file,
          preview: event.target.result as string,
        });
      }
    };
    reader.readAsDataURL(file);
  }

  target.value = '';
};
const getVideoDuration = (src: string): Promise<number | null> =>
  new Promise((resolve) => {
    const videoEl = document.createElement('video');
    const clean = () => {
      videoEl.removeAttribute('src');
      videoEl.load();
      videoEl.remove();
    };

    videoEl.preload = 'metadata';
    videoEl.muted = true;
    videoEl.onloadedmetadata = () => {
      const dur = Number.isFinite(videoEl.duration) ? videoEl.duration : null;
      clean();
      resolve(dur);
    };
    videoEl.onerror = () => {
      clean();
      resolve(null);
    };
    videoEl.src = src;
  });

const getAudioDuration = (src: string): Promise<number | null> =>
  new Promise((resolve) => {
    const audioEl = document.createElement('audio');
    const clean = () => {
      audioEl.removeAttribute('src');
      audioEl.load();
      audioEl.remove();
    };

    audioEl.preload = 'metadata';
    audioEl.onloadedmetadata = () => {
      const dur = Number.isFinite(audioEl.duration) ? audioEl.duration : null;
      clean();
      resolve(dur);
    };
    audioEl.onerror = () => {
      clean();
      resolve(null);
    };
    audioEl.src = src;
  });

const updateRecordingElapsed = () => {
  if (audioRecordingStartAt.value === null) {
    audioRecordingElapsedMs.value = audioRecordingAccumulated.value;
    return;
  }
  audioRecordingElapsedMs.value =
    audioRecordingAccumulated.value +
    (performance.now() - audioRecordingStartAt.value);
};

const setupAudioCanvas = () => {
  const canvas = audioCanvasRef.value;
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.offsetWidth * dpr;
  const height = canvas.offsetHeight * dpr;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
};

const drawAudioWaveform = () => {
  if (!isRecordingAudio.value || !audioAnalyserRef.value) {
    return;
  }
  const analyser = audioAnalyserRef.value;
  const canvas = audioCanvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const bufferLength = analyser.fftSize;
  if (
    !audioDataArrayRef.value ||
    audioDataArrayRef.value.length !== bufferLength
  ) {
    audioDataArrayRef.value = new Uint8Array(bufferLength);
  }

  const byteArray = audioDataArrayRef.value!;
  analyser.getByteTimeDomainData(
    byteArray as unknown as Uint8Array<ArrayBuffer>
  );
  setupAudioCanvas();

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(34, 197, 94, 0.95)';
  ctx.fillStyle = 'rgba(34, 197, 94, 0.15)';
  ctx.beginPath();

  const data = byteArray;
  const sliceWidth = width / bufferLength;
  let x = 0;
  const centerY = height / 2;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.strokeStyle = 'rgba(34, 197, 94, 0.35)';
  ctx.stroke();

  ctx.beginPath();
  ctx.strokeStyle = 'rgba(34, 197, 94, 0.9)';

  for (let i = 0; i < bufferLength; i += 4) {
    const v = data[i] / 128;
    const y = (v * height) / 2;
    if (i === 0) {
      ctx.moveTo(x, y);
    }
    if (i !== 0) {
      ctx.lineTo(x, y);
    }
    x += sliceWidth * 4;
  }

  ctx.stroke();
  ctx.restore();

  audioRecordingRAFId.value = requestAnimationFrame(drawAudioWaveform);
};

const releaseAudioResources = () => {
  if (audioRecordingTimerId.value) {
    clearInterval(audioRecordingTimerId.value);
    audioRecordingTimerId.value = null;
  }
  if (audioRecordingRAFId.value) {
    cancelAnimationFrame(audioRecordingRAFId.value);
    audioRecordingRAFId.value = null;
  }
  if (audioStreamRef.value) {
    for (const track of audioStreamRef.value.getTracks()) {
      track.stop();
    }
    audioStreamRef.value = null;
  }
  if (audioContextRef.value) {
    audioContextRef.value.close().catch(() => null);
    audioContextRef.value = null;
  }
  audioAnalyserRef.value = null;
  audioDataArrayRef.value = null;
  mediaRecorderRef.value = null;
};

const resetRecordingState = () => {
  isRecordingAudio.value = false;
  isRecordingPaused.value = false;
  audioViewOnce.value = false;
  audioPendingViewOnce.value = false;
  audioRecordingStartAt.value = null;
  audioRecordingAccumulated.value = 0;
  audioRecordingElapsedMs.value = 0;
  audioRecordingDurationSeconds.value = null;
  audioChunksRef.value = [];
};

const handleRecorderStop = async (
  savedMessageText?: string | null,
  savedReply?: ListMessageResult | null
) => {
  const recorder = mediaRecorderRef.value;
  const saveRecording = shouldPersistRecording.value;
  shouldPersistRecording.value = false;

  if (!saveRecording && recordedAudioUrl.value) {
    URL.revokeObjectURL(recordedAudioUrl.value);
    recordedAudioUrl.value = null;
  }

  if (saveRecording && recorder && audioChunksRef.value.length > 0) {
    let mimeType = recorder.mimeType || 'audio/ogg;codecs=opus';

    const allowedMimeTypes = [
      'audio/mpeg',
      'audio/mp3',
      'audio/aac',
      'audio/m4a',
      'audio/x-m4a',
      'audio/amr',
      'audio/amr-wb',
      'audio/ogg',
      'audio/opus',
    ];

    const baseMimeType = mimeType.split(';')[0].trim();
    const isAllowed = allowedMimeTypes.some((allowed) => {
      return mimeType === allowed || baseMimeType === allowed;
    });

    if (!isAllowed) {
      mimeType = 'audio/ogg;codecs=opus';
    }

    const blob = new Blob(audioChunksRef.value, { type: mimeType });
    recordedAudioBlob.value = blob;
    if (recordedAudioUrl.value) URL.revokeObjectURL(recordedAudioUrl.value);
    recordedAudioUrl.value = URL.createObjectURL(blob);
    audioRecordingDurationSeconds.value = Math.round(
      audioRecordingElapsedMs.value / 1000
    );

    const audioWithinLimit = blob.size <= MAX_AUDIO_SIZE_BYTES;
    if (!audioWithinLimit) {
      chatStore.showSnackbar(t('audio_size_exceeded'), EColor.error);
      if (recordedAudioUrl.value) {
        URL.revokeObjectURL(recordedAudioUrl.value);
      }
      recordedAudioUrl.value = null;
    }
    if (audioWithinLimit) {
      await sendAudioMessage(
        blob,
        mimeType,
        audioRecordingDurationSeconds.value,
        audioPendingViewOnce.value,
        savedMessageText,
        savedReply || undefined
      );
      recordedAudioUrl.value = null;
    }
    recordedAudioBlob.value = null;
  }

  releaseAudioResources();

  audioViewOnce.value = false;
  audioPendingViewOnce.value = false;
  audioRecordingStartAt.value = null;
  audioRecordingAccumulated.value = 0;
  audioRecordingElapsedMs.value = 0;
  audioRecordingDurationSeconds.value = null;
  audioChunksRef.value = [];
};

let savedMessageTextForRecording: string | null | undefined = undefined;
let savedReplyForRecording: ListMessageResult | null | undefined = undefined;

const stopAudioRecordingInternal = (
  savedMessageText?: string | null,
  savedReply?: ListMessageResult | null
) => {
  savedMessageTextForRecording = savedMessageText;
  savedReplyForRecording = savedReply;

  if (audioRecordingStartAt.value !== null) {
    audioRecordingAccumulated.value +=
      performance.now() - audioRecordingStartAt.value;
    audioRecordingStartAt.value = null;
  }
  updateRecordingElapsed();

  if (mediaRecorderRef.value) {
    mediaRecorderRef.value.onstop = (_ev: Event) => {
      void handleRecorderStop(
        savedMessageTextForRecording,
        savedReplyForRecording
      );
    };
    if (mediaRecorderRef.value.state !== 'inactive') {
      mediaRecorderRef.value.stop();
      return;
    }
  }

  void handleRecorderStop(savedMessageTextForRecording, savedReplyForRecording);
};

const cancelAudioRecording = () => {
  if (!isRecordingAudio.value && !mediaRecorderRef.value) {
    return;
  }

  isRecordingAudio.value = false;
  isRecordingPaused.value = false;

  if (audioRecordingTimerId.value) {
    clearInterval(audioRecordingTimerId.value);
    audioRecordingTimerId.value = null;
  }
  if (audioRecordingRAFId.value) {
    cancelAnimationFrame(audioRecordingRAFId.value);
    audioRecordingRAFId.value = null;
  }

  shouldPersistRecording.value = false;
  stopAudioRecordingInternal();
};

const finalizeAudioRecording = () => {
  if (!isRecordingAudio.value) return;

  const savedMsg = msg.value;
  const savedReply = chatStore.messageReply;

  msg.value = '';
  linkPreview.value = null;
  chatStore.clearMessageReply();

  isRecordingAudio.value = false;
  isRecordingPaused.value = false;

  if (audioRecordingTimerId.value) {
    clearInterval(audioRecordingTimerId.value);
    audioRecordingTimerId.value = null;
  }
  if (audioRecordingRAFId.value) {
    cancelAnimationFrame(audioRecordingRAFId.value);
    audioRecordingRAFId.value = null;
  }

  audioRecordingElapsedMs.value = 0;

  shouldPersistRecording.value = true;
  audioPendingViewOnce.value = audioViewOnce.value;
  void stopAudioRecordingInternal(savedMsg, savedReply);
};

const togglePauseAudioRecording = async () => {
  if (!isRecordingAudio.value || !mediaRecorderRef.value) return;

  if (!isRecordingPaused.value) {
    if (mediaRecorderRef.value.state === 'recording') {
      mediaRecorderRef.value.pause();
    }
    if (audioRecordingStartAt.value !== null) {
      audioRecordingAccumulated.value +=
        performance.now() - audioRecordingStartAt.value;
      audioRecordingStartAt.value = null;
      updateRecordingElapsed();
    }
    if (audioContextRef.value?.state === 'running') {
      await audioContextRef.value.suspend().catch(() => null);
    }
    if (audioRecordingRAFId.value) {
      cancelAnimationFrame(audioRecordingRAFId.value);
      audioRecordingRAFId.value = null;
    }
    isRecordingPaused.value = true;
    return;
  }
  if (mediaRecorderRef.value.state === 'paused') {
    mediaRecorderRef.value.resume();
  }
  if (audioContextRef.value?.state === 'suspended') {
    await audioContextRef.value.resume().catch(() => null);
  }
  audioRecordingStartAt.value = performance.now();
  updateRecordingElapsed();
  isRecordingPaused.value = false;
  drawAudioWaveform();
};

const toggleViewOnceAudio = () => {
  audioViewOnce.value = !audioViewOnce.value;
};

const startAudioRecording = async () => {
  if (isRecordingAudio.value) return;
  if (recordedAudioUrl.value) {
    URL.revokeObjectURL(recordedAudioUrl.value);
    recordedAudioUrl.value = null;
  }
  recordedAudioBlob.value = null;
  audioRecordingDurationSeconds.value = null;
  audioPendingViewOnce.value = false;

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      chatStore.showSnackbar(t('audio_recording_error'), EColor.error);
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioStreamRef.value = stream;

    const preferredMimeTypes = [
      'audio/ogg;codecs=opus',
      'audio/opus',
      'audio/ogg',
    ];

    let mediaRecorder: MediaRecorder | null = null;
    for (const mimeType of preferredMimeTypes) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        try {
          mediaRecorder = new MediaRecorder(stream, { mimeType });
          break;
        } catch {}
      }
    }

    if (!mediaRecorder) {
      mediaRecorder = new MediaRecorder(stream);
    }

    mediaRecorderRef.value = mediaRecorder;
    audioChunksRef.value = [];
    mediaRecorder.ondataavailable = (event) => {
      if (event.data?.size > 0) {
        audioChunksRef.value.push(event.data);
      }
    };
    mediaRecorder.onstop = (_ev: Event) => {
      void handleRecorderStop(
        savedMessageTextForRecording,
        savedReplyForRecording
      );
    };

    const audioCtx = new AudioContext();
    audioContextRef.value = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    audioAnalyserRef.value = analyser;
    source.connect(analyser);

    mediaRecorder.start(250);
    isRecordingAudio.value = true;
    isRecordingPaused.value = false;
    audioViewOnce.value = false;
    audioRecordingAccumulated.value = 0;
    audioRecordingElapsedMs.value = 0;
    audioRecordingStartAt.value = performance.now();
    updateRecordingElapsed();
    if (audioRecordingTimerId.value) {
      clearInterval(audioRecordingTimerId.value);
    }
    audioRecordingTimerId.value = globalThis.setInterval(
      updateRecordingElapsed,
      200
    ) as unknown as number;

    await nextTick(() => {
      setupAudioCanvas();
    });
    drawAudioWaveform();
  } catch (error: any) {
    releaseAudioResources();
    resetRecordingState();
    const message =
      error?.name === 'NotAllowedError'
        ? t('audio_recording_permission_denied')
        : t('audio_recording_error');
    chatStore.showSnackbar(message, EColor.error);
  }
};

const onPickVideo = async (e: Event) => {
  const target = e.target as HTMLInputElement;
  const files = target.files;

  if (!files || files.length === 0) {
    target.value = '';
    return;
  }

  if (selectedDocuments.value.length > 0) {
    chatStore.showSnackbar(t('clear_documents_before_videos'), EColor.warning);
    target.value = '';
    return;
  }

  if (selectedPhotos.value.length > 0) {
    chatStore.showSnackbar(t('clear_images_before_videos'), EColor.warning);
    target.value = '';
    return;
  }

  const allowedVideoTypes = new Set([
    'video/mp4',
    'video/avi',
    'video/x-flv',
    'video/x-matroska',
    'video/quicktime',
    'video/3gpp',
  ]);
  const allowedExtensions = new Set(['mp4', 'avi', 'flv', 'mkv', 'mov', '3gp']);

  const videoFiles = Array.from(files).filter((file) => {
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    return (
      allowedVideoTypes.has(file.type) ||
      (fileExtension && allowedExtensions.has(fileExtension))
    );
  });

  if (videoFiles.length === 0) {
    chatStore.showSnackbar(t('invalid_video_format'), EColor.error);
    target.value = '';
    return;
  }

  const invalidVideos = Array.from(files).filter((file) => {
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    return (
      !allowedVideoTypes.has(file.type) &&
      (!fileExtension || !allowedExtensions.has(fileExtension))
    );
  });

  if (invalidVideos.length > 0) {
    chatStore.showSnackbar(t('invalid_video_format'), EColor.error);
  }

  const limit = 10;
  const currentCount = selectedVideos.value.length;
  if (currentCount >= limit) {
    chatStore.showSnackbar(t('max_videos_selected'), EColor.warning);
    target.value = '';
    return;
  }

  const spaceLeft = limit - currentCount;
  const filesToAdd = videoFiles.slice(0, spaceLeft);
  if (videoFiles.length > spaceLeft) {
    chatStore.showSnackbar(
      t('can_select_more_videos', { count: spaceLeft }),
      EColor.warning
    );
  }

  const oversizedVideos = filesToAdd.filter(
    (file) => file.size > MAX_VIDEO_SIZE_BYTES
  );
  const validVideos = filesToAdd.filter(
    (file) => file.size <= MAX_VIDEO_SIZE_BYTES
  );

  if (oversizedVideos.length > 0) {
    chatStore.showSnackbar(t('video_size_exceeded'), EColor.error);
  }

  const loadedVideos = await Promise.all(
    validVideos.map(async (file) => {
      const preview = URL.createObjectURL(file);
      const duration = await getVideoDuration(preview);

      return {
        file,
        preview,
        name: file.name,
        size: file.size,
        type: file.type,
        duration: duration ?? null,
      };
    })
  );

  for (const video of loadedVideos) {
    selectedVideos.value.push(video);
  }

  target.value = '';
};
const onPickAudio = async (e: Event) => {
  const target = e.target as HTMLInputElement;
  const files = target.files;

  if (!files || files.length === 0) {
    target.value = '';
    return;
  }

  if (selectedDocuments.value.length > 0) {
    chatStore.showSnackbar(t('clear_documents_before_audios'), EColor.warning);
    target.value = '';
    return;
  }

  if (selectedPhotos.value.length > 0) {
    chatStore.showSnackbar(t('clear_images_before_audios'), EColor.warning);
    target.value = '';
    return;
  }

  if (selectedVideos.value.length > 0) {
    chatStore.showSnackbar(t('clear_videos_before_audios'), EColor.warning);
    target.value = '';
    return;
  }

  const allowedAudioTypes = new Set([
    'audio/mpeg',
    'audio/mp3',
    'audio/aac',
    'audio/m4a',
    'audio/x-m4a',
    'audio/amr',
    'audio/amr-wb',
    'audio/ogg',
    'audio/opus',
  ]);
  const allowedExtensions = new Set([
    'mp3',
    'aac',
    'm4a',
    'amr',
    'ogg',
    'opus',
  ]);

  const audioFiles = Array.from(files).filter((file) => {
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    return (
      allowedAudioTypes.has(file.type) ||
      (fileExtension && allowedExtensions.has(fileExtension))
    );
  });

  if (audioFiles.length === 0) {
    chatStore.showSnackbar(t('invalid_audio_format'), EColor.error);
    target.value = '';
    return;
  }

  const invalidAudios = Array.from(files).filter((file) => {
    const fileExtension = file.name.split('.').pop()?.toLowerCase();
    return (
      !allowedAudioTypes.has(file.type) &&
      (!fileExtension || !allowedExtensions.has(fileExtension))
    );
  });

  if (invalidAudios.length > 0) {
    chatStore.showSnackbar(t('invalid_audio_format'), EColor.error);
  }

  const limit = 10;
  const currentCount = selectedAudios.value.length;
  if (currentCount >= limit) {
    chatStore.showSnackbar(t('max_audios_selected'), EColor.warning);
    target.value = '';
    return;
  }

  const spaceLeft = limit - currentCount;
  const filesToAdd = audioFiles.slice(0, spaceLeft);
  if (audioFiles.length > spaceLeft) {
    chatStore.showSnackbar(
      t('can_select_more_audios', { count: spaceLeft }),
      EColor.warning
    );
  }

  const oversizedAudios = filesToAdd.filter(
    (file) => file.size > MAX_AUDIO_SIZE_BYTES
  );
  const validAudios = filesToAdd.filter(
    (file) => file.size <= MAX_AUDIO_SIZE_BYTES
  );

  if (oversizedAudios.length > 0) {
    chatStore.showSnackbar(t('audio_size_exceeded'), EColor.error);
  }

  const loadedAudios = await Promise.all(
    validAudios.map(async (file) => {
      const preview = URL.createObjectURL(file);
      const duration = await getAudioDuration(preview);

      return {
        file,
        preview,
        name: file.name,
        size: file.size,
        type: file.type,
        duration: duration ?? null,
      };
    })
  );

  for (const audio of loadedAudios) {
    selectedAudios.value.push(audio);
  }

  target.value = '';
};

const openPreviewImage = (photo: ISelectedPhotoPreview) => {
  viewerKind.value = 'image';
  viewerSrc.value = photo.preview;
  viewerCaption.value = '';
  viewerDownloadName.value = photo.file.name;
  viewerOpen.value = true;
};

const openPreviewVideo = (video: ISelectedVideoPreview) => {
  viewerKind.value = 'video';
  viewerSrc.value = video.preview;
  viewerCaption.value = '';
  viewerDownloadName.value = video.name;
  viewerOpen.value = true;
};

const removeAudio = (index: number) => {
  const audio = selectedAudios.value[index];
  if (audio) {
    if (audio.preview && audio.preview.startsWith('blob:')) {
      URL.revokeObjectURL(audio.preview);
    }
  }
  selectedAudios.value.splice(index, 1);
};

const removeContact = (index: number) => {
  selectedContacts.value.splice(index, 1);
};

function formatPhone(value: string | null | undefined): string {
  if (!value) return '';

  const numbers = value.replaceAll(/\D/g, '').slice(0, 11);

  if (numbers.length <= 2) {
    return numbers;
  }
  if (numbers.length <= 6) {
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  }
  if (numbers.length <= 10) {
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
  }
  return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
}

const viewContactEmailFormatted = computed(() => {
  if (isViewEmailDecrypted.value) {
    return viewContactEmail.value ?? '';
  }
  return viewContactEmailPartial.value ?? '';
});

const viewContactPhoneFormatted = computed(() => {
  if (isViewPhoneDecrypted.value && viewContactPhone.value) {
    return formatPhone(viewContactPhone.value);
  }
  return viewContactPhonePartial.value ?? '';
});

const toggleViewEmailVisibility = async () => {
  if (!selectedContactDetails.value?.contact_id) return;

  if (isViewEmailDecrypted.value) {
    viewContactEmail.value = null;
    isViewEmailDecrypted.value = false;
    return;
  }

  isLoadingViewEmail.value = true;
  const decryptedEmail = await contactStore.getContactEmailDecrypted(
    selectedContactDetails.value.contact_id
  );
  isLoadingViewEmail.value = false;

  if (decryptedEmail) {
    viewContactEmail.value = decryptedEmail;
    isViewEmailDecrypted.value = true;
  }
};

const toggleViewPhoneVisibility = async () => {
  if (!selectedContactDetails.value?.contact_id) return;

  if (isViewPhoneDecrypted.value) {
    if (viewContactPhonePartial.value?.includes('*')) {
      viewContactPhone.value = null;
    }
    if (!viewContactPhonePartial.value?.includes('*')) {
      viewContactPhone.value =
        viewContactPhonePartial.value?.replaceAll(/\D/g, '') ?? null;
    }
    isViewPhoneDecrypted.value = false;
    return;
  }

  isLoadingViewPhone.value = true;
  const decryptedPhone = await contactStore.getContactPhoneDecrypted(
    selectedContactDetails.value.contact_id
  );
  isLoadingViewPhone.value = false;

  if (decryptedPhone) {
    viewContactPhone.value = decryptedPhone.replaceAll(/\D/g, '');
    isViewPhoneDecrypted.value = true;
  }
};

const viewContact = async (contactId: string) => {
  const contact = await contactStore.getContactById(contactId);
  if (contact) {
    selectedContactDetails.value = contact;
    viewContactEmailPartial.value = contact.email_partial ?? null;
    viewContactEmail.value = null;
    isViewEmailDecrypted.value = false;
    viewContactPhonePartial.value = contact.phone_partial ?? null;
    viewContactPhone.value = null;
    isViewPhoneDecrypted.value = false;
    isContactViewModalOpen.value = true;
  }
};

const audioModalOpen = ref(false);
const audioModalSrc = ref<string>('');
const audioModalName = ref<string>('');
const audioModalDuration = ref<number | null>(null);
const audioModalPlayer = ref<HTMLAudioElement | null>(null);
const audioModalIsPlaying = ref(false);
const audioModalCurrentTime = ref(0);
const audioModalProgress = ref(0);

const setupAudioModalListeners = (): (() => void) | null => {
  if (!audioModalPlayer.value) return null;

  const player = audioModalPlayer.value;

  const onLoadedMetadata = () => {
    if (player) {
      audioModalDuration.value = player.duration;
    }
  };

  const onTimeUpdate = () => {
    if (player) {
      audioModalCurrentTime.value = player.currentTime;
      if (player.duration) {
        audioModalProgress.value = (player.currentTime / player.duration) * 100;
      }
    }
  };

  const onPlay = () => {
    audioModalIsPlaying.value = true;
  };

  const onPause = () => {
    audioModalIsPlaying.value = false;
  };

  const onEnded = () => {
    audioModalIsPlaying.value = false;
    audioModalCurrentTime.value = 0;
    audioModalProgress.value = 0;
  };

  player.addEventListener('loadedmetadata', onLoadedMetadata);
  player.addEventListener('timeupdate', onTimeUpdate);
  player.addEventListener('play', onPlay);
  player.addEventListener('pause', onPause);
  player.addEventListener('ended', onEnded);

  return () => {
    player.removeEventListener('loadedmetadata', onLoadedMetadata);
    player.removeEventListener('timeupdate', onTimeUpdate);
    player.removeEventListener('play', onPlay);
    player.removeEventListener('pause', onPause);
    player.removeEventListener('ended', onEnded);
  };
};

let audioModalCleanup: (() => void) | null = null;

const openPreviewAudio = (audio: ISelectedAudioPreview) => {
  if (audioModalCleanup) {
    audioModalCleanup();
    audioModalCleanup = null;
  }

  audioModalSrc.value = audio.preview;
  audioModalName.value = audio.name;
  audioModalDuration.value = audio.duration;
  audioModalCurrentTime.value = 0;
  audioModalProgress.value = 0;
  audioModalOpen.value = true;

  nextTick(() => {
    audioModalCleanup = setupAudioModalListeners();
  });
};

const toggleAudioModalPlay = () => {
  if (!audioModalPlayer.value) return;

  if (audioModalIsPlaying.value) {
    audioModalPlayer.value.pause();
    return;
  }

  audioModalPlayer.value.play().catch(() => {
    audioModalIsPlaying.value = false;
  });
};

const formatAudioModalTime = (seconds: number | null): string => {
  if (seconds === null || !Number.isFinite(seconds)) return '0:00';
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

const closeAudioModal = () => {
  if (audioModalPlayer.value) {
    audioModalPlayer.value.pause();
    audioModalPlayer.value.currentTime = 0;
  }
  if (audioModalCleanup) {
    audioModalCleanup();
    audioModalCleanup = null;
  }
  audioModalIsPlaying.value = false;
  audioModalCurrentTime.value = 0;
  audioModalProgress.value = 0;
  audioModalOpen.value = false;
};

const downloadPreviewImage = async (url: string, filename?: string | null) => {
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
  } catch (error) {
    console.error('Erro ao baixar imagem:', error);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.download = filename || 'image.jpg';
    anchor.rel = 'noopener';
    anchor.click();
  }
};

const downloadPreviewVideo = async (url: string, filename?: string | null) => {
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
  } catch (error) {
    console.error('Erro ao baixar vídeo:', error);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.download = filename || 'video.mp4';
    anchor.rel = 'noopener';
    anchor.click();
  }
};

const downloadViewerMedia = () => {
  if (!viewerSrc.value) return;
  if (viewerKind.value === 'video') {
    downloadPreviewVideo(viewerSrc.value, viewerDownloadName.value);
    return;
  }
  downloadPreviewImage(viewerSrc.value, viewerDownloadName.value);
};

const onEmojiSelect = (e: any) => {
  const ch = e?.native || e?.skins?.[0]?.native || '';

  if (ch) {
    msg.value = (msg.value || '') + ch;
    nextTick(() => globalThis.dispatchEvent(new CustomEvent('focus-composer')));
  }
};

const onRecordAudio = () => {
  startAudioRecording();
};

const onSendText = () => sendMessage();

const removeDocument = (index: number) => {
  selectedDocuments.value.splice(index, 1);
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

const resolveDocumentIcon = (extension?: string, mimetype?: string): string => {
  const ext = extension?.toLowerCase();
  if (ext && documentIconMap[ext]) {
    return documentIconMap[ext];
  }

  if (mimetype?.includes('pdf')) return 'tabler-file-type-pdf';
  if (mimetype?.includes('word')) return 'tabler-file-type-doc';
  if (mimetype?.includes('sheet') || mimetype?.includes('excel'))
    return 'tabler-file-type-xls';
  if (mimetype?.includes('presentation')) return 'tabler-file-type-ppt';
  if (mimetype?.includes('zip') || mimetype?.includes('compressed'))
    return 'tabler-file-type-zip';

  return 'tabler-file-description';
};

const truncateFileName = (name: string, max = 32): string => {
  if (name.length <= max) return name;
  const extIndex = name.lastIndexOf('.');
  if (extIndex === -1 || extIndex < name.length - 6) {
    return `${name.slice(0, max - 3)}...`;
  }

  const ext = name.slice(extIndex);
  const base = name.slice(0, max - ext.length - 3);
  return `${base}...${ext}`;
};

const formatFileSize = (bytes: number): string => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, exponent);
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

const debouncedMsg = refDebounced(msg, 500);
watch(
  debouncedMsg,
  async (val) => {
    const firstUrl = extractFirstUrl(val as string);
    if (firstUrl) {
      const linkPreviewResponse = await chatStore.generateLinkPreview({
        url: firstUrl,
      });
      if (linkPreviewResponse?.title !== 'Error') {
        linkPreview.value = linkPreviewResponse as ViewLinkPreviewResponse;
      }
      return;
    }
    linkPreview.value = null;
  },
  { immediate: true }
);

let previousLoadingState = false;
let previousActiveChatId: string | undefined = undefined;
watch(
  () =>
    [
      chatStore.loading,
      chatStore.listMessages.length,
      chatStore.activeChat?.chat_id,
    ] as const,
  async ([loading, messageCount, activeChatId]) => {
    const currentLoading = Boolean(loading);
    const currentMessageCount =
      typeof messageCount === 'number' ? messageCount : 0;
    const chatChanged = previousActiveChatId !== activeChatId;

    const loadingFinished =
      previousLoadingState && !currentLoading && currentMessageCount > 0;

    const chatChangedWithMessages =
      chatChanged && !currentLoading && currentMessageCount > 0;

    previousLoadingState = currentLoading;
    previousActiveChatId = activeChatId;

    if ((loadingFinished || chatChangedWithMessages) && activeChatId) {
      await nextTick();

      requestAnimationFrame(() => {
        scrollToBottomInChatLog();
        hideScrollbarIfNotNeeded();
      });
    }
  }
);

const hideScrollbarIfNotNeeded = () => {
  if (!chatLogPS.value) return;

  const scrollEl = chatLogPS.value.$el || chatLogPS.value;
  if (!scrollEl) return;

  const psContainer =
    (scrollEl.querySelector('.ps') as HTMLElement) ||
    (scrollEl.closest('.ps') as HTMLElement) ||
    (scrollEl as HTMLElement);

  if (!psContainer) return;

  const needsScroll = psContainer.scrollHeight > psContainer.clientHeight;

  const railY = psContainer.querySelector('.ps__rail-y') as HTMLElement;
  if (railY) {
    railY.style.display = needsScroll ? '' : 'none';
  }
};

watch(
  () => [chatStore.listMessages.length, chatStore.loading],
  async () => {
    await nextTick();
    requestAnimationFrame(() => {
      hideScrollbarIfNotNeeded();
    });
  }
);

const onOpenAddContactModal = (e: Event) => {
  const customEvent = e as CustomEvent;
  const contactData =
    customEvent.detail as Partial<CreateContactRequest> | null;
  if (contactData) {
    addContactInitialData.value = contactData;
  } else {
    addContactInitialData.value = null;
  }
  isAddContactModalOpen.value = true;
};

const onOpenEditContactModal = (e: Event) => {
  const customEvent = e as CustomEvent;
  const contactId = customEvent.detail as string;

  if (contactId) {
    editContactId.value = contactId;
    isEditContactModalOpen.value = true;
  }
};

const focusComposer = () => {
  setTimeout(() => {
    const el = composerRef.value?.$el?.querySelector(
      'textarea'
    ) as HTMLTextAreaElement | null;
    el?.focus({ preventScroll: false });
  }, 120);
};

const onScrollToMessageEvt = (e: Event) => {
  const id = (e as CustomEvent<string>).detail;
  if (id) void highlightAndScrollToMessage(id);
};

const retryTextMessage = async (
  content: NonNullable<ListMessageResult['content']>,
  hash: string
): Promise<void> => {
  const messageBody: CreateMessageChatsBody = {
    type: EMessageType.text,
    message: content.message ?? '',
    hash,
  };

  if (content.link_preview) {
    messageBody.link_preview = content.link_preview as ViewLinkPreviewResponse;
  }

  if (content.message_quoted_id) {
    messageBody.message_quoted_id = content.message_quoted_id;
  }

  const success = await chatStore.createMessage(messageBody);
  if (!success) {
    markUploadError(hash);
  }
};

const retryImageMessage = async (
  content: NonNullable<ListMessageResult['content']>,
  hash: string
): Promise<void> => {
  try {
    const response = await fetch(content.image!.url!);
    const blob = await response.blob();
    const file = new File(
      [blob],
      `image.${content.image!.extension || 'jpg'}`,
      {
        type: content.image!.mimetype || 'image/jpeg',
      }
    );

    const photo = {
      file,
      preview: content.image!.url!,
    };

    const replyId = content.message_quoted_id ?? null;
    const formData = createImageFormData(
      photo,
      content.message ?? null,
      replyId,
      hash
    );

    chatStore.updateLocalMessageProgress(hash, 0);
    const success = await chatStore.createMessageWithImages(formData, {
      skipLoading: true,
      onUploadProgress: (progress) => {
        markUploadProgress(hash, progress);
      },
    });

    if (!success) {
      markUploadError(hash);
    }
  } catch (error) {
    console.error('Erro ao reenviar mensagem:', error);
    markUploadError(hash);
  }
};

const retryVideoMessage = async (
  content: NonNullable<ListMessageResult['content']>,
  hash: string
): Promise<void> => {
  try {
    const response = await fetch(content.video!.url!);
    const blob = await response.blob();
    const file = new File(
      [blob],
      content.video!.name || `video.${content.video!.extension || 'mp4'}`,
      {
        type: content.video!.mimetype || 'video/mp4',
      }
    );

    const video = {
      file,
      preview: content.video!.url!,
      name: content.video!.name || file.name,
      type: content.video!.mimetype || 'video/mp4',
      size: content.video!.size || file.size,
      duration: content.video!.duration ?? null,
    };

    const replyId = content.message_quoted_id ?? null;
    const formData = createVideoFormData(
      video,
      content.message ?? null,
      replyId,
      hash
    );

    chatStore.updateLocalMessageProgress(hash, 0);
    const success = await chatStore.createMessageWithVideos(formData, {
      skipLoading: true,
      onUploadProgress: (progress) => {
        markUploadProgress(hash, progress);
      },
    });

    if (!success) {
      markUploadError(hash);
    }
  } catch (error) {
    console.error('Erro ao reenviar mensagem:', error);
    markUploadError(hash);
  }
};

const retryAudioMessage = async (
  content: NonNullable<ListMessageResult['content']>,
  hash: string
): Promise<void> => {
  try {
    const response = await fetch(content.audio!.url!);
    const blob = await response.blob();

    const audioData = {
      blob,
      fileName:
        content.audio!.name || `audio.${content.audio!.extension || 'ogg'}`,
      mimeType: content.audio!.mimetype || 'audio/ogg',
    };

    const replyId = content.message_quoted_id ?? null;
    const formData = createAudioFormData(
      audioData,
      content.message ?? null,
      replyId,
      content.audio!.view_once ?? false,
      content.audio!.duration ?? null,
      hash
    );

    chatStore.updateLocalMessageProgress(hash, 0);
    const success = await chatStore.createMessageWithAudios(formData, {
      skipLoading: true,
      onUploadProgress: (progress) => {
        markUploadProgress(hash, progress);
      },
    });

    if (!success) {
      markUploadError(hash);
    }
  } catch (error) {
    console.error('Erro ao reenviar mensagem:', error);
    markUploadError(hash);
  }
};

const retryDocumentMessage = async (
  content: NonNullable<ListMessageResult['content']>,
  hash: string
): Promise<void> => {
  try {
    const response = await fetch(content.document!.url!);
    const blob = await response.blob();
    const file = new File(
      [blob],
      content.document!.name ||
        `document.${content.document!.extension || 'pdf'}`,
      {
        type: content.document!.mimetype || 'application/pdf',
      }
    );

    const doc = {
      file,
      name: content.document!.name || file.name,
      type: content.document!.mimetype || 'application/pdf',
      size: content.document!.size || file.size,
      extension: content.document!.extension || 'pdf',
    };

    const replyId = content.message_quoted_id ?? null;
    const formData = createDocumentFormData(
      doc,
      content.message ?? null,
      replyId,
      hash
    );

    chatStore.updateLocalMessageProgress(hash, 0);
    const success = await chatStore.createMessageWithDocuments(formData, {
      skipLoading: true,
      onUploadProgress: (progress) => {
        markUploadProgress(hash, progress);
      },
    });

    if (!success) {
      markUploadError(hash);
    }
  } catch (error) {
    console.error('Erro ao reenviar mensagem:', error);
    markUploadError(hash);
  }
};

const retryContactMessage = async (
  content: NonNullable<ListMessageResult['content']>,
  hash: string
): Promise<void> => {
  if (!chatStore.activeChat?.chat_id) {
    markUploadError(hash);
    return;
  }

  if (!content.contact?.contact_id) {
    markUploadError(hash);
    return;
  }

  const replyId = content.message_quoted_id ?? null;
  const messageValue = content.message ?? null;

  const formData = new FormData();
  formData.append('type', EMessageType.contact_card);
  if (messageValue) {
    formData.append('message', messageValue);
  }
  if (replyId) {
    formData.append('message_quoted_id', replyId);
  }
  formData.append('contacts', content.contact.contact_id);
  formData.append('hash', hash);

  const success = await chatStore.createMessageWithContacts(formData, {
    skipLoading: true,
  });

  if (!success) {
    markUploadError(hash);
  }
};

const onRetryMessage = async (e: Event) => {
  const { message } = (e as CustomEvent<{ message: ListMessageResult }>).detail;
  if (!message?.hash) return;

  const content = message.content;
  if (!content) return;

  const hash = message.hash;
  chatStore.clearLocalMessageState(hash);

  if (content.type === EMessageType.text) {
    await retryTextMessage(content, hash);
    return;
  }

  if (content.type === EMessageType.image && content.image?.url) {
    await retryImageMessage(content, hash);
    return;
  }

  if (content.type === EMessageType.video && content.video?.url) {
    await retryVideoMessage(content, hash);
    return;
  }

  if (content.type === EMessageType.audio && content.audio?.url) {
    await retryAudioMessage(content, hash);
    return;
  }

  if (content.type === EMessageType.document && content.document?.url) {
    await retryDocumentMessage(content, hash);
    return;
  }

  if (
    content.type === EMessageType.contact_card &&
    content.contact?.contact_id
  ) {
    await retryContactMessage(content, hash);
  }
};

const clearTypingTimeout = () => {
  if (typingTimeout.value) {
    clearTimeout(typingTimeout.value);
    typingTimeout.value = null;
  }
};

const checkJidMatches = (
  eventJid: string,
  messages: ListMessageResult[]
): boolean => {
  for (const message of messages) {
    const messageJid = message.message_key?.remote_jid;
    const messageJidAlt = message.message_key?.remote_jid_alt;

    if (messageJid === eventJid || messageJidAlt === eventJid) {
      return true;
    }
  }

  const normalizedEventJid = eventJid.replace('@lid', '@s.whatsapp.net');

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

  return false;
};

const handleTypingEvent = (data: IChatTyping | IChatMessage) => {
  if ('message_id' in data) {
    if (isTyping.value) {
      clearTypingTimeout();
      isTyping.value = false;
    }
    return;
  }

  if (data.type !== 'typing') {
    return;
  }

  const typingData = data as IChatTyping;
  const activeChat = chatStore.activeChat;

  if (!activeChat) {
    return;
  }

  const eventJid = typingData.jid;
  const messages = chatStore.listMessages;

  if (!checkJidMatches(eventJid, messages)) {
    return;
  }

  clearTypingTimeout();

  if (!typingData.is_typing) {
    isTyping.value = false;
    return;
  }

  isTyping.value = true;

  typingTimeout.value = setTimeout(() => {
    isTyping.value = false;
    typingTimeout.value = null;
  }, 5000);
};

const debouncedClearChatSummary = useDebounceFn(async (chatId: string) => {
  await chatStore.clearChatSummary(chatId);
}, 10000);

onMounted(async () => {
  if (chatStore.user?.account_id) {
    const accountId = chatStore.user.account_id;

    await onMessage(
      chatAccountCentrifugo(accountId),
      (data: IChatMessage | IChatTyping | IChat) => {
        if ('type' in data && data.type === 'typing') {
          handleTypingEvent(data as IChatTyping);
          return;
        }

        if ('message_id' in data) {
          const messageData = data as IChatMessage;

          if (chatStore.activeChat?.chat_id !== messageData.chat_id) {
            return;
          }

          handleTypingEvent(messageData);

          const changeType = chatStore.addMessageActiveChat(messageData);

          if (changeType === 'created') {
            nextTick(async () => {
              await scrollToBottomInChatLog();
            });
            globalThis.dispatchEvent(new CustomEvent('focus-composer'));
          }

          return;
        }

        if ('chat_id' in data && !('message_id' in data)) {
          const chatData = data as IChat;
          chatStore.addChat(chatData);
        }
      }
    );

    await onMessage(chatQueueAccountCentrifugo(accountId), (data: IChat) => {
      chatStore.addChat(data);

      if (
        chatStore.user?.account_id &&
        chatStore.activeChat?.chat_id === data.chat_id &&
        data.status === EChatStatus.in_chat
      ) {
        debouncedClearChatSummary(data.chat_id);
      }
    });

    globalThis.addEventListener('focus-composer', focusComposer);
    globalThis.addEventListener(
      'scroll-to-message',
      onScrollToMessageEvt as EventListener
    );
    globalThis.addEventListener(
      'retry-message',
      onRetryMessage as EventListener
    );
    globalThis.addEventListener(
      'open-add-contact-modal',
      onOpenAddContactModal as EventListener
    );
    globalThis.addEventListener(
      'open-edit-contact-modal',
      onOpenEditContactModal as EventListener
    );
  }

  const handleResize = () => {
    requestAnimationFrame(() => {
      hideScrollbarIfNotNeeded();
    });
  };
  window.addEventListener('resize', handleResize);
  resizeHandler.value = handleResize;
});

onUnmounted(async () => {
  clearTypingTimeout();
  isTyping.value = false;

  if (chatStore.user?.account_id) {
    const accountId = chatStore.user.account_id;
    await unsubscribe(chatAccountCentrifugo(accountId));
    await unsubscribe(chatQueueAccountCentrifugo(accountId));

    globalThis.removeEventListener('focus-composer', focusComposer);
    globalThis.removeEventListener(
      'scroll-to-message',
      onScrollToMessageEvt as EventListener
    );
    globalThis.removeEventListener(
      'retry-message',
      onRetryMessage as EventListener
    );
    globalThis.removeEventListener(
      'open-add-contact-modal',
      onOpenAddContactModal as EventListener
    );
    globalThis.removeEventListener(
      'open-edit-contact-modal',
      onOpenEditContactModal as EventListener
    );
  }

  if (resizeHandler.value) {
    window.removeEventListener('resize', resizeHandler.value);
    resizeHandler.value = null;
  }

  for (const timeoutId of highlightedMessageTimers.values()) {
    clearTimeout(timeoutId);
  }
  highlightedMessageTimers.clear();

  const highlightedElements = document.querySelectorAll(
    '.message-target-persistent'
  );

  for (const el of highlightedElements) {
    el.classList.remove('message-target-persistent');
    const chatContent = el.querySelector('.chat-content');
    if (chatContent) {
      chatContent.classList.remove('message-target-persistent-content');
    }
  }
});

onBeforeUnmount(() => {
  shouldPersistRecording.value = false;
  cancelAudioRecording();
  if (recordedAudioUrl.value) {
    URL.revokeObjectURL(recordedAudioUrl.value);
    recordedAudioUrl.value = null;
  }
});
</script>

<template>
  <VLayout class="chat-app-layout" style="z-index: 0">
    <VNavigationDrawer
      v-model="isUserProfileSidebarOpen"
      data-allow-mismatch
      temporary
      touchless
      absolute
      class="user-profile-sidebar"
      location="start"
      width="370"
    >
      <ChatUserProfileSidebarContent
        @close="isUserProfileSidebarOpen = false"
      />
    </VNavigationDrawer>

    <VNavigationDrawer
      v-model="isActiveChatUserProfileSidebarOpen"
      data-allow-mismatch
      width="374"
      absolute
      temporary
      location="end"
      touchless
      class="active-chat-user-profile-sidebar"
    >
      <ChatActiveChatUserProfileSidebarContent
        @close="isActiveChatUserProfileSidebarOpen = false"
      />
    </VNavigationDrawer>

    <VNavigationDrawer
      v-model="isLeftSidebarOpen"
      data-allow-mismatch
      absolute
      touchless
      location="start"
      width="370"
      :temporary="$vuetify.display.smAndDown"
      class="chat-list-sidebar"
      :permanent="$vuetify.display.mdAndUp"
    >
      <ChatLeftSidebarContent
        v-model:is-drawer-open="isLeftSidebarOpen"
        v-model:search="q"
        @open-chat="openChat"
        @show-user-profile="isUserProfileSidebarOpen = true"
        @close="isLeftSidebarOpen = false"
      />
    </VNavigationDrawer>

    <VMain class="chat-content-container">
      <div v-if="chatStore.activeChat" class="d-flex flex-column h-100">
        <div
          class="active-chat-header d-flex align-center text-medium-emphasis bg-surface"
        >
          <IconBtn class="d-md-none me-3" @click="isLeftSidebarOpen = true">
            <VIcon icon="tabler-menu-2" />
          </IconBtn>

          <div
            class="d-flex align-center cursor-pointer"
            @click="isActiveChatUserProfileSidebarOpen = true"
          >
            <VAvatar
              size="40"
              :variant="!chatStore.activeChat.photo ? 'tonal' : undefined"
              class="cursor-pointer"
            >
              <VImg
                v-if="chatStore.activeChat.photo"
                :src="chatStore.activeChat.photo"
                :alt="
                  chatStore.activeChat.contact?.name ??
                  chatStore.activeChat.name ??
                  ''
                "
              />
              <VImg
                v-else
                :src="'/images/svg/avatar-default.svg'"
                :alt="
                  chatStore.activeChat.contact?.name ??
                  chatStore.activeChat.name ??
                  ''
                "
              />
            </VAvatar>

            <div class="flex-grow-1 ms-4 overflow-hidden">
              <div class="d-flex align-center gap-2 mb-0">
                <div class="text-h6 mb-0 font-weight-regular">
                  {{
                    chatStore.activeChat.contact?.name ??
                    chatStore.activeChat.name
                  }}
                </div>
                <VChip
                  v-if="chatStore.activeChat.contact?.name"
                  size="x-small"
                  variant="tonal"
                  color="primary"
                  class="contact-label"
                >
                  {{ $t('contact_label') }}
                </VChip>
              </div>
              <p class="text-truncate mb-0 text-body-2">
                {{
                  chatStore.activeChat.contact?.name &&
                  chatStore.activeChat.contact?.phone
                    ? chatStore.activeChat.contact.phone_ddi
                      ? `+${chatStore.activeChat.contact.phone_ddi} ${chatStore.activeChat.contact.phone}`
                      : chatStore.activeChat.contact.phone
                    : formatPhoneBR(chatStore.activeChat.phone)
                }}
              </p>
            </div>
          </div>

          <VSpacer />

          <div class="d-sm-flex align-center d-none text-medium-emphasis">
            <IconBtn>
              <VIcon icon="tabler-search" />
            </IconBtn>
            <IconBtn>
              <VIcon icon="tabler-dots-vertical" />
            </IconBtn>
          </div>
        </div>

        <VDivider />

        <PerfectScrollbar
          ref="chatLogPS"
          tag="ul"
          :options="{ wheelPropagation: false }"
          class="flex-grow-1"
        >
          <ChatLog :key="chatStore.activeChat?.chat_id || 'no-chat'" />
        </PerfectScrollbar>

        <Transition name="fade">
          <div v-if="linkPreview" class="mx-5 mt-3">
            <VCard class="link-preview-card">
              <VBtn
                class="link-preview-close"
                icon
                size="24"
                variant="text"
                @click="linkPreview = null"
              >
                <VIcon size="18" icon="tabler-x" />
              </VBtn>
              <div class="d-flex gap-3">
                <VAvatar size="56" :rounded="8" variant="tonal">
                  <VImg v-if="previewImage" :src="previewImage" />
                </VAvatar>
                <div class="flex-grow-1 overflow-hidden">
                  <div class="text-caption text-medium-emphasis">
                    {{ previewDomain }}
                  </div>
                  <div class="text-subtitle-1 font-weight-medium text-truncate">
                    {{ linkPreview?.title }}
                  </div>
                  <div
                    class="text-body-2 text-medium-emphasis two-line-ellipsis"
                  >
                    {{ linkPreview?.description }}
                  </div>
                  <div class="mt-2">
                    <a
                      v-if="previewHref"
                      :href="previewHref"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-primary text-body-2"
                    >
                      {{ previewHref }}
                    </a>
                  </div>
                </div>
              </div>
            </VCard>
          </div>
        </Transition>

        <VForm
          class="chat-log-message-form mb-5 mx-5"
          @submit.prevent="sendMessage"
        >
          <Transition name="fade">
            <div
              v-if="isTyping && chatStore.activeChat"
              class="typing-indicator d-flex align-center gap-2 mb-2"
            >
              <VIcon size="20" color="primary" icon="tabler-pencil" />
              <span
                class="text-primary"
                style="font-style: italic; font-size: 0.8rem; font-weight: 400"
              >
                {{
                  chatStore.activeChat.contact?.name ??
                  chatStore.activeChat.name ??
                  (chatStore.activeChat.contact?.phone_ddi &&
                  chatStore.activeChat.contact?.phone
                    ? `+${chatStore.activeChat.contact.phone_ddi} ${chatStore.activeChat.contact.phone}`
                    : chatStore.activeChat.contact?.phone) ??
                  chatStore.activeChat.phone
                }}
                {{ $t('is_typing') }}
              </span>
            </div>
          </Transition>

          <ReplyPreview v-if="chatStore.messageReply" />

          <Transition name="fade">
            <div
              v-if="selectedDocuments.length > 0"
              class="composer-attachment mt-3"
            >
              <VCard class="composer-attachment-card">
                <VCardTitle class="d-flex align-center justify-space-between">
                  <span
                    >{{ t('documents_selected') }} (
                    {{ selectedDocuments.length }}/10 )</span
                  >
                  <VBtn
                    icon
                    size="24"
                    variant="text"
                    @click="selectedDocuments = []"
                  >
                    <VIcon size="18" icon="tabler-x" />
                  </VBtn>
                </VCardTitle>
                <VCardText>
                  <div class="document-preview-list">
                    <div
                      v-for="(doc, index) in selectedDocuments"
                      :key="`${doc.name}-${index}`"
                      class="document-preview-item d-flex align-center justify-space-between px-3 py-2"
                    >
                      <div class="d-flex align-center gap-3 overflow-hidden">
                        <VIcon
                          :icon="resolveDocumentIcon(doc.extension, doc.type)"
                          size="28"
                          color="primary"
                        />
                        <div class="d-flex flex-column overflow-hidden">
                          <VTooltip location="bottom">
                            <template #activator="{ props }">
                              <span
                                v-bind="props"
                                class="text-body-2 fw-medium document-preview-name"
                              >
                                {{ truncateFileName(doc.name) }}
                              </span>
                            </template>
                            <span>{{ doc.name }}</span>
                          </VTooltip>
                          <span class="text-caption text-disabled">
                            {{ formatFileSize(doc.size) }}
                          </span>
                        </div>
                      </div>
                      <VBtn
                        icon
                        size="20"
                        variant="flat"
                        color="error"
                        @click="removeDocument(index)"
                      >
                        <VIcon size="14" icon="tabler-x" />
                      </VBtn>
                    </div>
                  </div>
                </VCardText>
              </VCard>
            </div>
          </Transition>

          <Transition name="fade">
            <div
              v-if="selectedVideos.length > 0"
              class="composer-attachment mt-3"
            >
              <VCard class="composer-attachment-card">
                <VCardTitle class="d-flex align-center justify-space-between">
                  <span
                    >{{ t('videos_selected') }} ({{
                      selectedVideos.length
                    }}/10)</span
                  >
                  <VBtn
                    icon
                    size="24"
                    variant="text"
                    @click="clearSelectedVideos()"
                  >
                    <VIcon size="18" icon="tabler-x" />
                  </VBtn>
                </VCardTitle>
                <VCardText>
                  <div class="attachment-grid attachment-grid--videos">
                    <div
                      v-for="(video, index) in selectedVideos"
                      :key="`${video.name}-${index}`"
                      class="video-preview-wrapper"
                    >
                      <div class="video-preview-container">
                        <video
                          :src="video.preview"
                          class="video-preview"
                          preload="metadata"
                          muted
                          playsinline
                          @click="openPreviewVideo(video)"
                        >
                          <track kind="captions" />
                        </video>
                        <div
                          class="video-preview-play-overlay"
                          @click="openPreviewVideo(video)"
                        >
                          <VIcon size="24">tabler-player-play</VIcon>
                        </div>
                      </div>
                      <div class="video-preview-meta">
                        <VTooltip location="bottom">
                          <template #activator="{ props }">
                            <span v-bind="props" class="video-preview-name">
                              {{ truncateFileName(video.name) }}
                            </span>
                          </template>
                          <span>{{ video.name }}</span>
                        </VTooltip>
                        <span
                          class="video-preview-info text-caption text-disabled"
                        >
                          {{
                            (video.name.split('.').pop() || '').toUpperCase()
                          }}
                          •
                          {{ formatFileSize(video.size) }}
                        </span>
                      </div>
                      <VBtn
                        icon
                        size="20"
                        variant="flat"
                        color="error"
                        class="video-preview-remove"
                        @click.stop="removeVideo(index)"
                      >
                        <VIcon size="14" icon="tabler-x" />
                      </VBtn>
                    </div>
                  </div>
                </VCardText>
              </VCard>
            </div>
          </Transition>

          <Transition name="fade">
            <div
              v-if="selectedAudios.length > 0"
              class="composer-attachment mt-3"
            >
              <VCard class="composer-attachment-card">
                <VCardTitle class="d-flex align-center justify-space-between">
                  <span
                    >{{ t('audios_selected') }} ({{
                      selectedAudios.length
                    }}/10)</span
                  >
                  <VBtn
                    icon
                    size="24"
                    variant="text"
                    @click="clearSelectedAudios()"
                  >
                    <VIcon size="18" icon="tabler-x" />
                  </VBtn>
                </VCardTitle>
                <VCardText>
                  <div class="attachment-grid attachment-grid--audios">
                    <div
                      v-for="(audio, index) in selectedAudios"
                      :key="`${audio.name}-${index}`"
                      class="audio-preview-wrapper"
                    >
                      <div class="audio-preview-container">
                        <div
                          class="audio-preview-icon-wrapper"
                          @click="openPreviewAudio(audio)"
                        >
                          <VIcon size="32" color="primary"
                            >tabler-headphones</VIcon
                          >
                        </div>
                        <div
                          class="audio-preview-play-overlay"
                          @click="openPreviewAudio(audio)"
                        >
                          <VIcon size="24">tabler-player-play</VIcon>
                        </div>
                      </div>
                      <div class="audio-preview-meta">
                        <VTooltip location="bottom">
                          <template #activator="{ props }">
                            <span v-bind="props" class="audio-preview-name">
                              {{ truncateFileName(audio.name) }}
                            </span>
                          </template>
                          <span>{{ audio.name }}</span>
                        </VTooltip>
                        <span
                          class="audio-preview-info text-caption text-disabled"
                        >
                          {{
                            (audio.name.split('.').pop() || '').toUpperCase()
                          }}
                          •
                          {{ formatFileSize(audio.size) }}
                          <span v-if="audio.duration">
                            • {{ formatAudioModalTime(audio.duration) }}
                          </span>
                        </span>
                      </div>
                      <VBtn
                        icon
                        size="20"
                        variant="flat"
                        color="error"
                        class="audio-preview-remove"
                        @click.stop="removeAudio(index)"
                      >
                        <VIcon size="14" icon="tabler-x" />
                      </VBtn>
                    </div>
                  </div>
                </VCardText>
              </VCard>
            </div>
          </Transition>

          <Transition name="fade">
            <div
              v-if="canAccessContacts && selectedContacts.length > 0"
              class="composer-attachment mt-3"
            >
              <VCard class="composer-attachment-card">
                <VCardTitle class="d-flex align-center justify-space-between">
                  <span
                    >{{ t('contacts_selected') }} ({{
                      selectedContacts.length
                    }}/10)</span
                  >
                  <VBtn
                    icon
                    size="24"
                    variant="text"
                    @click="clearSelectedContacts()"
                  >
                    <VIcon size="18" icon="tabler-x" />
                  </VBtn>
                </VCardTitle>
                <VCardText>
                  <div class="attachment-grid">
                    <div
                      v-for="(contact, index) in selectedContacts"
                      :key="`${contact.contact_id}-${index}`"
                      class="contact-preview-wrapper"
                      @click="viewContact(contact.contact_id)"
                      style="cursor: pointer"
                    >
                      <div class="contact-preview-container">
                        <div class="contact-preview-icon-wrapper">
                          <VIcon size="32" color="primary">tabler-user</VIcon>
                        </div>
                      </div>
                      <div class="contact-preview-meta">
                        <VTooltip location="bottom">
                          <template #activator="{ props }">
                            <span v-bind="props" class="contact-preview-name">
                              {{ contact.name }}
                              {{ contact.last_name || '' }}
                            </span>
                          </template>
                          <span
                            >{{ contact.name }}
                            {{ contact.last_name || '' }}</span
                          >
                        </VTooltip>
                        <span
                          class="contact-preview-info text-caption text-disabled"
                        >
                          <span v-if="contact.phone_partial">
                            {{ contact.phone_partial }}
                          </span>
                        </span>
                      </div>
                      <VBtn
                        icon
                        size="20"
                        variant="flat"
                        color="error"
                        class="contact-preview-remove"
                        @click.stop="removeContact(index)"
                      >
                        <VIcon size="14" icon="tabler-x" />
                      </VBtn>
                    </div>
                  </div>
                </VCardText>
              </VCard>
            </div>
          </Transition>

          <Transition name="fade">
            <div
              v-if="selectedPhotos.length > 0"
              class="composer-attachment mt-3"
            >
              <VCard class="composer-attachment-card">
                <VCardTitle class="d-flex align-center justify-space-between">
                  <span
                    >{{ t('images_selected') }} ({{
                      selectedPhotos.length
                    }}/10)</span
                  >
                  <VBtn
                    icon
                    size="24"
                    variant="text"
                    @click="selectedPhotos = []"
                  >
                    <VIcon size="18" icon="tabler-x" />
                  </VBtn>
                </VCardTitle>
                <VCardText>
                  <div class="attachment-grid">
                    <div
                      v-for="(photo, index) in selectedPhotos"
                      :key="index"
                      class="photo-preview-wrapper"
                    >
                      <VImg
                        :src="photo.preview"
                        cover
                        class="photo-preview-image"
                        @click="openPreviewImage(photo)"
                      />
                      <VBtn
                        icon
                        size="20"
                        variant="flat"
                        color="error"
                        class="photo-preview-remove"
                        @click.stop="selectedPhotos.splice(index, 1)"
                      >
                        <VIcon size="14" icon="tabler-x" />
                      </VBtn>
                    </div>
                  </div>
                </VCardText>
              </VCard>
            </div>
          </Transition>

          <div
            v-if="isRecordingAudio"
            class="audio-recording-inline whats-composer d-flex align-center gap-3 px-4"
          >
            <IconBtn
              class="record-action"
              aria-label="Cancelar gravação"
              @click="cancelAudioRecording"
            >
              <VIcon size="20">tabler-trash</VIcon>
            </IconBtn>

            <span
              class="recording-dot"
              :class="{ 'is-paused': isRecordingPaused }"
            ></span>

            <span class="audio-recording-clock">{{
              formattedRecordingTime
            }}</span>

            <div class="audio-recording-info flex-grow-1">
              <canvas
                ref="audioCanvasRef"
                class="audio-wave-canvas"
                height="32"
              ></canvas>
            </div>

            <IconBtn
              class="record-action"
              aria-label="Pausar ou retomar gravação"
              @click="togglePauseAudioRecording"
            >
              <VIcon size="20">
                {{
                  isRecordingPaused
                    ? 'tabler-player-play'
                    : 'tabler-player-pause'
                }}
              </VIcon>
            </IconBtn>

            <IconBtn
              class="record-action view-once-toggle"
              :class="{ 'is-active': audioViewOnce }"
              aria-label="Visualização única"
              @click="toggleViewOnceAudio"
            >
              <VIcon size="20">
                {{ audioViewOnce ? 'tabler-eye-off' : 'tabler-eye' }}
              </VIcon>
            </IconBtn>

            <VBtn
              class="record-send-btn"
              color="success"
              variant="flat"
              icon
              rounded="pill"
              aria-label="Enviar áudio gravado"
              @click="finalizeAudioRecording"
            >
              <VIcon size="20">tabler-send</VIcon>
            </VBtn>
          </div>

          <div
            v-if="isQueueStatus"
            class="d-flex align-center justify-space-between pa-4 bg-surface rounded mb-2"
          >
            <span class="text-body-2 text-medium-emphasis">
              {{
                t(
                  'chat_queue_message',
                  'Para iniciar o atendimento clique em atender'
                )
              }}
            </span>
            <VBtn
              color="primary"
              size="small"
              @click="handleAttendChat"
              :loading="chatStore.loading"
            >
              {{ t('attend', 'Atender') }}
            </VBtn>
          </div>

          <VTextarea
            v-if="!isRecordingAudio"
            ref="composerRef"
            :key="contact_id"
            v-model="msg"
            variant="solo"
            density="comfortable"
            class="chat-message-input whats-composer"
            :placeholder="$t('write_your_message')"
            :auto-grow="true"
            rows="1"
            :max-rows="8"
            :disabled="isQueueStatus"
            @keydown.enter.exact.prevent="onSendText"
          >
            <template #prepend-inner>
              <VMenu
                offset="8"
                :close-on-content-click="true"
                location="top start"
              >
                <template #activator="{ props }">
                  <IconBtn
                    v-bind="props"
                    class="composer-btn"
                    aria-label="Anexar"
                  >
                    <VIcon size="22">tabler-plus</VIcon>
                  </IconBtn>
                </template>

                <VList
                  density="comfortable"
                  min-width="220"
                  class="attach-menu"
                >
                  <VListItem @click="openAttach('document')">
                    <template #prepend
                      ><VIcon size="20">tabler-file</VIcon></template
                    >
                    <VListItemTitle>Documentos</VListItemTitle>
                  </VListItem>
                  <VListItem @click="openAttach('photo')">
                    <template #prepend
                      ><VIcon size="20">tabler-photo</VIcon></template
                    >
                    <VListItemTitle>Fotos</VListItemTitle>
                  </VListItem>
                  <VListItem @click="openAttach('video')">
                    <template #prepend
                      ><VIcon size="20">tabler-video</VIcon></template
                    >
                    <VListItemTitle>Vídeos</VListItemTitle>
                  </VListItem>
                  <VListItem @click="openAttach('audio')">
                    <template #prepend
                      ><VIcon size="20">tabler-headphones</VIcon></template
                    >
                    <VListItemTitle>Áudio</VListItemTitle>
                  </VListItem>
                  <VListItem
                    v-if="canAccessContacts"
                    @click="openAttach('contact')"
                  >
                    <template #prepend
                      ><VIcon size="20">tabler-user</VIcon></template
                    >
                    <VListItemTitle>Contato</VListItemTitle>
                  </VListItem>
                  <VListItem @click="openAttach('location')">
                    <template #prepend
                      ><VIcon size="20">tabler-map-pin</VIcon></template
                    >
                    <VListItemTitle>Localização</VListItemTitle>
                  </VListItem>
                </VList>
              </VMenu>

              <VMenu
                v-model="isEmojiOpen"
                location="top start"
                :close-on-content-click="false"
                offset="8"
              >
                <template #activator="{ props }">
                  <IconBtn
                    v-bind="props"
                    class="composer-btn"
                    aria-label="Emoji"
                  >
                    <VIcon size="22">tabler-mood-smile</VIcon>
                  </IconBtn>
                </template>

                <div class="emoji-picker-wrap">
                  <Picker
                    :data="emojiIndex"
                    :per-line="8"
                    :show-preview="false"
                    :show-search="true"
                    :show-skin-tones="false"
                    @select="onEmojiSelect"
                  />
                </div>
              </VMenu>
            </template>

            <template #append-inner>
              <div class="d-flex align-center gap-1">
                <IconBtn
                  v-if="!hasAttachmentsOrContent"
                  class="composer-btn mic-btn"
                  aria-label="Gravar áudio"
                  @click="onRecordAudio"
                >
                  <VIcon size="22">tabler-microphone</VIcon>
                </IconBtn>

                <VBtn
                  v-if="hasAttachmentsOrContent"
                  class="send-btn"
                  icon
                  color="success"
                  variant="flat"
                  rounded="pill"
                  aria-label="Enviar mensagem"
                  @click="onSendText"
                >
                  <VIcon size="22">tabler-send</VIcon>
                </VBtn>
              </div>
            </template>
          </VTextarea>

          <input
            ref="fileDocRef"
            type="file"
            hidden
            multiple
            @change="onPickDoc"
          />
          <input
            ref="filePhotoRef"
            type="file"
            hidden
            accept="image/jpeg,image/jpg,image/png,image/gif,.jpg,.jpeg,.png,.gif"
            multiple
            @change="onPickPhoto"
          />
          <input
            ref="fileVideoRef"
            type="file"
            hidden
            accept="video/mp4,video/avi,video/x-flv,video/x-matroska,video/quicktime,video/3gpp,.mp4,.avi,.flv,.mkv,.mov,.3gp"
            @change="onPickVideo"
          />
          <input
            ref="fileAudioRef"
            type="file"
            hidden
            accept="audio/mpeg,audio/mp3,audio/aac,audio/m4a,audio/x-m4a,audio/amr,audio/amr-wb,audio/ogg,audio/opus,.mp3,.aac,.m4a,.amr,.ogg,.opus"
            multiple
            @change="onPickAudio"
          />
        </VForm>
      </div>

      <div
        v-if="!chatStore.activeChat"
        class="d-flex h-100 align-center justify-center flex-column"
      >
        <VAvatar size="98" variant="tonal" color="primary" class="mb-4">
          <VIcon size="50" class="rounded-0" icon="tabler-message-2" />
        </VAvatar>
        <VBtn
          v-if="$vuetify.display.smAndDown"
          rounded="pill"
          @click="startConversation"
        >
          {{ $t('start_conversation') }}
        </VBtn>

        <p
          v-if="!$vuetify.display.smAndDown"
          style="max-inline-size: 40ch; text-wrap: balance"
          class="text-center text-disabled"
        >
          {{ $t('select_a_contact') }}
        </p>
      </div>
    </VMain>
  </VLayout>

  <AppContactPicker
    v-if="canAccessContacts"
    v-model="isContactPickerOpen"
    :existing-contacts="selectedContacts"
    @select="onContactsSelected"
  />

  <VDialog v-model="isLocationPickerOpen" max-width="800" :scrollable="false">
    <VCard>
      <VCardTitle class="d-flex align-center justify-space-between">
        <span>{{ t('location_label', 'Localização') }}</span>
        <VBtn
          icon
          variant="text"
          size="small"
          @click="isLocationPickerOpen = false"
        >
          <VIcon>tabler-x</VIcon>
        </VBtn>
      </VCardTitle>
      <VCardText>
        <VTabs v-model="locationPickerMode" class="mb-4">
          <VTab value="current">
            <VIcon start>tabler-current-location</VIcon>
            Localização Atual
          </VTab>
          <VTab value="map">
            <VIcon start>tabler-map</VIcon>
            Escolher no Mapa
          </VTab>
          <VTab value="manual">
            <VIcon start>tabler-keyboard</VIcon>
            Digitar Coordenadas
          </VTab>
        </VTabs>

        <VWindow v-model="locationPickerMode">
          <VWindowItem value="current">
            <div class="d-flex flex-column align-center pa-4">
              <VIcon size="48" color="primary" class="mb-4">
                tabler-current-location
              </VIcon>
              <VBtn
                color="primary"
                @click="useCurrentLocation"
                :loading="
                  locationPickerMode === 'current' && !locationPickerLatitude
                "
              >
                Usar Localização Atual
              </VBtn>
              <p class="text-caption text-center mt-4">
                Clique no botão para obter sua localização atual
              </p>
            </div>
          </VWindowItem>

          <VWindowItem value="map">
            <div class="location-picker-map-container">
              <MglMap
                ref="locationMapRef"
                :map-style="mapStyle"
                :center="locationMapCenter"
                :zoom="15"
                width="100%"
                height="400px"
                @map:click="onLocationMapClick"
                @map:load="onLocationMapLoad"
              >
                <MglMarker
                  v-if="locationPickerLatitude && locationPickerLongitude"
                  :coordinates="locationMarkerPosition"
                  color="#ef4444"
                />
              </MglMap>
            </div>
            <VRow class="mt-4">
              <VCol cols="12">
                <AppTextField
                  v-model="locationPickerName"
                  label="Nome (opcional)"
                  placeholder="Ex: Minha Casa"
                />
              </VCol>
              <VCol cols="12">
                <AppTextField
                  v-model="locationPickerAddress"
                  label="Endereço (opcional)"
                  placeholder="Ex: Rua Exemplo, 123"
                />
              </VCol>
            </VRow>
          </VWindowItem>

          <VWindowItem value="manual">
            <VRow>
              <VCol cols="12" md="6">
                <AppTextField
                  v-model="locationInputLatitude"
                  label="Latitude"
                  placeholder="Ex: -15.459175"
                  type="number"
                  step="any"
                />
              </VCol>
              <VCol cols="12" md="6">
                <AppTextField
                  v-model="locationInputLongitude"
                  label="Longitude"
                  placeholder="Ex: -47.602219"
                  type="number"
                  step="any"
                />
              </VCol>
              <VCol cols="12">
                <VBtn
                  color="primary"
                  block
                  @click="useManualCoordinates"
                  :disabled="!locationInputLatitude || !locationInputLongitude"
                >
                  Aplicar Coordenadas
                </VBtn>
              </VCol>
            </VRow>
            <VRow
              v-if="locationPickerLatitude && locationPickerLongitude"
              class="mt-4"
            >
              <VCol cols="12">
                <AppTextField
                  v-model="locationPickerName"
                  label="Nome (opcional)"
                  placeholder="Ex: Minha Casa"
                />
              </VCol>
              <VCol cols="12">
                <AppTextField
                  v-model="locationPickerAddress"
                  label="Endereço (opcional)"
                  placeholder="Ex: Rua Exemplo, 123"
                />
              </VCol>
            </VRow>
          </VWindowItem>
        </VWindow>
      </VCardText>
      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          @click="isLocationPickerOpen = false"
        >
          {{ t('cancel', 'Cancelar') }}
        </VBtn>
        <VBtn
          color="primary"
          @click="confirmLocation"
          :disabled="!locationPickerLatitude || !locationPickerLongitude"
        >
          {{ t('send', 'Enviar Localização') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>

  <VDialog
    v-if="canAccessContacts"
    v-model="isContactViewModalOpen"
    max-width="600"
  >
    <DialogCloseBtn @click="isContactViewModalOpen = false" />

    <template v-if="contactStore.loading">
      <VOverlay
        :model-value="contactStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VCard :title="$t('view_contact')" v-if="selectedContactDetails">
      <VCardText>
        <VRow>
          <VCol cols="12" md="6">
            <AppTextField
              :model-value="selectedContactDetails.name"
              :label="$t('name') + ':'"
              readonly
            />
          </VCol>

          <VCol cols="12" md="6">
            <AppTextField
              :model-value="selectedContactDetails.last_name || ''"
              :label="$t('last_name') + ':'"
              readonly
            />
          </VCol>
        </VRow>
        <VRow>
          <VCol cols="12" md="6">
            <AppTextField
              :model-value="selectedContactDetails.nickname || ''"
              :label="$t('nickname') + ':'"
              readonly
            />
          </VCol>

          <VCol cols="12" md="6">
            <AppTextField
              :model-value="viewContactEmailFormatted"
              type="email"
              :label="$t('email') + ':'"
              readonly
            >
              <template #append-inner>
                <VIcon
                  :icon="isViewEmailDecrypted ? 'tabler-eye-off' : 'tabler-eye'"
                  class="cursor-pointer"
                  :class="{ 'opacity-50': isLoadingViewEmail }"
                  @click="toggleViewEmailVisibility"
                />
              </template>
            </AppTextField>
          </VCol>
        </VRow>
        <VRow>
          <VCol cols="12" md="6">
            <AppTextField
              :model-value="selectedContactDetails.phone_ddi || ''"
              :label="$t('phone_ddi') + ':'"
              readonly
            />
          </VCol>

          <VCol cols="12" md="6">
            <AppTextField
              :model-value="viewContactPhoneFormatted"
              type="tel"
              :label="$t('phone') + ':'"
              readonly
            >
              <template #append-inner>
                <VIcon
                  :icon="isViewPhoneDecrypted ? 'tabler-eye-off' : 'tabler-eye'"
                  class="cursor-pointer"
                  :class="{ 'opacity-50': isLoadingViewPhone }"
                  @click="toggleViewPhoneVisibility"
                />
              </template>
            </AppTextField>
          </VCol>
        </VRow>
        <VRow>
          <VCol cols="12" md="6">
            <AppTextField
              :model-value="
                selectedContactDetails.birthday
                  ? new Date(
                      selectedContactDetails.birthday + 'T00:00:00'
                    ).toLocaleDateString('pt-BR')
                  : ''
              "
              :label="$t('birthday') + ':'"
              readonly
            />
          </VCol>

          <VCol cols="12" md="6">
            <AppTextField
              :model-value="selectedContactDetails.label_template?.label || ''"
              :label="$t('label') + ':'"
              readonly
            />
          </VCol>
        </VRow>
        <VRow>
          <VCol cols="12">
            <label class="text-body-2 mb-1" for="notes-textarea">
              {{ $t('notes') }}:
            </label>
            <VTextarea
              :model-value="selectedContactDetails.notes || ''"
              readonly
            />
          </VCol>
        </VRow>
      </VCardText>

      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          @click="isContactViewModalOpen = false"
        >
          {{ $t('close') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>

  <AppAddContact
    v-model="isAddContactModalOpen"
    :initial-data="addContactInitialData"
  />

  <AppEditContact
    v-model="isEditContactModalOpen"
    :contact-id="editContactId"
  />

  <VSnackbar
    v-model="contactStore.snackbar.status"
    transition="scroll-y-reverse-transition"
    location="top end"
    :color="contactStore.snackbar.color"
  >
    {{ contactStore.snackbar.message }}
  </VSnackbar>

  <VSnackbar
    v-model="chatStore.snackbar.status"
    transition="scroll-y-reverse-transition"
    location="top end"
    :color="chatStore.snackbar.color"
  >
    {{ chatStore.snackbar.message }}
  </VSnackbar>

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

  <VDialog
    v-model="audioModalOpen"
    max-width="500"
    scrim="rgba(0,0,0,.7)"
    :scrollable="false"
  >
    <VCard class="audio-modal-card">
      <VCardTitle class="d-flex align-center justify-space-between">
        <span class="text-truncate">{{ audioModalName }}</span>
        <VBtn icon size="24" variant="text" @click="closeAudioModal">
          <VIcon size="18" icon="tabler-x" />
        </VBtn>
      </VCardTitle>
      <VCardText>
        <div class="audio-modal-player">
          <audio
            ref="audioModalPlayer"
            :src="audioModalSrc"
            preload="metadata"
            style="display: none"
          />
          <div class="audio-modal-controls">
            <VBtn
              icon
              size="48"
              variant="flat"
              color="primary"
              class="audio-modal-play-btn"
              @click="toggleAudioModalPlay"
            >
              <VIcon size="24">
                {{
                  audioModalIsPlaying
                    ? 'tabler-player-pause'
                    : 'tabler-player-play'
                }}
              </VIcon>
            </VBtn>
            <div class="audio-modal-info">
              <div class="audio-modal-time">
                <span>{{ formatAudioModalTime(audioModalCurrentTime) }}</span>
                <span>/</span>
                <span>{{ formatAudioModalTime(audioModalDuration) }}</span>
              </div>
              <div class="audio-modal-progress-container">
                <div
                  class="audio-modal-progress-bar"
                  :style="{ width: `${audioModalProgress}%` }"
                ></div>
              </div>
            </div>
          </div>
        </div>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style lang="scss">
@use '@styles/variables/vuetify';
@use '@webcore/scss/base/mixins';
@use '@layouts/styles/mixins' as layoutsMixins;

$chat-app-header-height: 76px;

%chat-header {
  display: flex;
  align-items: center;
  min-block-size: $chat-app-header-height;
  padding-inline: 1.5rem;
}

.chat-start-conversation-btn {
  cursor: default;
}

.chat-app-layout {
  border-radius: vuetify.$card-border-radius;
  @include mixins.elevation(vuetify.$card-elevation);
  $sel-chat-app-layout: &;

  @at-root {
    .skin--bordered {
      @include mixins.bordered-skin($sel-chat-app-layout);
    }
  }

  .active-chat-user-profile-sidebar,
  .user-profile-sidebar {
    .v-navigation-drawer__content {
      display: flex;
      flex-direction: column;
    }
  }

  .chat-list-header,
  .active-chat-header {
    @extend %chat-header;
  }

  .chat-list-sidebar {
    .v-navigation-drawer__content {
      display: flex;
      flex-direction: column;
    }
  }
}

.chat-message-input textarea {
  resize: none;
  overflow: hidden;
  line-height: 1.5rem;
  padding-top: 0.8rem !important;
  padding-bottom: 0.5rem !important;
}

.chat-content-container {
  background-color: v-bind(chatContentContainerBg);

  .chat-message-input {
    .v-field__input {
      font-size: 0.9375rem !important;
      line-height: 1.375rem !important;
      padding-block: 0.6rem 0.5rem;
      white-space: pre-wrap;
    }

    .v-field__append-inner {
      align-items: center;
      padding-block-start: 0;
    }

    .v-field--appended {
      padding-inline-end: 8px;
    }
  }
}

.chat-user-profile-badge {
  .v-badge__badge {
    min-width: 12px !important;
    height: 0.75rem;
  }
}

.link-preview-card {
  position: relative;
  padding: 14px;
  margin-bottom: 0.5rem;
}

.link-preview-close {
  position: absolute;
  top: 6px;
  right: 6px;
  min-width: 28px !important;
  width: 28px !important;
  height: 28px !important;
}

.two-line-ellipsis {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.composer-attachment {
  display: flex;
  justify-content: flex-start;
  width: 100%;
}

.composer-attachment-card {
  inline-size: 100%;
  max-inline-size: 100%;
}

.audio-recording-inline {
  background: rgb(var(--v-theme-surface));
  border-radius: 12px;
  min-height: 56px;
}

.audio-recording-inline .record-action {
  color: rgba(var(--v-theme-on-surface), 0.7) !important;
}

.audio-recording-inline .record-send-btn {
  min-width: 42px !important;
  height: 42px !important;
}

.audio-recording-info {
  display: flex;
  align-items: center;
  flex: 1;
}

.audio-wave-canvas {
  width: min(220px, 35vw);
  height: 28px;
  background: transparent;
}

.audio-recording-clock {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  min-width: 52px;
  text-align: center;
}

.recording-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgb(var(--v-theme-error));
  animation: pulse 1.4s ease-in-out infinite;
}

.recording-dot.is-paused {
  background: rgba(var(--v-theme-on-surface), 0.4);
  animation: none;
}

.record-action {
  color: rgba(var(--v-theme-on-surface), 0.6) !important;
}

.view-once-toggle.is-active {
  color: rgb(var(--v-theme-primary)) !important;
}

.audio-recording-controls {
  gap: 8px !important;
}

@keyframes pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.3);
    opacity: 0.65;
  }
}

.attachment-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.attachment-grid--videos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}

.video-preview-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  padding: 8px;
  overflow: hidden;
}

.video-preview-container {
  position: relative;
  inline-size: 100%;
  block-size: 120px;
  border-radius: 8px;
  overflow: hidden;
}

.video-preview {
  inline-size: 100%;
  block-size: 100%;
  border-radius: 8px;
  background: #000;
  object-fit: cover;
  cursor: pointer;
  display: block;
}

.video-preview-play-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.95);
  background: rgba(0, 0, 0, 0.3);
  pointer-events: auto;
  z-index: 1;
  border-radius: 8px;
  cursor: pointer;
}

.video-preview-play-overlay .v-icon {
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  transform: scale(1);
}

.video-preview-wrapper:hover .video-preview-play-overlay {
  background: rgba(0, 0, 0, 0.4);
}

.video-preview-wrapper:hover .video-preview-play-overlay .v-icon {
  transform: scale(1.2);
}

.video-preview-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.video-preview-name {
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.video-preview-info {
  white-space: nowrap;
}

.video-preview-remove {
  position: absolute;
  inset-block-start: 6px;
  inset-inline-end: 6px;
}

.attachment-grid--audios {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}

.audio-preview-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  padding: 8px;
  overflow: hidden;
}

.audio-preview-container {
  position: relative;
  inline-size: 100%;
  block-size: 120px;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(var(--v-theme-primary), 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.audio-preview-icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.audio-preview-play-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.95);
  background: rgba(0, 0, 0, 0.3);
  pointer-events: auto;
  z-index: 1;
  border-radius: 8px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.audio-preview-wrapper:hover .audio-preview-play-overlay {
  opacity: 1;
}

.audio-preview-play-overlay .v-icon {
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  transform: scale(1);
}

.audio-preview-wrapper:hover .audio-preview-play-overlay .v-icon {
  transform: scale(1.2);
}

.audio-preview-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.audio-preview-name {
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.audio-preview-info {
  white-space: nowrap;
}

.audio-preview-remove {
  position: absolute;
  inset-block-start: 6px;
  inset-inline-end: 6px;
}

.contact-preview-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  padding: 8px;
  overflow: hidden;
}

.contact-preview-container {
  position: relative;
  inline-size: 100%;
  block-size: 120px;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(var(--v-theme-primary), 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
}

.contact-preview-icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.contact-preview-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.contact-preview-name {
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.contact-preview-info {
  white-space: nowrap;
}

.contact-preview-remove {
  position: absolute;
  inset-block-start: 6px;
  inset-inline-end: 6px;
}

.audio-modal-card {
  border-radius: 12px;
}

.audio-modal-player {
  padding: 16px 0;
}

.audio-modal-controls {
  display: flex;
  align-items: center;
  gap: 16px;
}

.audio-modal-play-btn {
  min-width: 48px !important;
  width: 48px !important;
  height: 48px !important;
  flex-shrink: 0;
}

.audio-modal-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.audio-modal-time {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.875rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-variant-numeric: tabular-nums;
}

.audio-modal-progress-container {
  width: 100%;
  height: 4px;
  background: rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 2px;
  overflow: hidden;
  cursor: pointer;
}

.audio-modal-progress-bar {
  height: 100%;
  background: rgb(var(--v-theme-primary));
  border-radius: 2px;
  transition: width 0.1s linear;
}

.photo-preview-wrapper {
  position: relative;
  inline-size: 132px;
  block-size: 132px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
}

.photo-preview-image {
  inline-size: 100%;
  block-size: 100%;
  border-radius: 8px;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.photo-preview-wrapper:hover .photo-preview-image {
  opacity: 0.9;
}

.photo-preview-remove {
  position: absolute;
  inset-block-start: 4px;
  inset-inline-end: 4px;
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

.location-picker-map-container {
  width: 100%;
  height: 400px;
  position: relative;
  border-radius: 8px;
  overflow: hidden;
}

.message-target-flash {
  animation: messageTargetFlash 1.1s ease;
}

.message-target-persistent-content {
  background-color: rgba(var(--v-theme-primary), 0.12) !important;
  transition: background-color 0.3s ease;
  border-top-left-radius: 8px !important;
}
@keyframes messageTargetFlash {
  0% {
    background-color: rgba(var(--v-theme-primary), 0.16);
  }
  100% {
    background-color: transparent;
  }
}

.document-preview-item {
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.document-preview-name {
  display: inline-block;
  max-width: 220px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.document-preview-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 320px;
  overflow-y: auto;
  padding-inline-end: 4px;
}
.contact-label {
  font-size: 0.625rem !important;
  height: 16px !important;
  opacity: 0.7;
  flex-shrink: 0;
}
</style>
