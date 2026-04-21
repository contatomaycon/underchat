import 'reflect-metadata';
import axios from 'axios';
import { GetPaymentLinkService } from '@core/services/asaas/paymentLinks/getPaymentLink.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('GetPaymentLinkService', () => {
  it('returns data when response is 200', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { id: 'pl_1' } }));
    const service = new GetPaymentLinkService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentLink('pl_1')).resolves.toEqual({
      id: 'pl_1',
    });

    expect(get).toHaveBeenCalledWith('/v3/paymentLinks/pl_1');
  });

  it('returns null when response is not 200', async () => {
    const get = jest.fn(async () => ({ status: 202, data: { id: 'pl_1' } }));
    const service = new GetPaymentLinkService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentLink('pl_1')).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const get = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'get-pl-fail' }] } },
      };
    });
    const service = new GetPaymentLinkService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentLink('pl_1')).rejects.toThrow('get-pl-fail');
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
    const service = new GetPaymentLinkService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentLink('pl_1')).rejects.toThrow(
      'Erro ao recuperar link de pagamentos'
    );
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
    const service = new GetPaymentLinkService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentLink('pl_1')).rejects.toThrow(
      'Erro desconhecido ao recuperar link de pagamentos'
    );
  });
});
