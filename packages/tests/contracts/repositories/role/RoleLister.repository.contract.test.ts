import 'reflect-metadata';
import { RoleListerRepository } from '@core/repositories/role/RoleLister.repository';

function createDbRoWithExecuteQueue(queue: unknown[]) {
  const execute = jest.fn();
  for (const item of queue) {
    execute.mockResolvedValueOnce(item);
  }

  const chain = {} as {
    from: jest.Mock;
    leftJoin: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    limit: jest.Mock;
    offset: jest.Mock;
    execute: jest.Mock;
  };

  chain.from = jest.fn(() => chain);
  chain.leftJoin = jest.fn(() => chain);
  chain.where = jest.fn(() => chain);
  chain.orderBy = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.offset = jest.fn(() => chain);
  chain.execute = execute;

  return {
    dbRo: {
      select: jest.fn(() => chain),
    },
  };
}

describe('RoleListerRepository', () => {
  it('returns empty list when roles are not found', async () => {
    const { dbRo } = createDbRoWithExecuteQueue([[]]);
    const repository = new RoleListerRepository(dbRo as never);

    await expect(
      repository.listRoles(10, 1, {} as never, 'acc-1')
    ).resolves.toEqual([]);
  });

  it('returns mapped role list', async () => {
    const rows = [
      {
        permission_role_id: 'role-1',
        name: 'Admin',
        description: 'desc',
        account: { id: 'acc-1', name: 'Conta' },
        created_at: '2026-04-21T00:00:00.000Z',
      },
    ];
    const { dbRo } = createDbRoWithExecuteQueue([rows]);
    const repository = new RoleListerRepository(dbRo as never);

    await expect(
      repository.listRoles(
        10,
        1,
        {
          role_name: 'Adm',
          account: 'Con',
          sort_by: [{ key: 'name', order: 'asc' }],
        } as never,
        'acc-1'
      )
    ).resolves.toEqual(rows);
  });

  it('returns total count and zero fallback', async () => {
    const withCount = createDbRoWithExecuteQueue([[{ count: 2 }]]);
    const repositoryWithCount = new RoleListerRepository(
      withCount.dbRo as never
    );

    await expect(
      repositoryWithCount.listRolesTotal({} as never, 'acc-1')
    ).resolves.toBe(2);

    const withoutCount = createDbRoWithExecuteQueue([[]]);
    const repositoryWithoutCount = new RoleListerRepository(
      withoutCount.dbRo as never
    );

    await expect(
      repositoryWithoutCount.listRolesTotal({} as never, 'acc-1')
    ).resolves.toBe(0);
  });
});
