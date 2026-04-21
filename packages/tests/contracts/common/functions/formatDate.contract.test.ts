import moment from 'moment-timezone';
import { formatDate } from '@core/common/functions/formatDate';

describe('formatDate', () => {
  it('returns empty string for nullish input', () => {
    expect(formatDate(null)).toBe('');
  });

  it('formats string input using Sao Paulo timezone', () => {
    const input = '2026-04-21T15:30:00.000Z';
    const expected = moment(input).tz('America/Sao_Paulo').format('DD/MM/YYYY');

    expect(formatDate(input)).toBe(expected);
  });

  it('formats Date input using Sao Paulo timezone', () => {
    const input = new Date('2026-04-21T15:30:00.000Z');
    const expected = moment(input).tz('America/Sao_Paulo').format('DD/MM/YYYY');

    expect(formatDate(input)).toBe(expected);
  });
});
