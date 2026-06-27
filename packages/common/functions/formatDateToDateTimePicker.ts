import moment from 'moment-timezone';
import { APP_TIMEZONE } from '@core/common/constants/timezone';

export function formatDateToDateTimePicker(
  input: string | null
): string | null {
  if (!input) return null;

  const date = moment(input).tz(APP_TIMEZONE);

  if (!date.isValid()) {
    return null;
  }

  return date.format('YYYY-MM-DD HH:mm');
}
