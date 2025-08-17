export function getPhoneNumber(jid: string | undefined): string | undefined {
  if (!jid) return jid;

  const withoutSuffix = jid.includes(':')
    ? jid.split(':')[0]
    : jid.split('@')[0];

  return withoutSuffix.replace(/\D/g, '');
}
