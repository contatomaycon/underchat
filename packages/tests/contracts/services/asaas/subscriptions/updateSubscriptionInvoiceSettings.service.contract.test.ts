import 'reflect-metadata';
import axios from 'axios';
import { UpdateSubscriptionInvoiceSettingsService } from '@core/services/asaas/subscriptions/updateSubscriptionInvoiceSettings.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('UpdateSubscriptionInvoiceSettingsService', () => {
  it('returns data when response is 200', async () => {
    const put = jest.fn(async () => ({ status: 200, data: { id: 'cfg_1' } }));
    const service = new UpdateSubscriptionInvoiceSettingsService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updateSubscriptionInvoiceSettings('sub_1', {
        email: true,
      } as never)
    ).resolves.toEqual({
      id: 'cfg_1',
    });

    expect(put).toHaveBeenCalledWith(
      '/v3/subscriptions/sub_1/invoiceSettings',
      {
        email: true,
      }
    );
  });

  it('returns null when response is not 200', async () => {
    const put = jest.fn(async () => ({ status: 202, data: { id: 'cfg_1' } }));
    const service = new UpdateSubscriptionInvoiceSettingsService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updateSubscriptionInvoiceSettings('sub_1', {} as never)
    ).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const put = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'update-cfg-fail' }] } },
      };
    });
    const service = new UpdateSubscriptionInvoiceSettingsService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updateSubscriptionInvoiceSettings('sub_1', {} as never)
    ).rejects.toThrow('update-cfg-fail');
  });

  it('throws default axios message when no description is available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const put = jest.fn(async () => {
      throw { response: { data: {} } };
    });
    const service = new UpdateSubscriptionInvoiceSettingsService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updateSubscriptionInvoiceSettings('sub_1', {} as never)
    ).rejects.toThrow(
      'Erro ao atualizar configuração de nota fiscal da assinatura'
    );
  });

  it('throws unknown message for non-axios errors', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(false);
    const put = jest.fn(async () => {
      throw new Error('boom');
    });
    const service = new UpdateSubscriptionInvoiceSettingsService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updateSubscriptionInvoiceSettings('sub_1', {} as never)
    ).rejects.toThrow(
      'Erro desconhecido ao atualizar configuração de nota fiscal da assinatura'
    );
  });
});
