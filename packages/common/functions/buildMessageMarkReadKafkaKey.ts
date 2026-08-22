import type { IMessageMarkRead } from '@core/common/interfaces/IMessageMarkRead';
import type { IUpsertMessageKey } from '@core/common/interfaces/IUpsertMessage';

type MessageMarkReadKey = IUpsertMessageKey & {
  remote_jid?: string | null;
};

function resolveMessageJids(keys: IUpsertMessageKey[]): string[] {
  return Array.from(
    new Set(
      keys
        .map((key) => {
          const typedKey = key as MessageMarkReadKey;
          return (
            typedKey.remoteJid ??
            typedKey.remoteJidAlt ??
            typedKey.remote_jid ??
            null
          );
        })
        .filter((jid): jid is string => Boolean(jid?.trim()))
        .map((jid) => jid.trim())
    )
  ).sort();
}

export function buildMessageMarkReadKafkaKey(data: IMessageMarkRead): string {
  const jids = resolveMessageJids(data.keys);
  return `${data.account_id}:${data.worker_id}:${jids.join(',') || 'unknown-chat'}`;
}
