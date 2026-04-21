import 'reflect-metadata';
import axios from 'axios';
import { DeleteSubscriptionService } from '@core/services/asaas/subscriptions/deleteSubscription.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('DeleteSubscriptionService', () => {
  it('returns data when response is 200', async () => {
    const deleteFn = jest.fn(async () => ({
      status: 200,
      data: { id: 'sub_1' },
    }));
    const service = new DeleteSubscriptionService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(service.deleteSubscription('sub_1')).resolves.toEqual({
      id: 'sub_1',
    });

    expect(deleteFn).toHaveBeenCalledWith('/v3/subscriptions/sub_1');
  });

  it('returns null when response is not 200', async () => {
    const deleteFn = jest.fn(async () => ({
      status: 202,
      data: { id: 'sub_1' },
    }));
    const service = new DeleteSubscriptionService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(service.deleteSubscription('sub_1')).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const deleteFn = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'delete-sub-fail' }] } },
      };
    });
    const service = new DeleteSubscriptionService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(service.deleteSubscription('sub_1')).rejects.toThrow(
      'delete-sub-fail'
    );
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
    const service = new DeleteSubscriptionService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(service.deleteSubscription('sub_1')).rejects.toThrow(
      'Erro ao remover assinatura'
    );
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
    const service = new DeleteSubscriptionService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(service.deleteSubscription('sub_1')).rejects.toThrow(
      'Erro desconhecido ao remover assinatura'
    );
  });
});
