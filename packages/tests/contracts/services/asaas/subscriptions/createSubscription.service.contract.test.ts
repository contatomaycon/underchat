import 'reflect-metadata';
import axios from 'axios';
import { CreateSubscriptionService } from '@core/services/asaas/subscriptions/createSubscription.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('CreateSubscriptionService', () => {
  it('returns data when response is 200', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'sub_1' } }));
    const service = new CreateSubscriptionService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createSubscription({} as never)).resolves.toEqual({
      id: 'sub_1',
    });
  });

  it('returns null when response is not 200', async () => {
    const post = jest.fn(async () => ({ status: 202, data: { id: 'sub_1' } }));
    const service = new CreateSubscriptionService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createSubscription({} as never)).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const post = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'create-sub-fail' }] } },
      };
    });
    const service = new CreateSubscriptionService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createSubscription({} as never)).rejects.toThrow(
      'create-sub-fail'
    );
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
    const service = new CreateSubscriptionService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createSubscription({} as never)).rejects.toThrow(
      'Erro ao criar assinatura'
    );
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
    const service = new CreateSubscriptionService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createSubscription({} as never)).rejects.toThrow(
      'Erro desconhecido ao criar assinatura'
    );
  });
});
