import 'reflect-metadata';
import axios from 'axios';
import { GetSubscriptionInvoiceSettingsService } from '@core/services/asaas/subscriptions/getSubscriptionInvoiceSettings.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('GetSubscriptionInvoiceSettingsService', () => {
  it('returns data when response is 200', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { id: 'cfg_1' } }));
    const service = new GetSubscriptionInvoiceSettingsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(
      service.getSubscriptionInvoiceSettings('sub_1')
    ).resolves.toEqual({
      id: 'cfg_1',
    });

    expect(get).toHaveBeenCalledWith('/v3/subscriptions/sub_1/invoiceSettings');
  });

  it('returns null when response is not 200', async () => {
    const get = jest.fn(async () => ({ status: 202, data: { id: 'cfg_1' } }));
    const service = new GetSubscriptionInvoiceSettingsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(
      service.getSubscriptionInvoiceSettings('sub_1')
    ).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const get = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'get-cfg-fail' }] } },
      };
    });
    const service = new GetSubscriptionInvoiceSettingsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(
      service.getSubscriptionInvoiceSettings('sub_1')
    ).rejects.toThrow('get-cfg-fail');
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
    const service = new GetSubscriptionInvoiceSettingsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(
      service.getSubscriptionInvoiceSettings('sub_1')
    ).rejects.toThrow(
      'Erro ao recuperar configuração de nota fiscal da assinatura'
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
    const service = new GetSubscriptionInvoiceSettingsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(
      service.getSubscriptionInvoiceSettings('sub_1')
    ).rejects.toThrow(
      'Erro desconhecido ao recuperar configuração de nota fiscal da assinatura'
    );
  });
});
