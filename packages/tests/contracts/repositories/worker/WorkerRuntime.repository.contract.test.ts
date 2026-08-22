import 'reflect-metadata';
import {
  STALE_WHATSAPP_PROVIDER_HANDOFF_TARGET_ERROR_CODE,
  StaleWorkerRuntimeGenerationError,
  WorkerRuntimeRepository,
} from '@core/repositories/worker/WorkerRuntime.repository';
import { currentTime } from '@core/common/functions/currentTime';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

function createInsertChain(result: unknown[]) {
  const queryBuilder = {
    values: jest.fn(),
    onConflictDoUpdate: jest.fn(),
    returning: jest.fn(),
    execute: jest.fn(async () => result),
  } as any;
  queryBuilder.values.mockReturnValue(queryBuilder);
  queryBuilder.onConflictDoUpdate.mockReturnValue(queryBuilder);
  queryBuilder.returning.mockReturnValue(queryBuilder);

  return {
    insert: jest.fn(() => queryBuilder),
    queryBuilder,
  };
}

function createSelectChain(result: unknown[]) {
  const queryBuilder = {
    from: jest.fn(),
    where: jest.fn(),
    limit: jest.fn(),
    execute: jest.fn(async () => result),
  } as any;
  queryBuilder.from.mockReturnValue(queryBuilder);
  queryBuilder.where.mockReturnValue(queryBuilder);
  queryBuilder.limit.mockReturnValue(queryBuilder);

  return {
    select: jest.fn(() => queryBuilder),
    queryBuilder,
  };
}

function createUpdateChain(rowCount: number) {
  const queryBuilder = {
    set: jest.fn(),
    where: jest.fn(),
    execute: jest.fn(async () => ({ rowCount })),
  } as any;
  queryBuilder.set.mockReturnValue(queryBuilder);
  queryBuilder.where.mockReturnValue(queryBuilder);

  return {
    update: jest.fn(() => queryBuilder),
    queryBuilder,
  };
}

function createHealthyRuntimeReconcileDatabase(input: {
  rowCount: number;
  workerId?: string;
  workerLockPresent?: boolean;
  runtimeLockPresent?: boolean;
}) {
  const workerId = input.workerId ?? 'worker-1';
  const updateChain = createUpdateChain(input.rowCount);
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const events: string[] = [];
  const dialect = new PgDialect();
  const execute = jest.fn(async (query: SQL) => {
    const compiled = dialect.sqlToQuery(query);
    statements.push({ sql: compiled.sql, params: compiled.params });
    if (compiled.sql.includes('FROM public.worker AS owner')) {
      events.push('worker_lock');
      return {
        rows:
          input.workerLockPresent === false ? [] : [{ worker_id: workerId }],
      };
    }
    if (compiled.sql.includes('FROM public.worker_runtime AS runtime')) {
      events.push('runtime_lock');
      return {
        rows:
          input.runtimeLockPresent === false ? [] : [{ worker_id: workerId }],
      };
    }
    return { rows: [] };
  });
  const update = jest.fn((_table?: unknown) => {
    events.push('update');
    return updateChain.update();
  });
  const transaction = jest.fn(
    async (
      operation: (tx: {
        execute: typeof execute;
        update: typeof update;
      }) => Promise<unknown>
    ) => operation({ execute, update })
  );

  return {
    database: { transaction },
    updateChain,
    statements,
    events,
    execute,
    transaction,
  };
}

function createWhatsappSessionDeleteDatabase(input: {
  workerRows?: Array<Record<string, unknown>>;
  runtimeRows?: Array<Record<string, unknown>>;
}) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const dialect = new PgDialect();
  const execute = jest.fn(async (query: SQL) => {
    const compiled = dialect.sqlToQuery(query);
    statements.push({ sql: compiled.sql, params: compiled.params });
    if (
      compiled.sql.includes('FROM "worker"') &&
      !compiled.sql.includes('FROM "worker_runtime"')
    ) {
      return { rows: input.workerRows ?? [] };
    }
    if (compiled.sql.includes('FROM "worker_runtime"')) {
      return { rows: input.runtimeRows ?? [] };
    }
    return { rows: [], rowCount: 0 };
  });
  const transaction = jest.fn(
    async (operation: (tx: { execute: typeof execute }) => Promise<unknown>) =>
      operation({ execute })
  );

  return { database: { transaction }, execute, statements, transaction };
}

function createLivenessRuntimeRevokeDatabase(input: {
  workerRow: Record<string, unknown>;
  runtimeRow: Record<string, unknown>;
  leaseRow?: Record<string, unknown>;
  sessionRow?: Record<string, unknown>;
  updateRowCounts?: Partial<Record<'lease' | 'session' | 'runtime', number>>;
}) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  let rolledBack = false;
  const dialect = new PgDialect();
  const execute = jest.fn(async (query: SQL) => {
    const compiled = dialect.sqlToQuery(query);
    statements.push({ sql: compiled.sql, params: compiled.params });
    if (
      compiled.sql.includes('FROM "worker"') &&
      !compiled.sql.includes('FROM "worker_runtime"')
    ) {
      return { rows: [input.workerRow] };
    }
    if (compiled.sql.includes('FROM "worker_runtime"')) {
      return { rows: [input.runtimeRow] };
    }
    if (compiled.sql.includes('FROM "whatsapp_session_lease"')) {
      return { rows: input.leaseRow ? [input.leaseRow] : [] };
    }
    if (compiled.sql.includes('FROM "whatsapp_session"')) {
      return { rows: input.sessionRow ? [input.sessionRow] : [] };
    }
    if (compiled.sql.includes('UPDATE "whatsapp_session_lease"')) {
      return { rows: [], rowCount: input.updateRowCounts?.lease ?? 1 };
    }
    if (compiled.sql.includes('UPDATE "whatsapp_session"')) {
      return { rows: [], rowCount: input.updateRowCounts?.session ?? 1 };
    }
    if (compiled.sql.includes('UPDATE "worker_runtime"')) {
      return { rows: [], rowCount: input.updateRowCounts?.runtime ?? 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const transaction = jest.fn(
    async (
      operation: (tx: { execute: typeof execute }) => Promise<unknown>
    ) => {
      try {
        return await operation({ execute });
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    }
  );

  return {
    database: { transaction },
    statements,
    transaction,
    wasRolledBack: () => rolledBack,
  };
}

const livenessRevokeInput = {
  worker_id: '00000000-0000-4000-8000-000000000001',
  account_id: '00000000-0000-4000-8000-000000000002',
  server_id: '00000000-0000-4000-8000-000000000003',
  worker_type_id: EWorkerType.wwebjs,
  lifecycle_operation_id: '00000000-0000-4000-8000-000000000004',
  expected_old_container_id: 'a'.repeat(64),
  expected_old_runtime_generation: 7,
  failed_container_id: 'b'.repeat(64),
  failed_runtime_generation: 9,
};

const livenessRevokeWorkerRow = (sessionStorage: EWorkerSessionStorage) => ({
  worker_id: livenessRevokeInput.worker_id,
  account_id: livenessRevokeInput.account_id,
  server_id: livenessRevokeInput.server_id,
  worker_type_id: EWorkerType.wwebjs,
  worker_status_id: EWorkerStatus.recreating,
  session_storage: sessionStorage,
  lifecycle_operation_id: livenessRevokeInput.lifecycle_operation_id,
  container_id: livenessRevokeInput.expected_old_container_id,
  deleted_at: null,
});

const livenessRevokeRuntimeRow = (
  sessionStorage: EWorkerSessionStorage,
  overrides: Record<string, unknown> = {}
) => ({
  container_id: livenessRevokeInput.failed_container_id,
  runtime_generation: livenessRevokeInput.failed_runtime_generation,
  session_storage: sessionStorage,
  runtime_capability_hash: 'c'.repeat(64),
  session_writer_epoch: '00000000-0000-4000-8000-000000000005',
  connection_epoch: '00000000-0000-4000-8000-000000000006',
  connection_sequence: 12,
  source_provider: 'wwebjs',
  connection_activated_at: '2026-08-08T12:00:00.000Z',
  recreate_bootstrap_operation_id: livenessRevokeInput.lifecycle_operation_id,
  recreate_bootstrap_runtime_generation:
    livenessRevokeInput.failed_runtime_generation,
  recreate_bootstrap_container_id: livenessRevokeInput.failed_container_id,
  recreate_bootstrap_started_at: '2026-08-08T11:59:00.000Z',
  native_connection_status_lease_owner_id: null,
  native_connection_status_fencing_token: null,
  ...overrides,
});

const postgresSessionDeleteWorker = (
  overrides: Record<string, unknown> = {}
) => ({
  account_id: 'account-1',
  lifecycle_operation_id: 'operation-1',
  worker_status_id: EWorkerStatus.recreating,
  session_storage: EWorkerSessionStorage.postgres,
  deleted_at: null,
  ...overrides,
});

const postgresSessionDeleteRuntime = (
  overrides: Record<string, unknown> = {}
) => ({
  session_storage: EWorkerSessionStorage.postgres,
  runtime_generation: 7,
  container_id: 'container-7',
  ...overrides,
});

const postgresSessionDeleteInput = (
  overrides: Record<string, unknown> = {}
) => ({
  worker_id: 'worker-1',
  account_id: 'account-1',
  lifecycle_operation_id: 'operation-1',
  expected_worker_status_id: EWorkerStatus.recreating,
  expected_runtime_generation: 7,
  expected_container_id: 'container-7',
  ...overrides,
});

describe('WorkerRuntimeRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (currentTime as jest.Mock).mockReturnValue('2026-07-15T18:30:00.000Z');
  });

  it('reads fencing state from the primary database when consistency is required', async () => {
    const runtime = {
      worker_id: 'worker-1',
      runtime_generation: 9,
      session_volume_name: 'worker-volume-1',
    };
    const primary = createSelectChain([runtime]);
    const replica = createSelectChain([]);
    const repository = new WorkerRuntimeRepository(
      { select: primary.select } as never,
      { select: replica.select } as never
    );

    await expect(
      repository.viewByWorkerIdConsistent('worker-1')
    ).resolves.toEqual(runtime);

    expect(primary.select).toHaveBeenCalledTimes(1);
    expect(replica.select).not.toHaveBeenCalled();
  });

  it('proves a recreated unavailable native terminal only from the primary and exact lifecycle fences', async () => {
    const changedAt = '2026-08-16T03:35:10.281Z';
    const connectionStatus = {
      provider: 'wwebjs',
      status: 'error',
      connected: false,
      authenticated: false,
      sessionValid: null,
      recoverable: false,
      qrAvailable: false,
      sequence: 4,
      changedAt,
      reason: 'initialization_failed',
    };
    const execute = jest.fn(async (_query: SQL) => ({
      rows: [
        {
          container_id: 'd'.repeat(64),
          connection_status: connectionStatus,
          connection_status_source_id: '019ff621-c377-71b4-b030-20f554363868',
          connection_status_sequence: '4',
          connection_status_changed_at: changedAt,
        },
      ],
    }));
    const repository = new WorkerRuntimeRepository(
      { execute } as never,
      { execute: jest.fn() } as never
    );
    const input = {
      worker_id: '00000000-0000-4000-8000-000000000001',
      account_id: '00000000-0000-4000-8000-000000000002',
      server_id: '00000000-0000-4000-8000-000000000003',
      worker_type_id: EWorkerType.wwebjs,
      lifecycle_operation_id: '00000000-0000-4000-8000-000000000004',
      runtime_generation: 73,
    };

    await expect(
      repository.viewRecreatedWorkerUnavailableNativeTerminalProof(input)
    ).resolves.toEqual({
      container_id: 'd'.repeat(64),
      connection_status: connectionStatus,
      connection_status_source_id: '019ff621-c377-71b4-b030-20f554363868',
      connection_status_sequence: 4,
      connection_status_changed_at: changedAt,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const compiled = new PgDialect().sqlToQuery(
      execute.mock.calls[0][0] as SQL
    );
    const normalizedSql = compiled.sql.replace(/\s+/gu, ' ').trim();
    expect(normalizedSql).toContain(
      'worker.worker_status_id = $5::uuid AND worker.lifecycle_operation_id = $6::uuid'
    );
    expect(normalizedSql).toContain(
      'runtime.recreate_bootstrap_operation_id = $9::uuid'
    );
    expect(normalizedSql).toContain(
      'runtime.native_connection_status_changed_at_high_watermark >= runtime.recreate_bootstrap_started_at'
    );
    expect(normalizedSql).toContain(
      'NOT runtime.native_connection_online_acknowledged'
    );
    expect(normalizedSql).toContain("'logged_out', 'invalid_session'");
    expect(normalizedSql).toContain("'recoverable' = 'false'::jsonb");
    expect(compiled.params).toEqual([
      input.worker_id,
      input.account_id,
      input.server_id,
      input.worker_type_id,
      EWorkerStatus.recreating,
      input.lifecycle_operation_id,
      input.runtime_generation,
      'wwebjs',
      input.lifecycle_operation_id,
      input.runtime_generation,
      'wwebjs',
      'wwebjs',
    ]);
  });

  it.each([
    { connection_status_sequence: '0' },
    { connection_status_sequence: '9007199254740992' },
    { connection_status_sequence: '4', connection_status: null },
  ])(
    'fails closed when a recreated unavailable native terminal row is malformed: %j',
    async (row) => {
      const execute = jest.fn(async (_query: SQL) => {
        const resultRow = {
          container_id: 'd'.repeat(64),
          connection_status: {
            provider: 'wwebjs',
            status: 'error',
            connected: false,
            authenticated: false,
            sessionValid: null,
            recoverable: false,
            qrAvailable: false,
            sequence: 4,
            changedAt: '2026-08-16T03:35:10.281Z',
          },
          connection_status_source_id: '019ff621-c377-71b4-b030-20f554363868',
          connection_status_sequence: '4',
          connection_status_changed_at: '2026-08-16T03:35:10.281Z',
        };
        Object.assign(resultRow, row);
        return { rows: [resultRow] };
      });
      const repository = new WorkerRuntimeRepository(
        { execute } as never,
        {} as never
      );

      await expect(
        repository.viewRecreatedWorkerUnavailableNativeTerminalProof({
          worker_id: '00000000-0000-4000-8000-000000000001',
          account_id: '00000000-0000-4000-8000-000000000002',
          server_id: '00000000-0000-4000-8000-000000000003',
          worker_type_id: EWorkerType.wwebjs,
          lifecycle_operation_id: '00000000-0000-4000-8000-000000000004',
          runtime_generation: 73,
        })
      ).resolves.toBeNull();
    }
  );

  it('marks recreate bootstrap through the exact manager-owned PostgreSQL capability', async () => {
    const execute = jest.fn(async (_query: SQL) => ({
      rows: [{ marked: true }],
    }));
    const repository = new WorkerRuntimeRepository(
      { execute } as never,
      {} as never
    );
    const input = {
      worker_id: '00000000-0000-4000-8000-000000000001',
      account_id: '00000000-0000-4000-8000-000000000002',
      server_id: '00000000-0000-4000-8000-000000000003',
      lifecycle_operation_id: '00000000-0000-4000-8000-000000000004',
      runtime_generation: 16,
      container_id: 'b'.repeat(64),
    };

    await expect(repository.markRecreateBootstrapStarted(input)).resolves.toBe(
      true
    );

    expect(execute).toHaveBeenCalledTimes(1);
    const compiled = new PgDialect().sqlToQuery(
      execute.mock.calls[0][0] as SQL
    );
    expect(compiled.sql.replace(/\s+/gu, ' ').trim()).toBe(
      'SELECT public.mark_worker_recreate_bootstrap_started( $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::integer, $6::text ) AS marked'
    );
    expect(compiled.params).toEqual([
      input.worker_id,
      input.account_id,
      input.server_id,
      input.lifecycle_operation_id,
      input.runtime_generation,
      input.container_id,
    ]);
  });

  it.each([{ rows: [{ marked: false }] }, { rows: [] }, {}])(
    'fails closed when bootstrap marking is not exactly true: %j',
    async (result) => {
      const execute = jest.fn(async (_query: SQL) => result);
      const repository = new WorkerRuntimeRepository(
        { execute } as never,
        {} as never
      );

      await expect(
        repository.markRecreateBootstrapStarted({
          worker_id: '00000000-0000-4000-8000-000000000001',
          account_id: '00000000-0000-4000-8000-000000000002',
          server_id: '00000000-0000-4000-8000-000000000003',
          lifecycle_operation_id: '00000000-0000-4000-8000-000000000004',
          runtime_generation: 16,
          container_id: 'b'.repeat(64),
        })
      ).resolves.toBe(false);
    }
  );

  it('revokes an activated PostgreSQL replacement under worker -> runtime -> lease -> session locks without trusting the native ACK mirror', async () => {
    const epoch = '00000000-0000-4000-8000-000000000005';
    const ownerId = '00000000-0000-4000-8000-000000000007';
    const fixture = createLivenessRuntimeRevokeDatabase({
      workerRow: livenessRevokeWorkerRow(EWorkerSessionStorage.postgres),
      runtimeRow: livenessRevokeRuntimeRow(EWorkerSessionStorage.postgres),
      leaseRow: {
        owner_id: ownerId,
        provider: 'wwebjs',
        fencing_token: '41',
        generation: 9,
        epoch,
        acquired_at: '2026-08-08T12:00:00.000Z',
        heartbeat_at: '2026-08-08T12:00:01.000Z',
        expires_at: '2026-08-08T12:01:00.000Z',
      },
      sessionRow: {
        provider: 'wwebjs',
        generation: 9,
        epoch,
        capability_hash: 'c'.repeat(64),
      },
    });
    const repository = new WorkerRuntimeRepository(
      fixture.database as never,
      {} as never
    );

    await expect(
      repository.revokeFailedOnlineLivenessReplacementRuntime(
        livenessRevokeInput
      )
    ).resolves.toBe(true);

    const sql = fixture.statements.map((statement) => statement.sql);
    const workerLock = sql.findIndex((statement) =>
      statement.includes('FROM "worker"')
    );
    const runtimeLock = sql.findIndex((statement) =>
      statement.includes('FROM "worker_runtime"')
    );
    const leaseLock = sql.findIndex((statement) =>
      statement.includes('FROM "whatsapp_session_lease"')
    );
    const sessionLock = sql.findIndex((statement) =>
      statement.includes('FROM "whatsapp_session"')
    );
    const leaseUpdate = sql.findIndex(
      (statement) =>
        statement.includes('UPDATE "whatsapp_session_lease"') &&
        statement.includes('"fencing_token" = "fencing_token" + 1')
    );
    const sessionUpdate = sql.findIndex((statement) =>
      statement.includes('UPDATE "whatsapp_session"')
    );
    const runtimeUpdate = sql.findIndex((statement) =>
      statement.includes('UPDATE "worker_runtime"')
    );
    expect(workerLock).toBeGreaterThanOrEqual(0);
    expect(runtimeLock).toBeGreaterThan(workerLock);
    expect(leaseLock).toBeGreaterThan(runtimeLock);
    expect(sessionLock).toBeGreaterThan(leaseLock);
    expect(leaseUpdate).toBeGreaterThan(sessionLock);
    expect(sessionUpdate).toBeGreaterThan(leaseUpdate);
    expect(runtimeUpdate).toBeGreaterThan(sessionUpdate);
    expect(sql[runtimeUpdate]).toContain(
      '"recreate_bootstrap_started_at" + interval \'1 millisecond\''
    );
    expect(fixture.statements[leaseUpdate]?.params).toEqual(
      expect.arrayContaining([ownerId, 'wwebjs', '41', 9, epoch])
    );
  });

  it.each([
    {
      failedUpdate: 'session',
      updateRowCounts: { session: 0 },
      reachesRuntimeUpdate: false,
    },
    {
      failedUpdate: 'runtime',
      updateRowCounts: { runtime: 0 },
      reachesRuntimeUpdate: true,
    },
  ] as const)(
    'rolls the transaction back when the $failedUpdate CAS fails after an earlier retirement write',
    async ({ updateRowCounts, reachesRuntimeUpdate }) => {
      const epoch = '00000000-0000-4000-8000-000000000005';
      const fixture = createLivenessRuntimeRevokeDatabase({
        workerRow: livenessRevokeWorkerRow(EWorkerSessionStorage.postgres),
        runtimeRow: livenessRevokeRuntimeRow(EWorkerSessionStorage.postgres),
        leaseRow: {
          owner_id: '00000000-0000-4000-8000-000000000007',
          provider: 'wwebjs',
          fencing_token: '41',
          generation: 9,
          epoch,
          acquired_at: '2026-08-08T12:00:00.000Z',
          heartbeat_at: '2026-08-08T12:00:01.000Z',
          expires_at: '2026-08-08T12:01:00.000Z',
        },
        sessionRow: {
          provider: 'wwebjs',
          generation: 9,
          epoch,
          capability_hash: 'c'.repeat(64),
        },
        updateRowCounts,
      });
      const repository = new WorkerRuntimeRepository(
        fixture.database as never,
        {} as never
      );

      await expect(
        repository.revokeFailedOnlineLivenessReplacementRuntime(
          livenessRevokeInput
        )
      ).resolves.toBe(false);

      expect(fixture.wasRolledBack()).toBe(true);
      expect(
        fixture.statements.some((statement) =>
          statement.sql.includes('UPDATE "worker_runtime"')
        )
      ).toBe(reachesRuntimeUpdate);
    }
  );

  it('revokes an intermediate old PostgreSQL writer while the failed target remains pre-activation', async () => {
    const fixture = createLivenessRuntimeRevokeDatabase({
      workerRow: livenessRevokeWorkerRow(EWorkerSessionStorage.postgres),
      runtimeRow: livenessRevokeRuntimeRow(EWorkerSessionStorage.postgres, {
        connection_epoch: null,
        source_provider: null,
        connection_activated_at: null,
        recreate_bootstrap_operation_id: null,
        recreate_bootstrap_runtime_generation: null,
        recreate_bootstrap_container_id: null,
        recreate_bootstrap_started_at: null,
      }),
      leaseRow: {
        owner_id: '00000000-0000-4000-8000-000000000007',
        provider: 'wwebjs',
        fencing_token: '17',
        generation: 7,
        epoch: '00000000-0000-4000-8000-000000000008',
        acquired_at: '2026-08-08T11:00:00.000Z',
        heartbeat_at: '2026-08-08T11:00:01.000Z',
        expires_at: '2026-08-08T12:01:00.000Z',
      },
      sessionRow: {
        provider: 'wwebjs',
        generation: 8,
        epoch: '00000000-0000-4000-8000-000000000009',
        capability_hash: 'd'.repeat(64),
      },
    });
    const repository = new WorkerRuntimeRepository(
      fixture.database as never,
      {} as never
    );

    await expect(
      repository.revokeFailedOnlineLivenessReplacementRuntime(
        livenessRevokeInput
      )
    ).resolves.toBe(true);

    const leaseUpdate = fixture.statements.find((statement) =>
      statement.sql.includes('UPDATE "whatsapp_session_lease"')
    );
    expect(leaseUpdate?.params).toEqual(expect.arrayContaining(['17', 7]));
    expect(
      fixture.statements.some((statement) =>
        statement.sql.includes('UPDATE "whatsapp_session"')
      )
    ).toBe(true);
  });

  it('replays a fully released PostgreSQL retirement without bumping its lease token again', async () => {
    const fixture = createLivenessRuntimeRevokeDatabase({
      workerRow: livenessRevokeWorkerRow(EWorkerSessionStorage.postgres),
      runtimeRow: livenessRevokeRuntimeRow(EWorkerSessionStorage.postgres, {
        runtime_capability_hash: null,
        session_writer_epoch: null,
        connection_epoch: null,
        connection_sequence: 0,
        source_provider: null,
        connection_activated_at: null,
        recreate_bootstrap_operation_id: null,
        recreate_bootstrap_runtime_generation: null,
        recreate_bootstrap_container_id: null,
        recreate_bootstrap_started_at: null,
        recreate_retired_operation_id:
          livenessRevokeInput.lifecycle_operation_id,
        recreate_retired_runtime_generation:
          livenessRevokeInput.failed_runtime_generation,
        recreate_retired_container_id: livenessRevokeInput.failed_container_id,
        recreate_retired_at: '2026-08-08T12:00:02.000Z',
      }),
      leaseRow: {
        owner_id: null,
        provider: null,
        fencing_token: '42',
        generation: 8,
        epoch: null,
        acquired_at: null,
        heartbeat_at: null,
        expires_at: null,
      },
      sessionRow: {
        provider: 'wwebjs',
        generation: 8,
        epoch: null,
        capability_hash: null,
      },
    });
    const repository = new WorkerRuntimeRepository(
      fixture.database as never,
      {} as never
    );

    await expect(
      repository.revokeFailedOnlineLivenessReplacementRuntime(
        livenessRevokeInput
      )
    ).resolves.toBe(true);

    expect(
      fixture.statements.filter((statement) =>
        statement.sql.trimStart().startsWith('UPDATE')
      )
    ).toHaveLength(0);
  });

  it('rejects a PostgreSQL lease generation ahead of its session header', async () => {
    const epoch = '00000000-0000-4000-8000-000000000005';
    const fixture = createLivenessRuntimeRevokeDatabase({
      workerRow: livenessRevokeWorkerRow(EWorkerSessionStorage.postgres),
      runtimeRow: livenessRevokeRuntimeRow(EWorkerSessionStorage.postgres),
      leaseRow: {
        owner_id: '00000000-0000-4000-8000-000000000007',
        provider: 'wwebjs',
        fencing_token: '41',
        generation: 9,
        epoch,
        acquired_at: '2026-08-08T12:00:00.000Z',
        heartbeat_at: '2026-08-08T12:00:01.000Z',
        expires_at: '2026-08-08T12:01:00.000Z',
      },
      sessionRow: {
        provider: 'wwebjs',
        generation: 8,
        epoch: '00000000-0000-4000-8000-000000000008',
        capability_hash: 'd'.repeat(64),
      },
    });
    const repository = new WorkerRuntimeRepository(
      fixture.database as never,
      {} as never
    );

    await expect(
      repository.revokeFailedOnlineLivenessReplacementRuntime(
        livenessRevokeInput
      )
    ).resolves.toBe(false);
    expect(
      fixture.statements.some((statement) =>
        statement.sql.trimStart().startsWith('UPDATE')
      )
    ).toBe(false);
  });

  it('revokes a legacy runtime without accessing PostgreSQL session tables', async () => {
    const fixture = createLivenessRuntimeRevokeDatabase({
      workerRow: livenessRevokeWorkerRow(EWorkerSessionStorage.legacy_volume),
      runtimeRow: livenessRevokeRuntimeRow(EWorkerSessionStorage.legacy_volume),
    });
    const repository = new WorkerRuntimeRepository(
      fixture.database as never,
      {} as never
    );

    await expect(
      repository.revokeFailedOnlineLivenessReplacementRuntime(
        livenessRevokeInput
      )
    ).resolves.toBe(true);

    expect(
      fixture.statements.some((statement) =>
        statement.sql.includes('whatsapp_session')
      )
    ).toBe(false);
  });

  it('returns only bounded account-scoped outbox evidence from the primary database', async () => {
    const evidence = {
      after_order: '40',
      observed_through_order: '44',
      first_window_order: '41',
      last_window_order: '44',
      window_event_count: 4,
      operation_event_count: 1,
      trace_event_count: 3,
      correlated_event_count: 3,
      pending_event_count: 0,
      dead_letter_event_count: 0,
      qr_event_count: 0,
      pairing_event_count: 0,
      passkey_event_count: 0,
      interactive_login_event_count: 0,
      interactive_login_detected: false,
      window_limit: 10_000,
      window_truncated: false,
    };
    const primaryExecute = jest.fn(async (_query: SQL) => ({
      rows: [
        {
          ...evidence,
          payload: { qrcode: 'must-never-cross-repository-boundary' },
          phone: 'must-never-cross-repository-boundary',
        },
      ],
    }));
    const replicaExecute = jest.fn(async (_query: SQL) => ({ rows: [] }));
    const repository = new WorkerRuntimeRepository(
      { execute: primaryExecute } as never,
      { execute: replicaExecute } as never
    );

    await expect(
      repository.viewWhatsappProviderHandoffOutboxEvidence({
        worker_id: '00000000-0000-4000-8000-000000000001',
        account_id: '00000000-0000-4000-8000-000000000002',
        after_order: '40',
        operation_id: '00000000-0000-4000-8000-000000000003',
        debug_trace_id: 'live_provider_handoff_canary_trace',
      })
    ).resolves.toEqual(evidence);

    expect(primaryExecute).toHaveBeenCalledTimes(1);
    expect(replicaExecute).not.toHaveBeenCalled();
    const compiled = new PgDialect().sqlToQuery(
      primaryExecute.mock.calls[0][0] as SQL
    );
    const querySql = compiled.sql.replace(/\s+/gu, ' ').trim();
    expect(querySql).toContain('WITH authorized_worker AS MATERIALIZED');
    expect(querySql).toContain('worker.account_id =');
    expect(querySql).toContain('outbox.account_id =');
    expect(querySql).toContain('outbox.outbox_id >');
    expect(querySql).toContain(
      'outbox.outbox_id <= observed.observed_through_order'
    );
    expect(querySql).toContain('LIMIT');
    expect(querySql).toContain("outbox.payload ->> 'lifecycle_operation_id'");
    expect(querySql).toContain("outbox.payload ->> 'debug_trace_id'");
    expect(querySql).toContain("outbox.payload ->> 'is_new_login'");
    expect(querySql).toContain('interactive_login_detected');
    expect(compiled.params).toEqual(
      expect.arrayContaining([
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '40',
        '00000000-0000-4000-8000-000000000003',
        'live_provider_handoff_canary_trace',
        10_000,
        10_001,
      ])
    );
  });

  it('recognizes a post-CAS activating handoff only through target-provider ownership', async () => {
    const context = {
      handoff_id: '00000000-0000-4000-8000-000000000010',
      lifecycle_operation_id: '00000000-0000-4000-8000-000000000011',
      source_provider: 'wwebjs',
      target_provider: 'baileys',
      source_revision_id: '41',
      target_revision_id: '42',
      state: 'activating',
    } as const;
    const execute = jest.fn(async (_query: SQL) => ({ rows: [context] }));
    const repository = new WorkerRuntimeRepository(
      { execute } as never,
      {} as never
    );

    await expect(
      repository.viewWhatsappProviderHandoffLifecycleContext({
        worker_id: '00000000-0000-4000-8000-000000000001',
        account_id: '00000000-0000-4000-8000-000000000002',
        lifecycle_operation_id: context.lifecycle_operation_id,
      })
    ).resolves.toEqual(context);

    const compiled = new PgDialect().sqlToQuery(
      execute.mock.calls[0][0] as SQL
    );
    const querySql = compiled.sql.replace(/\s+/gu, ' ').trim();
    const sourceOwnershipStart = querySql.indexOf('handoff.state IN (');
    const targetOwnershipStart = querySql.indexOf(
      "handoff.state IN ('activating', 'completed')"
    );

    expect(sourceOwnershipStart).toBeGreaterThanOrEqual(0);
    expect(targetOwnershipStart).toBeGreaterThan(sourceOwnershipStart);
    expect(
      querySql.slice(sourceOwnershipStart, targetOwnershipStart)
    ).not.toContain("'activating'");
    expect(querySql.slice(targetOwnershipStart)).toContain(
      'worker.worker_type_id = CASE handoff.target_provider'
    );
    expect(
      querySql.slice(sourceOwnershipStart, targetOwnershipStart)
    ).toContain('worker.worker_status_id =');
    expect(querySql.slice(targetOwnershipStart)).toContain(
      'worker.worker_status_id IN ('
    );
    expect(compiled.params).toEqual(
      expect.arrayContaining([EWorkerStatus.recreating, EWorkerStatus.online])
    );
  });

  it('proves a failed-handoff recovery UUID from the primary canonical source', async () => {
    const proof = {
      handoff_id: '00000000-0000-4000-8000-000000000012',
      handoff_lifecycle_operation_id: '00000000-0000-4000-8000-000000000013',
      recovery_operation_id: '00000000-0000-4000-8000-000000000014',
      source_provider: 'wwebjs',
      failed_target_provider: 'baileys',
      source_revision_id: '41',
      recovery_state: 'running',
      recovery_cleanup_required: true,
      recovery_from_generation: 8,
      recovery_ownership_unique: true,
      recovery_context_valid: true,
      source_session_valid: true,
      runtime_source_provider: null,
      runtime_generation: 9,
      runtime_container_id: null,
      recovery_source_runtime_reserved: true,
    } as const;
    const primaryExecute = jest.fn(async (_query: SQL) => ({ rows: [proof] }));
    const replicaExecute = jest.fn(async (_query: SQL) => ({ rows: [] }));
    const repository = new WorkerRuntimeRepository(
      { execute: primaryExecute } as never,
      { execute: replicaExecute } as never
    );

    await expect(
      repository.viewWhatsappProviderHandoffRecoveryLifecycleProof({
        worker_id: '00000000-0000-4000-8000-000000000001',
        account_id: '00000000-0000-4000-8000-000000000002',
        recovery_operation_id: proof.recovery_operation_id,
        recovery_worker_type_id: EWorkerType.wwebjs,
        recovery_provider: 'wwebjs',
      })
    ).resolves.toEqual(proof);

    expect(primaryExecute).toHaveBeenCalledTimes(1);
    expect(replicaExecute).not.toHaveBeenCalled();
    const compiled = new PgDialect().sqlToQuery(
      primaryExecute.mock.calls[0][0] as SQL
    );
    const querySql = compiled.sql.replace(/\s+/gu, ' ').trim();

    expect(querySql).toContain('FROM public.worker AS worker');
    expect(querySql).toContain(
      'JOIN public.whatsapp_session_handoff AS handoff'
    );
    expect(querySql).toContain('LEFT JOIN public.whatsapp_session AS session');
    expect(querySql).toContain(
      'LEFT JOIN public.whatsapp_session_revision AS source_revision'
    );
    expect(querySql).toContain('LEFT JOIN public.worker_runtime AS runtime');
    expect(querySql).toContain(
      'handoff.recovery_operation_id = worker.lifecycle_operation_id'
    );
    expect(querySql).toContain("session.state = 'ready'");
    expect(querySql).toContain(
      'session.active_revision_id = handoff.source_revision_id'
    );
    expect(querySql).toContain(
      'source_revision.revision_id = handoff.source_revision_id'
    );
    expect(querySql).toContain(
      'source_revision.provider = handoff.source_provider'
    );
    expect(querySql).toContain("source_revision.status = 'active'");
    expect(querySql).toContain(
      'runtime.runtime_generation > handoff.recovery_from_generation'
    );
    expect(querySql).toContain(
      'runtime.source_provider = handoff.source_provider'
    );
    expect(querySql).toContain(
      'source_revision.writer_generation = session.generation'
    );
    expect(querySql).toContain('source_revision.writer_epoch = session.epoch');
    expect(querySql).toContain(
      'source_revision.capability_hash = session.capability_hash'
    );
    expect(querySql).toContain("worker.session_storage = 'postgres'");
    expect(querySql).toContain('worker.worker_status_id IN (');
    expect(querySql).toContain("handoff.state = 'failed'");
    expect(querySql).toContain('handoff.lifecycle_operation_id IS NOT NULL');
    expect(querySql).toContain(
      'handoff.recovery_operation_id <> handoff.lifecycle_operation_id'
    );
    expect(querySql).toContain('handoff.target_revision_id IS NOT NULL');
    expect(querySql).toContain(
      'handoff.target_revision_id <> handoff.source_revision_id'
    );
    expect(querySql).toContain(
      "handoff.recovery_state IN ('pending', 'dispatching', 'running')"
    );
    expect(querySql).toContain('handoff.recovery_cleanup_required IS NOT NULL');
    expect(querySql).toContain('handoff.recovery_from_generation > 0');
    expect(querySql).toContain('(count(*) OVER () = 1)');
    expect(querySql).toContain('AS recovery_context_valid');
    expect(querySql).toContain('AS source_session_valid');
    expect(querySql).toContain('LIMIT 2');
    const ownershipPredicate = querySql.slice(
      querySql.indexOf('WHERE worker.worker_id =')
    );
    expect(ownershipPredicate).not.toContain('handoff.recovery_state IN');
    expect(ownershipPredicate).not.toContain("handoff.state = 'failed'");
    expect(compiled.params).toEqual(
      expect.arrayContaining([
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        proof.recovery_operation_id,
        EWorkerStatus.recreating,
        EWorkerStatus.online,
        EWorkerType.wwebjs,
        'wwebjs',
      ])
    );
  });

  it.each([
    'pending',
    'dispatching',
    'running',
    'blocked',
    'cancelled',
    'completed',
  ] as const)(
    'proves a terminal handoff with %s recovery ownership from the primary',
    async (recoveryState) => {
      const lifecycleOperationId = '00000000-0000-4000-8000-000000000071';
      const proof = {
        handoff_id: '00000000-0000-4000-8000-000000000072',
        lifecycle_operation_id: lifecycleOperationId,
        handoff_state: 'failed',
        error_code: 'wwebjs_canonical_import_task_failed',
        source_provider: 'baileys',
        target_provider: 'wwebjs',
        recovery_state: recoveryState,
        recovery_operation_id: '00000000-0000-4000-8000-000000000073',
        resolution_state: null,
        resolution_operation_id: null,
        point_of_no_return_at: null,
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.recreating,
        terminal_ownership_unique: true,
      } as const;
      const primaryExecute = jest.fn(async (_query: SQL) => ({
        rows: [proof],
      }));
      const replicaExecute = jest.fn(async (_query: SQL) => ({ rows: [] }));
      const repository = new WorkerRuntimeRepository(
        { execute: primaryExecute } as never,
        { execute: replicaExecute } as never
      );

      await expect(
        repository.viewWhatsappProviderHandoffTerminalLifecycleProof({
          worker_id: '00000000-0000-4000-8000-000000000001',
          account_id: '00000000-0000-4000-8000-000000000002',
          lifecycle_operation_id: lifecycleOperationId,
        })
      ).resolves.toEqual(proof);

      expect(primaryExecute).toHaveBeenCalledTimes(1);
      expect(replicaExecute).not.toHaveBeenCalled();
      const compiled = new PgDialect().sqlToQuery(
        primaryExecute.mock.calls[0][0] as SQL
      );
      const querySql = compiled.sql.replace(/\s+/gu, ' ').trim();
      expect(querySql).toContain('FROM public.worker AS worker');
      expect(querySql).toContain(
        'JOIN public.whatsapp_session_handoff AS handoff'
      );
      expect(querySql).toContain(
        'LEFT JOIN public.whatsapp_session_handoff_resolution AS resolution'
      );
      expect(querySql).toContain(
        'handoff.lifecycle_operation_id = worker.lifecycle_operation_id'
      );
      expect(querySql).toContain("handoff.state IN ('failed', 'completed')");
      expect(querySql).toContain("worker.session_storage = 'postgres'");
      expect(querySql).toContain('(count(*) OVER () = 1)');
      expect(querySql).toContain('LIMIT 2');
      expect(compiled.params).toEqual([
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        lifecycleOperationId,
      ]);
    }
  );

  it.each(['running', 'completed'] as const)(
    'proves a terminal handoff while its distinct resolution is %s',
    async (resolutionState) => {
      const lifecycleOperationId = '00000000-0000-4000-8000-000000000081';
      const proof = {
        handoff_id: '00000000-0000-4000-8000-000000000082',
        lifecycle_operation_id: lifecycleOperationId,
        handoff_state: 'failed',
        error_code: 'whatsapp_artifact_profile_too_large',
        source_provider: 'wwebjs',
        target_provider: 'baileys',
        recovery_state: 'completed',
        recovery_operation_id: '00000000-0000-4000-8000-000000000083',
        resolution_state: resolutionState,
        resolution_operation_id: '00000000-0000-4000-8000-000000000084',
        point_of_no_return_at: null,
        worker_type_id: EWorkerType.wwebjs,
        worker_status_id: EWorkerStatus.recreating,
        terminal_ownership_unique: true,
      } as const;
      const repository = new WorkerRuntimeRepository(
        { execute: jest.fn(async () => ({ rows: [proof] })) } as never,
        { execute: jest.fn() } as never
      );

      await expect(
        repository.viewWhatsappProviderHandoffTerminalLifecycleProof({
          worker_id: '00000000-0000-4000-8000-000000000001',
          account_id: '00000000-0000-4000-8000-000000000002',
          lifecycle_operation_id: lifecycleOperationId,
        })
      ).resolves.toEqual(proof);
    }
  );

  it('proves completed terminal ownership without requiring recovery', async () => {
    const lifecycleOperationId = '00000000-0000-4000-8000-000000000091';
    const proof = {
      handoff_id: '00000000-0000-4000-8000-000000000092',
      lifecycle_operation_id: lifecycleOperationId,
      handoff_state: 'completed',
      error_code: null,
      source_provider: 'baileys',
      target_provider: 'wwebjs',
      recovery_state: 'none',
      recovery_operation_id: null,
      resolution_state: null,
      resolution_operation_id: null,
      point_of_no_return_at: '2026-08-09T03:00:00.000Z',
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.online,
      terminal_ownership_unique: true,
    } as const;
    const repository = new WorkerRuntimeRepository(
      { execute: jest.fn(async () => ({ rows: [proof] })) } as never,
      { execute: jest.fn() } as never
    );

    await expect(
      repository.viewWhatsappProviderHandoffTerminalLifecycleProof({
        worker_id: '00000000-0000-4000-8000-000000000001',
        account_id: '00000000-0000-4000-8000-000000000002',
        lifecycle_operation_id: lifecycleOperationId,
      })
    ).resolves.toEqual(proof);
  });

  it('does not classify an active pre- or post-PONR handoff as terminal', async () => {
    const primaryExecute = jest.fn(async (_query: SQL) => ({ rows: [] }));
    const repository = new WorkerRuntimeRepository(
      { execute: primaryExecute } as never,
      { execute: jest.fn() } as never
    );

    await expect(
      repository.viewWhatsappProviderHandoffTerminalLifecycleProof({
        worker_id: '00000000-0000-4000-8000-000000000001',
        account_id: '00000000-0000-4000-8000-000000000002',
        lifecycle_operation_id: '00000000-0000-4000-8000-000000000101',
      })
    ).resolves.toBeNull();

    const compiled = new PgDialect().sqlToQuery(
      primaryExecute.mock.calls[0][0] as SQL
    );
    const normalizedSql = compiled.sql.replace(/\s+/gu, ' ');
    const terminalPredicate = normalizedSql.slice(
      normalizedSql.indexOf('WHERE')
    );
    expect(terminalPredicate).toContain(
      "handoff.state IN ('failed', 'completed')"
    );
    expect(terminalPredicate).not.toContain('point_of_no_return_at IS NULL');
  });

  it.each([
    {
      name: 'an aliased recovery operation',
      mutate: (proof: Record<string, unknown>, operationId: string) => ({
        ...proof,
        recovery_operation_id: operationId,
      }),
    },
    {
      name: 'an aliased resolution operation',
      mutate: (proof: Record<string, unknown>, operationId: string) => ({
        ...proof,
        resolution_state: 'running',
        resolution_operation_id: operationId,
      }),
    },
    {
      name: 'a malformed recovery identity',
      mutate: (proof: Record<string, unknown>) => ({
        ...proof,
        recovery_state: 'running',
        recovery_operation_id: null,
      }),
    },
  ])('rejects terminal ownership with $name', async ({ mutate }) => {
    const lifecycleOperationId = '00000000-0000-4000-8000-000000000111';
    const proof = mutate(
      {
        handoff_id: '00000000-0000-4000-8000-000000000112',
        lifecycle_operation_id: lifecycleOperationId,
        handoff_state: 'failed',
        error_code: 'wwebjs_canonical_import_task_failed',
        source_provider: 'baileys',
        target_provider: 'wwebjs',
        recovery_state: 'pending',
        recovery_operation_id: '00000000-0000-4000-8000-000000000113',
        resolution_state: null,
        resolution_operation_id: null,
        point_of_no_return_at: null,
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.recreating,
        terminal_ownership_unique: true,
      },
      lifecycleOperationId
    );
    const repository = new WorkerRuntimeRepository(
      { execute: jest.fn(async () => ({ rows: [proof] })) } as never,
      { execute: jest.fn() } as never
    );

    await expect(
      repository.viewWhatsappProviderHandoffTerminalLifecycleProof({
        worker_id: '00000000-0000-4000-8000-000000000001',
        account_id: '00000000-0000-4000-8000-000000000002',
        lifecycle_operation_id: lifecycleOperationId,
      })
    ).rejects.toThrow('whatsapp_handoff_terminal_lifecycle_proof_invalid');
  });

  it('fails a stale handoff target through the primary-only atomic capability', async () => {
    const lifecycleOperationId = '00000000-0000-4000-8000-000000000031';
    const proof = {
      outcome: 'failed',
      handoff_id: '00000000-0000-4000-8000-000000000032',
      recovery_operation_id: '00000000-0000-4000-8000-000000000033',
      recovery_state: 'pending',
      error_code: STALE_WHATSAPP_PROVIDER_HANDOFF_TARGET_ERROR_CODE,
    } as const;
    const primaryExecute = jest.fn(async (_query: SQL) => ({ rows: [proof] }));
    const replicaExecute = jest.fn(async (_query: SQL) => ({ rows: [] }));
    const repository = new WorkerRuntimeRepository(
      { execute: primaryExecute } as never,
      { execute: replicaExecute } as never
    );

    await expect(
      repository.failStaleWhatsappProviderHandoffTarget({
        worker_id: '00000000-0000-4000-8000-000000000001',
        account_id: '00000000-0000-4000-8000-000000000002',
        lifecycle_operation_id: lifecycleOperationId,
      })
    ).resolves.toEqual(proof);

    expect(primaryExecute).toHaveBeenCalledTimes(1);
    expect(replicaExecute).not.toHaveBeenCalled();
    const compiled = new PgDialect().sqlToQuery(
      primaryExecute.mock.calls[0][0] as SQL
    );
    expect(compiled.sql.replace(/\s+/gu, ' ').trim()).toContain(
      'FROM public.fail_stale_whatsapp_handoff_target('
    );
    expect(compiled.params).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      lifecycleOperationId,
    ]);
  });

  it('rejects an aliased stale-handoff recovery proof', async () => {
    const lifecycleOperationId = '00000000-0000-4000-8000-000000000041';
    const repository = new WorkerRuntimeRepository(
      {
        execute: jest.fn(async () => ({
          rows: [
            {
              outcome: 'recovery_owned',
              handoff_id: '00000000-0000-4000-8000-000000000042',
              recovery_operation_id: lifecycleOperationId,
              recovery_state: 'pending',
              error_code: STALE_WHATSAPP_PROVIDER_HANDOFF_TARGET_ERROR_CODE,
            },
          ],
        })),
      } as never,
      { execute: jest.fn() } as never
    );

    await expect(
      repository.failStaleWhatsappProviderHandoffTarget({
        worker_id: '00000000-0000-4000-8000-000000000001',
        account_id: '00000000-0000-4000-8000-000000000002',
        lifecycle_operation_id: lifecycleOperationId,
      })
    ).rejects.toThrow('stale_whatsapp_handoff_reconciliation_proof_invalid');
  });

  it.each(['blocked', 'cancelled', 'completed'] as const)(
    'accepts an exact stale-handoff recovery-owned proof in %s state',
    async (recoveryState) => {
      const lifecycleOperationId = '00000000-0000-4000-8000-000000000051';
      const proof = {
        outcome: 'recovery_owned',
        handoff_id: '00000000-0000-4000-8000-000000000052',
        recovery_operation_id: '00000000-0000-4000-8000-000000000053',
        recovery_state: recoveryState,
        error_code: STALE_WHATSAPP_PROVIDER_HANDOFF_TARGET_ERROR_CODE,
      } as const;
      const repository = new WorkerRuntimeRepository(
        { execute: jest.fn(async () => ({ rows: [proof] })) } as never,
        { execute: jest.fn() } as never
      );

      await expect(
        repository.failStaleWhatsappProviderHandoffTarget({
          worker_id: '00000000-0000-4000-8000-000000000001',
          account_id: '00000000-0000-4000-8000-000000000002',
          lifecycle_operation_id: lifecycleOperationId,
        })
      ).resolves.toEqual(proof);
    }
  );

  it.each([
    {
      name: 'a failed result whose trigger did not leave recovery pending',
      outcome: 'failed',
      recoveryState: 'blocked',
      errorCode: STALE_WHATSAPP_PROVIDER_HANDOFF_TARGET_ERROR_CODE,
    },
    {
      name: 'a recovery-owned result with an unsupported recovery state',
      outcome: 'recovery_owned',
      recoveryState: 'none',
      errorCode: STALE_WHATSAPP_PROVIDER_HANDOFF_TARGET_ERROR_CODE,
    },
    {
      name: 'a recovery-owned result with an unrelated causal code',
      outcome: 'recovery_owned',
      recoveryState: 'blocked',
      errorCode: 'some_other_failure',
    },
  ] as const)('rejects $name', async (scenario) => {
    const repository = new WorkerRuntimeRepository(
      {
        execute: jest.fn(async () => ({
          rows: [
            {
              outcome: scenario.outcome,
              handoff_id: '00000000-0000-4000-8000-000000000062',
              recovery_operation_id: '00000000-0000-4000-8000-000000000063',
              recovery_state: scenario.recoveryState,
              error_code: scenario.errorCode,
            },
          ],
        })),
      } as never,
      { execute: jest.fn() } as never
    );

    await expect(
      repository.failStaleWhatsappProviderHandoffTarget({
        worker_id: '00000000-0000-4000-8000-000000000001',
        account_id: '00000000-0000-4000-8000-000000000002',
        lifecycle_operation_id: '00000000-0000-4000-8000-000000000061',
      })
    ).rejects.toThrow('stale_whatsapp_handoff_reconciliation_proof_invalid');
  });

  it('proves an empty PostgreSQL provider switch from the primary with exact lifecycle fences', async () => {
    const proof = {
      lifecycle_operation_id: '00000000-0000-4000-8000-000000000021',
      worker_type_id: EWorkerType.whatsmeow,
      runtime_session_storage: EWorkerSessionStorage.postgres,
      runtime_source_provider: 'whatsmeow',
    };
    const primaryExecute = jest.fn(async (_query: SQL) => ({ rows: [proof] }));
    const replicaExecute = jest.fn(async (_query: SQL) => ({ rows: [] }));
    const repository = new WorkerRuntimeRepository(
      { execute: primaryExecute } as never,
      { execute: replicaExecute } as never
    );

    await expect(
      repository.viewWhatsappProviderEmptySwitchPrimaryProof({
        worker_id: '00000000-0000-4000-8000-000000000001',
        account_id: '00000000-0000-4000-8000-000000000002',
        lifecycle_operation_id: proof.lifecycle_operation_id,
        target_worker_type_id: EWorkerType.whatsmeow,
        target_provider: 'whatsmeow',
      })
    ).resolves.toEqual(proof);

    expect(primaryExecute).toHaveBeenCalledTimes(1);
    expect(replicaExecute).not.toHaveBeenCalled();
    const compiled = new PgDialect().sqlToQuery(
      primaryExecute.mock.calls[0][0] as SQL
    );
    const querySql = compiled.sql.replace(/\s+/gu, ' ').trim();

    expect(querySql).toContain('FROM public.worker AS worker');
    expect(querySql).toContain('LEFT JOIN public.whatsapp_session AS session');
    expect(querySql).toContain('LEFT JOIN public.worker_runtime AS runtime');
    expect(querySql).toContain('worker.worker_status_id =');
    expect(querySql).toContain('worker.lifecycle_operation_id =');
    expect(querySql).toContain('worker.worker_type_id =');
    expect(querySql).toContain('session.session_id IS NULL');
    expect(querySql).toContain("runtime.session_storage = 'postgres'");
    expect(querySql).toContain('runtime.source_provider IS NULL');
    expect(querySql).toContain(
      'FROM public.whatsapp_session_handoff AS handoff'
    );
    expect(querySql).toContain(
      'FROM public.whatsapp_session_handoff_resolution AS resolution'
    );
    expect(compiled.params).toEqual(
      expect.arrayContaining([
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        proof.lifecycle_operation_id,
        EWorkerStatus.recreating,
        EWorkerType.whatsmeow,
        'whatsmeow',
      ])
    );
  });

  it('resumes a handoff decision from the worker-owned resolution after session cascade', async () => {
    const durableDecision = {
      worker_id: '00000000-0000-4000-8000-000000000001',
      account_id: '00000000-0000-4000-8000-000000000002',
      handoff_id: '00000000-0000-4000-8000-000000000010',
      handoff_lifecycle_operation_id: '00000000-0000-4000-8000-000000000011',
      resolution_action: 'discard',
      resolution_state: 'running',
      resolution_operation_id: '00000000-0000-4000-8000-000000000012',
    };
    const execute = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [durableDecision] });
    const repository = new WorkerRuntimeRepository(
      { execute } as never,
      {} as never
    );

    await expect(
      repository.viewWhatsappProviderHandoffDecision({
        worker_id: durableDecision.worker_id,
        account_id: durableDecision.account_id,
        handoff_id: durableDecision.handoff_id,
      })
    ).resolves.toEqual(durableDecision);

    expect(execute).toHaveBeenCalledTimes(3);
    const reconcileSql = new PgDialect()
      .sqlToQuery(execute.mock.calls[0][0] as SQL)
      .sql.replace(/\s+/gu, ' ');
    const activeHandoffSql = new PgDialect()
      .sqlToQuery(execute.mock.calls[1][0] as SQL)
      .sql.replace(/\s+/gu, ' ');
    const durableFallbackSql = new PgDialect()
      .sqlToQuery(execute.mock.calls[2][0] as SQL)
      .sql.replace(/\s+/gu, ' ');
    expect(reconcileSql).toContain('reconcile_whatsapp_handoff_resolution');
    expect(activeHandoffSql).toContain(
      'JOIN public.whatsapp_session_handoff AS handoff'
    );
    expect(durableFallbackSql).toContain(
      'JOIN public.whatsapp_session_handoff_resolution AS resolution'
    );
    expect(durableFallbackSql).toContain(
      'resolution.handoff_lifecycle_operation_id::text'
    );
    expect(durableFallbackSql).not.toContain(
      'JOIN public.whatsapp_session_handoff AS handoff'
    );
  });

  it('recognizes finalized discard cleanup after the target runtime replaces the source', async () => {
    const context = {
      handoff_id: '00000000-0000-4000-8000-000000000010',
      operation_id: '00000000-0000-4000-8000-000000000012',
      source_provider: 'whatsmeow',
      target_provider: 'baileys',
      runtime_generation: 8,
      container_id: 'target-container',
      session_present: true,
      cleanup_finalized_at: '2026-08-05T01:00:00.000Z',
    };
    const execute = jest.fn(async (_query: SQL) => ({ rows: [context] }));
    const repository = new WorkerRuntimeRepository(
      { execute } as never,
      {} as never
    );

    await expect(
      repository.viewWhatsappProviderHandoffDiscardCleanupContext({
        worker_id: '00000000-0000-4000-8000-000000000001',
        account_id: '00000000-0000-4000-8000-000000000002',
        operation_id: context.operation_id,
      })
    ).resolves.toEqual(context);

    const querySql = new PgDialect()
      .sqlToQuery(execute.mock.calls[0][0] as SQL)
      .sql.replace(/\s+/gu, ' ');
    expect(querySql).toContain(
      'resolution.cleanup_finalized_at IS NOT NULL OR session.session_id IS NULL OR runtime.source_provider = resolution.source_provider'
    );
  });

  it('returns the provider direction in the primary discard gate', async () => {
    const gate = {
      handoff_id: '00000000-0000-4000-8000-000000000010',
      operation_id: '00000000-0000-4000-8000-000000000012',
      source_provider: 'baileys',
      target_provider: 'whatsmeow',
      session_present: false,
      cleanup_finalized_at: '2026-08-05T01:00:00.000Z',
    };
    const execute = jest.fn(async (_query: SQL) => ({ rows: [gate] }));
    const repository = new WorkerRuntimeRepository(
      { execute } as never,
      {} as never
    );

    await expect(
      repository.viewWhatsappProviderHandoffDiscardPrimaryGate({
        worker_id: '00000000-0000-4000-8000-000000000001',
        account_id: '00000000-0000-4000-8000-000000000002',
        operation_id: gate.operation_id,
      })
    ).resolves.toEqual(gate);

    const querySql = new PgDialect()
      .sqlToQuery(execute.mock.calls[0][0] as SQL)
      .sql.replace(/\s+/gu, ' ');
    expect(querySql).toContain('resolution.source_provider');
    expect(querySql).toContain('resolution.target_provider');
  });

  it('fails a pre-drain handoff through the primary atomic lifecycle fence', async () => {
    const primaryExecute = jest.fn(async (_query: SQL) => ({
      rows: [{ failed: true }],
    }));
    const replicaExecute = jest.fn(async (_query: SQL) => ({
      rows: [{ failed: false }],
    }));
    const repository = new WorkerRuntimeRepository(
      { execute: primaryExecute } as never,
      { execute: replicaExecute } as never
    );
    const input = {
      worker_id: '00000000-0000-4000-8000-000000000001',
      account_id: '00000000-0000-4000-8000-000000000002',
      lifecycle_operation_id: '00000000-0000-4000-8000-000000000003',
      handoff_id: '00000000-0000-4000-8000-000000000004',
      source_provider: 'wwebjs',
      target_provider: 'baileys',
      source_revision_id: '41',
      target_revision_id: '42',
      runtime_generation: 9,
      source_container_id: 'a'.repeat(64),
      error_code: 'whatsapp_artifact_profile_too_large',
    } as const;

    await expect(
      repository.failWhatsappProviderHandoffBeforeSourceDrain(input)
    ).resolves.toBe(true);

    expect(primaryExecute).toHaveBeenCalledTimes(1);
    expect(replicaExecute).not.toHaveBeenCalled();
    const compiled = new PgDialect().sqlToQuery(
      primaryExecute.mock.calls[0][0] as SQL
    );
    const querySql = compiled.sql.replace(/\s+/gu, ' ').trim();
    expect(querySql).toContain(
      'SELECT public.fail_whatsapp_handoff_before_source_drain('
    );
    expect(querySql).toContain(') AS failed');
    expect(compiled.params).toEqual([
      input.worker_id,
      input.account_id,
      input.lifecycle_operation_id,
      input.handoff_id,
      input.source_provider,
      input.target_provider,
      input.source_revision_id,
      input.target_revision_id,
      input.runtime_generation,
      input.source_container_id,
      input.error_code,
    ]);
  });

  it('deletes a PostgreSQL WhatsApp session only behind the exact locked lifecycle and runtime fence', async () => {
    const harness = createWhatsappSessionDeleteDatabase({
      workerRows: [postgresSessionDeleteWorker()],
      runtimeRows: [postgresSessionDeleteRuntime()],
    });
    const repository = new WorkerRuntimeRepository(
      harness.database as never,
      {} as never
    );

    await expect(
      repository.deletePostgresWhatsappSessionByWorkerId(
        postgresSessionDeleteInput() as never
      )
    ).resolves.toBe(true);

    const sqlStatements = harness.statements.map((statement) => statement.sql);
    const workerLock = sqlStatements.findIndex(
      (statement) =>
        statement.includes('FROM "worker"') &&
        !statement.includes('FROM "worker_runtime"')
    );
    const runtimeLock = sqlStatements.findIndex((statement) =>
      statement.includes('FROM "worker_runtime"')
    );
    expect(workerLock).toBeGreaterThanOrEqual(0);
    expect(runtimeLock).toBeGreaterThan(workerLock);
    expect(sqlStatements[workerLock]).toContain('FOR UPDATE');
    expect(sqlStatements[runtimeLock]).toContain('FOR UPDATE');
    const writerRevocation = sqlStatements.findIndex((statement) =>
      statement.includes('UPDATE "worker_runtime"')
    );
    const firstSessionDelete = sqlStatements.findIndex((statement) =>
      statement.includes('DELETE FROM "whatsapp_session_handoff"')
    );
    const artifactChunkDelete = sqlStatements.findIndex((statement) =>
      statement.includes('DELETE FROM "whatsapp_artifact_chunk"')
    );
    const sessionHeaderDelete = sqlStatements.findIndex((statement) =>
      statement.includes('DELETE FROM "whatsapp_session"')
    );
    expect(writerRevocation).toBeGreaterThan(runtimeLock);
    expect(firstSessionDelete).toBeGreaterThan(writerRevocation);
    expect(artifactChunkDelete).toBeGreaterThan(firstSessionDelete);
    expect(sessionHeaderDelete).toBeGreaterThan(artifactChunkDelete);
    expect(sqlStatements[writerRevocation]).toContain(
      '"runtime_capability_hash" = NULL'
    );
    expect(sqlStatements[writerRevocation]).toContain(
      '"session_writer_epoch" = NULL'
    );
    expect(sqlStatements).toEqual(
      expect.arrayContaining([
        expect.stringContaining("set_config('app.whatsapp_session_id'"),
        expect.stringContaining('DELETE FROM "whatsapp_session_handoff"'),
        expect.stringContaining('DELETE FROM "whatsapp_artifact_chunk"'),
        expect.stringContaining('DELETE FROM "whatsapp_session"'),
        expect.stringContaining('DELETE FROM "whatsapp_session_revision"'),
      ])
    );
  });

  it('deletes a stale canonical shadow behind the exact destructive legacy conversion fence', async () => {
    const legacyContainerId = 'a'.repeat(64);
    const legacyVolumeName = 'worker-1-session';
    const harness = createWhatsappSessionDeleteDatabase({
      workerRows: [postgresSessionDeleteWorker()],
      runtimeRows: [
        postgresSessionDeleteRuntime({
          session_storage: EWorkerSessionStorage.legacy_volume,
          session_volume_name: legacyVolumeName,
          container_id: legacyContainerId,
        }),
      ],
    });
    const repository = new WorkerRuntimeRepository(
      harness.database as never,
      {} as never
    );

    await expect(
      repository.deletePostgresWhatsappSessionByWorkerId({
        ...postgresSessionDeleteInput(),
        expected_container_id: legacyContainerId,
        expected_runtime_session_storage: EWorkerSessionStorage.legacy_volume,
        expected_session_volume_name: legacyVolumeName,
      } as never)
    ).resolves.toBe(true);

    const sqlStatements = harness.statements.map((statement) => statement.sql);
    expect(
      sqlStatements.some((statement) =>
        statement.includes('UPDATE "worker_runtime"')
      )
    ).toBe(false);
    expect(sqlStatements).toEqual(
      expect.arrayContaining([
        expect.stringContaining('DELETE FROM "whatsapp_session_handoff"'),
        expect.stringContaining('DELETE FROM "whatsapp_artifact_chunk"'),
        expect.stringContaining('DELETE FROM "whatsapp_session"'),
        expect.stringContaining('DELETE FROM "whatsapp_session_revision"'),
      ])
    );
  });

  it.each([
    {
      name: 'runtime backend',
      runtime: postgresSessionDeleteRuntime({
        session_storage: EWorkerSessionStorage.postgres,
        session_volume_name: null,
        container_id: 'a'.repeat(64),
      }),
    },
    {
      name: 'legacy volume',
      runtime: postgresSessionDeleteRuntime({
        session_storage: EWorkerSessionStorage.legacy_volume,
        session_volume_name: 'different-volume',
        container_id: 'a'.repeat(64),
      }),
    },
  ])(
    'rejects a stale legacy-conversion $name fence without deleting canonical data',
    async ({ runtime }) => {
      const harness = createWhatsappSessionDeleteDatabase({
        workerRows: [postgresSessionDeleteWorker()],
        runtimeRows: [runtime],
      });
      const repository = new WorkerRuntimeRepository(
        harness.database as never,
        {} as never
      );

      await expect(
        repository.deletePostgresWhatsappSessionByWorkerId({
          ...postgresSessionDeleteInput(),
          expected_container_id: 'a'.repeat(64),
          expected_runtime_session_storage: EWorkerSessionStorage.legacy_volume,
          expected_session_volume_name: 'worker-1-session',
        } as never)
      ).resolves.toBe(false);

      expect(
        harness.statements.some((statement) =>
          statement.sql.includes('DELETE FROM')
        )
      ).toBe(false);
    }
  );

  it('keeps an accepted PostgreSQL session deletion idempotent when every session table is already empty', async () => {
    const harness = createWhatsappSessionDeleteDatabase({
      workerRows: [postgresSessionDeleteWorker()],
      runtimeRows: [postgresSessionDeleteRuntime()],
    });
    const repository = new WorkerRuntimeRepository(
      harness.database as never,
      {} as never
    );
    const input = postgresSessionDeleteInput() as never;

    await expect(
      repository.deletePostgresWhatsappSessionByWorkerId(input)
    ).resolves.toBe(true);
    await expect(
      repository.deletePostgresWhatsappSessionByWorkerId(input)
    ).resolves.toBe(true);

    expect(harness.transaction).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: 'account',
      worker: postgresSessionDeleteWorker({ account_id: 'account-new' }),
      runtime: postgresSessionDeleteRuntime(),
    },
    {
      name: 'lifecycle',
      worker: postgresSessionDeleteWorker({
        lifecycle_operation_id: 'operation-new',
      }),
      runtime: postgresSessionDeleteRuntime(),
    },
    {
      name: 'status',
      worker: postgresSessionDeleteWorker({
        worker_status_id: EWorkerStatus.online,
      }),
      runtime: postgresSessionDeleteRuntime(),
    },
    {
      name: 'generation',
      worker: postgresSessionDeleteWorker(),
      runtime: postgresSessionDeleteRuntime({ runtime_generation: 8 }),
    },
    {
      name: 'container',
      worker: postgresSessionDeleteWorker(),
      runtime: postgresSessionDeleteRuntime({ container_id: 'container-8' }),
    },
  ])(
    'rejects a stale $name fence without deleting PostgreSQL session data',
    async ({ worker: workerRow, runtime: runtimeRow }) => {
      const harness = createWhatsappSessionDeleteDatabase({
        workerRows: [workerRow],
        runtimeRows: [runtimeRow],
      });
      const repository = new WorkerRuntimeRepository(
        harness.database as never,
        {} as never
      );

      await expect(
        repository.deletePostgresWhatsappSessionByWorkerId(
          postgresSessionDeleteInput() as never
        )
      ).resolves.toBe(false);

      expect(
        harness.statements.some((statement) =>
          statement.sql.includes('DELETE FROM')
        )
      ).toBe(false);
    }
  );

  it('accepts an idempotent permanent-delete tombstone with an exact absent-runtime fence', async () => {
    const harness = createWhatsappSessionDeleteDatabase({
      workerRows: [
        postgresSessionDeleteWorker({
          worker_status_id: EWorkerStatus.deleting,
          deleted_at: '2026-08-01T10:00:00.000Z',
        }),
      ],
      runtimeRows: [],
    });
    const repository = new WorkerRuntimeRepository(
      harness.database as never,
      {} as never
    );

    await expect(
      repository.deletePostgresWhatsappSessionByWorkerId(
        postgresSessionDeleteInput({
          expected_worker_status_id: EWorkerStatus.deleting,
          expected_runtime_generation: null,
          expected_container_id: null,
        }) as never
      )
    ).resolves.toBe(true);
  });

  it('checks adopted session volumes on the primary database', async () => {
    const primary = createSelectChain([{ worker_id: 'worker-1' }]);
    const replica = createSelectChain([]);
    const repository = new WorkerRuntimeRepository(
      { select: primary.select } as never,
      { select: replica.select } as never
    );

    await expect(
      repository.isSessionVolumeReferencedConsistent('warm-volume')
    ).resolves.toBe(true);

    expect(primary.select).toHaveBeenCalledTimes(1);
    expect(replica.select).not.toHaveBeenCalled();
  });

  it('checks for another worker volume owner on the primary database', async () => {
    const primary = createSelectChain([{ worker_id: 'worker-2' }]);
    const repository = new WorkerRuntimeRepository(
      { select: primary.select } as never,
      {} as never
    );

    await expect(
      repository.isSessionVolumeReferencedByOtherWorkerConsistent(
        'warm-volume',
        'worker-1'
      )
    ).resolves.toBe(true);

    const compiled = new PgDialect().sqlToQuery(
      primary.queryBuilder.where.mock.calls[0][0] as SQL
    );
    expect(compiled.sql).toContain('<>');
    expect(compiled.params).toEqual(
      expect.arrayContaining(['warm-volume', 'worker-1'])
    );
  });

  it('CAS-clears only the failed warm association while preserving runtime data', async () => {
    const updateChain = createUpdateChain(1);
    const repository = new WorkerRuntimeRepository(
      { update: updateChain.update } as never,
      {} as never
    );

    await expect(
      repository.clearWarmPoolReferenceIfMatches({
        worker_id: 'worker-1',
        warm_pool_id: 'warm-pool-1',
        runtime_generation: 8,
        session_volume_name: 'warm-volume',
      })
    ).resolves.toBe(true);

    expect(updateChain.queryBuilder.set).toHaveBeenCalledWith({
      warm_pool_id: null,
      updated_at: '2026-07-15T18:30:00.000Z',
    });
    expect(updateChain.queryBuilder.where).toHaveBeenCalledWith(
      expect.anything()
    );
  });

  it('does not detach a warm association superseded by another generation', async () => {
    const updateChain = createUpdateChain(0);
    const repository = new WorkerRuntimeRepository(
      { update: updateChain.update } as never,
      {} as never
    );

    await expect(
      repository.clearWarmPoolReferenceIfMatches({
        worker_id: 'worker-1',
        warm_pool_id: 'warm-pool-1',
        runtime_generation: 8,
        session_volume_name: 'warm-volume',
      })
    ).resolves.toBe(false);
  });

  it('tombstones a cleaned warm activation without lowering its generation fence', async () => {
    const updateChain = createUpdateChain(1);
    const repository = new WorkerRuntimeRepository(
      { update: updateChain.update } as never,
      {} as never
    );

    await expect(
      repository.tombstoneWarmActivationIfMatches({
        worker_id: 'worker-1',
        warm_pool_id: 'warm-pool-1',
        runtime_generation: 8,
        session_volume_name: 'warm-volume',
        container_id: 'container-8',
        tombstone_session_volume_name: 'retired-warm-pool-1-8',
      })
    ).resolves.toBe(true);

    const setInput = updateChain.queryBuilder.set.mock.calls[0][0];
    expect(setInput).toEqual(
      expect.objectContaining({
        container_id: null,
        session_volume_name: 'retired-warm-pool-1-8',
        warm_pool_id: null,
        connection_sequence: 0,
      })
    );
    expect(setInput).not.toHaveProperty('runtime_generation');
    const compiled = new PgDialect().sqlToQuery(
      updateChain.queryBuilder.where.mock.calls[0][0] as SQL
    );
    expect(compiled.params).toEqual(
      expect.arrayContaining([
        'worker-1',
        'warm-pool-1',
        8,
        'warm-volume',
        'container-8',
      ])
    );
  });

  it('atomically reconciles a terminal lifecycle only to the exact healthy runtime generation', async () => {
    const database = createHealthyRuntimeReconcileDatabase({ rowCount: 1 });
    const repository = new WorkerRuntimeRepository(
      database.database as never,
      {} as never
    );

    await expect(
      repository.reconcileHealthyRuntimeLifecycle({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: 'operation-1',
        expected_worker_status_id: EWorkerStatus.recreating,
        lifecycle_action: 'recreate',
        container_id: 'container-generation-4',
        runtime_generation: 4,
        phone: '5561999999999',
      })
    ).resolves.toBe(true);

    expect(database.updateChain.queryBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({
        container_id: 'container-generation-4',
        worker_status_id: EWorkerStatus.online,
        lifecycle_operation_id: null,
        recreate_completed_operation_id: 'operation-1',
        recreate_completed_runtime_generation: 4,
        recreate_completed_at: expect.anything(),
        number: '5561999999999',
        connection_date: '2026-07-15T18:30:00.000Z',
        last_connection_check_at: '2026-07-15T18:30:00.000Z',
        updated_at: '2026-07-15T18:30:00.000Z',
      })
    );

    const compiled = new PgDialect().sqlToQuery(
      (database.updateChain.queryBuilder.where as jest.Mock).mock
        .calls[0][0] as SQL
    );
    expect(compiled.sql).toContain('EXISTS');
    expect(compiled.sql).toContain('"worker_runtime"."container_id"');
    expect(compiled.sql).toContain('"worker_runtime"."runtime_generation"');
    expect(compiled.sql).toContain('"worker_runtime"."source_provider"');
    expect(compiled.sql).toContain(
      '"worker_runtime"."recreate_bootstrap_operation_id"'
    );
    expect(compiled.sql).toContain(
      '"worker_runtime"."recreate_retired_operation_id" IS NULL'
    );
    expect(compiled.sql).toContain(
      '"worker_runtime"."native_connection_online_acknowledged" IS TRUE'
    );
    expect(compiled.sql).toContain(
      '"worker_runtime"."native_connection_status" ->> \'provider\''
    );
    expect(compiled.sql).toContain('"whatsapp_session_lease"');
    expect(compiled.sql).toContain('"whatsapp_session_lease"."fencing_token"');
    expect(compiled.sql).toContain("clock_timestamp() + interval '5 seconds'");
    expect(compiled.sql).toContain('"worker"."lifecycle_operation_id"');
    expect(compiled.sql).toContain('"worker"."worker_status_id"');
    expect(compiled.sql).toContain('"worker"."deleted_at" is null');
    expect(compiled.params).toEqual(
      expect.arrayContaining([
        'worker-1',
        'account-1',
        'server-1',
        EWorkerType.wwebjs,
        'operation-1',
        EWorkerStatus.recreating,
        'container-generation-4',
        4,
        'wwebjs',
      ])
    );
    expect(database.statements[0]?.sql).toContain('SET LOCAL lock_timeout');
    expect(database.statements[1]?.sql).toContain(
      'SET LOCAL statement_timeout'
    );
    expect(database.events).toEqual(['worker_lock', 'runtime_lock', 'update']);
  });

  it('preserves the previous completion when bootstrap, retirement, operation, or generation CAS loses', async () => {
    const database = createHealthyRuntimeReconcileDatabase({ rowCount: 0 });
    const repository = new WorkerRuntimeRepository(
      database.database as never,
      {} as never
    );

    await expect(
      repository.reconcileHealthyRuntimeLifecycle({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: 'operation-1',
        expected_worker_status_id: EWorkerStatus.recreating,
        lifecycle_action: 'recreate',
        container_id: 'container-generation-4',
        runtime_generation: 4,
        phone: '5561999999999',
      })
    ).resolves.toBe(false);

    expect(database.updateChain.queryBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({
        recreate_completed_operation_id: 'operation-1',
        recreate_completed_runtime_generation: 4,
      })
    );
  });

  it.each([
    { missing: 'worker', workerLockPresent: false, runtimeLockPresent: true },
    { missing: 'runtime', workerLockPresent: true, runtimeLockPresent: false },
  ])(
    'fails closed without the $missing lock row and never issues the completion update',
    async ({ workerLockPresent, runtimeLockPresent }) => {
      const database = createHealthyRuntimeReconcileDatabase({
        rowCount: 1,
        workerLockPresent,
        runtimeLockPresent,
      });
      const repository = new WorkerRuntimeRepository(
        database.database as never,
        {} as never
      );

      await expect(
        repository.reconcileHealthyRuntimeLifecycle({
          worker_id: 'worker-1',
          account_id: 'account-1',
          server_id: 'server-1',
          worker_type_id: EWorkerType.wwebjs,
          lifecycle_operation_id: 'operation-1',
          expected_worker_status_id: EWorkerStatus.recreating,
          lifecycle_action: 'recreate',
          container_id: 'container-generation-4',
          runtime_generation: 4,
          phone: '5561999999999',
        })
      ).resolves.toBe(false);

      expect(database.updateChain.update).not.toHaveBeenCalled();
      expect(database.events).not.toContain('update');
    }
  );

  it('keeps create reconciliation compatible without recording a recreate completion', async () => {
    const database = createHealthyRuntimeReconcileDatabase({ rowCount: 1 });
    const repository = new WorkerRuntimeRepository(
      database.database as never,
      {} as never
    );

    await expect(
      repository.reconcileHealthyRuntimeLifecycle({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: 'operation-create',
        expected_worker_status_id: EWorkerStatus.creating,
        lifecycle_action: 'create',
        container_id: 'container-generation-1',
        runtime_generation: 1,
        phone: '5561999999999',
      })
    ).resolves.toBe(true);

    const setInput = database.updateChain.queryBuilder.set.mock.calls[0][0];
    expect(setInput).not.toHaveProperty('recreate_completed_operation_id');
    expect(setInput).not.toHaveProperty(
      'recreate_completed_runtime_generation'
    );
    expect(setInput).not.toHaveProperty('recreate_completed_at');
    const compiled = new PgDialect().sqlToQuery(
      database.updateChain.queryBuilder.where.mock.calls[0][0] as SQL
    );
    expect(compiled.sql).not.toContain('recreate_bootstrap_operation_id');
    expect(compiled.sql).not.toContain('recreate_retired_operation_id');
  });

  it('atomically claims an immutable container for the exact reserved lifecycle generation', async () => {
    const updateChain = createUpdateChain(1);
    const repository = new WorkerRuntimeRepository(
      { update: updateChain.update } as never,
      {} as never
    );

    await expect(
      repository.claimReservedRuntimeContainer({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: 'operation-1',
        expected_worker_status_id: EWorkerStatus.recreating,
        container_id: 'a'.repeat(64),
        container_name: 'worker-1',
        session_storage: EWorkerSessionStorage.legacy_volume,
        session_volume_name: 'worker-volume-1',
        runtime_generation: 4,
        warm_pool_id: null,
        source_provider: 'wwebjs',
      })
    ).resolves.toBe(true);

    expect(updateChain.queryBuilder.set).toHaveBeenCalledWith({
      container_id: 'a'.repeat(64),
      activated_at: '2026-07-15T18:30:00.000Z',
      updated_at: '2026-07-15T18:30:00.000Z',
    });
    const compiled = new PgDialect().sqlToQuery(
      updateChain.queryBuilder.where.mock.calls[0][0] as SQL
    );
    expect(compiled.sql).toContain('"worker_runtime"."container_id" is null');
    expect(compiled.sql).toContain('EXISTS');
    expect(compiled.sql).toContain('"worker"."lifecycle_operation_id"');
    expect(compiled.sql).toContain('"worker"."worker_status_id"');
    expect(compiled.sql).toContain('"worker_runtime"."source_provider"');
    expect(compiled.params).toEqual(
      expect.arrayContaining([
        'worker-1',
        'account-1',
        'server-1',
        EWorkerType.wwebjs,
        'operation-1',
        EWorkerStatus.recreating,
        'worker-volume-1',
        4,
        'wwebjs',
      ])
    );
  });

  it('claims a compatibility-v1 reservation only while the worker lifecycle remains NULL and creating', async () => {
    const updateChain = createUpdateChain(1);
    const repository = new WorkerRuntimeRepository(
      { update: updateChain.update } as never,
      {} as never
    );

    await expect(
      repository.claimReservedRuntimeContainer({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: null,
        expected_worker_status_id: EWorkerStatus.creating,
        container_id: 'b'.repeat(64),
        container_name: 'worker-1',
        session_storage: EWorkerSessionStorage.postgres,
        session_volume_name: null,
        runtime_generation: 5,
        warm_pool_id: null,
        source_provider: null,
      })
    ).resolves.toBe(true);

    const compiled = new PgDialect().sqlToQuery(
      updateChain.queryBuilder.where.mock.calls[0][0] as SQL
    );
    expect(compiled.sql).toContain('"worker"."lifecycle_operation_id" IS NULL');
    expect(compiled.sql).toContain('"worker"."worker_status_id"');
    expect(compiled.params).toEqual(
      expect.arrayContaining([
        'worker-1',
        'account-1',
        'server-1',
        EWorkerType.wwebjs,
        EWorkerStatus.creating,
        5,
      ])
    );
  });

  it('does not claim a container after the reserved generation is superseded', async () => {
    const updateChain = createUpdateChain(0);
    const repository = new WorkerRuntimeRepository(
      { update: updateChain.update } as never,
      {} as never
    );

    await expect(
      repository.claimReservedRuntimeContainer({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: 'operation-1',
        expected_worker_status_id: EWorkerStatus.recreating,
        container_id: 'a'.repeat(64),
        container_name: 'worker-1',
        session_storage: EWorkerSessionStorage.legacy_volume,
        session_volume_name: 'worker-volume-1',
        runtime_generation: 4,
      })
    ).resolves.toBe(false);
  });

  it('claims a previous-provider runtime while fencing the worker by its current target identity', async () => {
    const updateChain = createUpdateChain(1);
    const repository = new WorkerRuntimeRepository(
      { update: updateChain.update } as never,
      {} as never
    );

    await expect(
      repository.claimPreviousRuntimeContainer({
        worker_id: 'worker-1',
        account_id: 'account-1',
        current_server_id: 'server-new',
        current_worker_type_id: EWorkerType.whatsmeow,
        previous_server_id: 'server-old',
        previous_worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: 'operation-1',
        expected_worker_status_id: EWorkerStatus.recreating,
        remove_session: true,
        remove_volume: true,
        container_id: 'a'.repeat(64),
        container_name: 'worker-1',
        session_storage: EWorkerSessionStorage.legacy_volume,
        session_volume_name: 'worker-volume-1',
        runtime_generation: 4,
        warm_pool_id: null,
        source_provider: 'wwebjs',
      })
    ).resolves.toBe(true);

    const compiled = new PgDialect().sqlToQuery(
      updateChain.queryBuilder.where.mock.calls[0][0] as SQL
    );
    expect(compiled.sql).toContain('EXISTS');
    expect(compiled.sql).toContain('"worker"."server_id"');
    expect(compiled.sql).toContain('"worker"."worker_type_id"');
    expect(compiled.sql).toContain('"worker_runtime"."source_provider"');
    expect(compiled.params).toEqual(
      expect.arrayContaining([
        'worker-1',
        'account-1',
        'server-new',
        EWorkerType.whatsmeow,
        'operation-1',
        EWorkerStatus.recreating,
        'worker-volume-1',
        4,
        'wwebjs',
      ])
    );
    expect(compiled.params).not.toContain('server-old');
  });

  it('claims a previous PostgreSQL runtime without deleting the shared session', async () => {
    const updateChain = createUpdateChain(1);
    const repository = new WorkerRuntimeRepository(
      { update: updateChain.update } as never,
      {} as never
    );

    await expect(
      repository.claimPreviousRuntimeContainer({
        worker_id: 'worker-1',
        account_id: 'account-1',
        current_server_id: 'server-new',
        current_worker_type_id: EWorkerType.baileys,
        previous_server_id: 'server-old',
        previous_worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: 'operation-1',
        expected_worker_status_id: EWorkerStatus.recreating,
        remove_session: false,
        remove_volume: false,
        container_id: 'a'.repeat(64),
        container_name: 'worker-1',
        session_storage: EWorkerSessionStorage.postgres,
        session_volume_name: null,
        runtime_generation: 4,
        warm_pool_id: null,
        source_provider: 'wwebjs',
      })
    ).resolves.toBe(true);

    expect(updateChain.update).toHaveBeenCalledTimes(1);
  });

  it('rejects a previous-runtime claim whose provider contradicts the retired worker type', async () => {
    const updateChain = createUpdateChain(1);
    const repository = new WorkerRuntimeRepository(
      { update: updateChain.update } as never,
      {} as never
    );

    await expect(
      repository.claimPreviousRuntimeContainer({
        worker_id: 'worker-1',
        account_id: 'account-1',
        current_server_id: 'server-new',
        current_worker_type_id: EWorkerType.whatsmeow,
        previous_server_id: 'server-old',
        previous_worker_type_id: EWorkerType.wwebjs,
        lifecycle_operation_id: 'operation-1',
        expected_worker_status_id: EWorkerStatus.recreating,
        remove_session: true,
        remove_volume: true,
        container_id: 'a'.repeat(64),
        container_name: 'worker-1',
        session_storage: EWorkerSessionStorage.legacy_volume,
        session_volume_name: 'worker-volume-1',
        runtime_generation: 4,
        source_provider: 'baileys',
      })
    ).resolves.toBe(false);

    expect(updateChain.update).not.toHaveBeenCalled();
  });

  it('fails closed before issuing SQL for a worker type without a runtime provider', async () => {
    const updateChain = createUpdateChain(1);
    const repository = new WorkerRuntimeRepository(
      { update: updateChain.update } as never,
      {} as never
    );

    await expect(
      repository.reconcileHealthyRuntimeLifecycle({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.telegram,
        lifecycle_operation_id: 'operation-1',
        expected_worker_status_id: EWorkerStatus.recreating,
        lifecycle_action: 'recreate',
        container_id: 'container-generation-4',
        runtime_generation: 4,
        phone: '5561999999999',
      })
    ).resolves.toBe(false);

    expect(updateChain.update).not.toHaveBeenCalled();
  });

  it('atomically reserves the first runtime generation on the primary database', async () => {
    const insertChain = createInsertChain([{ runtime_generation: 1 }]);
    const select = jest.fn();
    const repository = new WorkerRuntimeRepository(
      { insert: insertChain.insert } as never,
      { select } as never
    );

    await expect(
      repository.reserveNextRuntimeGeneration({
        worker_id: 'worker-1',
        session_storage: EWorkerSessionStorage.legacy_volume,
        session_volume_name: 'worker-volume-1',
      })
    ).resolves.toBe(1);

    expect(select).not.toHaveBeenCalled();
    expect(insertChain.queryBuilder.values).toHaveBeenCalledWith({
      worker_id: 'worker-1',
      container_id: null,
      container_name: 'worker-1',
      session_storage: EWorkerSessionStorage.legacy_volume,
      session_volume_name: 'worker-volume-1',
      runtime_generation: 1,
      warm_pool_id: null,
      activated_at: '2026-07-15T18:30:00.000Z',
      updated_at: '2026-07-15T18:30:00.000Z',
    });
    expect(insertChain.queryBuilder.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          container_id: null,
          container_name: 'worker-1',
          session_volume_name: 'worker-volume-1',
          runtime_generation: expect.anything(),
          warm_pool_id: null,
          updated_at: '2026-07-15T18:30:00.000Z',
        }),
      })
    );
    expect(insertChain.queryBuilder.returning).toHaveBeenCalledWith(
      expect.objectContaining({ runtime_generation: expect.anything() })
    );
  });

  it('returns the generation incremented by PostgreSQL without a read-then-write query', async () => {
    const insertChain = createInsertChain([{ runtime_generation: 8 }]);
    const select = jest.fn();
    const repository = new WorkerRuntimeRepository(
      { insert: insertChain.insert } as never,
      { select } as never
    );

    await expect(
      repository.reserveNextRuntimeGeneration({
        worker_id: 'worker-1',
        container_name: 'runtime-worker-1',
        session_storage: EWorkerSessionStorage.legacy_volume,
        session_volume_name: 'worker-volume-1',
        warm_pool_id: 'warm-pool-1',
      })
    ).resolves.toBe(8);

    expect(select).not.toHaveBeenCalled();
    expect(insertChain.queryBuilder.onConflictDoUpdate).toHaveBeenCalledTimes(
      1
    );
    expect(insertChain.queryBuilder.execute).toHaveBeenCalledTimes(1);
    expect(insertChain.queryBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        container_id: null,
        container_name: 'runtime-worker-1',
        session_volume_name: 'worker-volume-1',
        warm_pool_id: 'warm-pool-1',
      })
    );
  });

  it('reserves at least the durable runtime-fence generation floor', async () => {
    const insertChain = createInsertChain([{ runtime_generation: 90 }]);
    const repository = new WorkerRuntimeRepository(
      { insert: insertChain.insert } as never,
      {} as never
    );

    await expect(
      repository.reserveNextRuntimeGeneration({
        worker_id: 'worker-1',
        session_storage: EWorkerSessionStorage.legacy_volume,
        session_volume_name: 'worker-volume-1',
        minimum_runtime_generation: 90,
      })
    ).resolves.toBe(90);

    expect(insertChain.queryBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({ runtime_generation: 90 })
    );
    expect(insertChain.queryBuilder.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          runtime_generation: expect.anything(),
        }),
      })
    );
  });

  it('fails closed when PostgreSQL does not return the reserved generation', async () => {
    const insertChain = createInsertChain([]);
    const repository = new WorkerRuntimeRepository(
      { insert: insertChain.insert } as never,
      {} as never
    );

    await expect(
      repository.reserveNextRuntimeGeneration({
        worker_id: 'worker-1',
        session_storage: EWorkerSessionStorage.legacy_volume,
        session_volume_name: 'worker-volume-1',
      })
    ).rejects.toThrow('Failed to reserve worker runtime generation');
  });

  it('fences an explicit stale generation during upsert', async () => {
    const insertChain = createInsertChain([]);
    const repository = new WorkerRuntimeRepository(
      { insert: insertChain.insert } as never,
      {} as never
    );

    await expect(
      repository.upsert({
        worker_id: 'worker-1',
        container_id: 'container-stale',
        container_name: 'worker-1',
        session_volume_name: 'worker-volume-1',
        runtime_generation: 6,
      })
    ).rejects.toBeInstanceOf(StaleWorkerRuntimeGenerationError);

    expect(insertChain.queryBuilder.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        setWhere: expect.anything(),
        set: expect.objectContaining({
          container_id: 'container-stale',
          runtime_generation: 6,
        }),
      })
    );
  });

  it('rejects a same-generation container replacement when the runtime carries an irreversible retirement tombstone', async () => {
    const insertChain = createInsertChain([]);
    const repository = new WorkerRuntimeRepository(
      { insert: insertChain.insert } as never,
      {} as never
    );

    await expect(
      repository.upsert({
        worker_id: 'worker-1',
        container_id: 'container-generation-7-b',
        container_name: 'worker-1',
        session_volume_name: 'worker-volume-1',
        runtime_generation: 7,
      })
    ).rejects.toBeInstanceOf(StaleWorkerRuntimeGenerationError);

    const conflict = insertChain.queryBuilder.onConflictDoUpdate.mock
      .calls[0][0] as { setWhere: SQL };
    const compiled = new PgDialect().sqlToQuery(conflict.setWhere);
    const querySql = compiled.sql.replace(/\s+/gu, ' ').trim();
    expect(querySql).toContain('"worker_runtime"."runtime_generation" <');
    expect(querySql).toContain(
      '"worker_runtime"."recreate_retired_operation_id" is null'
    );
    expect(querySql).toContain(
      '"worker_runtime"."container_id" IS NOT DISTINCT FROM'
    );
    expect(compiled.params).toContain('container-generation-7-b');
  });

  it('allows an idempotent explicit generation upsert through the monotonic fence', async () => {
    const runtime = {
      worker_id: 'worker-1',
      container_id: 'container-current',
      container_name: 'worker-1',
      session_volume_name: 'worker-volume-1',
      runtime_generation: 7,
    };
    const insertChain = createInsertChain([runtime]);
    const repository = new WorkerRuntimeRepository(
      { insert: insertChain.insert } as never,
      {} as never
    );

    await expect(repository.upsert(runtime)).resolves.toEqual(runtime);

    expect(insertChain.queryBuilder.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ setWhere: expect.anything() })
    );
  });
});
