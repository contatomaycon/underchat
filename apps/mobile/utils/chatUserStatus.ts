import type { ChatUserStatus } from '../api/chatApi';
import { colors } from '../theme/colors';

const DEFAULT_CHAT_USER_STATUS: ChatUserStatus = 'offline';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeChatUserStatus(value: unknown): ChatUserStatus {
  if (value === 'online') return 'online';
  if (value === 'busy') return 'busy';
  if (value === 'do_not_disturb') return 'do_not_disturb';
  if (value === 'away') return 'away';
  if (value === 'offline') return 'offline';
  return DEFAULT_CHAT_USER_STATUS;
}

export function readChatUserStatus(user: unknown): ChatUserStatus {
  if (!isRecord(user)) return DEFAULT_CHAT_USER_STATUS;
  const chatUser = isRecord(user.chat_user) ? user.chat_user : {};
  return normalizeChatUserStatus(chatUser.status);
}

export function getChatUserStatusColor(status: ChatUserStatus): string {
  if (status === 'online') return colors.success;
  if (status === 'busy') return colors.error;
  if (status === 'away' || status === 'do_not_disturb') return colors.warning;
  return colors.grey600;
}
