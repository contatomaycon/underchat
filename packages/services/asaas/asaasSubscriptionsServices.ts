import { injectable, inject } from 'tsyringe';
import { AsaasSubscriptionBasicServices } from './asaasSubscriptionBasicServices';
import { AsaasSubscriptionRelatedServices } from './asaasSubscriptionRelatedServices';

@injectable()
export class AsaasSubscriptionsServices {
  public readonly basic: AsaasSubscriptionBasicServices;
  public readonly related: AsaasSubscriptionRelatedServices;

  constructor(
    @inject(AsaasSubscriptionBasicServices)
    basic: AsaasSubscriptionBasicServices,
    @inject(AsaasSubscriptionRelatedServices)
    related: AsaasSubscriptionRelatedServices
  ) {
    this.basic = basic;
    this.related = related;
  }

  get create() {
    return this.basic.create;
  }

  get createWithCreditCard() {
    return this.basic.createWithCreditCard;
  }

  get get() {
    return this.basic.get;
  }

  get update() {
    return this.basic.update;
  }

  get updateCreditCard() {
    return this.basic.updateCreditCard;
  }

  get delete() {
    return this.basic.delete;
  }

  get list() {
    return this.basic.list;
  }

  get listPayments() {
    return this.related.listPayments;
  }

  get getPaymentBook() {
    return this.related.getPaymentBook;
  }

  get invoiceSettings() {
    return this.related.invoiceSettings;
  }

  get listInvoices() {
    return this.related.listInvoices;
  }
}
