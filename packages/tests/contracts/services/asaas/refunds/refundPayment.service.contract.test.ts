import 'reflect-metadata';
import axios from 'axios';
import { RefundPaymentService } from '@core/services/asaas/refunds/refundPayment.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('RefundPaymentService', () => {
  it('returns data when response is 200', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'rf_1' } }));
    const service = new RefundPaymentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.refundPayment('pay_1', { value: 10 } as never)
    ).resolves.toEqual({ id: 'rf_1' });

    expect(post).toHaveBeenCalledWith('/v3/payments/pay_1/refund', {
      value: 10,
    });
  });

  it('sends empty object when request is undefined', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'rf_1' } }));
    const service = new RefundPaymentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await service.refundPayment('pay_1');
    expect(post).toHaveBeenCalledWith('/v3/payments/pay_1/refund', {});
  });

  it('returns null when response is not 200', async () => {
    const post = jest.fn(async () => ({ status: 202, data: { id: 'rf_1' } }));
    const service = new RefundPaymentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.refundPayment('pay_1')).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const post = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'refund-pay-fail' }] } },
      };
    });
    const service = new RefundPaymentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.refundPayment('pay_1')).rejects.toThrow(
      'refund-pay-fail'
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
    const service = new RefundPaymentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.refundPayment('pay_1')).rejects.toThrow(
      'Erro desconhecido ao estornar cobrança'
    );
  });
});
