import 'reflect-metadata';
import { AccountListerRepository } from '@core/repositories/account/AccountLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('AccountListerRepository', () => {
  it('returns mapped accounts with active plan', async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const findMany = jest.fn(async () => [
      {
        account_id: 'acc-1',
        name: 'Account A',
        created_at: '2026-04-21T10:00:00.000Z',
        aac: {
          account_status_id: 'status-1',
          name: 'Active',
        },
        apc: [
          {
            plan_account_id: 'plan-account-1',
            next_payment_date: futureDate,
            recurring_payment: true,
            ppl: {
              plan_id: 'plan-1',
              name: 'Starter',
            },
            bpl: {
              billing_period_id: 'monthly',
              name: 'monthly',
            },
          },
        ],
      },
    ]);
    const repository = new AccountListerRepository({
      query: {
        account: {
          findMany,
        },
      },
    } as never);

    await expect(
      repository.listAccounts(10, 1, {
        account_id: 'acc-1',
        name: 'Account',
        plan: 'Starter',
        account_status: 'status-1',
      } as never)
    ).resolves.toEqual([
      {
        account_id: 'acc-1',
        name: 'Account A',
        account_status: {
          account_status_id: 'status-1',
          name: 'Active',
        },
        plan: {
          plan_id: 'plan-1',
          name: 'Starter',
          recurring_payment: true,
          billing_period: 'monthly',
        },
        created_at: '2026-04-21T10:00:00.000Z',
      },
    ]);
  });

  it('returns null billing period for active plan when value is unsupported', async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const repository = new AccountListerRepository({
      query: {
        account: {
          findMany: jest.fn(async () => [
            {
              account_id: 'acc-2',
              name: 'Account B',
              created_at: '2026-04-21T11:00:00.000Z',
              aac: null,
              apc: [
                {
                  plan_account_id: 'plan-account-2',
                  next_payment_date: futureDate,
                  recurring_payment: false,
                  ppl: {
                    plan_id: 'plan-2',
                    name: 'Pro',
                  },
                  bpl: {
                    billing_period_id: 'weekly',
                    name: 'weekly',
                  },
                },
              ],
            },
          ]),
        },
      },
    } as never);

    await expect(repository.listAccounts(10, 1, {} as never)).resolves.toEqual([
      {
        account_id: 'acc-2',
        name: 'Account B',
        account_status: null,
        plan: {
          plan_id: 'plan-2',
          name: 'Pro',
          recurring_payment: false,
          billing_period: null,
        },
        created_at: '2026-04-21T11:00:00.000Z',
      },
    ]);
  });

  it('returns empty array when list query result is nullish', async () => {
    const repository = new AccountListerRepository({
      query: {
        account: {
          findMany: jest.fn(async () => undefined),
        },
      },
    } as never);

    await expect(repository.listAccounts(10, 1, {} as never)).resolves.toEqual(
      []
    );
  });

  it('listAccountsTotal returns count and zero fallback', async () => {
    const withCount = createSelectDbMock([{ count: 9 }]);
    const withCountRepository = new AccountListerRepository(
      withCount.db as never
    );
    await expect(
      withCountRepository.listAccountsTotal({
        account_id: 'acc-1',
        name: 'Acc',
        plan: 'Starter',
        account_status: 'status-1',
      } as never)
    ).resolves.toBe(9);

    const withoutCount = createSelectDbMock([]);
    const withoutCountRepository = new AccountListerRepository(
      withoutCount.db as never
    );
    await expect(
      withoutCountRepository.listAccountsTotal({} as never)
    ).resolves.toBe(0);
  });
});
