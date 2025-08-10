import { jidNormalizedUser } from '@whiskeysockets/baileys';
import { onlyDigits } from './onlyDigits';

export function toJid(raw: string) {
  const n = onlyDigits(raw);

  return jidNormalizedUser(`${n}@s.whatsapp.net`);
}
