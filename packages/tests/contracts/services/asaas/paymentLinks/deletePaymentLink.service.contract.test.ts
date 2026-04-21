import 'reflect-metadata';
import axios from 'axios';
import { DeletePaymentLinkService } from '@core/services/asaas/paymentLinks/deletePaymentLink.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('DeletePaymentLinkService', () => {
  it('returns data when response is 200', async () => {
    const deleteFn = jest.fn(async () => ({
      status: 200,
      data: { id: 'pl_1' },
    }));
    const service = new DeletePaymentLinkService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(service.deletePaymentLink('pl_1')).resolves.toEqual({
      id: 'pl_1',
    });

    expect(deleteFn).toHaveBeenCalledWith('/v3/paymentLinks/pl_1');
  });

  it('returns null when response is not 200', async () => {
    const deleteFn = jest.fn(async () => ({
      status: 202,
      data: { id: 'pl_1' },
    }));
    const service = new DeletePaymentLinkService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(service.deletePaymentLink('pl_1')).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const deleteFn = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'delete-pl-fail' }] } },
      };
    });
    const service = new DeletePaymentLinkService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(service.deletePaymentLink('pl_1')).rejects.toThrow(
      'delete-pl-fail'
    );
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
    const service = new DeletePaymentLinkService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(service.deletePaymentLink('pl_1')).rejects.toThrow(
      'Erro ao remover link de pagamentos'
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
    const service = new DeletePaymentLinkService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(service.deletePaymentLink('pl_1')).rejects.toThrow(
      'Erro desconhecido ao remover link de pagamentos'
    );
  });
});
