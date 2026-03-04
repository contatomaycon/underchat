function padTwo(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
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

export function normalizeBirthdayIso(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);

    if (!isValidDateParts(year, month, day)) {
      return null;
    }

    return `${year}-${padTwo(month)}-${padTwo(day)}`;
  }

  const displayMatch = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (displayMatch) {
    const day = Number(displayMatch[1]);
    const month = Number(displayMatch[2]);
    const year = Number(displayMatch[3]);

    if (!isValidDateParts(year, month, day)) {
      return null;
    }

    return `${year}-${padTwo(month)}-${padTwo(day)}`;
  }

  return null;
}

export function formatBirthdayDisplay(isoDate: string | null | undefined): string {
  const normalized = normalizeBirthdayIso(isoDate);
  if (!normalized) {
    return '';
  }

  const [year, month, day] = normalized.split('-');
  return `${day}/${month}/${year}`;
}

export function birthdayIsoToDate(isoDate: string | null | undefined): Date | null {
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
