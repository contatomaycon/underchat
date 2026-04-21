import 'reflect-metadata';
import { AsaasPaymentActionServices } from '@core/services/asaas/asaasPaymentActionServices';

describe('AsaasPaymentActionServices', () => {
  it('stores injected payment action services', () => {
    const captureAuthorized = { captureAuthorizedPayment: jest.fn() } as never;
    const payWithCreditCard = { payWithCreditCard: jest.fn() } as never;

    const service = new AsaasPaymentActionServices(
      captureAuthorized,
      payWithCreditCard
    );

    expect(service.captureAuthorized).toBe(captureAuthorized);
    expect(service.payWithCreditCard).toBe(payWithCreditCard);
  });
});
