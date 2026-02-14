import type { IMediaInput } from '@core/common/interfaces/IMediaInput';

export function getMediaUrlFromInput(input: IMediaInput): string {
  if (typeof input === 'object' && input !== null && 'url' in input) {
    return typeof input.url === 'string' ? input.url : input.url.href;
  }

  throw new Error('Unsupported media input: only url-based input is supported');
}

export async function withMediaUrlFromInput<T>(
  input: IMediaInput,
  fromUrl: (url: string) => Promise<T>
): Promise<T> {
  const url = getMediaUrlFromInput(input);
  return fromUrl(url);
}
