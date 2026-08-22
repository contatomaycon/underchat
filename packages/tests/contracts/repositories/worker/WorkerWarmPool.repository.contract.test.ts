import 'reflect-metadata';
import {
  CONVERTED_WARM_RECLAIM_MARKER,
  LEGACY_WARM_RECLAIM_MARKER,
  WorkerWarmPoolRepository,
} from '@core/repositories/worker/WorkerWarmPool.repository';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerWarmPoolState } from '@core/common/enums/EWorkerWarmPoolState';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import * as schema from '@core/models';
import { workerRuntime } from '@core/models';
import { type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { PgDialect } from 'drizzle-orm/pg-core';

const HEALTH_FRESH_AFTER = '2026-07-16T23:59:00.000Z';

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
    groupBy: jest.fn(),
    execute: jest.fn(async () => result),
  } as any;
  queryBuilder.innerJoin.mockReturnValue(queryBuilder);
  queryBuilder.where.mockReturnValue(queryBuilder);
  queryBuilder.groupBy.mockReturnValue(queryBuilder);

  const from = jest.fn(() => queryBuilder);
  const select = jest.fn(() => ({ from }));

  return { queryBuilder, select };
}

function createDeleteChain(rowCount: number) {
  const queryBuilder = {
    where: jest.fn(),
    execute: jest.fn(async () => ({ rowCount })),
  } as any;
  queryBuilder.where.mockReturnValue(queryBuilder);

  const deleteFn = jest.fn(() => queryBuilder);

  return { queryBuilder, deleteFn };
}

function createUpdateChain(rowCount: number) {
  const queryBuilder = {
    set: jest.fn(),
    where: jest.fn(),
    execute: jest.fn(async () => ({ rowCount })),
  } as any;
  queryBuilder.set.mockReturnValue(queryBuilder);
  queryBuilder.where.mockReturnValue(queryBuilder);

  const updateFn = jest.fn(() => queryBuilder);

  return { queryBuilder, updateFn };
}

function createPostgresWarmBindDatabase(
  selectResults: unknown[][],
  updateRowCounts: number[] = [1, 1]
) {
  const selectWhere: SQL[] = [];
  const updateWhere: SQL[] = [];
  let selectIndex = 0;
  let updateIndex = 0;
  const tx = {
    select: jest.fn(() => {
      const queryBuilder = {
        from: jest.fn(),
        where: jest.fn((condition: SQL) => {
          selectWhere.push(condition);
          return queryBuilder;
        }),
        for: jest.fn(),
        limit: jest.fn(),
        execute: jest.fn(async () => selectResults[selectIndex++] ?? []),
      } as any;
      queryBuilder.from.mockReturnValue(queryBuilder);
      queryBuilder.for.mockReturnValue(queryBuilder);
      queryBuilder.limit.mockReturnValue(queryBuilder);
      return queryBuilder;
    }),
    update: jest.fn(() => {
      const queryBuilder = {
        set: jest.fn(),
        where: jest.fn((condition: SQL) => {
          updateWhere.push(condition);
          return queryBuilder;
        }),
        execute: jest.fn(async () => ({
          rowCount: updateRowCounts[updateIndex++] ?? 0,
        })),
      } as any;
      queryBuilder.set.mockReturnValue(queryBuilder);
      return queryBuilder;
    }),
  };
  return {
    database: {
      transaction: jest.fn(
        async (operation: (transaction: typeof tx) => Promise<unknown>) =>
          operation(tx)
      ),
    },
    selectWhere,
    tx,
    updateWhere,
  };
}

function compileCondition(condition: SQL): string {
  return new PgDialect().sqlToQuery(condition).sql.replace(/\s+/gu, ' ').trim();
}

interface CapturedPgQuery {
  readonly text: string;
  readonly params: readonly unknown[];
}

function createPgQueryHarness(rowCount: number) {
  const queries: CapturedPgQuery[] = [];
  const client = {
    query: jest.fn(
      async (
        query: string | { readonly text: string },
        params: readonly unknown[] = []
      ) => {
        queries.push({
          text: typeof query === 'string' ? query : query.text,
          params,
        });
        return { rowCount, rows: [] };
      }
    ),
  };

  return {
    db: drizzle(client as never, { schema }),
    queries,
  };
}

function collectSqlParts(
  value: unknown,
  visited = new WeakSet<object>()
): string[] {
  if (value === null || value === undefined) {
    return [];
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return [String(value)];
  }

  if (typeof value === 'function') {
    if (!jest.isMockFunction(value)) {
      return [];
    }

    return value.mock.calls.flatMap((call: unknown[]) =>
      call.flatMap((argument: unknown) => collectSqlParts(argument, visited))
    );
  }

  if (typeof value !== 'object' || visited.has(value)) {
    return [];
  }
  visited.add(value);

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectSqlParts(item, visited));
  }

  const record = value as {
    queryChunks?: unknown[];
    value?: unknown;
    name?: unknown;
    columnType?: unknown;
  };
  const parts: string[] = [];

  if (Array.isArray(record.queryChunks)) {
    parts.push(
      ...record.queryChunks.flatMap((chunk) => collectSqlParts(chunk, visited))
    );
  }

  if (Array.isArray(record.value)) {
    parts.push(
      ...record.value.flatMap((item) => collectSqlParts(item, visited))
    );
  } else if ('value' in record) {
    parts.push(...collectSqlParts(record.value, visited));
  }

  if (
    typeof record.name === 'string' &&
    typeof record.columnType === 'string'
  ) {
    parts.push(record.name);
  }

  for (const candidate of Object.values(value)) {
    if (jest.isMockFunction(candidate)) {
      parts.push(...collectSqlParts(candidate, visited));
    }
  }

  return parts;
}

describe('WorkerWarmPoolRepository warm channels', () => {
  const postgresWarmBindInput = {
    warmPoolId: '00000000-0000-4000-8000-000000000010',
    workerId: '00000000-0000-4000-8000-000000000001',
    accountId: '00000000-0000-4000-8000-000000000002',
    serverId: '00000000-0000-4000-8000-000000000003',
    workerTypeId: EWorkerType.baileys,
    lifecycleOperationId: '00000000-0000-4000-8000-000000000004',
    containerId: 'a'.repeat(64),
    containerName: 'worker-1',
    runtimeGeneration: 8,
    runtimeCapabilityHash: 'b'.repeat(64),
    writerEpoch: '00000000-0000-4000-8000-000000000005',
  };

  it('rejects a stale retired PostgreSQL warm bind through all-or-none tombstone and clean prebind predicates', async () => {
    const fixture = createPostgresWarmBindDatabase([
      [{ worker_id: postgresWarmBindInput.workerId }],
      [],
    ]);
    const repository = new WorkerWarmPoolRepository(
      fixture.database as never,
      {} as never
    );

    await expect(
      repository.bindPostgresWarmRuntime(postgresWarmBindInput)
    ).resolves.toBe(false);

    expect(fixture.tx.update).not.toHaveBeenCalled();
    const runtimeFence = compileCondition(fixture.selectWhere[1]);
    for (const requiredNull of [
      'recreate_retired_operation_id',
      'recreate_retired_runtime_generation',
      'recreate_retired_container_id',
      'recreate_retired_at',
      'connection_epoch',
      'source_provider',
      'connection_activated_at',
      'native_connection_status',
      'native_connection_public_status',
      'recreate_bootstrap_operation_id',
      'recreate_bootstrap_started_at',
    ]) {
      expect(runtimeFence).toContain(
        `"worker_runtime"."${requiredNull}" is null`
      );
    }
    expect(runtimeFence).toContain(
      'cardinality("worker_runtime"."native_connection_status_retired_source_ids") = 0'
    );
    expect(runtimeFence).toContain(
      '"worker_runtime"."native_connection_online_acknowledged" = $'
    );
  });

  it('keeps only an exact clean PostgreSQL warm prebind replay idempotent', async () => {
    const fixture = createPostgresWarmBindDatabase([
      [{ worker_id: postgresWarmBindInput.workerId }],
      [{ worker_id: postgresWarmBindInput.workerId }],
      [{ warm_pool_id: postgresWarmBindInput.warmPoolId }],
    ]);
    const repository = new WorkerWarmPoolRepository(
      fixture.database as never,
      {} as never
    );

    await expect(
      repository.bindPostgresWarmRuntime(postgresWarmBindInput)
    ).resolves.toBe(true);

    expect(fixture.tx.update).toHaveBeenCalledTimes(2);
    const runtimeSelectFence = compileCondition(fixture.selectWhere[1]);
    const runtimeUpdateFence = compileCondition(fixture.updateWhere[0]);
    for (const fence of [runtimeSelectFence, runtimeUpdateFence]) {
      expect(fence).toContain('"worker_runtime"."container_id" = $');
      expect(fence).toContain('"worker_runtime"."container_name" = $');
      expect(fence).toContain('"worker_runtime"."runtime_capability_hash" = $');
      expect(fence).toContain('"worker_runtime"."session_writer_epoch" = $');
      expect(fence).toContain('"worker_runtime"."connection_sequence" = $');
      expect(fence).toContain(
        '"worker_runtime"."recreate_retired_operation_id" is null'
      );
    }
  });

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
    expect(totalWhere).toContain('server_web');
    expect(totalWhere).toContain('active_web');
    expect(recreateWhere).toContain('server_web');
    expect(recreateWhere).toContain('active_web');
    expect(totalWhere).not.toContain(EWorkerWarmPoolState.assigned);
    expect(recreateWhere).not.toContain(EWorkerWarmPoolState.assigned);
  });

  it('excludes ready counts that belong to soft-deleted servers', async () => {
    const chain = createExecuteChain([
      {
        server_id: 'srv-active',
        worker_type_id: EWorkerType.baileys,
        ready_count: 4,
      },
    ]);
    const repository = new WorkerWarmPoolRepository(
      {} as never,
      { select: chain.select } as never
    );

    await expect(repository.listReadyCounts()).resolves.toEqual([
      {
        server_id: 'srv-active',
        worker_type_id: EWorkerType.baileys,
        ready_count: 4,
      },
    ]);

    expect(chain.queryBuilder.innerJoin).toHaveBeenCalledTimes(1);
    const whereSql = collectSqlParts(
      chain.queryBuilder.where.mock.calls[0][0]
    ).join(' ');
    expect(whereSql).toContain(EWorkerWarmPoolState.ready);
    expect(whereSql).toContain('deleted_at');
    expect(whereSql).toContain('server_web');
    expect(whereSql).toContain('active_web');
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

  it('does not reserve a warm pool already linked to an active runtime', async () => {
    const tx = {
      execute: jest.fn(async (_query: unknown) => ({ rows: [] })),
    };
    const dbRw = {
      transaction: jest.fn(async (callback) => callback(tx)),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(
      repository.reserveReady(
        'server-1',
        EWorkerType.baileys,
        'worker-1',
        '2026-06-10T15:00:00.000Z',
        HEALTH_FRESH_AFTER
      )
    ).resolves.toBeNull();

    const reserveSql = collectSqlParts(tx.execute.mock.calls[0][0]).join(' ');

    expect(reserveSql).toContain('worker_runtime');
    expect(reserveSql).toContain('warm_pool_id');
    expect(reserveSql).toContain('container_id');
    expect(reserveSql).toContain('container_name');
    expect(reserveSql).toContain('session_volume_name');
    expect(reserveSql).toContain('warm-%');
    expect(reserveSql).toContain('last_health_at');
    expect(reserveSql).toContain(HEALTH_FRESH_AFTER);
  });

  it('loads durable adopted runtime identities independently from mutable worker status', async () => {
    const identity = {
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.online,
      worker_container_id: 'container-1',
      lifecycle_operation_id: null,
      runtime_container_id: 'container-1',
      runtime_container_name: 'worker-1',
      session_volume_name: 'warm-pool-1',
      runtime_generation: 7,
      warm_pool_id: 'pool-1',
    };
    const chain = createExecuteChain([identity]);
    const repository = new WorkerWarmPoolRepository(
      { select: chain.select } as never,
      {} as never
    );

    await expect(
      repository.listAdoptedRuntimeIdentitiesByServer('server-1')
    ).resolves.toEqual([identity]);

    expect(chain.queryBuilder.innerJoin).toHaveBeenCalledTimes(1);
    const whereSql = collectSqlParts(
      chain.queryBuilder.where.mock.calls[0][0]
    ).join(' ');
    expect(whereSql).toContain('server-1');
    expect(whereSql).toContain('deleted_at');
    expect(whereSql).toContain('container_id');
    expect(whereSql).toContain('warm_pool_id');
    for (const status of Object.values(EWorkerStatus)) {
      expect(whereSql).not.toContain(status);
    }
  });

  it('loads every durable warm physical ownership from the primary without filtering mutable state', async () => {
    const chain = createExecuteChain([
      { warm_pool_id: 'warm-ready' },
      { warm_pool_id: 'warm-deleting' },
      { warm_pool_id: 'warm-assigned' },
    ]);
    const repository = new WorkerWarmPoolRepository(
      { select: chain.select } as never,
      {} as never
    );

    await expect(
      repository.listPhysicalOwnershipIdsByServer('server-1')
    ).resolves.toEqual(['warm-ready', 'warm-deleting', 'warm-assigned']);

    const whereSql = collectSqlParts(
      chain.queryBuilder.where.mock.calls[0][0]
    ).join(' ');
    expect(whereSql).toContain('server-1');
    for (const state of Object.values(EWorkerWarmPoolState)) {
      expect(whereSql).not.toContain(state);
    }
  });

  it('loads only active warm states as physical capacity and excludes cleanup debt', async () => {
    const chain = createExecuteChain([
      { warm_pool_id: 'warm-ready' },
      { warm_pool_id: 'warm-activating' },
    ]);
    const repository = new WorkerWarmPoolRepository(
      { select: chain.select } as never,
      {} as never
    );

    await expect(
      repository.listCapacityOwnershipIdsByServer('server-1')
    ).resolves.toEqual(['warm-ready', 'warm-activating']);

    const whereSql = collectSqlParts(
      chain.queryBuilder.where.mock.calls[0][0]
    ).join(' ');
    expect(whereSql).toContain('server-1');
    expect(whereSql).toContain(EWorkerWarmPoolState.warming);
    expect(whereSql).toContain(EWorkerWarmPoolState.ready);
    expect(whereSql).toContain(EWorkerWarmPoolState.reserved);
    expect(whereSql).toContain(EWorkerWarmPoolState.activating);
    expect(whereSql).not.toContain(EWorkerWarmPoolState.deleting);
    expect(whereSql).not.toContain(EWorkerWarmPoolState.error);
    expect(whereSql).not.toContain(EWorkerWarmPoolState.assigned);
  });

  it('deletes stale assigned warm pool references for a worker while preserving the current warm pool', async () => {
    const chain = createDeleteChain(2);
    const repository = new WorkerWarmPoolRepository(
      { delete: chain.deleteFn } as never,
      {} as never
    );

    await expect(
      repository.deleteAssignedByWorkerId('worker-1', 'warm-current')
    ).resolves.toBe(2);

    const whereSql = collectSqlParts(
      chain.queryBuilder.where.mock.calls[0][0]
    ).join(' ');

    expect(chain.deleteFn).toHaveBeenCalled();
    expect(whereSql).toContain(EWorkerWarmPoolState.assigned);
    expect(whereSql).toContain('worker-1');
    expect(whereSql).toContain('warm-current');
    expect(whereSql).toContain('whatsapp_session_storage_migration');
    expect(whereSql).toContain('source_volume_preserved');
  });

  it('atomically claims stale deleting and terminal error rows with cooldown locks', async () => {
    const staleDeleting = {
      warm_pool_id: 'warm-deleting',
      state: EWorkerWarmPoolState.deleting,
    };
    const terminalError = {
      warm_pool_id: 'warm-error',
      state: EWorkerWarmPoolState.deleting,
    };
    const dbRw = {
      execute: jest
        .fn()
        .mockResolvedValueOnce({ rows: [staleDeleting] })
        .mockResolvedValueOnce({ rows: [terminalError] }),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(
      repository.claimStaleDeletingForRetry({
        staleBefore: '2026-07-17T00:00:00.000Z',
        limit: 50,
      })
    ).resolves.toEqual([staleDeleting]);
    await expect(
      repository.claimErrorsForCleanup({
        staleBefore: '2026-07-17T00:01:00.000Z',
        limit: 25,
      })
    ).resolves.toEqual([terminalError]);

    const deletingSql = collectSqlParts(dbRw.execute.mock.calls[0][0]).join(
      ' '
    );
    const errorSql = collectSqlParts(dbRw.execute.mock.calls[1][0]).join(' ');

    expect(deletingSql).toContain('FOR UPDATE SKIP LOCKED');
    expect(deletingSql).toContain('worker_runtime');
    expect(deletingSql).toContain('NOT EXISTS');
    expect(deletingSql).toContain('active_server');
    expect(deletingSql).toContain('server_web');
    expect(deletingSql).toContain('active_web');
    expect(deletingSql).toContain('IS NULL');
    expect(deletingSql).toContain(EWorkerWarmPoolState.deleting);
    expect(deletingSql).toContain('2026-07-17T00:00:00.000Z');
    expect(errorSql).toContain('FOR UPDATE SKIP LOCKED');
    expect(errorSql).toContain('worker_runtime');
    expect(errorSql).toContain('NOT EXISTS');
    expect(errorSql).toContain('active_server');
    expect(errorSql).toContain('server_web');
    expect(errorSql).toContain('active_web');
    expect(errorSql).toContain('IS NULL');
    expect(errorSql).toContain(EWorkerWarmPoolState.error);
    expect(errorSql).toContain(EWorkerWarmPoolState.deleting);
    expect(errorSql).toContain('2026-07-17T00:01:00.000Z');
  });

  it('lists bounded deleting tombstones that became protected by runtime lineage', async () => {
    const dbRw = {
      execute: jest.fn(async (_query: unknown) => ({
        rows: [
          { warm_pool_id: 'warm-lineage-1' },
          { warm_pool_id: 'warm-lineage-2' },
        ],
      })),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(repository.listDeletingRuntimeLineageIds(25)).resolves.toEqual(
      ['warm-lineage-1', 'warm-lineage-2']
    );

    const querySql = collectSqlParts(dbRw.execute.mock.calls[0][0]).join(' ');
    expect(querySql).toContain(EWorkerWarmPoolState.deleting);
    expect(querySql).toContain('worker_runtime');
    expect(querySql).toContain('warm_pool_id');
    expect(querySql).toContain('container_id');
    expect(querySql).toContain('container_name');
    expect(querySql).toContain('session_volume_name');
    expect(querySql).toContain('LIMIT');
    expect(querySql).not.toContain('DELETE FROM');
  });

  it('durably tombstones unreferenced warm metadata owned by decommissioned servers', async () => {
    const dbRw = {
      execute: jest.fn(async (_query: unknown) => ({
        rows: [
          { warm_pool_id: 'warm-decommissioned-1' },
          { warm_pool_id: 'warm-decommissioned-2' },
        ],
      })),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(
      repository.tombstoneUnreferencedDecommissionedServerEntries(25)
    ).resolves.toBe(2);

    const querySql = collectSqlParts(dbRw.execute.mock.calls[0][0]).join(' ');
    expect(querySql).toContain('deleted_at');
    expect(querySql).toContain('IS NOT NULL');
    expect(querySql).toContain('LEFT JOIN');
    expect(querySql).toContain('target_server');
    expect(querySql).toContain('server_id');
    expect(querySql).toContain('server_web');
    expect(querySql).toContain('active_web');
    expect(querySql).toContain('server_ssh');
    expect(querySql).toContain('active_ssh');
    expect(querySql).toContain('IS NULL');
    expect(querySql).toContain('worker_runtime');
    expect(querySql).toContain('NOT EXISTS');
    expect(querySql).toContain('FOR UPDATE');
    expect(querySql).toContain('SKIP LOCKED');
    expect(querySql).toContain('UPDATE');
    expect(querySql).toContain(EWorkerWarmPoolState.deleting);
    expect(querySql).toContain('warm_server_decommissioned_cleanup_pending');
    expect(querySql).toContain('container_name');
    expect(querySql).not.toContain('DELETE FROM');
    expect(querySql).toContain('25');
  });

  it('atomically fences a warm delete and resolves stale/decommissioned dispatches', async () => {
    const dbRw = {
      execute: jest.fn(async (_query: unknown) => ({
        rows: [{ decision: 'deferred_server_unavailable' }],
      })),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(
      repository.prepareDeleteDispatch({
        warmPoolId: 'warm-1',
        serverId: 'server-1',
      })
    ).resolves.toEqual({
      decision: 'deferred_server_unavailable',
      target: null,
    });

    const querySql = collectSqlParts(dbRw.execute.mock.calls[0][0]).join(' ');
    expect(querySql).toContain('MATERIALIZED');
    expect(querySql).toContain('FOR UPDATE');
    expect(querySql).toContain('worker_runtime');
    expect(querySql).toContain('runtime_active');
    expect(querySql).toContain('server_unavailable');
    expect(querySql).toContain('server_ssh');
    expect(querySql).not.toContain('DELETE FROM');
    expect(querySql).toContain('LEFT JOIN');
    expect(querySql).toContain('target_server');
    expect(querySql).toContain('server_web');
    expect(querySql).toContain('active_web');
    expect(querySql).toContain('IS NULL');
    expect(querySql).toContain('deferred_server_unavailable');
    expect(querySql).toContain('protected_runtime');
    expect(querySql).toContain('server_mismatch');
    expect(querySql).toContain('state_not_deletable');
    expect(querySql).not.toContain(EWorkerWarmPoolState.ready);
    expect(querySql).toContain(EWorkerWarmPoolState.deleting);
    expect(querySql).toContain('warm-1');
    expect(querySql).toContain('server-1');
  });

  it('returns the canonical locked database identity for a delete dispatch', async () => {
    const dbRw = {
      execute: jest.fn(async (_query: unknown) => ({
        rows: [
          {
            decision: 'dispatch',
            warm_pool_id: 'warm-1',
            server_id: 'server-1',
            worker_type_id: 'type-canonical',
            session_storage: EWorkerSessionStorage.legacy_volume,
            container_id: 'container-canonical',
            container_name: 'warm-canonical',
            session_volume_name: 'volume-canonical',
          },
        ],
      })),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(
      repository.prepareDeleteDispatch({
        warmPoolId: 'warm-1',
        serverId: 'server-1',
      })
    ).resolves.toEqual({
      decision: 'dispatch',
      target: {
        warm_pool_id: 'warm-1',
        server_id: 'server-1',
        worker_type_id: 'type-canonical',
        session_storage: EWorkerSessionStorage.legacy_volume,
        container_id: 'container-canonical',
        container_name: 'warm-canonical',
        session_volume_name: 'volume-canonical',
      },
    });

    const querySql = collectSqlParts(dbRw.execute.mock.calls[0][0]).join(' ');
    expect(querySql).toContain('worker_type_id');
    expect(querySql).toContain('container_id');
    expect(querySql).toContain('container_name');
    expect(querySql).toContain('session_volume_name');
    expect(querySql).toContain('FROM claimed');
  });

  it('returns a canonical PostgreSQL delete target without a session volume', async () => {
    const dbRw = {
      execute: jest.fn(async (_query: unknown) => ({
        rows: [
          {
            decision: 'dispatch',
            warm_pool_id: 'warm-postgres-1',
            server_id: 'server-1',
            worker_type_id: 'type-1',
            session_storage: EWorkerSessionStorage.postgres,
            container_id: 'container-postgres',
            container_name: 'warm-postgres-1',
            session_volume_name: null,
          },
        ],
      })),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(
      repository.prepareDeleteDispatch({
        warmPoolId: 'warm-postgres-1',
        serverId: 'server-1',
      })
    ).resolves.toEqual({
      decision: 'dispatch',
      target: {
        warm_pool_id: 'warm-postgres-1',
        server_id: 'server-1',
        worker_type_id: 'type-1',
        session_storage: EWorkerSessionStorage.postgres,
        container_id: 'container-postgres',
        container_name: 'warm-postgres-1',
        session_volume_name: null,
      },
    });
  });

  it('fails closed when a claimed dispatch does not return a complete canonical identity', async () => {
    const dbRw = {
      execute: jest.fn(async (_query: unknown) => ({
        rows: [
          {
            decision: 'dispatch',
            warm_pool_id: 'warm-1',
            server_id: 'server-1',
            worker_type_id: 'type-1',
            session_storage: EWorkerSessionStorage.legacy_volume,
            container_name: 'warm-1',
            session_volume_name: null,
          },
        ],
      })),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(
      repository.prepareDeleteDispatch({
        warmPoolId: 'warm-1',
        serverId: 'server-1',
      })
    ).rejects.toThrow('warm_delete_dispatch_canonical_target_missing');
  });

  it('claims a label-proven legacy standby only through a locked deleting-row CAS with no owner lineage', async () => {
    const claimed = {
      warm_pool_id: '019fb27a-47c9-7321-a249-681c18fc615d',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'a'.repeat(64),
      container_name: 'warm-019fb27a-47c9-7321-a249-681c18fc615d',
      session_volume_name: 'warm-019fb27a-47c9-7321-a249-681c18fc615d',
      state: EWorkerWarmPoolState.deleting,
      reserved_by_worker_id: null,
      last_error: LEGACY_WARM_RECLAIM_MARKER,
    };
    const dbRw = {
      execute: jest.fn(async (_query: unknown) => ({ rows: [claimed] })),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(
      repository.claimLegacyDeletingContainerForReclaim({
        warmPoolId: claimed.warm_pool_id,
        serverId: claimed.server_id,
        workerTypeId: claimed.worker_type_id,
        containerId: claimed.container_id,
        containerName: claimed.container_name,
        sessionVolumeName: claimed.session_volume_name,
      })
    ).resolves.toEqual(claimed);

    const querySql = collectSqlParts(dbRw.execute.mock.calls[0][0]).join(' ');
    expect(querySql).toContain('MATERIALIZED');
    expect(querySql).toContain('FOR UPDATE');
    expect(querySql).toContain(EWorkerWarmPoolState.deleting);
    expect(querySql).toContain(LEGACY_WARM_RECLAIM_MARKER);
    expect(querySql).toContain('reserved_by_worker_id');
    expect(querySql).toContain('IS NULL');
    expect(querySql).toContain('worker_runtime');
    expect(querySql).toContain('worker_warm_pool');
    expect(querySql).toContain('other_pool');
    expect(querySql).toContain('owner');
    expect(querySql).toContain('whatsapp_session_storage_migration');
    expect(querySql).toContain('source_volume_preserved');
    expect(querySql.match(/NOT EXISTS/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('holds the deleting-row lock across legacy Docker reclaim and repeats ownership predicates in the final DELETE', async () => {
    const warmPoolId = '019fb27a-47c9-7321-a249-681c18fc615d';
    const input = {
      warmPoolId,
      serverId: 'server-1',
      workerTypeId: EWorkerType.baileys,
      containerId: 'a'.repeat(64),
      containerName: `warm-${warmPoolId}`,
      sessionVolumeName: `warm-${warmPoolId}`,
    };
    const queries: unknown[] = [];
    const tx = {
      execute: jest.fn(async (query: unknown) => {
        queries.push(query);
        const querySql = collectSqlParts(query).join(' ');
        if (querySql.includes('DELETE FROM')) {
          return { rows: [{ warm_pool_id: warmPoolId }] };
        }
        if (querySql.includes('SELECT EXISTS')) {
          return { rows: [{ safe: true }] };
        }
        return {
          rows: [
            {
              warm_pool_id: warmPoolId,
              state: EWorkerWarmPoolState.deleting,
            },
          ],
        };
      }),
    };
    const dbRw = {
      transaction: jest.fn(
        async (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx)
      ),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);
    const operation = jest.fn(
      async (fence: { assertUnreferenced(): Promise<void> }) => {
        await fence.assertUnreferenced();
        return 'removed';
      }
    );

    await expect(
      repository.withLegacyDeletingReclaimFence(input, operation)
    ).resolves.toBe('removed');

    expect(dbRw.transaction).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledTimes(1);
    const lockedSql = collectSqlParts(queries[0]).join(' ');
    expect(lockedSql).toContain('FOR UPDATE');
    const finalDeleteSql = collectSqlParts(queries.at(-1)).join(' ');
    expect(finalDeleteSql).toContain('DELETE FROM');
    expect(finalDeleteSql).toContain('worker_runtime');
    expect(finalDeleteSql).toContain('other_pool');
    expect(finalDeleteSql).toContain('owner');
    expect(finalDeleteSql).toContain('whatsapp_session_storage_migration');
    expect(finalDeleteSql.match(/NOT EXISTS/g)?.length).toBeGreaterThanOrEqual(
      3
    );
  });

  it('holds both converted warm and owner rows while repeating every runtime, worker pointer, and pool fence', async () => {
    const warmPoolId = '019fb27a-47c9-7321-a249-681c18fc615d';
    const ownerWorkerId = '019fb27a-47c9-7321-a249-681c18fc615e';
    const input = {
      warmPoolId,
      serverId: 'server-1',
      workerTypeId: EWorkerType.baileys,
      containerId: 'a'.repeat(64),
      containerName: ownerWorkerId,
      sessionVolumeName: `warm-${warmPoolId}`,
      ownerWorkerId,
    };
    const queries: unknown[] = [];
    const tx = {
      execute: jest.fn(async (query: unknown) => {
        queries.push(query);
        const querySql = collectSqlParts(query).join(' ');
        if (querySql.includes('DELETE FROM')) {
          return { rows: [{ warm_pool_id: warmPoolId }] };
        }
        if (querySql.includes('SELECT EXISTS')) {
          return { rows: [{ safe: true }] };
        }
        return {
          rows: [
            {
              warm_pool_id: warmPoolId,
              owner_deleted_at: '2026-07-30T12:00:00.000Z',
              owner_container_id: input.containerId,
              owner_account_id: 'account-1',
            },
          ],
        };
      }),
    };
    const dbRw = {
      transaction: jest.fn(
        async (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx)
      ),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);
    const operation = jest.fn(
      async (fence: {
        ownerMode: string;
        ownerAccountId: string;
        assertSafe(): Promise<void>;
      }) => {
        expect(fence.ownerMode).toBe('deleted');
        expect(fence.ownerAccountId).toBe('account-1');
        await fence.assertSafe();
        return 'removed';
      }
    );

    await expect(
      repository.withConvertedDeletingReclaimFence(input, operation)
    ).resolves.toBe('removed');

    expect(operation).toHaveBeenCalledTimes(1);
    const lockedSql = collectSqlParts(queries[0]).join(' ');
    expect(lockedSql).toContain('FOR UPDATE OF pool, owner');
    expect(lockedSql).toContain(CONVERTED_WARM_RECLAIM_MARKER);
    expect(lockedSql).toContain('owner_container_id');
    for (const query of queries.slice(1)) {
      const querySql = collectSqlParts(query).join(' ');
      expect(querySql).toContain('worker_runtime');
      expect(querySql).toContain('warm_pool_id');
      expect(querySql).toContain('container_id');
      expect(querySql).toContain('container_name');
      expect(querySql).toContain('session_volume_name');
      expect(querySql).toContain('other_pool');
      expect(querySql).toContain('any_owner');
      expect(querySql).toContain('whatsapp_session_storage_migration');
    }
    expect(collectSqlParts(queries.at(-1)).join(' ')).toContain('DELETE FROM');
  });

  it('deletes an absent-resource legacy tombstone only after repeated DB and Docker proof under the row lock', async () => {
    const warmPoolId = '019fb27a-47c9-7321-a249-681c18fc615d';
    const containerName = `warm-${warmPoolId}`;
    const queries: unknown[] = [];
    const tx = {
      execute: jest.fn(async (query: unknown) => {
        queries.push(query);
        const querySql = collectSqlParts(query).join(' ');
        if (querySql.includes('DELETE FROM')) {
          return { rows: [{ warm_pool_id: warmPoolId }] };
        }
        if (querySql.includes('SELECT EXISTS')) {
          return { rows: [{ safe: true }] };
        }
        return { rows: [{ warm_pool_id: warmPoolId }] };
      }),
    };
    const dbRw = {
      transaction: jest.fn(
        async (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx)
      ),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);
    const confirmPhysicalAbsence = jest.fn(async () => undefined);

    await expect(
      repository.finalizeLegacyDeletingResourcesAbsent(
        {
          warmPoolId,
          serverId: 'server-1',
          workerTypeId: EWorkerType.baileys,
          containerName,
          sessionVolumeName: containerName,
        },
        confirmPhysicalAbsence
      )
    ).resolves.toBe(true);

    expect(confirmPhysicalAbsence).toHaveBeenCalledTimes(1);
    expect(collectSqlParts(queries[0]).join(' ')).toContain('FOR UPDATE');
    const proofSql = collectSqlParts(queries[1]).join(' ');
    expect(proofSql).toContain('worker_runtime');
    expect(proofSql).toContain('other_pool');
    expect(proofSql).toContain('container_name');
    expect(proofSql).toContain('session_volume_name');
    expect(proofSql).toContain('whatsapp_session_storage_migration');
    const deleteSql = collectSqlParts(queries.at(-1)).join(' ');
    expect(deleteSql).toContain('DELETE FROM');
    expect(deleteSql).toContain('container_id');
    expect(deleteSql).toContain('IS NULL');
    expect(deleteSql).toContain('whatsapp_session_storage_migration');
    expect(deleteSql.match(/NOT EXISTS/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('does not run the Docker absence callback when runtime ownership invalidates the DB proof', async () => {
    const warmPoolId = '019fb27a-47c9-7321-a249-681c18fc615d';
    const tx = {
      execute: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ warm_pool_id: warmPoolId }] })
        .mockResolvedValueOnce({ rows: [{ safe: false }] }),
    };
    const dbRw = {
      transaction: jest.fn(
        async (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx)
      ),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);
    const confirmPhysicalAbsence = jest.fn(async () => undefined);

    await expect(
      repository.finalizeLegacyDeletingResourcesAbsent(
        {
          warmPoolId,
          serverId: 'server-1',
          workerTypeId: EWorkerType.baileys,
          containerName: `warm-${warmPoolId}`,
          sessionVolumeName: `warm-${warmPoolId}`,
        },
        confirmPhysicalAbsence
      )
    ).rejects.toThrow('legacy_warm_absent_database_proof_changed');

    expect(confirmPhysicalAbsence).not.toHaveBeenCalled();
    expect(tx.execute).toHaveBeenCalledTimes(2);
  });

  it('does not delete the legacy tombstone when physical orphan cleanup fails under the row lock', async () => {
    const warmPoolId = '019fb27a-47c9-7321-a249-681c18fc615d';
    const queries: unknown[] = [];
    const tx = {
      execute: jest.fn(async (query: unknown) => {
        queries.push(query);
        const querySql = collectSqlParts(query).join(' ');
        if (querySql.includes('SELECT EXISTS')) {
          return { rows: [{ safe: true }] };
        }
        return { rows: [{ warm_pool_id: warmPoolId }] };
      }),
    };
    const dbRw = {
      transaction: jest.fn(
        async (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx)
      ),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);
    const finalizePhysicalResources = jest.fn(async () => {
      throw new Error('legacy_warm_reclaim_volume_identity_changed');
    });

    await expect(
      repository.finalizeLegacyDeletingResourcesAbsent(
        {
          warmPoolId,
          serverId: 'server-1',
          workerTypeId: EWorkerType.baileys,
          containerName: `warm-${warmPoolId}`,
          sessionVolumeName: `warm-${warmPoolId}`,
        },
        finalizePhysicalResources
      )
    ).rejects.toThrow('legacy_warm_reclaim_volume_identity_changed');

    expect(finalizePhysicalResources).toHaveBeenCalledTimes(1);
    expect(
      queries.some((query) =>
        collectSqlParts(query).join(' ').includes('DELETE FROM')
      )
    ).toBe(false);
  });

  it('records a bounded delete retry failure only while the row remains deleting', async () => {
    const { db, queries } = createPgQueryHarness(1);
    const repository = new WorkerWarmPoolRepository(db, {} as never);
    const oversizedError = `deadline:${'x'.repeat(1200)}`;
    const boundedError = oversizedError.slice(0, 1000);

    await expect(
      repository.recordDeleteRetryFailure('warm-1', oversizedError)
    ).resolves.toBe(true);

    expect(queries).toHaveLength(1);
    const querySql =
      queries[0]?.text.replaceAll(/\s+/gu, ' ').trim().toLowerCase() ?? '';
    expect(querySql).toContain(
      'when "worker_warm_pool"."last_error" like cast($1 as text)'
    );
    expect(querySql).toContain(
      "then left( concat( cast($2 as text), ':retry:', cast($3 as text) ), 1000 )"
    );
    expect(querySql).toContain(
      'when "worker_warm_pool"."last_error" like cast($4 as text)'
    );
    expect(querySql).toContain(
      "then left( concat( cast($5 as text), ':retry:', cast($6 as text) ), 1000 )"
    );
    expect(querySql).toContain('else cast($7 as text)');
    expect(querySql).toContain(
      'where ("worker_warm_pool"."warm_pool_id" = $9 and "worker_warm_pool"."state" = $10)'
    );
    expect(queries[0]?.params).toEqual([
      `${LEGACY_WARM_RECLAIM_MARKER}%`,
      LEGACY_WARM_RECLAIM_MARKER,
      boundedError,
      `${CONVERTED_WARM_RECLAIM_MARKER}%`,
      CONVERTED_WARM_RECLAIM_MARKER,
      boundedError,
      boundedError,
      expect.any(String),
      'warm-1',
      EWorkerWarmPoolState.deleting,
    ]);
  });

  it('reports that no delete retry failure was recorded after the deleting fence changed', async () => {
    const { db } = createPgQueryHarness(0);
    const repository = new WorkerWarmPoolRepository(db, {} as never);

    await expect(
      repository.recordDeleteRetryFailure('warm-1', 'retry-error')
    ).resolves.toBe(false);
  });

  it('deletes stale assigned metadata only when no worker_runtime reference remains', async () => {
    const row = {
      warm_pool_id: 'warm-assigned',
      state: EWorkerWarmPoolState.deleting,
    };
    const dbRw = {
      execute: jest.fn(async (_query: unknown) => ({ rows: [row] })),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(
      repository.deleteUnreferencedAssignedForCleanup({
        staleBefore: '2026-07-17T00:00:00.000Z',
        limit: 100,
      })
    ).resolves.toEqual([row]);

    const querySql = collectSqlParts(dbRw.execute.mock.calls[0][0]).join(' ');

    expect(querySql).toContain('FOR UPDATE SKIP LOCKED');
    expect(querySql).toContain('DELETE FROM');
    expect(querySql).toContain('worker_runtime');
    expect(querySql).toContain('NOT EXISTS');
    expect(querySql).toContain('warm_pool_id');
    expect(querySql).toContain('container_id');
    expect(querySql).toContain('session_volume_name');
    expect(querySql).toContain('whatsapp_session_storage_migration');
    expect(querySql).toContain('source_volume_preserved');
    expect(querySql).toContain(EWorkerWarmPoolState.assigned);
  });

  it('creates a durable deleting tombstone only once for a Docker-only orphan', async () => {
    const dbRw = {
      execute: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ warm_pool_id: 'warm-orphan' }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);
    const input = {
      warmPoolId: '019f6f00-0000-7000-8000-000000000001',
      serverId: 'srv-1',
      workerTypeId: EWorkerType.whatsmeow,
      containerId: 'a'.repeat(64),
      containerName: 'warm-019f6f00-0000-7000-8000-000000000001',
      sessionStorage: EWorkerSessionStorage.legacy_volume,
      sessionVolumeName: 'warm-019f6f00-0000-7000-8000-000000000001',
    };

    await expect(repository.claimDockerOrphanForCleanup(input)).resolves.toBe(
      true
    );
    await expect(repository.claimDockerOrphanForCleanup(input)).resolves.toBe(
      false
    );

    const querySql = collectSqlParts(dbRw.execute.mock.calls[0][0]).join(' ');

    expect(querySql).toContain('INSERT INTO');
    expect(querySql).toContain('ON CONFLICT');
    expect(querySql).toContain('DO NOTHING');
    expect(querySql).toContain('worker_runtime');
    expect(querySql).toContain('NOT EXISTS');
    expect(querySql).toContain(input.containerId);
    expect(querySql).toContain('container_name');
    expect(querySql).toContain('session_volume_name');
    expect(querySql).toContain(EWorkerWarmPoolState.deleting);
    expect(querySql).toContain('warm_runtime_orphaned_in_docker');
    expect(querySql).toContain('whatsapp_session_storage_migration');
    expect(querySql).toContain('source_volume_preserved');
  });

  it('captures a late physical creation with immutable identity under a warming CAS', async () => {
    const row = {
      warm_pool_id: '019f6f00-0000-7000-8000-000000000001',
      server_id: 'srv-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'b'.repeat(64),
      container_name: 'warm-019f6f00-0000-7000-8000-000000000001',
      session_storage: EWorkerSessionStorage.legacy_volume,
      session_volume_name: 'warm-019f6f00-0000-7000-8000-000000000001',
      state: EWorkerWarmPoolState.deleting,
      reserved_by_worker_id: null,
      reservation_expires_at: null,
      last_health_at: null,
      last_error: 'warm_creation_unpersisted_physical_runtime',
      created_at: '2026-07-29T09:00:00.000Z',
      updated_at: '2026-07-30T12:00:00.000Z',
    };
    const dbRw = {
      execute: jest.fn(async (_query: unknown) => ({ rows: [row] })),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);
    const input = {
      warmPoolId: row.warm_pool_id,
      serverId: row.server_id,
      workerTypeId: row.worker_type_id,
      expectedWarmUpdatedAt: '2026-07-29T10:00:00.000Z',
      containerId: row.container_id,
      containerName: row.container_name,
      sessionStorage: row.session_storage,
      sessionVolumeName: row.session_volume_name,
    };

    await expect(
      repository.claimUnpersistedWarmingRuntimeForCleanup(input)
    ).resolves.toEqual(row);

    const querySql = collectSqlParts(dbRw.execute.mock.calls[0][0]).join(' ');
    expect(querySql).toContain('UPDATE');
    expect(querySql).toContain(EWorkerWarmPoolState.warming);
    expect(querySql).toContain(EWorkerWarmPoolState.deleting);
    expect(querySql).toContain(input.containerId);
    expect(querySql).toContain(input.expectedWarmUpdatedAt);
    expect(querySql).toContain('container_id');
    expect(querySql).toContain('IS NULL');
    expect(querySql).toContain('worker_runtime');
    expect(querySql).toContain('warm_creation_unpersisted_physical_runtime');
  });

  it('fences missing-runtime cleanup against adoption and concurrent state changes', async () => {
    const dbRw = {
      execute: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ warm_pool_id: 'warm-missing' }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(
      repository.claimMissingRuntimeForCleanup({
        warmPoolId: 'warm-missing',
      })
    ).resolves.toBe(true);
    await expect(
      repository.claimMissingRuntimeForCleanup({
        warmPoolId: 'warm-missing',
      })
    ).resolves.toBe(false);

    const querySql = collectSqlParts(dbRw.execute.mock.calls[0][0]).join(' ');

    expect(querySql).toContain('worker_runtime');
    expect(querySql).toContain('NOT EXISTS');
    expect(querySql).toContain('warm_pool_id');
    expect(querySql).toContain('container_id');
    expect(querySql).toContain('session_volume_name');
    expect(querySql).toContain(EWorkerWarmPoolState.warming);
    expect(querySql).toContain(EWorkerWarmPoolState.deleting);
  });

  it('lists and re-reads stale activating rows only on currently eligible servers', async () => {
    const row = {
      warm_pool_id: '019f6f00-0000-7000-8000-000000000011',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'a'.repeat(64),
      container_name: 'warm-019f6f00-0000-7000-8000-000000000011',
      session_volume_name: 'warm-019f6f00-0000-7000-8000-000000000011',
      state: EWorkerWarmPoolState.activating,
      reserved_by_worker_id: '019f6f00-0000-7000-8000-000000000012',
      reservation_expires_at: '2026-07-30T09:10:00.000Z',
      last_health_at: null,
      last_error: null,
      created_at: '2026-07-30T09:00:00.000Z',
      updated_at: '2026-07-30T09:01:00.000Z',
      owner_worker_id: '019f6f00-0000-7000-8000-000000000012',
      owner_account_id: 'account-1',
      owner_server_id: 'server-1',
      owner_worker_type_id: EWorkerType.baileys,
      owner_worker_status_id: EWorkerStatus.recreating,
      owner_lifecycle_operation_id: 'operation-2',
      owner_updated_at: '2026-07-30T09:02:00.000Z',
      owner_deleted_at: null,
    };
    const dbRw = {
      execute: jest
        .fn()
        .mockResolvedValueOnce({ rows: [row] })
        .mockResolvedValueOnce({ rows: [row] }),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(
      repository.listStaleActivatingForReconcile({
        staleBefore: '2026-07-30T09:05:00.000Z',
        limit: 100,
      })
    ).resolves.toEqual([
      {
        entry: expect.objectContaining({
          warm_pool_id: row.warm_pool_id,
          state: EWorkerWarmPoolState.activating,
        }),
        owner: {
          worker_id: row.owner_worker_id,
          account_id: row.owner_account_id,
          server_id: row.owner_server_id,
          worker_type_id: row.owner_worker_type_id,
          worker_status_id: row.owner_worker_status_id,
          lifecycle_operation_id: row.owner_lifecycle_operation_id,
          updated_at: row.owner_updated_at,
          deleted_at: null,
        },
      },
    ]);
    await expect(
      repository.viewStaleActivatingForReconcile({
        warmPoolId: row.warm_pool_id,
        staleBefore: '2026-07-30T09:05:00.000Z',
      })
    ).resolves.toEqual(
      expect.objectContaining({
        entry: expect.objectContaining({ warm_pool_id: row.warm_pool_id }),
        owner: expect.objectContaining({
          lifecycle_operation_id: 'operation-2',
        }),
      })
    );

    const listSql = collectSqlParts(dbRw.execute.mock.calls[0][0]).join(' ');
    const viewSql = collectSqlParts(dbRw.execute.mock.calls[1][0]).join(' ');
    for (const querySql of [listSql, viewSql]) {
      expect(querySql).toContain(EWorkerWarmPoolState.activating);
      expect(querySql).toContain('2026-07-30T09:05:00.000Z');
      expect(querySql).toContain('target_server');
      expect(querySql).toContain('server_status_id');
      expect(querySql).toContain('server_web');
      expect(querySql).toContain('active_web');
      expect(querySql).toContain('server_ssh');
      expect(querySql).toContain('active_ssh');
      expect(querySql).toContain('owner_lifecycle_operation_id');
    }
    expect(listSql).toContain('FOR UPDATE OF pool SKIP LOCKED');
    expect(listSql).toContain('100');
    expect(viewSql).toContain(row.warm_pool_id);
  });

  it('atomically claims abandoned activation cleanup only without any runtime lineage', async () => {
    const claimed = {
      warm_pool_id: '019f6f00-0000-7000-8000-000000000011',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      container_id: 'b'.repeat(64),
      container_name: '019f6f00-0000-7000-8000-000000000012',
      session_storage: EWorkerSessionStorage.legacy_volume,
      session_volume_name: 'warm-019f6f00-0000-7000-8000-000000000011',
      state: EWorkerWarmPoolState.deleting,
    };
    const dbRw = {
      execute: jest
        .fn()
        .mockResolvedValueOnce({ rows: [claimed] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);
    const input = {
      warmPoolId: claimed.warm_pool_id,
      reservedByWorkerId: '019f6f00-0000-7000-8000-000000000012',
      expectedSourceContainerId: 'a'.repeat(64),
      expectedWarmUpdatedAt: '2026-07-30T09:01:00.000Z',
      cleanupContainerId: 'b'.repeat(64),
      cleanupContainerName: '019f6f00-0000-7000-8000-000000000012',
      sessionStorage: claimed.session_storage,
      sessionVolumeName: claimed.session_volume_name,
      expectedOwner: {
        worker_id: '019f6f00-0000-7000-8000-000000000012',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: 'operation-2',
        updated_at: '2026-07-30T09:02:00.000Z',
        deleted_at: null,
      },
      lastError: 'warm_activation_abandoned:target_created_before_runtime',
    };

    await expect(
      repository.claimStaleActivatingForCleanup(input)
    ).resolves.toEqual(claimed);
    await expect(
      repository.claimStaleActivatingForCleanup(input)
    ).resolves.toBeNull();

    const querySql = collectSqlParts(dbRw.execute.mock.calls[0][0]).join(' ');
    expect(querySql).toContain(EWorkerWarmPoolState.activating);
    expect(querySql).toContain(EWorkerWarmPoolState.deleting);
    expect(querySql).toContain(input.reservedByWorkerId);
    expect(querySql).toContain(input.expectedSourceContainerId);
    expect(querySql).toContain(input.cleanupContainerId);
    expect(querySql).toContain(input.cleanupContainerName);
    expect(querySql).toContain(input.expectedWarmUpdatedAt);
    expect(querySql).toContain('IS NOT DISTINCT FROM');
    expect(querySql).toContain('lifecycle_operation_id');
    expect(querySql).toContain('worker_runtime');
    expect(querySql).toContain('NOT EXISTS');
    expect(querySql).toContain('warm_pool_id');
    expect(querySql).toContain('container_id');
    expect(querySql).toContain('container_name');
    expect(querySql).toContain('session_volume_name');
    expect(querySql).toContain('target_server');
    expect(querySql).toContain('server_status_id');
    expect(querySql).toContain('server_web');
    expect(querySql).toContain('server_ssh');
    expect(querySql).toContain('converted_owner');
    expect(querySql).toContain(input.cleanupContainerId);
  });

  it('detects adopted warm identities through every durable runtime reference', async () => {
    const dbRw = {
      execute: jest.fn(async (_query: unknown) => ({
        rows: [{ active: true }],
      })),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(
      repository.isRuntimeReferenceActive({
        warmPoolId: '019f6f00-0000-7000-8000-000000000001',
        containerName: 'warm-019f6f00-0000-7000-8000-000000000001',
        sessionVolumeName: 'warm-019f6f00-0000-7000-8000-000000000001',
      })
    ).resolves.toBe(true);

    const querySql = collectSqlParts(dbRw.execute.mock.calls[0][0]).join(' ');

    expect(querySql).toContain('worker_runtime');
    expect(querySql).toContain('warm_pool_id');
    expect(querySql).toContain('container_name');
    expect(querySql).toContain('session_volume_name');
  });

  it('serializes consume-time target claims by server and worker type', async () => {
    const dbRw = {
      execute: jest.fn(async (_query: unknown) => ({
        rows: [{ claimed: true }],
      })),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(
      repository.claimCapacityForReplenish({
        warmPoolId: '019f6f00-0000-7000-8000-000000000010',
        serverId: 'srv-1',
        workerTypeId: EWorkerType.baileys,
        sessionVolumeName: 'warm-019f6f00-0000-7000-8000-000000000010',
        target: 4,
        retryAfter: '2026-07-17T00:00:00.000Z',
      })
    ).resolves.toBe(true);

    const querySql = collectSqlParts(dbRw.execute.mock.calls[0][0]).join(' ');

    expect(querySql).toContain('pg_advisory_xact_lock');
    expect(querySql).toContain('hashtextextended');
    expect(querySql).toContain('srv-1');
    expect(querySql).toContain(EWorkerType.baileys);
    expect(querySql).toContain('eligible_server');
    expect(querySql).toContain('server_status_id');
    expect(querySql).toContain('server_web');
    expect(querySql).toContain('active_web');
    expect(querySql).toContain('server_ssh');
    expect(querySql).toContain('active_ssh');
    expect(querySql).toContain(EWorkerWarmPoolState.warming);
    expect(querySql).toContain(EWorkerWarmPoolState.ready);
    expect(querySql).toContain(EWorkerWarmPoolState.reserved);
    expect(querySql).toContain(EWorkerWarmPoolState.activating);
    expect(querySql).toContain(EWorkerWarmPoolState.error);
    const activeCapacitySql = querySql.slice(
      querySql.indexOf('active_others'),
      querySql.indexOf('reclaimed')
    );
    expect(activeCapacitySql).not.toContain(EWorkerWarmPoolState.deleting);
    expect(activeCapacitySql).not.toContain(EWorkerWarmPoolState.error);
    expect(querySql).toContain('worker_runtime');
    expect(querySql).toContain('warm_pool_id');
    expect(querySql).toContain('container_id');
    expect(querySql).toContain('container_name');
    expect(querySql).toContain('session_volume_name');
    expect(querySql).toContain('2026-07-17T00:00:00.000Z');
    expect(querySql).toContain('ON CONFLICT');
  });

  it('allows two serialized replacements after two concurrent reservations', async () => {
    const dbRw = {
      execute: jest.fn(async (_query: unknown) => ({
        rows: [{ claimed: true }],
      })),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(
      Promise.all([
        repository.claimCapacityForReplenish({
          warmPoolId: '019f6f00-0000-7000-8000-000000000011',
          serverId: 'srv-1',
          workerTypeId: EWorkerType.baileys,
          sessionVolumeName: 'warm-019f6f00-0000-7000-8000-000000000011',
          target: 4,
          retryAfter: '2026-07-17T00:00:00.000Z',
        }),
        repository.claimCapacityForReplenish({
          warmPoolId: '019f6f00-0000-7000-8000-000000000012',
          serverId: 'srv-1',
          workerTypeId: EWorkerType.baileys,
          sessionVolumeName: 'warm-019f6f00-0000-7000-8000-000000000012',
          target: 4,
          retryAfter: '2026-07-17T00:00:00.000Z',
        }),
      ])
    ).resolves.toEqual([true, true]);

    expect(dbRw.execute).toHaveBeenCalledTimes(2);
    for (const [query] of dbRw.execute.mock.calls) {
      const querySql = collectSqlParts(query).join(' ');
      expect(querySql).toContain('pg_advisory_xact_lock');
      expect(querySql).toContain(EWorkerWarmPoolState.reserved);
      expect(querySql).toContain(EWorkerWarmPoolState.activating);
      const activeCapacitySql = querySql.slice(
        querySql.indexOf('active_others'),
        querySql.indexOf('reclaimed')
      );
      expect(activeCapacitySql).not.toContain(EWorkerWarmPoolState.deleting);
      expect(activeCapacitySql).not.toContain(EWorkerWarmPoolState.error);
    }
  });

  it('counts ready and warming capacity without expiring ready rows by health age', async () => {
    const dbRw = {
      execute: jest.fn(async (_query: unknown) => ({
        rows: [{ value: 4 }],
      })),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(
      repository.countAvailableByServerAndType('srv-1', EWorkerType.baileys)
    ).resolves.toBe(4);

    const whereSql = collectSqlParts(dbRw.execute.mock.calls[0][0]).join(' ');
    expect(whereSql).toContain(EWorkerWarmPoolState.warming);
    expect(whereSql).toContain(EWorkerWarmPoolState.ready);
    expect(whereSql).not.toContain('last_health_at');
    expect(whereSql).not.toContain(HEALTH_FRESH_AFTER);
    expect(whereSql).not.toContain(EWorkerWarmPoolState.reserved);
    expect(whereSql).not.toContain(EWorkerWarmPoolState.activating);
    expect(whereSql).toContain('worker_runtime');
    expect(whereSql).toContain('warm_pool_id');
    expect(whereSql).toContain('container_id');
    expect(whereSql).toContain('container_name');
    expect(whereSql).toContain('session_volume_name');
  });

  it('atomically fences a ready row before manual recreation', async () => {
    const claimed = {
      warm_pool_id: 'warm-manual',
      server_id: 'srv-1',
      worker_type_id: EWorkerType.wwebjs,
      session_volume_name: 'warm-manual',
      state: EWorkerWarmPoolState.deleting,
    };
    const dbRw = {
      execute: jest.fn(async (_query: unknown) => ({ rows: [claimed] })),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(
      repository.claimReadyForManualRecreate('warm-manual')
    ).resolves.toEqual(claimed);

    const querySql = collectSqlParts(dbRw.execute.mock.calls[0][0]).join(' ');
    expect(querySql).toContain(EWorkerWarmPoolState.ready);
    expect(querySql).toContain(EWorkerWarmPoolState.deleting);
    expect(querySql).toContain('warm_manual_recreate');
    expect(querySql).toContain('worker_runtime');
    expect(querySql).toContain('NOT EXISTS');
    expect(querySql).toContain('container_id');
    expect(querySql).toContain('container_name');
    expect(querySql).toContain('session_volume_name');
  });

  it('preserves the first warming observation while updating restart diagnostics', async () => {
    const marker = 'warm_runtime_starting:1000:9';
    const dbRw = {
      execute: jest.fn(async (_query: unknown) => ({
        rows: [{ last_error: marker }],
      })),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(
      repository.observeStartingRuntime({
        warmPoolId: 'warm-starting',
        expectedContainerId: 'a'.repeat(64),
        firstObservedAtMs: 2_000,
        restartCount: 9,
      })
    ).resolves.toBe(marker);

    const querySql = collectSqlParts(dbRw.execute.mock.calls[0][0]).join(' ');
    expect(querySql).toContain('warm_runtime_starting:2000:9');
    expect(querySql).toContain('split_part');
    expect(querySql).toContain('warm_runtime_starting:');
    expect(querySql).toContain(EWorkerWarmPoolState.warming);
    expect(querySql).toContain('worker_runtime');
    expect(querySql).toContain('NOT EXISTS');
  });

  it('renews only the exact unassigned healthy ready runtime lease', async () => {
    const dbRw = {
      execute: jest.fn(async (_query: unknown) => ({ rowCount: 1 })),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(
      repository.confirmHealthyReadyRuntime({
        warmPoolId: 'warm-recovered',
        expectedContainerId: 'b'.repeat(64),
      })
    ).resolves.toBe(true);

    const querySql = collectSqlParts(dbRw.execute.mock.calls[0][0]).join(' ');
    expect(querySql).toContain(EWorkerWarmPoolState.ready);
    expect(querySql).toContain('last_health_at');
    expect(querySql).toContain('worker_runtime');
  });

  it('reconciles a deleting tombstone to assigned using only durable runtime lineage', async () => {
    const dbRw = {
      execute: jest.fn(async (_query: unknown) => ({
        rows: [{ reconciled: true }],
      })),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(
      repository.reconcileDeletingRuntimeLineage('warm-lineage')
    ).resolves.toBe(true);

    const querySql = collectSqlParts(dbRw.execute.mock.calls[0][0]).join(' ');
    expect(querySql).toContain('FOR UPDATE');
    expect(querySql).toContain('worker_runtime');
    expect(querySql).toContain('runtime_match');
    expect(querySql).toContain(EWorkerWarmPoolState.deleting);
    expect(querySql).toContain(EWorkerWarmPoolState.assigned);
    expect(querySql).toContain('reserved_by_worker_id');
    expect(querySql).toContain('session_volume_name');
    expect(querySql).not.toContain('DELETE FROM');
  });

  it('releases a reserved row fail-closed when the activation image fence is unstable', async () => {
    const chain = createUpdateChain(1);
    const repository = new WorkerWarmPoolRepository(
      { update: chain.updateFn } as never,
      {} as never
    );

    await expect(
      repository.releaseReservedAfterHealthFence({
        warmPoolId: 'warm-retagged',
        reservedByWorkerId: 'worker-1',
        expectedContainerId: 'd'.repeat(64),
      })
    ).resolves.toBe(true);

    expect(chain.queryBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({
        state: EWorkerWarmPoolState.ready,
        reserved_by_worker_id: null,
        reservation_expires_at: null,
        last_health_at: null,
        last_error: 'warm_runtime_activation_health_fence_retry',
      })
    );
    const whereSql = collectSqlParts(
      chain.queryBuilder.where.mock.calls[0][0]
    ).join(' ');
    expect(whereSql).toContain(EWorkerWarmPoolState.reserved);
    expect(whereSql).toContain('warm-retagged');
    expect(whereSql).toContain('worker-1');
    expect(whereSql).toContain('d'.repeat(64));
  });

  it('does not claim replenish capacity when the target is zero', async () => {
    const dbRw = {
      execute: jest.fn(),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(
      repository.claimCapacityForReplenish({
        warmPoolId: '019f6f00-0000-7000-8000-000000000010',
        serverId: 'srv-1',
        workerTypeId: EWorkerType.baileys,
        sessionVolumeName: 'warm-019f6f00-0000-7000-8000-000000000010',
        target: 0,
        retryAfter: '2026-07-17T00:00:00.000Z',
      })
    ).resolves.toBe(false);

    expect(dbRw.execute).not.toHaveBeenCalled();
  });

  it('restores an excess deletion only while the warm row is still deleting', async () => {
    const chain = createUpdateChain(1);
    const repository = new WorkerWarmPoolRepository(
      { update: chain.updateFn } as never,
      {} as never
    );

    await expect(
      repository.restoreDeletingToReady('warm-excess-1')
    ).resolves.toBe(true);

    const setInput = chain.queryBuilder.set.mock.calls[0][0];
    const whereSql = collectSqlParts(
      chain.queryBuilder.where.mock.calls[0][0]
    ).join(' ');

    expect(setInput).toMatchObject({
      state: EWorkerWarmPoolState.ready,
      reserved_by_worker_id: null,
      reservation_expires_at: null,
      last_error: null,
    });
    expect(whereSql).toContain('warm-excess-1');
    expect(whereSql).toContain(EWorkerWarmPoolState.deleting);
  });
});

describe('WorkerWarmPoolRepository lifecycle CAS fencing', () => {
  it('finalizes creation and records errors only for the exact mutable claim', async () => {
    const ready = createUpdateChain(1);
    const error = createUpdateChain(0);
    const dbRw = {
      update: jest
        .fn()
        .mockImplementationOnce(ready.updateFn)
        .mockImplementationOnce(error.updateFn),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(
      repository.finalizeCreationReady({
        warmPoolId: 'warm-1',
        serverId: 'server-1',
        workerTypeId: EWorkerType.baileys,
        containerId: 'container-1',
        containerName: 'warm-warm-1',
        sessionVolumeName: 'warm-warm-1',
      })
    ).resolves.toBe(true);
    await expect(
      repository.recordCreationError({
        warmPoolId: 'warm-1',
        serverId: 'server-1',
        workerTypeId: EWorkerType.baileys,
        sessionVolumeName: 'warm-warm-1',
        error: 'failed',
      })
    ).resolves.toBe(false);

    const readyWhereSql = collectSqlParts(
      ready.queryBuilder.where.mock.calls[0][0]
    ).join(' ');
    const errorWhereSql = collectSqlParts(
      error.queryBuilder.where.mock.calls[0][0]
    ).join(' ');
    for (const whereSql of [readyWhereSql, errorWhereSql]) {
      expect(whereSql).toContain('warm-1');
      expect(whereSql).toContain('server-1');
      expect(whereSql).toContain(EWorkerType.baileys);
      expect(whereSql).toContain('warm-warm-1');
      expect(whereSql).toContain(EWorkerWarmPoolState.warming);
      expect(whereSql).toContain(EWorkerWarmPoolState.error);
      expect(whereSql).not.toContain(EWorkerWarmPoolState.deleting);
    }
    expect(errorWhereSql).not.toContain(EWorkerWarmPoolState.ready);
    expect(errorWhereSql).not.toContain(EWorkerWarmPoolState.reserved);
    expect(errorWhereSql).not.toContain(EWorkerWarmPoolState.activating);
    expect(errorWhereSql).not.toContain(EWorkerWarmPoolState.assigned);
  });

  it('fences activation cutover, assignment, rejection and rollback by exact owner and container', async () => {
    const assigned = createUpdateChain(1);
    const rejected = createUpdateChain(1);
    const extended = createUpdateChain(1);
    const began = createUpdateChain(1);
    const failed = createUpdateChain(1);
    const reverted = createUpdateChain(1);
    const dbRw = {
      update: jest
        .fn()
        .mockImplementationOnce(assigned.updateFn)
        .mockImplementationOnce(rejected.updateFn)
        .mockImplementationOnce(extended.updateFn)
        .mockImplementationOnce(began.updateFn)
        .mockImplementationOnce(failed.updateFn)
        .mockImplementationOnce(reverted.updateFn),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(
      repository.markAssigned({
        warmPoolId: 'warm-1',
        reservedByWorkerId: 'worker-1',
        expectedContainerId: 'warm-container-1',
        assignedContainerId: 'worker-container-1',
        assignedContainerName: 'worker-1',
      })
    ).resolves.toBe(true);
    await expect(
      repository.rejectActivation({
        warmPoolId: 'warm-1',
        reservedByWorkerId: 'worker-1',
        error: 'invalid',
      })
    ).resolves.toBe(true);
    await expect(
      repository.extendActivationReservation({
        warmPoolId: 'warm-1',
        reservedByWorkerId: 'worker-1',
        reservationExpiresAt: '2026-07-28T12:00:00.000Z',
      })
    ).resolves.toBe(true);
    await expect(
      repository.beginActivation({
        warmPoolId: 'warm-1',
        reservedByWorkerId: 'worker-1',
        expectedContainerId: 'warm-container-1',
      })
    ).resolves.toBe(true);
    await expect(
      repository.failActivatingActivation({
        warmPoolId: 'warm-1',
        reservedByWorkerId: 'worker-1',
        expectedSourceContainerId: 'warm-container-1',
        error: 'replacement failed',
      })
    ).resolves.toBe(true);
    await expect(
      repository.revertAssignedActivation({
        warmPoolId: 'warm-1',
        reservedByWorkerId: 'worker-1',
        containerId: 'container-1',
        error: 'worker update failed',
      })
    ).resolves.toBe(true);

    for (const chain of [rejected, extended, began]) {
      const whereSql = collectSqlParts(
        chain.queryBuilder.where.mock.calls[0][0]
      ).join(' ');
      expect(whereSql).toContain('warm-1');
      expect(whereSql).toContain('worker-1');
      expect(whereSql).toContain(EWorkerWarmPoolState.reserved);
      expect(whereSql).not.toContain(EWorkerWarmPoolState.deleting);
    }
    const assignSql = collectSqlParts(
      assigned.queryBuilder.where.mock.calls[0][0]
    ).join(' ');
    expect(assignSql).toContain(EWorkerWarmPoolState.activating);
    expect(assignSql).toContain('warm-container-1');
    expect(assigned.queryBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({
        state: EWorkerWarmPoolState.assigned,
        container_id: 'worker-container-1',
        container_name: 'worker-1',
      })
    );
    const failSql = collectSqlParts(
      failed.queryBuilder.where.mock.calls[0][0]
    ).join(' ');
    expect(failSql).toContain(EWorkerWarmPoolState.activating);
    expect(failSql).toContain('warm-container-1');
    expect(failed.queryBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({
        state: EWorkerWarmPoolState.error,
        container_id: null,
        container_name: null,
        reserved_by_worker_id: null,
      })
    );
    const revertSql = collectSqlParts(
      reverted.queryBuilder.where.mock.calls[0][0]
    ).join(' ');
    expect(revertSql).toContain(EWorkerWarmPoolState.assigned);
    expect(revertSql).toContain('worker-1');
    expect(revertSql).toContain('container-1');
    expect(reverted.queryBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({
        state: EWorkerWarmPoolState.error,
        container_id: null,
        container_name: null,
        reserved_by_worker_id: null,
        reservation_expires_at: null,
      })
    );
  });

  it('deletes only rows already fenced as deleting tombstones', async () => {
    const deleted = createDeleteChain(1);
    const repository = new WorkerWarmPoolRepository(
      {
        delete: deleted.deleteFn,
      } as never,
      {} as never
    );

    await expect(repository.deleteById('warm-1')).resolves.toBe(true);

    const deleteSql = collectSqlParts(
      deleted.queryBuilder.where.mock.calls[0][0]
    ).join(' ');
    expect(deleteSql).toContain('warm-1');
    expect(deleteSql).toContain(EWorkerWarmPoolState.deleting);
  });

  it('releases only expired reserved rows with no worker runtime lineage', async () => {
    const released = createUpdateChain(1);
    const subquery = {
      from: jest.fn(),
      where: jest.fn(),
    } as any;
    subquery.from.mockReturnValue(subquery);
    subquery.where.mockReturnValue(subquery);
    const repository = new WorkerWarmPoolRepository(
      {
        update: released.updateFn,
        select: jest.fn(() => subquery),
      } as never,
      {} as never
    );

    await expect(
      repository.releaseExpiredReservations('2026-07-28T12:00:00.000Z')
    ).resolves.toBe(1);

    const whereSql = collectSqlParts(
      released.queryBuilder.where.mock.calls[0][0]
    )
      .join(' ')
      .toLowerCase();
    expect(whereSql).toContain(EWorkerWarmPoolState.reserved);
    expect(whereSql).not.toContain(EWorkerWarmPoolState.activating);
    expect(whereSql).toContain('not exists');
    expect(subquery.from).toHaveBeenCalledWith(workerRuntime);
    expect(whereSql).toContain('warm_pool_id');
    expect(whereSql).toContain('container_id');
    expect(whereSql).toContain('container_name');
    expect(whereSql).toContain('session_volume_name');
    expect(released.queryBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({
        last_health_at: null,
        last_error: 'warm_runtime_reservation_expired_reprobe',
      })
    );
  });

  it('restores a pre-generation activation only when its exact standby has no runtime lineage', async () => {
    const restored = createUpdateChain(1);
    const subquery = {
      from: jest.fn(),
      where: jest.fn(),
    } as any;
    subquery.from.mockReturnValue(subquery);
    subquery.where.mockReturnValue(subquery);
    const repository = new WorkerWarmPoolRepository(
      {
        update: restored.updateFn,
        select: jest.fn(() => subquery),
      } as never,
      {} as never
    );

    await expect(
      repository.restorePreGenerationActivationToReady({
        warmPoolId: 'warm-1',
        serverId: 'server-1',
        workerTypeId: EWorkerType.baileys,
        reservedByWorkerId: 'worker-1',
        expectedSourceContainerId: 'warm-container-1',
        expectedSourceContainerName: 'warm-warm-1',
        sessionVolumeName: 'warm-warm-1',
      })
    ).resolves.toBe(true);

    expect(restored.queryBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({
        state: EWorkerWarmPoolState.ready,
        reserved_by_worker_id: null,
        reservation_expires_at: null,
        last_health_at: null,
        last_error: null,
      })
    );
    const whereSql = collectSqlParts(
      restored.queryBuilder.where.mock.calls[0][0]
    )
      .join(' ')
      .toLowerCase();
    expect(whereSql).toContain(EWorkerWarmPoolState.activating);
    expect(whereSql).toContain('warm-1');
    expect(whereSql).toContain('server-1');
    expect(whereSql).toContain(EWorkerType.baileys);
    expect(whereSql).toContain('worker-1');
    expect(whereSql).toContain('warm-container-1');
    expect(whereSql).toContain('warm-warm-1');
    expect(whereSql).toContain('not exists');
    expect(subquery.from).toHaveBeenCalledWith(workerRuntime);
    expect(whereSql).toContain('warm_pool_id');
    expect(whereSql).toContain('container_id');
    expect(whereSql).toContain('container_name');
    expect(whereSql).toContain('session_volume_name');
  });

  it('never reserves legacy-volume warm rows', async () => {
    const dbRw = { transaction: jest.fn() };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(
      repository.reserveReady(
        'server-1',
        EWorkerType.baileys,
        'worker-1',
        '2026-08-01T12:00:00.000Z',
        HEALTH_FRESH_AFTER,
        EWorkerSessionStorage.legacy_volume
      )
    ).resolves.toBeNull();

    expect(dbRw.transaction).not.toHaveBeenCalled();
  });

  it('counts only PostgreSQL capacity with no session volume', async () => {
    const dbRw = {
      execute: jest.fn(async (_query: unknown) => ({ rows: [{ value: 2 }] })),
    };
    const repository = new WorkerWarmPoolRepository(dbRw as never, {} as never);

    await expect(
      repository.countAvailableByServerAndType('server-1', EWorkerType.baileys)
    ).resolves.toBe(2);

    const querySql = collectSqlParts(dbRw.execute.mock.calls[0][0]).join(' ');
    expect(querySql).toContain(EWorkerSessionStorage.postgres);
    expect(querySql).toContain('session_volume_name');
    expect(querySql).toContain('IS NULL');
  });
});
