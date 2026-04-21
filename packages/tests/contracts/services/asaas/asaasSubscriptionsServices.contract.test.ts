import 'reflect-metadata';
import { AsaasSubscriptionsServices } from '@core/services/asaas/asaasSubscriptionsServices';

describe('AsaasSubscriptionsServices', () => {
  it('proxies subscription operations through basic and related groups', () => {
    const basic = {
      create: jest.fn(),
      createWithCreditCard: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      updateCreditCard: jest.fn(),
      delete: jest.fn(),
      list: jest.fn(),
    };

    const related = {
      listPayments: jest.fn(),
      getPaymentBook: jest.fn(),
      invoiceSettings: { create: jest.fn() },
      listInvoices: jest.fn(),
    };

    const service = new AsaasSubscriptionsServices(
      basic as never,
      related as never
    );

    expect(service.basic).toBe(basic);
    expect(service.related).toBe(related);
    expect(service.create).toBe(basic.create);
    expect(service.createWithCreditCard).toBe(basic.createWithCreditCard);
    expect(service.get).toBe(basic.get);
    expect(service.update).toBe(basic.update);
    expect(service.updateCreditCard).toBe(basic.updateCreditCard);
    expect(service.delete).toBe(basic.delete);
    expect(service.list).toBe(basic.list);
    expect(service.listPayments).toBe(related.listPayments);
    expect(service.getPaymentBook).toBe(related.getPaymentBook);
    expect(service.invoiceSettings).toBe(related.invoiceSettings);
    expect(service.listInvoices).toBe(related.listInvoices);
  });
});
