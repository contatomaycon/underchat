import { injectable, inject } from 'tsyringe';
import {
  PushSubscriptionPlatform,
  PushSubscriptionProvider,
} from '@core/common/interfaces/IPushSubscription';
import { RegisterPushSubscriptionResponse } from '@core/schema/push/registerSubscription/response.schema';
import { PushSubscriptionService } from '@core/services/pushSubscription.service';

type RegisterPushSubscriptionInput = {
  userId: string;
  endpoint: string;
  provider?: PushSubscriptionProvider;
  platform?: PushSubscriptionPlatform;
  keys?: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
};

type RegisterPushSubscriptionResult =
  | {
      ok: true;
      data: RegisterPushSubscriptionResponse;
    }
  | {
      ok: false;
      reason: 'invalid_payload' | 'vapid_not_configured';
    };

@injectable()
export class PushSubscriptionRegistrarUseCase {
  constructor(
    @inject(PushSubscriptionService)
    private readonly pushSubscriptionService: PushSubscriptionService
  ) {}

  execute = async (
    input: RegisterPushSubscriptionInput
  ): Promise<RegisterPushSubscriptionResult> => {
    const provider = input.provider ?? 'webpush';
    const endpoint = input.endpoint?.trim();

    if (!endpoint) {
      return { ok: false, reason: 'invalid_payload' };
    }

    if (provider === 'webpush' && (!input.keys?.p256dh || !input.keys?.auth)) {
      return { ok: false, reason: 'invalid_payload' };
    }

    const result = await this.pushSubscriptionService.registerSubscription({
      user_id: input.userId,
      provider,
      platform: input.platform,
      endpoint,
      p256dh: input.keys?.p256dh ?? null,
      auth: input.keys?.auth ?? null,
      user_agent: input.userAgent,
    });

    const publicKey = this.pushSubscriptionService.getPublicKey();

    if (provider === 'webpush' && !publicKey) {
      return { ok: false, reason: 'vapid_not_configured' };
    }

    return {
      ok: true,
      data: {
        push_subscription_id: result.push_subscription_id,
        public_key: provider === 'webpush' ? publicKey : null,
      },
    };
  };
}
