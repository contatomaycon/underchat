function digitsOnly(value: string | null | undefined): string {
  if (!value) {
    return '';
  }

  return value.replace(/\D/g, '');
}

function trimBrazilDdi(value: string): string {
  const digits = digitsOnly(value);

  if (digits.length > 11 && digits.startsWith('55')) {
    return digits.slice(2);
  }

  return digits;
}

export function normalizePhoneDigits(
  value: string | null | undefined
): string | null {
  const normalized = trimBrazilDdi(value ?? '').slice(0, 11);
  return normalized.length > 0 ? normalized : null;
}

export function formatLocalPhone(value: string): string {
  const normalized = normalizePhoneDigits(value) ?? '';

  if (normalized.length <= 2) {
    return normalized;
  }

  if (normalized.length <= 6) {
    return `(${normalized.slice(0, 2)}) ${normalized.slice(2)}`;
  }

  if (normalized.length <= 10) {
    return `(${normalized.slice(0, 2)}) ${normalized.slice(2, 6)}-${normalized.slice(6)}`;
  }

  return `(${normalized.slice(0, 2)}) ${normalized.slice(2, 7)}-${normalized.slice(7)}`;
}

export function formatPhoneForDisplay(
  value: string | null | undefined,
  ddi?: string | null
): string {
  if (!value) {
    return '';
  }

  if (value.includes('*')) {
    return value;
  }

  let digits = digitsOnly(value);
  if (!digits) {
    return '';
  }

  const ddiDigits = digitsOnly(ddi ?? '');
  if (ddiDigits && digits.length > 11 && digits.startsWith(ddiDigits)) {
    digits = digits.slice(ddiDigits.length);
  }

  return formatLocalPhone(digits);
}

export function formatChannelPhoneLabel(
  number: string | null | undefined
): string {
  if (!number) {
    return '';
  }

  if (number.includes('*')) {
    return number;
  }

  const digits = digitsOnly(number);
  if (!digits) {
    return number;
  }

  const localDigits = trimBrazilDdi(digits);
  if (localDigits.length >= 10 && localDigits.length <= 11) {
    return `+55 ${formatLocalPhone(localDigits)}`;
  }

  if (digits.length <= 11) {
    return formatLocalPhone(digits);
  }

  const countryDigits = digits.slice(0, digits.length - 11);
  const phoneDigits = digits.slice(-11);

  if (!countryDigits) {
    return formatLocalPhone(phoneDigits);
  }

  return `+${countryDigits} ${formatLocalPhone(phoneDigits)}`;
}
