import { Platform } from 'react-native';
import { ANDROID_REWRITE_HOST, BACKEND_URL } from '../config';

function rewriteHostForAndroid(uri: string): string {
  const host = ANDROID_REWRITE_HOST;
  if (Platform.OS !== 'android' || !host) return uri;
  try {
    const u = new URL(uri);
    if (u.hostname === host) return uri;
    u.hostname = host;
    return u.toString();
  } catch {
    return uri;
  }
}

export function resolveImageUri(uri: string | null | undefined): string | null {
  if (!uri || uri === 'null') return null;
  const normalized = uri.trim();
  if (!normalized) return null;

  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return rewriteHostForAndroid(normalized);
  }

  // Keep absolute local/special URIs unchanged (file://, content://, ph://, data:, blob:, etc.)
  if (/^[a-z][a-z0-9+\-.]*:/i.test(normalized)) {
    return normalized;
  }

  const base = BACKEND_URL || '';
  if (!base) return normalized;
  const full =
    base + (normalized.startsWith('/') ? normalized : `/${normalized}`);
  return rewriteHostForAndroid(full);
}
