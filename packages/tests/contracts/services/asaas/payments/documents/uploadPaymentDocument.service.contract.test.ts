import 'reflect-metadata';
import axios from 'axios';
import { UploadPaymentDocumentService } from '@core/services/asaas/payments/documents/uploadPaymentDocument.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('UploadPaymentDocumentService', () => {
  it('uploads document and returns data when status is 200', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'doc_1' } }));
    const service = new UploadPaymentDocumentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.uploadPaymentDocument('pay_1', {
        file: new Blob(['file']),
        type: 'INVOICE',
        availableAfterPayment: true,
      } as never)
    ).resolves.toEqual({ id: 'doc_1' });

    expect(post).toHaveBeenCalledWith(
      '/v3/payments/pay_1/documents',
      expect.any(FormData),
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );
  });

  it('returns null when response is not 200', async () => {
    const post = jest.fn(async () => ({ status: 202, data: { id: 'doc_1' } }));
    const service = new UploadPaymentDocumentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.uploadPaymentDocument('pay_1', {
        file: new Blob(['file']),
        type: 'INVOICE',
        availableAfterPayment: true,
      } as never)
    ).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const post = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'upload-doc-fail' }] } },
      };
    });
    const service = new UploadPaymentDocumentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.uploadPaymentDocument('pay_1', {
        file: new Blob(['file']),
        type: 'INVOICE',
        availableAfterPayment: true,
      } as never)
    ).rejects.toThrow('upload-doc-fail');
  });

  it('throws default axios message when no description is available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const post = jest.fn(async () => {
      throw { response: { data: {} } };
    });
    const service = new UploadPaymentDocumentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.uploadPaymentDocument('pay_1', {
        file: new Blob(['file']),
        type: 'INVOICE',
        availableAfterPayment: true,
      } as never)
    ).rejects.toThrow('Erro ao fazer upload de documento da cobrança');
  });

  it('throws unknown message for non-axios errors', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(false);
    const post = jest.fn(async () => {
      throw new Error('boom');
    });
    const service = new UploadPaymentDocumentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.uploadPaymentDocument('pay_1', {
        file: new Blob(['file']),
        type: 'INVOICE',
        availableAfterPayment: true,
      } as never)
    ).rejects.toThrow(
      'Erro desconhecido ao fazer upload de documento da cobrança'
    );
  });
});
