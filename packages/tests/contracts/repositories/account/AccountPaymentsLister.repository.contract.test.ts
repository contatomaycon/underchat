import 'reflect-metadata';
import { AccountPaymentsListerRepository } from '@core/repositories/account/AccountPaymentsLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('AccountPaymentsListerRepository', () => {
  it('maps account payments with nfse and cross sell details', async () => {
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
      {
        account_payment_id: 'payment-2',
        payment_billing_type_id: 'billing-2',
        plan_id: 'plan-2',
        value: '50.00',
        payment_status_id: 'status-2',
        payment_date: null,
        created_at: null,
        invoice_url: null,
        apb: null,
        apl: null,
        aps: null,
        apn: [],
        apc: [],
      },
    ]);
    const db = {
      query: {
        accountPayment: {
          findMany,
        },
      },
    };
    const repository = new AccountPaymentsListerRepository(db as never);

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
      {
        account_payment_id: 'payment-2',
        payment_billing_type_id: 'billing-2',
        payment_billing_type_name: '',
        payment_billing_type_icon: null,
        plan_id: 'plan-2',
        plan_name: '',
        plan_icon: null,
        value: '50.00',
        payment_status_id: 'status-2',
        payment_status_name: '',
        payment_date: null,
        created_at: '',
        invoice_url: null,
        has_nfse: false,
        cross_sells: [],
      },
    ]);
  });

  it('returns empty list when query result is nullish', async () => {
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

  it('returns total count with default zero fallback', async () => {
    const withCount = createSelectDbMock([{ count: 7 }]);
    const repositoryWithCount = new AccountPaymentsListerRepository(
      withCount.db as never
    );
    await expect(
      repositoryWithCount.listAccountPaymentsTotal('acc-1')
    ).resolves.toBe(7);

    const withoutCount = createSelectDbMock([]);
    const repositoryWithoutCount = new AccountPaymentsListerRepository(
      withoutCount.db as never
    );
    await expect(
      repositoryWithoutCount.listAccountPaymentsTotal('acc-1')
    ).resolves.toBe(0);
  });
});
