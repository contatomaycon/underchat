import { injectable, inject } from 'tsyringe';
import {
  CreateSubscriptionInvoiceSettingsService,
  GetSubscriptionInvoiceSettingsService,
  UpdateSubscriptionInvoiceSettingsService,
  DeleteSubscriptionInvoiceSettingsService,
} from './subscriptions';

@injectable()
export class AsaasSubscriptionInvoiceSettingsServices {
  public readonly create: CreateSubscriptionInvoiceSettingsService;
  public readonly get: GetSubscriptionInvoiceSettingsService;
  public readonly update: UpdateSubscriptionInvoiceSettingsService;
  public readonly delete: DeleteSubscriptionInvoiceSettingsService;

  constructor(
    @inject(CreateSubscriptionInvoiceSettingsService)
    create: CreateSubscriptionInvoiceSettingsService,
    @inject(GetSubscriptionInvoiceSettingsService)
    get: GetSubscriptionInvoiceSettingsService,
    @inject(UpdateSubscriptionInvoiceSettingsService)
    update: UpdateSubscriptionInvoiceSettingsService,
    @inject(DeleteSubscriptionInvoiceSettingsService)
    deleteService: DeleteSubscriptionInvoiceSettingsService
  ) {
    this.create = create;
    this.get = get;
    this.update = update;
    this.delete = deleteService;
  }
}
