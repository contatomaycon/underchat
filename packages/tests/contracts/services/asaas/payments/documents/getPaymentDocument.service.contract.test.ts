import 'reflect-metadata';
import axios from 'axios';
import { GetPaymentDocumentService } from '@core/services/asaas/payments/documents/getPaymentDocument.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('GetPaymentDocumentService', () => {
  it('returns data when response is 200', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { id: 'doc_1' } }));
    const service = new GetPaymentDocumentService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentDocument('pay_1', 'doc_1')).resolves.toEqual(
      {
        id: 'doc_1',
      }
    );

    expect(get).toHaveBeenCalledWith('/v3/payments/pay_1/documents/doc_1');
  });

  it('returns null when response is not 200', async () => {
    const get = jest.fn(async () => ({ status: 202, data: { id: 'doc_1' } }));
    const service = new GetPaymentDocumentService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(
      service.getPaymentDocument('pay_1', 'doc_1')
    ).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const get = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'get-doc-fail' }] } },
      };
    });
    const service = new GetPaymentDocumentService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentDocument('pay_1', 'doc_1')).rejects.toThrow(
      'get-doc-fail'
    );
  });

  it('throws default axios message when no description is available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const get = jest.fn(async () => {
      throw { response: { data: {} } };
    });
    const service = new GetPaymentDocumentService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentDocument('pay_1', 'doc_1')).rejects.toThrow(
      'Erro ao recuperar documento da cobrança'
    );
  });

  it('throws unknown message for non-axios errors', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(false);
    const get = jest.fn(async () => {
      throw new Error('boom');
    });
    const service = new GetPaymentDocumentService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentDocument('pay_1', 'doc_1')).rejects.toThrow(
      'Erro desconhecido ao recuperar documento da cobrança'
    );
  });
});
