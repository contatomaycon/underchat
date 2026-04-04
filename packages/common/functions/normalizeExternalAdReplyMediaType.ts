const EXTERNAL_AD_REPLY_MEDIA_TYPE_MAP: Record<string, number> = {
  NONE: 0,
  IMAGE: 1,
  VIDEO: 2,
};

export function normalizeExternalAdReplyMediaType(
  value: unknown
): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : null;
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      return null;
    }

    if (/^-?\d+$/.test(trimmedValue)) {
      const parsed = Number.parseInt(trimmedValue, 10);
      return Number.isFinite(parsed) ? parsed : null;
    }

    const mapped = EXTERNAL_AD_REPLY_MEDIA_TYPE_MAP[trimmedValue.toUpperCase()];
    return mapped ?? null;
  }

  return null;
}
