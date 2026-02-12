import { injectable, inject } from 'tsyringe';
import { ListPaymentsService } from './payments';
import { AsaasPaymentBasicServices } from './asaasPaymentBasicServices';
import { AsaasPaymentInfoServices } from './asaasPaymentInfoServices';
import { AsaasPaymentDocumentsServices } from './asaasPaymentDocumentsServices';

@injectable()
export class AsaasPaymentsServices {
  public readonly basic: AsaasPaymentBasicServices;
  public readonly info: AsaasPaymentInfoServices;
  public readonly list: ListPaymentsService;
  public readonly documents: AsaasPaymentDocumentsServices;

  constructor(
    @inject(AsaasPaymentBasicServices)
    basic: AsaasPaymentBasicServices,
    @inject(AsaasPaymentInfoServices)
    info: AsaasPaymentInfoServices,
    @inject(ListPaymentsService)
    list: ListPaymentsService,
    @inject(AsaasPaymentDocumentsServices)
    documents: AsaasPaymentDocumentsServices
  ) {
    this.basic = basic;
    this.info = info;
    this.list = list;
    this.documents = documents;
  }

  get create() {
    return this.basic.create;
  }

  get createCreditCard() {
    return this.basic.createCreditCard;
  }

  get captureAuthorized() {
    return this.basic.captureAuthorized;
  }

  get payWithCreditCard() {
    return this.basic.payWithCreditCard;
  }

  get get() {
    return this.basic.get;
  }

  get update() {
    return this.basic.update;
  }

  get delete() {
    return this.basic.delete;
  }

  get restore() {
    return this.basic.restore;
  }

  get getStatus() {
    return this.info.getStatus;
  }

  get getIdentificationField() {
    return this.info.getIdentificationField;
  }

  get getPixQrCode() {
    return this.info.getPixQrCode;
  }

  get getBillingInfo() {
    return this.info.getBillingInfo;
  }

  get getViewingInfo() {
    return this.info.getViewingInfo;
  }
}
