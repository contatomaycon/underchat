export interface AliasedIntegerEnvironmentOptions {
  readonly key: string;
  readonly legacyKey: string;
  readonly fallback: number;
  readonly minimum: number;
  readonly maximum: number;
}

const parseIntegerEnvironment = (
  raw: string,
  options: Pick<AliasedIntegerEnvironmentOptions, 'key' | 'minimum' | 'maximum'>
): number => {
  const parsed = Number(raw.trim());
  if (
    raw.trim() === '' ||
    !Number.isInteger(parsed) ||
    parsed < options.minimum ||
    parsed > options.maximum
  ) {
    throw new Error(
      `${options.key} must be an integer between ${options.minimum} and ${options.maximum}`
    );
  }
  return parsed;
};

const readOptionalIntegerEnvironment = (
  key: string,
  options: Pick<AliasedIntegerEnvironmentOptions, 'minimum' | 'maximum'>
): number | undefined => {
  const raw = process.env[key];
  return raw === undefined
    ? undefined
    : parseIntegerEnvironment(raw, { key, ...options });
};

/** Reads a preferred integer env and a backwards-compatible rollout alias. */
export const readAliasedIntegerEnvironment = (
  options: AliasedIntegerEnvironmentOptions
): number => {
  const range = {
    minimum: options.minimum,
    maximum: options.maximum,
  };
  const preferred = readOptionalIntegerEnvironment(options.key, range);
  const legacy = readOptionalIntegerEnvironment(options.legacyKey, range);
  if (preferred !== undefined && legacy !== undefined && preferred !== legacy) {
    throw new Error(
      `${options.key} and ${options.legacyKey} must match when both are defined`
    );
  }
  return preferred ?? legacy ?? options.fallback;
};
