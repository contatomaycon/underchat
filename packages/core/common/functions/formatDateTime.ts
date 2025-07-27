import moment from 'moment-timezone';

export function formatDateTime(input: string | Date | null): string {
  if (!input) return '';

  return moment.tz(input, 'America/Sao_Paulo').format('DD/MM/YYYY [às] HH:mm');
}
