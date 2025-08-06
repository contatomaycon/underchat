import { ComposerTranslation } from 'vue-i18n';

export const avatarText = (value: string | null) => {
  if (!value) return '';
  const nameArray = value.split(' ');
  return nameArray.map((word) => word.charAt(0).toUpperCase()).join('');
};

export const kFormatter = (num: number) => {
  return Math.abs(num) > 9999
    ? `${Math.sign(num) * +(Math.abs(num) / 1000).toFixed(1)}k`
    : Math.abs(num).toLocaleString('en-US');
};

export const formatDate = (
  value: string,
  formatting: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }
) => {
  if (!value) return value;

  return new Intl.DateTimeFormat('en-US', formatting).format(new Date(value));
};

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
  if (date.toDateString() === yesterday.toDateString()) {
    return t('yesterday');
  }

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
