export type WhatsAppTextTokenType =
  | 'text'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'newline'
  | 'quote_start'
  | 'quote_end';

export interface WhatsAppTextToken {
  type: WhatsAppTextTokenType;
  text: string;
}

interface TruncateTokensResult {
  tokens: WhatsAppTextToken[];
  truncated: boolean;
}

const MARKERS = [
  { marker: '```', type: 'code' as const },
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
  const afterOpen = source[openIndex + marker.length] ?? null;
  const beforeClose = closeIndex > 0 ? source[closeIndex - 1] : null;
  const afterClose = source[closeIndex + marker.length] ?? null;

  if (marker.length === 1) {
    if (beforeOpen === marker || afterOpen === marker) return false;
    if (beforeClose === marker || afterClose === marker) return false;
  }
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

      if (openIndex < 0 || openIndex + marker.length * 2 > value.length) {
        const rest = value.slice(cursor);
        if (rest) {
          next.push({ type: 'text', text: rest });
        }
        break;
      }

      const closeIndex = value.indexOf(marker, openIndex + marker.length);
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

      const inside = value.slice(openIndex + marker.length, closeIndex);
      if (inside) {
        next.push({ type, text: inside });
      } else {
        next.push({ type: 'text', text: marker + marker });
      }

      cursor = closeIndex + marker.length;
    }
  }

  return next;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderWhatsAppTokensToHtml(tokens: WhatsAppTextToken[]): string {
  return tokens
    .map((token) => {
      switch (token.type) {
        case 'bold':
          return `<strong>${escapeHtml(token.text)}</strong>`;
        case 'italic':
          return `<em>${escapeHtml(token.text)}</em>`;
        case 'strike':
          return `<s>${escapeHtml(token.text)}</s>`;
        case 'code':
          return `<code>${escapeHtml(token.text)}</code>`;
        case 'newline':
          return '<br />';
        case 'quote_start':
          return '<span class="whatsapp-quote">';
        case 'quote_end':
          return '</span>';
        default:
          return escapeHtml(token.text);
      }
    })
    .join('');
}

function convertTokensToSingleLine(
  tokens: WhatsAppTextToken[]
): WhatsAppTextToken[] {
  return tokens
    .map((token): WhatsAppTextToken => {
      if (token.type === 'quote_start' || token.type === 'quote_end') {
        return { type: 'text', text: '' };
      }

      if (token.type !== 'newline') return token;
      return { type: 'text', text: ' ' };
    })
    .filter((token) => token.text);
}

function truncateWhatsAppTextTokens(
  tokens: WhatsAppTextToken[],
  maxLength: number,
  suffix: string
): TruncateTokensResult {
  if (maxLength <= 0) {
    return {
      tokens: suffix ? [{ type: 'text', text: suffix }] : [],
      truncated: tokens.length > 0,
    };
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
    consumed += remaining;
    truncated = true;
    break;
  }

  if (truncated && suffix) {
    next.push({ type: 'text', text: suffix });
  }

  return { tokens: next, truncated };
}

function parseInlineWhatsAppTextTokens(text: string): WhatsAppTextToken[] {
  let tokens: WhatsAppTextToken[] = [{ type: 'text', text }];

  for (const item of MARKERS) {
    tokens = applyMarkerFormatting(tokens, item.marker, item.type);
  }

  return tokens;
}

export function parseWhatsAppTextTokens(
  text?: string | null
): WhatsAppTextToken[] {
  if (!text) return [];

  const tokens: WhatsAppTextToken[] = [];
  const lines = text.split('\n');

  lines.forEach((line, index) => {
    const quoteMatch = line.match(/^>\s?(.*)$/);

    if (quoteMatch) {
      tokens.push({ type: 'quote_start', text: '' });
      tokens.push(...parseInlineWhatsAppTextTokens(quoteMatch[1]));
      tokens.push({ type: 'quote_end', text: '' });
    } else if (line.length > 0) {
      tokens.push(...parseInlineWhatsAppTextTokens(line));
    }

    if (index < lines.length - 1) {
      tokens.push({ type: 'newline', text: '\n' });
    }
  });

  return tokens;
}

export function formatWhatsAppTextToHtml(text?: string | null): string {
  const tokens = parseWhatsAppTextTokens(text);
  if (tokens.length === 0) return '';

  return renderWhatsAppTokensToHtml(tokens);
}

export function parseWhatsAppPreviewTokens(
  text?: string | null,
  maxLength = 35,
  suffix = '...'
): WhatsAppTextToken[] {
  const tokens = parseWhatsAppTextTokens(text);
  if (tokens.length === 0) return [];

  const singleLineTokens = convertTokensToSingleLine(tokens);
  return truncateWhatsAppTextTokens(singleLineTokens, maxLength, suffix).tokens;
}

export function formatWhatsAppPreviewToHtml(
  text?: string | null,
  maxLength = 35,
  suffix = '...'
): string {
  const tokens = parseWhatsAppPreviewTokens(text, maxLength, suffix);
  if (tokens.length === 0) return '';

  return renderWhatsAppTokensToHtml(tokens);
}
