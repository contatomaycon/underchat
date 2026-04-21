import 'reflect-metadata';
import axios from 'axios';
import { ListPaymentRefundsService } from '@core/services/asaas/refunds/listPaymentRefunds.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('ListPaymentRefundsService', () => {
  it('returns data when response is 200', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { data: [] } }));
    const service = new ListPaymentRefundsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listPaymentRefunds('pay_1')).resolves.toEqual({
      data: [],
    });
    expect(get).toHaveBeenCalledWith('/v3/payments/pay_1/refunds');
  });

  it('returns null when response is not 200', async () => {
    const get = jest.fn(async () => ({ status: 202, data: { data: [] } }));
    const service = new ListPaymentRefundsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listPaymentRefunds('pay_1')).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const get = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'refunds-fail' }] } },
      };
    });
    const service = new ListPaymentRefundsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listPaymentRefunds('pay_1')).rejects.toThrow(
      'refunds-fail'
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
    const service = new ListPaymentRefundsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listPaymentRefunds('pay_1')).rejects.toThrow(
      'Erro ao listar estornos da cobrança'
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
    const service = new ListPaymentRefundsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listPaymentRefunds('pay_1')).rejects.toThrow(
      'Erro desconhecido ao listar estornos da cobrança'
    );
  });
});
