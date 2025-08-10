import { WAMessage } from '@whiskeysockets/baileys';
import { EChatKind } from '../enums/EChatKind';

function isGroupJid(jid?: string | null): boolean {
  return !!jid && jid.endsWith('@g.us');
}

function isUserJid(jid?: string | null): boolean {
  return !!jid && jid.endsWith('@s.whatsapp.net');
}

function isStatusJid(jid?: string | null): boolean {
  return jid === 'status@broadcast';
}

function isBroadcastJid(jid?: string | null): boolean {
  return !!jid && jid.endsWith('@broadcast');
}

function isNewsletterJid(jid?: string | null): boolean {
  return !!jid && jid.endsWith('@newsletter');
}

export function isGroupMessage(m: WAMessage): boolean {
  const jid = m.key?.remoteJid ?? undefined;
  return isGroupJid(jid) || Boolean(m.key.participant);
}

export function getChatKind(m: WAMessage): EChatKind {
  const jid = m.key?.remoteJid ?? undefined;
  if (isGroupJid(jid)) return EChatKind.group;
  if (isUserJid(jid)) return EChatKind.user;
  if (isStatusJid(jid)) return EChatKind.status;
  if (isBroadcastJid(jid)) return EChatKind.broadcast;
  if (isNewsletterJid(jid)) return EChatKind.newsletter;

  return EChatKind.unknown;
}
