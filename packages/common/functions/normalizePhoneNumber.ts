import { onlyDigits } from './onlyDigits';

export interface INormalizedPhone {
  phone: string;
  phone_ddi: string;
}

export function normalizePhoneNumber(
  phone: string | null | undefined
): INormalizedPhone | null {
  if (!phone) return null;

  const cleaned = phone.trim();
  if (!cleaned) return null;

  const withoutPlus = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  const digits = onlyDigits(withoutPlus);

  if (!digits || digits.length === 0) return null;

  if (digits.startsWith('55') && digits.length >= 12) {
    const ddi = digits.slice(0, 2);
    const number = digits.slice(2);
    return {
      phone: number,
      phone_ddi: ddi,
    };
  }

  return {
    phone: digits,
    phone_ddi: '55',
  };
}
