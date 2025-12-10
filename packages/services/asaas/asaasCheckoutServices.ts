import { injectable } from 'tsyringe';
import { CreateCheckoutService, CancelCheckoutService } from './checkout';

@injectable()
export class AsaasCheckoutServices {
  public readonly create: CreateCheckoutService;
  public readonly cancel: CancelCheckoutService;

  constructor(create: CreateCheckoutService, cancel: CancelCheckoutService) {
    this.create = create;
    this.cancel = cancel;
  }
}
