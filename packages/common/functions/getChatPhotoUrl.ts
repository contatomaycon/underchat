import { WAMessage, WASocket } from '@whiskeysockets/baileys';
import { remoteJid } from './remoteJid';

export async function getChatPhotoUrl(
  sock: WASocket,
  m: WAMessage,
  quality: 'image' | 'preview' = 'image'
): Promise<string | undefined> {
  const chatJid = remoteJid(m?.key);
  if (!chatJid) return undefined;

  try {
    return await sock.profilePictureUrl(chatJid, quality);
  } catch {
    return undefined;
  }
}
