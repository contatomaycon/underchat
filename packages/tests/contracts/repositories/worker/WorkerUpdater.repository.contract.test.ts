import 'reflect-metadata';
import { WorkerUpdaterRepository } from '@core/repositories/worker/WorkerUpdater.repository';
import { currentTime } from '@core/common/functions/currentTime';
import { SQL, sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

function createReplacementCompletionDatabase(input: {
  accountId: string;
  workerId: string;
  operationId: string;
  containerId: string;
  runtimeGeneration: number;
  retired?: boolean;
  updateRowCount?: number;
}) {
  const updateExecute = jest.fn(async () => ({
    rowCount: input.updateRowCount ?? 1,
  }));
  const where = jest.fn(() => ({ execute: updateExecute }));
  const set = jest.fn(() => ({ where }));
  const runtimeWhere = jest.fn(
    (condition: SQL) => sql`select 1 where ${condition}`
  );
  const lockOrder: string[] = [];
  const execute = jest.fn(async (query: SQL) => {
    const statement = new PgDialect().sqlToQuery(query).sql;
    if (statement.includes('FROM public.worker AS owner')) {
      lockOrder.push('worker');
      return {
        rows: [
          {
            worker_id: input.workerId,
            account_id: input.accountId,
            deleted_at: null,
          },
        ],
      };
    }
    if (statement.includes('FROM public.worker_runtime AS runtime')) {
      lockOrder.push('runtime');
      return {
        rows: [
          {
            container_id: input.containerId,
            runtime_generation: input.runtimeGeneration,
            recreate_bootstrap_operation_id: input.operationId,
            recreate_bootstrap_runtime_generation: input.runtimeGeneration,
            recreate_bootstrap_container_id: input.containerId,
            recreate_bootstrap_started_at: '2026-08-08T00:00:00.000Z',
            recreate_retired_operation_id: input.retired
              ? input.operationId
              : null,
            recreate_retired_runtime_generation: input.retired
              ? input.runtimeGeneration
              : null,
            recreate_retired_container_id: input.retired
              ? input.containerId
              : null,
            recreate_retired_at: input.retired
              ? '2026-08-08T00:00:01.000Z'
              : null,
          },
        ],
      };
    }
    return { rows: [] };
  });
  const transaction = jest.fn(
    async (
      operation: (database: {
        update: jest.Mock;
        execute: typeof execute;
      }) => Promise<boolean>
    ) => operation({ update: jest.fn(() => ({ set })), execute })
  );
  return {
    database: {
      select: jest.fn(() => ({
        from: jest.fn(() => ({ where: runtimeWhere })),
      })),
      transaction,
    },
    execute,
    lockOrder,
    runtimeWhere,
    set,
    transaction,
    updateExecute,
  };
}

describe('WorkerUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (currentTime as jest.Mock).mockReturnValue('2026-04-21T10:00:00.000Z');
  });

  it('updateInput maps optional fields including in-operator properties', () => {
    const repository = new WorkerUpdaterRepository({} as never);

    const payload = (repository as any).updateInput({
      worker_status_id: 'status-1',
      worker_type_id: 'type-1',
      session_storage: 'postgres',
      server_id: 'server-1',
      name: 'Worker 1',
      number: null,
      container_id: 'container-1',
      connection_date: '2026-04-21T10:00:00.000Z',
      recreate_available_at: '2026-06-11T12:02:00.000Z',
      deleted_at: '2026-04-21T10:00:00.000Z',
    });

    expect(payload).toEqual({
      worker_status_id: 'status-1',
      worker_type_id: 'type-1',
      session_storage: 'postgres',
      server_id: 'server-1',
      name: 'Worker 1',
      number: null,
      container_id: 'container-1',
      connection_date: '2026-04-21T10:00:00.000Z',
      recreate_available_at: '2026-06-11T12:02:00.000Z',
      deleted_at: '2026-04-21T10:00:00.000Z',
    });
  });

  it('returns false when there are no fields to update', async () => {
    const repository = new WorkerUpdaterRepository({} as never);

    await expect(
      repository.updateWorkerById('account-1', { worker_id: 'w-1' } as never)
    ).resolves.toBe(false);
  });

  it('returns true when update affects one row', async () => {
    const set = jest.fn(() => ({
      where: jest.fn(() => ({
        execute: jest.fn(async () => ({ rowCount: 1 })),
      })),
    }));
    const repository = new WorkerUpdaterRepository({
      update: jest.fn(() => ({ set })),
    } as never);

    await expect(
      repository.updateWorkerById('account-1', {
        worker_id: 'w-1',
        name: 'Worker 1',
      } as never)
    ).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Worker 1',
        updated_at: '2026-04-21T10:00:00.000Z',
      })
    );
  });

  it('returns false when update affects zero rows', async () => {
    const repository = new WorkerUpdaterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 0 })),
          })),
        })),
      })),
    } as never);

    await expect(
      repository.updateWorkerById('account-1', {
        worker_id: 'w-1',
        name: 'Worker 1',
      } as never)
    ).resolves.toBe(false);
  });

  it('applies the expected worker status in lifecycle-guarded updates', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const where = jest.fn(() => ({ execute }));
    const set = jest.fn(() => ({ where }));
    const repository = new WorkerUpdaterRepository({
      update: jest.fn(() => ({ set })),
    } as never);

    await expect(
      repository.updateWorkerByIdIfLifecycleMatches(
        'account-1',
        {
          worker_id: 'w-1',
          worker_status_id: 'available',
        } as never,
        {
          lifecycle_operation_id: 'operation-1',
          worker_status_id: 'creating',
        }
      )
    ).resolves.toBe(true);

    expect(where).toHaveBeenCalledTimes(1);
  });

  it('claims the worker and requests a provider handoff in one transaction', async () => {
    const updateExecute = jest.fn(async () => ({ rowCount: 1 }));
    const where = jest.fn(() => ({ execute: updateExecute }));
    const set = jest.fn(() => ({ where }));
    const execute = jest.fn<Promise<{ rows: never[] }>, [query: SQL]>(
      async () => ({ rows: [] })
    );
    const transaction = jest.fn(
      async (
        operation: (database: {
          update: jest.Mock;
          execute: typeof execute;
        }) => Promise<boolean>
      ) => operation({ update: jest.fn(() => ({ set })), execute })
    );
    const repository = new WorkerUpdaterRepository({ transaction } as never);

    await expect(
      repository.updateWorkerByIdIfLifecycleMatches(
        '00000000-0000-4000-8000-000000000002',
        {
          worker_id: '00000000-0000-4000-8000-000000000001',
          worker_type_id: 'target-type',
          worker_status_id: 'recreating',
          lifecycle_operation_id: '00000000-0000-4000-8000-000000000003',
        } as never,
        {
          lifecycle_operation_id: null,
          whatsapp_provider_handoff: {
            source_provider: 'whatsmeow',
            target_provider: 'baileys',
            lifecycle_operation_id: '00000000-0000-4000-8000-000000000003',
          },
        }
      )
    ).resolves.toBe(true);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    const compiled = new PgDialect().sqlToQuery(
      execute.mock.calls[0][0] as unknown as SQL
    );
    expect(compiled.sql).toContain('request_whatsapp_provider_handoff');
    expect(compiled.params).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      'whatsmeow',
      'baileys',
      '00000000-0000-4000-8000-000000000003',
    ]);
  });

  it('fences PostgreSQL runtimes on an explicitly null session volume', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const where = jest.fn(() => ({ execute }));
    const runtimeWhere = jest.fn(
      (condition: SQL) => sql`select 1 where ${condition}`
    );
    const repository = new WorkerUpdaterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({ where })),
      })),
      select: jest.fn(() => ({
        from: jest.fn(() => ({ where: runtimeWhere })),
      })),
    } as never);

    await expect(
      repository.updateWorkerByIdIfLifecycleMatches(
        'account-1',
        {
          worker_id: 'w-1',
          worker_status_id: 'available',
        } as never,
        {
          runtime_container_id: 'container-1',
          runtime_generation: 9,
          runtime_session_volume_name: null,
        }
      )
    ).resolves.toBe(true);

    const runtimeFence = new PgDialect().sqlToQuery(
      runtimeWhere.mock.calls[0][0]
    );
    expect(runtimeFence.sql).toContain(
      '"worker_runtime"."session_volume_name" is null'
    );
    expect(runtimeFence.params).toEqual(
      expect.arrayContaining(['container-1', 9])
    );
  });

  it('compares the observed updated_at exactly in lifecycle-guarded updates', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const where = jest.fn(() => ({ execute }));
    const set = jest.fn(() => ({ where }));
    const repository = new WorkerUpdaterRepository({
      update: jest.fn(() => ({ set })),
    } as never);
    const observedUpdatedAt = '2026-07-17T14:11:56.578-03:00';

    await expect(
      repository.updateWorkerByIdIfLifecycleMatches(
        'account-1',
        {
          worker_id: 'w-1',
          worker_status_id: 'available',
        } as never,
        {
          lifecycle_operation_id: null,
          worker_status_id: 'online',
          updated_at: observedUpdatedAt,
        }
      )
    ).resolves.toBe(true);

    const compiled = new PgDialect().sqlToQuery(
      (where as jest.Mock).mock.calls[0][0] as SQL
    );
    expect(compiled.sql).toContain('"worker"."deleted_at" is null');
    expect(compiled.sql).toContain('"worker"."lifecycle_operation_id" is null');
    expect(compiled.sql).toContain('"worker"."updated_at" =');
    expect(compiled.params).toContain(observedUpdatedAt);
  });

  it('compares the observed connection check exactly in lifecycle-guarded updates', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const where = jest.fn(() => ({ execute }));
    const set = jest.fn(() => ({ where }));
    const repository = new WorkerUpdaterRepository({
      update: jest.fn(() => ({ set })),
    } as never);
    const observedConnectionCheck = '2026-07-27T18:12:03.123-03:00';

    await expect(
      repository.updateWorkerByIdIfLifecycleMatches(
        'account-1',
        {
          worker_id: 'w-1',
          worker_status_id: 'stopped',
        } as never,
        {
          lifecycle_operation_id: null,
          worker_status_id: 'offline',
          last_connection_check_at: observedConnectionCheck,
        }
      )
    ).resolves.toBe(true);

    const compiled = new PgDialect().sqlToQuery(
      (where as jest.Mock).mock.calls[0][0] as SQL
    );
    expect(compiled.sql).toContain('"worker"."last_connection_check_at" =');
    expect(compiled.params).toContain(observedConnectionCheck);
  });

  it('writes a replacement completion only behind the exact bootstrap marker', async () => {
    const operationId = '019fdf2c-63af-73e2-8107-3442eeeb8e19';
    const oldContainerId = 'a'.repeat(64);
    const newContainerId = 'b'.repeat(64);
    const fixture = createReplacementCompletionDatabase({
      accountId: 'account-1',
      workerId: 'worker-1',
      operationId,
      containerId: newContainerId,
      runtimeGeneration: 16,
    });
    const repository = new WorkerUpdaterRepository(fixture.database as never);

    await expect(
      repository.updateWorkerByIdIfLifecycleMatches(
        'account-1',
        {
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.online,
          container_id: newContainerId,
          lifecycle_operation_id: null,
        } as never,
        {
          lifecycle_operation_id: operationId,
          container_id: oldContainerId,
          runtime_container_id: newContainerId,
          runtime_generation: 16,
          worker_status_id: EWorkerStatus.recreating,
          recreate_completion: {
            operation_id: operationId,
            runtime_generation: 16,
            mode: 'replacement_runtime',
          },
        }
      )
    ).resolves.toBe(true);

    expect(fixture.set).toHaveBeenCalledWith(
      expect.objectContaining({
        recreate_completed_operation_id: operationId,
        recreate_completed_runtime_generation: 16,
        recreate_completed_at: expect.any(SQL),
      })
    );
    const compiledRuntimeFences = fixture.runtimeWhere.mock.calls.map(
      ([condition]) => new PgDialect().sqlToQuery(condition)
    );
    expect(
      compiledRuntimeFences.some(
        ({ sql: statement, params }) =>
          statement.includes('recreate_bootstrap_operation_id') &&
          statement.includes('recreate_bootstrap_started_at') &&
          params.includes(operationId) &&
          params.includes(newContainerId) &&
          params.includes(16)
      )
    ).toBe(true);
    expect(
      compiledRuntimeFences.some(
        ({ sql: statement }) =>
          statement.includes('recreate_retired_operation_id') &&
          statement.includes('recreate_retired_runtime_generation') &&
          statement.includes('recreate_retired_container_id') &&
          statement.includes('recreate_retired_at')
      )
    ).toBe(true);
    expect(fixture.lockOrder).toEqual(['worker', 'runtime']);
  });

  it('loses atomically to a runtime retirement that acquires the ordered runtime lock first', async () => {
    const operationId = '019fdf2c-63af-73e2-8107-3442eeeb8e19';
    const oldContainerId = 'a'.repeat(64);
    const targetContainerId = 'b'.repeat(64);
    const fixture = createReplacementCompletionDatabase({
      accountId: 'account-1',
      workerId: 'worker-1',
      operationId,
      containerId: targetContainerId,
      runtimeGeneration: 16,
      retired: true,
    });
    const repository = new WorkerUpdaterRepository(fixture.database as never);

    await expect(
      repository.updateWorkerByIdIfLifecycleMatches(
        'account-1',
        {
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.online,
          container_id: targetContainerId,
          lifecycle_operation_id: null,
        } as never,
        {
          lifecycle_operation_id: operationId,
          container_id: oldContainerId,
          runtime_container_id: targetContainerId,
          runtime_generation: 16,
          worker_status_id: EWorkerStatus.recreating,
          recreate_completion: {
            operation_id: operationId,
            runtime_generation: 16,
            mode: 'replacement_runtime',
          },
        }
      )
    ).resolves.toBe(false);

    expect(fixture.lockOrder).toEqual(['worker', 'runtime']);
    expect(fixture.updateExecute).not.toHaveBeenCalled();
  });

  it('rejects a replacement completion for the same physical container', async () => {
    const update = jest.fn();
    const repository = new WorkerUpdaterRepository({ update } as never);
    const operationId = '019fdf2c-63af-73e2-8107-3442eeeb8e19';
    const containerId = 'a'.repeat(64);

    await expect(
      repository.updateWorkerByIdIfLifecycleMatches(
        'account-1',
        {
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.online,
          lifecycle_operation_id: null,
        } as never,
        {
          lifecycle_operation_id: operationId,
          container_id: containerId,
          runtime_container_id: containerId.slice(0, 12),
          runtime_generation: 16,
          worker_status_id: EWorkerStatus.recreating,
          recreate_completion: {
            operation_id: operationId,
            runtime_generation: 16,
            mode: 'replacement_runtime',
          },
        }
      )
    ).resolves.toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it.each([EWorkerStatus.online, EWorkerStatus.recreating])(
    'completes a same-target replacement from %s only behind the exact bootstrap marker',
    async (workerStatusId) => {
      const operationId = '019fdf2c-63af-73e2-8107-3442eeeb8e19';
      const targetContainerId = 'b'.repeat(64);
      const fixture = createReplacementCompletionDatabase({
        accountId: 'account-1',
        workerId: 'worker-1',
        operationId,
        containerId: targetContainerId,
        runtimeGeneration: 16,
      });
      const repository = new WorkerUpdaterRepository(fixture.database as never);

      await expect(
        repository.updateWorkerByIdIfLifecycleMatches(
          'account-1',
          {
            worker_id: 'worker-1',
            worker_status_id: EWorkerStatus.online,
            container_id: targetContainerId,
            lifecycle_operation_id: null,
          } as never,
          {
            lifecycle_operation_id: operationId,
            container_id: targetContainerId,
            runtime_container_id: targetContainerId,
            runtime_generation: 16,
            worker_status_id: workerStatusId,
            recreate_completion: {
              operation_id: operationId,
              runtime_generation: 16,
              mode: 'replacement_runtime_already_online',
            },
          }
        )
      ).resolves.toBe(true);

      expect(fixture.set).toHaveBeenCalledWith(
        expect.objectContaining({
          recreate_completed_operation_id: operationId,
          recreate_completed_runtime_generation: 16,
          recreate_completed_at: expect.any(SQL),
        })
      );
      const compiledRuntimeFences = fixture.runtimeWhere.mock.calls.map(
        ([condition]) => new PgDialect().sqlToQuery(condition)
      );
      expect(
        compiledRuntimeFences.some(
          ({ sql: statement, params }) =>
            statement.includes('recreate_bootstrap_operation_id') &&
            statement.includes('recreate_bootstrap_runtime_generation') &&
            statement.includes('recreate_bootstrap_container_id') &&
            statement.includes('recreate_bootstrap_started_at') &&
            params.includes(operationId) &&
            params.includes(targetContainerId) &&
            params.includes(16)
        )
      ).toBe(true);
      expect(fixture.lockOrder).toEqual(['worker', 'runtime']);
    }
  );

  it.each([
    {
      name: 'the worker is not ONLINE or RECREATING',
      workerStatusId: EWorkerStatus.creating,
      targetContainerId: 'b'.repeat(64),
      operationId: '019fdf2c-63af-73e2-8107-3442eeeb8e19',
      completionOperationId: '019fdf2c-63af-73e2-8107-3442eeeb8e19',
      generation: 16,
    },
    {
      name: 'the update does not target the runtime',
      workerStatusId: EWorkerStatus.online,
      targetContainerId: 'c'.repeat(64),
      operationId: '019fdf2c-63af-73e2-8107-3442eeeb8e19',
      completionOperationId: '019fdf2c-63af-73e2-8107-3442eeeb8e19',
      generation: 16,
    },
    {
      name: 'the operation identity differs',
      workerStatusId: EWorkerStatus.online,
      targetContainerId: 'b'.repeat(64),
      operationId: '019fdf2c-63af-73e2-8107-3442eeeb8e19',
      completionOperationId: '019fdf2c-63af-73e2-8107-3442eeeb8e20',
      generation: 16,
    },
    {
      name: 'the runtime generation is invalid',
      workerStatusId: EWorkerStatus.online,
      targetContainerId: 'b'.repeat(64),
      operationId: '019fdf2c-63af-73e2-8107-3442eeeb8e19',
      completionOperationId: '019fdf2c-63af-73e2-8107-3442eeeb8e19',
      generation: 0,
    },
  ])(
    'rejects already-online replacement completion when $name',
    async (test) => {
      const update = jest.fn();
      const repository = new WorkerUpdaterRepository({ update } as never);
      const runtimeContainerId = 'b'.repeat(64);

      await expect(
        repository.updateWorkerByIdIfLifecycleMatches(
          'account-1',
          {
            worker_id: 'worker-1',
            worker_status_id: EWorkerStatus.online,
            container_id: test.targetContainerId,
            lifecycle_operation_id: null,
          } as never,
          {
            lifecycle_operation_id: test.operationId,
            container_id: runtimeContainerId,
            runtime_container_id: runtimeContainerId,
            runtime_generation: test.generation,
            worker_status_id: test.workerStatusId,
            recreate_completion: {
              operation_id: test.completionOperationId,
              runtime_generation: test.generation,
              mode: 'replacement_runtime_already_online',
            },
          }
        )
      ).resolves.toBe(false);
      expect(update).not.toHaveBeenCalled();
    }
  );

  it('rejects a replacement tombstone when the update does not move the worker pointer to the marked runtime', async () => {
    const update = jest.fn();
    const repository = new WorkerUpdaterRepository({ update } as never);
    const operationId = '019fdf2c-63af-73e2-8107-3442eeeb8e19';

    await expect(
      repository.updateWorkerByIdIfLifecycleMatches(
        'account-1',
        {
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.online,
          container_id: 'c'.repeat(64),
          lifecycle_operation_id: null,
        } as never,
        {
          lifecycle_operation_id: operationId,
          container_id: 'a'.repeat(64),
          runtime_container_id: 'b'.repeat(64),
          runtime_generation: 16,
          worker_status_id: EWorkerStatus.recreating,
          recreate_completion: {
            operation_id: operationId,
            runtime_generation: 16,
            mode: 'replacement_runtime',
          },
        }
      )
    ).resolves.toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('allows only ONLINE for a strictly revalidated current runtime', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const where = jest.fn(() => ({ execute }));
    const set = jest.fn(() => ({ where }));
    const runtimeWhere = jest.fn(
      (condition: SQL) => sql`select 1 where ${condition}`
    );
    const repository = new WorkerUpdaterRepository({
      update: jest.fn(() => ({ set })),
      select: jest.fn(() => ({
        from: jest.fn(() => ({ where: runtimeWhere })),
      })),
    } as never);
    const operationId = '019fdf2c-63af-73e2-8107-3442eeeb8e19';
    const containerId = 'a'.repeat(64);
    const guard = {
      lifecycle_operation_id: operationId,
      container_id: containerId,
      runtime_container_id: containerId,
      runtime_generation: 16,
      worker_status_id: EWorkerStatus.recreating,
      recreate_completion: {
        operation_id: operationId,
        runtime_generation: 16,
        mode: 'revalidated_current_runtime' as const,
      },
    };

    await expect(
      repository.updateWorkerByIdIfLifecycleMatches(
        'account-1',
        {
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.online,
          lifecycle_operation_id: null,
        } as never,
        guard
      )
    ).resolves.toBe(true);
    await expect(
      repository.updateWorkerByIdIfLifecycleMatches(
        'account-1',
        {
          worker_id: 'worker-1',
          worker_status_id: EWorkerStatus.disponible,
          lifecycle_operation_id: null,
        } as never,
        guard
      )
    ).resolves.toBe(false);
  });

  it('uses cooldown guard when updating recreate state', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const where = jest.fn(() => ({ execute }));
    const set = jest.fn(() => ({ where }));
    const repository = new WorkerUpdaterRepository({
      update: jest.fn(() => ({ set })),
    } as never);

    await expect(
      repository.updateWorkerByIdIfRecreateAvailable(
        'account-1',
        {
          worker_id: 'w-1',
          recreate_available_at: '2026-06-11T12:02:00.000Z',
        } as never,
        '2026-06-11T12:00:00.000Z'
      )
    ).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        recreate_available_at: '2026-06-11T12:02:00.000Z',
        updated_at: '2026-04-21T10:00:00.000Z',
      })
    );
    expect(where).toHaveBeenCalled();
  });

  it('combines cooldown and lifecycle snapshot guards atomically', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const where = jest.fn(() => ({ execute }));
    const set = jest.fn(() => ({ where }));
    const repository = new WorkerUpdaterRepository({
      update: jest.fn(() => ({ set })),
    } as never);

    await expect(
      repository.updateWorkerByIdIfRecreateAvailable(
        'account-1',
        {
          worker_id: 'w-1',
          worker_status_id: 'recreating',
          lifecycle_operation_id: 'operation-2',
          recreate_available_at: '2026-06-11T12:02:00.000Z',
        } as never,
        '2026-06-11T12:00:00.000Z',
        {
          lifecycle_operation_id: null,
          server_id: 'server-1',
          worker_type_id: 'type-1',
          worker_status_id: 'online',
        }
      )
    ).resolves.toBe(true);

    const compiled = new PgDialect().sqlToQuery(
      (where as jest.Mock).mock.calls[0][0] as SQL
    );

    expect(compiled.sql).toContain('"worker"."recreate_available_at"');
    expect(compiled.sql).toContain('"worker"."lifecycle_operation_id" is null');
    expect(compiled.sql).toContain('"worker"."server_id"');
    expect(compiled.sql).toContain('"worker"."worker_type_id"');
    expect(compiled.sql).toContain('"worker"."worker_status_id"');
    expect(compiled.params).toEqual(
      expect.arrayContaining([
        'account-1',
        'w-1',
        '2026-06-11T12:00:00.000Z',
        'server-1',
        'type-1',
        'online',
      ])
    );
  });

  it('returns false when cooldown guard update affects zero rows', async () => {
    const repository = new WorkerUpdaterRepository({
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            execute: jest.fn(async () => ({ rowCount: 0 })),
          })),
        })),
      })),
    } as never);

    await expect(
      repository.updateWorkerByIdIfRecreateAvailable(
        'account-1',
        {
          worker_id: 'w-1',
          recreate_available_at: '2026-06-11T12:02:00.000Z',
        } as never,
        '2026-06-11T12:00:00.000Z'
      )
    ).resolves.toBe(false);
  });
});
