import { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LoginScreen } from './screens/LoginScreen';
import { getToken } from './storage/authStorage';
import { RootNavigator } from './navigation/RootNavigator';

export default function App() {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    getToken().then((token) => {
      setAuthenticated(!!token);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    const onUnauthorized = () => setAuthenticated(false);
    globalThis.addEventListener('auth:unauthorized', onUnauthorized);
    return () =>
      globalThis.removeEventListener('auth:unauthorized', onUnauthorized);
  }, []);

  if (!ready) {
    return null;
  }

  if (!authenticated) {
    return <LoginScreen onLoginSuccess={() => setAuthenticated(true)} />;
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <RootNavigator />
        <StatusBar style="dark" />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
