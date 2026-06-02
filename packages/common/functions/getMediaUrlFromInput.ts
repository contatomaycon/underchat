import type {
  IMediaInput,
  IMediaMetadataInput,
} from '@core/common/interfaces/IMediaInput';

export function getMediaUrlFromInput(input: IMediaInput): string {
  if (typeof input === 'object' && input !== null && 'url' in input) {
    return typeof input.url === 'string' ? input.url : input.url.href;
  }

  throw new Error('Unsupported media input: only url-based input is supported');
}

export function getMediaMetadataFromInput(
  input: IMediaInput
): IMediaMetadataInput {
  if (typeof input !== 'object' || input === null) {
    return {};
  }

  const metadata = input as IMediaMetadataInput;

  return {
    mimetype: typeof metadata.mimetype === 'string' ? metadata.mimetype : null,
    filename: typeof metadata.filename === 'string' ? metadata.filename : null,
    filesize: typeof metadata.filesize === 'number' ? metadata.filesize : null,
  };
}

export async function withMediaUrlFromInput<T>(
  input: IMediaInput,
  fromUrl: (url: string, metadata: IMediaMetadataInput) => Promise<T>
): Promise<T> {
  const url = getMediaUrlFromInput(input);
  return fromUrl(url, getMediaMetadataFromInput(input));
}
