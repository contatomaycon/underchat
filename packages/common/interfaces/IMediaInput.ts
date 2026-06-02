import { Readable } from 'node:stream';

export interface IMediaMetadataInput {
  mimetype?: string | null;
  filename?: string | null;
  filesize?: number | null;
}

export type IMediaInput =
  | Buffer
  | ({ url: string | URL } & IMediaMetadataInput)
  | ({ stream: Readable } & IMediaMetadataInput);
