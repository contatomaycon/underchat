import 'reflect-metadata';
import axios from 'axios';
import { GetPaymentService } from '@core/services/asaas/payments/getPayment.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('GetPaymentService', () => {
  it('returns data when response is 200', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { id: 'pay_1' } }));
    const service = new GetPaymentService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPayment('pay_1')).resolves.toEqual({
      id: 'pay_1',
    });

    expect(get).toHaveBeenCalledWith('/v3/payments/pay_1');
  });

  it('returns null when response is not 200', async () => {
    const get = jest.fn(async () => ({ status: 202, data: { id: 'pay_1' } }));
    const service = new GetPaymentService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPayment('pay_1')).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const get = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'get-pay-fail' }] } },
      };
    });
    const service = new GetPaymentService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPayment('pay_1')).rejects.toThrow('get-pay-fail');
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
    const service = new GetPaymentService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPayment('pay_1')).rejects.toThrow(
      'Erro ao recuperar cobrança'
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
    const service = new GetPaymentService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPayment('pay_1')).rejects.toThrow(
      'Erro desconhecido ao recuperar cobrança'
    );
  });
});
