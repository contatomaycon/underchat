import { onMessage } from '@webcore/centrifugo';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import { useChatStore } from '@webcore/stores/chat';
import { useChannelsStore } from '@webcore/stores/channels';
import {
  RouteLocationNormalizedLoaded,
  Router,
  useRoute,
  useRouter,
} from 'vue-router';
import { getPermissions } from './localStorage/user';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import {
  IChatMessage,
  IContent,
  IQuotedMessage,
} from '@core/common/interfaces/IChatMessage';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { EMessageType } from '@core/common/enums/EMessageType';
import { getI18n } from '@/plugins/i18n';
import type { ViewWorkerConfigForChatResponse } from '@core/schema/chat/viewWorkerConfigForChat/response.schema';

const MAX_NOTIFIED_CACHE = 500;

const notifiedMessageIds = new Set<string>();
const notifiedMessagesQueue: string[] = [];

let initializedAccountId: string | null = null;

const withBase = (path: string): string => {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  return `${base}${cleanPath}`;
};

const messageAlertAudio =
  typeof Audio !== 'undefined'
    ? (() => {
        const audio = new Audio(withBase('sounds/message-alert.mp3'));
        audio.preload = 'auto';
        audio.volume = 1;
        return audio;
      })()
    : null;

const hasChatPermission = (): boolean => {
  const permissions = getPermissions();

  const allowed = permissions.some(
    (perm) =>
      perm === EGeneralPermissions.full_access ||
      perm === EGeneralPermissions.full_access_group ||
      perm === EChatPermissions.chat_group ||
      perm === EChatPermissions.chat_access
  );

  return allowed;
};

const isChatRoute = (route: RouteLocationNormalizedLoaded): boolean => {
  const path = route.path || '';
  const name = (route.name as string | undefined) ?? '';

  const result = /^\/chat(\/|$)/.test(path) || name === 'chat';
  return result;
};

const truncate = (value: string, max = 140): string => {
  if (value.length <= max) return value;

  return `${value.slice(0, max - 3)}...`;
};

const getMediaLabel = (type: EMessageType, t: (key: string) => string) => {
  const labels: Partial<
    Record<
      EMessageType,
      {
        icon: string;
        key: string;
      }
    >
  > = {
    [EMessageType.image]: { icon: '📷', key: 'message_notification.image' },
    [EMessageType.video]: { icon: '🎥', key: 'message_notification.video' },
    [EMessageType.audio]: { icon: '🎵', key: 'message_notification.audio' },
    [EMessageType.document]: {
      icon: '📄',
      key: 'message_notification.document',
    },
    [EMessageType.location]: {
      icon: '📍',
      key: 'message_notification.location',
    },
    [EMessageType.contact_card]: {
      icon: '👤',
      key: 'message_notification.contact',
    },
    [EMessageType.sticker]: { icon: '🎨', key: 'message_notification.sticker' },
  };

  const entry = labels[type];
  if (!entry) return t('message_notification.preview_default');

  return `${entry.icon} ${t(entry.key)}`;
};

const resolveQuotedType = (quoted: IQuotedMessage): EMessageType | null => {
  if (quoted.type) return quoted.type;
  if (quoted.image) return EMessageType.image;
  if (quoted.video) return EMessageType.video;
  if (quoted.audio) return EMessageType.audio;
  if (quoted.document) return EMessageType.document;
  if (quoted.location) return EMessageType.location;
  if (quoted.contact) return EMessageType.contact_card;
  if (quoted.sticker) return EMessageType.sticker;

  return null;
};

const buildQuotedPreview = (
  quoted: IQuotedMessage | null | undefined,
  t: (key: string) => string
): string | null => {
  if (!quoted) return null;

  const quotedType = resolveQuotedType(quoted);
  const quotedMessage =
    quoted.message ||
    (quotedType ? getMediaLabel(quotedType, t) : null) ||
    null;

  if (!quotedMessage) return null;

  return `${t('message_notification.quoted_prefix')} ${truncate(
    quotedMessage
  )}`;
};

const buildContentPreview = (
  content: IContent | null | undefined,
  t: (key: string) => string
): string => {
  if (!content) return t('message_notification.preview_default');

  const textMessage = content.message?.trim();
  if (
    (content.type === EMessageType.text ||
      content.type === EMessageType.edit_text) &&
    textMessage
  ) {
    return truncate(textMessage);
  }

  if (content.type === EMessageType.location) {
    const label = content.location?.name || content.location?.address;
    if (label) {
      return truncate(`${getMediaLabel(content.type, t)} - ${label}`);
    }
  }

  if (content.type === EMessageType.document && content.document?.name) {
    return truncate(
      `${getMediaLabel(content.type, t)} - ${content.document.name}`
    );
  }

  if (content.type === EMessageType.contact_card && content.contact?.name) {
    return truncate(
      `${getMediaLabel(content.type, t)} - ${content.contact.name}`
    );
  }

  return getMediaLabel(content.type, t);
};

const buildMessagePreview = (
  messageData: IChatMessage,
  t: (key: string) => string
): string => {
  const contentPreview = buildContentPreview(messageData.content, t);
  const quotedPreview = buildQuotedPreview(messageData.content?.quoted, t);

  if (quotedPreview) {
    return `${quotedPreview}\n${contentPreview}`;
  }

  return contentPreview;
};

const ensureNotificationPermission = async (): Promise<boolean> => {
  if (typeof Notification === 'undefined') {
    return false;
  }

  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') {
    return false;
  }

  const permission = await Notification.requestPermission();
  return permission === 'granted';
};

const playMessageSound = (): void => {
  if (!messageAlertAudio) return;

  try {
    messageAlertAudio.currentTime = 0;
    void messageAlertAudio.play().catch(() => {});
  } catch {}
};

const rememberMessageId = (messageId: string): boolean => {
  if (notifiedMessageIds.has(messageId)) {
    return true;
  }

  notifiedMessageIds.add(messageId);
  notifiedMessagesQueue.push(messageId);

  if (notifiedMessagesQueue.length > MAX_NOTIFIED_CACHE) {
    const removed = notifiedMessagesQueue.shift();
    if (removed) {
      notifiedMessageIds.delete(removed);
    }
  }

  return false;
};

const shouldSkipDueToWorkerConfig = async (
  workerId: string | undefined,
  channelStore: ReturnType<typeof useChannelsStore>,
  userStatus: EChatUserStatus | undefined
): Promise<boolean> => {
  if (!workerId) return false;

  const cache = channelStore.workerConfigForChatCache;
  const hasCachedValue =
    cache && Object.prototype.hasOwnProperty.call(cache, workerId);
  const cached = hasCachedValue
    ? cache[workerId]
    : await channelStore.fetchWorkerConfigForChat(workerId);

  const config: ViewWorkerConfigForChatResponse | null | undefined = cached;

  if (!config?.allow_attendance_only_online) return false;

  return userStatus !== EChatUserStatus.online;
};

const resolveNotificationTitle = (
  messageData: IChatMessage,
  t: (key: string) => string
): string => {
  const contactName = messageData.user?.name?.trim();
  const phone = messageData.phone;
  const contentPreview = buildContentPreview(messageData.content, t);
  const maxTitleLength = 60;

  return truncate(
    contactName ||
      phone ||
      contentPreview ||
      t('message_notification.title_fallback'),
    maxTitleLength
  );
};

const resolveNotificationIcon = (messageData: IChatMessage): string => {
  const contactPhoto = messageData.user?.photo;
  if (contactPhoto) {
    return contactPhoto;
  }

  return new URL('../assets/images/logo.svg', import.meta.url).href;
};

const handleNotificationClick = async (
  router: Router,
  chatId: string
): Promise<void> => {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('pending-chat-id', chatId);
    }

    await router.push({ name: 'chat', query: { chat_id: chatId } });
    globalThis.focus?.();
  } catch {}
};

const handleMessageNotification = async (
  messageData: IChatMessage,
  router: Router,
  route: RouteLocationNormalizedLoaded
): Promise<void> => {
  const chatStore = useChatStore();
  const channelStore = useChannelsStore();
  const i18n = getI18n();
  const t = i18n.global.t;

  if (!messageData?.message_id) return;

  if (chatStore.user?.chat_user?.notifications !== true) {
    return;
  }
  if (!hasChatPermission()) {
    return;
  }

  if (isChatRoute(route)) {
    return;
  }

  const userStatus = chatStore.user?.chat_user?.status as
    | EChatUserStatus
    | undefined;
  const shouldSkipWorker = await shouldSkipDueToWorkerConfig(
    messageData.worker?.id,
    channelStore,
    userStatus
  );

  if (shouldSkipWorker) {
    return;
  }

  const permissionGranted = await ensureNotificationPermission();
  if (!permissionGranted) {
    return;
  }

  if (rememberMessageId(messageData.message_id)) return;

  playMessageSound();

  if (typeof Notification === 'undefined') {
    return;
  }

  const title = resolveNotificationTitle(messageData, t);
  type NotificationOptionsCompat = NotificationOptions & {
    renotify?: boolean;
    timestamp?: number;
  };
  const bodyPreview = truncate(buildMessagePreview(messageData, t), 160);

  const options: NotificationOptionsCompat = {
    body: bodyPreview,
    icon: resolveNotificationIcon(messageData),
    badge: withBase('favicon.ico'),
    tag: messageData.message_id,
    data: {
      chatId: messageData.chat_id,
    },
    silent: false,
    renotify: true,
    requireInteraction: true,
    timestamp: Date.now(),
  };

  const showViaServiceWorker = async (): Promise<boolean> => {
    if (!('serviceWorker' in navigator)) {
      return false;
    }

    try {
      const readyPromise = navigator.serviceWorker?.ready;
      if (!readyPromise) {
        return false;
      }

      const sw = await Promise.race([
        readyPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
      ]);

      if (!sw) {
        return false;
      }

      if (!sw.showNotification) {
        return false;
      }

      await sw.showNotification(title, options);
      return true;
    } catch {
      return false;
    }
  };

  const shownBySw = await showViaServiceWorker();
  if (shownBySw) return;

  try {
    const notification = new Notification(title, options);

    notification.onclick = () => {
      void handleNotificationClick(router, messageData.chat_id);
    };
  } catch {}
};

export const initMessageNotificationsSubscription = async (
  accountId: string
): Promise<void> => {
  if (!accountId) return;
  if (initializedAccountId === accountId) return;

  initializedAccountId = accountId;

  const route = useRoute();
  const router = useRouter();

  await onMessage(chatAccountCentrifugo(accountId), (data: any) => {
    if (!data || typeof data !== 'object') return;
    if (!('message_id' in data)) return;

    void handleMessageNotification(
      data as IChatMessage,
      router,
      route as RouteLocationNormalizedLoaded
    );
  });
};
