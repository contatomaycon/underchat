import 'reflect-metadata';
jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));
jest.mock('uuid', () => ({ v7: () => 'uuid-mock' }));
jest.mock('@core/services/balanceWorkerStatusGrpcClient.service', () => ({
  BalanceWorkerStatusGrpcClientService: class {},
}));
jest.mock(
  'file-type',
  () => ({
    fileTypeFromBuffer: jest.fn(async () => null),
  }),
  { virtual: true }
);
import { AccountPaymentService } from '@core/services/accountPayment.service';

describe('AccountPaymentService', () => {
  const t = (key: string) => key;

  const makeService = (overrides?: Record<string, unknown>) => {
    const repo = {
      findAccountPaymentById: jest.fn(async () => null),
      findNfSeByAccountPaymentId: jest.fn(async () => null),
      findAccountGenerateInvoiceById: jest.fn(async () => ({ enabled: true })),
      findPlanById: jest.fn(async () => ({ plan_id: 'p1' })),
      findUserCustomerByAccountPaymentId: jest.fn(async () => ({
        user_id: 'u1',
      })),
      findDefaultNfse: jest.fn(async () => ({ account_id: 'a1' })),
      ...overrides,
    };

    const service = new AccountPaymentService(
      {
        viewAccountPaymentNfse: jest.fn(async () => ({ id: 'nfse1' })),
      } as never,
      repo as never,
      { createInvoiceForPayment: jest.fn(async () => undefined) } as never
    );

    return { service, repo };
  };

  it('delegates view and validates account ownership for payment lookup', async () => {
    const { service, repo } = makeService({
      findAccountPaymentById: jest
        .fn<Promise<unknown>, unknown[]>()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ account_id: 'other' })
        .mockResolvedValueOnce({ account_id: 'a1', account_payment_id: 'ap1' }),
    });

    await expect(service.viewAccountPaymentNfse('a1', 'ap1')).resolves.toEqual({
      id: 'nfse1',
    });
    await expect(
      service.findAccountPaymentById('a1', 'ap1')
    ).resolves.toBeNull();
    await expect(
      service.findAccountPaymentById('a1', 'ap1')
    ).resolves.toBeNull();
    await expect(service.findAccountPaymentById('a1', 'ap1')).resolves.toEqual({
      account_id: 'a1',
      account_payment_id: 'ap1',
    });
    await expect(service.findNfSeByAccountPaymentId('ap1')).resolves.toBeNull();
    expect(repo.findNfSeByAccountPaymentId).toHaveBeenCalledWith('ap1');
  });

  it('throws expected errors across all NFSe validation branches', async () => {
    const createInvoiceForPayment = jest.fn(async () => undefined);
    const repo = {
      findAccountPaymentById: jest
        .fn<Promise<unknown>, unknown[]>()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ account_id: 'a1', plan_id: 'p1' })
        .mockResolvedValueOnce({ account_id: 'a1', plan_id: 'p1' })
        .mockResolvedValueOnce({ account_id: 'a1', plan_id: 'p1' })
        .mockResolvedValueOnce({ account_id: 'a1', plan_id: 'p1' })
        .mockResolvedValueOnce({ account_id: 'a1', plan_id: 'p1' })
        .mockResolvedValueOnce({ account_id: 'a1', plan_id: 'p1' }),
      findAccountGenerateInvoiceById: jest
        .fn<Promise<unknown>, unknown[]>()
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ enabled: true }),
      findPlanById: jest
        .fn<Promise<unknown>, unknown[]>()
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ plan_id: 'p1' }),
      findUserCustomerByAccountPaymentId: jest
        .fn<Promise<unknown>, unknown[]>()
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ id: 'u1' }),
      findNfSeByAccountPaymentId: jest
        .fn<Promise<unknown>, unknown[]>()
        .mockResolvedValueOnce({ account_payment_nfse_id: 'nf1' })
        .mockResolvedValue(null),
      findDefaultNfse: jest
        .fn<Promise<unknown>, unknown[]>()
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ ok: true }),
    };

    const service = new AccountPaymentService(
      { viewAccountPaymentNfse: jest.fn() } as never,
      repo as never,
      { createInvoiceForPayment } as never
    );

    await expect(
      service.generateAccountPaymentNfse(t as never, 'ap1', 'pay1')
    ).rejects.toThrow('account_payment_not_found');
    await expect(
      service.generateAccountPaymentNfse(t as never, 'ap1', 'pay1')
    ).rejects.toThrow('account_generate_invoice_not_configured');
    await expect(
      service.generateAccountPaymentNfse(t as never, 'ap1', 'pay1')
    ).rejects.toThrow('plan_not_found');
    await expect(
      service.generateAccountPaymentNfse(t as never, 'ap1', 'pay1')
    ).rejects.toThrow('user_customer_not_found');
    await expect(
      service.generateAccountPaymentNfse(t as never, 'ap1', 'pay1')
    ).rejects.toThrow('account_payment_nfse_already_generated');
    await expect(
      service.generateAccountPaymentNfse(t as never, 'ap1', 'pay1')
    ).rejects.toThrow('nfse_configuration_not_found');

    await expect(
      service.generateAccountPaymentNfse(t as never, 'ap1', 'pay1', true)
    ).resolves.toBeUndefined();
    expect(createInvoiceForPayment).toHaveBeenCalledWith('ap1', 'pay1', t, {
      skipGenerateInvoiceCheck: true,
    });
  });
});
