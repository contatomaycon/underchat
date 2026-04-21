import 'reflect-metadata';
import { AsaasInstallmentBasicServices } from '@core/services/asaas/asaasInstallmentBasicServices';

describe('AsaasInstallmentBasicServices', () => {
  it('stores injected basic installment services', () => {
    const create = { createInstallment: jest.fn() } as never;
    const createWithCreditCard = {
      createInstallmentWithCreditCard: jest.fn(),
    } as never;
    const get = { getInstallment: jest.fn() } as never;
    const deleteService = { deleteInstallment: jest.fn() } as never;
    const list = { listInstallments: jest.fn() } as never;

    const service = new AsaasInstallmentBasicServices(
      create,
      createWithCreditCard,
      get,
      deleteService,
      list
    );

    expect(service.create).toBe(create);
    expect(service.createWithCreditCard).toBe(createWithCreditCard);
    expect(service.get).toBe(get);
    expect(service.delete).toBe(deleteService);
    expect(service.list).toBe(list);
  });
});
