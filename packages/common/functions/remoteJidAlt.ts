export function remoteJidAlt(
  m?: { remoteJidAlt?: string | null } | null
): string | undefined {
  const value = m?.remoteJidAlt;

  return value === null ? undefined : value;
}
