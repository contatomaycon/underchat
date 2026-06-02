import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { LoginScreen } from './screens/LoginScreen';
import {
  getToken,
  getPermissions,
  getPlanProducts,
  getUser,
  getSectors,
  getChannels,
  clearAuth,
  setChannels,
  patchUser,
} from './storage/authStorage';
import {
  canViewChatbotTab as checkCanViewChatbotTab,
  canViewChat,
  hasChatModuleAccessPermission,
  hasInternalChatPlanAccess,
  hasMobileAppAccess,
  canUpdateOwnChatStatusPermission,
} from './constants/chatAuthorization';
import { ChatFilterProvider } from './context/ChatFilterContext';
import { InternalChatProvider } from './context/InternalChatContext';
import { ChannelStatusProvider } from './context/ChannelStatusContext';
import { RootNavigator } from './navigation/RootNavigator';
import {
  addAttendanceBlockedListener,
  addAuthUnauthorizedListener,
} from './utils/authEvents';
import { teardownMobileSessionOnUnauthorized } from './utils/sessionTeardown';
import {
  cleanupChatSocket,
  initializeChatSocket,
  addChatSocketListener,
} from './socket/chatSocket';
import {
  cleanupInternalChatSocket,
  initializeInternalChatSocket,
  addInternalChatSocketListener,
} from './socket/internalChatSocket';
import { publishPresence } from './socket/presence';
import { addCentrifugoConnectionListener } from './socket/centrifugo';
import { pt } from './locales/pt';
import type { ListChatsResult } from './types/chat';
import { emitAppResume, emitSessionUpdated } from './utils/appResumeBus';
import { fetchAuthenticatedUser } from './api/authApi';
import { refreshSessionWithSingleFlight } from './api/sessionRefresh';
import {
  cleanupPushNotifications,
  disableMobilePushNotifications,
  enableMobilePushNotifications,
  initializePushNotifications,
} from './services/pushNotifications';
import { navigationRef, navigateToChatRoom } from './navigation/navigationRef';
import { getAttendanceHoursStatus } from './api/attendanceHoursApi';
import type {
  AttendanceBlockedPayload,
  AttendanceGuardStatus,
} from './types/attendanceHours';
import { AttendanceGuardLockModal } from './components/AttendanceGuardLockModal';
import { BatteryOptimizationModal } from './components/BatteryOptimizationModal';
import { isIgnoringBatteryOptimizations } from './utils/batteryOptimization';
import { readChatUserStatus } from './utils/chatUserStatus';
import {
  addCurrentUserPresenceStatusListener,
  emitCurrentUserPresenceStatus,
  getCurrentUserPresenceStatusSnapshot,
} from './utils/currentUserPresence';
import type { ChatUserStatus } from './api/chatApi';

function getUserAccountId(user: unknown): string | null {
  if (!user || typeof user !== 'object') return null;
  const value = (user as { account_id?: unknown }).account_id;
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeIdentifier(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function getUserId(user: unknown): string | null {
  if (!user || typeof user !== 'object') return null;

  const userInfo = user as { id?: unknown; user_id?: unknown };
  return (
    normalizeIdentifier(userInfo.id) ?? normalizeIdentifier(userInfo.user_id)
  );
}

function isUserNotificationEnabled(user: unknown): boolean {
  if (!user || typeof user !== 'object') return false;
  const chatUser = (user as { chat_user?: unknown }).chat_user;
  if (!chatUser || typeof chatUser !== 'object') return false;
  return (chatUser as { notifications?: unknown }).notifications === true;
}

type PresenceStatus = Extract<
  ChatUserStatus,
  'online' | 'away' | 'busy' | 'do_not_disturb' | 'offline'
>;

const SOCKET_DISCONNECT_OFFLINE_GRACE_MS = 30_000;
const HEARTBEAT_INTERVALS_MS: Record<PresenceStatus, number> = {
  online: 20_000,
  away: 60_000,
  busy: 60_000,
  do_not_disturb: 60_000,
  offline: 60_000,
};

function normalizePresenceStatus(value: ChatUserStatus | null): PresenceStatus {
  if (value === 'busy') return 'busy';
  if (value === 'do_not_disturb') return 'do_not_disturb';
  if (value === 'away') return 'away';
  if (value === 'offline') return 'offline';
  return 'online';
}

function resolvePresenceTargetStatus(
  currentStatus: ChatUserStatus | null,
  canUpdateOwnStatus: boolean
): PresenceStatus {
  if (!canUpdateOwnStatus) {
    return 'online';
  }

  return normalizePresenceStatus(currentStatus);
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [canViewChatbotTab, setCanViewChatbotTab] = useState(false);
  const [canViewChatTabs, setCanViewChatTabs] = useState(false);
  const [canViewInternalChatTab, setCanViewInternalChatTab] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [navigationReady, setNavigationReady] = useState(false);
  const [pendingNotificationChat, setPendingNotificationChat] =
    useState<ListChatsResult | null>(null);
  const [attendanceGuardStatus, setAttendanceGuardStatus] =
    useState<AttendanceGuardStatus | null>(null);
  const [attendanceLocked, setAttendanceLocked] = useState(false);
  const [attendanceLockMessage, setAttendanceLockMessage] = useState<
    string | null
  >(null);
  const [batteryModalVisible, setBatteryModalVisible] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const attendanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attendanceOffsetMsRef = useRef(0);
  const attendanceSnapshotAppliedAtRef = useRef(0);
  const authenticatedRef = useRef(false);
  const canViewChatTabsRef = useRef(false);
  const canViewInternalChatTabRef = useRef(false);
  const canUpdateOwnStatusRef = useRef(false);
  const socketConnectedRef = useRef(false);
  const disconnectOfflineTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTargetStatusRef = useRef<PresenceStatus>('online');
  const forcedOfflineBySocketRef = useRef(false);
  const hasSeenSocketConnectedRef = useRef(false);

  const resetAuthAccessState = useCallback((): void => {
    setAuthenticated(false);
    setCanViewChatbotTab(false);
    setCanViewChatTabs(false);
    setCanViewInternalChatTab(false);
    canUpdateOwnStatusRef.current = false;
  }, []);

  const applyAuthAccessState = useCallback(
    (
      permissions: string[],
      planProducts: string[]
    ): {
      hasMobileAccess: boolean;
      hasChatAccess: boolean;
      hasInternalAccess: boolean;
    } => {
      if (!hasMobileAppAccess(permissions, planProducts)) {
        resetAuthAccessState();
        return {
          hasMobileAccess: false,
          hasChatAccess: false,
          hasInternalAccess: false,
        };
      }

      const hasChatAccess = hasChatModuleAccessPermission(permissions);
      const hasInternalAccess = hasInternalChatPlanAccess(
        permissions,
        planProducts
      );

      setAuthenticated(true);
      setCanViewChatbotTab(
        hasChatAccess && checkCanViewChatbotTab(permissions)
      );
      setCanViewChatTabs(hasChatAccess);
      setCanViewInternalChatTab(hasInternalAccess);
      canUpdateOwnStatusRef.current =
        hasChatAccess && canUpdateOwnChatStatusPermission(permissions);

      return {
        hasMobileAccess: true,
        hasChatAccess,
        hasInternalAccess,
      };
    },
    [resetAuthAccessState]
  );

  const clearDisconnectOfflineTimer = (): void => {
    if (!disconnectOfflineTimerRef.current) {
      return;
    }

    clearTimeout(disconnectOfflineTimerRef.current);
    disconnectOfflineTimerRef.current = null;
  };

  const stopPresenceHeartbeat = (): void => {
    if (!heartbeatTimerRef.current) {
      return;
    }

    clearInterval(heartbeatTimerRef.current);
    heartbeatTimerRef.current = null;
  };

  const startPresenceHeartbeat = (status: PresenceStatus): void => {
    stopPresenceHeartbeat();

    if (status === 'offline') {
      return;
    }

    const interval = HEARTBEAT_INTERVALS_MS[status] ?? 60_000;
    heartbeatTimerRef.current = setInterval(() => {
      if (!authenticatedRef.current || !socketConnectedRef.current) {
        stopPresenceHeartbeat();
        return;
      }

      const snapshot = getCurrentUserPresenceStatusSnapshot();
      const targetStatus = resolvePresenceTargetStatus(
        snapshot,
        canUpdateOwnStatusRef.current
      );
      const heartbeatStatus = canUpdateOwnStatusRef.current
        ? targetStatus
        : 'online';

      if (heartbeatStatus === 'offline') {
        stopPresenceHeartbeat();
        return;
      }

      void publishPresence(heartbeatStatus, { isHeartbeat: true });
    }, interval);
  };

  const handleSocketConnected = useCallback(async () => {
    if (!authenticatedRef.current) {
      return;
    }

    socketConnectedRef.current = true;
    hasSeenSocketConnectedRef.current = true;
    clearDisconnectOfflineTimer();

    const targetStatus = canUpdateOwnStatusRef.current
      ? reconnectTargetStatusRef.current
      : 'online';

    forcedOfflineBySocketRef.current = false;

    const published = await publishPresence(targetStatus);
    if (!published) {
      return;
    }

    startPresenceHeartbeat(targetStatus);
  }, []);

  const handleSocketDisconnected = useCallback(() => {
    socketConnectedRef.current = false;
    stopPresenceHeartbeat();
    clearDisconnectOfflineTimer();

    if (!hasSeenSocketConnectedRef.current) {
      return;
    }

    if (!authenticatedRef.current) {
      return;
    }

    const snapshot = getCurrentUserPresenceStatusSnapshot();
    reconnectTargetStatusRef.current = resolvePresenceTargetStatus(
      snapshot,
      canUpdateOwnStatusRef.current
    );

    disconnectOfflineTimerRef.current = setTimeout(() => {
      if (!authenticatedRef.current || socketConnectedRef.current) {
        return;
      }

      forcedOfflineBySocketRef.current = true;
      void publishPresence('offline');
    }, SOCKET_DISCONNECT_OFFLINE_GRACE_MS);
  }, []);

  const forceOnlineAtSessionStart = useCallback(async (): Promise<void> => {
    forcedOfflineBySocketRef.current = false;
    reconnectTargetStatusRef.current = 'online';

    await patchUser({
      chat_user: {
        status: 'online',
      },
    }).catch(() => {
      // ignore
    });

    emitCurrentUserPresenceStatus('online');
    await publishPresence('online').catch(() => false);
  }, []);

  const clearAttendanceTimer = (): void => {
    if (!attendanceTimerRef.current) {
      return;
    }

    clearTimeout(attendanceTimerRef.current);
    attendanceTimerRef.current = null;
  };

  const resetAttendanceLock = (): void => {
    clearAttendanceTimer();
    attendanceOffsetMsRef.current = 0;
    setAttendanceGuardStatus(null);
    setAttendanceLocked(false);
    setAttendanceLockMessage(null);
  };

  const applyAttendanceStatus = (
    status: AttendanceGuardStatus,
    message?: string | null
  ): void => {
    setAttendanceGuardStatus(status);
    setAttendanceLocked(status.is_blocked_now);
    setAttendanceLockMessage(message ?? null);

    const serverNowMs = Date.parse(status.server_now);
    attendanceOffsetMsRef.current = Number.isFinite(serverNowMs)
      ? serverNowMs - Date.now()
      : 0;

    clearAttendanceTimer();

    const nextTransitionAt = status.next_transition_at;
    if (!nextTransitionAt) {
      return;
    }

    const nextTransitionMs = Date.parse(nextTransitionAt);
    if (!Number.isFinite(nextTransitionMs)) {
      return;
    }

    const delay = Math.max(
      750,
      nextTransitionMs - (Date.now() + attendanceOffsetMsRef.current) + 150
    );

    attendanceTimerRef.current = setTimeout(() => {
      if (!authenticatedRef.current) {
        return;
      }

      void getAttendanceHoursStatus().then((nextStatus) => {
        if (!nextStatus || !authenticatedRef.current) {
          return;
        }

        applyAttendanceStatus(nextStatus, null);
      });
    }, delay);
  };

  const refreshAttendanceStatus = async (
    message?: string | null
  ): Promise<void> => {
    if (!authenticatedRef.current) {
      return;
    }

    const status = await getAttendanceHoursStatus();
    if (!status) {
      return;
    }

    applyAttendanceStatus(status, message ?? null);
  };

  useEffect(() => {
    let cancelled = false;

    const bootstrapSession = async () => {
      const token = await getToken();
      if (!token) {
        if (!cancelled) {
          resetAuthAccessState();
          setReady(true);
        }
        return;
      }

      const refreshResult = await refreshSessionWithSingleFlight();

      if (cancelled) {
        return;
      }

      if (!refreshResult.success) {
        if (
          refreshResult.reason === 'unauthorized' ||
          refreshResult.reason === 'forbidden'
        ) {
          await clearAuth();
          if (cancelled) return;
          resetAuthAccessState();
          setAuthError(refreshResult.message ?? pt.chat_permission_denied);
          setReady(true);
          return;
        }

        const [cachedPermissions, cachedPlanProducts] = await Promise.all([
          getPermissions(),
          getPlanProducts(),
        ]);
        if (cancelled) return;

        const access = applyAuthAccessState(
          cachedPermissions,
          cachedPlanProducts
        );
        if (!access.hasMobileAccess) {
          await clearAuth();
          if (cancelled) return;
          setAuthError(pt.chat_permission_denied);
        }

        setReady(true);
        return;
      }

      emitSessionUpdated();

      const access = applyAuthAccessState(
        refreshResult.data.permissions,
        refreshResult.data.plan_products ?? []
      );
      if (!access.hasMobileAccess) {
        await clearAuth();
        if (cancelled) return;
        setAuthError(pt.chat_permission_denied);
        setReady(true);
        return;
      }

      if (access.hasChatAccess) {
        applyAttendanceStatus(refreshResult.data.attendance_guard, null);
        attendanceSnapshotAppliedAtRef.current = Date.now();
      } else {
        resetAttendanceLock();
      }

      setReady(true);
    };

    bootstrapSession().catch(() => {
      if (cancelled) return;
      resetAuthAccessState();
      setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [applyAuthAccessState, resetAuthAccessState]);

  useEffect(() => {
    authenticatedRef.current = authenticated;
    canViewChatTabsRef.current = canViewChatTabs;
    canViewInternalChatTabRef.current = canViewInternalChatTab;

    if (!authenticated) {
      resetAttendanceLock();
      socketConnectedRef.current = false;
      hasSeenSocketConnectedRef.current = false;
      forcedOfflineBySocketRef.current = false;
      reconnectTargetStatusRef.current = 'online';
      clearDisconnectOfflineTimer();
      stopPresenceHeartbeat();
      return;
    }

    if (canViewChatTabs) {
      const hasFreshAttendanceSnapshot =
        Date.now() - attendanceSnapshotAppliedAtRef.current < 1000;
      if (!hasFreshAttendanceSnapshot) {
        void refreshAttendanceStatus();
      }
    } else {
      resetAttendanceLock();
    }

    if (canViewChatTabs && Platform.OS === 'android') {
      void isIgnoringBatteryOptimizations().then((ignoring) => {
        if (!ignoring) {
          setBatteryModalVisible(true);
        }
      });
    }
  }, [authenticated, canViewChatTabs, canViewInternalChatTab]);

  useEffect(() => {
    let cancelled = false;

    if (!authenticated) {
      setCanViewChatbotTab(false);
      setCanViewChatTabs(false);
      setCanViewInternalChatTab(false);
      canUpdateOwnStatusRef.current = false;
      cleanupChatSocket().catch(() => {});
      cleanupInternalChatSocket().catch(() => {});
      return;
    }

    Promise.all([getPermissions(), getPlanProducts()])
      .then(async ([permissions, planProducts]) => {
        if (cancelled) return;

        if (!hasMobileAppAccess(permissions, planProducts)) {
          await clearAuth();
          if (cancelled) return;
          setAuthenticated(false);
          setCanViewChatbotTab(false);
          setCanViewChatTabs(false);
          setCanViewInternalChatTab(false);
          canUpdateOwnStatusRef.current = false;
          setAuthError(pt.chat_permission_denied);
          return;
        }

        const hasChatAccess = hasChatModuleAccessPermission(permissions);
        const hasInternalAccess = hasInternalChatPlanAccess(
          permissions,
          planProducts
        );

        setCanViewChatbotTab(
          hasChatAccess && checkCanViewChatbotTab(permissions)
        );
        setCanViewChatTabs(hasChatAccess);
        setCanViewInternalChatTab(hasInternalAccess);
        canUpdateOwnStatusRef.current =
          hasChatAccess && canUpdateOwnChatStatusPermission(permissions);

        if (hasChatAccess && socketConnectedRef.current) {
          void handleSocketConnected();
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [authenticated, handleSocketConnected]);

  useEffect(() => {
    if (!authenticated || !canViewChatTabs) {
      return;
    }

    let cancelled = false;

    void (async () => {
      let user = await getUser();
      if (cancelled) return;

      const remoteUser = await fetchAuthenticatedUser().catch(() => null);
      if (cancelled) return;

      if (remoteUser) {
        user = remoteUser;
        await patchUser(remoteUser).catch(() => {
          // ignore
        });
      }

      await forceOnlineAtSessionStart();

      if (isUserNotificationEnabled(user)) {
        await enableMobilePushNotifications().catch(() => ({
          ok: false,
          reason: 'server_error' as const,
        }));
        return;
      }

      await disableMobilePushNotifications().catch(() => false);
    })().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [authenticated, canViewChatTabs, forceOnlineAtSessionStart]);

  useEffect(() => {
    return addCurrentUserPresenceStatusListener(
      (status) => {
        if (!canUpdateOwnStatusRef.current) {
          return;
        }

        if (forcedOfflineBySocketRef.current && status === 'offline') {
          return;
        }

        reconnectTargetStatusRef.current = normalizePresenceStatus(status);
      },
      { emitCurrent: true }
    );
  }, []);

  useEffect(() => {
    if (!authenticated || !canViewChatTabs) {
      return;
    }

    const removeListener = addCentrifugoConnectionListener(
      (connected) => {
        if (connected) {
          void handleSocketConnected();
          return;
        }

        handleSocketDisconnected();
      },
      { emitCurrent: true }
    );

    return () => {
      removeListener();
    };
  }, [
    authenticated,
    canViewChatTabs,
    handleSocketConnected,
    handleSocketDisconnected,
  ]);

  useEffect(() => {
    let cancelled = false;
    let offChannelsUpdated: (() => void) | null = null;
    let offUserPresence: (() => void) | null = null;
    let offForceLogout: (() => void) | null = null;

    if (!authenticated || !canViewChatTabs) {
      cleanupChatSocket().catch(() => {});
      return;
    }

    getUser()
      .then(async (user) => {
        if (cancelled) return;
        const accountId = getUserAccountId(user);
        const loggedUserId = getUserId(user);

        if (accountId) {
          await initializeChatSocket(accountId).catch(() => {});
        }

        offChannelsUpdated = addChatSocketListener(
          'channelsUpdated',
          (payload) => {
            const eventUserId = normalizeIdentifier(payload.user_id);
            if (!loggedUserId || !eventUserId || eventUserId !== loggedUserId) {
              return;
            }
            void setChannels(payload.channels);
          }
        );

        offUserPresence = addChatSocketListener('userPresence', (payload) => {
          const eventUserId = normalizeIdentifier(payload.user_id);
          if (!loggedUserId || !eventUserId || eventUserId !== loggedUserId) {
            return;
          }

          void patchUser({
            chat_user: {
              status: payload.status,
            },
          });
          emitCurrentUserPresenceStatus(payload.status);
        });

        offForceLogout = addChatSocketListener('forceLogout', (payload) => {
          const eventUserId = normalizeIdentifier(payload.user_id);
          if (!loggedUserId || !eventUserId || eventUserId !== loggedUserId) {
            return;
          }

          if (payload.session_platform !== 'mobile') {
            return;
          }

          void teardownMobileSessionOnUnauthorized();
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      offChannelsUpdated?.();
      offUserPresence?.();
      offForceLogout?.();
    };
  }, [authenticated, canViewChatTabs]);

  useEffect(() => {
    let cancelled = false;
    let offForceLogout: (() => void) | null = null;

    if (!authenticated || !canViewInternalChatTab) {
      cleanupInternalChatSocket().catch(() => {});
      return;
    }

    getUser()
      .then(async (user) => {
        if (cancelled) return;
        const accountId = getUserAccountId(user);
        const loggedUserId = getUserId(user);

        if (accountId) {
          await initializeInternalChatSocket(accountId).catch(() => {});
        }

        offForceLogout = addInternalChatSocketListener(
          'forceLogout',
          (payload) => {
            const eventUserId = normalizeIdentifier(payload.user_id);
            if (!loggedUserId || !eventUserId || eventUserId !== loggedUserId) {
              return;
            }

            if (payload.session_platform !== 'mobile') {
              return;
            }

            void teardownMobileSessionOnUnauthorized();
          }
        );
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      offForceLogout?.();
    };
  }, [authenticated, canViewInternalChatTab]);

  useEffect(() => {
    void initializePushNotifications({
      onChatTap: (chat) => {
        setPendingNotificationChat(chat);
      },
    });

    return () => {
      cleanupPushNotifications();
    };
  }, []);

  useEffect(() => {
    if (authenticated) return;
    setNavigationReady(false);
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated || !navigationReady || !pendingNotificationChat) {
      return;
    }

    let cancelled = false;

    const openPendingNotificationChat = async () => {
      const [permissions, user, userSectors, userChannels] = await Promise.all([
        getPermissions(),
        getUser(),
        getSectors(),
        getChannels(),
      ]);

      if (cancelled) {
        return;
      }

      if (
        !canViewChat(pendingNotificationChat, {
          permissions,
          userId: getUserId(user),
          userSectors,
          userChannels,
        })
      ) {
        setPendingNotificationChat(null);
        return;
      }

      const navigated = navigateToChatRoom(pendingNotificationChat);
      if (navigated) {
        setPendingNotificationChat(null);
      }
    };

    void openPendingNotificationChat();

    return () => {
      cancelled = true;
    };
  }, [authenticated, navigationReady, pendingNotificationChat]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      const previousAppState = appStateRef.current;
      appStateRef.current = nextAppState;

      const becameActive =
        (previousAppState === 'background' ||
          previousAppState === 'inactive') &&
        nextAppState === 'active';

      if (!becameActive || !authenticated) {
        return;
      }

      void (async () => {
        let canUseChatSockets = canViewChatTabsRef.current;
        let canUseInternalChatSockets = canViewInternalChatTabRef.current;

        const refreshResult = await refreshSessionWithSingleFlight();

        if (!authenticatedRef.current) {
          return;
        }

        if (!refreshResult.success) {
          if (
            refreshResult.reason === 'unauthorized' ||
            refreshResult.reason === 'forbidden'
          ) {
            await clearAuth();
            resetAuthAccessState();
            setAuthError(refreshResult.message ?? pt.chat_permission_denied);
            return;
          }

          emitAppResume();
          if (canViewChatTabsRef.current) {
            void refreshAttendanceStatus();
          }
        } else {
          emitSessionUpdated();

          const access = applyAuthAccessState(
            refreshResult.data.permissions,
            refreshResult.data.plan_products ?? []
          );
          if (!access.hasMobileAccess) {
            await clearAuth();
            resetAuthAccessState();
            setAuthError(pt.chat_permission_denied);
            return;
          }

          canUseChatSockets = access.hasChatAccess;
          canUseInternalChatSockets = access.hasInternalAccess;

          if (access.hasChatAccess) {
            applyAttendanceStatus(refreshResult.data.attendance_guard, null);
            attendanceSnapshotAppliedAtRef.current = Date.now();
          } else {
            resetAttendanceLock();
          }

          emitAppResume();
        }

        if (canUseChatSockets && Platform.OS === 'android') {
          const ignoring = await isIgnoringBatteryOptimizations().catch(
            () => true
          );
          if (!ignoring) {
            setBatteryModalVisible(true);
          }
        }

        const user = await getUser().catch(() => null);
        const accountId = getUserAccountId(user);

        if (!accountId) return;

        if (canUseChatSockets) {
          emitCurrentUserPresenceStatus(readChatUserStatus(user));
          reconnectTargetStatusRef.current = normalizePresenceStatus(
            readChatUserStatus(user)
          );

          await initializeChatSocket(accountId).catch(() => {});

          if (socketConnectedRef.current) {
            await handleSocketConnected();
          }
        }

        if (canUseInternalChatSockets) {
          await initializeInternalChatSocket(accountId).catch(() => {});
        }
      })().catch(() => {});
    });

    return () => {
      subscription.remove();
    };
  }, [
    authenticated,
    applyAuthAccessState,
    handleSocketConnected,
    resetAuthAccessState,
  ]);

  useEffect(() => {
    const onUnauthorized = () => {
      setAuthenticated(false);
      setCanViewChatbotTab(false);
      setCanViewChatTabs(false);
      setCanViewInternalChatTab(false);
      setAuthError(null);
    };
    return addAuthUnauthorizedListener(onUnauthorized);
  }, []);

  useEffect(() => {
    const onAttendanceBlocked = (payload: AttendanceBlockedPayload) => {
      if (!authenticatedRef.current) {
        return;
      }
      if (!canViewChatTabsRef.current) {
        return;
      }

      applyAttendanceStatus(payload.attendance_guard, payload.message ?? null);
    };

    return addAttendanceBlockedListener(onAttendanceBlocked);
  }, []);

  useEffect(() => {
    return () => {
      clearAttendanceTimer();
      clearDisconnectOfflineTimer();
      stopPresenceHeartbeat();
      cleanupChatSocket().catch(() => {});
      cleanupInternalChatSocket().catch(() => {});
    };
  }, []);

  if (!ready) {
    return null;
  }

  if (!authenticated) {
    return (
      <LoginScreen
        onLoginSuccess={() => {
          setAuthError(null);
          setAuthenticated(true);
        }}
        initialError={authError}
      />
    );
  }

  if (!canViewChatTabs && !canViewInternalChatTab) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ChatFilterProvider
          canViewChatbotTab={canViewChatbotTab}
          canViewChatTabs={canViewChatTabs}
          canViewInternalChatTab={canViewInternalChatTab}
        >
          <InternalChatProvider enabled={canViewInternalChatTab}>
            <ChannelStatusProvider enabled={canViewChatTabs}>
              <NavigationContainer
                ref={navigationRef}
                onReady={() => setNavigationReady(true)}
              >
                <RootNavigator />
                <AttendanceGuardLockModal
                  visible={canViewChatTabs && attendanceLocked}
                  status={attendanceGuardStatus}
                  message={attendanceLockMessage}
                />
                <BatteryOptimizationModal
                  visible={canViewChatTabs && batteryModalVisible}
                  onDismiss={() => setBatteryModalVisible(false)}
                />
                <StatusBar style="dark" />
              </NavigationContainer>
            </ChannelStatusProvider>
          </InternalChatProvider>
        </ChatFilterProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
