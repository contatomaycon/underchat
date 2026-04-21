import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';

describe('formatPhoneBR', () => {
  it('returns digits unchanged when not brazilian format', () => {
    expect(formatPhoneBR('12345')).toBe('12345');
    expect(formatPhoneBR('+1 (234) 567-8900')).toBe('12345678900');
  });

  it('formats brazilian phone with ddi, ddd, prefix and suffix', () => {
    expect(formatPhoneBR('5511999991234')).toBe('+55 (11) 99999-1234');
    expect(formatPhoneBR(5511988881234)).toBe('+55 (11) 98888-1234');
  });
});
