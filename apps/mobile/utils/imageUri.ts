import { BACKEND_URL } from '../config';

export function resolveImageUri(uri: string | null | undefined): string | null {
  if (!uri || uri === 'null') return null;
  const normalized = uri.trim();
  if (!normalized) return null;

  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return normalized;
  }

  if (/^[a-z][a-z0-9+\-.]*:/i.test(normalized)) {
    return normalized;
  }

  const base = BACKEND_URL || '';
  if (!base) return normalized;
  const full =
    base + (normalized.startsWith('/') ? normalized : `/${normalized}`);
  return full;
}
