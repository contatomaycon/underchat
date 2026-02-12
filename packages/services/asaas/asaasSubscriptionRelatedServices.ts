import { injectable, inject } from 'tsyringe';
import {
  ListSubscriptionPaymentsService,
  GetSubscriptionPaymentBookService,
  ListSubscriptionInvoicesService,
} from './subscriptions';
import { AsaasSubscriptionInvoiceSettingsServices } from './asaasSubscriptionInvoiceSettingsServices';

@injectable()
export class AsaasSubscriptionRelatedServices {
  public readonly listPayments: ListSubscriptionPaymentsService;
  public readonly getPaymentBook: GetSubscriptionPaymentBookService;
  public readonly invoiceSettings: AsaasSubscriptionInvoiceSettingsServices;
  public readonly listInvoices: ListSubscriptionInvoicesService;

  constructor(
    @inject(ListSubscriptionPaymentsService)
    listPayments: ListSubscriptionPaymentsService,
    @inject(GetSubscriptionPaymentBookService)
    getPaymentBook: GetSubscriptionPaymentBookService,
    @inject(AsaasSubscriptionInvoiceSettingsServices)
    invoiceSettings: AsaasSubscriptionInvoiceSettingsServices,
    @inject(ListSubscriptionInvoicesService)
    listInvoices: ListSubscriptionInvoicesService
  ) {
    this.listPayments = listPayments;
    this.getPaymentBook = getPaymentBook;
    this.invoiceSettings = invoiceSettings;
    this.listInvoices = listInvoices;
  }
}
