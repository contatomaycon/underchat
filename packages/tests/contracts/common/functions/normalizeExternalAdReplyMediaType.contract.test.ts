import { normalizeExternalAdReplyMediaType } from '@core/common/functions/normalizeExternalAdReplyMediaType';

describe('normalizeExternalAdReplyMediaType', () => {
  it('normalizes finite numbers and truncates decimals', () => {
    expect(normalizeExternalAdReplyMediaType(2)).toBe(2);
    expect(normalizeExternalAdReplyMediaType(2.9)).toBe(2);
    expect(normalizeExternalAdReplyMediaType(-1.2)).toBe(-1);
  });

  it('returns null for non-finite numbers', () => {
    expect(
      normalizeExternalAdReplyMediaType(Number.POSITIVE_INFINITY)
    ).toBeNull();
    expect(normalizeExternalAdReplyMediaType(Number.NaN)).toBeNull();
  });

  it('normalizes string numbers and enum names', () => {
    expect(normalizeExternalAdReplyMediaType(' 2 ')).toBe(2);
    expect(normalizeExternalAdReplyMediaType('-3')).toBe(-3);
    expect(normalizeExternalAdReplyMediaType('image')).toBe(1);
    expect(normalizeExternalAdReplyMediaType('VIDEO')).toBe(2);
    expect(normalizeExternalAdReplyMediaType('none')).toBe(0);
  });

  it('returns null for empty, unknown or unsupported values', () => {
    expect(normalizeExternalAdReplyMediaType('')).toBeNull();
    expect(normalizeExternalAdReplyMediaType('   ')).toBeNull();
    expect(normalizeExternalAdReplyMediaType('abc')).toBeNull();
    expect(normalizeExternalAdReplyMediaType({})).toBeNull();
  });
});
