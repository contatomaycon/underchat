export function truncateContactName(
  value: string | null | undefined,
  maxLength: number = 250
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  if (value.length <= maxLength) {
    return value;
  }

  return value.substring(0, maxLength);
}
