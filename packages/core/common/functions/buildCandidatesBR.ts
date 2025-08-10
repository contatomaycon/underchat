import { onlyDigits } from './onlyDigits';

function isBrazil(numeric: string) {
  return numeric.startsWith('55');
}

function buildCandidatesBR(numeric: string) {
  const n = onlyDigits(numeric);
  const rest = n.slice(2); // remove 55

  if (rest.length < 10) return [n];

  const ddd = rest.slice(0, 2);
  const local = rest.slice(2);

  const without9Local =
    local.length === 9 && local.startsWith('9') ? local.slice(1) : local;

  const with9Local =
    local.length === 8
      ? `9${local}`
      : local.length === 9 && local.startsWith('9')
        ? local
        : local;

  const without9 = `55${ddd}${without9Local}`;
  const with9 = `55${ddd}${with9Local}`;

  return Array.from(new Set([without9, with9]));
}

export function buildCandidates(numeric: string) {
  const n = onlyDigits(numeric);
  if (!isBrazil(n)) return [n];

  return buildCandidatesBR(n);
}
