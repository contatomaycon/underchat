import 'reflect-metadata';
import { EPlanStatus } from '@core/common/enums/EPlanStatus';
import { PlanUpdaterRepository } from '@core/repositories/plan/PlanUpdater.repository';
import { createUpdateDbMock } from '@core/tests/helpers/drizzleMock';

describe('PlanUpdaterRepository', () => {
  it('updates only provided fields and stringifies numbers', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new PlanUpdaterRepository(db as never);

    await expect(
      repository.updatePlan('plan-1', {
        name: 'Pro',
        price: 49.9,
        annual_discount: 10,
        is_test: null,
        is_exclusive: null,
        status: EPlanStatus.active,
      } as never)
    ).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith({
      name: 'Pro',
      price: '49.9',
      annual_discount: '10',
      is_test: false,
      is_exclusive: false,
      status: EPlanStatus.active,
    });
  });

  it('keeps nullable/optional values when explicitly provided', async () => {
    const { db, set } = createUpdateDbMock({ rowCount: 1 });
    const repository = new PlanUpdaterRepository(db as never);

    await repository.updatePlan('plan-1', {
      description: null,
      icon: null,
      days_trial: null,
      annual_discount: null,
    } as never);

    expect(set).toHaveBeenCalledWith({
      description: null,
      icon: null,
      days_trial: null,
      annual_discount: null,
    });
  });

  it('returns false when update affects no rows', async () => {
    const { db } = createUpdateDbMock({ rowCount: 0 });
    const repository = new PlanUpdaterRepository(db as never);

    await expect(repository.updatePlan('plan-1', {} as never)).resolves.toBe(
      false
    );
  });
});
