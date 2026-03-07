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
  getStoredPushSubscription,
  setStoredPushSubscription,
} from '../storage/pushStorage';

type PushEnableResult = {
  ok: boolean;
  reason: 'permission_denied' | 'token_unavailable' | 'server_error' | null;
};

const ANDROID_CHANNEL_ID = 'underchat-messages';
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

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Mensagens',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
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

async function resolveSubscriptionForDelete(): Promise<{
  endpoint: string;
  provider: 'expo';
} | null> {
  const stored = await getStoredPushSubscription();
  if (stored) {
    return stored;
  }

  const token = await getExpoPushToken();
  if (!token) {
    return null;
  }

  return {
    endpoint: token,
    provider: 'expo',
  };
}

async function deletePushSubscriptionDirect(payload: {
  endpoint: string;
  provider: 'expo';
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
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'pt',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
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

    await ensureAndroidChannel();
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

  await ensureAndroidChannel();

  const token = await getExpoPushToken();
  if (!token) {
    return { ok: false, reason: 'token_unavailable' };
  }

  const ok = await registerPushSubscription({
    provider: 'expo',
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    endpoint: token,
    user_agent: Platform.OS,
  });

  if (!ok) {
    return { ok: false, reason: 'server_error' };
  }

  await setStoredPushSubscription({
    endpoint: token,
    provider: 'expo',
  });

  return { ok: true, reason: null };
}

export async function disableMobilePushNotifications(): Promise<boolean> {
  const subscription = await resolveSubscriptionForDelete();
  if (!subscription) {
    return false;
  }

  const ok = await deletePushSubscription({
    endpoint: subscription.endpoint,
    provider: subscription.provider,
  });

  if (ok) {
    await clearStoredPushSubscription();
  }

  return ok;
}

export async function unsubscribeMobilePushOnLogout(): Promise<void> {
  const subscription = await resolveSubscriptionForDelete();
  if (!subscription) {
    await clearStoredPushSubscription();
    return;
  }

  await deletePushSubscriptionDirect({
    endpoint: subscription.endpoint,
    provider: subscription.provider,
  }).catch(() => false);

  await clearStoredPushSubscription();
}
