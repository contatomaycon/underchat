import { injectable } from 'tsyringe';
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
    listPayments: ListInstallmentPaymentsService,
    getPaymentBook: GetInstallmentPaymentBookService,
    updateSplits: UpdateInstallmentSplitsService,
    refund: RefundInstallmentService
  ) {
    this.listPayments = listPayments;
    this.getPaymentBook = getPaymentBook;
    this.updateSplits = updateSplits;
    this.refund = refund;
  }
}
