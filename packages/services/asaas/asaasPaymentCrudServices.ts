import { injectable } from 'tsyringe';
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
    create: CreatePaymentService,
    createCreditCard: CreateCreditCardPaymentService,
    get: GetPaymentService,
    update: UpdatePaymentService,
    deleteService: DeletePaymentService,
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
