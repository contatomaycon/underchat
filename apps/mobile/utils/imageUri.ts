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
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    return rewriteHostForAndroid(uri);
  }
  const base = BACKEND_URL || '';
  if (!base) return uri;
  const full = base + (uri.startsWith('/') ? uri : `/${uri}`);
  return rewriteHostForAndroid(full);
}
