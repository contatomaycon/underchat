import { injectable } from 'tsyringe';
import { UpdateSubscriptionCreditCardService } from './subscriptions';

@injectable()
export class AsaasSubscriptionUpdateServices {
  public readonly updateCreditCard: UpdateSubscriptionCreditCardService;

  constructor(updateCreditCard: UpdateSubscriptionCreditCardService) {
    this.updateCreditCard = updateCreditCard;
  }
}
