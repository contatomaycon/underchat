import axios from '@webcore/axios';
import { router } from '@/plugins/1.router';
import { isLoggedIn, getUser } from './localStorage/user';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { useChatStore } from '@/@webcore/stores/chat';
import { AuthUserResponse } from '@core/schema/auth/login/response.schema';

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let awayHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
let busyHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
let listenersBound = false;
let lastHandledPath: string | null = null;

const updateLocalPresenceStatus = (status: EChatUserStatus): void => {
  const chatStore = useChatStore();
  const currentUser = chatStore.user;

  if (!currentUser) return;

  const updatedChatUser = currentUser.chat_user
    ? {
        ...currentUser.chat_user,
        status,
      }
    : ({
        status,
        notifications: true,
        about: '',
        chat_user_id: '',
      } as AuthUserResponse['chat_user']);

  chatStore.user = {
    ...currentUser,
    chat_user: updatedChatUser,
  };

  chatStore.updateChatUserImmediate();
};

const isManualBusyStatus = (): boolean => {
  const user = getUser();
  const status = user?.chat_user?.status as EChatUserStatus | undefined;

  return (
    status === EChatUserStatus.busy || status === EChatUserStatus.do_not_disturb
  );
};

export const startHeartbeat = (intervalMs = 20000): void => {
  if (heartbeatTimer) return;

  heartbeatTimer = globalThis.setInterval(() => {
    if (!isLoggedIn() || isManualBusyStatus()) {
      return;
    }

    const currentRoute = router.currentRoute.value;
    const path = currentRoute?.path ?? '';

    if (!path.startsWith('/chat')) {
      return;
    }

    axios.post('/presence/heartbeat', {}).catch(() => {});
  }, intervalMs);
};

export const stopHeartbeat = (): void => {
  if (!heartbeatTimer) return;

  globalThis.clearInterval(heartbeatTimer);
  heartbeatTimer = null;
};

export const startAwayHeartbeat = (intervalMs = 60000): void => {
  if (awayHeartbeatTimer) return;

  awayHeartbeatTimer = globalThis.setInterval(() => {
    if (!isLoggedIn()) {
      return;
    }

    const currentRoute = router.currentRoute.value;
    const path = currentRoute?.path ?? '';

    if (path.startsWith('/chat')) {
      return;
    }

    axios.post('/presence/away', {}).catch(() => {});
  }, intervalMs);
};

export const stopAwayHeartbeat = (): void => {
  if (!awayHeartbeatTimer) return;

  globalThis.clearInterval(awayHeartbeatTimer);
  awayHeartbeatTimer = null;
};

const startBusyHeartbeat = (intervalMs = 60000): void => {
  if (busyHeartbeatTimer) return;

  busyHeartbeatTimer = globalThis.setInterval(() => {
    if (!isLoggedIn() || !isManualBusyStatus()) {
      return;
    }

    axios.post('/presence/heartbeat', {}).catch(() => {});
  }, intervalMs);
};

const stopBusyHeartbeat = (): void => {
  if (!busyHeartbeatTimer) return;

  globalThis.clearInterval(busyHeartbeatTimer);
  busyHeartbeatTimer = null;
};

export const presenceOnline = async (): Promise<void> => {
  await axios.post('/presence/online', {});
  updateLocalPresenceStatus(EChatUserStatus.online);

  startHeartbeat();
};

export const presenceOffline = async (): Promise<void> => {
  stopHeartbeat();
  stopAwayHeartbeat();
  stopBusyHeartbeat();

  await axios.post('/presence/offline', {});
  updateLocalPresenceStatus(EChatUserStatus.offline);
};

export const presenceAway = async (): Promise<void> => {
  await axios.post('/presence/away', {});
  updateLocalPresenceStatus(EChatUserStatus.away);
};

const handleRoutePresence = (path: string): void => {
  if (!isLoggedIn()) {
    stopHeartbeat();
    stopAwayHeartbeat();
    stopBusyHeartbeat();
    lastHandledPath = null;
    return;
  }

  const normalizedPath = path || router.currentRoute.value?.path || '';

  if (lastHandledPath === normalizedPath) {
    return;
  }

  lastHandledPath = normalizedPath;

  if (isManualBusyStatus()) {
    stopHeartbeat();
    stopAwayHeartbeat();

    axios.post('/presence/heartbeat', {}).catch(() => {});
    startBusyHeartbeat();

    return;
  }

  if (normalizedPath.startsWith('/chat')) {
    stopAwayHeartbeat();
    stopBusyHeartbeat();

    presenceOnline().catch(() => {});

    return;
  }

  stopHeartbeat();
  stopBusyHeartbeat();
  presenceAway().catch(() => {});
  startAwayHeartbeat();
};

export const refreshPresenceForCurrentRoute = (): void => {
  handleRoutePresence(router.currentRoute.value?.path ?? '');
};

const bindPresenceListeners = (): void => {
  if (listenersBound) return;

  listenersBound = true;

  router.afterEach((to) => {
    handleRoutePresence(to.path ?? '');
  });

  window.addEventListener('focus', refreshPresenceForCurrentRoute);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshPresenceForCurrentRoute();
    }
  });
};

bindPresenceListeners();

router.isReady().then(() => {
  handleRoutePresence(router.currentRoute.value?.path ?? '');
});
