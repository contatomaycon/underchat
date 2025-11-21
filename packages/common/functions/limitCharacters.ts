export function limitCharacters(
  maxLength: number,
  text?: string | null,
  suffix: string | null = null
): string {
  if (!text || text.length <= maxLength) {
    return text ?? '';
  }

  const suffixLength = suffix?.length ?? 0;
  const truncatedLength = maxLength - suffixLength;
  const base = text.slice(0, truncatedLength > 0 ? truncatedLength : maxLength);

  return suffix ? base + suffix : base;
}
