import 'reflect-metadata';
import axios from 'axios';
import { ListInstallmentsService } from '@core/services/asaas/installments/listInstallments.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('ListInstallmentsService', () => {
  it('lists installments with query params when request is provided', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { data: [] } }));
    const service = new ListInstallmentsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(
      service.listInstallments({ offset: 0, limit: 20 } as never)
    ).resolves.toEqual({ data: [] });

    expect(get).toHaveBeenCalledWith('/v3/installments?offset=0&limit=20');
  });

  it('lists installments without query params when request is undefined', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { data: [] } }));
    const service = new ListInstallmentsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listInstallments()).resolves.toEqual({ data: [] });
    expect(get).toHaveBeenCalledWith('/v3/installments');
  });

  it('returns null when response is not 200', async () => {
    const get = jest.fn(async () => ({ status: 202, data: { data: [] } }));
    const service = new ListInstallmentsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listInstallments()).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const get = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'list-ins-fail' }] } },
      };
    });
    const service = new ListInstallmentsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listInstallments()).rejects.toThrow('list-ins-fail');
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
    const service = new ListInstallmentsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listInstallments()).rejects.toThrow(
      'Erro desconhecido ao listar parcelamentos'
    );
  });
});
