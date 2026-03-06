import type { ListChatsResult } from '../types/chat';
import type { UserChannel } from '../storage/authStorage';

const MASTER_PERMISSION_ROLE_ID = '019a930d-c6f5-75af-82a5-8c20f9d0e6e2';
const ADMINISTRATOR_PERMISSION_ROLE_ID = '019a930d-c6f5-75af-82a5-899cb84b6089';

export const CHAT_ACCESS_PERMISSIONS = [
  'full_access',
  'full_access_group',
  'chat_group',
  'chat_access',
] as const;

export const CHATBOT_INPUT_READ_PERMISSIONS = [
  'full_access',
  'full_access_group',
  'chat_group',
  'view_chatbot_messages',
  'chatbot_group',
  'chatbot_access',
] as const;

export const CHAT_MODULE_ACCESS_PERMISSIONS = [
  ...CHAT_ACCESS_PERMISSIONS,
  'view_chatbot_messages',
  'chatbot_group',
  'chatbot_access',
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
  'chatbot_group',
  'chatbot_access',
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

export const ATTENDANCE_HISTORY_PERMISSIONS = [
  'full_access',
  'full_access_group',
  'chat_group',
  'attendance_history',
] as const;

export const CLOSE_CHAT_WITHOUT_ATTENDING_PERMISSIONS = [
  'full_access',
  'full_access_group',
  'chat_group',
  'close_chat_without_attending',
] as const;

export const REOPEN_CHAT_PERMISSIONS = [
  'full_access',
  'full_access_group',
  'chat_group',
  'reopen_chat',
] as const;

export const FORWARD_TO_OUTPUT_CHATBOT_PERMISSIONS = [
  'full_access',
  'full_access_group',
  'chat_group',
  'forward_to_output_chatbot',
] as const;

export const DISABLE_SEND_MESSAGE_ON_FINISH_ATTENDANCE_PERMISSIONS = [
  'full_access',
  'full_access_group',
  'chat_group',
  'disable_send_message_on_finish_attendance',
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

export function isMasterOrAdministratorRoleId(
  permissionRoleId: string | null | undefined
): boolean {
  const normalizedRoleId = normalizeIdentifier(permissionRoleId)?.toLowerCase();
  if (!normalizedRoleId) {
    return false;
  }

  return (
    normalizedRoleId === MASTER_PERMISSION_ROLE_ID ||
    normalizedRoleId === ADMINISTRATOR_PERMISSION_ROLE_ID
  );
}

export function resolveUserPermissionRoleId(user: unknown): string | null {
  if (!user || typeof user !== 'object') {
    return null;
  }

  const userData = user as {
    permission_role_id?: unknown;
    type?: { user_type_id?: unknown };
  };

  return (
    normalizeIdentifier(userData.permission_role_id) ??
    normalizeIdentifier(userData.type?.user_type_id)
  );
}

export function isMasterOrAdministratorUser(user: unknown): boolean {
  return isMasterOrAdministratorRoleId(resolveUserPermissionRoleId(user));
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

function resolveSecondaryUsers(chat: ListChatsResult): Array<{ id: string }> {
  const users = chat.secondary_users;
  if (!Array.isArray(users)) {
    return [];
  }

  return users
    .map((user) => {
      const id = normalizeIdentifier(user?.id);
      if (!id) {
        return null;
      }

      return { id };
    })
    .filter((user): user is { id: string } => !!user);
}

export function isChatPrimary(
  chat: ListChatsResult,
  userId: string | null
): boolean {
  if (!userId) {
    return false;
  }

  return resolveChatUserId(chat) === normalizeIdentifier(userId);
}

export function isChatSecondary(
  chat: ListChatsResult,
  userId: string | null
): boolean {
  if (!userId) {
    return false;
  }

  const normalizedUserId = normalizeIdentifier(userId);
  if (!normalizedUserId) {
    return false;
  }

  return resolveSecondaryUsers(chat).some(
    (secondaryUser) => secondaryUser.id === normalizedUserId
  );
}

export function isChatParticipant(
  chat: ListChatsResult,
  userId: string | null
): boolean {
  return isChatPrimary(chat, userId) || isChatSecondary(chat, userId);
}

export function hasChatAccessPermission(permissions: string[]): boolean {
  return hasAnyPermission(permissions, CHAT_ACCESS_PERMISSIONS);
}

export function hasChatModuleAccessPermission(permissions: string[]): boolean {
  return hasAnyPermission(permissions, CHAT_MODULE_ACCESS_PERMISSIONS);
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

export function canViewAttendanceHistory(permissions: string[]): boolean {
  return hasAnyPermission(permissions, ATTENDANCE_HISTORY_PERMISSIONS);
}

export function canCloseChatWithoutAttending(permissions: string[]): boolean {
  return hasAnyPermission(
    permissions,
    CLOSE_CHAT_WITHOUT_ATTENDING_PERMISSIONS
  );
}

export function canReopenChat(permissions: string[]): boolean {
  return hasAnyPermission(permissions, REOPEN_CHAT_PERMISSIONS);
}

export function canToggleForwardToOutputChatbot(
  permissions: string[]
): boolean {
  return hasAnyPermission(permissions, FORWARD_TO_OUTPUT_CHATBOT_PERMISSIONS);
}

export function canDisableSendMessageOnFinishAttendance(
  permissions: string[]
): boolean {
  return hasAnyPermission(
    permissions,
    DISABLE_SEND_MESSAGE_ON_FINISH_ATTENDANCE_PERMISSIONS
  );
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
  const canViewChatbotInputMessages = hasAnyPermission(
    permissions,
    CHATBOT_INPUT_READ_PERMISSIONS
  );
  const isOwnChat = isChatParticipant(chat, userId);
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

  if (chat.status === 'ura') {
    if (canViewChatbotInputMessages) {
      return true;
    }

    if (hasPermissionToViewAll || isOwnChat) {
      return true;
    }

    return canViewBySector && isChatInUserSectors;
  }

  if (
    chat.status === 'ura_output' ||
    chat.status === 'ura_webhook' ||
    chat.status === 'ura_schedule'
  ) {
    if (hasPermissionToViewAll || isOwnChat) {
      return true;
    }

    return canViewBySector && isChatInUserSectors;
  }

  return (
    canViewAllByGroup || isOwnChat || (canViewBySector && isChatInUserSectors)
  );
}
