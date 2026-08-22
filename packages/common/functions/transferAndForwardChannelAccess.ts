import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EWorkerPermissions } from '@core/common/enums/EPermissions/worker';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { hasRequiredPermission } from './hasRequiredPermission';

type UserChannel = { id: string; name: string };

const transferAndForwardChannelPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EWorkerPermissions.view_all_channels_for_transfer_and_forwarding,
];

export const canViewAllChannelsForTransferAndForwarding = (
  actions: IJwtGroupHierarchy[] = []
): boolean =>
  hasRequiredPermission(actions, transferAndForwardChannelPermissions);

export const canUseChannelForTransferAndForwarding = (
  channelId: string,
  userChannels: UserChannel[] = [],
  actions: IJwtGroupHierarchy[] = []
): boolean => {
  if (userChannels.length === 0) {
    return true;
  }

  if (canViewAllChannelsForTransferAndForwarding(actions)) {
    return true;
  }

  return userChannels.some((channel) => channel.id === channelId);
};

export const filterChannelsForTransferAndForwarding = <
  T extends { id: string },
>(
  channels: T[],
  userChannels: UserChannel[] = [],
  actions: IJwtGroupHierarchy[] = []
): T[] => {
  if (
    userChannels.length === 0 ||
    canViewAllChannelsForTransferAndForwarding(actions)
  ) {
    return channels;
  }

  const allowedChannelIds = new Set(userChannels.map((channel) => channel.id));
  return channels.filter((channel) => allowedChannelIds.has(channel.id));
};
