import moment from 'moment-timezone';
import { APP_TIMEZONE } from '@core/common/constants/timezone';

export function formatDateToISO(
  dateString: string,
  format: string = 'YYYY-MM-DD HH:mm'
): string {
  const date = moment.tz(dateString, format, true, APP_TIMEZONE);

  if (!date.isValid()) {
    return dateString;
  }

  return date.toISOString();
}
