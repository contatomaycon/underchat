import type { ListChatsResult } from '../types/chat';
import type { UserChannel } from '../storage/authStorage';

const CHATBOT_STATUSES = new Set([
  'ura',
  'ura_output',
  'ura_schedule',
  'ura_webhook',
]);

export const CHAT_ACCESS_PERMISSIONS = [
  'full_access',
  'full_access_group',
  'chat_group',
  'chat_access',
] as const;

export const CONTACTS_MODULE_PERMISSIONS = CHAT_ACCESS_PERMISSIONS;

export const VIEW_OTHERS_CHAT_PERMISSIONS = [
  'full_access',
  'full_access_group',
  'chat_group',
] as const;

export const LIST_ALL_CHATS_IN_SECTOR_PERMISSIONS = [
  'full_access',
  'full_access_group',
  'chat_group',
  'list_all_chats_in_sector',
] as const;

export const LIST_ALL_CHATS_WITHOUT_SECTOR_LIMIT_PERMISSIONS = [
  'full_access',
  'full_access_group',
  'chat_group',
  'list_all_chats_without_sector_limit',
] as const;

export const VIEW_CHATBOT_TAB_PERMISSIONS = [
  'full_access',
  'full_access_group',
  'chat_group',
  'view_chatbot_messages',
] as const;

export const PICK_QUEUE_CHAT_PERMISSIONS = [
  'full_access',
  'full_access_group',
  'chat_group',
  'pick_queue_chat',
] as const;

export const PREVIEW_CHAT_CONTENT_PERMISSIONS = [
  'full_access',
  'full_access_group',
  'chat_group',
  'preview_chat',
] as const;

export type ChatAuthorizationContext = {
  permissions: string[];
  userId: string | null;
  userSectors: string[];
  userChannels: UserChannel[];
};

function hasAnyPermission(
  permissions: string[],
  required: readonly string[]
): boolean {
  for (let i = 0; i < required.length; i++) {
    if (permissions.includes(required[i])) return true;
  }
  return false;
}

function normalizeIdentifier(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  return null;
}

function resolveChatChannelId(chat: ListChatsResult): string | null {
  return normalizeIdentifier(chat.worker?.id);
}

function resolveChatSectorId(chat: ListChatsResult): string | null {
  return normalizeIdentifier(chat.sector?.id);
}

function resolveChatUserId(chat: ListChatsResult): string | null {
  const userValue = chat.user as
    | { id?: unknown; user_id?: unknown }
    | null
    | undefined;
  return (
    normalizeIdentifier(userValue?.id) ??
    normalizeIdentifier(userValue?.user_id)
  );
}

export function hasChatAccessPermission(permissions: string[]): boolean {
  return hasAnyPermission(permissions, CHAT_ACCESS_PERMISSIONS);
}

export function hasContactsModuleAccess(permissions: string[]): boolean {
  return hasAnyPermission(permissions, CONTACTS_MODULE_PERMISSIONS);
}

export function canUseUserAndSectorFilters(permissions: string[]): boolean {
  return (
    hasAnyPermission(permissions, LIST_ALL_CHATS_IN_SECTOR_PERMISSIONS) ||
    hasAnyPermission(
      permissions,
      LIST_ALL_CHATS_WITHOUT_SECTOR_LIMIT_PERMISSIONS
    )
  );
}

export function canViewChatbotTab(permissions: string[]): boolean {
  return hasAnyPermission(permissions, VIEW_CHATBOT_TAB_PERMISSIONS);
}

export function canPickQueueChat(permissions: string[]): boolean {
  return hasAnyPermission(permissions, PICK_QUEUE_CHAT_PERMISSIONS);
}

export function canPreviewChatContent(permissions: string[]): boolean {
  return hasAnyPermission(permissions, PREVIEW_CHAT_CONTENT_PERMISSIONS);
}

export function canViewOthersChats(permissions: string[]): boolean {
  return hasAnyPermission(permissions, VIEW_OTHERS_CHAT_PERMISSIONS);
}

export function canListAllChatsInSector(permissions: string[]): boolean {
  return hasAnyPermission(permissions, LIST_ALL_CHATS_IN_SECTOR_PERMISSIONS);
}

export function canListAllChatsWithoutSectorLimit(
  permissions: string[]
): boolean {
  return hasAnyPermission(
    permissions,
    LIST_ALL_CHATS_WITHOUT_SECTOR_LIMIT_PERMISSIONS
  );
}

export function canViewChat(
  chat: ListChatsResult,
  context: ChatAuthorizationContext
): boolean {
  const { permissions, userId, userSectors = [], userChannels = [] } = context;

  if (userChannels.length > 0) {
    const chatChannelId = resolveChatChannelId(chat);
    if (!chatChannelId) {
      return false;
    }

    const hasChannelPermission = userChannels.some((channel) => {
      return normalizeIdentifier(channel.id) === chatChannelId;
    });

    if (!hasChannelPermission) {
      return false;
    }
  }

  const canViewAllByGroup = canViewOthersChats(permissions);
  const canViewAllWithoutSector =
    canListAllChatsWithoutSectorLimit(permissions);
  const canViewBySector = canListAllChatsInSector(permissions);
  const hasPermissionToViewAll = canViewAllByGroup || canViewAllWithoutSector;
  const chatUserId = resolveChatUserId(chat);
  const isOwnChat = !!userId && !!chatUserId && chatUserId === userId;
  const chatSectorId = resolveChatSectorId(chat);
  const isChatInUserSectors =
    (userSectors.length > 0 &&
      !!chatSectorId &&
      userSectors.includes(chatSectorId)) ||
    (userSectors.length === 0 && !chatSectorId) ||
    (canViewBySector && !chatSectorId);

  if (chat.status === 'in_chat') {
    if (hasPermissionToViewAll) return true;
    if (isOwnChat) return true;
    return canViewBySector && isChatInUserSectors;
  }

  if (CHATBOT_STATUSES.has(chat.status)) {
    if (hasPermissionToViewAll || isOwnChat) {
      return true;
    }

    return canViewBySector && isChatInUserSectors;
  }

  return (
    canViewAllByGroup || isOwnChat || (canViewBySector && isChatInUserSectors)
  );
}
