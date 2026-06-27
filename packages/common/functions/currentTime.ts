import moment from 'moment-timezone';
import { APP_TIMEZONE } from '@core/common/constants/timezone';

export function currentTime(): string {
  const nowInTimeZone = moment.tz(new Date(), APP_TIMEZONE);

  return nowInTimeZone.format('YYYY-MM-DDTHH:mm:ss.SSSZ');
}
