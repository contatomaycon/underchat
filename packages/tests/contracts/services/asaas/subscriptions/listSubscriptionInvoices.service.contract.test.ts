import 'reflect-metadata';
import axios from 'axios';
import { ListSubscriptionInvoicesService } from '@core/services/asaas/subscriptions/listSubscriptionInvoices.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('ListSubscriptionInvoicesService', () => {
  it('lists subscription invoices with query params when request is provided', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { data: [] } }));
    const service = new ListSubscriptionInvoicesService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(
      service.listSubscriptionInvoices('sub_1', {
        offset: 0,
        limit: 10,
        'effectiveDate[ge]': '2026-01-01',
        'effectiveDate[le]': '2026-01-31',
        externalReference: 'ext_1',
        status: 'PENDING',
        customer: 'cus_1',
      } as never)
    ).resolves.toEqual({ data: [] });

    const calledUrl = get.mock.calls.at(0)?.at(0);
    expect(calledUrl).toContain('/v3/subscriptions/sub_1/invoices?');
    expect(calledUrl).toContain('offset=0');
    expect(calledUrl).toContain('limit=10');
    expect(calledUrl).toContain('effectiveDate%5Bge%5D=2026-01-01');
    expect(calledUrl).toContain('effectiveDate%5Ble%5D=2026-01-31');
    expect(calledUrl).toContain('externalReference=ext_1');
    expect(calledUrl).toContain('status=PENDING');
    expect(calledUrl).toContain('customer=cus_1');
  });

  it('uses base endpoint when request is not provided', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { data: [] } }));
    const service = new ListSubscriptionInvoicesService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listSubscriptionInvoices('sub_1')).resolves.toEqual({
      data: [],
    });
    expect(get).toHaveBeenCalledWith('/v3/subscriptions/sub_1/invoices');
  });

  it('returns null when response is not 200', async () => {
    const get = jest.fn(async () => ({ status: 204, data: { data: [] } }));
    const service = new ListSubscriptionInvoicesService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listSubscriptionInvoices('sub_1')).resolves.toBeNull();
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
    const service = new ListSubscriptionInvoicesService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listSubscriptionInvoices('sub_1')).rejects.toThrow(
      'Erro desconhecido ao listar notas fiscais da assinatura'
    );
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const get = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'list-sub-inv-fail' }] } },
      };
    });
    const service = new ListSubscriptionInvoicesService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listSubscriptionInvoices('sub_1')).rejects.toThrow(
      'list-sub-inv-fail'
    );
  });

  it('throws default axios message when no description is available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const get = jest.fn(async () => {
      throw { response: { data: {} } };
    });
    const service = new ListSubscriptionInvoicesService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listSubscriptionInvoices('sub_1')).rejects.toThrow(
      'Erro ao listar notas fiscais da assinatura'
    );
  });
});
