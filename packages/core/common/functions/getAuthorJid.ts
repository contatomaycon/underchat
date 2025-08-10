import { WAMessage, WASocket } from '@whiskeysockets/baileys';

function isGroupJid(jid: string | undefined) {
  return !!jid && jid.endsWith('@g.us');
}

export function isGroupMessage(m: WAMessage): boolean {
  const jid: string | undefined = m.key?.remoteJid ?? undefined;

  return isGroupJid(jid) || Boolean(m.key.participant);
}

export function getAuthorJid(m: WAMessage, sock?: WASocket) {
  if (isGroupMessage(m)) {
    if (m.key.participant) return m.key.participant;
    if (m.key.fromMe && sock?.user?.id) return sock.user.id;
  }

  return m.key.remoteJid;
}
