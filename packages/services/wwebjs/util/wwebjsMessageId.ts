type UnknownRecord = Record<string, unknown>;

export interface IExtractWwebjsMessageIdOptions {
  allowStanzaIdFallback?: boolean;
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object'
    ? (value as UnknownRecord)
    : undefined;
}

function getNonEmptyIdString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized || normalized === '[object Object]') {
    return undefined;
  }

  return normalized;
}

function getSerializedValue(value: UnknownRecord): string | undefined {
  return (
    getNonEmptyIdString(value._serialized) ?? getNonEmptyIdString(value.$1)
  );
}

function getJidLike(value: unknown): string | undefined {
  const direct = getNonEmptyIdString(value);
  if (direct) {
    return direct;
  }

  const objectValue = asRecord(value);
  if (!objectValue) {
    return undefined;
  }

  const serialized = getSerializedValue(objectValue);
  if (serialized) {
    return serialized;
  }

  const user = getNonEmptyIdString(objectValue.user);
  const server = getNonEmptyIdString(objectValue.server);
  if (user && server) {
    return `${user}@${server.replace(/^@/, '')}`;
  }

  return getNonEmptyIdString(objectValue.id);
}

function getBooleanLike(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }

  return undefined;
}

function extractFromIdRecord(
  idValue: UnknownRecord,
  messageValue: UnknownRecord | undefined,
  options: IExtractWwebjsMessageIdOptions
): string | undefined {
  const serialized = getSerializedValue(idValue);
  if (serialized) {
    return serialized;
  }

  const stanzaId =
    getNonEmptyIdString(idValue.id) ??
    getNonEmptyIdString(idValue.ID) ??
    getNonEmptyIdString(idValue.stanzaId) ??
    getNonEmptyIdString(idValue.stanzaID);
  if (!stanzaId) {
    return undefined;
  }

  const remoteJid =
    getJidLike(idValue.remoteJid) ??
    getJidLike(idValue.remote_jid) ??
    getJidLike(idValue.remote) ??
    getJidLike(idValue.remoteJidAlt) ??
    getJidLike(idValue.remote_jid_alt) ??
    getJidLike(messageValue?.remoteJid) ??
    getJidLike(messageValue?.remote_jid) ??
    getJidLike(messageValue?.remote) ??
    getJidLike(messageValue?.remoteJidAlt) ??
    getJidLike(messageValue?.remote_jid_alt);
  const fromMe =
    getBooleanLike(idValue.fromMe) ??
    getBooleanLike(idValue.from_me) ??
    getBooleanLike(messageValue?.fromMe) ??
    getBooleanLike(messageValue?.from_me);
  const participant =
    getJidLike(idValue.participant) ??
    getJidLike(idValue.participantAlt) ??
    getJidLike(idValue.participant_alt) ??
    getJidLike(messageValue?.participant) ??
    getJidLike(messageValue?.participantAlt) ??
    getJidLike(messageValue?.participant_alt);

  if (remoteJid && fromMe !== undefined) {
    return participant
      ? `${fromMe}_${remoteJid}_${stanzaId}_${participant}`
      : `${fromMe}_${remoteJid}_${stanzaId}`;
  }

  return options.allowStanzaIdFallback ? stanzaId : undefined;
}

/**
 * Extracts the canonical WWebJS message id from either a Message instance,
 * an id object, or an already serialized string.
 */
export function extractWwebjsMessageId(
  value: unknown,
  options: IExtractWwebjsMessageIdOptions = {}
): string | undefined {
  const direct = getNonEmptyIdString(value);
  if (direct) {
    return direct;
  }

  const objectValue = asRecord(value);
  if (!objectValue) {
    return undefined;
  }

  const serialized = getSerializedValue(objectValue);
  if (serialized) {
    return serialized;
  }

  const nestedId = asRecord(objectValue.id);
  if (nestedId) {
    return extractFromIdRecord(nestedId, objectValue, options);
  }

  const extracted = extractFromIdRecord(objectValue, undefined, options);
  if (extracted) {
    return extracted;
  }

  // A Message may expose its id directly as a string. This is different from
  // an incomplete nested id object (`message.id.id`), which is only accepted
  // when allowStanzaIdFallback is explicit.
  return getNonEmptyIdString(objectValue.id);
}
