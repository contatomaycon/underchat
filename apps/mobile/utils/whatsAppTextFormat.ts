export type WhatsAppTextTokenType =
  | 'text'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'newline';

export interface WhatsAppTextToken {
  type: WhatsAppTextTokenType;
  text: string;
}

const MARKERS = [
  { marker: '`', type: 'code' as const },
  { marker: '~', type: 'strike' as const },
  { marker: '_', type: 'italic' as const },
  { marker: '*', type: 'bold' as const },
];

function isMarkerBoundaryValid(
  source: string,
  marker: string,
  openIndex: number,
  closeIndex: number
): boolean {
  const beforeOpen = openIndex > 0 ? source[openIndex - 1] : null;
  const afterOpen = source[openIndex + 1] ?? null;
  const beforeClose = closeIndex > 0 ? source[closeIndex - 1] : null;
  const afterClose = source[closeIndex + 1] ?? null;

  if (beforeOpen === marker || afterOpen === marker) return false;
  if (beforeClose === marker || afterClose === marker) return false;
  if (afterOpen === null || beforeClose === null) return false;
  if (afterOpen === '\n' || beforeClose === '\n') return false;

  return true;
}

function applyMarkerFormatting(
  tokens: WhatsAppTextToken[],
  marker: string,
  type: Extract<WhatsAppTextTokenType, 'bold' | 'italic' | 'strike' | 'code'>
): WhatsAppTextToken[] {
  const next: WhatsAppTextToken[] = [];

  for (const token of tokens) {
    if (token.type !== 'text' || !token.text.includes(marker)) {
      next.push(token);
      continue;
    }

    const value = token.text;
    let cursor = 0;

    while (cursor < value.length) {
      const openIndex = value.indexOf(marker, cursor);

      if (openIndex < 0 || openIndex + 2 > value.length) {
        const rest = value.slice(cursor);
        if (rest) {
          next.push({ type: 'text', text: rest });
        }
        break;
      }

      const closeIndex = value.indexOf(marker, openIndex + 1);
      if (
        closeIndex < 0 ||
        !isMarkerBoundaryValid(value, marker, openIndex, closeIndex)
      ) {
        const untilNext = value.slice(cursor, openIndex + 1);
        if (untilNext) {
          next.push({ type: 'text', text: untilNext });
        }
        cursor = openIndex + 1;
        continue;
      }

      const before = value.slice(cursor, openIndex);
      if (before) {
        next.push({ type: 'text', text: before });
      }

      const inside = value.slice(openIndex + 1, closeIndex);
      if (inside) {
        next.push({ type, text: inside });
      } else {
        next.push({ type: 'text', text: marker + marker });
      }

      cursor = closeIndex + 1;
    }
  }

  return next;
}

function splitNewlines(tokens: WhatsAppTextToken[]): WhatsAppTextToken[] {
  const out: WhatsAppTextToken[] = [];

  for (const token of tokens) {
    if (!token.text.includes('\n')) {
      out.push(token);
      continue;
    }

    const parts = token.text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.length > 0) {
        out.push({ type: token.type, text: part });
      }
      if (i < parts.length - 1) {
        out.push({ type: 'newline', text: '\n' });
      }
    }
  }

  return out;
}

function convertTokensToSingleLine(
  tokens: WhatsAppTextToken[]
): WhatsAppTextToken[] {
  return tokens.map((token) => {
    if (token.type !== 'newline') return token;
    return { type: 'text', text: ' ' };
  });
}

function truncateTokens(
  tokens: WhatsAppTextToken[],
  maxLength: number,
  suffix: string
): WhatsAppTextToken[] {
  if (maxLength <= 0) {
    return suffix ? [{ type: 'text', text: suffix }] : [];
  }

  const next: WhatsAppTextToken[] = [];
  let consumed = 0;
  let truncated = false;

  for (const token of tokens) {
    if (!token.text) continue;

    if (consumed >= maxLength) {
      truncated = true;
      break;
    }

    const remaining = maxLength - consumed;
    if (token.text.length <= remaining) {
      next.push(token);
      consumed += token.text.length;
      continue;
    }

    next.push({ type: token.type, text: token.text.slice(0, remaining) });
    truncated = true;
    break;
  }

  if (truncated && suffix) {
    next.push({ type: 'text', text: suffix });
  }

  return next;
}

export function parseWhatsAppTextTokens(
  text?: string | null
): WhatsAppTextToken[] {
  if (!text) return [];

  let tokens: WhatsAppTextToken[] = [{ type: 'text', text }];

  for (const markerItem of MARKERS) {
    tokens = applyMarkerFormatting(tokens, markerItem.marker, markerItem.type);
  }

  return splitNewlines(tokens);
}

export function parseWhatsAppPreviewTokens(
  text?: string | null,
  maxLength = 35,
  suffix = '...'
): WhatsAppTextToken[] {
  const tokens = parseWhatsAppTextTokens(text);
  if (tokens.length === 0) return [];

  return truncateTokens(convertTokensToSingleLine(tokens), maxLength, suffix);
}
