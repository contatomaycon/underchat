import 'reflect-metadata';
import axios from 'axios';
import { CreateCustomerService } from '@core/services/asaas/clients/createCustomer.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('CreateCustomerService', () => {
  it('returns data when response is 200', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'cus_1' } }));
    const service = new CreateCustomerService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createCustomer({} as never)).resolves.toEqual({
      id: 'cus_1',
    });
  });

  it('returns null when response is not 200', async () => {
    const post = jest.fn(async () => ({ status: 201, data: { id: 'cus_1' } }));
    const service = new CreateCustomerService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createCustomer({} as never)).resolves.toBeNull();
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
    const service = new CreateCustomerService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createCustomer({} as never)).rejects.toThrow(
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
    const service = new CreateCustomerService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createCustomer({} as never)).rejects.toThrow(
      'Erro ao criar cliente'
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
    const service = new CreateCustomerService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createCustomer({} as never)).rejects.toThrow(
      'Erro desconhecido ao criar cliente'
    );
  });
});
