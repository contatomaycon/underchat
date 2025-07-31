export function formatPhoneBR(number: string | number): string {
  const digits = String(number).replace(/\D/g, '');

  if (!digits.startsWith('55') || digits.length < 12) {
    return digits;
  }

  const ddi = '+55';
  const ddd = digits.slice(2, 4);
  const body = digits.slice(4);

  const prefixLength = body.length - 4;
  const prefix = body.slice(0, prefixLength);
  const suffix = body.slice(prefixLength);

  return `${ddi} (${ddd}) ${prefix}-${suffix}`;
}
