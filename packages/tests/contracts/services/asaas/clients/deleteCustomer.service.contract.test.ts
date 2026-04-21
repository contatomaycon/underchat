import 'reflect-metadata';
import axios from 'axios';
import { DeleteCustomerService } from '@core/services/asaas/clients/deleteCustomer.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('DeleteCustomerService', () => {
  it('returns data when response is 200', async () => {
    const del = jest.fn(async () => ({ status: 200, data: { deleted: true } }));
    const service = new DeleteCustomerService({
      getAxiosInstance: () => ({ delete: del }),
    } as never);

    await expect(service.deleteCustomer('cus_1')).resolves.toEqual({
      deleted: true,
    });
  });

  it('returns null when response is not 200', async () => {
    const del = jest.fn(async () => ({ status: 204, data: { deleted: true } }));
    const service = new DeleteCustomerService({
      getAxiosInstance: () => ({ delete: del }),
    } as never);

    await expect(service.deleteCustomer('cus_1')).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const del = jest.fn(async () => {
      throw { response: { data: { errors: [{ description: 'fail-desc' }] } } };
    });
    const service = new DeleteCustomerService({
      getAxiosInstance: () => ({ delete: del }),
    } as never);

    await expect(service.deleteCustomer('cus_1')).rejects.toThrow('fail-desc');
  });

  it('throws default axios message when description is unavailable', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const del = jest.fn(async () => {
      throw { response: { data: {} } };
    });
    const service = new DeleteCustomerService({
      getAxiosInstance: () => ({ delete: del }),
    } as never);

    await expect(service.deleteCustomer('cus_1')).rejects.toThrow(
      'Erro ao remover cliente'
    );
  });

  it('throws unknown message for non-axios errors', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(false);
    const del = jest.fn(async () => {
      throw new Error('boom');
    });
    const service = new DeleteCustomerService({
      getAxiosInstance: () => ({ delete: del }),
    } as never);

    await expect(service.deleteCustomer('cus_1')).rejects.toThrow(
      'Erro desconhecido ao remover cliente'
    );
  });
});
