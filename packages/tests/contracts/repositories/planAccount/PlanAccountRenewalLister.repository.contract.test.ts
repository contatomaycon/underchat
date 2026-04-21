import 'reflect-metadata';
import { PlanAccountRenewalListerRepository } from '@core/repositories/planAccount/PlanAccountRenewalLister.repository';

function createSelectChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const limit = jest.fn(() => ({ execute }));
  const orderBy = jest.fn(() => ({ limit }));
  const where = jest.fn(() => ({ orderBy }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return {
    select,
  };
}

describe('PlanAccountRenewalListerRepository', () => {
  it('returns mapped plan accounts for renewal and filters invalid rows/cross-sells', async () => {
    const dbRw = {
      query: {
        planAccount: {
          findMany: jest.fn(async () => [
            {
              plan_account_id: 'pa-1',
              account_id: 'acc-1',
              plan_id: 'plan-1',
              billing_period_id: 'monthly',
              value: '100',
              last_payment_date: '2026-04-01T00:00:00.000Z',
              next_payment_date: '2026-05-01T00:00:00.000Z',
              pac: {
                pca: [
                  {
                    plan_cross_sell_account_id: 'pcsa-1',
                    deleted_at: null,
                    cancellation_date: null,
                    pca: {
                      plan_cross_sell_id: 'pcs-1',
                      quantity: 2,
                      price: '19.9',
                      deleted_at: null,
                    },
                  },
                  {
                    plan_cross_sell_account_id: 'pcsa-2',
                    deleted_at: '2026-04-01T00:00:00.000Z',
                    cancellation_date: null,
                    pca: {
                      plan_cross_sell_id: 'pcs-2',
                      quantity: 1,
                      price: '9.9',
                      deleted_at: null,
                    },
                  },
                ],
              },
              ppl: {
                plan_id: 'plan-1',
                name: 'Plano 1',
                price: '100',
                price_old: '120',
                description: 'desc',
                annual_discount: '10',
                icon: null,
                is_test: false,
                days_trial: 7,
              },
            },
            {
              plan_account_id: 'pa-invalid',
              account_id: 'acc-2',
              plan_id: 'plan-2',
              billing_period_id: 'monthly',
              value: '50',
              last_payment_date: null,
              next_payment_date: null,
              pac: null,
              ppl: null,
            },
          ]),
        },
      },
      select: jest.fn(),
    };

    const repository = new PlanAccountRenewalListerRepository(dbRw as never);

    await expect(repository.findPlanAccountsForRenewal()).resolves.toEqual([
      {
        plan_account_id: 'pa-1',
        account_id: 'acc-1',
        plan_id: 'plan-1',
        billing_period_id: 'monthly',
        value: '100',
        last_payment_date: '2026-04-01T00:00:00.000Z',
        next_payment_date: '2026-05-01T00:00:00.000Z',
        plan: {
          plan_id: 'plan-1',
          name: 'Plano 1',
          price: '100',
          price_old: '120',
          description: 'desc',
          annual_discount: '10',
          icon: null,
          is_test: false,
          days_trial: 7,
        },
        cross_sells: [
          {
            plan_cross_sell_id: 'pcs-1',
            plan_cross_sell_account_id: 'pcsa-1',
            quantity: 2,
            price: '19.9',
          },
        ],
      },
    ]);
  });

  it('returns pending successful renewal payment and null fallback', async () => {
    const { select } = createSelectChain([
      {
        account_payment_id: 'ap-1',
        billing_period_id: 'monthly',
        recurring_payment: true,
        value: '100',
        payment_date: '2026-04-20T00:00:00.000Z',
        payment_status_id: 'received',
        created_at: '2026-04-20T00:00:00.000Z',
      },
    ]);

    const dbRw = {
      query: {
        planAccount: {
          findMany: jest.fn(async () => []),
        },
      },
      select,
    };

    const repository = new PlanAccountRenewalListerRepository(dbRw as never);

    await expect(
      repository.findPendingSuccessfulRenewalPayment({
        accountId: 'acc-1',
        planId: 'plan-1',
        lastPaymentDate: '2026-04-01T00:00:00.000Z',
      })
    ).resolves.toEqual({
      account_payment_id: 'ap-1',
      billing_period_id: 'monthly',
      recurring_payment: true,
      value: '100',
      payment_date: '2026-04-20T00:00:00.000Z',
      payment_status_id: 'received',
      created_at: '2026-04-20T00:00:00.000Z',
    });

    const emptyChain = createSelectChain([]);
    const repositoryEmpty = new PlanAccountRenewalListerRepository({
      query: {
        planAccount: {
          findMany: jest.fn(async () => []),
        },
      },
      select: emptyChain.select,
    } as never);

    await expect(
      repositoryEmpty.findPendingSuccessfulRenewalPayment({
        accountId: 'acc-1',
        planId: 'plan-1',
        lastPaymentDate: null,
      })
    ).resolves.toBeNull();
  });
});
