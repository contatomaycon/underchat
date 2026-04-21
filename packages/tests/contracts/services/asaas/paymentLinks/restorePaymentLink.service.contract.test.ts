import 'reflect-metadata';
import axios from 'axios';
import { RestorePaymentLinkService } from '@core/services/asaas/paymentLinks/restorePaymentLink.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('RestorePaymentLinkService', () => {
  it('returns data when response is 200', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'pl_1' } }));
    const service = new RestorePaymentLinkService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.restorePaymentLink('pl_1')).resolves.toEqual({
      id: 'pl_1',
    });

    expect(post).toHaveBeenCalledWith('/v3/paymentLinks/pl_1/restore', {});
  });

  it('returns null when response is not 200', async () => {
    const post = jest.fn(async () => ({ status: 202, data: { id: 'pl_1' } }));
    const service = new RestorePaymentLinkService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.restorePaymentLink('pl_1')).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const post = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'restore-pl-fail' }] } },
      };
    });
    const service = new RestorePaymentLinkService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.restorePaymentLink('pl_1')).rejects.toThrow(
      'restore-pl-fail'
    );
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
    const service = new RestorePaymentLinkService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.restorePaymentLink('pl_1')).rejects.toThrow(
      'Erro ao restaurar link de pagamentos'
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
    const service = new RestorePaymentLinkService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.restorePaymentLink('pl_1')).rejects.toThrow(
      'Erro desconhecido ao restaurar link de pagamentos'
    );
  });
});
