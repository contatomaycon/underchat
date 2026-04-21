import 'reflect-metadata';
import axios from 'axios';
import { CancelInvoiceService } from '@core/services/asaas/invoices/cancelInvoice.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('CancelInvoiceService', () => {
  it('cancels invoice and returns data when status is 200', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'inv_1' } }));
    const service = new CancelInvoiceService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(
      service.cancelInvoice('inv_1', { reason: 'any' } as never)
    ).resolves.toEqual({
      id: 'inv_1',
    });

    expect(post).toHaveBeenCalledWith('/v3/invoices/inv_1/cancel', {
      reason: 'any',
    });
  });

  it('sends empty object when request is not provided', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'inv_1' } }));
    const service = new CancelInvoiceService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await service.cancelInvoice('inv_1');

    expect(post).toHaveBeenCalledWith('/v3/invoices/inv_1/cancel', {});
  });

  it('returns null when status is not 200', async () => {
    const post = jest.fn(async () => ({ status: 202, data: { id: 'inv_1' } }));
    const service = new CancelInvoiceService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.cancelInvoice('inv_1')).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);

    const post = jest.fn(async () => {
      throw {
        response: {
          data: { errors: [{ description: 'invoice-cancel-fail' }] },
        },
      };
    });

    const service = new CancelInvoiceService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.cancelInvoice('inv_1')).rejects.toThrow(
      'invoice-cancel-fail'
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

    const service = new CancelInvoiceService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.cancelInvoice('inv_1')).rejects.toThrow(
      'Erro desconhecido ao cancelar nota fiscal'
    );
  });
});
