import { injectable, inject } from 'tsyringe';
import {
  ListPaymentRefundsService,
  RefundBankSlipService,
  RefundPaymentLeanService,
  RefundPaymentService,
} from './refunds';

@injectable()
export class AsaasRefundsServices {
  public readonly list: ListPaymentRefundsService;
  public readonly refundBankSlip: RefundBankSlipService;
  public readonly refundPaymentLean: RefundPaymentLeanService;
  public readonly refundPayment: RefundPaymentService;

  constructor(
    @inject(ListPaymentRefundsService)
    list: ListPaymentRefundsService,
    @inject(RefundBankSlipService)
    refundBankSlip: RefundBankSlipService,
    @inject(RefundPaymentLeanService)
    refundPaymentLean: RefundPaymentLeanService,
    @inject(RefundPaymentService)
    refundPayment: RefundPaymentService
  ) {
    this.list = list;
    this.refundBankSlip = refundBankSlip;
    this.refundPaymentLean = refundPaymentLean;
    this.refundPayment = refundPayment;
  }
}
