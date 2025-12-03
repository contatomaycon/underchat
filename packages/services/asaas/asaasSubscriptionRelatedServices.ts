import { injectable } from 'tsyringe';
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
    listPayments: ListSubscriptionPaymentsService,
    getPaymentBook: GetSubscriptionPaymentBookService,
    invoiceSettings: AsaasSubscriptionInvoiceSettingsServices,
    listInvoices: ListSubscriptionInvoicesService
  ) {
    this.listPayments = listPayments;
    this.getPaymentBook = getPaymentBook;
    this.invoiceSettings = invoiceSettings;
    this.listInvoices = listInvoices;
  }
}
