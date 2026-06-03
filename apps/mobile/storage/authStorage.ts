import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { AuthLoginResponse } from '../api/authApi';
import { clearBiometricLoginState } from '../utils/biometricAuth';

const LEGACY_TOKEN_KEY = '@underchat_token';
const SECURE_TOKEN_KEY = 'underchat.auth.token';
const USER_KEY = '@underchat_user';
const PERMISSIONS_KEY = '@underchat_permissions';
const SECTORS_KEY = '@underchat_sectors';
const CHANNELS_KEY = '@underchat_channels';
const PLAN_PRODUCTS_KEY = '@underchat_plan_products';

export type UserChannel = {
  id: string;
  name: string;
};

export type AuthSessionStorageData = Pick<
  AuthLoginResponse,
  'token' | 'user' | 'permissions' | 'sectors' | 'channels' | 'plan_products'
>;

function normalizeChannels(value: unknown): UserChannel[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: UserChannel[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;

    const raw = entry as { id?: unknown; channel_id?: unknown; name?: unknown };
    const idCandidate =
      typeof raw.id === 'string' && raw.id.trim().length > 0
        ? raw.id.trim()
        : typeof raw.channel_id === 'string' && raw.channel_id.trim().length > 0
          ? raw.channel_id.trim()
          : null;

    if (!idCandidate || seen.has(idCandidate)) continue;

    normalized.push({
      id: idCandidate,
      name: typeof raw.name === 'string' ? raw.name : '',
    });
    seen.add(idCandidate);
  }

  return normalized;
}

function shouldUseSecureTokenStorage(): boolean {
  return Platform.OS === 'android' || Platform.OS === 'ios';
}

async function isSecureTokenStorageAvailable(): Promise<boolean> {
  if (!shouldUseSecureTokenStorage()) {
    return false;
  }

  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

async function removeSecureToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SECURE_TOKEN_KEY);
  } catch {
    // ignore
  }
}

export async function getToken(): Promise<string | null> {
  const secureStorageAvailable = await isSecureTokenStorageAvailable();

  if (secureStorageAvailable) {
    const secureToken = await SecureStore.getItemAsync(SECURE_TOKEN_KEY).catch(
      () => null
    );
    if (secureToken) {
      return secureToken;
    }

    const legacyToken = await AsyncStorage.getItem(LEGACY_TOKEN_KEY);
    if (legacyToken) {
      let migrated = false;
      try {
        await SecureStore.setItemAsync(SECURE_TOKEN_KEY, legacyToken);
        migrated = true;
      } catch {
        // Keep the legacy token if secure migration fails.
      }

      if (migrated) {
        await AsyncStorage.removeItem(LEGACY_TOKEN_KEY).catch(() => undefined);
      }
      return legacyToken;
    }

    return null;
  }

  return AsyncStorage.getItem(LEGACY_TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  const secureStorageAvailable = await isSecureTokenStorageAvailable();

  if (secureStorageAvailable) {
    await SecureStore.setItemAsync(SECURE_TOKEN_KEY, token);
    await AsyncStorage.removeItem(LEGACY_TOKEN_KEY).catch(() => undefined);
    return;
  }

  await AsyncStorage.setItem(LEGACY_TOKEN_KEY, token);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export async function patchUser(
  partial: Record<string, unknown>
): Promise<void> {
  const current = await getUser();
  if (!current || !isRecord(current)) return;

  const merged: Record<string, unknown> = {
    ...current,
    ...partial,
  };

  if (isRecord(current.chat_user) || isRecord(partial.chat_user)) {
    merged.chat_user = {
      ...(isRecord(current.chat_user) ? current.chat_user : {}),
      ...(isRecord(partial.chat_user) ? partial.chat_user : {}),
    };
  }

  if (isRecord(current.info) || isRecord(partial.info)) {
    merged.info = {
      ...(isRecord(current.info) ? current.info : {}),
      ...(isRecord(partial.info) ? partial.info : {}),
    };
  }

  await setUser(merged as AuthLoginResponse['user']);
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

export async function getPlanProducts(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(PLAN_PRODUCTS_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function setPlanProducts(planProducts: string[]): Promise<void> {
  await AsyncStorage.setItem(PLAN_PRODUCTS_KEY, JSON.stringify(planProducts));
}

export async function getSectors(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(SECTORS_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function setSectors(sectors: string[]): Promise<void> {
  await AsyncStorage.setItem(SECTORS_KEY, JSON.stringify(sectors));
}

export async function getChannels(): Promise<UserChannel[]> {
  const raw = await AsyncStorage.getItem(CHANNELS_KEY);
  if (!raw) return [];
  try {
    return normalizeChannels(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export async function setChannels(channels: UserChannel[]): Promise<void> {
  await AsyncStorage.setItem(
    CHANNELS_KEY,
    JSON.stringify(normalizeChannels(channels))
  );
}

export async function persistAuthSession(
  session: AuthSessionStorageData
): Promise<void> {
  await Promise.all([
    setToken(session.token),
    setUser(session.user),
    setPermissions(session.permissions ?? []),
    setSectors(session.sectors ?? []),
    setChannels(session.channels ?? []),
    setPlanProducts(session.plan_products ?? []),
  ]);
}

export async function clearAuth(): Promise<void> {
  await Promise.all([
    removeSecureToken(),
    AsyncStorage.removeItem(LEGACY_TOKEN_KEY),
    AsyncStorage.removeItem(USER_KEY),
    AsyncStorage.removeItem(PERMISSIONS_KEY),
    AsyncStorage.removeItem(SECTORS_KEY),
    AsyncStorage.removeItem(CHANNELS_KEY),
    AsyncStorage.removeItem(PLAN_PRODUCTS_KEY),
    clearBiometricLoginState(),
  ]);
}
