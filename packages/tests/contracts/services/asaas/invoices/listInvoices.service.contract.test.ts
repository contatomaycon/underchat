import 'reflect-metadata';
import axios from 'axios';
import { ListInvoicesService } from '@core/services/asaas/invoices/listInvoices.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('ListInvoicesService', () => {
  it('lists invoices with query params when request is provided', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { data: [] } }));
    const service = new ListInvoicesService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(
      service.listInvoices({
        offset: 0,
        limit: 10,
        'effectiveDate[ge]': '2026-01-01',
        'effectiveDate[le]': '2026-01-31',
        payment: 'pay_1',
        installment: 'ins_1',
        externalReference: 'ext-1',
        status: 'PENDING',
        customer: 'cus_1',
      } as never)
    ).resolves.toEqual({ data: [] });

    expect(get).toHaveBeenCalledWith(
      '/v3/invoices?offset=0&limit=10&effectiveDate%5Bge%5D=2026-01-01&effectiveDate%5Ble%5D=2026-01-31&payment=pay_1&installment=ins_1&externalReference=ext-1&status=PENDING&customer=cus_1'
    );
  });

  it('lists invoices without query params when request is undefined', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { data: [] } }));
    const service = new ListInvoicesService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listInvoices()).resolves.toEqual({ data: [] });
    expect(get).toHaveBeenCalledWith('/v3/invoices');
  });

  it('returns null when response is not 200', async () => {
    const get = jest.fn(async () => ({ status: 202, data: { data: [] } }));
    const service = new ListInvoicesService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listInvoices()).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);

    const get = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'invoice-list-fail' }] } },
      };
    });

    const service = new ListInvoicesService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listInvoices()).rejects.toThrow('invoice-list-fail');
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

    const service = new ListInvoicesService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listInvoices()).rejects.toThrow(
      'Erro desconhecido ao listar notas fiscais'
    );
  });
});
