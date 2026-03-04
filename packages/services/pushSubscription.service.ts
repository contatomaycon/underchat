import { injectable, inject } from 'tsyringe';
import {
  IPushSubscription,
  PushSubscriptionProvider,
} from '@core/common/interfaces/IPushSubscription';
import { PushSubscriptionCreatorRepository } from '@core/repositories/push/PushSubscriptionCreator.repository';
import { PushSubscriptionDeleterRepository } from '@core/repositories/push/PushSubscriptionDeleter.repository';
import { PushNotificationService } from '@core/services/pushNotification.service';

@injectable()
export class PushSubscriptionService {
  constructor(
    @inject(PushSubscriptionCreatorRepository)
    private readonly pushSubscriptionCreatorRepository: PushSubscriptionCreatorRepository,
    @inject(PushSubscriptionDeleterRepository)
    private readonly pushSubscriptionDeleterRepository: PushSubscriptionDeleterRepository,
    @inject(PushNotificationService)
    private readonly pushNotificationService: PushNotificationService
  ) {}

  registerSubscription = async (
    input: IPushSubscription
  ): Promise<{ push_subscription_id: string }> => {
    return this.pushSubscriptionCreatorRepository.createOrUpdate(input);
  };

  deleteSubscription = async (
    userId: string,
    endpoint: string,
    provider?: PushSubscriptionProvider
  ): Promise<boolean> => {
    return this.pushSubscriptionDeleterRepository.deleteByUserAndEndpoint(
      userId,
      endpoint,
      provider
    );
  };

  getPublicKey = (): string | null => {
    return this.pushNotificationService.getPublicKey();
  };
}
