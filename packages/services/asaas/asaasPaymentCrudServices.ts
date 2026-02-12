import { injectable, inject } from 'tsyringe';
import {
  CreatePaymentService,
  CreateCreditCardPaymentService,
  GetPaymentService,
  UpdatePaymentService,
  DeletePaymentService,
  RestorePaymentService,
} from './payments';

@injectable()
export class AsaasPaymentCrudServices {
  public readonly create: CreatePaymentService;
  public readonly createCreditCard: CreateCreditCardPaymentService;
  public readonly get: GetPaymentService;
  public readonly update: UpdatePaymentService;
  public readonly delete: DeletePaymentService;
  public readonly restore: RestorePaymentService;

  constructor(
    @inject(CreatePaymentService)
    create: CreatePaymentService,
    @inject(CreateCreditCardPaymentService)
    createCreditCard: CreateCreditCardPaymentService,
    @inject(GetPaymentService)
    get: GetPaymentService,
    @inject(UpdatePaymentService)
    update: UpdatePaymentService,
    @inject(DeletePaymentService)
    deleteService: DeletePaymentService,
    @inject(RestorePaymentService)
    restore: RestorePaymentService
  ) {
    this.create = create;
    this.createCreditCard = createCreditCard;
    this.get = get;
    this.update = update;
    this.delete = deleteService;
    this.restore = restore;
  }
}
