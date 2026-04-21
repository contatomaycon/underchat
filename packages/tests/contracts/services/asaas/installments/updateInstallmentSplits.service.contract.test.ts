import 'reflect-metadata';
import axios from 'axios';
import { UpdateInstallmentSplitsService } from '@core/services/asaas/installments/updateInstallmentSplits.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('UpdateInstallmentSplitsService', () => {
  it('returns data when response is 200', async () => {
    const put = jest.fn(async () => ({ status: 200, data: { success: true } }));
    const service = new UpdateInstallmentSplitsService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updateInstallmentSplits('ins_1', { splits: [] } as never)
    ).resolves.toEqual({
      success: true,
    });

    expect(put).toHaveBeenCalledWith('/v3/installments/ins_1/splits', {
      splits: [],
    });
  });

  it('returns null when response is not 200', async () => {
    const put = jest.fn(async () => ({ status: 202, data: { success: true } }));
    const service = new UpdateInstallmentSplitsService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updateInstallmentSplits('ins_1', {} as never)
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
        response: { data: { errors: [{ description: 'splits-fail' }] } },
      };
    });
    const service = new UpdateInstallmentSplitsService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updateInstallmentSplits('ins_1', {} as never)
    ).rejects.toThrow('splits-fail');
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
    const service = new UpdateInstallmentSplitsService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updateInstallmentSplits('ins_1', {} as never)
    ).rejects.toThrow('Erro ao atualizar splits de parcelamento');
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
    const service = new UpdateInstallmentSplitsService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updateInstallmentSplits('ins_1', {} as never)
    ).rejects.toThrow('Erro desconhecido ao atualizar splits de parcelamento');
  });
});
