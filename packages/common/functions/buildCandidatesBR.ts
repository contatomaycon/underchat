import { onlyDigits } from './onlyDigits';

export type CandidateOrder = 'input_first' | 'without_9_first';

interface BuildCandidatesOptions {
  order?: CandidateOrder;
}

function isBrazil(numeric: string): boolean {
  return numeric.startsWith('55');
}

function uniqueStable(candidates: string[]): string[] {
  return Array.from(new Set(candidates.filter(Boolean)));
}

function getBrazilPhoneVariantsWithDdi(numeric: string): {
  with9: string;
  without9: string;
} | null {
  const n = onlyDigits(numeric);
  const rest = n.slice(2);

  if (rest.length < 10) return null;

  const ddd = rest.slice(0, 2);
  const local = rest.slice(2);

  const without9Local =
    local.length === 9 && local.startsWith('9') ? local.slice(1) : local;

  const with9Local = local.length === 8 ? `9${local}` : local;

  const without9 = `55${ddd}${without9Local}`;
  const with9 = `55${ddd}${with9Local}`;

  return { with9, without9 };
}

function buildCandidatesBR(
  numeric: string,
  order: CandidateOrder = 'without_9_first'
): string[] {
  const n = onlyDigits(numeric);
  const variants = getBrazilPhoneVariantsWithDdi(n);
  if (!variants) return [n];

  const { with9, without9 } = variants;
  if (order === 'input_first') {
    const fallback = n === with9 ? without9 : with9;
    return uniqueStable([n, fallback]);
  }

  return uniqueStable([without9, with9]);
}

function getBrazilPhoneVariantsWithoutDdi(phone: string): {
  with9: string;
  without9: string;
} | null {
  const normalizedPhone = onlyDigits(phone);
  if (normalizedPhone.length < 10) return null;

  const ddd = normalizedPhone.slice(0, 2);
  const local = normalizedPhone.slice(2);

  const without9Local =
    local.length === 9 && local.startsWith('9') ? local.slice(1) : local;

  const with9Local = local.length === 8 ? `9${local}` : local;

  const without9 = `${ddd}${without9Local}`;
  const with9 = `${ddd}${with9Local}`;

  return { with9, without9 };
}

function buildCandidatesBRWithDdi(
  phone: string,
  order: CandidateOrder = 'without_9_first'
): string[] {
  const normalizedPhone = onlyDigits(phone);
  const variants = getBrazilPhoneVariantsWithoutDdi(normalizedPhone);
  if (!variants) return [normalizedPhone];

  const { with9, without9 } = variants;
  if (order === 'input_first') {
    const fallback = normalizedPhone === with9 ? without9 : with9;
    return uniqueStable([normalizedPhone, fallback]);
  }

  return uniqueStable([without9, with9]);
}

export function buildCandidates(
  numeric: string,
  options?: BuildCandidatesOptions
): string[] {
  const n = onlyDigits(numeric);
  if (!isBrazil(n)) return [n];

  return buildCandidatesBR(n, options?.order);
}

export function buildCandidatesWithDdi(
  phone: string,
  phoneDdi: string,
  options?: BuildCandidatesOptions
): string[] {
  const fullNumber = `${phoneDdi}${phone}`;
  const n = onlyDigits(fullNumber);
  const normalizedPhone = onlyDigits(phone);
  if (!isBrazil(n)) return [normalizedPhone];

  return buildCandidatesBRWithDdi(normalizedPhone, options?.order);
}
