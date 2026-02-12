import { injectable, inject } from 'tsyringe';
import { AsaasPaymentCrudServices } from './asaasPaymentCrudServices';
import { AsaasPaymentActionServices } from './asaasPaymentActionServices';

@injectable()
export class AsaasPaymentBasicServices {
  public readonly crud: AsaasPaymentCrudServices;
  public readonly actions: AsaasPaymentActionServices;

  constructor(
    @inject(AsaasPaymentCrudServices)
    crud: AsaasPaymentCrudServices,
    @inject(AsaasPaymentActionServices)
    actions: AsaasPaymentActionServices
  ) {
    this.crud = crud;
    this.actions = actions;
  }

  get create() {
    return this.crud.create;
  }

  get createCreditCard() {
    return this.crud.createCreditCard;
  }

  get get() {
    return this.crud.get;
  }

  get update() {
    return this.crud.update;
  }

  get delete() {
    return this.crud.delete;
  }

  get restore() {
    return this.crud.restore;
  }

  get captureAuthorized() {
    return this.actions.captureAuthorized;
  }

  get payWithCreditCard() {
    return this.actions.payWithCreditCard;
  }
}
