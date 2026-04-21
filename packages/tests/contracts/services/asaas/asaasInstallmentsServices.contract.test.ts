import 'reflect-metadata';
import { AsaasInstallmentsServices } from '@core/services/asaas/asaasInstallmentsServices';

describe('AsaasInstallmentsServices', () => {
  it('exposes basic and advanced installment operations through getters', () => {
    const basic = {
      create: jest.fn(),
      createWithCreditCard: jest.fn(),
      get: jest.fn(),
      delete: jest.fn(),
      list: jest.fn(),
    };

    const advanced = {
      listPayments: jest.fn(),
      getPaymentBook: jest.fn(),
      updateSplits: jest.fn(),
      refund: jest.fn(),
    };

    const service = new AsaasInstallmentsServices(
      basic as never,
      advanced as never
    );

    expect(service.basic).toBe(basic);
    expect(service.advanced).toBe(advanced);
    expect(service.create).toBe(basic.create);
    expect(service.createWithCreditCard).toBe(basic.createWithCreditCard);
    expect(service.get).toBe(basic.get);
    expect(service.delete).toBe(basic.delete);
    expect(service.list).toBe(basic.list);
    expect(service.listPayments).toBe(advanced.listPayments);
    expect(service.getPaymentBook).toBe(advanced.getPaymentBook);
    expect(service.updateSplits).toBe(advanced.updateSplits);
    expect(service.refund).toBe(advanced.refund);
  });
});
