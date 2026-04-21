const jidNormalizedUserMock = jest.fn();

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: (...args: unknown[]) => jidNormalizedUserMock(...args),
}));

import { normalizeJid } from '@core/common/functions/normalizeJid';

describe('normalizeJid', () => {
  beforeEach(() => {
    jidNormalizedUserMock.mockReset();
  });

  it('returns undefined for empty jid', () => {
    expect(normalizeJid(undefined)).toBeUndefined();
    expect(normalizeJid(null)).toBeUndefined();
  });

  it('normalizes jid using baileys helper', () => {
    jidNormalizedUserMock.mockReturnValue('5511999999999@s.whatsapp.net');

    expect(normalizeJid('  5511999999999@s.whatsapp.net  ')).toBe(
      '5511999999999@s.whatsapp.net'
    );
    expect(jidNormalizedUserMock).toHaveBeenCalledWith(
      '5511999999999@s.whatsapp.net'
    );
  });

  it('converts @c.us suffix to @s.whatsapp.net', () => {
    jidNormalizedUserMock.mockReturnValue('5511999999999@c.us');

    expect(normalizeJid('5511999999999@c.us')).toBe(
      '5511999999999@s.whatsapp.net'
    );
  });

  it('falls back to raw value when normalization throws', () => {
    jidNormalizedUserMock.mockImplementation(() => {
      throw new Error('invalid');
    });

    expect(normalizeJid('5511999999999@c.us')).toBe(
      '5511999999999@s.whatsapp.net'
    );
  });
});
