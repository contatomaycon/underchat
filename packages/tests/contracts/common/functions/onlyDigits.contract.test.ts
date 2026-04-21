import { onlyDigits } from '@core/common/functions/onlyDigits';

describe('onlyDigits', () => {
  it('removes non-digit characters', () => {
    expect(onlyDigits('(11) 98765-4321')).toBe('11987654321');
    expect(onlyDigits('A1B2C3')).toBe('123');
  });

  it('returns empty string when no digits exist', () => {
    expect(onlyDigits('abc-()')).toBe('');
  });
});
