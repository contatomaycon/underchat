import { getPhoneFromJid } from '@core/common/functions/getPhoneFromJid';

describe('getPhoneFromJid', () => {
  it('returns null when both inputs are missing', () => {
    expect(getPhoneFromJid(undefined, undefined)).toBeNull();
  });

  it('prefers non-lid jid when one of the values is lid', () => {
    expect(getPhoneFromJid('5511999999999@s.whatsapp.net', 'abc@lid')).toBe(
      '5511999999999'
    );
    expect(getPhoneFromJid('abc@lid', '5511888888888@s.whatsapp.net')).toBe(
      '5511888888888'
    );
  });

  it('returns null when chosen jid is lid', () => {
    expect(getPhoneFromJid('abc@lid', undefined)).toBeNull();
    expect(getPhoneFromJid(undefined, 'abc@lid')).toBeNull();
  });

  it('extracts only digits from selected jid', () => {
    expect(getPhoneFromJid('55-11-99999-9999@s.whatsapp.net')).toBe(
      '5511999999999'
    );
  });
});
