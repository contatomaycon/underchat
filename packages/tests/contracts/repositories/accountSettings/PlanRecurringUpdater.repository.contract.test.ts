import 'reflect-metadata';
import { PlanRecurringUpdaterRepository } from '@core/repositories/accountSettings/PlanRecurringUpdater.repository';
import {
  createSelectDbMock,
  createUpdateDbMock,
} from '@core/tests/helpers/drizzleMock';

function createRepository(
  currentPlans: Array<{
    plan_account_id: string;
    cancellation_date: string | null;
  }>,
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
    repository: new PlanRecurringUpdaterRepository({ transaction } as never),
    selectMock,
    updateMock,
  };
}

describe('PlanRecurringUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true when the deterministic current plan is updated', async () => {
    const { repository, selectMock, updateMock } = createRepository(
      [{ plan_account_id: 'plan-current', cancellation_date: null }],
      1
    );
    await expect(repository.updatePlanRecurring('acc-1', true)).resolves.toBe(
      true
    );
    expect(updateMock.set).toHaveBeenCalledWith({
      recurring_payment: true,
    });
    expect(selectMock.orderBy).toHaveBeenCalledTimes(1);
    expect(selectMock.for).toHaveBeenCalledWith('update');
  });

  it('returns false when the current plan update affects no rows', async () => {
    const { repository } = createRepository(
      [{ plan_account_id: 'plan-current', cancellation_date: null }],
      0
    );
    await expect(repository.updatePlanRecurring('acc-1', false)).resolves.toBe(
      false
    );
  });

  it('does not fall back to a historical plan when the current plan is cancelled', async () => {
    const { repository, updateMock } = createRepository(
      [
        {
          plan_account_id: 'plan-current',
          cancellation_date: '2026-04-21T18:00:00.000Z',
        },
      ],
      1
    );

    await expect(repository.updatePlanRecurring('acc-1', true)).resolves.toBe(
      false
    );
    expect(updateMock.db.update).not.toHaveBeenCalled();
  });
});
