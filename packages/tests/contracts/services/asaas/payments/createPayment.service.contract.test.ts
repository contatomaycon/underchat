import 'reflect-metadata';
import axios from 'axios';
import { CreatePaymentService } from '@core/services/asaas/payments/createPayment.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('CreatePaymentService', () => {
  it('returns data when response is 200', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'pay_1' } }));
    const service = new CreatePaymentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createPayment({} as never)).resolves.toEqual({
      id: 'pay_1',
    });
  });

  it('returns null when response is not 200', async () => {
    const post = jest.fn(async () => ({ status: 202, data: { id: 'pay_1' } }));
    const service = new CreatePaymentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createPayment({} as never)).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const post = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'create-pay-fail' }] } },
      };
    });
    const service = new CreatePaymentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createPayment({} as never)).rejects.toThrow(
      'create-pay-fail'
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
    const service = new CreatePaymentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createPayment({} as never)).rejects.toThrow(
      'Erro ao criar cobrança'
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
    const service = new CreatePaymentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createPayment({} as never)).rejects.toThrow(
      'Erro desconhecido ao criar cobrança'
    );
  });
});
