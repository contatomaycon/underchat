import { useState, useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { LoginScreen } from './screens/LoginScreen';
import {
  getToken,
  getPermissions,
  getUser,
  clearAuth,
  setChannels,
  patchUser,
} from './storage/authStorage';
import {
  canViewChatbotTab as checkCanViewChatbotTab,
  hasChatModuleAccessPermission,
} from './constants/chatAuthorization';
import { ChatFilterProvider } from './context/ChatFilterContext';
import { ChannelStatusProvider } from './context/ChannelStatusContext';
import { RootNavigator } from './navigation/RootNavigator';
import {
  addAttendanceBlockedListener,
  addAuthUnauthorizedListener,
} from './utils/authEvents';
import {
  cleanupChatSocket,
  initializeChatSocket,
  addChatSocketListener,
} from './socket/chatSocket';
import { ensureOnlinePresence } from './socket/presence';
import { pt } from './locales/pt';
import type { ListChatsResult } from './types/chat';
import { emitAppResume } from './utils/appResumeBus';
import { fetchAuthenticatedUser } from './api/authApi';
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
import { emitCurrentUserPresenceStatus } from './utils/currentUserPresence';

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

export default function App() {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [canViewChatbotTab, setCanViewChatbotTab] = useState(false);
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
  const authenticatedRef = useRef(false);

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
          setAuthenticated(false);
          setCanViewChatbotTab(false);
          setReady(true);
        }
        return;
      }

      const permissions = await getPermissions();
      if (!hasChatModuleAccessPermission(permissions)) {
        await clearAuth();
        if (!cancelled) {
          setAuthenticated(false);
          setCanViewChatbotTab(false);
          setAuthError(pt.chat_permission_denied);
          setReady(true);
        }
        return;
      }

      if (!cancelled) {
        setAuthenticated(true);
        setCanViewChatbotTab(checkCanViewChatbotTab(permissions));
        setReady(true);
      }
    };

    bootstrapSession().catch(() => {
      if (cancelled) return;
      setAuthenticated(false);
      setCanViewChatbotTab(false);
      setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    authenticatedRef.current = authenticated;

    if (!authenticated) {
      resetAttendanceLock();
      return;
    }

    void refreshAttendanceStatus();

    if (Platform.OS === 'android') {
      void isIgnoringBatteryOptimizations().then((ignoring) => {
        if (!ignoring) {
          setBatteryModalVisible(true);
        }
      });
    }
  }, [authenticated]);

  useEffect(() => {
    let cancelled = false;

    if (!authenticated) {
      setCanViewChatbotTab(false);
      cleanupChatSocket().catch(() => {});
      return;
    }

    getPermissions()
      .then(async (permissions) => {
        if (cancelled) return;

        if (!hasChatModuleAccessPermission(permissions)) {
          await clearAuth();
          if (cancelled) return;
          setAuthenticated(false);
          setCanViewChatbotTab(false);
          setAuthError(pt.chat_permission_denied);
          return;
        }

        setCanViewChatbotTab(checkCanViewChatbotTab(permissions));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) {
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

      emitCurrentUserPresenceStatus(readChatUserStatus(user));

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
  }, [authenticated]);

  useEffect(() => {
    let cancelled = false;
    let offChannelsUpdated: (() => void) | null = null;
    let offUserPresence: (() => void) | null = null;

    if (!authenticated) {
      cleanupChatSocket().catch(() => {});
      return;
    }

    getUser()
      .then(async (user) => {
        if (cancelled) return;
        const accountId = getUserAccountId(user);
        const loggedUserId = getUserId(user);
        emitCurrentUserPresenceStatus(readChatUserStatus(user));

        if (accountId) {
          await initializeChatSocket(accountId).catch(() => {});
        }

        await ensureOnlinePresence().catch(() => {});

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
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      offChannelsUpdated?.();
      offUserPresence?.();
    };
  }, [authenticated]);

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

    const navigated = navigateToChatRoom(pendingNotificationChat);
    if (navigated) {
      setPendingNotificationChat(null);
    }
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

      emitAppResume();
      void refreshAttendanceStatus();

      if (Platform.OS === 'android') {
        void isIgnoringBatteryOptimizations().then((ignoring) => {
          if (!ignoring) {
            setBatteryModalVisible(true);
          }
        });
      }

      void getUser()
        .then(async (user) => {
          const accountId = getUserAccountId(user);
          emitCurrentUserPresenceStatus(readChatUserStatus(user));

          if (!accountId) return;

          await initializeChatSocket(accountId).catch(() => {});
          await ensureOnlinePresence().catch(() => {});
        })
        .catch(() => {});
    });

    return () => {
      subscription.remove();
    };
  }, [authenticated]);

  useEffect(() => {
    const onUnauthorized = () => {
      setAuthenticated(false);
      setCanViewChatbotTab(false);
      setAuthError(null);
    };
    return addAuthUnauthorizedListener(onUnauthorized);
  }, []);

  useEffect(() => {
    const onAttendanceBlocked = (payload: AttendanceBlockedPayload) => {
      if (!authenticatedRef.current) {
        return;
      }

      applyAttendanceStatus(payload.attendance_guard, payload.message ?? null);
    };

    return addAttendanceBlockedListener(onAttendanceBlocked);
  }, []);

  useEffect(() => {
    return () => {
      clearAttendanceTimer();
      cleanupChatSocket().catch(() => {});
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

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ChatFilterProvider canViewChatbotTab={canViewChatbotTab}>
          <ChannelStatusProvider>
            <NavigationContainer
              ref={navigationRef}
              onReady={() => setNavigationReady(true)}
            >
              <RootNavigator />
              <AttendanceGuardLockModal
                visible={attendanceLocked}
                status={attendanceGuardStatus}
                message={attendanceLockMessage}
              />
              <BatteryOptimizationModal
                visible={batteryModalVisible}
                onDismiss={() => setBatteryModalVisible(false)}
              />
              <StatusBar style="dark" />
            </NavigationContainer>
          </ChannelStatusProvider>
        </ChatFilterProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
