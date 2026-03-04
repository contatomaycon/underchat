import { useState, useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppState, type AppStateStatus } from 'react-native';
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
import { RootNavigator } from './navigation/RootNavigator';
import { addAuthUnauthorizedListener } from './utils/authEvents';
import {
  cleanupChatSocket,
  initializeChatSocket,
  addChatSocketListener,
} from './socket/chatSocket';
import { ensureOnlinePresence } from './socket/presence';
import { pt } from './locales/pt';
import type { ListChatsResult } from './types/chat';
import { emitAppResume } from './utils/appResumeBus';
import {
  cleanupPushNotifications,
  enableMobilePushNotifications,
  initializePushNotifications,
} from './services/pushNotifications';
import { navigationRef, navigateToChatRoom } from './navigation/navigationRef';

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
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

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

    void getUser()
      .then(async (user) => {
        if (cancelled) return;
        if (!isUserNotificationEnabled(user)) return;
        await enableMobilePushNotifications().catch(() => ({
          ok: false,
          reason: 'server_error' as const,
        }));
      })
      .catch(() => {});

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

      void getUser()
        .then(async (user) => {
          const accountId = getUserAccountId(user);
          if (!accountId) return;
          await initializeChatSocket(accountId).catch(() => {});
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
    return () => {
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
          <NavigationContainer
            ref={navigationRef}
            onReady={() => setNavigationReady(true)}
          >
            <RootNavigator />
            <StatusBar style="dark" />
          </NavigationContainer>
        </ChatFilterProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
