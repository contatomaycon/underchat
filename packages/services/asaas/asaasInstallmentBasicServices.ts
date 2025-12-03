import { injectable } from 'tsyringe';
import {
  CreateInstallmentService,
  CreateInstallmentWithCreditCardService,
  GetInstallmentService,
  DeleteInstallmentService,
  ListInstallmentsService,
} from './installments';

@injectable()
export class AsaasInstallmentBasicServices {
  public readonly create: CreateInstallmentService;
  public readonly createWithCreditCard: CreateInstallmentWithCreditCardService;
  public readonly get: GetInstallmentService;
  public readonly delete: DeleteInstallmentService;
  public readonly list: ListInstallmentsService;

  constructor(
    create: CreateInstallmentService,
    createWithCreditCard: CreateInstallmentWithCreditCardService,
    get: GetInstallmentService,
    deleteService: DeleteInstallmentService,
    list: ListInstallmentsService
  ) {
    this.create = create;
    this.createWithCreditCard = createWithCreditCard;
    this.get = get;
    this.delete = deleteService;
    this.list = list;
  }
}
