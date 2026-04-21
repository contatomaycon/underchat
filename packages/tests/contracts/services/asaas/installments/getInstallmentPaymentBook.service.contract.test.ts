import 'reflect-metadata';
import axios from 'axios';
import { GetInstallmentPaymentBookService } from '@core/services/asaas/installments/getInstallmentPaymentBook.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('GetInstallmentPaymentBookService', () => {
  it('returns payment book as array buffer when response is 200', async () => {
    const pdf = new ArrayBuffer(8);
    const get = jest.fn(async () => ({ status: 200, data: pdf }));
    const service = new GetInstallmentPaymentBookService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(
      service.getInstallmentPaymentBook('ins_1', {
        sort: 'asc',
        order: 'id',
      } as never)
    ).resolves.toBe(pdf);

    expect(get).toHaveBeenCalledWith(
      '/v3/installments/ins_1/paymentBook?sort=asc&order=id',
      {
        responseType: 'arraybuffer',
        headers: {
          Accept: 'application/pdf',
        },
      }
    );
  });

  it('uses base url without query params when request is undefined', async () => {
    const pdf = new ArrayBuffer(8);
    const get = jest.fn(async () => ({ status: 200, data: pdf }));
    const service = new GetInstallmentPaymentBookService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await service.getInstallmentPaymentBook('ins_1');

    expect(get).toHaveBeenCalledWith('/v3/installments/ins_1/paymentBook', {
      responseType: 'arraybuffer',
      headers: {
        Accept: 'application/pdf',
      },
    });
  });

  it('returns null when response is not 200', async () => {
    const get = jest.fn(async () => ({
      status: 202,
      data: new ArrayBuffer(8),
    }));
    const service = new GetInstallmentPaymentBookService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(
      service.getInstallmentPaymentBook('ins_1')
    ).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const get = jest.fn(async () => {
      throw { response: { data: { errors: [{ description: 'book-fail' }] } } };
    });
    const service = new GetInstallmentPaymentBookService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getInstallmentPaymentBook('ins_1')).rejects.toThrow(
      'book-fail'
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
    const service = new GetInstallmentPaymentBookService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getInstallmentPaymentBook('ins_1')).rejects.toThrow(
      'Erro desconhecido ao gerar carnê de parcelamento'
    );
  });
});
