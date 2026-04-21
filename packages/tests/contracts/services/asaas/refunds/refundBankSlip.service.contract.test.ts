import 'reflect-metadata';
import axios from 'axios';
import { RefundBankSlipService } from '@core/services/asaas/refunds/refundBankSlip.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('RefundBankSlipService', () => {
  it('returns data when response is 200', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'rf_1' } }));
    const service = new RefundBankSlipService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.refundBankSlip('pay_1')).resolves.toEqual({
      id: 'rf_1',
    });
    expect(post).toHaveBeenCalledWith('/v3/payments/pay_1/bankSlip/refund', {});
  });

  it('returns null when response is not 200', async () => {
    const post = jest.fn(async () => ({ status: 202, data: { id: 'rf_1' } }));
    const service = new RefundBankSlipService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.refundBankSlip('pay_1')).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const post = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'refund-slip-fail' }] } },
      };
    });
    const service = new RefundBankSlipService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.refundBankSlip('pay_1')).rejects.toThrow(
      'refund-slip-fail'
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
    const service = new RefundBankSlipService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.refundBankSlip('pay_1')).rejects.toThrow(
      'Erro ao estornar boleto'
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
    const service = new RefundBankSlipService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.refundBankSlip('pay_1')).rejects.toThrow(
      'Erro desconhecido ao estornar boleto'
    );
  });
});
