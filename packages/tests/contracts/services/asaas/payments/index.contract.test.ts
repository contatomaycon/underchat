import 'reflect-metadata';
import * as payments from '@core/services/asaas/payments';

describe('asaas/payments/index', () => {
  it('exports payment services', () => {
    expect(payments.CreatePaymentService).toBeDefined();
    expect(payments.CreateCreditCardPaymentService).toBeDefined();
    expect(payments.CaptureAuthorizedPaymentService).toBeDefined();
    expect(payments.PayWithCreditCardService).toBeDefined();
    expect(payments.GetPaymentService).toBeDefined();
    expect(payments.UpdatePaymentService).toBeDefined();
    expect(payments.DeletePaymentService).toBeDefined();
    expect(payments.RestorePaymentService).toBeDefined();
    expect(payments.GetPaymentStatusService).toBeDefined();
    expect(payments.GetPaymentIdentificationFieldService).toBeDefined();
    expect(payments.GetPaymentPixQrCodeService).toBeDefined();
    expect(payments.GetPaymentBillingInfoService).toBeDefined();
    expect(payments.GetPaymentViewingInfoService).toBeDefined();
    expect(payments.ListPaymentsService).toBeDefined();
  });
});
