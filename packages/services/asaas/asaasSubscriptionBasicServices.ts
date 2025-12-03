import { injectable } from 'tsyringe';
import { AsaasSubscriptionCrudServices } from './asaasSubscriptionCrudServices';
import { AsaasSubscriptionUpdateServices } from './asaasSubscriptionUpdateServices';

@injectable()
export class AsaasSubscriptionBasicServices {
  public readonly crud: AsaasSubscriptionCrudServices;
  public readonly updateServices: AsaasSubscriptionUpdateServices;

  constructor(
    crud: AsaasSubscriptionCrudServices,
    updateServices: AsaasSubscriptionUpdateServices
  ) {
    this.crud = crud;
    this.updateServices = updateServices;
  }

  get create() {
    return this.crud.create;
  }

  get createWithCreditCard() {
    return this.crud.createWithCreditCard;
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

  get list() {
    return this.crud.list;
  }

  get updateCreditCard() {
    return this.updateServices.updateCreditCard;
  }
}
