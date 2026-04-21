import 'reflect-metadata';
import axios from 'axios';
import { DeletePaymentLinkImageService } from '@core/services/asaas/paymentLinks/deletePaymentLinkImage.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('DeletePaymentLinkImageService', () => {
  it('returns data when response is 200', async () => {
    const deleteFn = jest.fn(async () => ({
      status: 200,
      data: { id: 'img_1' },
    }));
    const service = new DeletePaymentLinkImageService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(
      service.deletePaymentLinkImage('pl_1', 'img_1')
    ).resolves.toEqual({
      id: 'img_1',
    });

    expect(deleteFn).toHaveBeenCalledWith('/v3/paymentLinks/pl_1/images/img_1');
  });

  it('returns null when response is not 200', async () => {
    const deleteFn = jest.fn(async () => ({
      status: 204,
      data: { id: 'img_1' },
    }));
    const service = new DeletePaymentLinkImageService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(
      service.deletePaymentLinkImage('pl_1', 'img_1')
    ).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const deleteFn = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'delete-image-fail' }] } },
      };
    });
    const service = new DeletePaymentLinkImageService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(
      service.deletePaymentLinkImage('pl_1', 'img_1')
    ).rejects.toThrow('delete-image-fail');
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
    const service = new DeletePaymentLinkImageService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(
      service.deletePaymentLinkImage('pl_1', 'img_1')
    ).rejects.toThrow('Erro ao remover imagem do link de pagamentos');
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
    const service = new DeletePaymentLinkImageService({
      getAxiosInstance: () => ({ delete: deleteFn }),
    } as never);

    await expect(
      service.deletePaymentLinkImage('pl_1', 'img_1')
    ).rejects.toThrow(
      'Erro desconhecido ao remover imagem do link de pagamentos'
    );
  });
});
