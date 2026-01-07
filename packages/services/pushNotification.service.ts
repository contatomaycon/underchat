import { injectable } from 'tsyringe';
import webPush from 'web-push';
import { PushSubscriptionListerRepository } from '@core/repositories/push/PushSubscriptionLister.repository';
import { PushSubscriptionDeleterRepository } from '@core/repositories/push/PushSubscriptionDeleter.repository';
import { IPushNotificationPayload } from '@core/common/interfaces/IPushNotificationPayload';

@injectable()
export class PushNotificationService {
  private vapidKeys: {
    publicKey: string;
    privateKey: string;
  } | null = null;

  constructor(
    private readonly pushSubscriptionListerRepository: PushSubscriptionListerRepository,
    private readonly pushSubscriptionDeleterRepository: PushSubscriptionDeleterRepository
  ) {
    this.initializeVapidKeys();
  }

  private initializeVapidKeys(): void {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;

    if (!publicKey || !privateKey) {
      console.warn(
        'VAPID keys não configuradas. Push notifications não funcionarão.'
      );
      return;
    }

    this.vapidKeys = {
      publicKey,
      privateKey,
    };

    const contactEmail =
      process.env.VAPID_CONTACT_EMAIL || 'noreply@underchat.com';

    webPush.setVapidDetails(contactEmail, publicKey, privateKey);
  }

  async sendNotificationToUser(
    userId: string,
    payload: IPushNotificationPayload
  ): Promise<{ sent: number; failed: number }> {
    if (!this.vapidKeys) {
      return { sent: 0, failed: 0 };
    }

    const subscriptions =
      await this.pushSubscriptionListerRepository.listByUserId(userId);

    if (subscriptions.length === 0) {
      return { sent: 0, failed: 0 };
    }

    const notificationPayload = JSON.stringify(payload);
    let sent = 0;
    let failed = 0;

    const promises = subscriptions.map(async (subscription) => {
      try {
        await webPush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          notificationPayload
        );
        sent++;
      } catch (error: any) {
        failed++;

        if (error.statusCode === 410 || error.statusCode === 404) {
          await this.pushSubscriptionDeleterRepository.deleteByEndpoint(
            subscription.endpoint
          );
        }
      }
    });

    await Promise.all(promises);

    return { sent, failed };
  }

  getPublicKey(): string | null {
    return this.vapidKeys?.publicKey || null;
  }
}
