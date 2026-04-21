import 'reflect-metadata';
import { AccountAddonCancellerRepository } from '@core/repositories/accountSettings/AccountAddonCanceller.repository';
import {
  createSelectDbMock,
  createUpdateDbMock,
} from '@core/tests/helpers/drizzleMock';

describe('AccountAddonCancellerRepository', () => {
  it('findAddonById returns addon when found', async () => {
    const repository = new AccountAddonCancellerRepository(
      {} as never,
      {
        query: {
          planCrossSellAccount: {
            findFirst: jest.fn(async () => ({
              plan_cross_sell_account_id: 'addon-1',
              cancellation_date: null,
            })),
          },
        },
      } as never
    );

    await expect(repository.findAddonById('acc-1', 'addon-1')).resolves.toEqual(
      {
        plan_cross_sell_account_id: 'addon-1',
        cancellation_date: null,
      }
    );
  });

  it('findAddonById returns null when addon is not found', async () => {
    const repository = new AccountAddonCancellerRepository(
      {} as never,
      {
        query: {
          planCrossSellAccount: {
            findFirst: jest.fn(async () => null),
          },
        },
      } as never
    );

    await expect(
      repository.findAddonById('acc-1', 'addon-1')
    ).resolves.toBeNull();
  });

  it('hasActivePlanCycle returns true/false according to rows', async () => {
    const withRows = createSelectDbMock([{ plan_account_id: 'plan-1' }]);
    const repositoryWithRows = new AccountAddonCancellerRepository(
      {} as never,
      withRows.db as never
    );
    await expect(repositoryWithRows.hasActivePlanCycle('acc-1')).resolves.toBe(
      true
    );

    const withoutRows = createSelectDbMock([]);
    const repositoryWithoutRows = new AccountAddonCancellerRepository(
      {} as never,
      withoutRows.db as never
    );
    await expect(
      repositoryWithoutRows.hasActivePlanCycle('acc-1')
    ).resolves.toBe(false);
  });

  it('scheduleAddonCancellation returns true when update affects rows', async () => {
    const updateMock = createUpdateDbMock({ rowCount: 1 });
    const repository = new AccountAddonCancellerRepository(
      updateMock.db as never,
      {} as never
    );

    await expect(
      repository.scheduleAddonCancellation({
        accountId: 'acc-1',
        planCrossSellAccountId: 'addon-1',
        cancellationDate: '2026-04-21T19:00:00.000Z',
      })
    ).resolves.toBe(true);
    expect(updateMock.set).toHaveBeenCalledWith({
      cancellation_date: '2026-04-21T19:00:00.000Z',
      updated_at: '2026-04-21T19:00:00.000Z',
    });
  });

  it('scheduleAddonCancellation returns false when update affects no rows', async () => {
    const updateMock = createUpdateDbMock({ rowCount: 0 });
    const repository = new AccountAddonCancellerRepository(
      updateMock.db as never,
      {} as never
    );

    await expect(
      repository.scheduleAddonCancellation({
        accountId: 'acc-1',
        planCrossSellAccountId: 'addon-1',
        cancellationDate: '2026-04-21T19:10:00.000Z',
      })
    ).resolves.toBe(false);
  });
});
