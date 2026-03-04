import { injectable, inject } from 'tsyringe';
import { PushSubscriptionService } from '@core/services/pushSubscription.service';

@injectable()
export class PushPublicKeyViewerUseCase {
  constructor(
    @inject(PushSubscriptionService)
    private readonly pushSubscriptionService: PushSubscriptionService
  ) {}

  execute = (): string | null => {
    return this.pushSubscriptionService.getPublicKey();
  };
}
