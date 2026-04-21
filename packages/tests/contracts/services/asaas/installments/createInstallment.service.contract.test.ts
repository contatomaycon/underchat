import 'reflect-metadata';
import axios from 'axios';
import { CreateInstallmentService } from '@core/services/asaas/installments/createInstallment.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('CreateInstallmentService', () => {
  it('returns data when response is 200', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'ins_1' } }));
    const service = new CreateInstallmentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createInstallment({} as never)).resolves.toEqual({
      id: 'ins_1',
    });
  });

  it('returns null when response is not 200', async () => {
    const post = jest.fn(async () => ({ status: 201, data: { id: 'ins_1' } }));
    const service = new CreateInstallmentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createInstallment({} as never)).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const post = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'create-ins-fail' }] } },
      };
    });
    const service = new CreateInstallmentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createInstallment({} as never)).rejects.toThrow(
      'create-ins-fail'
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
    const service = new CreateInstallmentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createInstallment({} as never)).rejects.toThrow(
      'Erro ao criar parcelamento'
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
    const service = new CreateInstallmentService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createInstallment({} as never)).rejects.toThrow(
      'Erro desconhecido ao criar parcelamento'
    );
  });
});
