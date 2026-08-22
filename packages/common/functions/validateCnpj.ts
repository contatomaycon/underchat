const CNPJ_FIRST_DIGIT_MULTIPLIERS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_SECOND_DIGIT_MULTIPLIERS = [
  6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2,
];

export const normalizeCnpj = (cnpj: string): string =>
  cnpj.replaceAll(/[^a-zA-Z0-9]/g, '').toUpperCase();

export const isCnpjFormat = (cnpj: string): boolean =>
  /^[A-Z0-9]{12}\d{2}$/.test(normalizeCnpj(cnpj));

export const formatCnpj = (cnpj: string): string => {
  const clean = normalizeCnpj(cnpj).slice(0, 14);

  if (clean.length <= 2) return clean;
  if (clean.length <= 5) return `${clean.slice(0, 2)}.${clean.slice(2)}`;
  if (clean.length <= 8) {
    return `${clean.slice(0, 2)}.${clean.slice(2, 5)}.${clean.slice(5)}`;
  }
  if (clean.length <= 12) {
    return `${clean.slice(0, 2)}.${clean.slice(2, 5)}.${clean.slice(5, 8)}/${clean.slice(8)}`;
  }
  return `${clean.slice(0, 2)}.${clean.slice(2, 5)}.${clean.slice(5, 8)}/${clean.slice(8, 12)}-${clean.slice(12, 14)}`;
};

const getCnpjCharacterValue = (character: string): number =>
  character.charCodeAt(0) - 48;

const calculateCnpjDigit = (base: string, multipliers: number[]): number => {
  const sum = base
    .split('')
    .reduce(
      (total, character, index) =>
        total + getCnpjCharacterValue(character) * multipliers[index],
      0
    );
  const remainder = sum % 11;

  return remainder < 2 ? 0 : 11 - remainder;
};

export const validateCnpj = (cnpj: string): boolean => {
  const normalized = normalizeCnpj(cnpj);

  if (!isCnpjFormat(normalized)) return false;

  if (/^(\d)\1{13}$/.test(normalized)) return false;

  const firstDigit = calculateCnpjDigit(
    normalized.slice(0, 12),
    CNPJ_FIRST_DIGIT_MULTIPLIERS
  );
  if (firstDigit !== Number.parseInt(normalized.charAt(12), 10)) return false;

  const secondDigit = calculateCnpjDigit(
    normalized.slice(0, 13),
    CNPJ_SECOND_DIGIT_MULTIPLIERS
  );
  if (secondDigit !== Number.parseInt(normalized.charAt(13), 10)) return false;

  return true;
};
