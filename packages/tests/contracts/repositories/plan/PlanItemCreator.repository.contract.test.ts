import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { PlanItemCreatorRepository } from '@core/repositories/plan/PlanItemCreator.repository';
import { createInsertDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

describe('PlanItemCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('plan-item-1');
  });

  it('creates plan item and returns generated id', async () => {
    const { db, values } = createInsertDbMock({ rowCount: 1 });
    const repository = new PlanItemCreatorRepository(db as never);

    await expect(
      repository.createPlanItem({
        plan_id: 'plan-1',
        plan_product_id: 'prod-1',
        quantity: 2,
      } as never)
    ).resolves.toBe('plan-item-1');

    expect(values).toHaveBeenCalledWith({
      plan_item_id: 'plan-item-1',
      plan_id: 'plan-1',
      plan_product_id: 'prod-1',
      quantity: 2,
    });
  });

  it('returns null when insert result is null', async () => {
    const { db } = createInsertDbMock(null);
    const repository = new PlanItemCreatorRepository(db as never);

    await expect(
      repository.createPlanItem({
        plan_id: 'plan-1',
        plan_product_id: 'prod-1',
        quantity: 2,
      } as never)
    ).resolves.toBeNull();
  });
});
