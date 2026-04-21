import 'reflect-metadata';
import axios from 'axios';
import { CreateSubscriptionWithCreditCardService } from '@core/services/asaas/subscriptions/createSubscriptionWithCreditCard.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('CreateSubscriptionWithCreditCardService', () => {
  it('returns data when response is 200', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'sub_1' } }));
    const service = new CreateSubscriptionWithCreditCardService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.createSubscriptionWithCreditCard({} as never)
    ).resolves.toEqual({
      id: 'sub_1',
    });

    expect(post).toHaveBeenCalledWith('/v3/subscriptions/', {});
  });

  it('returns null when response is not 200', async () => {
    const post = jest.fn(async () => ({ status: 202, data: { id: 'sub_1' } }));
    const service = new CreateSubscriptionWithCreditCardService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.createSubscriptionWithCreditCard({} as never)
    ).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const post = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'create-sub-cc-fail' }] } },
      };
    });
    const service = new CreateSubscriptionWithCreditCardService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.createSubscriptionWithCreditCard({} as never)
    ).rejects.toThrow('create-sub-cc-fail');
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
    const service = new CreateSubscriptionWithCreditCardService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.createSubscriptionWithCreditCard({} as never)
    ).rejects.toThrow('Erro ao criar assinatura com cartão de crédito');
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
    const service = new CreateSubscriptionWithCreditCardService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.createSubscriptionWithCreditCard({} as never)
    ).rejects.toThrow(
      'Erro desconhecido ao criar assinatura com cartão de crédito'
    );
  });
});
