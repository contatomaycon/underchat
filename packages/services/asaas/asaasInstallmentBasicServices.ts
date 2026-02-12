import { injectable, inject } from 'tsyringe';
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
    @inject(CreateInstallmentService)
    create: CreateInstallmentService,
    @inject(CreateInstallmentWithCreditCardService)
    createWithCreditCard: CreateInstallmentWithCreditCardService,
    @inject(GetInstallmentService)
    get: GetInstallmentService,
    @inject(DeleteInstallmentService)
    deleteService: DeleteInstallmentService,
    @inject(ListInstallmentsService)
    list: ListInstallmentsService
  ) {
    this.create = create;
    this.createWithCreditCard = createWithCreditCard;
    this.get = get;
    this.delete = deleteService;
    this.list = list;
  }
}
