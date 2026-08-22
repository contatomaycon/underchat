import 'reflect-metadata';
import { WorkerServerListerRepository } from '@core/repositories/worker/WorkerServerLister.repository';
import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

function collectSqlParts(value: unknown): string[] {
  if (!value) {
    return [];
  }

  if (typeof value !== 'object') {
    return [String(value)];
  }

  const record = value as {
    queryChunks?: unknown[];
    value?: unknown;
    name?: unknown;
    columnType?: unknown;
  };

  if (Array.isArray(record.queryChunks)) {
    return record.queryChunks.flatMap((chunk) => collectSqlParts(chunk));
  }

  if (Array.isArray(record.value)) {
    return record.value.map(String);
  }

  if ('value' in record && typeof record.value !== 'object') {
    return [String(record.value)];
  }

  if (
    typeof record.name === 'string' &&
    typeof record.columnType === 'string'
  ) {
    return [record.name];
  }

  return [];
}

function createDbMockWithChain(result: unknown[]) {
  const chain: {
    innerJoin: jest.Mock;
    leftJoin: jest.Mock;
    where: jest.Mock;
    groupBy: jest.Mock;
    having: jest.Mock;
    orderBy: jest.Mock;
    execute: jest.Mock;
  } = {
    innerJoin: jest.fn(),
    leftJoin: jest.fn(),
    where: jest.fn(),
    groupBy: jest.fn(),
    having: jest.fn(),
    orderBy: jest.fn(),
    execute: jest.fn(async () => result),
  };

  chain.innerJoin.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.groupBy.mockReturnValue(chain);
  chain.having.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);

  return {
    db: {
      select: jest.fn(() => ({
        from: jest.fn(() => chain),
      })),
      selectDistinctOn: jest.fn(() => ({
        from: jest.fn(() => chain),
      })),
    },
    chain,
  };
}

function createDbMock(result: unknown[]) {
  return createDbMockWithChain(result).db;
}

describe('WorkerServerListerRepository', () => {
  it('returns empty list when there are no available servers', async () => {
    const repository = new WorkerServerListerRepository(
      createDbMock([]) as never
    );

    await expect(repository.listWorkerServers()).resolves.toEqual([]);
  });

  it('returns available worker servers list', async () => {
    const rows = [
      { server_id: 'server-1', name: 'Server 1' },
      { server_id: 'server-2', name: 'Server 2' },
    ];
    const repository = new WorkerServerListerRepository(
      createDbMock(rows) as never
    );

    await expect(repository.listWorkerServers()).resolves.toEqual(rows);
  });

  it('orders automatic allocation by load with a stable server id tie-breaker', async () => {
    const { db, chain } = createDbMockWithChain([]);
    const repository = new WorkerServerListerRepository(db as never);

    await repository.listWorkerServers();

    expect(chain.orderBy).toHaveBeenCalledTimes(1);
    expect(chain.orderBy.mock.calls[0]).toHaveLength(2);

    const tieBreaker = chain.orderBy.mock.calls[0][1] as SQL;
    const compiledTieBreaker = new PgDialect().sqlToQuery(tieBreaker);
    expect(compiledTieBreaker.sql).toContain('"server"."server_id" asc');
  });

  it('excludes a server when its web endpoint was soft-deleted', async () => {
    const { db, chain } = createDbMockWithChain([]);
    const repository = new WorkerServerListerRepository(db as never);

    await repository.listWorkerServers();

    const condition = chain.where.mock.calls[0][0] as SQL;
    const compiled = new PgDialect().sqlToQuery(condition);
    expect(compiled.sql).toContain('"server"."deleted_at" is null');
    expect(compiled.sql).toContain('FROM "server_web" AS active_web');
    expect(compiled.sql).toContain('active_web."deleted_at" IS NULL');
  });

  it('requires active web metadata for warm-pool eligibility', async () => {
    const { db, chain } = createDbMockWithChain([]);
    const repository = new WorkerServerListerRepository(db as never);

    await repository.listWarmPoolEligibleServers();

    const condition = chain.where.mock.calls[0][0] as SQL;
    const compiled = new PgDialect().sqlToQuery(condition);
    expect(compiled.sql).toContain('"server"."deleted_at" is null');
    expect(compiled.sql).toContain('FROM "server_web" AS active_web');
    expect(compiled.sql).toContain('active_web."deleted_at" IS NULL');
  });

  it('requires active web and SSH metadata for warm-pool reconciliation', async () => {
    const { db, chain } = createDbMockWithChain([]);
    const repository = new WorkerServerListerRepository(db as never);

    await repository.listWarmPoolEligibleBalanceServers();

    const whereSqlParts = collectSqlParts(chain.where.mock.calls[0][0]);
    expect(whereSqlParts.filter((part) => part === 'deleted_at')).toHaveLength(
      3
    );
    expect(db.selectDistinctOn).toHaveBeenCalled();
    expect(chain.orderBy).toHaveBeenCalled();
  });

  it('keeps offline Balance servers in the physical reconciliation inventory', async () => {
    const { db, chain } = createDbMockWithChain([]);
    const repository = new WorkerServerListerRepository(db as never);

    await repository.listWarmPoolReconcileBalanceServers();

    const condition = chain.where.mock.calls[0][0] as SQL;
    const compiled = new PgDialect().sqlToQuery(condition);
    expect(compiled.sql).toContain('"server"."deleted_at" is null');
    expect(compiled.sql).toContain('"server_ssh"."deleted_at" is null');
    expect(compiled.sql).toContain('"server_web"."deleted_at" is null');
    expect(compiled.sql).not.toContain('server_status_id');
  });
});
