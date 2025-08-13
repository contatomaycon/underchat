import { WAMessage } from '@whiskeysockets/baileys';
import { IQuotedMessage } from '../interfaces/IChatMessage';
import { remoteJid } from './remoteJid';
import { remoteParticipantJid } from './remoteParticipantJid';

export function buildQuotedTextFromExtended(
  m: WAMessage
): IQuotedMessage | null {
  const ext = m.message?.extendedTextMessage;
  const ctx = ext?.contextInfo;

  if (!ctx?.stanzaId || !ctx?.quotedMessage || !m.key?.remoteJid) {
    return null;
  }

  const rJid = remoteJid(m?.key);
  const participant = remoteParticipantJid(m?.key);

  const text =
    ctx?.quotedMessage?.conversation ??
    ctx?.quotedMessage?.extendedTextMessage?.text ??
    '';

  const quoted: IQuotedMessage = {
    key: {
      remote_jid: rJid,
      from_me: m.key?.fromMe ?? false,
      id: ctx.stanzaId,
      participant,
    },
    message: text,
  };

  return quoted;
}
