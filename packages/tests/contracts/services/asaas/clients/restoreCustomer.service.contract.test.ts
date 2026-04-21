import 'reflect-metadata';
import axios from 'axios';
import { RestoreCustomerService } from '@core/services/asaas/clients/restoreCustomer.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('RestoreCustomerService', () => {
  it('returns data when response is 200', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'cus_1' } }));
    const service = new RestoreCustomerService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.restoreCustomer('cus_1')).resolves.toEqual({
      id: 'cus_1',
    });
  });

  it('returns null when response is not 200', async () => {
    const post = jest.fn(async () => ({ status: 201, data: { id: 'cus_1' } }));
    const service = new RestoreCustomerService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.restoreCustomer('cus_1')).resolves.toBeNull();
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
    const service = new RestoreCustomerService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.restoreCustomer('cus_1')).rejects.toThrow('fail-desc');
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
    const service = new RestoreCustomerService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.restoreCustomer('cus_1')).rejects.toThrow(
      'Erro ao restaurar cliente'
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
    const service = new RestoreCustomerService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.restoreCustomer('cus_1')).rejects.toThrow(
      'Erro desconhecido ao restaurar cliente'
    );
  });
});
