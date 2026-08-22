import { apiGet } from './client';
import type { WhatsappConnectionPublicStatus } from '../../../packages/common/functions/whatsappConnectionStatus';

export type OfflineChannelStatus = {
  id: string;
  name: string | null;
};

export type OfflineChannel = {
  id: string;
  name: string;
  worker_type_id?: string;
  status: OfflineChannelStatus | null;
  connection_status?: WhatsappConnectionPublicStatus | null;
  connection_status_source_id?: string | null;
  connection_status_order?: string | null;
  connection_online_acknowledged?: boolean;
  runtime_generation?: number | null;
};

export async function getOfflineChannels(): Promise<OfflineChannel[]> {
  const result = await apiGet<OfflineChannel[]>('/chat/offline-channels');
  if (!result || !Array.isArray(result.data)) return [];
  return result.data;
}

export type ChannelWithStatus = {
  id: string;
  name: string;
  worker_type_id?: string;
  status: OfflineChannelStatus | null;
  connection_status?: WhatsappConnectionPublicStatus | null;
  connection_status_source_id?: string | null;
  connection_status_order?: string | null;
  connection_online_acknowledged?: boolean;
  runtime_generation?: number | null;
};

export async function getAllChannelsStatus(): Promise<ChannelWithStatus[]> {
  const result = await apiGet<ChannelWithStatus[]>('/chat/channels-status');
  if (!result || !Array.isArray(result.data)) return [];
  return result.data;
}
