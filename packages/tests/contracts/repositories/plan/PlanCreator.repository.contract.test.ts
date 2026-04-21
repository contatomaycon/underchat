import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { EPlanStatus } from '@core/common/enums/EPlanStatus';
import { PlanCreatorRepository } from '@core/repositories/plan/PlanCreator.repository';
import { createInsertDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

describe('PlanCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('plan-1');
  });

  it('creates plan with defaults and returns generated id', async () => {
    const { db, values } = createInsertDbMock({ rowCount: 1 });
    const repository = new PlanCreatorRepository(db as never);

    await expect(
      repository.createPlan({
        name: 'Starter',
        price: 19.9,
        price_old: 29.9,
      } as never)
    ).resolves.toBe('plan-1');

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        plan_id: 'plan-1',
        price: '19.9',
        price_old: '29.9',
        description: null,
        annual_discount: null,
        icon: null,
        is_test: false,
        days_trial: null,
        is_exclusive: false,
        status: EPlanStatus.active,
      })
    );
  });

  it('returns null when insert result is null', async () => {
    const { db } = createInsertDbMock(null);
    const repository = new PlanCreatorRepository(db as never);

    await expect(
      repository.createPlan({
        name: 'Starter',
        price: 19.9,
        price_old: 29.9,
        status: EPlanStatus.inactive,
      } as never)
    ).resolves.toBeNull();
  });
});
