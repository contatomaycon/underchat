import 'reflect-metadata';
import axios from 'axios';
import { GetPaymentViewingInfoService } from '@core/services/asaas/payments/getPaymentViewingInfo.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('GetPaymentViewingInfoService', () => {
  it('returns data when response is 200', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { canView: true } }));
    const service = new GetPaymentViewingInfoService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentViewingInfo('pay_1')).resolves.toEqual({
      canView: true,
    });

    expect(get).toHaveBeenCalledWith('/v3/payments/pay_1/viewingInfo');
  });

  it('returns null when response is not 200', async () => {
    const get = jest.fn(async () => ({ status: 202, data: { canView: true } }));
    const service = new GetPaymentViewingInfoService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentViewingInfo('pay_1')).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const get = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'viewing-fail' }] } },
      };
    });
    const service = new GetPaymentViewingInfoService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentViewingInfo('pay_1')).rejects.toThrow(
      'viewing-fail'
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
    const service = new GetPaymentViewingInfoService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentViewingInfo('pay_1')).rejects.toThrow(
      'Erro ao recuperar informações de visualização da cobrança'
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
    const service = new GetPaymentViewingInfoService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentViewingInfo('pay_1')).rejects.toThrow(
      'Erro desconhecido ao recuperar informações de visualização da cobrança'
    );
  });
});
