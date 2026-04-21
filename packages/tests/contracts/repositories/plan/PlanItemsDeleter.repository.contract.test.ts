import 'reflect-metadata';
import { currentTime } from '@core/common/functions/currentTime';
import { PlanItemsDeleterRepository } from '@core/repositories/plan/PlanItemsDeleter.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('PlanItemsDeleterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (currentTime as unknown as jest.Mock).mockReturnValue(
      '2026-04-22T00:10:00.000Z'
    );
  });

  it('returns true when rowCount is positive', async () => {
    const tx = createUpdateDbMock({ rowCount: 2 }).db;
    const repository = new PlanItemsDeleterRepository({} as never);

    await expect(
      repository.deletePlanItemsByPlanId(tx as never, 'plan-1')
    ).resolves.toBe(true);
  });

  it('returns true when rowCount is zero', async () => {
    const tx = createUpdateDbMock({ rowCount: 0 }).db;
    const repository = new PlanItemsDeleterRepository({} as never);

    await expect(
      repository.deletePlanItemsByPlanId(tx as never, 'plan-1')
    ).resolves.toBe(true);
  });

  it('returns true when rowCount is undefined', async () => {
    const tx = createUpdateDbMock({}).db;
    const repository = new PlanItemsDeleterRepository({} as never);

    await expect(
      repository.deletePlanItemsByPlanId(tx as never, 'plan-1')
    ).resolves.toBe(true);
  });
});
