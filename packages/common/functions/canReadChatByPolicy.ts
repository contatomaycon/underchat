import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EChatbotPermissions } from '@core/common/enums/EPermissions/chatbot';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { IChat } from '@core/common/interfaces/IChat';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { extractUserChannelIds } from '@core/common/functions/extractUserChannelIds';
import { isChatParticipant } from '@core/common/functions/chatParticipants';

type IUserChannelLike = {
  id?: string;
  name?: string;
  channel_id?: string | null;
};

interface ICanReadChatByPolicyInput {
  chat: IChat;
  userId: string;
  actions: IJwtGroupHierarchy[];
  userSectors: string[];
  userChannels?: IUserChannelLike[] | null;
}

function hasAnyPermission(
  actions: IJwtGroupHierarchy[],
  permissions: string[]
): boolean {
  if (!Array.isArray(actions) || actions.length === 0) {
    return false;
  }

  return actions.some((action) => permissions.includes(action.action_name));
}

function isChatInUserSectors(chat: IChat, userSectors: string[]): boolean {
  if (!chat.sector?.id) {
    return true;
  }

  if (!Array.isArray(userSectors) || userSectors.length === 0) {
    return false;
  }

  return userSectors.includes(chat.sector.id);
}

function isChatbotStatus(status: EChatStatus): boolean {
  return (
    status === EChatStatus.ura ||
    status === EChatStatus.ura_output ||
    status === EChatStatus.ura_schedule ||
    status === EChatStatus.ura_webhook
  );
}

export function canReadChatByPolicy({
  chat,
  userId,
  actions,
  userSectors,
  userChannels = [],
}: ICanReadChatByPolicyInput): boolean {
  const allowedChannelIds = extractUserChannelIds(userChannels);
  if (allowedChannelIds.length > 0) {
    if (!chat.worker?.id || !allowedChannelIds.includes(chat.worker.id)) {
      return false;
    }
  }

  const canReadAllWithoutSector = hasAnyPermission(actions, [
    EGeneralPermissions.full_access,
    EGeneralPermissions.full_access_group,
    EChatPermissions.chat_group,
    EChatPermissions.list_all_chats_without_sector_limit,
  ]);
  if (canReadAllWithoutSector) {
    return true;
  }

  const isOwnChat = isChatParticipant(chat, userId);
  if (isOwnChat) {
    return true;
  }

  const hasChatbotInputReadPermission = hasAnyPermission(actions, [
    EGeneralPermissions.full_access,
    EGeneralPermissions.full_access_group,
    EChatPermissions.chat_group,
    EChatbotPermissions.chatbot_group,
    EChatbotPermissions.chatbot_access,
    EChatPermissions.view_chatbot_messages,
  ]);
  if (isChatbotStatus(chat.status) && hasChatbotInputReadPermission) {
    return true;
  }

  const canReadBySectorPermission = hasAnyPermission(actions, [
    EGeneralPermissions.full_access,
    EGeneralPermissions.full_access_group,
    EChatPermissions.chat_group,
    EChatPermissions.list_all_chats_in_sector,
  ]);
  if (canReadBySectorPermission) {
    return isChatInUserSectors(chat, userSectors);
  }

  const hasChatAccessPermission = hasAnyPermission(actions, [
    EGeneralPermissions.full_access,
    EGeneralPermissions.full_access_group,
    EChatPermissions.chat_group,
    EChatPermissions.chat_access,
  ]);
  if (!hasChatAccessPermission) {
    return false;
  }

  if (chat.status !== EChatStatus.queue) {
    return false;
  }

  const hasParticipants =
    !!chat.user?.id ||
    (Array.isArray(chat.secondary_users) && chat.secondary_users.length > 0);

  if (hasParticipants && !isOwnChat) {
    return false;
  }

  return isChatInUserSectors(chat, userSectors);
}
