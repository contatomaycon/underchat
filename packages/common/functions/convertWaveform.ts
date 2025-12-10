import { Buffer } from 'node:buffer';

export function convertWaveformToBase64(
  waveform: string | Uint8Array | null | undefined
): string | null {
  if (!waveform) {
    return null;
  }

  if (typeof waveform === 'string') {
    return waveform;
  }

  if (waveform instanceof Uint8Array) {
    return Buffer.from(waveform).toString('base64');
  }

  return null;
}

export function convertWaveformBase64ToUint8Array(
  waveform: string | number[] | null | undefined
): Uint8Array | undefined {
  if (!waveform) {
    return undefined;
  }

  if (typeof waveform === 'string') {
    try {
      const buffer = Buffer.from(waveform, 'base64');
      return new Uint8Array(buffer);
    } catch {
      return undefined;
    }
  }

  if (Array.isArray(waveform)) {
    return new Uint8Array(waveform);
  }

  return undefined;
}
