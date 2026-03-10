import { Buffer } from 'buffer';

const MIN_WAVEFORM_VALUE = 0.15;
const MAX_WAVEFORM_VALUE = 1;
const WAVEFORM_NORMALIZATION_DIVISOR = 100;
const DEFAULT_WAVEFORM_PLACEHOLDER_BARS = 64;
const DEFAULT_WAVEFORM_PLACEHOLDER_LEVEL = 0.3;
const BASE64_ALLOWED_CHARS = /^[A-Za-z0-9+/=]+$/;

export type WaveformInput = string | number[] | null | undefined;

function normalizeBase64Value(raw: string): string {
  const compact = raw.trim().replace(/\s+/g, '');
  if (!compact) return '';

  const normalized = compact.replace(/-/g, '+').replace(/_/g, '/');
  const paddingSize = normalized.length % 4;
  const withPadding =
    paddingSize > 0
      ? `${normalized}${'='.repeat(4 - paddingSize)}`
      : normalized;

  if (!BASE64_ALLOWED_CHARS.test(withPadding)) {
    return '';
  }

  return withPadding;
}

function decodeWithAtob(base64: string): number[] | null {
  try {
    if (typeof globalThis.atob !== 'function') return null;
    const binary = globalThis.atob(base64);
    if (!binary) return null;

    const bytes: number[] = [];
    for (let index = 0; index < binary.length; index += 1) {
      bytes.push(binary.charCodeAt(index) & 0xff);
    }
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
}

function decodeWithBuffer(base64: string): number[] | null {
  try {
    const decoded = Buffer.from(base64, 'base64');
    if (!decoded || decoded.length === 0) return null;
    return Array.from(decoded.values());
  } catch {
    return null;
  }
}

export function decodeBase64Waveform(base64: string): number[] | null {
  const normalizedBase64 = normalizeBase64Value(base64);
  if (!normalizedBase64) return null;

  const fromAtob = decodeWithAtob(normalizedBase64);
  if (fromAtob && fromAtob.length > 0) {
    return fromAtob;
  }

  return decodeWithBuffer(normalizedBase64);
}

export function normalizeWaveformValues(values: number[]): number[] {
  return values.map((value) =>
    Math.max(
      MIN_WAVEFORM_VALUE,
      Math.min(MAX_WAVEFORM_VALUE, value / WAVEFORM_NORMALIZATION_DIVISOR)
    )
  );
}

export function parseWaveform(waveform: WaveformInput): number[] | null {
  if (!waveform) return null;

  if (typeof waveform === 'string') {
    const decoded = decodeBase64Waveform(waveform);
    return decoded && decoded.length > 0
      ? normalizeWaveformValues(decoded)
      : null;
  }

  if (Array.isArray(waveform) && waveform.length > 0) {
    return normalizeWaveformValues(waveform);
  }

  return null;
}

export function createFlatWaveformPlaceholder(
  bars = DEFAULT_WAVEFORM_PLACEHOLDER_BARS
): number[] {
  const safeBars =
    typeof bars === 'number' && Number.isFinite(bars) && bars > 0
      ? Math.floor(bars)
      : DEFAULT_WAVEFORM_PLACEHOLDER_BARS;
  return new Array(safeBars).fill(DEFAULT_WAVEFORM_PLACEHOLDER_LEVEL);
}
