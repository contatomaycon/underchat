import 'reflect-metadata';
import axios from 'axios';
import { AuthorizeInvoiceService } from '@core/services/asaas/invoices/authorizeInvoice.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('AuthorizeInvoiceService', () => {
  it('returns data when response is 200', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'inv_1' } }));
    const service = new AuthorizeInvoiceService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.authorizeInvoice('inv_1')).resolves.toEqual({
      id: 'inv_1',
    });
  });

  it('returns null when response is not 200', async () => {
    const post = jest.fn(async () => ({ status: 201, data: { id: 'inv_1' } }));
    const service = new AuthorizeInvoiceService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.authorizeInvoice('inv_1')).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const post = jest.fn(async () => {
      throw { response: { data: { errors: [{ description: 'fail-desc' }] } } };
    });
    const service = new AuthorizeInvoiceService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.authorizeInvoice('inv_1')).rejects.toThrow(
      'fail-desc'
    );
  });

  it('throws default axios message when description is unavailable', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const post = jest.fn(async () => {
      throw { response: { data: {} } };
    });
    const service = new AuthorizeInvoiceService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.authorizeInvoice('inv_1')).rejects.toThrow(
      'Erro ao emitir nota fiscal'
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
    const service = new AuthorizeInvoiceService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.authorizeInvoice('inv_1')).rejects.toThrow(
      'Erro desconhecido ao emitir nota fiscal'
    );
  });
});
