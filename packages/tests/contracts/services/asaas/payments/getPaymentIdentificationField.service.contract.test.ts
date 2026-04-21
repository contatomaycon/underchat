import 'reflect-metadata';
import axios from 'axios';
import { GetPaymentIdentificationFieldService } from '@core/services/asaas/payments/getPaymentIdentificationField.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('GetPaymentIdentificationFieldService', () => {
  it('returns data when response is 200', async () => {
    const get = jest.fn(async () => ({
      status: 200,
      data: { identificationField: '123' },
    }));
    const service = new GetPaymentIdentificationFieldService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(
      service.getPaymentIdentificationField('pay_1')
    ).resolves.toEqual({
      identificationField: '123',
    });

    expect(get).toHaveBeenCalledWith('/v3/payments/pay_1/identificationField');
  });

  it('returns null when response is not 200', async () => {
    const get = jest.fn(async () => ({
      status: 202,
      data: { identificationField: '123' },
    }));
    const service = new GetPaymentIdentificationFieldService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(
      service.getPaymentIdentificationField('pay_1')
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
        response: { data: { errors: [{ description: 'id-field-fail' }] } },
      };
    });
    const service = new GetPaymentIdentificationFieldService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(
      service.getPaymentIdentificationField('pay_1')
    ).rejects.toThrow('id-field-fail');
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
    const service = new GetPaymentIdentificationFieldService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(
      service.getPaymentIdentificationField('pay_1')
    ).rejects.toThrow('Erro ao obter linha digitável do boleto');
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
    const service = new GetPaymentIdentificationFieldService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(
      service.getPaymentIdentificationField('pay_1')
    ).rejects.toThrow('Erro desconhecido ao obter linha digitável do boleto');
  });
});
