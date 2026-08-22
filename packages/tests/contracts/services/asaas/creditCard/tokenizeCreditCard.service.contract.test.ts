import 'reflect-metadata';
import axios from 'axios';
import { CreditCardAlreadyTokenizedError } from '@core/common/exceptions/UserCardError';
import { TokenizeCreditCardService } from '@core/services/asaas/creditCard/tokenizeCreditCard.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('TokenizeCreditCardService', () => {
  it('returns tokenized card data when response is 200', async () => {
    const post = jest.fn(async () => ({
      status: 200,
      data: { creditCardToken: 'token' },
    }));
    const service = new TokenizeCreditCardService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.tokenizeCreditCard({} as never)).resolves.toEqual({
      creditCardToken: 'token',
    });

    expect(post).toHaveBeenCalledWith('/v3/creditCard/tokenizeCreditCard', {});
  });

  it('returns null when response is not 200', async () => {
    const post = jest.fn(async () => ({
      status: 201,
      data: { creditCardToken: 'token' },
    }));
    const service = new TokenizeCreditCardService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.tokenizeCreditCard({} as never)).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const post = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'tokenize-fail' }] } },
      };
    });
    const service = new TokenizeCreditCardService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.tokenizeCreditCard({} as never)).rejects.toThrow(
      'tokenize-fail'
    );
  });

  it('maps an already tokenized card response to a safe domain error', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const asaasDescription = 'Cartão 223702****6481 já tokenizado';
    const post = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: asaasDescription }] } },
      };
    });
    const service = new TokenizeCreditCardService({
      getAxiosInstance: () => ({ post }),
    } as never);

    try {
      await service.tokenizeCreditCard({} as never);
      throw new Error('Expected tokenization to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(CreditCardAlreadyTokenizedError);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain('223702');
      expect((error as Error).message).not.toContain('6481');
    }
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
    const service = new TokenizeCreditCardService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.tokenizeCreditCard({} as never)).rejects.toThrow(
      'Erro ao tokenizar cartão de crédito'
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
    const service = new TokenizeCreditCardService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.tokenizeCreditCard({} as never)).rejects.toThrow(
      'Erro desconhecido ao tokenizar cartão de crédito'
    );
  });
});
