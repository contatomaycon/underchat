import 'reflect-metadata';
import { AsaasCheckoutServices } from '@core/services/asaas/asaasCheckoutServices';

describe('AsaasCheckoutServices', () => {
  it('stores injected checkout services', () => {
    const create = { createCheckout: jest.fn() } as never;
    const cancel = { cancelCheckout: jest.fn() } as never;

    const service = new AsaasCheckoutServices(create, cancel);

    expect(service.create).toBe(create);
    expect(service.cancel).toBe(cancel);
  });
});
