import { injectable } from 'tsyringe';
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
    create: CreateSubscriptionInvoiceSettingsService,
    get: GetSubscriptionInvoiceSettingsService,
    update: UpdateSubscriptionInvoiceSettingsService,
    deleteService: DeleteSubscriptionInvoiceSettingsService
  ) {
    this.create = create;
    this.get = get;
    this.update = update;
    this.delete = deleteService;
  }
}
