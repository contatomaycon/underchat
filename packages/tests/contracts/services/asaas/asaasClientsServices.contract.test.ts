import 'reflect-metadata';
import { AsaasClientsServices } from '@core/services/asaas/asaasClientsServices';

describe('AsaasClientsServices', () => {
  it('stores all injected client services', () => {
    const create = { createCustomer: jest.fn() } as never;
    const list = { listCustomers: jest.fn() } as never;
    const get = { getCustomer: jest.fn() } as never;
    const update = { updateCustomer: jest.fn() } as never;
    const deleteService = { deleteCustomer: jest.fn() } as never;
    const restore = { restoreCustomer: jest.fn() } as never;
    const getNotifications = { getCustomerNotifications: jest.fn() } as never;

    const service = new AsaasClientsServices(
      create,
      list,
      get,
      update,
      deleteService,
      restore,
      getNotifications
    );

    expect(service.create).toBe(create);
    expect(service.list).toBe(list);
    expect(service.get).toBe(get);
    expect(service.update).toBe(update);
    expect(service.delete).toBe(deleteService);
    expect(service.restore).toBe(restore);
    expect(service.getNotifications).toBe(getNotifications);
  });
});
