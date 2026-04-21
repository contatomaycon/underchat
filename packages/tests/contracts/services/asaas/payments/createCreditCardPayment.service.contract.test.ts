import 'reflect-metadata';
import axios from 'axios';
import { CreateCreditCardPaymentService } from '@core/services/asaas/payments/createCreditCardPayment.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('CreateCreditCardPaymentService', () => {
  it('returns data when response is 200', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'pay_1' } }));
    const service = new CreateCreditCardPaymentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createCreditCardPayment({} as never)).resolves.toEqual(
      {
        id: 'pay_1',
      }
    );
  });

  it('returns null when response is not 200', async () => {
    const post = jest.fn(async () => ({ status: 202, data: { id: 'pay_1' } }));
    const service = new CreateCreditCardPaymentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.createCreditCardPayment({} as never)
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
        response: { data: { errors: [{ description: 'create-cc-pay-fail' }] } },
      };
    });
    const service = new CreateCreditCardPaymentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createCreditCardPayment({} as never)).rejects.toThrow(
      'create-cc-pay-fail'
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
    const service = new CreateCreditCardPaymentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createCreditCardPayment({} as never)).rejects.toThrow(
      'Erro ao criar cobrança com cartão de crédito'
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
    const service = new CreateCreditCardPaymentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createCreditCardPayment({} as never)).rejects.toThrow(
      'Erro desconhecido ao criar cobrança com cartão de crédito'
    );
  });
});
