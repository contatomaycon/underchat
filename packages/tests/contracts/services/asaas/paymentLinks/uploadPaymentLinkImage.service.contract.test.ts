import 'reflect-metadata';
import axios from 'axios';
import { UploadPaymentLinkImageService } from '@core/services/asaas/paymentLinks/uploadPaymentLinkImage.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('UploadPaymentLinkImageService', () => {
  it('uploads payment link image and returns data when status is 200', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'img_1' } }));
    const service = new UploadPaymentLinkImageService({
      getAxiosInstance: () => ({ post }),
    } as never);

    const request = {
      image: new Blob(['file'], { type: 'image/png' }),
      main: true,
    };

    await expect(
      service.uploadPaymentLinkImage('pl_1', request as never)
    ).resolves.toEqual({
      id: 'img_1',
    });

    expect(post).toHaveBeenCalledWith(
      '/v3/paymentLinks/pl_1/images',
      expect.any(FormData),
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );
  });

  it('returns null when response is not 200', async () => {
    const post = jest.fn(async () => ({ status: 202, data: { id: 'img_1' } }));
    const service = new UploadPaymentLinkImageService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.uploadPaymentLinkImage('pl_1', {
        image: new Blob(['file']),
      } as never)
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
        response: { data: { errors: [{ description: 'upload-image-fail' }] } },
      };
    });
    const service = new UploadPaymentLinkImageService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.uploadPaymentLinkImage('pl_1', {
        image: new Blob(['file']),
      } as never)
    ).rejects.toThrow('upload-image-fail');
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
    const service = new UploadPaymentLinkImageService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.uploadPaymentLinkImage('pl_1', {
        image: new Blob(['file']),
      } as never)
    ).rejects.toThrow('Erro ao fazer upload de imagem do link de pagamentos');
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
    const service = new UploadPaymentLinkImageService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.uploadPaymentLinkImage('pl_1', {
        image: new Blob(['file']),
      } as never)
    ).rejects.toThrow(
      'Erro desconhecido ao fazer upload de imagem do link de pagamentos'
    );
  });
});
