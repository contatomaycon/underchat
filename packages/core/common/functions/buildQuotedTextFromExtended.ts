import { WAMessage } from '@whiskeysockets/baileys';
import { IQuotedMessage } from '../interfaces/IChatMessage';
import { remoteJid } from './remoteJid';
import { remoteParticipantJid } from './remoteParticipantJid';

export function buildQuotedTextFromExtended(
  m: WAMessage
): IQuotedMessage | null {
  const ext = m?.message?.extendedTextMessage;
  const ctx = ext?.contextInfo;

  if (!ctx?.stanzaId || !ctx?.quotedMessage || !m?.key?.remoteJid) {
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
      remote_jid_alt: m.key?.remoteJidAlt ?? undefined,
      from_me: m.key?.fromMe ?? false,
      id: ctx.stanzaId,
      participant,
      participant_alt: m.key?.participantAlt ?? undefined,
      addressing_mode: m.key?.addressingMode ?? undefined,
    },
    message: text,
  };

  return quoted;
}
