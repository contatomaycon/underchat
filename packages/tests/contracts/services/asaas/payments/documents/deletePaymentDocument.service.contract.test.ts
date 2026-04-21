import 'reflect-metadata';
import axios from 'axios';
import { DeletePaymentDocumentService } from '@core/services/asaas/payments/documents/deletePaymentDocument.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('DeletePaymentDocumentService', () => {
  it('returns data when response is 200', async () => {
    const deleteFn = jest.fn(async () => ({
      status: 200,
      data: { id: 'doc_1' },
    }));
    const service = new DeletePaymentDocumentService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(
      service.deletePaymentDocument('pay_1', 'doc_1')
    ).resolves.toEqual({
      id: 'doc_1',
    });

    expect(deleteFn).toHaveBeenCalledWith('/v3/payments/pay_1/documents/doc_1');
  });

  it('returns null when response is not 200', async () => {
    const deleteFn = jest.fn(async () => ({
      status: 202,
      data: { id: 'doc_1' },
    }));
    const service = new DeletePaymentDocumentService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(
      service.deletePaymentDocument('pay_1', 'doc_1')
    ).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const deleteFn = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'delete-doc-fail' }] } },
      };
    });
    const service = new DeletePaymentDocumentService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(
      service.deletePaymentDocument('pay_1', 'doc_1')
    ).rejects.toThrow('delete-doc-fail');
  });

  it('throws default axios message when no description is available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const deleteFn = jest.fn(async () => {
      throw { response: { data: {} } };
    });
    const service = new DeletePaymentDocumentService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(
      service.deletePaymentDocument('pay_1', 'doc_1')
    ).rejects.toThrow('Erro ao excluir documento da cobrança');
  });

  it('throws unknown message for non-axios errors', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(false);
    const deleteFn = jest.fn(async () => {
      throw new Error('boom');
    });
    const service = new DeletePaymentDocumentService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(
      service.deletePaymentDocument('pay_1', 'doc_1')
    ).rejects.toThrow('Erro desconhecido ao excluir documento da cobrança');
  });
});
