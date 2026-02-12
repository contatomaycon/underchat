import { injectable, inject } from 'tsyringe';
import { UpdateSubscriptionCreditCardService } from './subscriptions';

@injectable()
export class AsaasSubscriptionUpdateServices {
  public readonly updateCreditCard: UpdateSubscriptionCreditCardService;

  constructor(
    @inject(UpdateSubscriptionCreditCardService)
    updateCreditCard: UpdateSubscriptionCreditCardService
  ) {
    this.updateCreditCard = updateCreditCard;
  }
}
