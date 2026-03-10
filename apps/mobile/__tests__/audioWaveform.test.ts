import { Buffer } from 'buffer';
import { describe, expect, it } from '@jest/globals';
import { decodeBase64Waveform, parseWaveform } from '../utils/audioWaveform';

const normalize = (value: number): number =>
  Math.max(0.15, Math.min(1, value / 100));

describe('audioWaveform utils', () => {
  it('decodifica waveform em base64 padrão', () => {
    const bytes = [0, 10, 50, 100];
    const encoded = Buffer.from(bytes).toString('base64');

    expect(decodeBase64Waveform(encoded)).toEqual(bytes);
    expect(parseWaveform(encoded)).toEqual(bytes.map(normalize));
  });

  it('decodifica waveform em base64 URL-safe sem padding', () => {
    const bytes = [250, 251, 252, 253, 254, 255];
    const encoded = Buffer.from(bytes)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');

    expect(decodeBase64Waveform(encoded)).toEqual(bytes);
  });

  it('usa fallback com Buffer quando atob não está disponível', () => {
    const bytes = [1, 2, 3, 4];
    const encoded = Buffer.from(bytes).toString('base64');
    const globalWithAtob = globalThis as {
      atob?: ((data: string) => string) | undefined;
    };
    const originalAtob = globalWithAtob.atob;

    try {
      globalWithAtob.atob = undefined;
      expect(decodeBase64Waveform(encoded)).toEqual(bytes);
    } finally {
      if (originalAtob) {
        globalWithAtob.atob = originalAtob;
      } else {
        delete globalWithAtob.atob;
      }
    }
  });

  it('retorna null para payload inválido', () => {
    expect(decodeBase64Waveform('%%%')).toBeNull();
    expect(parseWaveform('%%%')).toBeNull();
  });
});
