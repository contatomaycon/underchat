import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { PlanItemDeleterRepository } from '@core/repositories/plan/PlanItemDeleter.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('PlanItemDeleterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (currentTime as unknown as jest.Mock).mockReturnValue(
      '2026-04-22T00:00:00.000Z'
    );
  });

  it('returns true when update affects one row', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new PlanItemDeleterRepository(db as never);

    await expect(repository.deletePlanItemById('pi-1')).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith({
      deleted_at: '2026-04-22T00:00:00.000Z',
    });
  });

  it('returns false when update affects no rows', async () => {
    const { db } = createUpdateDbMock({ rowCount: 0 });
    const repository = new PlanItemDeleterRepository(db as never);

    await expect(repository.deletePlanItemById('pi-1')).resolves.toBe(false);
  });
});
