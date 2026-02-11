import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthLoginResponse } from '../api/authApi';

const TOKEN_KEY = '@underchat_token';
const USER_KEY = '@underchat_user';

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

export async function getUser(): Promise<AuthLoginResponse['user'] | null> {
  const raw = await AsyncStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthLoginResponse['user'];
  } catch {
    return null;
  }
}

export async function setUser(user: AuthLoginResponse['user']): Promise<void> {
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
}

export async function clearAuth(): Promise<void> {
  await Promise.all([AsyncStorage.removeItem(TOKEN_KEY), AsyncStorage.removeItem(USER_KEY)]);
}
