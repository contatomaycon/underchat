import 'reflect-metadata';
import axios from 'axios';
import { GetPaymentLinkImageService } from '@core/services/asaas/paymentLinks/getPaymentLinkImage.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('GetPaymentLinkImageService', () => {
  it('returns data when response is 200', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { id: 'img_1' } }));
    const service = new GetPaymentLinkImageService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentLinkImage('pl_1', 'img_1')).resolves.toEqual(
      {
        id: 'img_1',
      }
    );

    expect(get).toHaveBeenCalledWith('/v3/paymentLinks/pl_1/images/img_1');
  });

  it('returns null when response is not 200', async () => {
    const get = jest.fn(async () => ({ status: 204, data: { id: 'img_1' } }));
    const service = new GetPaymentLinkImageService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(
      service.getPaymentLinkImage('pl_1', 'img_1')
    ).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const get = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'get-image-fail' }] } },
      };
    });
    const service = new GetPaymentLinkImageService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentLinkImage('pl_1', 'img_1')).rejects.toThrow(
      'get-image-fail'
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
    const service = new GetPaymentLinkImageService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentLinkImage('pl_1', 'img_1')).rejects.toThrow(
      'Erro ao recuperar imagem do link de pagamentos'
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
    const service = new GetPaymentLinkImageService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getPaymentLinkImage('pl_1', 'img_1')).rejects.toThrow(
      'Erro desconhecido ao recuperar imagem do link de pagamentos'
    );
  });
});
