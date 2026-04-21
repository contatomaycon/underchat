jest.mock('@core/common/functions/getPhoneFromJid', () => ({
  getPhoneFromJid: jest.fn((first?: string | null, second?: string | null) => {
    if (
      (typeof first === 'string' && first.includes('fallback')) ||
      (typeof second === 'string' && second.includes('fallback'))
    ) {
      return null;
    }
    if (first && first.includes('@')) return '55 (11) 99999-1111';
    if (second && second.includes('@')) return '55 (11) 98888-2222';
    return null;
  }),
}));

import { resolveCallEventJidAndPhone } from '@core/services/baileys/util/callEventResolver';

describe('resolveCallEventJidAndPhone', () => {
  it('returns nulls when no jid candidate is valid', () => {
    expect(
      resolveCallEventJidAndPhone({
        from: ' ',
        chatId: '123',
        caller: null,
      })
    ).toEqual({ callJid: null, callPhone: null });
  });

  it('resolves jid and phone using getPhoneFromJid', () => {
    expect(
      resolveCallEventJidAndPhone({
        from: '5511@s.whatsapp.net',
        chatId: ' ',
        callerPn: '(11) 90000-0000',
      })
    ).toEqual({
      callJid: '5511@s.whatsapp.net',
      callPhone: '5511988882222',
    });
  });

  it('falls back to callerPn when jid phone cannot be extracted', () => {
    expect(
      resolveCallEventJidAndPhone({
        from: 'fallback@s.whatsapp.net',
        chatId: 'fallback@s.whatsapp.net',
        callerPn: '+55 11 97777-0000',
      })
    ).toEqual({
      callJid: 'fallback@s.whatsapp.net',
      callPhone: '5511977770000',
    });
  });
});
