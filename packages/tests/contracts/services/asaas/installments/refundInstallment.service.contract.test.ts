import 'reflect-metadata';
import axios from 'axios';
import { RefundInstallmentService } from '@core/services/asaas/installments/refundInstallment.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('RefundInstallmentService', () => {
  it('returns data when response is 200', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'rf_1' } }));
    const service = new RefundInstallmentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.refundInstallment('ins_1', { value: 1 } as never)
    ).resolves.toEqual({
      id: 'rf_1',
    });

    expect(post).toHaveBeenCalledWith('/v3/installments/ins_1/refund', {
      value: 1,
    });
  });

  it('sends empty object when request is not provided', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'rf_1' } }));
    const service = new RefundInstallmentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await service.refundInstallment('ins_1');
    expect(post).toHaveBeenCalledWith('/v3/installments/ins_1/refund', {});
  });

  it('returns null when response is not 200', async () => {
    const post = jest.fn(async () => ({ status: 202, data: { id: 'rf_1' } }));
    const service = new RefundInstallmentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.refundInstallment('ins_1')).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const post = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'refund-ins-fail' }] } },
      };
    });
    const service = new RefundInstallmentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.refundInstallment('ins_1')).rejects.toThrow(
      'refund-ins-fail'
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
    const service = new RefundInstallmentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.refundInstallment('ins_1')).rejects.toThrow(
      'Erro desconhecido ao estornar parcelamento'
    );
  });
});
