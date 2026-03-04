import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { IChat } from '@core/common/interfaces/IChat';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { extractUserChannelIds } from '@core/common/functions/extractUserChannelIds';

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

  const isOwnChat = chat.user?.id === userId;
  if (isOwnChat) {
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

  if (chat.user?.id && chat.user.id !== userId) {
    return false;
  }

  return isChatInUserSectors(chat, userSectors);
}
