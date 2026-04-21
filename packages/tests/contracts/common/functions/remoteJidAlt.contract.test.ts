import { remoteJidAlt } from '@core/common/functions/remoteJidAlt';

describe('remoteJidAlt', () => {
  it('returns undefined for nullish and null values', () => {
    expect(remoteJidAlt(undefined)).toBeUndefined();
    expect(remoteJidAlt(null)).toBeUndefined();
    expect(remoteJidAlt({ remoteJidAlt: null })).toBeUndefined();
  });

  it('returns remoteJidAlt when present', () => {
    expect(remoteJidAlt({ remoteJidAlt: '5511@lid' })).toBe('5511@lid');
  });
});
