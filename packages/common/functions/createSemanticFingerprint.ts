import { createHash } from 'node:crypto';

function typedFingerprintValue(value: unknown): readonly unknown[] {
  if (value === undefined) {
    return ['undefined'];
  }
  if (value === null) {
    return ['null'];
  }
  return [typeof value, value];
}

/**
 * Creates a bounded, non-reversible fingerprint from an ordered semantic
 * schema. Runtime types are tagged so an absent field cannot collide with an
 * explicit null or a string sentinel.
 */
export function createSemanticFingerprint(
  namespace: string,
  values: readonly unknown[]
): string {
  const encoded = JSON.stringify([
    namespace,
    ...values.map(typedFingerprintValue),
  ]);
  return createHash('sha256').update(encoded).digest('hex');
}
