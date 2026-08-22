import 'reflect-metadata';

import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import {
  ConfigChannelsRecreateBatchIdentityConflictError,
  ConfigChannelsRecreateBatchRepository,
} from '@core/repositories/config/ConfigChannelsRecreateBatch.repository';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function collectSqlParts(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value !== 'object') return [String(value)];

  const record = value as {
    queryChunks?: unknown[];
    value?: unknown;
  };
  if (Array.isArray(record.queryChunks)) {
    return record.queryChunks.flatMap(collectSqlParts);
  }
  if (Array.isArray(record.value)) {
    return record.value.flatMap(collectSqlParts);
  }
  if ('value' in record && typeof record.value !== 'object') {
    return [String(record.value)];
  }
  return [];
}

function createLookupDatabase(candidates: Record<string, unknown>[]) {
  const insertChain = {
    values: jest.fn(),
    onConflictDoNothing: jest.fn(),
    returning: jest.fn(),
    execute: jest.fn(async () => []),
  } as any;
  insertChain.values.mockReturnValue(insertChain);
  insertChain.onConflictDoNothing.mockReturnValue(insertChain);
  insertChain.returning.mockReturnValue(insertChain);

  const selectChain = {
    from: jest.fn(),
    where: jest.fn(),
    execute: jest.fn(async () => candidates),
  } as any;
  selectChain.from.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);

  const tx = {
    insert: jest.fn(() => insertChain),
    select: jest.fn(() => selectChain),
  };
  return {
    transaction: jest.fn(async (callback: (input: typeof tx) => unknown) =>
      callback(tx)
    ),
  };
}

function createSelectChain(rows: Record<string, unknown>[]) {
  const chain = {
    from: jest.fn(),
    where: jest.fn(),
    for: jest.fn(),
    limit: jest.fn(),
    execute: jest.fn(async () => rows),
  } as any;
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.for.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  return chain;
}

function createUpdateChain() {
  const chain = {
    set: jest.fn(),
    where: jest.fn(),
    execute: jest.fn(async () => ({ rowCount: 1 })),
  } as any;
  chain.set.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return chain;
}

const filters = {
  status: EWorkerStatus.online,
  type: undefined,
  account: undefined,
  name: undefined,
  number: undefined,
};

describe('ConfigChannelsRecreateBatchRepository durable contract', () => {
  it('claims due or expired targets atomically with SKIP LOCKED leases', async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ server_id: 'server-1' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            config_channels_recreate_target_id: 'target-1',
            config_channels_recreate_batch_id: 'batch-1',
            account_id: 'requester-account',
            worker_id: 'worker-1',
            worker_account_id: 'worker-account',
            server_id: 'server-1',
            worker_type_id: 'worker-type-1',
            lifecycle_operation_id: 'operation-1',
            status: 'enqueued',
            attempt_count: 91,
            recreate_server_slot_key: 'slot-key',
            recreate_server_slot_token: 'slot-token',
            recreate_server_slot_index: 1,
          },
        ],
      });
    const repository = new ConfigChannelsRecreateBatchRepository({
      transaction: jest.fn(
        async (callback: (tx: { execute: typeof execute }) => unknown) =>
          callback({ execute })
      ),
    } as never);

    await expect(
      repository.claimNextTarget('owner-1', 90_000, 2)
    ).resolves.toEqual(
      expect.objectContaining({
        accountId: 'requester-account',
        workerAccountId: 'worker-account',
        workerTypeId: 'worker-type-1',
        status: 'enqueued',
        attemptCount: 91,
      })
    );

    const serverClaimQuery = collectSqlParts(execute.mock.calls[0][0]).join(
      ' '
    );
    const targetClaimQuery = collectSqlParts(execute.mock.calls[1][0]).join(
      ' '
    );
    const queries = `${serverClaimQuery} ${targetClaimQuery}`;
    expect(serverClaimQuery).toContain(
      'FOR UPDATE OF target_server SKIP LOCKED'
    );
    expect(targetClaimQuery).toContain('FOR UPDATE OF target SKIP LOCKED');
    expect(queries).toContain('active_target.server_id = target.server_id');
    expect(queries).toContain("active_target.status = 'processing'");
    expect(queries).toContain("active_target.status = 'enqueued'");
    expect(queries).toContain(
      'active_target.recreate_server_slot_key IS NOT NULL'
    );
    expect(queries).toContain(
      'active_target.recreate_server_slot_token IS NOT NULL'
    );
    expect(queries).toContain("leased_target.status = 'processing'");
    expect(queries).toContain("leased_target.status = 'enqueued'");
    expect(queries).toContain(
      'leased_target.recreate_server_slot_key IS NOT NULL'
    );
    expect(queries).toContain(
      'leased_target.recreate_server_slot_token IS NOT NULL'
    );
    expect(queries).toContain(
      'leased_target.lease_expires_at > clock_timestamp()'
    );
    expect(queries).toContain("active_batch.status IN ('queued', 'running')");
    expect(queries).toMatch(/COUNT\(\*\)[\s\S]*<\s*2/u);
    expect(queries).toContain("target.status = 'pending'");
    expect(queries).toContain("target.status IN ('processing', 'enqueued')");
    expect(queries).toContain('target.lease_expires_at <= clock_timestamp()');
    expect(targetClaimQuery).toContain('target.attempt_count + 1');
    expect(targetClaimQuery).toContain("INTERVAL '1 millisecond'");
    expect(targetClaimQuery).toContain('90000');
    expect(targetClaimQuery.indexOf('target.next_attempt_at ASC')).toBeLessThan(
      targetClaimQuery.indexOf('target.created_at ASC')
    );
    expect(queries).not.toContain(
      "CASE WHEN target.status = 'enqueued' THEN 0 ELSE 1 END"
    );
  });

  it('normalizes an invalid per-server claim capacity to one', async () => {
    const execute = jest.fn(async (_query: unknown) => ({ rows: [] }));
    const repository = new ConfigChannelsRecreateBatchRepository({
      transaction: jest.fn(
        async (callback: (tx: { execute: typeof execute }) => unknown) =>
          callback({ execute })
      ),
    } as never);

    await repository.claimNextTarget('owner-1', 90_000, Number.NaN);

    const query = collectSqlParts(execute.mock.calls[0][0]).join(' ');
    expect(query).toMatch(/COUNT\(\*\)[\s\S]*<\s*1/u);
  });

  it('renews leases from the PostgreSQL clock instead of a pod clock', async () => {
    const update = createUpdateChain();
    const repository = new ConfigChannelsRecreateBatchRepository({
      update: jest.fn(() => update),
    } as never);

    await expect(
      repository.renewTargetLease('target-1', 'owner-1', 90_000)
    ).resolves.toBe(true);

    const leaseExpression = update.set.mock.calls[0][0]
      .lease_expires_at as unknown;
    const query = collectSqlParts(leaseExpression).join(' ');
    expect(query).toContain('clock_timestamp()');
    expect(query).toContain("INTERVAL '1 millisecond'");
    expect(query).toContain('90000');
  });

  it('stops charging an enqueued target after its exact Redis slot is released', async () => {
    const update = createUpdateChain();
    const repository = new ConfigChannelsRecreateBatchRepository({
      update: jest.fn(() => update),
    } as never);

    await expect(
      repository.markTargetSlotReleased('target-1', 'owner-1', {
        key: 'worker:recreate:server:server-1:slot:0',
        token: 'worker-1:operation-1',
      })
    ).resolves.toBe(true);

    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({
        recreate_server_slot_key: null,
        recreate_server_slot_token: null,
        recreate_server_slot_index: null,
      })
    );
    const where = collectSqlParts(update.where.mock.calls[0][0]).join(' ');
    expect(where).toContain('target-1');
    expect(where).toContain('owner-1');
    expect(where).toContain('enqueued');
    expect(where).toContain('worker:recreate:server:server-1:slot:0');
    expect(where).toContain('worker-1:operation-1');
  });

  it('keeps the slot charged when the exact target lease cannot be fenced', async () => {
    const update = createUpdateChain();
    update.execute.mockResolvedValueOnce({ rowCount: 0 });
    const repository = new ConfigChannelsRecreateBatchRepository({
      update: jest.fn(() => update),
    } as never);

    await expect(
      repository.markTargetSlotReleased('target-1', 'stale-owner', {
        key: 'worker:recreate:server:server-1:slot:0',
        token: 'stale-token',
      })
    ).resolves.toBe(false);
  });

  it('captures the operation attempt baseline behind the worker lifecycle fence and preserves it on reclaim', async () => {
    const execute = jest.fn(async (_query: unknown) => ({
      rows: [{ config_channels_recreate_target_id: 'target-1' }],
    }));
    const repository = new ConfigChannelsRecreateBatchRepository({
      execute,
    } as never);

    await expect(
      repository.markTargetEnqueued('target-1', 'owner-1', 'operation-2', [])
    ).resolves.toBe(true);

    const query = collectSqlParts(execute.mock.calls[0][0]).join(' ');
    expect(query).toContain('FOR KEY SHARE OF active_worker');
    expect(query).toContain('FOR SHARE OF active_runtime');
    expect(query).toMatch(
      /active_worker\.lifecycle_operation_id\s*=\s*operation-2/u
    );
    expect(query).toMatch(
      new RegExp(
        `active_worker\\.worker_status_id\\s*=\\s*${EWorkerStatus.recreating}`,
        'u'
      )
    );
    expect(query).toContain(
      'active_worker.account_id = target.worker_account_id'
    );
    expect(query).toContain('active_worker.server_id = target.server_id');
    expect(query).toContain(
      'active_worker.worker_type_id = target.worker_type_id'
    );
    expect(query).toContain('ELSE runtime_baseline.runtime_generation');
    expect(query).toContain('attempt_baseline_runtime_exists = CASE');
    expect(query).toContain('attempt_baseline_captured_at = CASE');
    expect(query).toMatch(
      /WHEN target\.status = 'enqueued'\s*AND target\.attempt_baseline_operation_id\s*=\s*operation-2\s*THEN target\.attempt_baseline_runtime_generation/u
    );
  });

  it('uses the fenced gen2 attempt baseline so a gen2 rollback retries instead of succeeding from the gen1 plan', async () => {
    const execute = jest.fn(async (_query: unknown) => ({ rows: [] }));
    const transaction = jest.fn(
      async (callback: (tx: { execute: typeof execute }) => unknown) =>
        callback({ execute })
    );
    const repository = new ConfigChannelsRecreateBatchRepository({
      transaction,
    } as never);

    await expect(
      repository.completeTarget('target-1', 'owner-1')
    ).resolves.toBe('lease_lost');

    const query = collectSqlParts(execute.mock.calls[0][0]).join(' ');
    expect(query).toContain(
      'observed_account_id IS DISTINCT FROM worker_account_id'
    );
    expect(query).toContain(
      'observed_worker_type_id IS DISTINCT FROM worker_type_id'
    );
    expect(query).toMatch(
      /observed_runtime_container_id\s*=\s*observed_container_id/u
    );
    expect(query).toMatch(
      /runtime_generation\s*>\s*attempt_baseline_runtime_generation/u
    );
    expect(query).not.toContain('initial_runtime_generation');
    expect(query).not.toContain('initial_worker_container_id');
    expect(query).not.toContain('initial_runtime_container_id');
    expect(query).toContain('observed_operation_id = lifecycle_operation_id');
    expect(query).toMatch(
      /attempt_baseline_operation_id\s*=\s*lifecycle_operation_id/u
    );
    expect(query).toContain(EWorkerStatus.online);
    expect(query).toContain("THEN 'in_progress'");
    expect(query).toContain("THEN 'retry_scheduled'");
    expect(query).toContain("'recreate_rolled_back_to_attempt_baseline'");
    expect(query).toMatch(
      /observed_container_id\s*=\s*attempt_baseline_worker_container_id/u
    );
    expect(query).toMatch(
      /observed_runtime_container_id\s*=\s*attempt_baseline_runtime_container_id/u
    );
    expect(query).toContain("'recreate_attempt_baseline_missing'");
    expect(query).toContain('classified.attempt_count - 1');
    expect(query).toContain('60000');
    expect(query).toContain("THEN 'succeeded'");
    expect(query).toContain("'recreate_target_worker_missing'");
    expect(query).toContain("'recreate_target_worker_deleted'");
    expect(query).toContain("'recreate_target_worker_identity_changed'");
    expect(query).toContain("'recreate_target_operation_superseded'");
    expect(query).toContain("'recreate_completed_without_runtime_proof'");
    expect(query).toContain('recreate_completed_unexpected_status:');
    expect(query).toContain('target.initial_worker_status_id');
    expect(query).toMatch(
      new RegExp(
        `initial_worker_status_id\\s*=\\s*${EWorkerStatus.disponible}[\\s\\S]*worker_status_id\\s*=\\s*${EWorkerStatus.disponible}`,
        'u'
      )
    );
    expect(query).toMatch(
      /lifecycle_journal = CASE[\s\S]*WHEN classified\.outcome = 'retry_scheduled'[\s\S]*THEN NULL/u
    );
    expect(query).toMatch(
      /attempt_baseline_operation_id = CASE[\s\S]*WHEN classified\.outcome = 'retry_scheduled'[\s\S]*THEN NULL/u
    );
    expect(query).toMatch(
      /recreate_server_slot_key = CASE[\s\S]*WHEN classified\.outcome = 'retry_scheduled'[\s\S]*THEN NULL/u
    );
    expect(query).toMatch(
      /enqueued_at = CASE[\s\S]*WHEN classified\.outcome = 'retry_scheduled'[\s\S]*THEN NULL/u
    );
    expect(query).not.toMatch(
      /lifecycle_operation_id = CASE[\s\S]*retry_scheduled/u
    );
  });

  it('accepts an aligned gen2-to-gen3 advance only in a terminal status allowed by the initial snapshot', async () => {
    const execute = jest.fn(async (_query: unknown) => ({ rows: [] }));
    const repository = new ConfigChannelsRecreateBatchRepository({
      transaction: jest.fn(
        async (callback: (tx: { execute: typeof execute }) => unknown) =>
          callback({ execute })
      ),
    } as never);

    await repository.completeTarget('target-1', 'owner-1');

    const query = collectSqlParts(execute.mock.calls[0][0]).join(' ');
    const successBranch = query.slice(
      query.indexOf('WHEN observed_operation_id IS NULL'),
      query.indexOf("THEN 'succeeded'") + "THEN 'succeeded'".length
    );
    expect(successBranch).toMatch(
      /attempt_baseline_operation_id\s*=\s*lifecycle_operation_id/u
    );
    expect(successBranch).toMatch(
      new RegExp(
        `attempt_baseline_worker_status_id\\s*=\\s*${EWorkerStatus.recreating}`,
        'u'
      )
    );
    expect(successBranch).toContain(
      'observed_runtime_container_id = observed_container_id'
    );
    expect(successBranch).toMatch(
      /runtime_generation\s*>\s*attempt_baseline_runtime_generation/u
    );
    expect(successBranch).toMatch(/terminal_status_accepted/u);

    expect(query).toMatch(
      new RegExp(
        `worker_status_id\\s*=\\s*${EWorkerStatus.online}[\\s\\S]*initial_worker_status_id\\s*=\\s*${EWorkerStatus.disponible}[\\s\\S]*worker_status_id\\s*=\\s*${EWorkerStatus.disponible}`,
        'u'
      )
    );
  });

  it('inserts large target snapshots in bounded chunks inside one transaction', async () => {
    const batchInsert = {
      values: jest.fn(),
      onConflictDoNothing: jest.fn(),
      returning: jest.fn(),
      execute: jest.fn(async () => [{ batch_id: 'request-chunked' }]),
    } as any;
    batchInsert.values.mockReturnValue(batchInsert);
    batchInsert.onConflictDoNothing.mockReturnValue(batchInsert);
    batchInsert.returning.mockReturnValue(batchInsert);

    const targetInserts = Array.from({ length: 3 }, () => {
      const chain = {
        values: jest.fn(),
        execute: jest.fn(async () => []),
      } as any;
      chain.values.mockReturnValue(chain);
      return chain;
    });
    const tx = {
      insert: jest
        .fn()
        .mockReturnValueOnce(batchInsert)
        .mockReturnValueOnce(targetInserts[0])
        .mockReturnValueOnce(targetInserts[1])
        .mockReturnValueOnce(targetInserts[2]),
    };
    const transaction = jest.fn(
      async (callback: (input: typeof tx) => unknown) => callback(tx)
    );
    const repository = new ConfigChannelsRecreateBatchRepository({
      transaction,
    } as never);
    const targets = Array.from({ length: 501 }, (_, index) => ({
      worker_id: `worker-${index}`,
      worker_account_id: `worker-account-${index}`,
      server_id: `server-${index % 11}`,
      worker_type_id: 'worker-type',
      worker_status_id: EWorkerStatus.online,
      worker_container_id: `container-${index}`,
      runtime_container_id: `container-${index}`,
      runtime_generation: index + 1,
    }));

    await expect(
      repository.createOrLoadBatch(
        {
          requestId: 'request-chunked',
          topic: 'config.channels.recreate.all',
          partition: 0,
          offset: 1,
          accountId: 'requester-account',
        },
        filters,
        targets,
        'empty'
      )
    ).resolves.toEqual({
      batchId: 'request-chunked',
      created: true,
      targetCount: 501,
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(
      targetInserts.map(
        (chain) => (chain.values.mock.calls[0][0] as unknown[]).length
      )
    ).toEqual([250, 250, 1]);
  });

  it('persists a terminal non-online settlement and completes the batch with one error', async () => {
    const execute = jest.fn(async (_query: unknown) => ({
      rows: [
        {
          config_channels_recreate_batch_id: 'batch-1',
          outcome: 'failed',
          persisted: true,
        },
      ],
    }));
    const batchLock = createSelectChain([{ batch_id: 'batch-1' }]);
    const counts = createSelectChain([
      { total: 1, success: 0, errors: 1, active: 0 },
    ]);
    const batchUpdate = createUpdateChain();
    const tx = {
      execute,
      select: jest
        .fn()
        .mockReturnValueOnce(batchLock)
        .mockReturnValueOnce(counts),
      update: jest.fn(() => batchUpdate),
    };
    const repository = new ConfigChannelsRecreateBatchRepository({
      transaction: jest.fn(async (callback: (input: typeof tx) => unknown) =>
        callback(tx)
      ),
    } as never);

    await expect(
      repository.completeTarget('target-1', 'owner-1')
    ).resolves.toBe('failed');

    expect(batchUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({
        total_count: 1,
        success_count: 0,
        error_count: 1,
        status: 'completed',
      })
    );
  });

  it('accepts the same request identity at a new Kafka offset', async () => {
    const database = createLookupDatabase([
      {
        batch_id: 'request-1',
        account_id: 'requester-account',
        request_id: 'request-1',
        source_topic: 'config.channels.recreate.all',
        source_partition: 0,
        source_offset: 10,
        filters,
        target_count: 30,
      },
    ]);
    const repository = new ConfigChannelsRecreateBatchRepository(
      database as never
    );

    await expect(
      repository.createOrLoadBatch(
        {
          requestId: 'request-1',
          topic: 'config.channels.recreate.all',
          partition: 2,
          offset: 99,
          accountId: 'requester-account',
        },
        filters,
        [],
        'empty'
      )
    ).resolves.toEqual({
      batchId: 'request-1',
      created: false,
      targetCount: 30,
    });
  });

  it('rejects a different request identity colliding with the same source offset', async () => {
    const database = createLookupDatabase([
      {
        batch_id: 'request-original',
        account_id: 'requester-account',
        request_id: 'request-original',
        source_topic: 'config.channels.recreate.all',
        source_partition: 0,
        source_offset: 10,
        filters,
        target_count: 30,
      },
    ]);
    const repository = new ConfigChannelsRecreateBatchRepository(
      database as never
    );

    await expect(
      repository.createOrLoadBatch(
        {
          requestId: 'request-conflict',
          topic: 'config.channels.recreate.all',
          partition: 0,
          offset: 10,
          accountId: 'requester-account',
        },
        filters,
        [],
        'empty'
      )
    ).rejects.toBeInstanceOf(ConfigChannelsRecreateBatchIdentityConflictError);
  });

  it('backs off completion publication durably from the PostgreSQL clock', async () => {
    const execute = jest.fn(async (_query: unknown) => ({
      rows: [
        {
          config_channels_recreate_batch_id: 'batch-1',
          account_id: 'account-1',
          success_count: 1,
          error_count: 0,
        },
      ],
    }));
    const update = createUpdateChain();
    const repository = new ConfigChannelsRecreateBatchRepository({
      execute,
      update: jest.fn(() => update),
    } as never);

    await expect(
      repository.claimCompletedBatch('owner-1', 60_000)
    ).resolves.toEqual({
      batchId: 'batch-1',
      accountId: 'account-1',
      success: 1,
      errors: 0,
    });
    await repository.releaseCompletionClaim('batch-1', 'owner-1');

    const claimQuery = collectSqlParts(execute.mock.calls[0][0]).join(' ');
    expect(claimQuery).toContain(
      'batch.next_completion_attempt_at <= clock_timestamp()'
    );
    expect(claimQuery).toContain('batch.completion_attempt_count + 1');
    expect(claimQuery).toContain('FOR UPDATE SKIP LOCKED');

    const releaseExpression = update.set.mock.calls[0][0]
      .next_completion_attempt_at as unknown;
    const releaseQuery = collectSqlParts(releaseExpression).join(' ');
    expect(releaseQuery).toContain('clock_timestamp()');
    expect(releaseQuery).toContain("INTERVAL '1 millisecond'");
    expect(releaseQuery).toContain('60000');
  });

  it('keeps model and migration status checks and claim indexes aligned', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'atlas/prod/20260730235500.sql'),
      'utf8'
    );
    const model = readFileSync(
      resolve(
        process.cwd(),
        'packages/models/config/configChannelsRecreateTarget.model.ts'
      ),
      'utf8'
    );
    const batchModel = readFileSync(
      resolve(
        process.cwd(),
        'packages/models/config/configChannelsRecreateBatch.model.ts'
      ),
      'utf8'
    );

    for (const source of [migration, model]) {
      expect(source).toMatch(
        /'pending'[\s\S]*'processing'[\s\S]*'enqueued'[\s\S]*'succeeded'[\s\S]*'failed'/u
      );
      expect(source).toContain(
        'config_channels_recreate_target_pending_claim_idx'
      );
      expect(source).toContain(
        'config_channels_recreate_target_leased_claim_idx'
      );
    }
    expect(migration).toContain('"worker_account_id" uuid NOT NULL');
    expect(migration).toContain('"worker_type_id" uuid NOT NULL');
    expect(migration).toContain('"lifecycle_journal" jsonb NULL');
    expect(migration).toContain('"attempt_baseline_operation_id" uuid NULL');
    expect(migration).toContain(
      '"attempt_baseline_runtime_generation" integer NULL'
    );
    expect(model).toContain('attempt_baseline_operation_id: uuid()');
    expect(model).toContain('attempt_baseline_runtime_generation: integer()');
    for (const source of [migration, batchModel]) {
      expect(source).toMatch(/'queued'[\s\S]*'running'[\s\S]*'completed'/u);
      expect(source).toContain('config_channels_recreate_batch_status_check');
      expect(source).toContain('completion_attempt_count');
      expect(source).toContain('next_completion_attempt_at');
    }
  });
});
