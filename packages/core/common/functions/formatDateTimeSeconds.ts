import moment from 'moment';

export function formatDateTimeSeconds(input: string | Date | null): string {
  if (!input) return '';

  return moment
    .tz(input, 'America/Sao_Paulo')
    .format('DD/MM/YYYY [às] HH:mm:ss');
}
