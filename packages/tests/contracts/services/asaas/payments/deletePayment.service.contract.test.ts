import 'reflect-metadata';
import axios from 'axios';
import { DeletePaymentService } from '@core/services/asaas/payments/deletePayment.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('DeletePaymentService', () => {
  it('returns data when response is 200', async () => {
    const deleteFn = jest.fn(async () => ({
      status: 200,
      data: { id: 'pay_1' },
    }));
    const service = new DeletePaymentService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(service.deletePayment('pay_1')).resolves.toEqual({
      id: 'pay_1',
    });

    expect(deleteFn).toHaveBeenCalledWith('/v3/payments/pay_1');
  });

  it('returns null when response is not 200', async () => {
    const deleteFn = jest.fn(async () => ({
      status: 202,
      data: { id: 'pay_1' },
    }));
    const service = new DeletePaymentService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(service.deletePayment('pay_1')).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const deleteFn = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'delete-pay-fail' }] } },
      };
    });
    const service = new DeletePaymentService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(service.deletePayment('pay_1')).rejects.toThrow(
      'delete-pay-fail'
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
    const service = new DeletePaymentService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(service.deletePayment('pay_1')).rejects.toThrow(
      'Erro ao excluir cobrança'
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
    const service = new DeletePaymentService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(service.deletePayment('pay_1')).rejects.toThrow(
      'Erro desconhecido ao excluir cobrança'
    );
  });
});
