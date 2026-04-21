import 'reflect-metadata';
import * as installments from '@core/services/asaas/installments';

describe('asaas/installments/index', () => {
  it('exports installment services', () => {
    expect(installments.CreateInstallmentService).toBeDefined();
    expect(installments.CreateInstallmentWithCreditCardService).toBeDefined();
    expect(installments.GetInstallmentService).toBeDefined();
    expect(installments.DeleteInstallmentService).toBeDefined();
    expect(installments.ListInstallmentsService).toBeDefined();
    expect(installments.ListInstallmentPaymentsService).toBeDefined();
    expect(installments.GetInstallmentPaymentBookService).toBeDefined();
    expect(installments.UpdateInstallmentSplitsService).toBeDefined();
    expect(installments.RefundInstallmentService).toBeDefined();
  });
});
