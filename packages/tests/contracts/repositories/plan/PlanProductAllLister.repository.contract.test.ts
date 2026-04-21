import 'reflect-metadata';
import { PlanProductAllListerRepository } from '@core/repositories/plan/PlanProductAllLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('PlanProductAllListerRepository', () => {
  it('returns empty list when no product rows found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new PlanProductAllListerRepository(db as never);

    await expect(repository.listPlanProductAll()).resolves.toEqual([]);
  });

  it('maps rows and normalizes nullable fields', async () => {
    const { db } = createSelectDbMock([
      {
        plan_product_id: 'prod-1',
        name: 'Users',
        description: 'Extra users',
      },
      {
        plan_product_id: 'prod-2',
        name: null,
        description: null,
      },
    ]);
    const repository = new PlanProductAllListerRepository(db as never);

    await expect(repository.listPlanProductAll()).resolves.toEqual([
      {
        plan_product_id: 'prod-1',
        name: 'Users',
        description: 'Extra users',
      },
      {
        plan_product_id: 'prod-2',
        name: null,
        description: null,
      },
    ]);
  });
});
