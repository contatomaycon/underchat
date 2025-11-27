import axios from '@webcore/axios';
import { router } from '@/plugins/1.router';
import { isLoggedIn, getUser } from './localStorage/user';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let awayHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
let busyHeartbeatTimer: ReturnType<typeof setInterval> | null = null;

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

  startHeartbeat();
};

export const presenceOffline = async (): Promise<void> => {
  stopHeartbeat();
  stopAwayHeartbeat();
  stopBusyHeartbeat();

  await axios.post('/presence/offline', {});
};

export const presenceAway = async (): Promise<void> => {
  await axios.post('/presence/away', {});
};

const handleRoutePresence = (path: string): void => {
  if (!isLoggedIn()) {
    stopHeartbeat();
    stopAwayHeartbeat();
    stopBusyHeartbeat();
    return;
  }

  if (isManualBusyStatus()) {
    stopHeartbeat();
    stopAwayHeartbeat();

    axios.post('/presence/heartbeat', {}).catch(() => {});
    startBusyHeartbeat();

    return;
  }

  if (path.startsWith('/chat')) {
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

router.afterEach((to) => {
  handleRoutePresence(to.path ?? '');
});

handleRoutePresence(router.currentRoute.value?.path ?? '');
