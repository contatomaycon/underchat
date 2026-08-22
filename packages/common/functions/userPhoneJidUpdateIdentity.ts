import { createHash } from 'node:crypto';

interface IUserPhoneJidUpdateIdentityInput {
  account_id?: string | null;
  worker_id?: string | null;
  operation_id?: string | null;
  user_id?: string | null;
  phone_jid?: string | null;
}

function normalize(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function canonicalizePhoneJid(value?: string | null): string | null {
  const normalized = normalize(value);
  if (!normalized) return null;

  const at = normalized.lastIndexOf('@');
  if (at < 0) return normalized;

  const rawUser = normalized.slice(0, at);
  const rawServer = normalized.slice(at + 1);
  const deviceSeparator = rawUser.indexOf(':');
  const user =
    deviceSeparator >= 0 ? rawUser.slice(0, deviceSeparator) : rawUser;
  const server =
    rawServer.toLowerCase() === 'c.us' ? 's.whatsapp.net' : rawServer;

  return `${user}@${server}`;
}

export function buildUserPhoneJidUpdateEventId(
  input: IUserPhoneJidUpdateIdentityInput
): string | null {
  const accountId = normalize(input.account_id);
  const workerId = normalize(input.worker_id);
  const operationId = normalize(input.operation_id);
  const userId = normalize(input.user_id);
  const phoneJid = canonicalizePhoneJid(input.phone_jid);

  if (!accountId || !workerId || !operationId || !userId || !phoneJid) {
    return null;
  }

  const digest = createHash('sha256')
    .update(
      ['v1', accountId, workerId, userId, phoneJid, operationId].join('\0')
    )
    .digest('hex');

  return `user_phone_jid_v1_${digest}`;
}
