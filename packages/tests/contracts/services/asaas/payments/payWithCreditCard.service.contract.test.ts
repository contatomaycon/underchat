import 'reflect-metadata';
import axios from 'axios';
import { PayWithCreditCardService } from '@core/services/asaas/payments/payWithCreditCard.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('PayWithCreditCardService', () => {
  it('returns data when response is 200', async () => {
    const post = jest.fn(async () => ({
      status: 200,
      data: { success: true },
    }));
    const service = new PayWithCreditCardService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.payWithCreditCard('pay_1', { creditCard: {} } as never)
    ).resolves.toEqual({
      success: true,
    });

    expect(post).toHaveBeenCalledWith('/v3/payments/pay_1/payWithCreditCard', {
      creditCard: {},
    });
  });

  it('returns null when response is not 200', async () => {
    const post = jest.fn(async () => ({
      status: 202,
      data: { success: true },
    }));
    const service = new PayWithCreditCardService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.payWithCreditCard('pay_1', {} as never)
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
        response: { data: { errors: [{ description: 'pay-cc-fail' }] } },
      };
    });
    const service = new PayWithCreditCardService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.payWithCreditCard('pay_1', {} as never)
    ).rejects.toThrow('pay-cc-fail');
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
    const service = new PayWithCreditCardService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.payWithCreditCard('pay_1', {} as never)
    ).rejects.toThrow('Erro ao pagar cobrança com cartão de crédito');
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
    const service = new PayWithCreditCardService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.payWithCreditCard('pay_1', {} as never)
    ).rejects.toThrow(
      'Erro desconhecido ao pagar cobrança com cartão de crédito'
    );
  });
});
