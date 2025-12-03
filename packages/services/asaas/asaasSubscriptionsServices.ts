import { injectable } from 'tsyringe';
import {
  CreateSubscriptionService,
  CreateSubscriptionWithCreditCardService,
  GetSubscriptionService,
  UpdateSubscriptionService,
  UpdateSubscriptionCreditCardService,
  DeleteSubscriptionService,
  ListSubscriptionsService,
  ListSubscriptionPaymentsService,
  GetSubscriptionPaymentBookService,
  ListSubscriptionInvoicesService,
} from './subscriptions';
import { AsaasSubscriptionInvoiceSettingsServices } from './asaasSubscriptionInvoiceSettingsServices';

@injectable()
export class AsaasSubscriptionsServices {
  public readonly create: CreateSubscriptionService;
  public readonly createWithCreditCard: CreateSubscriptionWithCreditCardService;
  public readonly get: GetSubscriptionService;
  public readonly update: UpdateSubscriptionService;
  public readonly updateCreditCard: UpdateSubscriptionCreditCardService;
  public readonly delete: DeleteSubscriptionService;
  public readonly list: ListSubscriptionsService;
  public readonly listPayments: ListSubscriptionPaymentsService;
  public readonly getPaymentBook: GetSubscriptionPaymentBookService;
  public readonly invoiceSettings: AsaasSubscriptionInvoiceSettingsServices;
  public readonly listInvoices: ListSubscriptionInvoicesService;

  constructor(
    create: CreateSubscriptionService,
    createWithCreditCard: CreateSubscriptionWithCreditCardService,
    get: GetSubscriptionService,
    update: UpdateSubscriptionService,
    updateCreditCard: UpdateSubscriptionCreditCardService,
    deleteService: DeleteSubscriptionService,
    list: ListSubscriptionsService,
    listPayments: ListSubscriptionPaymentsService,
    getPaymentBook: GetSubscriptionPaymentBookService,
    invoiceSettings: AsaasSubscriptionInvoiceSettingsServices,
    listInvoices: ListSubscriptionInvoicesService
  ) {
    this.create = create;
    this.createWithCreditCard = createWithCreditCard;
    this.get = get;
    this.update = update;
    this.updateCreditCard = updateCreditCard;
    this.delete = deleteService;
    this.list = list;
    this.listPayments = listPayments;
    this.getPaymentBook = getPaymentBook;
    this.invoiceSettings = invoiceSettings;
    this.listInvoices = listInvoices;
  }
}
