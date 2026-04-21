import 'reflect-metadata';
import { PlanAccountExclusiveListerRepository } from '@core/repositories/planAccountExclusive/PlanAccountExclusiveLister.repository';

function createSelectChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const leftJoin = jest.fn(() => ({ where }));
  const from = jest.fn(() => ({ leftJoin }));
  const select = jest.fn(() => ({ from }));

  return {
    dbRo: { select },
  };
}

describe('PlanAccountExclusiveListerRepository', () => {
  it('returns empty list when no exclusives exist for account', async () => {
    const { dbRo } = createSelectChain([]);
    const repository = new PlanAccountExclusiveListerRepository(dbRo as never);

    await expect(
      repository.listPlanAccountExclusives('acc-1')
    ).resolves.toEqual([]);
  });

  it('maps exclusives including nullable plan relation', async () => {
    const rows = [
      {
        plan_account_exclusive_id: 'pae-1',
        plan_id: 'plan-1',
        account_id: 'acc-1',
        created_at: '2026-04-21T00:00:00.000Z',
        plan: {
          plan_id: 'plan-1',
          name: 'Plano 1',
          is_exclusive: true,
        },
      },
      {
        plan_account_exclusive_id: 'pae-2',
        plan_id: 'plan-2',
        account_id: 'acc-1',
        created_at: '2026-04-21T00:00:00.000Z',
        plan: null,
      },
    ];

    const { dbRo } = createSelectChain(rows);
    const repository = new PlanAccountExclusiveListerRepository(dbRo as never);

    await expect(
      repository.listPlanAccountExclusives('acc-1')
    ).resolves.toEqual([
      {
        plan_account_exclusive_id: 'pae-1',
        plan_id: 'plan-1',
        account_id: 'acc-1',
        created_at: '2026-04-21T00:00:00.000Z',
        plan: {
          plan_id: 'plan-1',
          name: 'Plano 1',
          is_exclusive: true,
        },
      },
      {
        plan_account_exclusive_id: 'pae-2',
        plan_id: 'plan-2',
        account_id: 'acc-1',
        created_at: '2026-04-21T00:00:00.000Z',
        plan: null,
      },
    ]);
  });
});
