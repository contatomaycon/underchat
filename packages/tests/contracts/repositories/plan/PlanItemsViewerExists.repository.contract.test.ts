import 'reflect-metadata';
import { PlanItemsViewerExistsRepository } from '@core/repositories/plan/PlanItemsViewerExists.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('PlanItemsViewerExistsRepository', () => {
  it('returns false when count query has no rows', async () => {
    const tx = createSelectDbMock([]).db;
    const repository = new PlanItemsViewerExistsRepository({} as never);

    await expect(
      repository.existsPlanItemsByPlanId(tx as never, 'plan-1')
    ).resolves.toBe(false);
  });

  it('returns false when total is zero', async () => {
    const tx = createSelectDbMock([{ total: 0 }]).db;
    const repository = new PlanItemsViewerExistsRepository({} as never);

    await expect(
      repository.existsPlanItemsByPlanId(tx as never, 'plan-1')
    ).resolves.toBe(false);
  });

  it('returns true when total is greater than zero', async () => {
    const tx = createSelectDbMock([{ total: 3 }]).db;
    const repository = new PlanItemsViewerExistsRepository({} as never);

    await expect(
      repository.existsPlanItemsByPlanId(tx as never, 'plan-1')
    ).resolves.toBe(true);
  });
});
