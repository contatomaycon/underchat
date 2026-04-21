import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { PlanRecurringUpdaterRepository } from '@core/repositories/accountSettings/PlanRecurringUpdater.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('PlanRecurringUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true when recurring update affects rows', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new PlanRecurringUpdaterRepository(db as never);
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T18:00:00.000Z');

    await expect(repository.updatePlanRecurring('acc-1', true)).resolves.toBe(
      true
    );
    expect(set).toHaveBeenCalledWith({
      recurring_payment: true,
      updated_at: '2026-04-21T18:00:00.000Z',
    });
  });

  it('returns false when recurring update affects no rows', async () => {
    const { db } = createUpdateDbMock({ rowCount: 0 });
    const repository = new PlanRecurringUpdaterRepository(db as never);
    const currentTimeMock = currentTime as unknown as jest.Mock;
    currentTimeMock.mockReturnValue('2026-04-21T18:10:00.000Z');

    await expect(repository.updatePlanRecurring('acc-1', false)).resolves.toBe(
      false
    );
  });
});
