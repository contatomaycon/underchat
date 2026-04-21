import 'reflect-metadata';
import axios from 'axios';
import { ListSubscriptionsService } from '@core/services/asaas/subscriptions/listSubscriptions.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('ListSubscriptionsService', () => {
  it('lists subscriptions with query params when request is provided', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { data: [] } }));
    const service = new ListSubscriptionsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(
      service.listSubscriptions({
        offset: 0,
        limit: 20,
        customer: 'cus_1',
        customerGroupName: 'group',
        billingType: 'PIX',
        status: 'ACTIVE',
        deletedOnly: false,
        includeDeleted: true,
        externalReference: 'ext_1',
        order: 'asc',
        sort: 'id',
      } as never)
    ).resolves.toEqual({ data: [] });

    const calledUrl = get.mock.calls.at(0)?.at(0);
    expect(calledUrl).toContain('/v3/subscriptions?');
    expect(calledUrl).toContain('offset=0');
    expect(calledUrl).toContain('limit=20');
    expect(calledUrl).toContain('customer=cus_1');
    expect(calledUrl).toContain('customerGroupName=group');
    expect(calledUrl).toContain('billingType=PIX');
    expect(calledUrl).toContain('status=ACTIVE');
    expect(calledUrl).toContain('deletedOnly=false');
    expect(calledUrl).toContain('includeDeleted=true');
    expect(calledUrl).toContain('externalReference=ext_1');
    expect(calledUrl).toContain('order=asc');
    expect(calledUrl).toContain('sort=id');
  });

  it('uses base endpoint when request is not provided', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { data: [] } }));
    const service = new ListSubscriptionsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listSubscriptions()).resolves.toEqual({ data: [] });
    expect(get).toHaveBeenCalledWith('/v3/subscriptions');
  });

  it('returns null when response is not 200', async () => {
    const get = jest.fn(async () => ({ status: 204, data: { data: [] } }));
    const service = new ListSubscriptionsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listSubscriptions()).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const get = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'list-subs-fail' }] } },
      };
    });
    const service = new ListSubscriptionsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listSubscriptions()).rejects.toThrow('list-subs-fail');
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
    const service = new ListSubscriptionsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listSubscriptions()).rejects.toThrow(
      'Erro desconhecido ao listar assinaturas'
    );
  });
});
