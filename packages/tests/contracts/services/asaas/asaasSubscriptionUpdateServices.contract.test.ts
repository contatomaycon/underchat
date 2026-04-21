import 'reflect-metadata';
import { AsaasSubscriptionUpdateServices } from '@core/services/asaas/asaasSubscriptionUpdateServices';

describe('AsaasSubscriptionUpdateServices', () => {
  it('stores injected subscription update services', () => {
    const updateCreditCard = {
      updateSubscriptionCreditCard: jest.fn(),
    } as never;

    const service = new AsaasSubscriptionUpdateServices(updateCreditCard);

    expect(service.updateCreditCard).toBe(updateCreditCard);
  });
});
