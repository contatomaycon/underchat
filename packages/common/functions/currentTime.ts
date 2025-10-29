import { tz } from 'moment-timezone';

export function currentTime(): string {
  const timeZone = 'America/Sao_Paulo';
  const nowInTimeZone = tz(new Date(), timeZone);

  return nowInTimeZone.format('YYYY-MM-DD HH:mm:ss');
}
