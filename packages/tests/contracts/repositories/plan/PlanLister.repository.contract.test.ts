import 'reflect-metadata';
import { PlanListerRepository } from '@core/repositories/plan/PlanLister.repository';
import { createSelectDbMock } from '@core/tests/helpers/drizzleMock';

describe('PlanListerRepository', () => {
  it('setFiltersPlan returns empty array when no filters provided', () => {
    const repository = new PlanListerRepository({} as never);

    const result = (repository as any).setFiltersPlan({});

    expect(result).toEqual([]);
  });

  it('setFiltersPlan includes combined name/price filter and plan_id filter', () => {
    const repository = new PlanListerRepository({} as never);

    const result = (repository as any).setFiltersPlan({
      name: 'Starter',
      price: '19',
      plan_id: 'plan-1',
    });

    expect(result).toHaveLength(2);
  });

  it('listPlans returns empty list when no rows found', async () => {
    const { db } = createSelectDbMock([]);
    const repository = new PlanListerRepository(db as never);

    await expect(repository.listPlans(10, 1, {})).resolves.toEqual([]);
  });

  it('listPlans maps numeric string prices and nullable fields', async () => {
    const { db } = createSelectDbMock([
      {
        plan_id: 'plan-1',
        name: 'Starter',
        price: '19.9',
        price_old: '29.9',
        description: null,
        annual_discount: null,
        icon: null,
        is_test: false,
        days_trial: null,
        is_exclusive: false,
        status: 'active',
        created_at: '2026-04-21T10:00:00.000Z',
      },
    ]);
    const repository = new PlanListerRepository(db as never);

    await expect(repository.listPlans(10, 1, {})).resolves.toEqual([
      {
        plan_id: 'plan-1',
        name: 'Starter',
        price: 19.9,
        price_old: 29.9,
        description: null,
        annual_discount: null,
        icon: null,
        is_test: false,
        days_trial: null,
        is_exclusive: false,
        status: 'active',
        created_at: '2026-04-21T10:00:00.000Z',
      },
    ]);
  });

  it('listPlansTotal returns count and zero fallback', async () => {
    const withCount = createSelectDbMock([{ count: 4 }]);
    const withoutRows = createSelectDbMock([]);

    const withCountRepository = new PlanListerRepository(withCount.db as never);
    const withoutRowsRepository = new PlanListerRepository(
      withoutRows.db as never
    );

    await expect(withCountRepository.listPlansTotal({})).resolves.toBe(4);
    await expect(withoutRowsRepository.listPlansTotal({})).resolves.toBe(0);
  });
});
