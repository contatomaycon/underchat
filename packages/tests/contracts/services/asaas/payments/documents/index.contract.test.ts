import 'reflect-metadata';
import * as documents from '@core/services/asaas/payments/documents';

describe('asaas/payments/documents/index', () => {
  it('exports payment document services', () => {
    expect(documents.UploadPaymentDocumentService).toBeDefined();
    expect(documents.ListPaymentDocumentsService).toBeDefined();
    expect(documents.GetPaymentDocumentService).toBeDefined();
    expect(documents.UpdatePaymentDocumentService).toBeDefined();
    expect(documents.DeletePaymentDocumentService).toBeDefined();
  });
});
