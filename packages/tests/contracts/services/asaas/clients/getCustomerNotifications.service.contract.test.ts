import 'reflect-metadata';
import axios from 'axios';
import { GetCustomerNotificationsService } from '@core/services/asaas/clients/getCustomerNotifications.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('GetCustomerNotificationsService', () => {
  it('returns data when response is 200', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { data: [] } }));
    const service = new GetCustomerNotificationsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getCustomerNotifications('cus_1')).resolves.toEqual({
      data: [],
    });
  });

  it('returns null when response is not 200', async () => {
    const get = jest.fn(async () => ({ status: 201, data: { data: [] } }));
    const service = new GetCustomerNotificationsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getCustomerNotifications('cus_1')).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const get = jest.fn(async () => {
      throw { response: { data: { errors: [{ description: 'fail-desc' }] } } };
    });
    const service = new GetCustomerNotificationsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getCustomerNotifications('cus_1')).rejects.toThrow(
      'fail-desc'
    );
  });

  it('throws default axios message when description is unavailable', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const get = jest.fn(async () => {
      throw { response: { data: {} } };
    });
    const service = new GetCustomerNotificationsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getCustomerNotifications('cus_1')).rejects.toThrow(
      'Erro ao buscar notificações de cliente'
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
    const service = new GetCustomerNotificationsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.getCustomerNotifications('cus_1')).rejects.toThrow(
      'Erro desconhecido ao buscar notificações de cliente'
    );
  });
});
