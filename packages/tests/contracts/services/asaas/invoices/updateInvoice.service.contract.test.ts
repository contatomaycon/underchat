import 'reflect-metadata';
import axios from 'axios';
import { UpdateInvoiceService } from '@core/services/asaas/invoices/updateInvoice.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('UpdateInvoiceService', () => {
  it('updates invoice and returns data when status is 200', async () => {
    const put = jest.fn(async () => ({ status: 200, data: { id: 'inv_1' } }));
    const service = new UpdateInvoiceService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updateInvoice('inv_1', { status: 'AUTHORIZED' } as never)
    ).resolves.toEqual({
      id: 'inv_1',
    });

    expect(put).toHaveBeenCalledWith('/v3/invoices/inv_1', {
      status: 'AUTHORIZED',
    });
  });

  it('returns null when status is not 200', async () => {
    const put = jest.fn(async () => ({ status: 202, data: { id: 'inv_1' } }));
    const service = new UpdateInvoiceService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(
      service.updateInvoice('inv_1', {} as never)
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
        response: {
          data: { errors: [{ description: 'invoice-update-fail' }] },
        },
      };
    });

    const service = new UpdateInvoiceService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(service.updateInvoice('inv_1', {} as never)).rejects.toThrow(
      'invoice-update-fail'
    );
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

    const service = new UpdateInvoiceService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(service.updateInvoice('inv_1', {} as never)).rejects.toThrow(
      'Erro ao atualizar nota fiscal'
    );
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

    const service = new UpdateInvoiceService({
      getAxiosInstance: () => ({ put }),
    } as never);

    await expect(service.updateInvoice('inv_1', {} as never)).rejects.toThrow(
      'Erro desconhecido ao atualizar nota fiscal'
    );
  });
});
