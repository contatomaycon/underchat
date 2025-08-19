function findFirstUrlStart(text: string): number {
  const lower = text.toLowerCase();
  let pos = -1;

  for (const n of ['http://', 'https://', 'www.']) {
    const i = lower.indexOf(n);
    if (i >= 0 && (pos < 0 || i < pos)) pos = i;
  }

  return pos;
}

function scanUrlEnd(text: string, start: number, allowed: string): number {
  let end = start;
  const len = text.length;

  while (end < len) {
    const cp = text.codePointAt(end);
    if (cp === undefined) break;

    const ch = String.fromCodePoint(cp);
    const isAsciiNum = cp >= 48 && cp <= 57;
    const isAsciiUpper = cp >= 65 && cp <= 90;
    const isAsciiLower = cp >= 97 && cp <= 122;
    const isUnicode = cp > 127;

    if (
      !(
        isAsciiNum ||
        isAsciiUpper ||
        isAsciiLower ||
        isUnicode ||
        allowed.includes(ch)
      )
    )
      break;

    end += ch.length;
  }

  return end;
}

function trimTrailingPunctuation(url: string): string {
  while (
    url.length > 0 &&
    ')]}>"\'.,;:!?'.includes(url.charAt(url.length - 1))
  ) {
    url = url.slice(0, -1);
  }

  return url;
}

function normalizeWww(url: string): string {
  if (url.startsWith('www.')) {
    return `https://${url}`;
  }

  return url;
}

function validateHttpUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:'
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}

export function extractFirstUrl(text?: string): string | null {
  if (!text) return null;

  const pos = findFirstUrlStart(text);
  if (pos < 0) return null;

  const allowed = "-._~:/?#[\\]@!$&'()*+,;=%";
  const end = scanUrlEnd(text, pos, allowed);

  let url = text.slice(pos, end);
  url = trimTrailingPunctuation(url);
  url = normalizeWww(url);

  return validateHttpUrl(url);
}
