import axios from '@webcore/axios';
import { router } from '@/plugins/1.router';
import { isLoggedIn, getToken } from './localStorage/user';
import { useChatStore } from '@/@webcore/stores/chat';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { AuthUserResponse } from '@core/schema/auth/login/response.schema';
import { ELanguage } from '@core/common/enums/ELanguage';

type PresenceMode = EChatUserStatus;

const HEARTBEAT_INTERVALS: Record<PresenceMode, number> = {
  [EChatUserStatus.online]: 20000,
  [EChatUserStatus.away]: 60000,
  [EChatUserStatus.busy]: 60000,
  [EChatUserStatus.do_not_disturb]: 60000,
  [EChatUserStatus.offline]: 60000,
};

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let listenersBound = false;
let currentMode: PresenceMode | null = null;

const chatStore = useChatStore();

const updateLocalPresenceStatus = (status: EChatUserStatus): void => {
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

const resolveUserStatus = (): EChatUserStatus | null => {
  const status = chatStore.user?.chat_user?.status;

  return (status as EChatUserStatus) ?? null;
};

const resolveRoutePath = (): string => router.currentRoute.value?.path ?? '';

const resolveTargetMode = (): PresenceMode => {
  if (!isLoggedIn()) return EChatUserStatus.offline;

  const userStatus = resolveUserStatus();
  if (
    userStatus === EChatUserStatus.busy ||
    userStatus === EChatUserStatus.do_not_disturb
  ) {
    return userStatus;
  }

  const path = resolveRoutePath();
  if (path.startsWith('/chat')) {
    return EChatUserStatus.online;
  }

  return EChatUserStatus.away;
};

const getEndpointForMode = (
  mode: PresenceMode,
  asHeartbeat: boolean
): string => {
  if (mode === EChatUserStatus.online) {
    return asHeartbeat ? '/presence/heartbeat' : '/presence/online';
  }

  if (mode === EChatUserStatus.away) {
    return '/presence/away';
  }

  if (mode === EChatUserStatus.busy) {
    return '/presence/busy';
  }

  if (mode === EChatUserStatus.do_not_disturb) {
    return '/presence/do-not-disturb';
  }

  return '/presence/offline';
};

const sendPresence = async (
  mode: PresenceMode,
  asHeartbeat = false
): Promise<void> => {
  const endpoint = getEndpointForMode(mode, asHeartbeat);

  await axios.get(endpoint);
};

const stopHeartbeatLoop = (): void => {
  if (!heartbeatTimer) return;

  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
};

async function applyMode(mode: PresenceMode, force = false): Promise<void> {
  const sameMode = currentMode === mode;
  currentMode = mode;

  if (!sameMode || force) {
    await sendPresence(mode, false).catch(() => {});
    updateLocalPresenceStatus(mode);
  }

  stopHeartbeatLoop();

  if (mode === EChatUserStatus.offline) {
    return;
  }

  const interval = HEARTBEAT_INTERVALS[mode] ?? 60000;
  heartbeatTimer = globalThis.setInterval(() => {
    void (async () => {
      if (!isLoggedIn()) {
        stopHeartbeatLoop();
        currentMode = null;
        return;
      }

      const targetMode = resolveTargetMode();

      if (currentMode !== targetMode) {
        await applyMode(targetMode, true);
        return;
      }

      await sendPresence(targetMode, true).catch(() => {});
    })();
  }, interval);
}

export const presenceOnline = async (): Promise<void> => {
  await applyMode(EChatUserStatus.online, true);
};

export const presenceOffline = async (): Promise<void> => {
  stopHeartbeatLoop();
  await applyMode(EChatUserStatus.offline, true);
};

export const presenceAway = async (): Promise<void> => {
  await applyMode(EChatUserStatus.away, true);
};

export const presenceBusy = async (): Promise<void> => {
  await applyMode(EChatUserStatus.busy, true);
};

export const presenceDoNotDisturb = async (): Promise<void> => {
  await applyMode(EChatUserStatus.do_not_disturb, true);
};

export const refreshUpdateProfileSidebarContent = (
  status: EChatUserStatus
): void => {
  if (status === EChatUserStatus.online) {
    presenceOnline().catch(() => {});
    return;
  }

  if (status === EChatUserStatus.do_not_disturb) {
    presenceDoNotDisturb().catch(() => {});
    return;
  }

  if (status === EChatUserStatus.busy) {
    presenceBusy().catch(() => {});
    return;
  }

  presenceAway().catch(() => {});
};

export const refreshPresenceForCurrentRoute = (): void => {
  const targetMode = resolveTargetMode();
  applyMode(targetMode, false).catch(() => {});
};

const bindPresenceListeners = (): void => {
  if (listenersBound) return;
  listenersBound = true;

  router.afterEach(() => {
    refreshPresenceForCurrentRoute();
  });

  globalThis.addEventListener('focus', refreshPresenceForCurrentRoute);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshPresenceForCurrentRoute();
    }
  });

  const sendOfflineOnUnload = (): void => {
    if (!isLoggedIn()) return;

    const token = getToken();
    if (!token) return;

    const url = `${import.meta.env.VITE_BACKEND_URL}/v1/presence/offline`;

    fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Accept-Language': ELanguage.pt,
      },
      keepalive: true,
    }).catch(() => {});
  };

  globalThis.addEventListener('beforeunload', sendOfflineOnUnload);
};

bindPresenceListeners();

void (async () => {
  await router.isReady();

  refreshPresenceForCurrentRoute();
})();
