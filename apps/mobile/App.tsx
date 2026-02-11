import { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LoginScreen } from './screens/LoginScreen';
import {
  getToken,
  getPermissions,
  getUser,
} from './storage/authStorage';
import { canViewChatbotTab as checkCanViewChatbotTab } from './constants/permissions';
import { ChatFilterProvider } from './context/ChatFilterContext';
import { RootNavigator } from './navigation/RootNavigator';
import { addAuthUnauthorizedListener } from './utils/authEvents';
import {
  cleanupChatSocket,
  initializeChatSocket,
} from './socket/chatSocket';

function getUserAccountId(user: unknown): string | null {
  if (!user || typeof user !== 'object') return null;
  const value = (user as { account_id?: unknown }).account_id;
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [canViewChatbotTab, setCanViewChatbotTab] = useState(false);

  useEffect(() => {
    getToken().then((token) => {
      setAuthenticated(!!token);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    getPermissions().then((permissions) => {
      setCanViewChatbotTab(checkCanViewChatbotTab(permissions));
    });
  }, [authenticated]);

  useEffect(() => {
    let cancelled = false;

    if (!authenticated) {
      cleanupChatSocket().catch(() => {});
      return;
    }

    getUser()
      .then((user) => {
        if (cancelled) return;
        const accountId = getUserAccountId(user);
        if (!accountId) return;
        initializeChatSocket(accountId).catch(() => {});
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  useEffect(() => {
    const onUnauthorized = () => setAuthenticated(false);
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
    return <LoginScreen onLoginSuccess={() => setAuthenticated(true)} />;
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
