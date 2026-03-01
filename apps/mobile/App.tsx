import { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
  hasChatAccessPermission,
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

export default function App() {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [canViewChatbotTab, setCanViewChatbotTab] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

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
      if (!hasChatAccessPermission(permissions)) {
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

        if (!hasChatAccessPermission(permissions)) {
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
    <SafeAreaProvider>
      <ChatFilterProvider canViewChatbotTab={canViewChatbotTab}>
        <NavigationContainer>
          <RootNavigator />
          <StatusBar style="dark" />
        </NavigationContainer>
      </ChatFilterProvider>
    </SafeAreaProvider>
  );
}
