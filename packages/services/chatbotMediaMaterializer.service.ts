import { inject, injectable } from 'tsyringe';
import {
  executeSafeOutboundHttp,
  SAFE_OUTBOUND_HTTP_MAX_RESPONSE_BYTES,
} from '@core/common/functions/safeOutboundHttp';
import { StorageService } from '@core/services/storage.service';

export type ChatbotMediaKind = 'image' | 'video' | 'audio' | 'document';

export interface ChatbotMaterializedMedia {
  readonly url: string;
  readonly fileName: string;
  readonly mimetype: string;
  readonly sizeBytes: number;
  readonly expiresAt: string;
}

export interface ChatbotMediaMaterializerOptions {
  readonly accountId: string;
  readonly kind: ChatbotMediaKind;
  readonly fileName?: string;
  readonly mimetype?: string;
  readonly isProduction: boolean;
  readonly allowLocalhostHttp: boolean;
}

export class ChatbotMediaMaterializationError extends Error {
  constructor(
    public readonly code:
      | 'invalid_media_value'
      | 'invalid_base64'
      | 'download_failed'
      | 'media_too_large'
      | 'mime_mismatch'
      | 'upload_failed',
    message: string
  ) {
    super(message);
    this.name = 'ChatbotMediaMaterializationError';
  }
}

const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const decodeBase64 = (input: string): Buffer => {
  const normalized = input.replaceAll(/\s/gu, '');
  if (
    !normalized ||
    !/^(?:[\d+/A-Za-z]{4})*(?:[\d+/A-Za-z]{2}==|[\d+/A-Za-z]{3}=)?$/u.test(
      normalized
    )
  ) {
    throw new ChatbotMediaMaterializationError(
      'invalid_base64',
      'Media base64 value is invalid'
    );
  }
  return Buffer.from(normalized, 'base64');
};

const asBuffer = (value: unknown): Buffer | null => {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (
    isRecord(value) &&
    value.type === 'Buffer' &&
    Array.isArray(value.data) &&
    value.data.every(
      (entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255
    )
  ) {
    return Buffer.from(value.data as number[]);
  }
  return null;
};

const headerValue = (
  headers: Readonly<Record<string, string | readonly string[]>>,
  name: string
): string | undefined => {
  const value = headers[name.toLowerCase()];
  return typeof value === 'string' ? value : value?.[0];
};

const dispositionFileName = (value?: string): string | undefined => {
  if (!value) return undefined;
  const utf8 = /filename\*\s*=\s*UTF-8''([^;]+)/iu.exec(value)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8);
    } catch {
      return undefined;
    }
  }
  return /filename\s*=\s*"([^"]+)"/iu.exec(value)?.[1];
};

@injectable()
export class ChatbotMediaMaterializerService {
  constructor(
    @inject(StorageService) private readonly storageService: StorageService
  ) {}

  private validateSize(buffer: Buffer): void {
    if (buffer.byteLength > MAX_MEDIA_BYTES) {
      throw new ChatbotMediaMaterializationError(
        'media_too_large',
        'Media exceeds 16 MiB'
      );
    }
  }

  private validateMime(kind: ChatbotMediaKind, mimetype: string): void {
    if (kind === 'document') return;
    if (!mimetype.toLowerCase().startsWith(`${kind}/`)) {
      throw new ChatbotMediaMaterializationError(
        'mime_mismatch',
        `Detected media type is not compatible with ${kind}`
      );
    }
  }

  private async resolveValue(
    value: unknown,
    options: ChatbotMediaMaterializerOptions
  ): Promise<{
    buffer: Buffer;
    fileName?: string;
    mimetype?: string;
  }> {
    const direct = asBuffer(value);
    if (direct) return { buffer: direct };

    if (typeof value === 'string') {
      const trimmed = value.trim();
      const dataUri = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/iu.exec(trimmed);
      if (dataUri) {
        const buffer = dataUri[2]
          ? decodeBase64(dataUri[3] ?? '')
          : Buffer.from(decodeURIComponent(dataUri[3] ?? ''), 'utf8');
        return { buffer, mimetype: dataUri[1] };
      }
      if (/^https?:\/\//iu.test(trimmed)) {
        const response = await executeSafeOutboundHttp({
          url: trimmed,
          method: 'GET',
          isProduction: options.isProduction,
          allowLocalhostHttp: options.allowLocalhostHttp,
          responseLimitBytes: SAFE_OUTBOUND_HTTP_MAX_RESPONSE_BYTES,
        });
        if (
          response.kind !== 'response' ||
          response.statusCode < 200 ||
          response.statusCode >= 300
        ) {
          throw new ChatbotMediaMaterializationError(
            'download_failed',
            'Media URL could not be downloaded safely'
          );
        }
        return {
          buffer: response.body,
          mimetype: headerValue(response.headers, 'content-type')?.split(
            ';'
          )[0],
          fileName: dispositionFileName(
            headerValue(response.headers, 'content-disposition')
          ),
        };
      }
      return { buffer: decodeBase64(trimmed) };
    }

    if (isRecord(value)) {
      if (typeof value.url === 'string') {
        return this.resolveValue(value.url, options).then((resolved) => ({
          ...resolved,
          fileName:
            typeof value.fileName === 'string'
              ? value.fileName
              : typeof value.name === 'string'
                ? value.name
                : resolved.fileName,
          mimetype:
            typeof value.mimetype === 'string'
              ? value.mimetype
              : typeof value.mimeType === 'string'
                ? value.mimeType
                : typeof value.contentType === 'string'
                  ? value.contentType
                  : resolved.mimetype,
        }));
      }
      if (typeof value.base64 === 'string') {
        return {
          buffer: decodeBase64(value.base64),
          fileName:
            typeof value.fileName === 'string'
              ? value.fileName
              : typeof value.name === 'string'
                ? value.name
                : undefined,
          mimetype:
            typeof value.mimetype === 'string'
              ? value.mimetype
              : typeof value.mimeType === 'string'
                ? value.mimeType
                : typeof value.contentType === 'string'
                  ? value.contentType
                  : undefined,
        };
      }
      const nested = value.body ?? value.data ?? value.content;
      const nestedBuffer = asBuffer(nested);
      if (nestedBuffer) {
        return {
          buffer: nestedBuffer,
          fileName:
            typeof value.fileName === 'string' ? value.fileName : undefined,
          mimetype:
            typeof value.contentType === 'string'
              ? value.contentType
              : undefined,
        };
      }
    }
    throw new ChatbotMediaMaterializationError(
      'invalid_media_value',
      'Media variable must contain a URL, data URI, base64, binary, or descriptor'
    );
  }

  public async materialize(
    value: unknown,
    options: ChatbotMediaMaterializerOptions
  ): Promise<ChatbotMaterializedMedia> {
    const resolved = await this.resolveValue(value, options);
    this.validateSize(resolved.buffer);
    const uploaded = await this.storageService.uploadTemporaryChatbotApiFile(
      resolved.buffer,
      options.accountId,
      {
        fileName: options.fileName || resolved.fileName,
        mimetype: options.mimetype || resolved.mimetype,
      }
    );
    if (!uploaded) {
      throw new ChatbotMediaMaterializationError(
        'upload_failed',
        'Media could not be materialized'
      );
    }
    this.validateMime(
      options.kind,
      uploaded.mimetype ?? 'application/octet-stream'
    );
    return {
      url: uploaded.url,
      fileName: uploaded.name,
      mimetype: uploaded.mimetype ?? 'application/octet-stream',
      sizeBytes: uploaded.size,
      expiresAt: uploaded.expires_at,
    };
  }
}
