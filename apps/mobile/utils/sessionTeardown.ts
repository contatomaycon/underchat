import AsyncStorage from '@react-native-async-storage/async-storage';
import { BACKEND_URL } from '../config';
import { clearAuth, getToken } from '../storage/authStorage';
import { clearStoredPushSubscription } from '../storage/pushStorage';
import { clearWorkerCommandActionAttempts } from '../storage/workerCommandActionAttemptStorage';
import { emitAuthUnauthorized } from './authEvents';

const EXTRA_STORAGE_KEYS = ['chat_reaction_recent_emojis_v1'];

type TeardownMobileSessionOptions = {
  notifyServerLogout?: boolean;
  notifyPushServer?: boolean;
  emitUnauthorized?: boolean;
};

let unauthorizedTeardownPromise: Promise<void> | null = null;

const clearExtraStorage = async (): Promise<void> => {
  await Promise.all(
    EXTRA_STORAGE_KEYS.map((key) =>
      AsyncStorage.removeItem(key).catch(() => {
        // ignore
      })
    )
  );
};

const logoutOnServer = async (): Promise<void> => {
  const token = await getToken();
  if (!token || !BACKEND_URL) {
    return;
  }

  try {
    await fetch(`${BACKEND_URL}/v1/auth/logout`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'pt',
        Authorization: `Bearer ${token}`,
        'X-Client-Platform': 'mobile',
      },
    });
  } catch (error) {
    console.warn('Failed to notify server logout', error);
  }
};

const unsubscribePushServerSide = async (): Promise<void> => {
  try {
    const { unsubscribeMobilePushOnLogout } =
      await import('../services/pushNotifications');
    await unsubscribeMobilePushOnLogout();
  } catch (error) {
    console.warn('Failed to unsubscribe push notifications on logout', error);
  }
};

const cleanupRealtimeConnections = async (): Promise<void> => {
  try {
    const { cleanupChatSocket } = await import('../socket/chatSocket');
    await cleanupChatSocket();
  } catch {
    // ignore
  }

  try {
    const { resetConnection } = await import('../socket/centrifugo');
    resetConnection();
  } catch {
    // ignore
  }
};

export async function teardownMobileSession(
  options: TeardownMobileSessionOptions = {}
): Promise<void> {
  const {
    notifyServerLogout = false,
    notifyPushServer = false,
    emitUnauthorized = true,
  } = options;

  if (notifyPushServer) {
    await unsubscribePushServerSide();
  }

  if (notifyServerLogout) {
    await logoutOnServer();
  }

  await cleanupRealtimeConnections();

  await Promise.all([
    clearAuth(),
    clearStoredPushSubscription(),
    clearWorkerCommandActionAttempts(),
    clearExtraStorage(),
  ]);

  if (emitUnauthorized) {
    emitAuthUnauthorized();
  }
}

export async function teardownMobileSessionOnUnauthorized(): Promise<void> {
  if (unauthorizedTeardownPromise) {
    return unauthorizedTeardownPromise;
  }

  unauthorizedTeardownPromise = teardownMobileSession({
    notifyPushServer: true,
    notifyServerLogout: false,
    emitUnauthorized: true,
  }).finally(() => {
    unauthorizedTeardownPromise = null;
  });

  return unauthorizedTeardownPromise;
}
