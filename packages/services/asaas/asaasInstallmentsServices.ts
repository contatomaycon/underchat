import { injectable } from 'tsyringe';
import {
  CreateInstallmentService,
  CreateInstallmentWithCreditCardService,
  GetInstallmentService,
  DeleteInstallmentService,
  ListInstallmentsService,
  ListInstallmentPaymentsService,
  GetInstallmentPaymentBookService,
  UpdateInstallmentSplitsService,
  RefundInstallmentService,
} from './installments';

@injectable()
export class AsaasInstallmentsServices {
  public readonly create: CreateInstallmentService;
  public readonly createWithCreditCard: CreateInstallmentWithCreditCardService;
  public readonly get: GetInstallmentService;
  public readonly delete: DeleteInstallmentService;
  public readonly list: ListInstallmentsService;
  public readonly listPayments: ListInstallmentPaymentsService;
  public readonly getPaymentBook: GetInstallmentPaymentBookService;
  public readonly updateSplits: UpdateInstallmentSplitsService;
  public readonly refund: RefundInstallmentService;

  constructor(
    create: CreateInstallmentService,
    createWithCreditCard: CreateInstallmentWithCreditCardService,
    get: GetInstallmentService,
    deleteService: DeleteInstallmentService,
    list: ListInstallmentsService,
    listPayments: ListInstallmentPaymentsService,
    getPaymentBook: GetInstallmentPaymentBookService,
    updateSplits: UpdateInstallmentSplitsService,
    refund: RefundInstallmentService
  ) {
    this.create = create;
    this.createWithCreditCard = createWithCreditCard;
    this.get = get;
    this.delete = deleteService;
    this.list = list;
    this.listPayments = listPayments;
    this.getPaymentBook = getPaymentBook;
    this.updateSplits = updateSplits;
    this.refund = refund;
  }
}
