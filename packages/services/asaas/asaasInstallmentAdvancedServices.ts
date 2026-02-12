import { injectable, inject } from 'tsyringe';
import {
  ListInstallmentPaymentsService,
  GetInstallmentPaymentBookService,
  UpdateInstallmentSplitsService,
  RefundInstallmentService,
} from './installments';

@injectable()
export class AsaasInstallmentAdvancedServices {
  public readonly listPayments: ListInstallmentPaymentsService;
  public readonly getPaymentBook: GetInstallmentPaymentBookService;
  public readonly updateSplits: UpdateInstallmentSplitsService;
  public readonly refund: RefundInstallmentService;

  constructor(
    @inject(ListInstallmentPaymentsService)
    listPayments: ListInstallmentPaymentsService,
    @inject(GetInstallmentPaymentBookService)
    getPaymentBook: GetInstallmentPaymentBookService,
    @inject(UpdateInstallmentSplitsService)
    updateSplits: UpdateInstallmentSplitsService,
    @inject(RefundInstallmentService)
    refund: RefundInstallmentService
  ) {
    this.listPayments = listPayments;
    this.getPaymentBook = getPaymentBook;
    this.updateSplits = updateSplits;
    this.refund = refund;
  }
}
