import 'reflect-metadata';
import * as invoices from '@core/services/asaas/invoices';

describe('asaas/invoices/index', () => {
  it('exports invoice services', () => {
    expect(invoices.CreateInvoiceService).toBeDefined();
    expect(invoices.ListInvoicesService).toBeDefined();
    expect(invoices.UpdateInvoiceService).toBeDefined();
    expect(invoices.GetInvoiceService).toBeDefined();
    expect(invoices.AuthorizeInvoiceService).toBeDefined();
    expect(invoices.CancelInvoiceService).toBeDefined();
  });
});
