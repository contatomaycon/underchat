import type { Client, Message } from '@wwebjs/whatsapp-web.js';

export interface IWwebjsQuotedKeyInput {
  id: string;
  remote_jid?: string | null;
  remote_jid_alt?: string | null;
  from_me?: boolean | null;
}

interface ParsedSerializedMessageId {
  fromMe: boolean;
  remoteJid: string;
  stanzaId: string;
}

function getNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseSerializedMessageId(
  value: string
): ParsedSerializedMessageId | null {
  const firstSeparator = value.indexOf('_');
  const lastSeparator = value.lastIndexOf('_');

  if (firstSeparator <= 0 || lastSeparator <= firstSeparator) {
    return null;
  }

  const fromMeRaw = value.slice(0, firstSeparator);
  if (fromMeRaw !== 'true' && fromMeRaw !== 'false') {
    return null;
  }

  const remoteJid = getNonEmptyString(
    value.slice(firstSeparator + 1, lastSeparator)
  );
  const stanzaId = getNonEmptyString(value.slice(lastSeparator + 1));

  if (!remoteJid || !stanzaId) {
    return null;
  }

  return {
    fromMe: fromMeRaw === 'true',
    remoteJid,
    stanzaId,
  };
}

function buildSerializedMessageId(
  fromMe: boolean,
  remoteJid: string,
  stanzaId: string
): string {
  return `${fromMe}_${remoteJid}_${stanzaId}`;
}

function getSerializedMessageIdFromMessage(
  message: Message | null
): string | undefined {
  if (!message?.id) return undefined;

  if (
    typeof message.id === 'object' &&
    message.id !== null &&
    '_serialized' in message.id
  ) {
    return getNonEmptyString(
      (message.id as { _serialized?: unknown })._serialized
    );
  }

  return getNonEmptyString(String(message.id));
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const unique = new Set<string>();

  for (const value of values) {
    const normalized = getNonEmptyString(value);
    if (normalized) {
      unique.add(normalized);
    }
  }

  return Array.from(unique);
}

function buildQuotedMessageIdCandidates(
  chatJid: string,
  key: IWwebjsQuotedKeyInput
): string[] {
  const rawId = getNonEmptyString(key.id);
  if (!rawId) return [];

  const parsed = parseSerializedMessageId(rawId);
  const stanzaId = parsed?.stanzaId ?? rawId;
  const fromMe =
    typeof key.from_me === 'boolean' ? key.from_me : parsed?.fromMe;
  const fromMeCandidates =
    fromMe === undefined ? [false, true] : [fromMe as boolean];

  const remoteCandidates = uniqueStrings([
    chatJid,
    key.remote_jid ?? undefined,
    key.remote_jid_alt ?? undefined,
    parsed?.remoteJid,
  ]);

  const candidates = new Set<string>();

  if (parsed) {
    candidates.add(rawId);
  }

  for (const remoteJid of remoteCandidates) {
    for (const fromMeCandidate of fromMeCandidates) {
      candidates.add(
        buildSerializedMessageId(fromMeCandidate, remoteJid, stanzaId)
      );
    }
  }

  candidates.add(rawId);

  return Array.from(candidates);
}

export async function resolveQuotedMessageId(
  client: Pick<Client, 'getMessageById'>,
  chatJid: string,
  key: IWwebjsQuotedKeyInput
): Promise<string | undefined> {
  const candidates = buildQuotedMessageIdCandidates(chatJid, key);

  for (const candidate of candidates) {
    try {
      const message = await client.getMessageById(candidate);
      const serialized = getSerializedMessageIdFromMessage(message);
      if (serialized) {
        return serialized;
      }
    } catch {}
  }

  const rawId = getNonEmptyString(key.id);
  if (!rawId) {
    return undefined;
  }

  return parseSerializedMessageId(rawId) ? rawId : undefined;
}
