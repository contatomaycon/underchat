import {
  IUpsertMessage,
  IUpsertMessageKey,
} from '../interfaces/IUpsertMessage';
import { normalizeJid } from './normalizeJid';

function normalizeCandidate(value?: string | null): string | null {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }

  return normalizeJid(raw) ?? raw;
}

function isLidJid(jid: string): boolean {
  return jid.endsWith('@lid');
}

function resolveStableRemoteKey(
  key?: Pick<IUpsertMessageKey, 'remoteJid' | 'remoteJidAlt'> | null
): string | null {
  const remoteJid = normalizeCandidate(key?.remoteJid);
  const remoteJidAlt = normalizeCandidate(key?.remoteJidAlt);

  if (
    remoteJid &&
    isLidJid(remoteJid) &&
    remoteJidAlt &&
    !isLidJid(remoteJidAlt)
  ) {
    return remoteJidAlt;
  }

  if (remoteJidAlt && !isLidJid(remoteJidAlt)) {
    return remoteJidAlt;
  }

  return remoteJid ?? remoteJidAlt;
}

export function buildUpsertMessageKafkaKey(
  upsert: Pick<
    IUpsertMessage,
    'account_id' | 'worker_id' | 'message' | 'call_jid' | 'call_jid_alt'
  >,
  fallbackKey?: string | null
): string {
  const stableRemoteKey =
    resolveStableRemoteKey(upsert.message?.key) ??
    resolveStableRemoteKey({
      remoteJid: upsert.call_jid ?? undefined,
      remoteJidAlt: upsert.call_jid_alt ?? undefined,
    });

  if (stableRemoteKey) {
    return `${upsert.account_id}:${upsert.worker_id}:${stableRemoteKey}`;
  }

  const messageKey =
    fallbackKey?.trim() || upsert.message?.key?.id?.trim() || 'unknown-message';

  return `${upsert.account_id}:${messageKey}`;
}

export function buildUpsertMessageDlqKey(
  upsert: Pick<
    IUpsertMessage,
    'account_id' | 'worker_id' | 'message' | 'call_jid' | 'call_jid_alt'
  >,
  fallbackKey?: string | null
): string {
  const entityKey = buildUpsertMessageKafkaKey(upsert, fallbackKey);
  const messageId =
    upsert.message?.key?.id?.trim() || fallbackKey?.trim() || 'unknown-message';

  return `${entityKey}:${messageId}`;
}
