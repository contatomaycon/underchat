import { injectable, inject } from 'tsyringe';
import { PushSubscriptionProvider } from '@core/common/interfaces/IPushSubscription';
import { PushSubscriptionService } from '@core/services/pushSubscription.service';

type DeletePushSubscriptionInput = {
  userId: string;
  endpoint: string;
  provider?: PushSubscriptionProvider;
};

type DeletePushSubscriptionResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      reason: 'invalid_payload';
    };

@injectable()
export class PushSubscriptionDeleterUseCase {
  constructor(
    @inject(PushSubscriptionService)
    private readonly pushSubscriptionService: PushSubscriptionService
  ) {}

  execute = async (
    input: DeletePushSubscriptionInput
  ): Promise<DeletePushSubscriptionResult> => {
    const endpoint = input.endpoint?.trim();

    if (!endpoint) {
      return { ok: false, reason: 'invalid_payload' };
    }

    await this.pushSubscriptionService.deleteSubscription(
      input.userId,
      endpoint,
      input.provider
    );

    return { ok: true };
  };
}
