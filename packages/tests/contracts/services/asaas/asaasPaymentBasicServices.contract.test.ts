import 'reflect-metadata';
import { AsaasPaymentBasicServices } from '@core/services/asaas/asaasPaymentBasicServices';

describe('AsaasPaymentBasicServices', () => {
  it('proxies crud and action operations through getters', () => {
    const crud = {
      create: jest.fn(),
      createCreditCard: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      restore: jest.fn(),
    };

    const actions = {
      captureAuthorized: jest.fn(),
      payWithCreditCard: jest.fn(),
    };

    const service = new AsaasPaymentBasicServices(
      crud as never,
      actions as never
    );

    expect(service.crud).toBe(crud);
    expect(service.actions).toBe(actions);
    expect(service.create).toBe(crud.create);
    expect(service.createCreditCard).toBe(crud.createCreditCard);
    expect(service.get).toBe(crud.get);
    expect(service.update).toBe(crud.update);
    expect(service.delete).toBe(crud.delete);
    expect(service.restore).toBe(crud.restore);
    expect(service.captureAuthorized).toBe(actions.captureAuthorized);
    expect(service.payWithCreditCard).toBe(actions.payWithCreditCard);
  });
});
