import { injectable } from 'tsyringe';
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
    list: ListPaymentRefundsService,
    refundBankSlip: RefundBankSlipService,
    refundPaymentLean: RefundPaymentLeanService,
    refundPayment: RefundPaymentService
  ) {
    this.list = list;
    this.refundBankSlip = refundBankSlip;
    this.refundPaymentLean = refundPaymentLean;
    this.refundPayment = refundPayment;
  }
}
