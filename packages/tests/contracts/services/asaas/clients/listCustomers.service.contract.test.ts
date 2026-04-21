import 'reflect-metadata';
import axios from 'axios';
import { ListCustomersService } from '@core/services/asaas/clients/listCustomers.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('ListCustomersService', () => {
  it('lists customers with query string when request is provided', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { data: [] } }));
    const service = new ListCustomersService({
      getAxiosInstance: () => ({ get }),
    } as never);

    const request = {
      offset: 0,
      limit: 10,
      name: 'John',
      email: 'john@example.com',
      cpfCnpj: '123',
      groupName: 'A',
      externalReference: 'ref-1',
    };

    await expect(service.listCustomers(request as never)).resolves.toEqual({
      data: [],
    });

    expect(get).toHaveBeenCalledWith(
      '/v3/customers?offset=0&limit=10&name=John&email=john%40example.com&cpfCnpj=123&groupName=A&externalReference=ref-1'
    );
  });

  it('lists customers without query string when request is not provided', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { data: [] } }));
    const service = new ListCustomersService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listCustomers()).resolves.toEqual({ data: [] });
    expect(get).toHaveBeenCalledWith('/v3/customers');
  });

  it('returns null when response is not 200', async () => {
    const get = jest.fn(async () => ({ status: 204, data: { data: [] } }));
    const service = new ListCustomersService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listCustomers()).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);

    const get = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'list-failed' }] } },
      };
    });

    const service = new ListCustomersService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listCustomers()).rejects.toThrow('list-failed');
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

    const service = new ListCustomersService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listCustomers()).rejects.toThrow(
      'Erro desconhecido ao listar clientes'
    );
  });
});
