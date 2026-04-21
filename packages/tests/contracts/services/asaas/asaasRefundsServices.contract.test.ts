import 'reflect-metadata';
import { AsaasRefundsServices } from '@core/services/asaas/asaasRefundsServices';

describe('AsaasRefundsServices', () => {
  it('stores injected refund services', () => {
    const list = { listPaymentRefunds: jest.fn() } as never;
    const refundBankSlip = { refundBankSlip: jest.fn() } as never;
    const refundPaymentLean = { refundPaymentLean: jest.fn() } as never;
    const refundPayment = { refundPayment: jest.fn() } as never;

    const service = new AsaasRefundsServices(
      list,
      refundBankSlip,
      refundPaymentLean,
      refundPayment
    );

    expect(service.list).toBe(list);
    expect(service.refundBankSlip).toBe(refundBankSlip);
    expect(service.refundPaymentLean).toBe(refundPaymentLean);
    expect(service.refundPayment).toBe(refundPayment);
  });
});
