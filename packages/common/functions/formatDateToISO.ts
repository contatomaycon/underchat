import moment from 'moment-timezone';

const BRAZIL_TIMEZONE = 'America/Sao_Paulo';

export function formatDateToISO(
  dateString: string,
  format: string = 'YYYY-MM-DD HH:mm'
): string {
  const date = moment.tz(dateString, format, true, BRAZIL_TIMEZONE);

  if (!date.isValid()) {
    return dateString;
  }

  return date.toISOString();
}
