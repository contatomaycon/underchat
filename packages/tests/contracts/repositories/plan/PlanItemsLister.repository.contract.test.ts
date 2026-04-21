import 'reflect-metadata';
import { PlanItemsListerRepository } from '@core/repositories/plan/PlanItemsLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('PlanItemsListerRepository', () => {
  it('returns empty list when no rows found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new PlanItemsListerRepository(db as never);

    await expect(repository.listPlanItems('plan-1')).resolves.toEqual([]);
  });

  it('maps rows and keeps plan_product undefined when relation is missing', async () => {
    const { db } = createSelectDbMock([
      {
        plan_item_id: 'pi-1',
        plan_id: 'plan-1',
        plan_product_id: 'prod-1',
        quantity: 2,
        created_at: '2026-04-21T10:00:00.000Z',
        plan_product: {
          plan_product_id: 'prod-1',
          name: 'Agents',
          description: 'Extra agents',
        },
      },
      {
        plan_item_id: 'pi-2',
        plan_id: 'plan-1',
        plan_product_id: 'prod-2',
        quantity: 1,
        created_at: '2026-04-21T10:10:00.000Z',
        plan_product: {
          plan_product_id: '',
          name: null,
          description: null,
        },
      },
    ]);
    const repository = new PlanItemsListerRepository(db as never);

    await expect(repository.listPlanItems('plan-1')).resolves.toEqual([
      {
        plan_item_id: 'pi-1',
        plan_id: 'plan-1',
        plan_product_id: 'prod-1',
        quantity: 2,
        created_at: '2026-04-21T10:00:00.000Z',
        plan_product: {
          plan_product_id: 'prod-1',
          name: 'Agents',
          description: 'Extra agents',
        },
      },
      {
        plan_item_id: 'pi-2',
        plan_id: 'plan-1',
        plan_product_id: 'prod-2',
        quantity: 1,
        created_at: '2026-04-21T10:10:00.000Z',
        plan_product: undefined,
      },
    ]);
  });
});
