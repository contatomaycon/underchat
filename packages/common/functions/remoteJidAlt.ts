import { WAMessageKey } from '@whiskeysockets/baileys';

export function remoteJidAlt(m?: WAMessageKey | null) {
  return m?.remoteJidAlt;
}
