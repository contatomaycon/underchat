export interface IParsedSerializedMessageId {
  fromMe: boolean;
  remoteJid: string;
  stanzaId: string;
}

export function parseSerializedMessageId(
  value?: string | null
): IParsedSerializedMessageId | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const firstSeparator = trimmed.indexOf('_');
  const lastSeparator = trimmed.lastIndexOf('_');

  if (firstSeparator <= 0 || lastSeparator <= firstSeparator) {
    return null;
  }

  const fromMeRaw = trimmed.slice(0, firstSeparator);
  if (fromMeRaw !== 'true' && fromMeRaw !== 'false') {
    return null;
  }

  const remoteJid = trimmed.slice(firstSeparator + 1, lastSeparator).trim();
  const stanzaId = trimmed.slice(lastSeparator + 1).trim();

  if (!remoteJid || !stanzaId) {
    return null;
  }

  return {
    fromMe: fromMeRaw === 'true',
    remoteJid,
    stanzaId,
  };
}
