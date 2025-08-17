import { Readable } from 'stream';

export type IMediaInput = Buffer | { url: string | URL } | { stream: Readable };
