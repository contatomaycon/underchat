import { jidNormalizedUser } from '@whiskeysockets/baileys';

export function normalizePhoneToJid(
  phone: string | null | undefined,
  phoneDdi: string | null | undefined = '55'
): string | undefined {
  if (!phone) return undefined;

  const ddi = phoneDdi ?? '55';
  const phoneNumber = phone.replaceAll(/\D/g, '');

  if (!phoneNumber) return undefined;

  const fullNumber = `${ddi}${phoneNumber}`;
  const jid = `${fullNumber}@s.whatsapp.net`;

  try {
    return jidNormalizedUser(jid);
  } catch {
    return jid;
  }
}
