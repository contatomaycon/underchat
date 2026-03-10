import { router } from '@/plugins/1.router';
import { isLoggedIn } from './localStorage/user';
import { useChatStore } from '@/@webcore/stores/chat';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { AuthUserResponse } from '@core/schema/auth/login/response.schema';
import { IPresenceMessage } from '@core/common/interfaces/IPresenceMessage';
import { publish } from '@webcore/centrifugo';

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
let hasPermissionError = false;

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

const resolveTargetMode = (): PresenceMode => {
  if (!isLoggedIn()) return EChatUserStatus.offline;

  const userStatus = resolveUserStatus();
  if (!userStatus || userStatus === EChatUserStatus.offline) {
    return EChatUserStatus.online;
  }

  return userStatus;
};

const sendPresence = async (
  mode: PresenceMode,
  asHeartbeat = false
): Promise<void> => {
  if (!isLoggedIn()) return;

  const userId = chatStore.user?.user_id;
  if (!userId) return;

  if (hasPermissionError && !asHeartbeat) {
    return;
  }

  const channel = 'presence:updates';
  const message: IPresenceMessage = {
    event: 'presence_update',
    user_id: userId,
    status: mode,
    is_heartbeat: asHeartbeat,
  };

  await publish(channel, message).catch((error: any) => {
    if (error?.code === 103) {
      hasPermissionError = true;
      if (!asHeartbeat && import.meta.env.DEV) {
        console.warn(
          'Permission denied for presence channel. Connection may need to be reset.'
        );
      }
    } else if (import.meta.env.DEV) {
      console.error('Failed to send presence via Centrifugo', error);
    }
  });
};

const stopHeartbeatLoop = (): void => {
  if (!heartbeatTimer) return;

  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
};

async function applyMode(mode: PresenceMode, force = false): Promise<void> {
  if (!isLoggedIn()) {
    stopHeartbeatLoop();
    currentMode = null;

    return;
  }

  const localStatus = resolveUserStatus();
  const sameMode = currentMode === mode && localStatus === mode;
  currentMode = mode;

  if (!sameMode || force) {
    hasPermissionError = false;
  }

  if (!sameMode || force) {
    updateLocalPresenceStatus(mode);
    await sendPresence(mode, false).catch(() => {});
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
  if (!isLoggedIn()) return;

  const targetMode = resolveTargetMode();
  applyMode(targetMode, false).catch(() => {});
};

export const resetPresencePermissionError = (): void => {
  hasPermissionError = false;
};

const bindPresenceListeners = (): void => {
  if (listenersBound) return;
  listenersBound = true;

  globalThis.addEventListener('focus', refreshPresenceForCurrentRoute);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshPresenceForCurrentRoute();
    }
  });

  const sendOfflineOnUnload = (): void => {
    if (!isLoggedIn()) return;

    const userId = chatStore.user?.user_id;
    if (!userId) return;

    const channel = 'presence:updates';
    const message: IPresenceMessage = {
      event: 'presence_update',
      user_id: userId,
      status: EChatUserStatus.offline,
      is_heartbeat: false,
    };

    void publish(channel, message).catch(() => {});
  };

  globalThis.addEventListener('beforeunload', sendOfflineOnUnload);
};

bindPresenceListeners();

const isReady = async (): Promise<void> => {
  try {
    await router.isReady();
    refreshPresenceForCurrentRoute();
  } catch (error) {
    console.error('Failed to initialize presence router readiness', error);
  }
};

void isReady();
