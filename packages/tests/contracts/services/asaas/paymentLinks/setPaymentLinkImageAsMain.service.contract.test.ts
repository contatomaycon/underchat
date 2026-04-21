import 'reflect-metadata';
import axios from 'axios';
import { SetPaymentLinkImageAsMainService } from '@core/services/asaas/paymentLinks/setPaymentLinkImageAsMain.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('SetPaymentLinkImageAsMainService', () => {
  it('returns data when response is 200', async () => {
    const put = jest.fn(async () => ({ status: 200, data: { success: true } }));
    const service = new SetPaymentLinkImageAsMainService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.setPaymentLinkImageAsMain('pl_1', 'img_1')
    ).resolves.toEqual({
      success: true,
    });

    expect(put).toHaveBeenCalledWith(
      '/v3/paymentLinks/pl_1/images/img_1/setAsMain',
      {}
    );
  });

  it('returns null when response is not 200', async () => {
    const put = jest.fn(async () => ({ status: 202, data: { success: true } }));
    const service = new SetPaymentLinkImageAsMainService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.setPaymentLinkImageAsMain('pl_1', 'img_1')
    ).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const put = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'set-main-fail' }] } },
      };
    });
    const service = new SetPaymentLinkImageAsMainService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.setPaymentLinkImageAsMain('pl_1', 'img_1')
    ).rejects.toThrow('set-main-fail');
  });

  it('throws default axios message when no description is available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const put = jest.fn(async () => {
      throw { response: { data: {} } };
    });
    const service = new SetPaymentLinkImageAsMainService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.setPaymentLinkImageAsMain('pl_1', 'img_1')
    ).rejects.toThrow('Erro ao definir imagem principal do link de pagamentos');
  });

  it('throws unknown message for non-axios errors', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(false);
    const put = jest.fn(async () => {
      throw new Error('boom');
    });
    const service = new SetPaymentLinkImageAsMainService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.setPaymentLinkImageAsMain('pl_1', 'img_1')
    ).rejects.toThrow(
      'Erro desconhecido ao definir imagem principal do link de pagamentos'
    );
  });
});
