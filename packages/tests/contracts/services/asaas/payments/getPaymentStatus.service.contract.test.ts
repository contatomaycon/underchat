import 'reflect-metadata';
import axios from 'axios';
import { GetPaymentStatusService } from '@core/services/asaas/payments/getPaymentStatus.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('GetPaymentStatusService', () => {
  it('returns data when response is 200', async () => {
    const get = jest.fn(async () => ({
      status: 200,
      data: { status: 'PENDING' },
    }));
    const service = new GetPaymentStatusService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentStatus('pay_1')).resolves.toEqual({
      status: 'PENDING',
    });

    expect(get).toHaveBeenCalledWith('/v3/payments/pay_1/status');
  });

  it('returns null when response is not 200', async () => {
    const get = jest.fn(async () => ({
      status: 202,
      data: { status: 'PENDING' },
    }));
    const service = new GetPaymentStatusService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentStatus('pay_1')).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const get = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'status-fail' }] } },
      };
    });
    const service = new GetPaymentStatusService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentStatus('pay_1')).rejects.toThrow(
      'status-fail'
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
    const service = new GetPaymentStatusService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentStatus('pay_1')).rejects.toThrow(
      'Erro ao recuperar status da cobrança'
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
    const service = new GetPaymentStatusService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentStatus('pay_1')).rejects.toThrow(
      'Erro desconhecido ao recuperar status da cobrança'
    );
  });
});
