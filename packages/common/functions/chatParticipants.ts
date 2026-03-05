import type { IChat } from '@core/common/interfaces/IChat';

function normalizeUserId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  return null;
}

function normalizeChatUserId(user: unknown): string | null {
  if (!user || typeof user !== 'object') {
    return null;
  }

  const parsed = user as { id?: unknown; user_id?: unknown };
  return normalizeUserId(parsed.id) ?? normalizeUserId(parsed.user_id);
}

export function isChatPrimary(chat: IChat, userId?: string | null): boolean {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return false;
  }

  const primaryUserId = normalizeChatUserId(chat.user);
  return primaryUserId === normalizedUserId;
}

export function isChatSecondary(chat: IChat, userId?: string | null): boolean {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return false;
  }

  const secondaryUsers = Array.isArray(chat.secondary_users)
    ? chat.secondary_users
    : [];

  return secondaryUsers.some((secondaryUser) => {
    const secondaryUserId = normalizeChatUserId(secondaryUser);
    return secondaryUserId === normalizedUserId;
  });
}

export function isChatParticipant(
  chat: IChat,
  userId?: string | null
): boolean {
  return isChatPrimary(chat, userId) || isChatSecondary(chat, userId);
}
