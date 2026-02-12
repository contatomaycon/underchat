import { injectable, inject } from 'tsyringe';
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
    @inject(CreateSubscriptionService)
    create: CreateSubscriptionService,
    @inject(CreateSubscriptionWithCreditCardService)
    createWithCreditCard: CreateSubscriptionWithCreditCardService,
    @inject(GetSubscriptionService)
    get: GetSubscriptionService,
    @inject(UpdateSubscriptionService)
    update: UpdateSubscriptionService,
    @inject(DeleteSubscriptionService)
    deleteService: DeleteSubscriptionService,
    @inject(ListSubscriptionsService)
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
