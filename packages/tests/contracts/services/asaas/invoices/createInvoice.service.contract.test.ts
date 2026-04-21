import 'reflect-metadata';
import axios from 'axios';
import { CreateInvoiceService } from '@core/services/asaas/invoices/createInvoice.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('CreateInvoiceService', () => {
  it('returns data when response is 200', async () => {
    const post = jest.fn(async () => ({ status: 200, data: { id: 'inv_1' } }));
    const service = new CreateInvoiceService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createInvoice({} as never)).resolves.toEqual({
      id: 'inv_1',
    });
  });

  it('returns null when response is not 200', async () => {
    const post = jest.fn(async () => ({ status: 202, data: { id: 'inv_1' } }));
    const service = new CreateInvoiceService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createInvoice({} as never)).resolves.toBeNull();
  });

  it('throws joined axios error descriptions when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);

    const post = jest.fn(async () => {
      throw {
        response: {
          data: {
            errors: [{ description: ' one ' }, { description: 'two' }, {}],
          },
        },
      };
    });

    const service = new CreateInvoiceService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createInvoice({} as never)).rejects.toThrow(
      'one; two'
    );
  });

  it('throws default axios message when no valid description is available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);

    const post = jest.fn(async () => {
      throw { response: { data: { errors: [{ description: '' }] } } };
    });

    const service = new CreateInvoiceService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createInvoice({} as never)).rejects.toThrow(
      'Erro ao agendar nota fiscal'
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

    const service = new CreateInvoiceService({
      getAxiosInstance: () => ({ post }),
    } as never);

    await expect(service.createInvoice({} as never)).rejects.toThrow(
      'Erro desconhecido ao agendar nota fiscal'
    );
  });
});
