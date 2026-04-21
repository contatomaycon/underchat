import 'reflect-metadata';
import axios from 'axios';
import { CreateCheckoutService } from '@core/services/asaas/checkout/createCheckout.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('CreateCheckoutService', () => {
  it('returns data when response is 200', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'co_1' } }));
    const service = new CreateCheckoutService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createCheckout({} as never)).resolves.toEqual({
      id: 'co_1',
    });
  });

  it('returns null when response is not 200', async () => {
    const post = jest.fn(async () => ({ status: 201, data: { id: 'co_1' } }));
    const service = new CreateCheckoutService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createCheckout({} as never)).resolves.toBeNull();
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
    const service = new CreateCheckoutService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createCheckout({} as never)).rejects.toThrow(
      'fail-desc'
    );
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
    const service = new CreateCheckoutService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createCheckout({} as never)).rejects.toThrow(
      'Erro ao criar checkout'
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
    const service = new CreateCheckoutService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createCheckout({} as never)).rejects.toThrow(
      'Erro desconhecido ao criar checkout'
    );
  });
});
