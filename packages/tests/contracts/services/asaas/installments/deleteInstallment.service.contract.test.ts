import 'reflect-metadata';
import axios from 'axios';
import { DeleteInstallmentService } from '@core/services/asaas/installments/deleteInstallment.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('DeleteInstallmentService', () => {
  it('returns data when response is 200', async () => {
    const deleteFn = jest.fn(async () => ({
      status: 200,
      data: { id: 'ins_1' },
    }));
    const service = new DeleteInstallmentService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(service.deleteInstallment('ins_1')).resolves.toEqual({
      id: 'ins_1',
    });

    expect(deleteFn).toHaveBeenCalledWith('/v3/installments/ins_1');
  });

  it('returns null when response is not 200', async () => {
    const deleteFn = jest.fn(async () => ({
      status: 202,
      data: { id: 'ins_1' },
    }));
    const service = new DeleteInstallmentService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(service.deleteInstallment('ins_1')).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const deleteFn = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'delete-ins-fail' }] } },
      };
    });
    const service = new DeleteInstallmentService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(service.deleteInstallment('ins_1')).rejects.toThrow(
      'delete-ins-fail'
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
    const service = new DeleteInstallmentService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(service.deleteInstallment('ins_1')).rejects.toThrow(
      'Erro ao remover parcelamento'
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
    const service = new DeleteInstallmentService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(service.deleteInstallment('ins_1')).rejects.toThrow(
      'Erro desconhecido ao remover parcelamento'
    );
  });
});
