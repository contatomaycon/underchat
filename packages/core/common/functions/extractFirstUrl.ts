export function extractFirstUrl(text: string): string | null {
  if (!text) return null;

  const re =
    /(?:(?:https?:\/\/)|(?:www\.))[\p{L}\p{N}\-._~:/?#[\]@!$&'()*+,;=%]+/iu;
  const match = text.match(re);

  if (!match) {
    return null;
  }

  let url = match[0];

  url = url.replace(/[)\]\}>"'.,;:!?]+$/u, '');
  if (url.startsWith('www.')) {
    url = `https://${url}`;
  }

  try {
    const u = new URL(url);

    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return u.toString();
    }

    return null;
  } catch {
    return null;
  }
}
