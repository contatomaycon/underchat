import {
  getMediaUrlFromInput,
  withMediaUrlFromInput,
} from '@core/common/functions/getMediaUrlFromInput';

describe('getMediaUrlFromInput', () => {
  it('returns string url input from object', () => {
    expect(getMediaUrlFromInput({ url: 'https://a.test/file' } as never)).toBe(
      'https://a.test/file'
    );
  });

  it('returns href when url is URL object', () => {
    expect(
      getMediaUrlFromInput({ url: new URL('https://b.test/file') } as never)
    ).toBe('https://b.test/file');
  });

  it('throws for unsupported input', () => {
    expect(() => getMediaUrlFromInput('abc' as never)).toThrow(
      'Unsupported media input: only url-based input is supported'
    );
  });
});

describe('withMediaUrlFromInput', () => {
  it('resolves callback result with extracted url', async () => {
    const fromUrl = jest.fn(async (url: string) => `ok:${url}`);

    await expect(
      withMediaUrlFromInput({ url: 'https://c.test/x' } as never, fromUrl)
    ).resolves.toBe('ok:https://c.test/x');
    expect(fromUrl).toHaveBeenCalledWith('https://c.test/x');
  });
});
