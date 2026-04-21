import {
  DEFAULT_SESSION_PLATFORM,
  normalizeSessionPlatform,
  resolveSessionPlatformFromHeaders,
  SESSION_PLATFORM_HEADER,
} from '@core/common/functions/sessionPlatform';

describe('sessionPlatform helpers', () => {
  it('normalizes valid session platform values', () => {
    expect(normalizeSessionPlatform('web')).toBe('web');
    expect(normalizeSessionPlatform('  MOBILE ')).toBe('mobile');
    expect(normalizeSessionPlatform(['mobile', 'web'])).toBe('mobile');
  });

  it('returns null for invalid values', () => {
    expect(normalizeSessionPlatform(undefined)).toBeNull();
    expect(normalizeSessionPlatform('')).toBeNull();
    expect(normalizeSessionPlatform('desktop')).toBeNull();
    expect(normalizeSessionPlatform({})).toBeNull();
  });

  it('resolves session platform from headers with fallback to default', () => {
    expect(
      resolveSessionPlatformFromHeaders({
        [SESSION_PLATFORM_HEADER]: 'mobile',
      })
    ).toBe('mobile');

    expect(
      resolveSessionPlatformFromHeaders({
        'X-Client-Platform': 'web',
      })
    ).toBe('web');

    expect(resolveSessionPlatformFromHeaders({})).toBe(
      DEFAULT_SESSION_PLATFORM
    );
    expect(
      resolveSessionPlatformFromHeaders({
        [SESSION_PLATFORM_HEADER]: 'unknown',
      })
    ).toBe(DEFAULT_SESSION_PLATFORM);
  });
});
