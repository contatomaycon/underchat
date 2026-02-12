import { injectable, inject } from 'tsyringe';
import { CreateCheckoutService, CancelCheckoutService } from './checkout';

@injectable()
export class AsaasCheckoutServices {
  public readonly create: CreateCheckoutService;
  public readonly cancel: CancelCheckoutService;

  constructor(
    @inject(CreateCheckoutService)
    create: CreateCheckoutService,
    @inject(CancelCheckoutService)
    cancel: CancelCheckoutService
  ) {
    this.create = create;
    this.cancel = cancel;
  }
}
