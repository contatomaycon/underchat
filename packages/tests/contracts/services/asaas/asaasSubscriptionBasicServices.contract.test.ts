import 'reflect-metadata';
import { AsaasSubscriptionBasicServices } from '@core/services/asaas/asaasSubscriptionBasicServices';

describe('AsaasSubscriptionBasicServices', () => {
  it('proxies subscription basic operations through getters', () => {
    const crud = {
      create: jest.fn(),
      createWithCreditCard: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      list: jest.fn(),
    };

    const updateServices = { updateCreditCard: jest.fn() };

    const service = new AsaasSubscriptionBasicServices(
      crud as never,
      updateServices as never
    );

    expect(service.crud).toBe(crud);
    expect(service.updateServices).toBe(updateServices);
    expect(service.create).toBe(crud.create);
    expect(service.createWithCreditCard).toBe(crud.createWithCreditCard);
    expect(service.get).toBe(crud.get);
    expect(service.update).toBe(crud.update);
    expect(service.delete).toBe(crud.delete);
    expect(service.list).toBe(crud.list);
    expect(service.updateCreditCard).toBe(updateServices.updateCreditCard);
  });
});
