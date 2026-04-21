import moment from 'moment-timezone';
import { formatDateTime } from '@core/common/functions/formatDateTime';

describe('formatDateTime', () => {
  it('returns empty string for nullish input', () => {
    expect(formatDateTime(null)).toBe('');
  });

  it('formats string and date input with date and time', () => {
    const value = '2026-04-21T15:30:00.000Z';
    const expected = moment(value)
      .tz('America/Sao_Paulo')
      .format('DD/MM/YYYY [às] HH:mm');

    expect(formatDateTime(value)).toBe(expected);
    expect(formatDateTime(new Date(value))).toBe(expected);
  });
});
