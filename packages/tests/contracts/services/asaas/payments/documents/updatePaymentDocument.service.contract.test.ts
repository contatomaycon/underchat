import 'reflect-metadata';
import axios from 'axios';
import { UpdatePaymentDocumentService } from '@core/services/asaas/payments/documents/updatePaymentDocument.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('UpdatePaymentDocumentService', () => {
  it('returns data when response is 200', async () => {
    const put = jest.fn(async () => ({ status: 200, data: { id: 'doc_1' } }));
    const service = new UpdatePaymentDocumentService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updatePaymentDocument('pay_1', 'doc_1', {
        type: 'INVOICE',
      } as never)
    ).resolves.toEqual({
      id: 'doc_1',
    });

    expect(put).toHaveBeenCalledWith('/v3/payments/pay_1/documents/doc_1', {
      type: 'INVOICE',
    });
  });

  it('returns null when response is not 200', async () => {
    const put = jest.fn(async () => ({ status: 202, data: { id: 'doc_1' } }));
    const service = new UpdatePaymentDocumentService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updatePaymentDocument('pay_1', 'doc_1', {} as never)
    ).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const put = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'update-doc-fail' }] } },
      };
    });
    const service = new UpdatePaymentDocumentService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updatePaymentDocument('pay_1', 'doc_1', {} as never)
    ).rejects.toThrow('update-doc-fail');
  });

  it('throws default axios message when no description is available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const put = jest.fn(async () => {
      throw { response: { data: {} } };
    });
    const service = new UpdatePaymentDocumentService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updatePaymentDocument('pay_1', 'doc_1', {} as never)
    ).rejects.toThrow('Erro ao atualizar documento da cobrança');
  });

  it('throws unknown message for non-axios errors', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(false);
    const put = jest.fn(async () => {
      throw new Error('boom');
    });
    const service = new UpdatePaymentDocumentService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updatePaymentDocument('pay_1', 'doc_1', {} as never)
    ).rejects.toThrow('Erro desconhecido ao atualizar documento da cobrança');
  });
});
