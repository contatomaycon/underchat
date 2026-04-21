import { remoteJid } from '@core/common/functions/remoteJid';

describe('remoteJid', () => {
  it('returns undefined for nullish and null values', () => {
    expect(remoteJid(undefined)).toBeUndefined();
    expect(remoteJid(null)).toBeUndefined();
    expect(remoteJid({ remoteJid: null })).toBeUndefined();
  });

  it('returns remoteJid when present', () => {
    expect(remoteJid({ remoteJid: '5511@s.whatsapp.net' })).toBe(
      '5511@s.whatsapp.net'
    );
  });
});
