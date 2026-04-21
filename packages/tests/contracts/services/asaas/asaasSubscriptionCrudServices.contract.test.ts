import 'reflect-metadata';
import { AsaasSubscriptionCrudServices } from '@core/services/asaas/asaasSubscriptionCrudServices';

describe('AsaasSubscriptionCrudServices', () => {
  it('stores injected subscription crud services', () => {
    const create = { createSubscription: jest.fn() } as never;
    const createWithCreditCard = {
      createSubscriptionWithCreditCard: jest.fn(),
    } as never;
    const get = { getSubscription: jest.fn() } as never;
    const update = { updateSubscription: jest.fn() } as never;
    const deleteService = { deleteSubscription: jest.fn() } as never;
    const list = { listSubscriptions: jest.fn() } as never;

    const service = new AsaasSubscriptionCrudServices(
      create,
      createWithCreditCard,
      get,
      update,
      deleteService,
      list
    );

    expect(service.create).toBe(create);
    expect(service.createWithCreditCard).toBe(createWithCreditCard);
    expect(service.get).toBe(get);
    expect(service.update).toBe(update);
    expect(service.delete).toBe(deleteService);
    expect(service.list).toBe(list);
  });
});
