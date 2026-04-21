import 'reflect-metadata';
import { AsaasInvoicesServices } from '@core/services/asaas/asaasInvoicesServices';

describe('AsaasInvoicesServices', () => {
  it('stores injected invoice services', () => {
    const create = { createInvoice: jest.fn() } as never;
    const list = { listInvoices: jest.fn() } as never;
    const update = { updateInvoice: jest.fn() } as never;
    const get = { getInvoice: jest.fn() } as never;
    const authorize = { authorizeInvoice: jest.fn() } as never;
    const cancel = { cancelInvoice: jest.fn() } as never;

    const service = new AsaasInvoicesServices(
      create,
      list,
      update,
      get,
      authorize,
      cancel
    );

    expect(service.create).toBe(create);
    expect(service.list).toBe(list);
    expect(service.update).toBe(update);
    expect(service.get).toBe(get);
    expect(service.authorize).toBe(authorize);
    expect(service.cancel).toBe(cancel);
  });
});
