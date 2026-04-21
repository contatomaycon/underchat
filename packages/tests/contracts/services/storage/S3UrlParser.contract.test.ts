jest.mock('@core/config/environments', () => ({
  s3Environment: {
    s3Endpoint: 'https://s3.example.com/',
  },
}));

import { S3UrlParser } from '@core/services/storage/S3UrlParser';
import { s3Environment } from '@core/config/environments';

describe('S3UrlParser', () => {
  const parser = new S3UrlParser();

  it('returns null for empty or invalid inputs', () => {
    expect(parser.parse('')).toBeNull();
    expect(parser.parse('   ')).toBeNull();
    expect(parser.parse(null as never)).toBeNull();
    expect(parser.parse(undefined as never)).toBeNull();
  });

  it('parses endpoint URL and path-only values', () => {
    expect(
      parser.parse('https://s3.example.com/account-1/path/to/file.png')
    ).toEqual({
      accountId: 'account-1',
      key: 'path/to/file.png',
    });

    expect(parser.parse('/account-2/folder/file.pdf')).toEqual({
      accountId: 'account-2',
      key: 'folder/file.pdf',
    });

    expect(parser.parse('/account-3/folder/inner/file.txt')).toEqual({
      accountId: 'account-3',
      key: 'folder/inner/file.txt',
    });
  });

  it('supports legacy format account:key-prefix', () => {
    expect(parser.parse('/acc-1:legacy-prefix/folder/file.jpg')).toEqual({
      accountId: 'acc-1',
      key: 'legacy-prefix/folder/file.jpg',
    });

    expect(parser.parse('/acc-2:/file.jpg')).toBeNull();
    expect(parser.parse('/acc-3:/')).toBeNull();
  });

  it('returns null for invalid account and malformed paths', () => {
    expect(parser.parse('/acc.with.dot/key')).toBeNull();
    expect(parser.parse('/:legacy/key')).toBeNull();
    expect(parser.parse('/only-account')).toBeNull();
    expect(parser.parse('http://%')).toBeNull();
    expect(parser.parse('////')).toBeNull();
  });

  it('falls back to path parser when URL parser fails', () => {
    const originalURL = global.URL;
    const urlMock = jest.fn(() => {
      throw new Error('url-parse-fail');
    });

    (global as any).URL = urlMock;

    try {
      expect(parser.parse('/account-4/files/doc.txt')).toEqual({
        accountId: 'account-4',
        key: 'files/doc.txt',
      });
    } finally {
      (global as any).URL = originalURL;
    }
  });

  it('returns null when outer parse fails', () => {
    const previousEndpoint = s3Environment.s3Endpoint;
    (s3Environment as any).s3Endpoint = null;

    try {
      expect(parser.parse('/account-5/path/file.txt')).toBeNull();
    } finally {
      (s3Environment as any).s3Endpoint = previousEndpoint;
    }
  });
});
