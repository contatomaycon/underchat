import 'reflect-metadata';
import { AsaasSubscriptionInvoiceSettingsServices } from '@core/services/asaas/asaasSubscriptionInvoiceSettingsServices';

describe('AsaasSubscriptionInvoiceSettingsServices', () => {
  it('stores injected subscription invoice settings services', () => {
    const create = { createSubscriptionInvoiceSettings: jest.fn() } as never;
    const get = { getSubscriptionInvoiceSettings: jest.fn() } as never;
    const update = { updateSubscriptionInvoiceSettings: jest.fn() } as never;
    const deleteService = {
      deleteSubscriptionInvoiceSettings: jest.fn(),
    } as never;

    const service = new AsaasSubscriptionInvoiceSettingsServices(
      create,
      get,
      update,
      deleteService
    );

    expect(service.create).toBe(create);
    expect(service.get).toBe(get);
    expect(service.update).toBe(update);
    expect(service.delete).toBe(deleteService);
  });
});
