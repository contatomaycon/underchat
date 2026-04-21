import 'reflect-metadata';
import { AsaasSubscriptionRelatedServices } from '@core/services/asaas/asaasSubscriptionRelatedServices';

describe('AsaasSubscriptionRelatedServices', () => {
  it('stores injected subscription related services', () => {
    const listPayments = { listSubscriptionPayments: jest.fn() } as never;
    const getPaymentBook = { getSubscriptionPaymentBook: jest.fn() } as never;
    const invoiceSettings = { create: jest.fn() } as never;
    const listInvoices = { listSubscriptionInvoices: jest.fn() } as never;

    const service = new AsaasSubscriptionRelatedServices(
      listPayments,
      getPaymentBook,
      invoiceSettings,
      listInvoices
    );

    expect(service.listPayments).toBe(listPayments);
    expect(service.getPaymentBook).toBe(getPaymentBook);
    expect(service.invoiceSettings).toBe(invoiceSettings);
    expect(service.listInvoices).toBe(listInvoices);
  });
});
