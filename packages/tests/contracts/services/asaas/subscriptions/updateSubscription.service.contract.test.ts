import 'reflect-metadata';
import axios from 'axios';
import { UpdateSubscriptionService } from '@core/services/asaas/subscriptions/updateSubscription.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('UpdateSubscriptionService', () => {
  it('returns data when response is 200', async () => {
    const put = jest.fn(async () => ({ status: 200, data: { id: 'sub_1' } }));
    const service = new UpdateSubscriptionService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updateSubscription('sub_1', { value: 10 } as never)
    ).resolves.toEqual({
      id: 'sub_1',
    });

    expect(put).toHaveBeenCalledWith('/v3/subscriptions/sub_1', { value: 10 });
  });

  it('returns null when response is not 200', async () => {
    const put = jest.fn(async () => ({ status: 202, data: { id: 'sub_1' } }));
    const service = new UpdateSubscriptionService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updateSubscription('sub_1', {} as never)
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
        response: { data: { errors: [{ description: 'update-sub-fail' }] } },
      };
    });
    const service = new UpdateSubscriptionService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updateSubscription('sub_1', {} as never)
    ).rejects.toThrow('update-sub-fail');
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
    const service = new UpdateSubscriptionService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updateSubscription('sub_1', {} as never)
    ).rejects.toThrow('Erro ao atualizar assinatura');
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
    const service = new UpdateSubscriptionService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updateSubscription('sub_1', {} as never)
    ).rejects.toThrow('Erro desconhecido ao atualizar assinatura');
  });
});
