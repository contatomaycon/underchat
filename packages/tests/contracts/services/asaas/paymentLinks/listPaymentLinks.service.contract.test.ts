import 'reflect-metadata';
import axios from 'axios';
import { ListPaymentLinksService } from '@core/services/asaas/paymentLinks/listPaymentLinks.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('ListPaymentLinksService', () => {
  it('lists payment links with query params when request is provided', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { data: [] } }));
    const service = new ListPaymentLinksService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(
      service.listPaymentLinks({
        offset: 0,
        limit: 10,
        active: true,
        includeDeleted: false,
        name: 'Link',
        externalReference: 'ext',
      } as never)
    ).resolves.toEqual({ data: [] });

    expect(get).toHaveBeenCalledWith(
      '/v3/paymentLinks?offset=0&limit=10&active=true&includeDeleted=false&name=Link&externalReference=ext'
    );
  });

  it('lists payment links without query params when request is undefined', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { data: [] } }));
    const service = new ListPaymentLinksService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listPaymentLinks()).resolves.toEqual({ data: [] });
    expect(get).toHaveBeenCalledWith('/v3/paymentLinks');
  });

  it('returns null when response is not 200', async () => {
    const get = jest.fn(async () => ({ status: 204, data: { data: [] } }));
    const service = new ListPaymentLinksService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listPaymentLinks()).resolves.toBeNull();
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
    const service = new ListPaymentLinksService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listPaymentLinks()).rejects.toThrow(
      'Erro desconhecido ao listar links de pagamentos'
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
        response: { data: { errors: [{ description: 'list-links-fail' }] } },
      };
    });
    const service = new ListPaymentLinksService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listPaymentLinks()).rejects.toThrow('list-links-fail');
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
    const service = new ListPaymentLinksService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listPaymentLinks()).rejects.toThrow(
      'Erro ao listar links de pagamentos'
    );
  });
});
