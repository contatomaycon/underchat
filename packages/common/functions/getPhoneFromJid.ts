export function getPhoneFromJid(
  jid?: string | null,
  jidAlt?: string | null
): string | null {
  if (!jid && !jidAlt) {
    return null;
  }

  let jidToUse: string | null = null;

  if (jidAlt?.endsWith('@lid')) {
    jidToUse = jid || null;
  }

  if (jid?.endsWith('@lid')) {
    jidToUse = jidAlt || null;
  }

  if (!jidToUse) {
    jidToUse = jid || jidAlt || null;
  }

  if (!jidToUse || jidToUse.endsWith('@lid')) {
    return null;
  }

  return jidToUse.split('@')[0].replaceAll(/\D/g, '');
}
