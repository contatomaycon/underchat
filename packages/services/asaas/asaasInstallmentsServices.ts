import { injectable } from 'tsyringe';
import { AsaasInstallmentBasicServices } from './asaasInstallmentBasicServices';
import { AsaasInstallmentAdvancedServices } from './asaasInstallmentAdvancedServices';

@injectable()
export class AsaasInstallmentsServices {
  public readonly basic: AsaasInstallmentBasicServices;
  public readonly advanced: AsaasInstallmentAdvancedServices;

  constructor(
    basic: AsaasInstallmentBasicServices,
    advanced: AsaasInstallmentAdvancedServices
  ) {
    this.basic = basic;
    this.advanced = advanced;
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

  get delete() {
    return this.basic.delete;
  }

  get list() {
    return this.basic.list;
  }

  get listPayments() {
    return this.advanced.listPayments;
  }

  get getPaymentBook() {
    return this.advanced.getPaymentBook;
  }

  get updateSplits() {
    return this.advanced.updateSplits;
  }

  get refund() {
    return this.advanced.refund;
  }
}
