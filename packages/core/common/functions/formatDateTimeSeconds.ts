import moment from 'moment-timezone';

export function formatDateTimeSeconds(input: string | Date | null): string {
  if (!input) return '';

  if (typeof input === 'string') {
    return moment.parseZone(input).format('DD/MM/YYYY [às] HH:mm:ss');
  }

  return moment(input)
    .tz('America/Sao_Paulo')
    .format('DD/MM/YYYY [às] HH:mm:ss');
}
