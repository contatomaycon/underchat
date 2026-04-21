import 'reflect-metadata';
import axios from 'axios';
import { GetSubscriptionService } from '@core/services/asaas/subscriptions/getSubscription.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('GetSubscriptionService', () => {
  it('returns data when response is 200', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { id: 'sub_1' } }));
    const service = new GetSubscriptionService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getSubscription('sub_1')).resolves.toEqual({
      id: 'sub_1',
    });

    expect(get).toHaveBeenCalledWith('/v3/subscriptions/sub_1');
  });

  it('returns null when response is not 200', async () => {
    const get = jest.fn(async () => ({ status: 202, data: { id: 'sub_1' } }));
    const service = new GetSubscriptionService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getSubscription('sub_1')).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const get = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'get-sub-fail' }] } },
      };
    });
    const service = new GetSubscriptionService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getSubscription('sub_1')).rejects.toThrow(
      'get-sub-fail'
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
    const service = new GetSubscriptionService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getSubscription('sub_1')).rejects.toThrow(
      'Erro ao recuperar assinatura'
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
    const service = new GetSubscriptionService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getSubscription('sub_1')).rejects.toThrow(
      'Erro desconhecido ao recuperar assinatura'
    );
  });
});
