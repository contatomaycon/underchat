import { injectable } from 'tsyringe';
import {
  CreateSubscriptionService,
  CreateSubscriptionWithCreditCardService,
  GetSubscriptionService,
  UpdateSubscriptionService,
  DeleteSubscriptionService,
  ListSubscriptionsService,
} from './subscriptions';

@injectable()
export class AsaasSubscriptionCrudServices {
  public readonly create: CreateSubscriptionService;
  public readonly createWithCreditCard: CreateSubscriptionWithCreditCardService;
  public readonly get: GetSubscriptionService;
  public readonly update: UpdateSubscriptionService;
  public readonly delete: DeleteSubscriptionService;
  public readonly list: ListSubscriptionsService;

  constructor(
    create: CreateSubscriptionService,
    createWithCreditCard: CreateSubscriptionWithCreditCardService,
    get: GetSubscriptionService,
    update: UpdateSubscriptionService,
    deleteService: DeleteSubscriptionService,
    list: ListSubscriptionsService
  ) {
    this.create = create;
    this.createWithCreditCard = createWithCreditCard;
    this.get = get;
    this.update = update;
    this.delete = deleteService;
    this.list = list;
  }
}
