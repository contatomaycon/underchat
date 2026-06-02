import { Buffer } from 'node:buffer';

export interface IDownloadMediaBufferResult {
  buffer: Buffer;
  contentType?: string;
  contentLength?: number;
  filename?: string;
}

function parseDispositionFilename(value?: string | null): string | undefined {
  if (!value) return undefined;

  const utf8Match = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(value);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]).trim() || undefined;
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

export async function downloadMediaBuffer(
  url: string
): Promise<IDownloadMediaBufferResult> {
  const response = await fetch(url, {
    headers: {
      accept: 'image/* video/* audio/* application/* text/*',
    },
  });

  if (!response.ok) {
    throw new Error(`Falha ao baixar mídia: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get('content-type') ?? undefined;
  const contentLength = parseContentLength(
    response.headers.get('content-length')
  );

  return {
    buffer: Buffer.from(arrayBuffer),
    contentType,
    contentLength,
    filename: parseDispositionFilename(
      response.headers.get('content-disposition')
    ),
  };
}
