import 'reflect-metadata';
import * as refunds from '@core/services/asaas/refunds';

describe('asaas/refunds/index', () => {
  it('exports refund services', () => {
    expect(refunds.ListPaymentRefundsService).toBeDefined();
    expect(refunds.RefundBankSlipService).toBeDefined();
    expect(refunds.RefundPaymentLeanService).toBeDefined();
    expect(refunds.RefundPaymentService).toBeDefined();
  });
});
