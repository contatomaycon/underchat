import 'reflect-metadata';
import axios from 'axios';
import { UpdatePaymentLinkService } from '@core/services/asaas/paymentLinks/updatePaymentLink.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('UpdatePaymentLinkService', () => {
  it('returns data when response is 200', async () => {
    const put = jest.fn(async () => ({ status: 200, data: { id: 'pl_1' } }));
    const service = new UpdatePaymentLinkService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updatePaymentLink('pl_1', { name: 'New' } as never)
    ).resolves.toEqual({
      id: 'pl_1',
    });

    expect(put).toHaveBeenCalledWith('/v3/paymentLinks/pl_1', { name: 'New' });
  });

  it('returns null when response is not 200', async () => {
    const put = jest.fn(async () => ({ status: 202, data: { id: 'pl_1' } }));
    const service = new UpdatePaymentLinkService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updatePaymentLink('pl_1', {} as never)
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
        response: { data: { errors: [{ description: 'update-pl-fail' }] } },
      };
    });
    const service = new UpdatePaymentLinkService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updatePaymentLink('pl_1', {} as never)
    ).rejects.toThrow('update-pl-fail');
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
    const service = new UpdatePaymentLinkService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updatePaymentLink('pl_1', {} as never)
    ).rejects.toThrow('Erro ao atualizar link de pagamentos');
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
    const service = new UpdatePaymentLinkService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updatePaymentLink('pl_1', {} as never)
    ).rejects.toThrow('Erro desconhecido ao atualizar link de pagamentos');
  });
});
