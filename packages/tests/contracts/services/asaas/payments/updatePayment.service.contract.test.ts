import 'reflect-metadata';
import axios from 'axios';
import { UpdatePaymentService } from '@core/services/asaas/payments/updatePayment.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('UpdatePaymentService', () => {
  it('returns data when response is 200', async () => {
    const put = jest.fn(async () => ({ status: 200, data: { id: 'pay_1' } }));
    const service = new UpdatePaymentService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updatePayment('pay_1', { description: 'x' } as never)
    ).resolves.toEqual({
      id: 'pay_1',
    });

    expect(put).toHaveBeenCalledWith('/v3/payments/pay_1', {
      description: 'x',
    });
  });

  it('returns null when response is not 200', async () => {
    const put = jest.fn(async () => ({ status: 202, data: { id: 'pay_1' } }));
    const service = new UpdatePaymentService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updatePayment('pay_1', {} as never)
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
        response: { data: { errors: [{ description: 'update-pay-fail' }] } },
      };
    });
    const service = new UpdatePaymentService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(service.updatePayment('pay_1', {} as never)).rejects.toThrow(
      'update-pay-fail'
    );
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
    const service = new UpdatePaymentService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(service.updatePayment('pay_1', {} as never)).rejects.toThrow(
      'Erro ao atualizar cobrança'
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
    const service = new UpdatePaymentService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(service.updatePayment('pay_1', {} as never)).rejects.toThrow(
      'Erro desconhecido ao atualizar cobrança'
    );
  });
});
