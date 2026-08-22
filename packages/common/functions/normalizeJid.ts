type UserJidNormalizer = (jid: string) => string;

export type JidNormalizer = (jid?: string | null) => string | undefined;

// Mirrors Baileys' jidDecode + jidEncode normalization without loading its ESM
// entrypoint in this provider-neutral, synchronous utility.
function normalizeUserJid(jid: string): string {
  const separatorIndex = jid.indexOf('@');
  if (separatorIndex < 0) return '';

  const userWithDevice = jid.slice(0, separatorIndex);
  const server = jid.slice(separatorIndex + 1);
  const [userWithAgent] = userWithDevice.split(':');
  const [user] = userWithAgent.split('_');

  return `${user}@${server === 'c.us' ? 's.whatsapp.net' : server}`;
}

export function createJidNormalizer(
  normalizeUser: UserJidNormalizer
): JidNormalizer {
  return (jid?: string | null): string | undefined => {
    if (!jid) return undefined;
    const raw = jid.trim();

    let out = raw;
    try {
      out = normalizeUser(raw);
    } catch {
      // Preserve the raw-value fallback used before the ESM boundary was removed.
    }

    if (out.endsWith('@c.us')) {
      out = out.replace(/@c\.us$/, '@s.whatsapp.net');
    }

    return out;
  };
}

const defaultNormalizeJid = createJidNormalizer(normalizeUserJid);

export function normalizeJid(jid?: string | null): string | undefined {
  return defaultNormalizeJid(jid);
}
