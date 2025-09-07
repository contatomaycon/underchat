import { jidNormalizedUser } from '@whiskeysockets/baileys';

export function normalizeJid(jid?: string | null): string | undefined {
  if (!jid) return undefined;
  const raw = jid.trim();

  let out = raw;
  try {
    out = jidNormalizedUser(raw);
  } catch {}

  if (out.endsWith('@c.us')) {
    out = out.replace(/@c\.us$/, '@s.whatsapp.net');
  }

  return out;
}
