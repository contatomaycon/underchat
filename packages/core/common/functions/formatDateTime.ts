import moment from 'moment';

export function formatDateTime(input: string): string {
  return moment.utc(input).format('DD/MM/YYYY [às] HH:mm');
}
