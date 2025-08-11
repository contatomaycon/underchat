import { WAMessage, WASocket } from '@whiskeysockets/baileys';
import { remoteJid } from './remoteJid';

export async function getSenderPhotoUrl(
  sock: WASocket,
  m: WAMessage,
  quality: 'image' | 'preview' = 'image'
): Promise<string | undefined> {
  const sender = remoteJid(m?.key);
  if (!sender) return undefined;

  try {
    return await sock.profilePictureUrl(sender, quality);
  } catch {
    return undefined;
  }
}
