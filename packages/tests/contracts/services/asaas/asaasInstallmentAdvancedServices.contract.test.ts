import 'reflect-metadata';
import { AsaasInstallmentAdvancedServices } from '@core/services/asaas/asaasInstallmentAdvancedServices';

describe('AsaasInstallmentAdvancedServices', () => {
  it('stores injected advanced installment services', () => {
    const listPayments = { listInstallmentPayments: jest.fn() } as never;
    const getPaymentBook = { getInstallmentPaymentBook: jest.fn() } as never;
    const updateSplits = { updateInstallmentSplits: jest.fn() } as never;
    const refund = { refundInstallment: jest.fn() } as never;

    const service = new AsaasInstallmentAdvancedServices(
      listPayments,
      getPaymentBook,
      updateSplits,
      refund
    );

    expect(service.listPayments).toBe(listPayments);
    expect(service.getPaymentBook).toBe(getPaymentBook);
    expect(service.updateSplits).toBe(updateSplits);
    expect(service.refund).toBe(refund);
  });
});
