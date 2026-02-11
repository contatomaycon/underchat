import { Platform } from 'react-native';

const raw =
  typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_BACKEND_URL;
let normalized = raw ? String(raw).replace(/\/+$/, '') : '';
if (Platform.OS === 'android' && normalized.includes('localhost')) {
  normalized = normalized.replace('localhost', '10.0.2.2');
}
export const BACKEND_URL = normalized;

function getBackendHost(): string | null {
  if (!normalized) return null;
  try {
    return new URL(normalized).hostname;
  } catch {
    return null;
  }
}

export const ANDROID_REWRITE_HOST = getBackendHost();
