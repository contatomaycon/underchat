import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { ComposerTranslation } from 'vue-i18n';

export const avatarText = (value?: string | null): string => {
  if (!value) return '';
  const words = value.trim().split(/\s+/);
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
};

export const getOfflineColorDark = (): string => {
  return '#9e9e9e';
};

export const getOfflineColorLight = (): string => {
  return '#757575';
};

export const resolveAvatarBadgeVariant = (
  status: EChatUserStatus,
  isDark?: boolean
) => {
  if (status === EChatUserStatus.online) return 'success';
  if (status === EChatUserStatus.busy) return 'error';
  if (status === EChatUserStatus.away) return 'warning';
  if (status === EChatUserStatus.offline) {
    return isDark ? getOfflineColorDark() : getOfflineColorLight();
  }
  if (status === EChatUserStatus.do_not_disturb) return 'warning';
  return 'secondary';
};

export const kFormatter = (num: number) =>
  Math.abs(num) > 9999
    ? `${Math.sign(num) * +(Math.abs(num) / 1000).toFixed(1)}k`
    : Math.abs(num).toLocaleString('en-US');

const DEFAULT_DATE_FORMAT: Readonly<Intl.DateTimeFormatOptions> = Object.freeze(
  {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }
);

export const formatDate = (
  value: string,
  formatting?: Intl.DateTimeFormatOptions
) => {
  if (!value) return value;
  const options = formatting ?? DEFAULT_DATE_FORMAT;
  return new Intl.DateTimeFormat('en-US', options).format(new Date(value));
};

const monthTranslationKeys = [
  'date_month_january',
  'date_month_february',
  'date_month_march',
  'date_month_april',
  'date_month_may',
  'date_month_june',
  'date_month_july',
  'date_month_august',
  'date_month_september',
  'date_month_october',
  'date_month_november',
  'date_month_december',
];

export function formatDateLong(
  input: string | Date,
  t: ComposerTranslation
): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  const monthKey = monthTranslationKeys[date.getMonth()];

  return t('date_format_long', {
    day: date.getDate(),
    month: monthKey ? t(monthKey) : '',
    year: date.getFullYear(),
  });
}

export function formatDateToMonthShort(
  input: string | Date,
  t: ComposerTranslation
): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  const now = new Date();

  const isSameDay = date.toDateString() === now.toDateString();
  if (isSameDay) {
    return date.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return t('yesterday');

  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 7) {
    const weekdays = [
      t('sunday'),
      t('monday'),
      t('tuesday'),
      t('wednesday'),
      t('thursday'),
      t('friday'),
      t('saturday'),
    ];
    return weekdays[date.getDay()];
  }

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export const prefixWithPlus = (value: number) =>
  value > 0 ? `+${value}` : `${value}`;
