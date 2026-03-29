import { IChatMessage } from '../interfaces/IChatMessage';

export function selectJidChatWwebjs(data: IChatMessage): string | null {
  const jid = data.message_key?.remote_jid?.trim();
  const jidAlt = data.message_key?.remote_jid_alt?.trim();

  if (!jid && !jidAlt) {
    return null;
  }

  if (jid?.endsWith('@lid')) {
    return jid;
  }

  if (jidAlt?.endsWith('@lid')) {
    return jidAlt;
  }

  return jid || jidAlt || null;
}
