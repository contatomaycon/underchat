import type { ListChatsResult } from '../types/chat';

type ChatPinningChange = {
  chat: ListChatsResult;
  pinned: boolean;
};

const chatPinningListeners = new Set<(payload: ChatPinningChange) => void>();

const PINNABLE_CHAT_STATUSES = new Set<ListChatsResult['status']>([
  'queue',
  'in_chat',
  'ura',
  'ura_output',
  'ura_schedule',
  'ura_webhook',
]);

export function isPinnableChat(
  chat: ListChatsResult | null | undefined
): boolean {
  return !!chat?.status && PINNABLE_CHAT_STATUSES.has(chat.status);
}

export function addChatPinningListener(
  listener: (payload: ChatPinningChange) => void
): () => void {
  chatPinningListeners.add(listener);
  return () => {
    chatPinningListeners.delete(listener);
  };
}

export function emitChatPinningChange(payload: ChatPinningChange): void {
  for (const listener of chatPinningListeners) {
    try {
      listener(payload);
    } catch {
      //
    }
  }
}
