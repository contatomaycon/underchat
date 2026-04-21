import 'reflect-metadata';
import axios from 'axios';
import { UpdateCustomerService } from '@core/services/asaas/clients/updateCustomer.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('UpdateCustomerService', () => {
  it('updates customer and returns response data when status is 200', async () => {
    const put = jest.fn(async () => ({ status: 200, data: { id: 'cus_1' } }));
    const service = new UpdateCustomerService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updateCustomer('cus_1', { name: 'John' } as never)
    ).resolves.toEqual({
      id: 'cus_1',
    });

    expect(put).toHaveBeenCalledWith('/v3/customers/cus_1', { name: 'John' });
  });

  it('returns null when status is not 200', async () => {
    const put = jest.fn(async () => ({ status: 202, data: { id: 'cus_1' } }));
    const service = new UpdateCustomerService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updateCustomer('cus_1', {} as never)
    ).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);

    const put = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'update-failed' }] } },
      };
    });

    const service = new UpdateCustomerService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(service.updateCustomer('cus_1', {} as never)).rejects.toThrow(
      'update-failed'
    );
  });

  it('throws default axios message when no description is available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);

    const put = jest.fn(async () => {
      throw { response: { data: {} } };
    });

    const service = new UpdateCustomerService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(service.updateCustomer('cus_1', {} as never)).rejects.toThrow(
      'Erro ao atualizar cliente'
    );
  });

  it('throws unknown message for non-axios errors', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(false);

    const put = jest.fn(async () => {
      throw new Error('boom');
    });

    const service = new UpdateCustomerService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(service.updateCustomer('cus_1', {} as never)).rejects.toThrow(
      'Erro desconhecido ao atualizar cliente'
    );
  });
});
