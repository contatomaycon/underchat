import { WAMessageKey } from '@whiskeysockets/baileys';

export function remoteParticipantJid(m?: WAMessageKey) {
  return m?.participantPn ?? m?.participant;
}
