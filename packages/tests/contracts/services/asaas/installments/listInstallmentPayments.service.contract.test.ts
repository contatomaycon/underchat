import 'reflect-metadata';
import axios from 'axios';
import { ListInstallmentPaymentsService } from '@core/services/asaas/installments/listInstallmentPayments.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('ListInstallmentPaymentsService', () => {
  it('lists installment payments with status query when request is provided', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { data: [] } }));
    const service = new ListInstallmentPaymentsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(
      service.listInstallmentPayments('ins_1', { status: 'PENDING' } as never)
    ).resolves.toEqual({ data: [] });

    expect(get).toHaveBeenCalledWith(
      '/v3/installments/ins_1/payments?status=PENDING'
    );
  });

  it('lists installment payments without query when request is undefined', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { data: [] } }));
    const service = new ListInstallmentPaymentsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listInstallmentPayments('ins_1')).resolves.toEqual({
      data: [],
    });
    expect(get).toHaveBeenCalledWith('/v3/installments/ins_1/payments');
  });

  it('returns null when response is not 200', async () => {
    const get = jest.fn(async () => ({ status: 202, data: { data: [] } }));
    const service = new ListInstallmentPaymentsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listInstallmentPayments('ins_1')).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const get = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'list-payments-fail' }] } },
      };
    });
    const service = new ListInstallmentPaymentsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listInstallmentPayments('ins_1')).rejects.toThrow(
      'list-payments-fail'
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
    const service = new ListInstallmentPaymentsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listInstallmentPayments('ins_1')).rejects.toThrow(
      'Erro desconhecido ao listar cobranças de parcelamento'
    );
  });
});
