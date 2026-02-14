export function remoteJid(
  m?: { remoteJid?: string | null } | null
): string | undefined {
  const value = m?.remoteJid;

  return value === null ? undefined : value;
}
