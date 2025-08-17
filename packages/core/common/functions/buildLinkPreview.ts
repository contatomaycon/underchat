import { getLinkPreview } from 'link-preview-js';
import sharp from 'sharp';
import { WAUrlInfo } from '@whiskeysockets/baileys';

function isHttpUrl(u: string): boolean {
  try {
    const x = new URL(u);

    return x.protocol === 'http:' || x.protocol === 'https:';
  } catch {
    return false;
  }
}

async function fetchBuffer(
  url: string,
  timeoutMs = 10000
): Promise<Buffer | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari',
        accept: 'image/*,*/*;q=0.8',
      },
    });

    if (!res.ok) {
      return null;
    }

    const ab = await res.arrayBuffer();

    return Buffer.from(ab);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function buildLinkPreview(url: string): Promise<WAUrlInfo | null> {
  if (!isHttpUrl(url)) return null;

  const meta = await getLinkPreview(url, {
    followRedirects: 'follow',
    timeout: 10000,
    headers: {
      'user-agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari',
      'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
    },
  }).catch(() => null);

  if (!meta) {
    return {
      'canonical-url': url,
      'matched-text': url,
      title: url,
    };
  }

  const title =
    (meta as any).title ?? (meta as any).siteName ?? (meta as any).url ?? url;

  const description =
    (meta as any).description ?? (meta as any).mediaType ?? undefined;

  const images: string[] = Array.isArray((meta as any).images)
    ? (meta as any).images
    : [];
  const favicons: string[] = Array.isArray((meta as any).favicons)
    ? (meta as any).favicons
    : [];
  const bestImg = images[0] ?? favicons[0];

  let jpegThumbnail: Buffer | undefined;

  if (bestImg && isHttpUrl(bestImg)) {
    const imgBuf = await fetchBuffer(bestImg);
    if (imgBuf) {
      try {
        jpegThumbnail = await sharp(imgBuf)
          .resize(96, 96, { fit: 'cover' })
          .jpeg({ quality: 60, mozjpeg: true })
          .toBuffer();
      } catch {}
    }
  }

  const linkPreview: WAUrlInfo = {
    'canonical-url': (meta as any).url ?? url,
    'matched-text': url,
    title: String(title),
    description: description ? String(description) : undefined,
    jpegThumbnail,
    originalThumbnailUrl: bestImg ?? undefined,
  };

  return linkPreview;
}
