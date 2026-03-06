import { ability } from '@/plugins/0.casl/ability';
import { getToken } from '../localStorage/user';
import { clearAllData } from './clearAllData';
import { normalizeBaseUrl } from './helpers';

type TeardownSessionOptions = {
  notifyServerLogout?: boolean;
  notifyPushServer?: boolean;
};

const logoutOnServer = async (): Promise<void> => {
  const token = getToken();
  const baseUrl = normalizeBaseUrl(import.meta.env.VITE_BACKEND_URL);

  if (!token || !baseUrl) {
    return;
  }

  try {
    await fetch(`${baseUrl}/v1/auth/logout`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (error) {
    console.warn('Failed to notify server logout', error);
  }
};

const unsubscribePushLocalOnly = async (): Promise<void> => {
  if (!('serviceWorker' in navigator) || !('PushManager' in globalThis)) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      return;
    }

    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      return;
    }

    await subscription.unsubscribe();
  } catch {
    // ignore
  }
};

const cleanupPresenceAndPush = async (
  notifyPushServer: boolean
): Promise<void> => {
  try {
    const { presenceOffline } = await import('@webcore/presence');
    await presenceOffline();
  } catch {
    // ignore
  }

  if (notifyPushServer) {
    try {
      const { unsubscribeFromPushNotifications } =
        await import('@/composables/useChatNotifications');
      await unsubscribeFromPushNotifications();
      return;
    } catch {
      // ignore
    }
  }

  await unsubscribePushLocalOnly();
};

const shutdownAttendanceGuard = async (): Promise<void> => {
  try {
    const { useAttendanceGuardStore } =
      await import('@webcore/stores/attendanceGuard');
    useAttendanceGuardStore().shutdown();
  } catch {
    // ignore
  }
};

const resetRealtimeState = async (): Promise<void> => {
  try {
    const { resetUserPresenceSubscriptionState } =
      await import('@webcore/presenceCentrifugo');
    resetUserPresenceSubscriptionState();
  } catch {
    // ignore
  }

  try {
    const { resetConnection } = await import('@webcore/centrifugo');
    resetConnection();
  } catch {
    // ignore
  }
};

export const teardownClientSession = async (
  options: TeardownSessionOptions = {}
): Promise<void> => {
  const { notifyServerLogout = false, notifyPushServer = true } = options;

  await cleanupPresenceAndPush(notifyPushServer);

  if (notifyServerLogout) {
    await logoutOnServer();
  }

  await shutdownAttendanceGuard();
  await resetRealtimeState();

  clearAllData();
  ability.update([]);
};
