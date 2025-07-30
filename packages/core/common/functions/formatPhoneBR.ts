export function formatPhoneBR(number: string | number): string {
  const digits = String(number).replace(/\D/g, '');

  if (!digits.startsWith('55') || digits.length < 12) return digits;

  const ddi = '+55';
  const ddd = digits.slice(2, 4);
  const body = digits.slice(4);

  const part1 =
    body.length === 9
      ? body.slice(0, 1) + ' ' + body.slice(1, 5)
      : body.slice(0, 4);
  const part2 = body.length === 9 ? body.slice(5) : body.slice(4);

  return `${ddi} (${ddd}) ${part1}${part2}`;
}
