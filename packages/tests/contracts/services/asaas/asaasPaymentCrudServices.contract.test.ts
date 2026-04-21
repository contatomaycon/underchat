import 'reflect-metadata';
import { AsaasPaymentCrudServices } from '@core/services/asaas/asaasPaymentCrudServices';

describe('AsaasPaymentCrudServices', () => {
  it('stores injected payment crud services', () => {
    const create = { createPayment: jest.fn() } as never;
    const createCreditCard = { createCreditCardPayment: jest.fn() } as never;
    const get = { getPayment: jest.fn() } as never;
    const update = { updatePayment: jest.fn() } as never;
    const deleteService = { deletePayment: jest.fn() } as never;
    const restore = { restorePayment: jest.fn() } as never;

    const service = new AsaasPaymentCrudServices(
      create,
      createCreditCard,
      get,
      update,
      deleteService,
      restore
    );

    expect(service.create).toBe(create);
    expect(service.createCreditCard).toBe(createCreditCard);
    expect(service.get).toBe(get);
    expect(service.update).toBe(update);
    expect(service.delete).toBe(deleteService);
    expect(service.restore).toBe(restore);
  });
});
