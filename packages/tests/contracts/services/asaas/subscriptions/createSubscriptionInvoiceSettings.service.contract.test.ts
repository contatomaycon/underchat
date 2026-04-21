import 'reflect-metadata';
import axios from 'axios';
import { CreateSubscriptionInvoiceSettingsService } from '@core/services/asaas/subscriptions/createSubscriptionInvoiceSettings.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('CreateSubscriptionInvoiceSettingsService', () => {
  it('returns data when response is 200', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'cfg_1' } }));
    const service = new CreateSubscriptionInvoiceSettingsService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.createSubscriptionInvoiceSettings('sub_1', {
        email: true,
      } as never)
    ).resolves.toEqual({
      id: 'cfg_1',
    });

    expect(post).toHaveBeenCalledWith(
      '/v3/subscriptions/sub_1/invoiceSettings',
      {
        email: true,
      }
    );
  });

  it('returns null when response is not 200', async () => {
    const post = jest.fn(async () => ({ status: 202, data: { id: 'cfg_1' } }));
    const service = new CreateSubscriptionInvoiceSettingsService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.createSubscriptionInvoiceSettings('sub_1', {} as never)
    ).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const post = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'create-cfg-fail' }] } },
      };
    });
    const service = new CreateSubscriptionInvoiceSettingsService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.createSubscriptionInvoiceSettings('sub_1', {} as never)
    ).rejects.toThrow('create-cfg-fail');
  });

  it('throws default axios message when no description is available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const post = jest.fn(async () => {
      throw { response: { data: {} } };
    });
    const service = new CreateSubscriptionInvoiceSettingsService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.createSubscriptionInvoiceSettings('sub_1', {} as never)
    ).rejects.toThrow(
      'Erro ao criar configuração de nota fiscal da assinatura'
    );
  });

  it('throws unknown message for non-axios errors', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(false);
    const post = jest.fn(async () => {
      throw new Error('boom');
    });
    const service = new CreateSubscriptionInvoiceSettingsService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.createSubscriptionInvoiceSettings('sub_1', {} as never)
    ).rejects.toThrow(
      'Erro desconhecido ao criar configuração de nota fiscal da assinatura'
    );
  });
});
