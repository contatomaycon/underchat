import { IChatMessage } from '../interfaces/IChatMessage';

export function selectJidChat(data: IChatMessage): string | null {
  const jid = data.message_key?.remote_jid;
  const jidAlt = data.message_key?.remote_jid_alt;

  if (!jid && !jidAlt) {
    return null;
  }

  let jidToUse: string | null = null;

  if (jidAlt?.endsWith('@lid')) {
    jidToUse = jid || null;
  }

  if (jid?.endsWith('@lid')) {
    jidToUse = jidAlt || null;
  }

  if (!jidToUse) {
    jidToUse = jid || jidAlt || null;
  }

  return jidToUse;
}
