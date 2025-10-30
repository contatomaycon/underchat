import { WAMessageKey } from '@whiskeysockets/baileys';

export function remoteJid(m?: WAMessageKey | null) {
  return m?.remoteJid;
}
