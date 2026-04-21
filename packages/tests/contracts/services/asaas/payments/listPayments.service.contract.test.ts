import 'reflect-metadata';
import axios from 'axios';
import { ListPaymentsService } from '@core/services/asaas/payments/listPayments.service';

jest.mock('axios', () => ({
  __esModule: true,
  default: { isAxiosError: jest.fn() },
}));

describe('ListPaymentsService', () => {
  it('builds query params from request and returns data when response is 200', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { data: [] } }));
    const service = new ListPaymentsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(
      service.listPayments({
        installment: 'ins_1',
        customer: 'cus_1',
        customerGroupName: 'group',
        billingType: 'PIX',
        status: 'PENDING',
        subscription: 'sub_1',
        externalReference: 'ext_1',
        paymentDate: '2026-01-01',
        invoiceStatus: 'SCHEDULED',
        estimatedCreditDate: '2026-01-02',
        pixQrCodeId: 'pix_1',
        user: 'usr_1',
        offset: 0,
        limit: 20,
        anticipated: true,
        anticipable: false,
        dateCreatedGe: '2026-01-01',
        dateCreatedLe: '2026-01-31',
        paymentDateGe: '2026-01-05',
        paymentDateLe: '2026-01-25',
        estimatedCreditDateGe: '2026-01-06',
        estimatedCreditDateLe: '2026-01-24',
        dueDateGe: '2026-01-07',
        dueDateLe: '2026-01-23',
      } as never)
    ).resolves.toEqual({ data: [] });

    const calledUrl = get.mock.calls.at(0)?.at(0);
    expect(typeof calledUrl).toBe('string');
    expect(calledUrl).toContain('/v3/payments?');
    expect(calledUrl).toContain('installment=ins_1');
    expect(calledUrl).toContain('customer=cus_1');
    expect(calledUrl).toContain('customerGroupName=group');
    expect(calledUrl).toContain('billingType=PIX');
    expect(calledUrl).toContain('status=PENDING');
    expect(calledUrl).toContain('subscription=sub_1');
    expect(calledUrl).toContain('externalReference=ext_1');
    expect(calledUrl).toContain('paymentDate=2026-01-01');
    expect(calledUrl).toContain('invoiceStatus=SCHEDULED');
    expect(calledUrl).toContain('estimatedCreditDate=2026-01-02');
    expect(calledUrl).toContain('pixQrCodeId=pix_1');
    expect(calledUrl).toContain('user=usr_1');
    expect(calledUrl).toContain('offset=0');
    expect(calledUrl).toContain('limit=20');
    expect(calledUrl).toContain('anticipated=true');
    expect(calledUrl).toContain('anticipable=false');
    expect(calledUrl).toContain('dateCreated%5Bge%5D=2026-01-01');
    expect(calledUrl).toContain('dateCreated%5Ble%5D=2026-01-31');
    expect(calledUrl).toContain('paymentDate%5Bge%5D=2026-01-05');
    expect(calledUrl).toContain('paymentDate%5Ble%5D=2026-01-25');
    expect(calledUrl).toContain('estimatedCreditDate%5Bge%5D=2026-01-06');
    expect(calledUrl).toContain('estimatedCreditDate%5Ble%5D=2026-01-24');
    expect(calledUrl).toContain('dueDate%5Bge%5D=2026-01-07');
    expect(calledUrl).toContain('dueDate%5Ble%5D=2026-01-23');
  });

  it('uses base endpoint when request is not provided', async () => {
    const get = jest.fn(async () => ({ status: 200, data: { data: [] } }));
    const service = new ListPaymentsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listPayments()).resolves.toEqual({ data: [] });
    expect(get).toHaveBeenCalledWith('/v3/payments');
  });

  it('returns null when response is not 200', async () => {
    const get = jest.fn(async () => ({ status: 204, data: { data: [] } }));
    const service = new ListPaymentsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listPayments()).resolves.toBeNull();
  });

  it('throws first axios error description when available', async () => {
    (
      axios.isAxiosError as unknown as jest.MockedFunction<
        typeof axios.isAxiosError
      >
    ).mockReturnValue(true);
    const get = jest.fn(async () => {
      throw {
        response: { data: { errors: [{ description: 'list-pay-fail' }] } },
      };
    });
    const service = new ListPaymentsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listPayments()).rejects.toThrow('list-pay-fail');
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
    const service = new ListPaymentsService({
      getAxiosInstance: () => ({ get }),
    } as never);

    await expect(service.listPayments()).rejects.toThrow(
      'Erro desconhecido ao listar cobranças'
    );
  });
});
