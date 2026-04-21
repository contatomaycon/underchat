import { routePathWithoutPrefix } from '@core/common/functions/routePathWithoutPrefix';

describe('routePathWithoutPrefix', () => {
  it('removes version prefixes from routeOptions URL', () => {
    const request = {
      routeOptions: { url: '/v1/chats/v2/details' },
      raw: { url: '/v1/chats/v2/details' },
    };

    expect(routePathWithoutPrefix(request as never)).toBe('/chats/details');
  });

  it('falls back to raw.url when routeOptions URL is undefined', () => {
    const request = {
      routeOptions: { url: undefined },
      raw: { url: '/v3/health' },
    };

    expect(routePathWithoutPrefix(request as never)).toBe('/health');
  });

  it('returns empty string when no URL exists', () => {
    const request = {
      routeOptions: { url: undefined },
      raw: { url: undefined },
    };

    expect(routePathWithoutPrefix(request as never)).toBe('');
  });

  it('covers null runtime return path when replaceAll chain yields null', () => {
    const dynamicPath = {
      step: 0,
      replaceAll: jest.fn(function replaceAll(this: { step: number }) {
        this.step += 1;
        if (this.step >= 3) {
          return null;
        }

        return this;
      }),
    };

    const request = {
      routeOptions: { url: dynamicPath },
      raw: { url: undefined },
    };

    expect(routePathWithoutPrefix(request as never)).toBeNull();
  });
});
