import 'reflect-metadata';
import axios from 'axios';
import { ListSubscriptionPaymentsService } from '@core/services/asaas/subscriptions/listSubscriptionPayments.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('ListSubscriptionPaymentsService', () => {
  it('lists subscription payments with query string when request is provided', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { data: [] } }));
    const service = new ListSubscriptionPaymentsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(
      service.listSubscriptionPayments('sub_1', { status: 'PENDING' } as never)
    ).resolves.toEqual({ data: [] });

    expect(get).toHaveBeenCalledWith(
      '/v3/subscriptions/sub_1/payments?status=PENDING'
    );
  });

  it('uses base endpoint when request is not provided', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { data: [] } }));
    const service = new ListSubscriptionPaymentsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listSubscriptionPayments('sub_1')).resolves.toEqual({
      data: [],
    });

    expect(get).toHaveBeenCalledWith('/v3/subscriptions/sub_1/payments');
  });

  it('returns null when response is not 200', async () => {
    const get = jest.fn(async () => ({ status: 202, data: { data: [] } }));
    const service = new ListSubscriptionPaymentsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listSubscriptionPayments('sub_1')).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const get = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'list-sub-pay-fail' }] } },
      };
    });
    const service = new ListSubscriptionPaymentsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listSubscriptionPayments('sub_1')).rejects.toThrow(
      'list-sub-pay-fail'
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
    const service = new ListSubscriptionPaymentsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listSubscriptionPayments('sub_1')).rejects.toThrow(
      'Erro desconhecido ao listar cobranças da assinatura'
    );
  });
});
