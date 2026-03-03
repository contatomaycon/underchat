function findFirstUrlStart(text: string): number {
  const lower = text.toLowerCase();
  let pos = -1;

  for (const needle of ['http://', 'https://', 'www.']) {
    const index = lower.indexOf(needle);
    if (index >= 0 && (pos < 0 || index < pos)) {
      pos = index;
    }
  }

  return pos;
}

function scanUrlEnd(text: string, start: number, allowed: string): number {
  let end = start;

  while (end < text.length) {
    const cp = text.codePointAt(end);
    if (cp === undefined) break;

    const char = String.fromCodePoint(cp);
    const isAsciiNumber = cp >= 48 && cp <= 57;
    const isAsciiUpper = cp >= 65 && cp <= 90;
    const isAsciiLower = cp >= 97 && cp <= 122;
    const isUnicode = cp > 127;

    if (
      !(
        isAsciiNumber ||
        isAsciiUpper ||
        isAsciiLower ||
        isUnicode ||
        allowed.includes(char)
      )
    ) {
      break;
    }

    end += char.length;
  }

  return end;
}

function trimTrailingPunctuation(url: string): string {
  while (url.length > 0) {
    const last = url.at(-1);
    if (!last || !')]}\">\'.,;:!?'.includes(last)) {
      break;
    }
    url = url.slice(0, -1);
  }

  return url;
}

function normalizeWwwUrl(url: string): string {
  if (url.startsWith('www.')) {
    return `https://${url}`;
  }

  return url;
}

function validateHttpUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export function extractFirstUrl(text?: string): string | null {
  if (!text) return null;

  const start = findFirstUrlStart(text);
  if (start < 0) return null;

  const allowed = String.raw`-._~:/?#[\]@!$&'()*+,;=%`;
  const end = scanUrlEnd(text, start, allowed);

  let candidate = text.slice(start, end);
  candidate = trimTrailingPunctuation(candidate);
  candidate = normalizeWwwUrl(candidate);

  return validateHttpUrl(candidate);
}
