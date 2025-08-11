import {
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  isJidUser,
  WAMessage,
} from '@whiskeysockets/baileys';
import { EChatKind } from '../enums/EChatKind';
import { normalizeJid } from './normalizeJid';
import { remoteJid } from './remoteJid';

export function isGroupMessage(m: WAMessage): boolean {
  const jid = normalizeJid(remoteJid(m.key));

  return isJidGroup(jid) || Boolean(m.key.participant);
}

export function getChatKind(m: WAMessage): EChatKind {
  const jid = normalizeJid(remoteJid(m.key));
  if (!jid) return EChatKind.unknown;

  if (isJidGroup(jid)) return EChatKind.group;
  if (isJidStatusBroadcast(jid)) return EChatKind.status;
  if (isJidBroadcast(jid)) return EChatKind.broadcast;
  if (isJidNewsletter(jid)) return EChatKind.newsletter;
  if (isJidUser(jid)) return EChatKind.user;

  return EChatKind.unknown;
}
