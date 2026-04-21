import 'reflect-metadata';
import axios from 'axios';
import { GetSubscriptionPaymentBookService } from '@core/services/asaas/subscriptions/getSubscriptionPaymentBook.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('GetSubscriptionPaymentBookService', () => {
  it('returns payment book as array buffer when response is 200', async () => {
    const pdf = new ArrayBuffer(8);
    const get = jest.fn(async () => ({ status: 200, data: pdf }));
    const service = new GetSubscriptionPaymentBookService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(
      service.getSubscriptionPaymentBook('sub_1', {
        month: 1,
        year: 2026,
        sort: 'asc',
        order: 'id',
      } as never)
    ).resolves.toBe(pdf);

    expect(get).toHaveBeenCalledWith(
      '/v3/subscriptions/sub_1/paymentBook?month=1&year=2026&sort=asc&order=id',
      {
        responseType: 'arraybuffer',
        headers: {
          Accept: 'application/pdf',
        },
      }
    );
  });

  it('uses base endpoint when request is not provided', async () => {
    const pdf = new ArrayBuffer(8);
    const get = jest.fn(async () => ({ status: 200, data: pdf }));
    const service = new GetSubscriptionPaymentBookService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await service.getSubscriptionPaymentBook('sub_1');
    expect(get).toHaveBeenCalledWith('/v3/subscriptions/sub_1/paymentBook', {
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
    const service = new GetSubscriptionPaymentBookService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(
      service.getSubscriptionPaymentBook('sub_1')
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
        response: { data: { errors: [{ description: 'payment-book-fail' }] } },
      };
    });
    const service = new GetSubscriptionPaymentBookService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getSubscriptionPaymentBook('sub_1')).rejects.toThrow(
      'payment-book-fail'
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
    const service = new GetSubscriptionPaymentBookService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getSubscriptionPaymentBook('sub_1')).rejects.toThrow(
      'Erro desconhecido ao gerar carnê da assinatura'
    );
  });
});
