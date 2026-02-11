import { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LoginScreen } from './screens/LoginScreen';
import { getToken } from './storage/authStorage';

export default function App() {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    getToken().then((token) => {
      setAuthenticated(!!token);
      setReady(true);
    });
  }, []);

  if (!ready) {
    return null;
  }

  if (!authenticated) {
    return <LoginScreen onLoginSuccess={() => setAuthenticated(true)} />;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Underchat</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 18,
    color: '#1a1a1a',
  },
});
