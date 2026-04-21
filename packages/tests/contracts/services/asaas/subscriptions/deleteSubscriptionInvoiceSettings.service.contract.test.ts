import 'reflect-metadata';
import axios from 'axios';
import { DeleteSubscriptionInvoiceSettingsService } from '@core/services/asaas/subscriptions/deleteSubscriptionInvoiceSettings.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('DeleteSubscriptionInvoiceSettingsService', () => {
  it('returns data when response is 200', async () => {
    const deleteFn = jest.fn(async () => ({
      status: 200,
      data: { id: 'cfg_1' },
    }));
    const service = new DeleteSubscriptionInvoiceSettingsService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(
      service.deleteSubscriptionInvoiceSettings('sub_1')
    ).resolves.toEqual({
      id: 'cfg_1',
    });

    expect(deleteFn).toHaveBeenCalledWith(
      '/v3/subscriptions/sub_1/invoiceSettings'
    );
  });

  it('returns null when response is not 200', async () => {
    const deleteFn = jest.fn(async () => ({
      status: 202,
      data: { id: 'cfg_1' },
    }));
    const service = new DeleteSubscriptionInvoiceSettingsService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(
      service.deleteSubscriptionInvoiceSettings('sub_1')
    ).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const deleteFn = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'delete-cfg-fail' }] } },
      };
    });
    const service = new DeleteSubscriptionInvoiceSettingsService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(
      service.deleteSubscriptionInvoiceSettings('sub_1')
    ).rejects.toThrow('delete-cfg-fail');
  });

  it('throws default axios message when no description is available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const deleteFn = jest.fn(async () => {
      throw { response: { data: {} } };
    });
    const service = new DeleteSubscriptionInvoiceSettingsService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(
      service.deleteSubscriptionInvoiceSettings('sub_1')
    ).rejects.toThrow(
      'Erro ao remover configuração de nota fiscal da assinatura'
    );
  });

  it('throws unknown message for non-axios errors', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(false);
    const deleteFn = jest.fn(async () => {
      throw new Error('boom');
    });
    const service = new DeleteSubscriptionInvoiceSettingsService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(
      service.deleteSubscriptionInvoiceSettings('sub_1')
    ).rejects.toThrow(
      'Erro desconhecido ao remover configuração de nota fiscal da assinatura'
    );
  });
});
