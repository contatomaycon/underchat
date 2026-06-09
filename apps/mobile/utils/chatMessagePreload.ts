import type { ListMessageResponse } from '../types/chat';

type ChatMessagePreloadEntry = {
  data: ListMessageResponse;
  createdAt: number;
};

const PRELOAD_TTL_MS = 30_000;
const preloadedChatMessages = new Map<string, ChatMessagePreloadEntry>();

export function setChatMessagePreload(
  chatId: string,
  data: ListMessageResponse
): void {
  preloadedChatMessages.set(chatId, {
    data,
    createdAt: Date.now(),
  });
}

export function consumeChatMessagePreload(
  chatId: string
): ListMessageResponse | null {
  const entry = preloadedChatMessages.get(chatId);
  preloadedChatMessages.delete(chatId);

  if (!entry) return null;
  if (Date.now() - entry.createdAt > PRELOAD_TTL_MS) return null;

  return entry.data;
}
