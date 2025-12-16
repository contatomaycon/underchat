import moment from 'moment-timezone';

const BRAZIL_TIMEZONE = 'America/Sao_Paulo';

export function formatDateTime(input: string | Date | null): string {
  if (!input) return '';

  if (typeof input === 'string') {
    return moment(input).tz(BRAZIL_TIMEZONE).format('DD/MM/YYYY [às] HH:mm');
  }

  return moment(input).tz(BRAZIL_TIMEZONE).format('DD/MM/YYYY [às] HH:mm');
}
