import 'reflect-metadata';
import { WorkerWarmPoolRepository } from '@core/repositories/worker/WorkerWarmPool.repository';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerWarmPoolState } from '@core/common/enums/EWorkerWarmPoolState';

function createListChain(result: unknown[]) {
  const queryBuilder = {
    innerJoin: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    offset: jest.fn(),
    execute: jest.fn(async () => result),
  } as any;
  queryBuilder.innerJoin.mockReturnValue(queryBuilder);
  queryBuilder.where.mockReturnValue(queryBuilder);
  queryBuilder.orderBy.mockReturnValue(queryBuilder);
  queryBuilder.limit.mockReturnValue(queryBuilder);
  queryBuilder.offset.mockReturnValue(queryBuilder);

  const from = jest.fn(() => queryBuilder);
  const select = jest.fn(() => ({ from }));

  return { queryBuilder, select };
}

function createExecuteChain(result: unknown[]) {
  const queryBuilder = {
    innerJoin: jest.fn(),
    where: jest.fn(),
    execute: jest.fn(async () => result),
  } as any;
  queryBuilder.innerJoin.mockReturnValue(queryBuilder);
  queryBuilder.where.mockReturnValue(queryBuilder);

  const from = jest.fn(() => queryBuilder);
  const select = jest.fn(() => ({ from }));

  return { queryBuilder, select };
}

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

describe('WorkerWarmPoolRepository warm channels', () => {
  it('maps ready warm channel list results with pagination', async () => {
    const chain = createListChain([
      {
        warm_pool_id: 'warm-1',
        server: { id: 'srv-1', name: 'Server 1' },
        type: { id: EWorkerType.baileys, name: 'Baileys' },
        state: EWorkerWarmPoolState.ready,
        container_id: 'container-1',
        container_name: 'warm-container-1',
        session_volume_name: 'volume-1',
        last_health_at: '2026-06-01T12:00:00.000Z',
        last_error: null,
        created_at: '2026-06-01T10:00:00.000Z',
        updated_at: '2026-06-01T12:00:00.000Z',
      },
    ]);
    const repository = new WorkerWarmPoolRepository(
      {} as never,
      { select: chain.select } as never
    );

    await expect(
      repository.listReadyWarmChannels(25, 3, {} as never)
    ).resolves.toEqual([
      {
        warm_pool_id: 'warm-1',
        server: { id: 'srv-1', name: 'Server 1' },
        type: { id: EWorkerType.baileys, name: 'Baileys' },
        state: EWorkerWarmPoolState.ready,
        container_id: 'container-1',
        container_name: 'warm-container-1',
        session_volume_name: 'volume-1',
        last_health_at: '2026-06-01T12:00:00.000Z',
        last_error: null,
        created_at: '2026-06-01T10:00:00.000Z',
        updated_at: '2026-06-01T12:00:00.000Z',
      },
    ]);
    expect(chain.queryBuilder.limit).toHaveBeenCalledWith(25);
    expect(chain.queryBuilder.offset).toHaveBeenCalledWith(50);
  });

  it('returns total and recreate rows only through the ready warm channel query', async () => {
    const totalChain = createExecuteChain([{ value: 2 }]);
    const recreateChain = createExecuteChain([
      {
        warm_pool_id: 'warm-1',
        server_id: 'srv-1',
        worker_type_id: EWorkerType.baileys,
        container_id: 'container-1',
        container_name: 'warm-container-1',
        session_volume_name: 'volume-1',
        state: EWorkerWarmPoolState.ready,
      },
      {
        warm_pool_id: 'warm-2',
        server_id: 'srv-1',
        worker_type_id: EWorkerType.baileys,
        container_id: 'container-2',
        container_name: 'warm-container-2',
        session_volume_name: 'volume-2',
        state: EWorkerWarmPoolState.ready,
      },
    ]);
    const dbRo = {
      select: jest
        .fn()
        .mockImplementationOnce(totalChain.select)
        .mockImplementationOnce(recreateChain.select),
    };
    const repository = new WorkerWarmPoolRepository({} as never, dbRo as never);

    await expect(repository.listReadyWarmChannelsTotal({})).resolves.toBe(2);
    await expect(
      repository.listReadyWarmChannelsForRecreate({})
    ).resolves.toHaveLength(2);

    const totalWhere = collectSqlParts(
      totalChain.queryBuilder.where.mock.calls[0][0]
    ).join(' ');
    const recreateWhere = collectSqlParts(
      recreateChain.queryBuilder.where.mock.calls[0][0]
    ).join(' ');

    expect(totalWhere).toContain(EWorkerWarmPoolState.ready);
    expect(recreateWhere).toContain(EWorkerWarmPoolState.ready);
    expect(totalWhere).not.toContain(EWorkerWarmPoolState.assigned);
    expect(recreateWhere).not.toContain(EWorkerWarmPoolState.assigned);
  });

  it('applies server, type, id, container and date filters to ready warm channels', async () => {
    const chain = createExecuteChain([{ warm_pool_id: 'warm-1' }]);
    const repository = new WorkerWarmPoolRepository(
      {} as never,
      { select: chain.select } as never
    );

    await expect(
      repository.listReadyWarmChannelsForRecreate({
        server_id: 'srv-1',
        type: EWorkerType.baileys,
        warm_pool_id: 'warm',
        container_id: 'container',
        container_name: 'name',
        session_volume_name: 'volume',
        search: 'server',
        created_at_from: '2026-06-01T00:00:00.000Z',
        created_at_to: '2026-06-02T00:00:00.000Z',
        updated_at_from: '2026-06-03T00:00:00.000Z',
        updated_at_to: '2026-06-04T00:00:00.000Z',
        last_health_at_from: '2026-06-05T00:00:00.000Z',
        last_health_at_to: '2026-06-06T00:00:00.000Z',
      })
    ).resolves.toEqual([{ warm_pool_id: 'warm-1' }]);

    const whereSql = collectSqlParts(
      chain.queryBuilder.where.mock.calls[0][0]
    ).join(' ');

    expect(whereSql).toContain(EWorkerWarmPoolState.ready);
    expect(whereSql).toContain('srv-1');
    expect(whereSql).toContain(EWorkerType.baileys);
    expect(whereSql).toContain('%warm%');
    expect(whereSql).toContain('%container%');
    expect(whereSql).toContain('%name%');
    expect(whereSql).toContain('%volume%');
    expect(whereSql).toContain('%server%');
    expect(whereSql).toContain('2026-06-01T00:00:00.000Z');
    expect(whereSql).toContain('2026-06-06T00:00:00.000Z');
  });
});
