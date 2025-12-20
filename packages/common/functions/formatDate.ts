import moment from 'moment-timezone';

const BRAZIL_TIMEZONE = 'America/Sao_Paulo';

export function formatDate(input: string | Date | null): string {
  if (!input) return '';

  if (typeof input === 'string') {
    return moment(input).tz(BRAZIL_TIMEZONE).format('DD/MM/YYYY');
  }

  return moment(input).tz(BRAZIL_TIMEZONE).format('DD/MM/YYYY');
}
