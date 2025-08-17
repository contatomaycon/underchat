import type { WAUrlInfo, proto } from '@whiskeysockets/baileys';
import { INormalizedLinkPreview } from '../interfaces/INormalizedLinkPreview';

const isUint8 = (v: unknown): v is Uint8Array => v instanceof Uint8Array;
const isBuf = (v: unknown): v is Buffer =>
  typeof Buffer !== 'undefined' && v instanceof Buffer;
const isStr = (v: unknown): v is string => typeof v === 'string';
const isImageMsg = (v: unknown): v is proto.Message.IImageMessage =>
  typeof v === 'object' &&
  v !== null &&
  ('jpegThumbnail' in v || 'thumbnailDirectPath' in v);

const toBase64 = (v: unknown): string | undefined => {
  if (isBuf(v)) return v.toString('base64');
  if (isUint8(v)) return Buffer.from(v).toString('base64');
  if (isStr(v)) return v;

  if (isImageMsg(v)) {
    const t = v.jpegThumbnail;
    if (isBuf(t)) return t.toString('base64');
    if (isUint8(t)) return Buffer.from(t).toString('base64');
  }

  return undefined;
};

export function normalizeLinkPreview(
  lp?: WAUrlInfo | null
): INormalizedLinkPreview | null {
  if (!lp) return null;

  return {
    'canonical-url': lp['canonical-url'] ?? null,
    'matched-text': lp['matched-text'] ?? null,
    title: lp.title ?? null,
    description: lp.description ?? null,
    jpegThumbnail: toBase64((lp as any).jpegThumbnail) ?? null,
    highQualityThumbnail: toBase64(lp.highQualityThumbnail) ?? null,
    originalThumbnailUrl: lp.originalThumbnailUrl ?? null,
  };
}
