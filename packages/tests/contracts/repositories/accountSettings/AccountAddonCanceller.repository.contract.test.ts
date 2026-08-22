import 'reflect-metadata';
import { AccountAddonCancellerRepository } from '@core/repositories/accountSettings/AccountAddonCanceller.repository';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import {
  createSelectDbMock,
  createUpdateDbMock,
} from '@core/tests/helpers/drizzleMock';

describe('AccountAddonCancellerRepository', () => {
  function createTransactionalCancellationDb(
    currentPlans: Array<{ active: boolean }>,
    rowCount: number
  ) {
    const selectMock = createSelectDbMock(currentPlans);
    const updateMock = createUpdateDbMock({ rowCount });
    const transaction = jest.fn(async (callback) =>
      callback({
        select: selectMock.db.select,
        update: updateMock.db.update,
      })
    );

    return {
      db: { transaction },
      selectMock,
      updateMock,
    };
  }

  it('findAddonById returns addon when found', async () => {
    const repository = new AccountAddonCancellerRepository(
      {
        query: {
          planCrossSellAccount: {
            findFirst: jest.fn(async () => ({
              plan_cross_sell_account_id: 'addon-1',
              cancellation_date: null,
              pca: {
                plan_product_id: EPlanProduct.integration,
              },
            })),
          },
        },
      } as never,
      {} as never
    );

    await expect(repository.findAddonById('acc-1', 'addon-1')).resolves.toEqual(
      {
        plan_cross_sell_account_id: 'addon-1',
        cancellation_date: null,
        plan_product_id: EPlanProduct.integration,
      }
    );
  });

  it('findAddonById returns null when addon is not found', async () => {
    const repository = new AccountAddonCancellerRepository(
      {
        query: {
          planCrossSellAccount: {
            findFirst: jest.fn(async () => null),
          },
        },
      } as never,
      {} as never
    );

    await expect(
      repository.findAddonById('acc-1', 'addon-1')
    ).resolves.toBeNull();
  });

  it('hasActivePlanCycle returns true/false according to rows', async () => {
    const withRows = createSelectDbMock([{ active: true }]);
    const repositoryWithRows = new AccountAddonCancellerRepository(
      withRows.db as never,
      {} as never
    );
    await expect(repositoryWithRows.hasActivePlanCycle('acc-1')).resolves.toBe(
      true
    );

    const withoutRows = createSelectDbMock([]);
    const repositoryWithoutRows = new AccountAddonCancellerRepository(
      withoutRows.db as never,
      {} as never
    );
    await expect(
      repositoryWithoutRows.hasActivePlanCycle('acc-1')
    ).resolves.toBe(false);
  });

  it('scheduleAddonCancellation returns true when update affects rows', async () => {
    const dbMock = createTransactionalCancellationDb([{ active: true }], 1);
    const repository = new AccountAddonCancellerRepository(
      dbMock.db as never,
      {} as never
    );

    await expect(
      repository.scheduleAddonCancellation({
        accountId: 'acc-1',
        planCrossSellAccountId: 'addon-1',
        cancellationDate: '2026-04-21T19:00:00.000Z',
      })
    ).resolves.toBe(true);
    expect(dbMock.updateMock.set).toHaveBeenCalledWith({
      cancellation_date: '2026-04-21T19:00:00.000Z',
      updated_at: '2026-04-21T19:00:00.000Z',
    });
    expect(dbMock.selectMock.for).toHaveBeenCalledWith('update');
  });

  it('scheduleAddonCancellation returns false when update affects no rows', async () => {
    const dbMock = createTransactionalCancellationDb([{ active: true }], 0);
    const repository = new AccountAddonCancellerRepository(
      dbMock.db as never,
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

  it('does not schedule cancellation against an expired current cycle', async () => {
    const dbMock = createTransactionalCancellationDb([{ active: false }], 1);
    const repository = new AccountAddonCancellerRepository(
      dbMock.db as never,
      {} as never
    );

    await expect(
      repository.scheduleAddonCancellation({
        accountId: 'acc-1',
        planCrossSellAccountId: 'addon-1',
        cancellationDate: '2026-04-21T19:10:00.000Z',
      })
    ).resolves.toBe(false);
    expect(dbMock.updateMock.db.update).not.toHaveBeenCalled();
  });
});
