interface IChatOwnedMessage {
  chat_id?: unknown;
  account?: { id?: unknown } | null;
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function messageBelongsToChat<T extends IChatOwnedMessage>(
  message: T | null | undefined,
  chatId: string | null | undefined
): boolean {
  const expectedChatId = normalizeNonEmptyString(chatId);
  const messageChatId = normalizeNonEmptyString(message?.chat_id);

  return !!expectedChatId && messageChatId === expectedChatId;
}

export function messageBelongsToChatAndAccount<T extends IChatOwnedMessage>(
  message: T | null | undefined,
  chatId: string | null | undefined,
  accountId: string | null | undefined
): boolean {
  if (!messageBelongsToChat(message, chatId)) {
    return false;
  }

  const expectedAccountId = normalizeNonEmptyString(accountId);
  const messageAccountId = normalizeNonEmptyString(message?.account?.id);

  return !!expectedAccountId && messageAccountId === expectedAccountId;
}

export function filterMessagesForChat<T extends IChatOwnedMessage>(
  messages: readonly T[],
  chatId: string | null | undefined
): T[] {
  return messages.filter((message) => messageBelongsToChat(message, chatId));
}

export function filterMessagesForChatAndAccount<T extends IChatOwnedMessage>(
  messages: readonly T[],
  chatId: string | null | undefined,
  accountId: string | null | undefined
): T[] {
  return messages.filter((message) =>
    messageBelongsToChatAndAccount(message, chatId, accountId)
  );
}
