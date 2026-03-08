function padTwo(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function parseIsoDate(
  value: string
): { year: number; month: number; day: number } | null {
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!isoMatch) {
    return null;
  }

  return {
    year: Number(isoMatch[1]),
    month: Number(isoMatch[2]),
    day: Number(isoMatch[3]),
  };
}

function parseDisplayDate(
  value: string
): { year: number; month: number; day: number } | null {
  const displayMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!displayMatch) {
    return null;
  }

  return {
    year: Number(displayMatch[3]),
    month: Number(displayMatch[2]),
    day: Number(displayMatch[1]),
  };
}

export function formatDateInputDisplay(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return false;
  }

  if (year < 1900 || year > 2100) {
    return false;
  }

  if (month < 1 || month > 12) {
    return false;
  }

  if (day < 1 || day > 31) {
    return false;
  }

  const testDate = new Date(year, month - 1, day, 12, 0, 0, 0);
  return (
    testDate.getFullYear() === year &&
    testDate.getMonth() === month - 1 &&
    testDate.getDate() === day
  );
}

export function normalizeBirthdayIso(
  value: string | null | undefined
): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const isoDateParts = parseIsoDate(normalized);
  if (isoDateParts) {
    const { year, month, day } = isoDateParts;

    if (!isValidDateParts(year, month, day)) {
      return null;
    }

    return `${year}-${padTwo(month)}-${padTwo(day)}`;
  }

  const displayDateParts = parseDisplayDate(normalized);
  if (displayDateParts) {
    const { year, month, day } = displayDateParts;

    if (!isValidDateParts(year, month, day)) {
      return null;
    }

    return `${year}-${padTwo(month)}-${padTwo(day)}`;
  }

  return null;
}

export function formatBirthdayDisplay(
  isoDate: string | null | undefined
): string {
  const normalized = normalizeBirthdayIso(isoDate);
  if (!normalized) {
    return '';
  }

  const [year, month, day] = normalized.split('-');
  return `${day}/${month}/${year}`;
}

export function normalizeDateDisplay(
  value: string | null | undefined
): string | null {
  const normalized = normalizeBirthdayIso(value);
  if (!normalized) {
    return null;
  }

  return formatBirthdayDisplay(normalized);
}

export function birthdayIsoToDate(
  isoDate: string | null | undefined
): Date | null {
  const normalized = normalizeBirthdayIso(isoDate);
  if (!normalized) {
    return null;
  }

  const [yearRaw, monthRaw, dayRaw] = normalized.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);

  if (!isValidDateParts(year, month, day)) {
    return null;
  }

  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function dateToBirthdayIso(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  return `${year}-${padTwo(month)}-${padTwo(day)}`;
}
