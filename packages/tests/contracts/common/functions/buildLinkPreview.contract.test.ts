import { EventEmitter } from 'node:events';
import http from 'node:http';
import { PassThrough } from 'node:stream';
import {
  buildLinkPreview,
  isBlockedLinkPreviewAddress,
  validateLinkPreviewUrl,
} from '@core/common/functions/buildLinkPreview';

interface FakeRequest extends EventEmitter {
  destroy: jest.Mock;
  end: jest.Mock;
  setTimeout: jest.Mock;
}

function mockHttpRequest(
  createResponse?: () => PassThrough & {
    headers: Record<string, string>;
    statusCode: number;
  }
): FakeRequest {
  const request = new EventEmitter() as FakeRequest;
  request.setTimeout = jest.fn();
  request.destroy = jest.fn((error?: Error) => {
    if (error) queueMicrotask(() => request.emit('error', error));
  });
  request.end = jest.fn();

  jest.spyOn(http, 'request').mockImplementation(((...args: unknown[]) => {
    const onResponse = args.at(-1) as (response: PassThrough) => void;
    request.end.mockImplementation(() => {
      if (createResponse) onResponse(createResponse());
    });
    return request;
  }) as unknown as typeof http.request);

  return request;
}

describe('buildLinkPreview security', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '255.255.255.255',
    '::1',
    '::ffff:7f00:1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::',
    'fc00::1',
    'fe80::1',
  ])('blocks non-public address %s', (address) => {
    expect(isBlockedLinkPreviewAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])(
    'allows public address %s',
    (address) => {
      expect(isBlockedLinkPreviewAddress(address)).toBe(false);
    }
  );

  it.each([
    'file:///etc/passwd',
    'ftp://example.com/file',
    'http://user:password@example.com',
    'http://example.com:8080',
    'http://localhost',
    'http://service.local.',
    'http://127.0.0.1',
    'http://2130706433',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
  ])('rejects unsafe URL %s before making a request', (url) => {
    expect(() => validateLinkPreviewUrl(url)).toThrow();
  });

  it('rejects excessively long URLs', () => {
    expect(() =>
      validateLinkPreviewUrl(`https://example.com/${'a'.repeat(8_192)}`)
    ).toThrow('link_preview_url_too_long');
  });

  it.each([
    'https://example.com/path?key=value',
    'http://8.8.8.8/',
    'https://[2606:4700:4700::1111]/',
  ])('accepts a syntactically safe public URL %s', (url) => {
    expect(validateLinkPreviewUrl(url).href).toBe(url);
  });

  it('returns null for a blocked literal without performing an outbound request', async () => {
    await expect(buildLinkPreview('http://[::1]/metadata')).resolves.toBeNull();
  });

  it('rejects a redirect to a private address without following it', async () => {
    const request = mockHttpRequest(() => {
      const response = new PassThrough() as PassThrough & {
        headers: Record<string, string>;
        statusCode: number;
      };
      response.statusCode = 302;
      response.headers = { location: 'http://169.254.169.254/metadata' };
      return response;
    });

    await expect(buildLinkPreview('http://8.8.8.8/start')).resolves.toBeNull();
    expect(http.request).toHaveBeenCalledTimes(1);
    expect(request.end).toHaveBeenCalledTimes(1);
  });

  it('rejects an announced response larger than the page limit', async () => {
    mockHttpRequest(() => {
      const response = new PassThrough() as PassThrough & {
        headers: Record<string, string>;
        statusCode: number;
      };
      response.statusCode = 200;
      response.headers = {
        'content-length': String(1024 * 1024 + 1),
        'content-type': 'text/html',
      };
      return response;
    });

    await expect(buildLinkPreview('http://8.8.8.8/large')).resolves.toBeNull();
    expect(http.request).toHaveBeenCalledTimes(1);
  });

  it('enforces a total deadline even if the socket timeout never fires', async () => {
    jest.useFakeTimers();
    const request = mockHttpRequest();

    const preview = buildLinkPreview('http://8.8.8.8/slow');
    await jest.advanceTimersByTimeAsync(8_000);

    await expect(preview).resolves.toBeNull();
    expect(request.destroy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'link_preview_timeout' })
    );
  });
});
