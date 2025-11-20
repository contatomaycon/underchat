import { onlyDigits } from './onlyDigits';

export interface INormalizedPhone {
  phone: string;
  phone_ddi: string;
}

function extractBrazilianDDI(digits: string): INormalizedPhone | null {
  if (digits.startsWith('55') && digits.length >= 12) {
    const ddi = digits.slice(0, 2);
    const number = digits.slice(2);
    return {
      phone: number,
      phone_ddi: ddi,
    };
  }
  return null;
}

function tryDifferentDDILengths(digits: string): INormalizedPhone | null {
  const ddiLengths = [2, 3, 1];
  for (const ddiLength of ddiLengths) {
    if (digits.length < ddiLength + 8) continue;

    const potentialDdi = digits.slice(0, ddiLength);
    const potentialNumber = digits.slice(ddiLength);

    if (potentialNumber.length >= 8 && potentialNumber.length <= 15) {
      return {
        phone: potentialNumber,
        phone_ddi: potentialDdi,
      };
    }
  }
  return null;
}

function processPhoneWithDDI(digits: string): INormalizedPhone | null {
  const brazilianResult = extractBrazilianDDI(digits);
  if (brazilianResult) return brazilianResult;

  return tryDifferentDDILengths(digits);
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

  if (digits.length >= 10) {
    const result = processPhoneWithDDI(digits);
    if (result) return result;
  }

  return {
    phone: digits,
    phone_ddi: '55',
  };
}
