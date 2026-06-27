import moment from 'moment-timezone';
import { APP_TIMEZONE } from '@core/common/constants/timezone';

export function formatDateTimeSeconds(input: string | Date | null): string {
  if (!input) return '';

  if (typeof input === 'string') {
    return moment(input).tz(APP_TIMEZONE).format('DD/MM/YYYY [às] HH:mm:ss');
  }

  return moment(input).tz(APP_TIMEZONE).format('DD/MM/YYYY [às] HH:mm:ss');
}
