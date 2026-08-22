import { Buffer } from 'node:buffer';

export interface IDownloadMediaBufferResult {
  buffer: Buffer;
  contentType?: string;
  contentLength?: number;
  filename?: string;
}

export interface IDownloadMediaBufferOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

const MEBIBYTE = 1024 * 1024;

function readDownloadTimeoutMs(): number {
  const parsed = Number.parseInt(
    process.env.MEDIA_DOWNLOAD_REQUEST_TIMEOUT_MS ?? '',
    10
  );
  if (!Number.isFinite(parsed)) {
    return 45_000;
  }
  return Math.min(5 * 60_000, Math.max(1_000, parsed));
}

export const MEDIA_DOWNLOAD_REQUEST_TIMEOUT_MS = readDownloadTimeoutMs();

function readDownloadMaxBytes(): number {
  const parsed = Number.parseInt(
    process.env.MEDIA_DOWNLOAD_MAX_BYTES ?? '',
    10
  );
  if (!Number.isFinite(parsed)) {
    return 128 * MEBIBYTE;
  }
  return Math.min(2 * 1024 * MEBIBYTE, Math.max(MEBIBYTE, parsed));
}

export const MEDIA_DOWNLOAD_MAX_BYTES = readDownloadMaxBytes();

export class MediaDownloadTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Media download timed out after ${timeoutMs}ms`);
    this.name = 'MediaDownloadTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class MediaDownloadNetworkError extends Error {
  readonly retryable = true;
  readonly originalCause: unknown;

  constructor(cause: unknown) {
    super('Media download failed because the remote transport was unavailable');
    this.name = 'MediaDownloadNetworkError';
    this.originalCause = cause;
  }
}

export class MediaDownloadInvalidUrlError extends Error {
  readonly retryable = false;

  constructor() {
    super('Media download URL must be a valid HTTP(S) URL');
    this.name = 'MediaDownloadInvalidUrlError';
  }
}

export class MediaDownloadSizeLimitError extends Error {
  readonly maxBytes: number;
  readonly observedBytes?: number;

  constructor(maxBytes: number, observedBytes?: number) {
    super(
      `Media download exceeds the configured ${maxBytes} byte safety limit`
    );
    this.name = 'MediaDownloadSizeLimitError';
    this.maxBytes = maxBytes;
    this.observedBytes = observedBytes;
  }
}

export class MediaDownloadHttpError extends Error {
  readonly status: number;
  readonly transient: boolean;

  constructor(status: number) {
    super(`Falha ao baixar mídia: HTTP ${status}`);
    this.name = 'MediaDownloadHttpError';
    this.status = status;
    this.transient =
      status === 408 ||
      status === 425 ||
      status === 429 ||
      (status >= 500 && status <= 599);
  }
}

export function isPermanentMediaDownloadError(error: unknown): boolean {
  return (
    error instanceof MediaDownloadInvalidUrlError ||
    error instanceof MediaDownloadSizeLimitError ||
    (error instanceof MediaDownloadHttpError && !error.transient)
  );
}

function validateMediaUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new MediaDownloadInvalidUrlError();
    }
  } catch (error) {
    if (error instanceof MediaDownloadInvalidUrlError) {
      throw error;
    }
    throw new MediaDownloadInvalidUrlError();
  }
}

function isTypedMediaDownloadError(error: unknown): boolean {
  return (
    error instanceof MediaDownloadTimeoutError ||
    error instanceof MediaDownloadNetworkError ||
    error instanceof MediaDownloadInvalidUrlError ||
    error instanceof MediaDownloadSizeLimitError ||
    error instanceof MediaDownloadHttpError
  );
}

function parseDispositionFilename(value?: string | null): string | undefined {
  if (!value) return undefined;

  const utf8Match = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(value);
  if (utf8Match?.[1]) {
    const encodedFilename = utf8Match[1].trim();
    try {
      return decodeURIComponent(encodedFilename).trim() || undefined;
    } catch {
      // A malformed optional header must not turn a completed media download
      // into an endlessly retryable transport failure.
      return encodedFilename || undefined;
    }
  }

  const quotedMatch = /filename\s*=\s*"([^"]+)"/i.exec(value);
  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim() || undefined;
  }

  const simpleMatch = /filename\s*=\s*([^;]+)/i.exec(value);
  return simpleMatch?.[1]?.trim() || undefined;
}

function parseContentLength(value?: string | null): number | undefined {
  if (!value) return undefined;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

async function readBoundedResponseBody(
  response: Response,
  maxBytes: number
): Promise<Buffer> {
  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      throw new MediaDownloadSizeLimitError(maxBytes, arrayBuffer.byteLength);
    }
    return Buffer.from(arrayBuffer);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let observedBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      observedBytes += value.byteLength;
      if (observedBytes > maxBytes) {
        /*
         * Cancellation is cleanup, not part of the safety decision. Some
         * custom/undici body sources can delay their cancel promise; never let
         * that keep the Kafka record open after the byte ceiling is proven.
         */
        void reader.cancel().catch(() => undefined);
        throw new MediaDownloadSizeLimitError(maxBytes, observedBytes);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, observedBytes);
}

export async function downloadMediaBuffer(
  url: string,
  options: IDownloadMediaBufferOptions = {}
): Promise<IDownloadMediaBufferResult> {
  validateMediaUrl(url);
  const timeoutMs =
    typeof options.timeoutMs === 'number' &&
    Number.isFinite(options.timeoutMs) &&
    options.timeoutMs > 0
      ? Math.min(5 * 60_000, Math.max(1, Math.floor(options.timeoutMs)))
      : MEDIA_DOWNLOAD_REQUEST_TIMEOUT_MS;
  const maxBytes =
    typeof options.maxBytes === 'number' &&
    Number.isFinite(options.maxBytes) &&
    options.maxBytes > 0
      ? Math.min(2 * 1024 * MEBIBYTE, Math.max(1, Math.floor(options.maxBytes)))
      : MEDIA_DOWNLOAD_MAX_BYTES;
  const controller = new AbortController();
  const timeoutError = new MediaDownloadTimeoutError(timeoutMs);
  const timer = setTimeout(() => {
    controller.abort(timeoutError);
  }, timeoutMs);
  timer.unref();

  try {
    const response = await fetch(url, {
      headers: {
        accept: 'image/* video/* audio/* application/* text/*',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new MediaDownloadHttpError(response.status);
    }

    const contentType = response.headers.get('content-type') ?? undefined;
    const contentLength = parseContentLength(
      response.headers.get('content-length')
    );
    if (contentLength !== undefined && contentLength > maxBytes) {
      void response.body?.cancel().catch(() => undefined);
      throw new MediaDownloadSizeLimitError(maxBytes, contentLength);
    }

    const buffer = await readBoundedResponseBody(response, maxBytes);

    return {
      buffer,
      contentType,
      contentLength,
      filename: parseDispositionFilename(
        response.headers.get('content-disposition')
      ),
    };
  } catch (error) {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      throw reason instanceof Error ? reason : timeoutError;
    }
    if (isTypedMediaDownloadError(error)) {
      throw error;
    }
    throw new MediaDownloadNetworkError(error);
  } finally {
    clearTimeout(timer);
  }
}
