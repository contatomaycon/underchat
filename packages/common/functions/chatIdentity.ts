import { buildCandidates } from './buildCandidatesBR';
import { getPhoneFromJid } from './getPhoneFromJid';
import { normalizeJid } from './normalizeJid';
import { onlyDigits } from './onlyDigits';

export interface ChatIdentityInput {
  phone?: string | null;
  remoteJid?: string | null;
  remoteJidAlt?: string | null;
}

export interface ChatIdentity {
  phoneCandidates: string[];
  jidCandidates: string[];
  remoteJid?: string;
  remoteJidAlt?: string;
  primaryKey: string | null;
}

interface MessageKeyLike {
  remote_jid?: string | null;
  remote_jid_alt?: string | null;
}

function uniqueStable(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function normalizeJidCandidate(value?: string | null): string | undefined {
  const raw = value?.trim();
  if (!raw) {
    return undefined;
  }

  return normalizeJid(raw) ?? raw;
}

function isLidJid(value: string): boolean {
  return value.endsWith('@lid');
}

function buildJidAliases(value?: string | null): string[] {
  const normalized = normalizeJidCandidate(value);
  if (!normalized) {
    return [];
  }

  const aliases = [normalized];
  if (normalized.endsWith('@s.whatsapp.net')) {
    aliases.push(normalized.replace(/@s\.whatsapp\.net$/, '@c.us'));
  }
  if (normalized.endsWith('@c.us')) {
    aliases.push(normalized.replace(/@c\.us$/, '@s.whatsapp.net'));
  }

  return uniqueStable(aliases);
}

function buildPhoneCandidates(value?: string | null): string[] {
  const digits = onlyDigits(value ?? '');
  if (!digits) {
    return [];
  }

  return uniqueStable(buildCandidates(digits, { order: 'input_first' }));
}

function buildPhoneJidAliases(phoneCandidates: string[]): string[] {
  const aliases: string[] = [];

  for (const phone of phoneCandidates) {
    aliases.push(`${phone}@s.whatsapp.net`);
    aliases.push(`${phone}@c.us`);
  }

  return uniqueStable(aliases);
}

export function normalizeChatIdentity(input: ChatIdentityInput): ChatIdentity {
  const remoteJid = normalizeJidCandidate(input.remoteJid);
  const remoteJidAlt = normalizeJidCandidate(input.remoteJidAlt);
  const phoneFromJid = getPhoneFromJid(remoteJid, remoteJidAlt);
  const phoneCandidates = uniqueStable([
    ...buildPhoneCandidates(input.phone),
    ...buildPhoneCandidates(phoneFromJid),
  ]);
  const jidCandidates = uniqueStable([
    ...buildJidAliases(remoteJid),
    ...buildJidAliases(remoteJidAlt),
    ...buildPhoneJidAliases(phoneCandidates),
  ]);

  const nonLidJid = jidCandidates.find((candidate) => !isLidJid(candidate));
  const primaryKey = phoneCandidates[0]
    ? `phone:${phoneCandidates[0]}`
    : nonLidJid
      ? `jid:${nonLidJid}`
      : jidCandidates[0]
        ? `jid:${jidCandidates[0]}`
        : null;

  return {
    phoneCandidates,
    jidCandidates,
    remoteJid,
    remoteJidAlt,
    primaryKey,
  };
}

export function buildChatIdentityLockKey(
  accountId: string,
  workerId: string,
  input: ChatIdentityInput
): string {
  const identity = normalizeChatIdentity(input);
  const primary = identity.primaryKey ?? 'unknown';

  return ['chat-create', accountId, workerId, encodeURIComponent(primary)].join(
    ':'
  );
}

export function buildMissingChatMessageKeyPatch(
  current: MessageKeyLike | null | undefined,
  input: ChatIdentityInput
): MessageKeyLike | null {
  const identity = normalizeChatIdentity(input);
  const inputRemote = identity.remoteJid;
  const inputAlt = identity.remoteJidAlt;

  if (!inputRemote && !inputAlt) {
    return null;
  }

  const currentRemote = normalizeJidCandidate(current?.remote_jid);
  const currentAlt = normalizeJidCandidate(current?.remote_jid_alt);
  const patch: MessageKeyLike = {};

  if (!currentRemote && inputRemote && inputRemote !== currentAlt) {
    patch.remote_jid = inputRemote;
  }

  const effectiveRemote = currentRemote ?? patch.remote_jid;
  if (!currentAlt) {
    const nextAlt = [inputAlt, inputRemote].find(
      (candidate): candidate is string =>
        Boolean(candidate) && candidate !== effectiveRemote
    );
    if (nextAlt) {
      patch.remote_jid_alt = nextAlt;
    }
  }

  if (patch.remote_jid === undefined && patch.remote_jid_alt === undefined) {
    return null;
  }

  return patch;
}
