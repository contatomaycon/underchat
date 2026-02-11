import { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LoginScreen } from './screens/LoginScreen';
import { getToken, getPermissions } from './storage/authStorage';
import { canViewChatbotTab as checkCanViewChatbotTab } from './constants/permissions';
import { ChatFilterProvider } from './context/ChatFilterContext';
import { RootNavigator } from './navigation/RootNavigator';
import { addAuthUnauthorizedListener } from './utils/authEvents';

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
    const onUnauthorized = () => setAuthenticated(false);
    return addAuthUnauthorizedListener(onUnauthorized);
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
