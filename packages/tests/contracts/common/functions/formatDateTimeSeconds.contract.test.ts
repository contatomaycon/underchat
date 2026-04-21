import moment from 'moment-timezone';
import { formatDateTimeSeconds } from '@core/common/functions/formatDateTimeSeconds';

describe('formatDateTimeSeconds', () => {
  it('returns empty string for nullish input', () => {
    expect(formatDateTimeSeconds(null)).toBe('');
  });

  it('formats string and date input with seconds', () => {
    const value = '2026-04-21T15:30:45.000Z';
    const expected = moment(value)
      .tz('America/Sao_Paulo')
      .format('DD/MM/YYYY [às] HH:mm:ss');

    expect(formatDateTimeSeconds(value)).toBe(expected);
    expect(formatDateTimeSeconds(new Date(value))).toBe(expected);
  });
});
