import 'reflect-metadata';
import axios from 'axios';
import { GetPaymentBillingInfoService } from '@core/services/asaas/payments/getPaymentBillingInfo.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('GetPaymentBillingInfoService', () => {
  it('returns data when response is 200', async () => {
    const get = jest.fn(async () => ({
      status: 200,
      data: { invoiceUrl: 'url' },
    }));
    const service = new GetPaymentBillingInfoService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentBillingInfo('pay_1')).resolves.toEqual({
      invoiceUrl: 'url',
    });

    expect(get).toHaveBeenCalledWith('/v3/payments/pay_1/billingInfo');
  });

  it('returns null when response is not 200', async () => {
    const get = jest.fn(async () => ({
      status: 202,
      data: { invoiceUrl: 'url' },
    }));
    const service = new GetPaymentBillingInfoService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentBillingInfo('pay_1')).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const get = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'billing-fail' }] } },
      };
    });
    const service = new GetPaymentBillingInfoService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentBillingInfo('pay_1')).rejects.toThrow(
      'billing-fail'
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
    const service = new GetPaymentBillingInfoService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentBillingInfo('pay_1')).rejects.toThrow(
      'Erro ao recuperar informações de pagamento'
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
    const service = new GetPaymentBillingInfoService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentBillingInfo('pay_1')).rejects.toThrow(
      'Erro desconhecido ao recuperar informações de pagamento'
    );
  });
});
