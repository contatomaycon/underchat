export function formatBadgeCount(
  value: number | null | undefined,
  options?: {
    cap?: number;
    hideZero?: boolean;
  }
): string | undefined {
  const cap = options?.cap ?? 999;
  const hideZero = options?.hideZero ?? false;
  const numericValue =
    typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const safeValue = Math.max(0, Math.trunc(numericValue));

  if (hideZero && safeValue <= 0) {
    return undefined;
  }

  if (safeValue > cap) {
    return `${cap}+`;
  }

  return String(safeValue);
}
