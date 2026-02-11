import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthLoginResponse } from '../api/authApi';

const TOKEN_KEY = '@underchat_token';
const USER_KEY = '@underchat_user';
const PERMISSIONS_KEY = '@underchat_permissions';

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

export async function getPermissions(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(PERMISSIONS_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function setPermissions(permissions: string[]): Promise<void> {
  await AsyncStorage.setItem(PERMISSIONS_KEY, JSON.stringify(permissions));
}

export async function clearAuth(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(TOKEN_KEY),
    AsyncStorage.removeItem(USER_KEY),
    AsyncStorage.removeItem(PERMISSIONS_KEY),
  ]);
}
