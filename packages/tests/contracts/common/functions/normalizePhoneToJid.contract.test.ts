const jidNormalizedUserMock = jest.fn();

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: (...args: unknown[]) => jidNormalizedUserMock(...args),
}));

import { normalizePhoneToJid } from '@core/common/functions/normalizePhoneToJid';

describe('normalizePhoneToJid', () => {
  beforeEach(() => {
    jidNormalizedUserMock.mockReset();
  });

  it('returns undefined for empty phone input', () => {
    expect(normalizePhoneToJid(undefined)).toBeUndefined();
    expect(normalizePhoneToJid(null)).toBeUndefined();
    expect(normalizePhoneToJid('---')).toBeUndefined();
  });

  it('builds jid with sanitized ddi and phone, defaulting ddi to 55', () => {
    jidNormalizedUserMock.mockImplementation((value: string) => value);

    expect(normalizePhoneToJid('(11) 99999-9999', '(+55)')).toBe(
      '5511999999999@s.whatsapp.net'
    );
    expect(normalizePhoneToJid('11999999999', undefined)).toBe(
      '5511999999999@s.whatsapp.net'
    );
    expect(normalizePhoneToJid('11999999999', null)).toBe(
      '5511999999999@s.whatsapp.net'
    );
    expect(normalizePhoneToJid('11999999999', '---')).toBe(
      '5511999999999@s.whatsapp.net'
    );
  });

  it('returns raw jid when normalization helper throws', () => {
    jidNormalizedUserMock.mockImplementation(() => {
      throw new Error('invalid');
    });

    expect(normalizePhoneToJid('11999999999', '55')).toBe(
      '5511999999999@s.whatsapp.net'
    );
  });
});
