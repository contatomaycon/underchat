import 'reflect-metadata';
import { EAccountFilterStatus } from '@core/common/enums/EAccountFilterStatus';
import { AccountAllListerWithDetailsRepository } from '@core/repositories/account/AccountAllListerWithDetails.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('AccountAllListerWithDetailsRepository', () => {
  it('maps listAccounts and aggregates unique statuses by account name on all filter', async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([
        {
          account_id: 'acc-1',
          name: 'Account Shared',
          created_at: '2026-04-21T11:00:00.000Z',
          aac: {
            account_status_id: 'status-active',
            name: 'Active',
          },
          apc: [
            {
              plan_account_id: 'plan-account-1',
              next_payment_date: futureDate,
              recurring_payment: true,
              cancellation_date: null,
              ppl: {
                plan_id: 'plan-1',
                name: 'Starter',
                is_test: false,
              },
              bpl: {
                billing_period_id: 'monthly',
                name: 'monthly',
              },
            },
          ],
        },
      ])
      .mockResolvedValueOnce([
        {
          name: 'Account Shared',
          aac: {
            account_status_id: 'status-active',
            name: 'Active',
          },
        },
        {
          name: 'Account Shared',
          aac: {
            account_status_id: 'status-blocked',
            name: 'Blocked',
          },
        },
      ]);
    const repository = new AccountAllListerWithDetailsRepository({
      query: {
        account: {
          findMany,
        },
      },
    } as never);

    await expect(
      repository.listAccounts(10, 1, {
        filter_status: EAccountFilterStatus.all,
      } as never)
    ).resolves.toEqual([
      {
        account_id: 'acc-1',
        name: 'Account Shared',
        account_status: {
          account_status_id: 'status-active',
          name: 'Active',
        },
        account_statuses: [
          {
            account_status_id: 'status-active',
            name: 'Active',
          },
          {
            account_status_id: 'status-blocked',
            name: 'Blocked',
          },
        ],
        plan: {
          plan_id: 'plan-1',
          name: 'Starter',
          recurring_payment: true,
          billing_period: 'monthly',
        },
        created_at: '2026-04-21T11:00:00.000Z',
      },
    ]);
  });

  it('handles deleted filter and nullish result', async () => {
    const repository = new AccountAllListerWithDetailsRepository({
      query: {
        account: {
          findMany: jest.fn(async () => undefined),
        },
      },
    } as never);

    await expect(
      repository.listAccounts(10, 1, {
        filter_status: EAccountFilterStatus.deleted,
      } as never)
    ).resolves.toEqual([]);
  });

  it('executes listAccountsTotal for all filter_status variants and returns zero fallback', async () => {
    const withCount = createSelectDbMock([{ count: 4 }]);
    const repositoryWithCount = new AccountAllListerWithDetailsRepository(
      withCount.db as never
    );
    const statuses = [
      EAccountFilterStatus.all,
      EAccountFilterStatus.subscribers,
      EAccountFilterStatus.cancelling,
      EAccountFilterStatus.cancelled,
      EAccountFilterStatus.blocked,
      EAccountFilterStatus.expired,
      EAccountFilterStatus.tests,
      EAccountFilterStatus.deleted,
    ];

    for (const filterStatus of statuses) {
      // Exercita todos os ramos de filtro por status.
      // eslint-disable-next-line no-await-in-loop
      await expect(
        repositoryWithCount.listAccountsTotal({
          filter_status: filterStatus,
          name: 'Account',
          plan: 'Starter',
        } as never)
      ).resolves.toBe(4);
    }

    const withoutCount = createSelectDbMock([]);
    const repositoryWithoutCount = new AccountAllListerWithDetailsRepository(
      withoutCount.db as never
    );
    await expect(
      repositoryWithoutCount.listAccountsTotal({
        filter_status: EAccountFilterStatus.all,
      } as never)
    ).resolves.toBe(0);
  });
});
