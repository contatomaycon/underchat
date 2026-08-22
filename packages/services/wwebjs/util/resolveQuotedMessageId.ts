import type { Client, Message } from '@wwebjs/whatsapp-web.js';
import { extractWwebjsMessageId } from './wwebjsMessageId';
import { isProviderAuxiliaryInvocationFenceError } from '@core/common/functions/providerAuxiliaryInvocation';

export interface IWwebjsQuotedKeyInput {
  id: string;
  remote_jid?: string | null;
  remote_jid_alt?: string | null;
  from_me?: boolean | null;
  participant?: string | null;
  participant_alt?: string | null;
}

export type WwebjsProviderLookupInvoker = <T>(
  invoke: () => Promise<T>
) => Promise<T>;

interface ParsedSerializedMessageId {
  fromMe: boolean;
  remoteJid: string;
  stanzaId: string;
  participant?: string;
}

function getNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseSerializedMessageId(
  value: string
): ParsedSerializedMessageId | null {
  const normalized = getNonEmptyString(value);
  if (!normalized) {
    return null;
  }

  const parts = normalized.split('_');
  if (parts.length !== 3 && parts.length !== 4) {
    return null;
  }

  const [fromMeRaw, remoteJidRaw, stanzaIdRaw, participantRaw] = parts;
  if (fromMeRaw !== 'true' && fromMeRaw !== 'false') {
    return null;
  }

  const remoteJid = getNonEmptyString(remoteJidRaw);
  const stanzaId = getNonEmptyString(stanzaIdRaw);
  const participant = getNonEmptyString(participantRaw);

  if (!remoteJid || !stanzaId) {
    return null;
  }

  return {
    fromMe: fromMeRaw === 'true',
    remoteJid,
    stanzaId,
    ...(participant ? { participant } : {}),
  };
}

function buildSerializedMessageId(
  fromMe: boolean,
  remoteJid: string,
  stanzaId: string,
  participant?: string
): string {
  return participant
    ? `${fromMe}_${remoteJid}_${stanzaId}_${participant}`
    : `${fromMe}_${remoteJid}_${stanzaId}`;
}

function getSerializedMessageIdFromMessage(
  message: Message | null | undefined | unknown
): string | undefined {
  return extractWwebjsMessageId(message);
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

function buildJidAliases(jid: string): string[] {
  const normalized = getNonEmptyString(jid);
  if (!normalized) {
    return [];
  }

  const aliases = new Set<string>([normalized]);
  if (normalized.endsWith('@s.whatsapp.net')) {
    aliases.add(normalized.replace(/@s\.whatsapp\.net$/, '@c.us'));
  }

  if (normalized.endsWith('@c.us')) {
    aliases.add(normalized.replace(/@c\.us$/, '@s.whatsapp.net'));
  }

  return Array.from(aliases);
}

function buildParticipantAliases(participant: string): string[] {
  const normalized = getNonEmptyString(participant);
  if (!normalized) {
    return [];
  }

  const aliases = new Set<string>([normalized, ...buildJidAliases(normalized)]);
  return Array.from(aliases);
}

function buildFromMeCandidates(
  key: IWwebjsQuotedKeyInput,
  parsed: ParsedSerializedMessageId | null
): boolean[] {
  if (typeof key.from_me === 'boolean') {
    return [key.from_me];
  }

  if (typeof parsed?.fromMe === 'boolean') {
    return [parsed.fromMe];
  }

  return [false, true];
}

function buildRemoteCandidates(
  chatJid: string,
  key: IWwebjsQuotedKeyInput,
  parsed: ParsedSerializedMessageId | null
): string[] {
  const rawCandidates = uniqueStrings([
    chatJid,
    key.remote_jid ?? undefined,
    key.remote_jid_alt ?? undefined,
    parsed?.remoteJid,
  ]);

  const remoteCandidates = new Set<string>();
  for (const candidate of rawCandidates) {
    for (const alias of buildJidAliases(candidate)) {
      remoteCandidates.add(alias);
    }
  }

  return Array.from(remoteCandidates);
}

function buildParticipantCandidates(
  key: IWwebjsQuotedKeyInput,
  parsed: ParsedSerializedMessageId | null
): string[] {
  const rawCandidates = uniqueStrings([
    key.participant ?? undefined,
    key.participant_alt ?? undefined,
    parsed?.participant,
  ]);

  const participantCandidates = new Set<string>();
  for (const candidate of rawCandidates) {
    for (const alias of buildParticipantAliases(candidate)) {
      participantCandidates.add(alias);
    }
  }

  return Array.from(participantCandidates);
}

function extractStanzaIdFromMessage(message: unknown): string | undefined {
  const serialized = getSerializedMessageIdFromMessage(message);
  const parsed = serialized ? parseSerializedMessageId(serialized) : null;
  if (parsed?.stanzaId) {
    return parsed.stanzaId;
  }

  if (!message || typeof message !== 'object') {
    return undefined;
  }

  const idValue = (message as { id?: unknown }).id;
  if (
    typeof idValue === 'object' &&
    idValue !== null &&
    'id' in (idValue as object)
  ) {
    return getNonEmptyString((idValue as { id?: unknown }).id);
  }

  return undefined;
}

function extractFromMeFromMessage(message: unknown): boolean | undefined {
  const serialized = getSerializedMessageIdFromMessage(message);
  const parsed = serialized ? parseSerializedMessageId(serialized) : null;
  if (typeof parsed?.fromMe === 'boolean') {
    return parsed.fromMe;
  }

  if (!message || typeof message !== 'object') {
    return undefined;
  }

  const directFromMe = (message as { fromMe?: unknown }).fromMe;
  if (typeof directFromMe === 'boolean') {
    return directFromMe;
  }

  const idValue = (message as { id?: unknown }).id;
  if (
    typeof idValue === 'object' &&
    idValue !== null &&
    'fromMe' in (idValue as object)
  ) {
    const idFromMe = (idValue as { fromMe?: unknown }).fromMe;
    if (typeof idFromMe === 'boolean') {
      return idFromMe;
    }
  }

  return undefined;
}

function extractParticipantFromMessage(message: unknown): string | undefined {
  const serialized = getSerializedMessageIdFromMessage(message);
  const parsed = serialized ? parseSerializedMessageId(serialized) : null;
  if (parsed?.participant) {
    return parsed.participant;
  }

  if (!message || typeof message !== 'object') {
    return undefined;
  }

  const author = getNonEmptyString((message as { author?: unknown }).author);
  if (author) {
    return author;
  }

  const idValue = (message as { id?: unknown }).id;
  if (
    typeof idValue === 'object' &&
    idValue !== null &&
    'participant' in (idValue as object)
  ) {
    const participant = (idValue as { participant?: unknown }).participant;
    if (typeof participant === 'string') {
      return getNonEmptyString(participant);
    }
    if (
      typeof participant === 'object' &&
      participant !== null &&
      '_serialized' in (participant as object)
    ) {
      return getNonEmptyString(
        (participant as { _serialized?: unknown })._serialized
      );
    }
  }

  return undefined;
}

function buildQuotedMessageIdCandidates(
  chatJid: string,
  key: IWwebjsQuotedKeyInput
): string[] {
  const rawId = getNonEmptyString(key.id);
  if (!rawId) return [];

  const parsed = parseSerializedMessageId(rawId);
  const stanzaId = parsed?.stanzaId ?? rawId;
  const fromMeCandidates = buildFromMeCandidates(key, parsed);
  const remoteCandidates = buildRemoteCandidates(chatJid, key, parsed);
  const participantCandidates = buildParticipantCandidates(key, parsed);

  const candidates = new Set<string>();

  if (parsed) {
    candidates.add(rawId);
  }

  for (const remoteJid of remoteCandidates) {
    for (const fromMeCandidate of fromMeCandidates) {
      for (const participant of participantCandidates) {
        candidates.add(
          buildSerializedMessageId(
            fromMeCandidate,
            remoteJid,
            stanzaId,
            participant
          )
        );
      }
      candidates.add(
        buildSerializedMessageId(fromMeCandidate, remoteJid, stanzaId)
      );
    }
  }

  candidates.add(rawId);

  return Array.from(candidates);
}

async function resolveByChatScan(
  client: Pick<Client, 'getChatById'>,
  chatJid: string,
  key: IWwebjsQuotedKeyInput,
  candidates: string[],
  invokeLookup?: WwebjsProviderLookupInvoker
): Promise<string | undefined> {
  const rawId = getNonEmptyString(key.id);
  if (!rawId) {
    return undefined;
  }

  const parsed = parseSerializedMessageId(rawId);
  const stanzaId = parsed?.stanzaId ?? rawId;
  if (!stanzaId) {
    return undefined;
  }

  const remoteCandidates = buildRemoteCandidates(chatJid, key, parsed);
  const fromMeCandidates = new Set(buildFromMeCandidates(key, parsed));
  const participantCandidates = new Set(
    buildParticipantCandidates(key, parsed)
  );
  const serializedCandidates = new Set(candidates);
  serializedCandidates.add(rawId);

  for (const remoteCandidate of remoteCandidates) {
    let chatMessages: unknown[] = [];

    try {
      const chat = await (invokeLookup
        ? invokeLookup(() => client.getChatById(remoteCandidate))
        : client.getChatById(remoteCandidate));
      if (
        !chat ||
        typeof (chat as { fetchMessages?: unknown }).fetchMessages !==
          'function'
      ) {
        continue;
      }

      const fetchMessages = (
        chat as {
          fetchMessages: (searchOptions: {
            limit?: number;
          }) => Promise<unknown[]>;
        }
      ).fetchMessages.bind(chat);
      chatMessages = await (invokeLookup
        ? invokeLookup(() => fetchMessages({ limit: 100 }))
        : fetchMessages({ limit: 100 }));
    } catch (error) {
      if (isProviderAuxiliaryInvocationFenceError(error)) {
        throw error;
      }
      continue;
    }

    if (!Array.isArray(chatMessages) || chatMessages.length === 0) {
      continue;
    }

    for (const chatMessage of chatMessages) {
      const serialized = getSerializedMessageIdFromMessage(chatMessage);
      if (serialized && serializedCandidates.has(serialized)) {
        return serialized;
      }

      const messageStanzaId = extractStanzaIdFromMessage(chatMessage);
      if (!messageStanzaId || messageStanzaId !== stanzaId) {
        continue;
      }

      const messageFromMe = extractFromMeFromMessage(chatMessage);
      if (messageFromMe !== undefined && !fromMeCandidates.has(messageFromMe)) {
        continue;
      }

      if (participantCandidates.size > 0) {
        const participant = extractParticipantFromMessage(chatMessage);
        if (!participant) {
          continue;
        }

        const participantAliases = buildParticipantAliases(participant);
        const matchesParticipant = participantAliases.some((alias) =>
          participantCandidates.has(alias)
        );
        if (!matchesParticipant) {
          continue;
        }
      }

      if (serialized) {
        return serialized;
      }
    }
  }

  return undefined;
}

export async function resolveQuotedMessageId(
  client: Pick<Client, 'getMessageById' | 'getChatById'>,
  chatJid: string,
  key: IWwebjsQuotedKeyInput,
  invokeLookup?: WwebjsProviderLookupInvoker
): Promise<string | undefined> {
  const candidates = buildQuotedMessageIdCandidates(chatJid, key);

  for (const candidate of candidates) {
    try {
      const message = await (invokeLookup
        ? invokeLookup(() => client.getMessageById(candidate))
        : client.getMessageById(candidate));
      const serialized = getSerializedMessageIdFromMessage(message);
      if (serialized) {
        return serialized;
      }
    } catch (error) {
      if (isProviderAuxiliaryInvocationFenceError(error)) {
        throw error;
      }
    }
  }

  return resolveByChatScan(client, chatJid, key, candidates, invokeLookup);
}
