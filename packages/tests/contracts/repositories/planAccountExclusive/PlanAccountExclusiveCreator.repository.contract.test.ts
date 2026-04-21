import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { PlanAccountExclusiveCreatorRepository } from '@core/repositories/planAccountExclusive/PlanAccountExclusiveCreator.repository';
import { createInsertDbMock } from '@core/tests/helpers/drizzleMock';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

describe('PlanAccountExclusiveCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue(
      'plan-account-exclusive-id'
    );
  });

  it('creates plan account exclusive and returns id', async () => {
    const { db, values } = createInsertDbMock({ rowCount: 1 });
    const repository = new PlanAccountExclusiveCreatorRepository(db as never);

    await expect(
      repository.createPlanAccountExclusive({
        plan_id: 'plan-1',
        account_id: 'acc-1',
      } as never)
    ).resolves.toBe('plan-account-exclusive-id');

    expect(values).toHaveBeenCalledWith({
      plan_account_exclusive_id: 'plan-account-exclusive-id',
      plan_id: 'plan-1',
      account_id: 'acc-1',
    });
  });

  it('returns null when insert result is null', async () => {
    const { db } = createInsertDbMock(null);
    const repository = new PlanAccountExclusiveCreatorRepository(db as never);

    await expect(
      repository.createPlanAccountExclusive({
        plan_id: 'plan-1',
        account_id: 'acc-1',
      } as never)
    ).resolves.toBeNull();
  });
});
