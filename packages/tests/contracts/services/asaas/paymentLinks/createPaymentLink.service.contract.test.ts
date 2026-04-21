import 'reflect-metadata';
import axios from 'axios';
import { CreatePaymentLinkService } from '@core/services/asaas/paymentLinks/createPaymentLink.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('CreatePaymentLinkService', () => {
  it('returns data when response is 200', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'pl_1' } }));
    const service = new CreatePaymentLinkService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createPaymentLink({} as never)).resolves.toEqual({
      id: 'pl_1',
    });
  });

  it('returns null when response is not 200', async () => {
    const post = jest.fn(async () => ({ status: 202, data: { id: 'pl_1' } }));
    const service = new CreatePaymentLinkService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createPaymentLink({} as never)).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const post = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'create-pl-fail' }] } },
      };
    });
    const service = new CreatePaymentLinkService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createPaymentLink({} as never)).rejects.toThrow(
      'create-pl-fail'
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
    const service = new CreatePaymentLinkService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createPaymentLink({} as never)).rejects.toThrow(
      'Erro ao criar link de pagamentos'
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
    const service = new CreatePaymentLinkService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createPaymentLink({} as never)).rejects.toThrow(
      'Erro desconhecido ao criar link de pagamentos'
    );
  });
});
