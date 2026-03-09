import type { SessionPlatform } from '@core/common/types/SessionPlatform';

const SESSION_PLATFORM_VALUES: ReadonlySet<SessionPlatform> =
  new Set<SessionPlatform>(['web', 'mobile']);

export const SESSION_PLATFORM_HEADER = 'x-client-platform';
export const DEFAULT_SESSION_PLATFORM: SessionPlatform = 'web';

function normalizeHeaderValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    return normalizeHeaderValue(value[0]);
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeSessionPlatform(
  value: unknown
): SessionPlatform | null {
  const normalizedValue = normalizeHeaderValue(value);

  if (!normalizedValue) {
    return null;
  }

  if (!SESSION_PLATFORM_VALUES.has(normalizedValue as SessionPlatform)) {
    return null;
  }

  return normalizedValue as SessionPlatform;
}

export function resolveSessionPlatformFromHeaders(
  headers: Record<string, unknown>
): SessionPlatform {
  const sessionPlatform = normalizeSessionPlatform(
    headers[SESSION_PLATFORM_HEADER] ?? headers['X-Client-Platform']
  );

  return sessionPlatform ?? DEFAULT_SESSION_PLATFORM;
}
