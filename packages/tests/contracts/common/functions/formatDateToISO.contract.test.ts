import moment from 'moment-timezone';
import { formatDateToISO } from '@core/common/functions/formatDateToISO';

describe('formatDateToISO', () => {
  it('returns original string when input is invalid', () => {
    expect(formatDateToISO('not-a-date')).toBe('not-a-date');
  });

  it('returns ISO value for valid date using default format', () => {
    const input = '2026-04-21 12:30';
    const expected = moment
      .tz(input, 'YYYY-MM-DD HH:mm', true, 'America/Sao_Paulo')
      .toISOString();

    expect(formatDateToISO(input)).toBe(expected);
  });

  it('supports custom input format', () => {
    const input = '21/04/2026 12:30';
    const expected = moment
      .tz(input, 'DD/MM/YYYY HH:mm', true, 'America/Sao_Paulo')
      .toISOString();

    expect(formatDateToISO(input, 'DD/MM/YYYY HH:mm')).toBe(expected);
  });
});
