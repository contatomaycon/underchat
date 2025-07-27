import moment from 'moment';

export function formatDateTimeSeconds(input: string | Date): string {
  return moment
    .tz(input, 'America/Sao_Paulo')
    .format('DD/MM/YYYY [às] HH:mm:ss');
}
