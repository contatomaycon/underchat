import 'reflect-metadata';
import { PlanAllListerRepository } from '@core/repositories/plan/PlanAllLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('PlanAllListerRepository', () => {
  it('returns empty list when no rows found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new PlanAllListerRepository(db as never);

    await expect(repository.listPlanAll()).resolves.toEqual([]);
  });

  it('maps rows and normalizes nullable days_trial', async () => {
    const { db } = createSelectDbMock([
      {
        plan_id: 'plan-1',
        name: 'Starter',
        is_test: false,
        days_trial: 7,
      },
      {
        plan_id: 'plan-2',
        name: 'Pro',
        is_test: true,
        days_trial: null,
      },
    ]);
    const repository = new PlanAllListerRepository(db as never);

    await expect(repository.listPlanAll()).resolves.toEqual([
      {
        plan_id: 'plan-1',
        name: 'Starter',
        is_test: false,
        days_trial: 7,
      },
      {
        plan_id: 'plan-2',
        name: 'Pro',
        is_test: true,
        days_trial: null,
      },
    ]);
  });
});
