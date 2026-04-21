import 'reflect-metadata';
import axios from 'axios';
import { CreateInstallmentWithCreditCardService } from '@core/services/asaas/installments/createInstallmentWithCreditCard.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('CreateInstallmentWithCreditCardService', () => {
  it('returns data when response is 200', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'ins_1' } }));
    const service = new CreateInstallmentWithCreditCardService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.createInstallmentWithCreditCard({} as never)
    ).resolves.toEqual({
      id: 'ins_1',
    });

    expect(post).toHaveBeenCalledWith('/v3/installments/', {});
  });

  it('returns null when response is not 200', async () => {
    const post = jest.fn(async () => ({ status: 201, data: { id: 'ins_1' } }));
    const service = new CreateInstallmentWithCreditCardService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.createInstallmentWithCreditCard({} as never)
    ).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const post = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'create-ins-cc-fail' }] } },
      };
    });
    const service = new CreateInstallmentWithCreditCardService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.createInstallmentWithCreditCard({} as never)
    ).rejects.toThrow('create-ins-cc-fail');
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
    const service = new CreateInstallmentWithCreditCardService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.createInstallmentWithCreditCard({} as never)
    ).rejects.toThrow('Erro ao criar parcelamento com cartão de crédito');
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
    const service = new CreateInstallmentWithCreditCardService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.createInstallmentWithCreditCard({} as never)
    ).rejects.toThrow(
      'Erro desconhecido ao criar parcelamento com cartão de crédito'
    );
  });
});
