import 'reflect-metadata';
import axios from 'axios';
import { ListPaymentLinkImagesService } from '@core/services/asaas/paymentLinks/listPaymentLinkImages.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('ListPaymentLinkImagesService', () => {
  it('returns data when response is 200', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { data: [] } }));
    const service = new ListPaymentLinkImagesService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listPaymentLinkImages('pl_1')).resolves.toEqual({
      data: [],
    });

    expect(get).toHaveBeenCalledWith('/v3/paymentLinks/pl_1/images');
  });

  it('returns null when response is not 200', async () => {
    const get = jest.fn(async () => ({ status: 204, data: { data: [] } }));
    const service = new ListPaymentLinkImagesService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listPaymentLinkImages('pl_1')).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const get = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'list-images-fail' }] } },
      };
    });
    const service = new ListPaymentLinkImagesService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listPaymentLinkImages('pl_1')).rejects.toThrow(
      'list-images-fail'
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
    const service = new ListPaymentLinkImagesService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listPaymentLinkImages('pl_1')).rejects.toThrow(
      'Erro ao listar imagens do link de pagamentos'
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
    const service = new ListPaymentLinkImagesService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listPaymentLinkImages('pl_1')).rejects.toThrow(
      'Erro desconhecido ao listar imagens do link de pagamentos'
    );
  });
});
