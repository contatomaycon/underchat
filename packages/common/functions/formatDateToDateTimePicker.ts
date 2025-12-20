import moment from 'moment-timezone';

const BRAZIL_TIMEZONE = 'America/Sao_Paulo';

export function formatDateToDateTimePicker(
  input: string | null
): string | null {
  if (!input) return null;

  const date = moment(input).tz(BRAZIL_TIMEZONE);

  if (!date.isValid()) {
    return null;
  }

  return date.format('YYYY-MM-DD HH:mm');
}
