import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { PlanDeleterRepository } from '@core/repositories/plan/PlanDeleter.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('PlanDeleterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (currentTime as unknown as jest.Mock).mockReturnValue(
      '2026-04-22T00:05:00.000Z'
    );
  });

  it('returns true when soft delete affects one row', async () => {
    const tx = createUpdateDbMock({ rowCount: 1 }).db;
    const repository = new PlanDeleterRepository({} as never);

    await expect(
      repository.deletePlanById(tx as never, 'plan-1')
    ).resolves.toBe(true);
  });

  it('returns false when soft delete affects no rows', async () => {
    const tx = createUpdateDbMock({ rowCount: 0 }).db;
    const repository = new PlanDeleterRepository({} as never);

    await expect(
      repository.deletePlanById(tx as never, 'plan-1')
    ).resolves.toBe(false);
  });
});
