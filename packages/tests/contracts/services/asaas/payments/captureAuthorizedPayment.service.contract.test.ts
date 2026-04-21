import 'reflect-metadata';
import axios from 'axios';
import { CaptureAuthorizedPaymentService } from '@core/services/asaas/payments/captureAuthorizedPayment.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('CaptureAuthorizedPaymentService', () => {
  it('returns data when response is 200', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'pay_1' } }));
    const service = new CaptureAuthorizedPaymentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.captureAuthorizedPayment('pay_1')).resolves.toEqual({
      id: 'pay_1',
    });

    expect(post).toHaveBeenCalledWith(
      '/v3/payments/pay_1/captureAuthorizedPayment',
      {}
    );
  });

  it('returns null when response is not 200', async () => {
    const post = jest.fn(async () => ({ status: 202, data: { id: 'pay_1' } }));
    const service = new CaptureAuthorizedPaymentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.captureAuthorizedPayment('pay_1')).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const post = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'capture-fail' }] } },
      };
    });
    const service = new CaptureAuthorizedPaymentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.captureAuthorizedPayment('pay_1')).rejects.toThrow(
      'capture-fail'
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
    const service = new CaptureAuthorizedPaymentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.captureAuthorizedPayment('pay_1')).rejects.toThrow(
      'Erro ao capturar cobrança pré-autorizada'
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
    const service = new CaptureAuthorizedPaymentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.captureAuthorizedPayment('pay_1')).rejects.toThrow(
      'Erro desconhecido ao capturar cobrança pré-autorizada'
    );
  });
});
