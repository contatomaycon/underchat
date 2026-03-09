import { apiGet } from './client';

export type OfflineChannelStatus = {
  id: string;
  name: string | null;
};

export type OfflineChannel = {
  id: string;
  name: string;
  status: OfflineChannelStatus | null;
};

export async function getOfflineChannels(): Promise<OfflineChannel[]> {
  const result = await apiGet<OfflineChannel[]>('/chat/offline-channels');
  if (!result || !Array.isArray(result.data)) return [];
  return result.data;
}

export type ChannelWithStatus = {
  id: string;
  name: string;
  status: OfflineChannelStatus | null;
};

export async function getAllChannelsStatus(): Promise<ChannelWithStatus[]> {
  const result = await apiGet<ChannelWithStatus[]>('/chat/channels-status');
  if (!result || !Array.isArray(result.data)) return [];
  return result.data;
}
