import { getPhoneNumber } from '@core/common/functions/getPhoneNumber';

describe('getPhoneNumber', () => {
  it('returns original undefined input', () => {
    expect(getPhoneNumber(undefined)).toBeUndefined();
  });

  it('extracts digits before colon when present', () => {
    expect(getPhoneNumber('5511999999999:2@s.whatsapp.net')).toBe(
      '5511999999999'
    );
  });

  it('extracts digits before at-sign when no colon exists', () => {
    expect(getPhoneNumber('55-11-99999-9999@s.whatsapp.net')).toBe(
      '5511999999999'
    );
  });
});
