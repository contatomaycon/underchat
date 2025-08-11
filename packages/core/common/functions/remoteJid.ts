import { WAMessageKey } from '@whiskeysockets/baileys';

export function remoteJid(m?: WAMessageKey) {
  return m?.senderPn ?? m?.remoteJid;
}
