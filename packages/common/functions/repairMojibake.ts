const MOJIBAKE_PATTERN =
  /(?:Ã[\u0080-\u00BF]|Â[\u0080-\u00BF]|â[\u0080-\u00BF]{1,2}|ð[\u0080-\u00BF]{1,3})/u;
const REPLACEMENT_CHARACTER = /\uFFFD/u;

export function isLikelyMojibake(value: string | null | undefined): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  if (!value) {
    return false;
  }

  return MOJIBAKE_PATTERN.test(value);
}

export function repairMojibake(value: string): string {
  return Buffer.from(value, 'latin1').toString('utf8');
}

export function repairMojibakeIfSafe(
  value: string | null | undefined
): string | null | undefined {
  if (typeof value !== 'string') {
    return value;
  }

  if (!isLikelyMojibake(value)) {
    return value;
  }

  const repairedValue = repairMojibake(value);

  if (repairedValue === value) {
    return value;
  }

  if (REPLACEMENT_CHARACTER.test(repairedValue)) {
    return value;
  }

  if (isLikelyMojibake(repairedValue)) {
    return value;
  }

  return repairedValue;
}
