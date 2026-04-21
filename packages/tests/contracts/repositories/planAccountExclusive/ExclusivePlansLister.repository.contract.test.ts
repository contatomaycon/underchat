import 'reflect-metadata';
import { ExclusivePlansListerRepository } from '@core/repositories/planAccountExclusive/ExclusivePlansLister.repository';

function createDbRoWithExecuteQueue(queue: unknown[]) {
  const execute = jest.fn();
  for (const item of queue) {
    execute.mockResolvedValueOnce(item);
  }

  const chain = {} as {
    from: jest.Mock;
    where: jest.Mock;
    execute: jest.Mock;
  };

  chain.from = jest.fn(() => chain);
  chain.where = jest.fn(() => chain);
  chain.execute = execute;

  return {
    dbRo: {
      select: jest.fn(() => chain),
    },
  };
}

describe('ExclusivePlansListerRepository', () => {
  it('returns empty list when no exclusive plans are available', async () => {
    const { dbRo } = createDbRoWithExecuteQueue([[], []]);
    const repository = new ExclusivePlansListerRepository(dbRo as never);

    await expect(repository.listExclusivePlans('acc-1')).resolves.toEqual([]);
  });

  it('returns exclusive plans excluding already assigned ones', async () => {
    const existing = [{ plan_id: 'plan-1' }];
    const available = [
      {
        plan_id: 'plan-2',
        name: 'Plano Exclusivo',
        is_exclusive: true,
        status: 'active',
      },
    ];

    const { dbRo } = createDbRoWithExecuteQueue([existing, available]);
    const repository = new ExclusivePlansListerRepository(dbRo as never);

    await expect(repository.listExclusivePlans('acc-1')).resolves.toEqual([
      {
        plan_id: 'plan-2',
        name: 'Plano Exclusivo',
        is_exclusive: true,
        status: 'active',
      },
    ]);
  });
});
