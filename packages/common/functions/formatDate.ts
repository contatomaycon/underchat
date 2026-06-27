import moment from 'moment-timezone';
import { APP_TIMEZONE } from '@core/common/constants/timezone';

export function formatDate(input: string | Date | null): string {
  if (!input) return '';

  if (typeof input === 'string') {
    return moment(input).tz(APP_TIMEZONE).format('DD/MM/YYYY');
  }

  return moment(input).tz(APP_TIMEZONE).format('DD/MM/YYYY');
}
