import 'reflect-metadata';
import axios from 'axios';
import { CancelCheckoutService } from '@core/services/asaas/checkout/cancelCheckout.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('CancelCheckoutService', () => {
  it('returns data when response is 200', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'co_1' } }));
    const service = new CancelCheckoutService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.cancelCheckout('co_1')).resolves.toEqual({
      id: 'co_1',
    });
  });

  it('returns null when response is not 200', async () => {
    const post = jest.fn(async () => ({ status: 201, data: { id: 'co_1' } }));
    const service = new CancelCheckoutService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.cancelCheckout('co_1')).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const post = jest.fn(async () => {
      throw { response: { data: { errors: [{ description: 'fail-desc' }] } } };
    });
    const service = new CancelCheckoutService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.cancelCheckout('co_1')).rejects.toThrow('fail-desc');
  });

  it('throws default axios message when description is unavailable', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const post = jest.fn(async () => {
      throw { response: { data: {} } };
    });
    const service = new CancelCheckoutService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.cancelCheckout('co_1')).rejects.toThrow(
      'Erro ao cancelar checkout'
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
    const service = new CancelCheckoutService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.cancelCheckout('co_1')).rejects.toThrow(
      'Erro desconhecido ao cancelar checkout'
    );
  });
});
