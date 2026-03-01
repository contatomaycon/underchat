import {
  CONTACT_DOCUMENT_TYPE,
  type ContactDocumentTypeId,
} from '../types/contact';

function onlyDigits(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\D/g, '');
}

export function formatCpf(value: string | null | undefined): string {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  }
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

export function formatCnpj(value: string | null | undefined): string {
  const digits = onlyDigits(value).slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  }
  if (digits.length <= 12) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  }
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
}

export function formatDocumentByType(
  value: string | null | undefined,
  documentTypeId: ContactDocumentTypeId | string | null | undefined
): string {
  if (!value) return '';

  if (documentTypeId === CONTACT_DOCUMENT_TYPE.cpf) {
    return formatCpf(value);
  }
  if (documentTypeId === CONTACT_DOCUMENT_TYPE.cnpj) {
    return formatCnpj(value);
  }

  const digits = onlyDigits(value);
  if (digits.length <= 11) return formatCpf(digits);
  return formatCnpj(digits);
}

export function getDocumentMaskMaxLength(
  documentTypeId: ContactDocumentTypeId | string | null | undefined
): number {
  if (documentTypeId === CONTACT_DOCUMENT_TYPE.cnpj) {
    return 18;
  }
  if (documentTypeId === CONTACT_DOCUMENT_TYPE.cpf) {
    return 14;
  }
  return 18;
}

export function normalizeDocumentDigits(
  value: string | null | undefined,
  documentTypeId: ContactDocumentTypeId | string | null | undefined
): string {
  const digits = onlyDigits(value);
  if (documentTypeId === CONTACT_DOCUMENT_TYPE.cpf) {
    return digits.slice(0, 11);
  }
  if (documentTypeId === CONTACT_DOCUMENT_TYPE.cnpj) {
    return digits.slice(0, 14);
  }
  return digits.slice(0, 14);
}

export function isValidCpf(value: string | null | undefined): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1+$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(cpf[i]) * (10 - i);
  }
  let firstDigit = (sum * 10) % 11;
  if (firstDigit === 10) firstDigit = 0;
  if (firstDigit !== Number(cpf[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += Number(cpf[i]) * (11 - i);
  }
  let secondDigit = (sum * 10) % 11;
  if (secondDigit === 10) secondDigit = 0;
  return secondDigit === Number(cpf[10]);
}

export function isValidCnpj(value: string | null | undefined): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1+$/.test(cnpj)) return false;

  const calcDigit = (base: string, factors: number[]): number => {
    let total = 0;
    for (let i = 0; i < factors.length; i++) {
      total += Number(base[i]) * factors[i];
    }
    const remainder = total % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const firstDigit = calcDigit(cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (firstDigit !== Number(cnpj[12])) return false;

  const secondDigit = calcDigit(cnpj, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return secondDigit === Number(cnpj[13]);
}
