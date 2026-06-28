import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { BACKEND_URL } from '../config';
import {
  deletePushSubscription,
  registerPushSubscription,
} from '../api/chatApi';
import type { ListChatsResult } from '../types/chat';
import { getToken } from '../storage/authStorage';
import {
  clearStoredPushSubscription,
  getStoredPushSubscriptions,
  setStoredPushSubscriptions,
  type StoredPushSubscription,
} from '../storage/pushStorage';

type PushEnableResult = {
  ok: boolean;
  reason: 'permission_denied' | 'token_unavailable' | 'server_error' | null;
};

const ANDROID_CHANNEL_SOUND_VIBRATE = 'underchat-messages';
const ANDROID_CHANNEL_SOUND = 'underchat-messages-sound';
const ANDROID_CHANNEL_VIBRATE = 'underchat-messages-vibrate';
const ANDROID_CHANNEL_SILENT = 'underchat-messages-silent';
let initialized = false;
let responseSubscription: Notifications.EventSubscription | null = null;

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseChatSnapshot(value: unknown): ListChatsResult | null {
  const parsed =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return null;
          }
        })()
      : value;

  if (!isRecord(parsed)) return null;

  const chatId = readString(parsed.chat_id);
  const phone = readString(parsed.phone);
  const status = readString(parsed.status);
  const date = readString(parsed.date);
  const account = isRecord(parsed.account) ? parsed.account : null;
  const worker = isRecord(parsed.worker) ? parsed.worker : null;

  if (!chatId || !phone || !status || !date || !account || !worker) {
    return null;
  }

  const accountId = readString(account.id);
  const accountName = readString(account.name);
  const workerId = readString(worker.id);
  const workerName = readString(worker.name);

  if (!accountId || !accountName || !workerId || !workerName) {
    return null;
  }

  return {
    chat_id: chatId,
    account: {
      id: accountId,
      name: accountName,
    },
    worker: {
      id: workerId,
      name: workerName,
    },
    sector: isRecord(parsed.sector)
      ? {
          id: readString(parsed.sector.id) ?? '',
          name: readString(parsed.sector.name) ?? '',
          ...(readString(parsed.sector.color)
            ? { color: readString(parsed.sector.color) ?? undefined }
            : {}),
        }
      : null,
    user: isRecord(parsed.user)
      ? {
          id: readString(parsed.user.id) ?? '',
          name: readString(parsed.user.name) ?? '',
          photo: readString(parsed.user.photo),
        }
      : null,
    secondary_users: Array.isArray(parsed.secondary_users)
      ? parsed.secondary_users
          .filter((item): item is Record<string, unknown> => isRecord(item))
          .map((item) => ({
            id: readString(item.id) ?? '',
            name: readString(item.name) ?? '',
            photo: readString(item.photo),
          }))
          .filter((item) => item.id.length > 0)
      : [],
    contact: isRecord(parsed.contact)
      ? {
          id: readString(parsed.contact.id) ?? '',
          name: readString(parsed.contact.name) ?? '',
          phone: readString(parsed.contact.phone) ?? '',
          phone_ddi: readString(parsed.contact.phone_ddi),
          photo: readString(parsed.contact.photo),
        }
      : null,
    photo: readString(parsed.photo),
    name: readString(parsed.name),
    phone,
    status: status as ListChatsResult['status'],
    date,
    summary: isRecord(parsed.summary)
      ? {
          last_message: readString(parsed.summary.last_message),
          last_date: readString(parsed.summary.last_date),
          unread_count:
            typeof parsed.summary.unread_count === 'number' &&
            Number.isFinite(parsed.summary.unread_count)
              ? parsed.summary.unread_count
              : 0,
        }
      : null,
    started_at: readString(parsed.started_at),
    closed_at: readString(parsed.closed_at),
    protocol_ura: Array.isArray(parsed.protocol_ura)
      ? parsed.protocol_ura.filter(
          (item): item is string => typeof item === 'string'
        )
      : null,
    protocol_start: Array.isArray(parsed.protocol_start)
      ? parsed.protocol_start.filter(
          (item): item is string => typeof item === 'string'
        )
      : null,
    protocol_transfer: Array.isArray(parsed.protocol_transfer)
      ? parsed.protocol_transfer.filter(
          (item): item is string => typeof item === 'string'
        )
      : null,
    label: Array.isArray(parsed.label)
      ? (parsed.label.filter(
          (
            item
          ): item is {
            label_template_id: string;
            label: string;
            color: string;
          } =>
            isRecord(item) &&
            typeof item.label_template_id === 'string' &&
            typeof item.label === 'string' &&
            typeof item.color === 'string'
        ) as NonNullable<ListChatsResult['label']>)
      : null,
    forward_to_output_chatbot:
      typeof parsed.forward_to_output_chatbot === 'boolean'
        ? parsed.forward_to_output_chatbot
        : null,
  };
}

function parseInternalChatConversationId(data: unknown): string | null {
  if (!isRecord(data)) {
    return null;
  }

  const notificationType = readString(data.notificationType);
  const conversationId =
    readString(data.internalChatConversationId) ??
    readString(data.internal_chat_conversation_id);

  if (!conversationId) {
    return null;
  }

  if (notificationType && notificationType !== 'internal_chat_message') {
    return null;
  }

  return conversationId;
}

export function isAnyMobilePushPreferenceEnabled(user: unknown): boolean {
  if (!isRecord(user)) return false;
  const chatUser = isRecord(user.chat_user) ? user.chat_user : null;
  if (!chatUser) return false;

  const customerChatEnabled =
    chatUser.notifications !== false && chatUser.notifications_push !== false;
  const internalChatEnabled =
    chatUser.notifications_internal_chat !== false &&
    chatUser.notifications_internal_chat_push !== false;

  return customerChatEnabled || internalChatEnabled;
}

async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Promise.all([
    Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_SOUND_VIBRATE, {
      name: 'Mensagens',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      enableVibrate: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    }),
    Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_SOUND, {
      name: 'Mensagens com som',
      importance: Notifications.AndroidImportance.MAX,
      enableVibrate: false,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    }),
    Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_VIBRATE, {
      name: 'Mensagens vibrando',
      importance: Notifications.AndroidImportance.MAX,
      sound: null,
      vibrationPattern: [0, 250, 250, 250],
      enableVibrate: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    }),
    Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_SILENT, {
      name: 'Mensagens silenciosas',
      importance: Notifications.AndroidImportance.HIGH,
      sound: null,
      enableVibrate: false,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    }),
  ]);
}

function getProjectId(): string | null {
  const fromEasConfig = readString(
    (Constants.easConfig as { projectId?: unknown } | null)?.projectId
  );
  if (fromEasConfig) {
    return fromEasConfig;
  }

  const expoConfig = Constants.expoConfig as {
    extra?: { eas?: { projectId?: unknown } };
  } | null;
  return readString(expoConfig?.extra?.eas?.projectId);
}

async function getExpoPushToken(): Promise<string | null> {
  const projectId = getProjectId();
  if (!projectId) {
    console.warn('[Push] projectId não encontrado no EAS config');
    return null;
  }

  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return readString(token.data);
  } catch (err) {
    console.warn('[Push] Falha ao obter Expo push token:', err);
    return null;
  }
}

function getMobilePushPlatform(): 'ios' | 'android' | null {
  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    return Platform.OS;
  }

  return null;
}

async function getNativeDevicePushSubscription(): Promise<StoredPushSubscription | null> {
  const platform = getMobilePushPlatform();
  if (!platform) {
    return null;
  }

  try {
    const token = await Notifications.getDevicePushTokenAsync();
    const endpoint = readString(token.data);
    if (!endpoint) {
      return null;
    }

    return {
      endpoint,
      provider: platform === 'ios' ? 'apns' : 'fcm',
    };
  } catch (err) {
    console.warn('[Push] Falha ao obter token nativo do dispositivo:', err);
    return null;
  }
}

async function requestPushPermission(): Promise<boolean> {
  const settings = await Notifications.getPermissionsAsync();
  let status = settings.status;

  if (status !== 'granted') {
    const requestResult = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });
    status = requestResult.status;
  }

  return status === 'granted';
}

async function resolveSubscriptionsForDelete(): Promise<
  StoredPushSubscription[]
> {
  const stored = await getStoredPushSubscriptions();
  if (stored.length > 0) {
    return stored;
  }

  const [expoToken, nativeSubscription] = await Promise.all([
    getExpoPushToken(),
    getNativeDevicePushSubscription(),
  ]);
  const subscriptions: StoredPushSubscription[] = [];

  if (expoToken) {
    subscriptions.push({
      endpoint: expoToken,
      provider: 'expo',
    });
  }

  if (nativeSubscription) {
    subscriptions.push(nativeSubscription);
  }

  return subscriptions;
}

async function deletePushSubscriptionDirect(payload: {
  endpoint: string;
  provider: StoredPushSubscription['provider'];
}): Promise<boolean> {
  if (!BACKEND_URL) {
    return false;
  }

  const token = await getToken();
  if (!token) {
    return false;
  }

  try {
    const response = await fetch(`${BACKEND_URL}/v1/push/unsubscribe`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'pt',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Client-Platform': 'mobile',
      },
      body: JSON.stringify(payload),
    });

    return response.ok;
  } catch {
    return false;
  }
}

export async function initializePushNotifications(options: {
  onChatTap: (chat: ListChatsResult) => void;
  onInternalChatTap?: (conversationId: string) => void;
}): Promise<void> {
  if (!initialized) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });

    await ensureAndroidChannels();
    initialized = true;
  }

  if (responseSubscription) {
    responseSubscription.remove();
  }

  responseSubscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const data = response.notification.request.content.data;
      const chat = parseChatSnapshot(
        isRecord(data) ? data.chatSnapshot : undefined
      );
      if (chat) {
        options.onChatTap(chat);
        return;
      }

      const internalChatConversationId = parseInternalChatConversationId(data);
      if (internalChatConversationId) {
        options.onInternalChatTap?.(internalChatConversationId);
      }
    }
  );

  const initialResponse =
    await Notifications.getLastNotificationResponseAsync();
  if (initialResponse) {
    const data = initialResponse.notification.request.content.data;
    const chat = parseChatSnapshot(
      isRecord(data) ? data.chatSnapshot : undefined
    );
    if (chat) {
      options.onChatTap(chat);
      return;
    }

    const internalChatConversationId = parseInternalChatConversationId(data);
    if (internalChatConversationId) {
      options.onInternalChatTap?.(internalChatConversationId);
    }
  }
}

export function cleanupPushNotifications(): void {
  if (responseSubscription) {
    responseSubscription.remove();
    responseSubscription = null;
  }
}

export async function enableMobilePushNotifications(): Promise<PushEnableResult> {
  const granted = await requestPushPermission();
  if (!granted) {
    return { ok: false, reason: 'permission_denied' };
  }

  await ensureAndroidChannels();

  const platform = getMobilePushPlatform();
  if (!platform) {
    return { ok: false, reason: 'token_unavailable' };
  }

  const [expoToken, nativeSubscription] = await Promise.all([
    getExpoPushToken(),
    getNativeDevicePushSubscription(),
  ]);
  const subscriptionsToRegister: StoredPushSubscription[] = [];

  if (expoToken) {
    subscriptionsToRegister.push({
      provider: 'expo',
      endpoint: expoToken,
    });
  }

  if (nativeSubscription) {
    subscriptionsToRegister.push(nativeSubscription);
  }

  if (subscriptionsToRegister.length === 0) {
    return { ok: false, reason: 'token_unavailable' };
  }

  const registeredSubscriptions = (
    await Promise.all(
      subscriptionsToRegister.map(async (subscription) => {
        const ok = await registerPushSubscription({
          provider: subscription.provider,
          platform,
          endpoint: subscription.endpoint,
          user_agent: Platform.OS,
        });

        return ok ? subscription : null;
      })
    )
  ).filter(
    (subscription): subscription is StoredPushSubscription => !!subscription
  );

  if (registeredSubscriptions.length === 0) {
    return { ok: false, reason: 'server_error' };
  }

  await setStoredPushSubscriptions(registeredSubscriptions);

  return { ok: true, reason: null };
}

export async function disableMobilePushNotifications(): Promise<boolean> {
  const subscriptions = await resolveSubscriptionsForDelete();
  if (subscriptions.length === 0) {
    return false;
  }

  const results = await Promise.all(
    subscriptions.map((subscription) =>
      deletePushSubscription({
        endpoint: subscription.endpoint,
        provider: subscription.provider,
      })
    )
  );
  const ok = results.some(Boolean);

  if (ok) {
    await clearStoredPushSubscription();
  }

  return ok;
}

export async function unsubscribeMobilePushOnLogout(): Promise<void> {
  const subscriptions = await resolveSubscriptionsForDelete();
  if (subscriptions.length === 0) {
    await clearStoredPushSubscription();
    return;
  }

  await Promise.allSettled(
    subscriptions.map((subscription) =>
      deletePushSubscriptionDirect({
        endpoint: subscription.endpoint,
        provider: subscription.provider,
      })
    )
  );

  await clearStoredPushSubscription();
}
