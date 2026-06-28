import { injectable } from 'tsyringe';
import {
  IPushDeliveryJob,
  IPushDeliveryResult,
} from '@core/common/interfaces/IPushDelivery';
import { IPushNotificationPayload } from '@core/common/interfaces/IPushNotificationPayload';

const EXPO_PUSH_API_URL = 'https://exp.host/--/api/v2/push/send';
const CHAT_NOTIFICATION_ANDROID_CHANNEL_SOUND_VIBRATE = 'underchat-messages';
const CHAT_NOTIFICATION_ANDROID_CHANNEL_SOUND = 'underchat-messages-sound';
const CHAT_NOTIFICATION_ANDROID_CHANNEL_VIBRATE = 'underchat-messages-vibrate';
const CHAT_NOTIFICATION_ANDROID_CHANNEL_SILENT = 'underchat-messages-silent';

type ExpoTicket = {
  status?: 'ok' | 'error';
  details?: { error?: string };
};

type ExpoPushResponse = {
  data?: ExpoTicket | ExpoTicket[];
};

@injectable()
export class PushExpoProviderService {
  static readonly MAX_BATCH_SIZE = 100;

  isConfigured(): boolean {
    return true;
  }

  sendBatch = async (
    jobs: IPushDeliveryJob[]
  ): Promise<IPushDeliveryResult[]> => {
    if (jobs.length === 0) {
      return [];
    }

    const messages = jobs.map((job) => ({
      to: job.endpoint,
      title: job.payload.title,
      body: job.payload.body,
      ...(job.payload.sound !== false ? { sound: 'default' } : {}),
      priority: 'high',
      channelId: getAndroidChannelId(job.payload),
      data: job.payload.data ?? {},
    }));

    try {
      const response = await fetch(EXPO_PUSH_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(messages),
      });

      const body = (await response
        .json()
        .catch(() => null)) as ExpoPushResponse | null;

      if (!response.ok || !body?.data) {
        return jobs.map(() => ({
          status: 'temporary_failure',
          reason: `expo_http_${response.status}`,
        }));
      }

      const tickets = Array.isArray(body.data) ? body.data : [body.data];
      return jobs.map((_, index) => this.mapTicket(tickets[index]));
    } catch {
      return jobs.map(() => ({
        status: 'temporary_failure',
        reason: 'expo_network_error',
      }));
    }
  };

  private mapTicket(ticket?: ExpoTicket): IPushDeliveryResult {
    if (ticket?.status === 'ok') {
      return { status: 'success' };
    }

    if (ticket?.details?.error === 'DeviceNotRegistered') {
      return {
        status: 'permanent_failure',
        reason: 'DeviceNotRegistered',
      };
    }

    return {
      status: 'temporary_failure',
      reason: ticket?.details?.error ?? 'expo_ticket_error',
    };
  }
}

function getAndroidChannelId(payload: IPushNotificationPayload): string {
  const hasSound = payload.sound !== false;
  const hasVibration = payload.vibrate === true;

  if (hasSound && hasVibration) {
    return CHAT_NOTIFICATION_ANDROID_CHANNEL_SOUND_VIBRATE;
  }

  if (hasSound) {
    return CHAT_NOTIFICATION_ANDROID_CHANNEL_SOUND;
  }

  if (hasVibration) {
    return CHAT_NOTIFICATION_ANDROID_CHANNEL_VIBRATE;
  }

  return CHAT_NOTIFICATION_ANDROID_CHANNEL_SILENT;
}
