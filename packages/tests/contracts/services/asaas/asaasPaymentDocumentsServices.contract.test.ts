import 'reflect-metadata';
import { AsaasPaymentDocumentsServices } from '@core/services/asaas/asaasPaymentDocumentsServices';

describe('AsaasPaymentDocumentsServices', () => {
  it('stores injected payment document services', () => {
    const upload = { uploadPaymentDocument: jest.fn() } as never;
    const list = { listPaymentDocuments: jest.fn() } as never;
    const get = { getPaymentDocument: jest.fn() } as never;
    const update = { updatePaymentDocument: jest.fn() } as never;
    const deleteService = { deletePaymentDocument: jest.fn() } as never;

    const service = new AsaasPaymentDocumentsServices(
      upload,
      list,
      get,
      update,
      deleteService
    );

    expect(service.upload).toBe(upload);
    expect(service.list).toBe(list);
    expect(service.get).toBe(get);
    expect(service.update).toBe(update);
    expect(service.delete).toBe(deleteService);
  });
});
