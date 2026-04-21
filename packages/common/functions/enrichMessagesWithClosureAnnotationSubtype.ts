import { EMessageType } from '../enums/EMessageType';
import { ListMessageResult } from '@core/schema/chat/listMessageChats/response.schema';

export type ClosureCommentMatchRow = {
  comment: string;
  closed_at: string;
};

const CLOSURE_MATCH_WINDOW_MS = 5 * 60 * 1000;

export function enrichMessagesWithClosureAnnotationSubtype(
  messages: ListMessageResult[],
  closureComments: ClosureCommentMatchRow[]
): ListMessageResult[] {
  if (!messages.length) {
    return messages;
  }

  const usedMessageIds = new Set<string>();
  for (const msg of messages) {
    if (msg.content?.annotation_subtype === 'closure') {
      usedMessageIds.add(msg.message_id);
    }
  }

  if (!closureComments.length) {
    return messages;
  }

  const sortedClosures = [...closureComments].sort(
    (a, b) => new Date(a.closed_at).getTime() - new Date(b.closed_at).getTime()
  );

  const messageUpdates = new Map<string, ListMessageResult>();

  for (const row of sortedClosures) {
    const closedAtMs = new Date(row.closed_at).getTime();
    const rowComment = row.comment.trim();
    if (!rowComment) continue;

    let best: { message: ListMessageResult; delta: number } | null = null;

    for (const msg of messages) {
      if (usedMessageIds.has(msg.message_id)) continue;
      if (msg.content?.type !== EMessageType.annotation) continue;
      const text = (msg.content?.message ?? '').trim();
      if (text !== rowComment) continue;
      const delta = Math.abs(new Date(msg.date).getTime() - closedAtMs);
      if (delta > CLOSURE_MATCH_WINDOW_MS) continue;
      if (!best || delta < best.delta) {
        best = { message: msg, delta };
      }
    }

    if (best) {
      usedMessageIds.add(best.message.message_id);
      messageUpdates.set(best.message.message_id, {
        ...best.message,
        content: best.message.content
          ? {
              ...best.message.content,
              annotation_subtype: 'closure',
            }
          : best.message.content,
      });
    }
  }

  if (!messageUpdates.size) {
    return messages;
  }

  return messages.map((msg) => messageUpdates.get(msg.message_id) ?? msg);
}
