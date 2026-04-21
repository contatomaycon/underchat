import 'reflect-metadata';
import { AccountPaymentsListerRepository } from '@core/repositories/accountSettings/AccountPaymentsLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('AccountPaymentsListerRepository', () => {
  it('maps payments with cross sells and nfse flags', async () => {
    const findMany = jest.fn(async () => [
      {
        account_payment_id: 'payment-1',
        payment_billing_type_id: 'billing-1',
        plan_id: 'plan-1',
        value: '100.00',
        payment_status_id: 'status-1',
        payment_date: '2026-04-20',
        created_at: '2026-04-21T10:00:00.000Z',
        invoice_url: 'http://invoice',
        apb: { name: 'pix' },
        apl: { name: 'Starter', icon: 'icon.svg' },
        aps: { name: 'paid' },
        apn: [{ account_payment_nfse_id: 'nfse-1' }],
        apc: [
          {
            account_payment_cross_sell_id: 'cross-1',
            quantity: 2,
            value: '20.00',
            apc: {
              ppt: {
                ppd: {
                  name: 'Addon A',
                },
              },
            },
          },
        ],
      },
    ]);
    const repository = new AccountPaymentsListerRepository({
      query: {
        accountPayment: {
          findMany,
        },
      },
    } as never);

    await expect(
      repository.listAccountPayments('acc-1', 10, 1)
    ).resolves.toEqual([
      {
        account_payment_id: 'payment-1',
        payment_billing_type_id: 'billing-1',
        payment_billing_type_name: 'pix',
        payment_billing_type_icon: null,
        plan_id: 'plan-1',
        plan_name: 'Starter',
        plan_icon: 'icon.svg',
        value: '100.00',
        payment_status_id: 'status-1',
        payment_status_name: 'paid',
        payment_date: '2026-04-20',
        created_at: '2026-04-21T10:00:00.000Z',
        invoice_url: 'http://invoice',
        has_nfse: true,
        cross_sells: [
          {
            account_payment_cross_sell_id: 'cross-1',
            name: 'Addon A',
            quantity: 2,
            value: '20.00',
          },
        ],
      },
    ]);
  });

  it('returns empty list when findMany is nullish', async () => {
    const repository = new AccountPaymentsListerRepository({
      query: {
        accountPayment: {
          findMany: jest.fn(async () => undefined),
        },
      },
    } as never);

    await expect(
      repository.listAccountPayments('acc-1', 10, 1)
    ).resolves.toEqual([]);
  });

  it('returns total count with zero fallback', async () => {
    const withCount = createSelectDbMock([{ count: 3 }]);
    const withCountRepository = new AccountPaymentsListerRepository(
      withCount.db as never
    );
    await expect(
      withCountRepository.listAccountPaymentsTotal('acc-1')
    ).resolves.toBe(3);

    const withoutCount = createSelectDbMock([]);
    const withoutCountRepository = new AccountPaymentsListerRepository(
      withoutCount.db as never
    );
    await expect(
      withoutCountRepository.listAccountPaymentsTotal('acc-1')
    ).resolves.toBe(0);
  });
});
