import { Readable } from 'node:stream';

export type IMediaInput = Buffer | { url: string | URL } | { stream: Readable };
