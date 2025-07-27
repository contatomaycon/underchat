import moment from 'moment-timezone';

export function formatDateTime(input: string | Date): string {
  return moment.tz(input, 'America/Sao_Paulo').format('DD/MM/YYYY [às] HH:mm');
}
