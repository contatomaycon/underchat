import { IUserChannel } from '@core/common/interfaces/ITokenJwtData';

type IUserChannelLike = Partial<IUserChannel> & {
  channel_id?: string | null;
};

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && value.trim().length > 0;
};

function resolveChannelId(channel: IUserChannelLike): string | null {
  if (isNonEmptyString(channel.id)) {
    return channel.id;
  }

  if (isNonEmptyString(channel.channel_id)) {
    return channel.channel_id;
  }

  return null;
}

export function extractUserChannelIds(
  channels: IUserChannelLike[] | null | undefined
): string[] {
  if (!Array.isArray(channels) || channels.length === 0) {
    return [];
  }

  const channelIds = new Set<string>();

  for (const channel of channels) {
    const channelId = resolveChannelId(channel);
    if (channelId) {
      channelIds.add(channelId);
    }
  }

  return Array.from(channelIds);
}

export function normalizeUserChannels(
  channels: IUserChannelLike[] | null | undefined
): IUserChannel[] {
  if (!Array.isArray(channels) || channels.length === 0) {
    return [];
  }

  const normalizedChannels: IUserChannel[] = [];
  const seen = new Set<string>();

  for (const channel of channels) {
    const channelId = resolveChannelId(channel);
    if (!channelId || seen.has(channelId)) {
      continue;
    }

    normalizedChannels.push({
      id: channelId,
      name: isNonEmptyString(channel.name) ? channel.name : '',
    });
    seen.add(channelId);
  }

  return normalizedChannels;
}
