import 'reflect-metadata';
import {
  activateWhatsappRuntimeFenceInTransaction,
  assertCurrentWhatsappRuntimeInTransaction,
  StaleWhatsappRuntimeDatabaseFenceError,
} from '@core/repositories/worker/WhatsappRuntimeDatabaseFence.repository';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const ACCOUNT_ID = '019a930d-c6f4-75ad-88ff-8d2fcd5839e1';
const WORKER_ID = '019fd88a-2894-739b-9471-cd3502f648df';
const CONNECTION_EPOCH = '019fe724-a608-74b9-a76a-4449f9a0f49f';
const PREVIOUS_CONNECTION_EPOCH = '019fe724-a608-74b9-a76a-4449f9a0f48e';
const CONNECTION_ATTEMPT_ID = '019fe777-02cb-738c-8a6f-0daa7c7f65af';
const WRITER_EPOCH = '019fe777-02cb-738c-8a6f-0daa7c7f65be';
const CONTAINER_ID = 'a'.repeat(64);

const runtimeFence = {
  account_id: ACCOUNT_ID,
  worker_id: WORKER_ID,
  source_provider: 'whatsmeow',
  runtime_generation: 9,
  connection_epoch: CONNECTION_EPOCH,
};

function createSelectChain(rows: unknown[]) {
  let whereCondition: SQL | undefined;
  const chain = {} as Record<string, jest.Mock>;
  for (const method of ['from', 'for', 'limit']) {
    chain[method] = jest.fn(() => chain);
  }
  chain.where = jest.fn((condition: SQL) => {
    whereCondition = condition;
    return chain;
  });
  chain.execute = jest.fn(async () => rows);
  return { chain, whereCondition: () => whereCondition };
}

function createTransaction(
  workerRows: unknown[] = [{ worker_id: WORKER_ID }],
  runtimeRows: unknown[] = [
    {
      runtime_generation: 9,
      connection_epoch: CONNECTION_EPOCH,
      source_provider: 'whatsmeow',
    },
  ]
) {
  const workerSelect = createSelectChain(workerRows);
  const runtimeSelect = createSelectChain(runtimeRows);
  const tx = {
    execute: jest.fn(async (_statement: unknown) => undefined),
    select: jest
      .fn()
      .mockReturnValueOnce(workerSelect.chain)
      .mockReturnValueOnce(runtimeSelect.chain),
  };

  return { tx, workerSelect, runtimeSelect };
}

function createActivationTransaction(input?: {
  runtimeRows?: unknown[];
  updateRows?: unknown[];
  grantRows?: unknown[];
  consumedRowCount?: number;
  sessionLockRowCount?: number;
  sessionRows?: unknown[];
  leaseRows?: unknown[];
}) {
  const workerSelect = createSelectChain([{ worker_id: WORKER_ID }]);
  const runtimeSelect = createSelectChain(
    input?.runtimeRows ?? [
      {
        runtime_generation: 9,
        connection_epoch: PREVIOUS_CONNECTION_EPOCH,
        connection_sequence: 7,
        source_provider: 'whatsmeow',
        container_id: CONTAINER_ID,
        session_storage: 'volume',
        runtime_capability_hash: null,
        session_writer_epoch: null,
      },
    ]
  );
  const updateChain = {} as Record<string, jest.Mock>;
  for (const method of ['set', 'where', 'returning']) {
    updateChain[method] = jest.fn(() => updateChain);
  }
  updateChain.execute = jest.fn(
    async () => input?.updateRows ?? [{ connection_sequence: 8 }]
  );
  const sqlCalls: string[] = [];
  const tx = {
    execute: jest.fn(async (statement: unknown) => {
      const query = new PgDialect().sqlToQuery(statement as SQL).sql;
      sqlCalls.push(query);
      if (
        query.includes('SELECT activation_grant.connection_attempt_id::text')
      ) {
        return { rows: input?.grantRows ?? [], rowCount: 0 };
      }
      if (query.includes('SET consumed_at = clock_timestamp()')) {
        return { rows: [], rowCount: input?.consumedRowCount ?? 1 };
      }
      if (
        query.includes('SELECT session.session_id') &&
        query.includes('FOR SHARE')
      ) {
        return { rows: [], rowCount: input?.sessionLockRowCount ?? 1 };
      }
      if (query.includes('AS operational_tree_empty')) {
        return { rows: input?.sessionRows ?? [], rowCount: 0 };
      }
      if (query.includes('FROM public.whatsapp_session_lease AS lease')) {
        return { rows: input?.leaseRows ?? [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    }),
    select: jest
      .fn()
      .mockReturnValueOnce(workerSelect.chain)
      .mockReturnValueOnce(runtimeSelect.chain),
    update: jest.fn(() => updateChain),
  };
  return { tx, workerSelect, runtimeSelect, updateChain, sqlCalls };
}

function pendingGrant(grantLive = true) {
  return {
    connection_attempt_id: CONNECTION_ATTEMPT_ID,
    expected_connection_epoch: PREVIOUS_CONNECTION_EPOCH,
    authorized_connection_epoch: CONNECTION_EPOCH,
    connection_sequence_at_grant: 7,
    grant_live: grantLive,
    consumed_at: null,
  };
}

describe('WhatsappRuntimeDatabaseFence repository guard', () => {
  it('locks ownership and runtime rows before accepting the generation', async () => {
    const { tx, workerSelect, runtimeSelect } = createTransaction();

    await expect(
      assertCurrentWhatsappRuntimeInTransaction(tx as never, runtimeFence)
    ).resolves.toBeUndefined();

    expect(tx.select).toHaveBeenCalledTimes(2);
    expect(workerSelect.chain.for).toHaveBeenCalledWith('share');
    expect(runtimeSelect.chain.for).toHaveBeenCalledWith('share');
    expect(workerSelect.chain.for.mock.invocationCallOrder[0]).toBeLessThan(
      runtimeSelect.chain.for.mock.invocationCallOrder[0]
    );

    const ownershipQuery = new PgDialect().sqlToQuery(
      workerSelect.whereCondition() as SQL
    );
    expect(ownershipQuery.params).toEqual(
      expect.arrayContaining([WORKER_ID, ACCOUNT_ID, EWorkerType.whatsmeow])
    );
  });

  it('rejects a runtime generation replaced by another pod', async () => {
    const { tx } = createTransaction(
      [{ worker_id: WORKER_ID }],
      [{ runtime_generation: 10 }]
    );

    await expect(
      assertCurrentWhatsappRuntimeInTransaction(tx as never, runtimeFence)
    ).rejects.toBeInstanceOf(StaleWhatsappRuntimeDatabaseFenceError);
  });

  it('rejects a connection epoch replaced inside the same runtime generation', async () => {
    const { tx } = createTransaction(
      [{ worker_id: WORKER_ID }],
      [
        {
          runtime_generation: 9,
          connection_epoch: PREVIOUS_CONNECTION_EPOCH,
          source_provider: 'whatsmeow',
        },
      ]
    );

    await expect(
      assertCurrentWhatsappRuntimeInTransaction(tx as never, runtimeFence)
    ).rejects.toBeInstanceOf(StaleWhatsappRuntimeDatabaseFenceError);
  });

  it('rejects a worker outside the expected account/provider ownership', async () => {
    const { tx } = createTransaction([]);

    await expect(
      assertCurrentWhatsappRuntimeInTransaction(tx as never, runtimeFence)
    ).rejects.toBeInstanceOf(StaleWhatsappRuntimeDatabaseFenceError);

    expect(tx.select).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown providers without querying PostgreSQL', async () => {
    const { tx } = createTransaction();

    await expect(
      assertCurrentWhatsappRuntimeInTransaction(tx as never, {
        ...runtimeFence,
        source_provider: '__proto__',
      })
    ).rejects.toBeInstanceOf(StaleWhatsappRuntimeDatabaseFenceError);

    expect(tx.select).not.toHaveBeenCalled();
  });

  it('activates a new epoch under an exclusive runtime lock and increments its sequence', async () => {
    const { tx, workerSelect, runtimeSelect, updateChain } =
      createActivationTransaction();

    await expect(
      activateWhatsappRuntimeFenceInTransaction(tx as never, runtimeFence)
    ).resolves.toEqual({
      connection_sequence: 8,
      already_active: false,
    });

    expect(tx.execute).toHaveBeenCalledTimes(3);
    const timeoutSql = tx.execute.mock.calls
      .map(([statement]) => new PgDialect().sqlToQuery(statement as SQL).sql)
      .join('\n');
    expect(timeoutSql).toContain('lock_timeout');
    expect(timeoutSql).toContain('statement_timeout');
    expect(workerSelect.chain.for).toHaveBeenCalledWith('share');
    expect(runtimeSelect.chain.for).toHaveBeenCalledWith('update');
    expect(workerSelect.chain.for.mock.invocationCallOrder[0]).toBeLessThan(
      runtimeSelect.chain.for.mock.invocationCallOrder[0]
    );
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(updateChain.returning).toHaveBeenCalledWith(
      expect.objectContaining({ connection_sequence: expect.anything() })
    );
  });

  it('retries the exact durable epoch idempotently without advancing the sequence', async () => {
    const { tx } = createActivationTransaction({
      runtimeRows: [
        {
          runtime_generation: 9,
          connection_epoch: CONNECTION_EPOCH,
          connection_sequence: 8,
          source_provider: 'whatsmeow',
          container_id: CONTAINER_ID,
          session_storage: 'volume',
          runtime_capability_hash: null,
          session_writer_epoch: null,
        },
      ],
    });

    await expect(
      activateWhatsappRuntimeFenceInTransaction(tx as never, runtimeFence)
    ).resolves.toEqual({
      connection_sequence: 8,
      already_active: true,
    });

    expect(tx.update).not.toHaveBeenCalled();
  });

  it('repairs an exact epoch that was stored without a positive sequence', async () => {
    const { tx } = createActivationTransaction({
      runtimeRows: [
        {
          runtime_generation: 9,
          connection_epoch: CONNECTION_EPOCH,
          connection_sequence: 0,
          source_provider: 'whatsmeow',
          container_id: CONTAINER_ID,
          session_storage: 'volume',
          runtime_capability_hash: null,
          session_writer_epoch: null,
        },
      ],
      updateRows: [{ connection_sequence: 1 }],
    });

    await expect(
      activateWhatsappRuntimeFenceInTransaction(tx as never, runtimeFence)
    ).resolves.toEqual({
      connection_sequence: 1,
      already_active: false,
    });

    expect(tx.update).toHaveBeenCalledTimes(1);
  });

  it('consumes an exact pending grant in the same transaction as activation', async () => {
    const { tx, sqlCalls } = createActivationTransaction({
      grantRows: [pendingGrant()],
    });

    await expect(
      activateWhatsappRuntimeFenceInTransaction(tx as never, {
        ...runtimeFence,
        connection_attempt_id: CONNECTION_ATTEMPT_ID,
      })
    ).resolves.toEqual({
      connection_sequence: 8,
      already_active: false,
    });

    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(
      sqlCalls.some((query) =>
        query.includes('SET consumed_at = clock_timestamp()')
      )
    ).toBe(true);
  });

  it('repairs a pending marker after the runtime already committed its exact epoch', async () => {
    const { tx, sqlCalls } = createActivationTransaction({
      runtimeRows: [
        {
          runtime_generation: 9,
          connection_epoch: CONNECTION_EPOCH,
          connection_sequence: 8,
          source_provider: 'whatsmeow',
          container_id: CONTAINER_ID,
          session_storage: 'volume',
          runtime_capability_hash: null,
          session_writer_epoch: null,
        },
      ],
      grantRows: [pendingGrant(false)],
    });

    await expect(
      activateWhatsappRuntimeFenceInTransaction(tx as never, {
        ...runtimeFence,
        connection_attempt_id: CONNECTION_ATTEMPT_ID,
      })
    ).resolves.toEqual({
      connection_sequence: 8,
      already_active: true,
    });

    expect(tx.update).not.toHaveBeenCalled();
    expect(
      sqlCalls.some((query) =>
        query.includes('SET consumed_at = clock_timestamp()')
      )
    ).toBe(true);
  });

  it('revalidates the empty canonical session before consuming a fresh PostgreSQL grant', async () => {
    const { tx, sqlCalls } = createActivationTransaction({
      runtimeRows: [
        {
          runtime_generation: 9,
          connection_epoch: PREVIOUS_CONNECTION_EPOCH,
          connection_sequence: 7,
          source_provider: 'whatsmeow',
          container_id: CONTAINER_ID,
          session_storage: 'postgres',
          runtime_capability_hash: 'capability-hash',
          session_writer_epoch: WRITER_EPOCH,
        },
      ],
      grantRows: [pendingGrant()],
      sessionRows: [
        {
          state: 'empty',
          provider: 'whatsmeow',
          generation: 9,
          epoch: WRITER_EPOCH,
          capability_hash: 'capability-hash',
          operational_tree_empty: false,
        },
      ],
    });

    await expect(
      activateWhatsappRuntimeFenceInTransaction(tx as never, {
        ...runtimeFence,
        connection_attempt_id: CONNECTION_ATTEMPT_ID,
      })
    ).rejects.toBeInstanceOf(StaleWhatsappRuntimeDatabaseFenceError);

    expect(tx.update).not.toHaveBeenCalled();
    expect(
      sqlCalls.some((query) => query.includes('AS operational_tree_empty'))
    ).toBe(true);
    expect(
      sqlCalls.some((query) =>
        query.includes('FROM public.whatsapp_session_lease AS lease')
      )
    ).toBe(true);

    const sessionLockIndex = sqlCalls.findIndex(
      (query) =>
        query.includes('SELECT session.session_id') &&
        query.includes('FOR SHARE')
    );
    const leaseLockIndex = sqlCalls.findIndex((query) =>
      query.includes('FROM public.whatsapp_session_lease AS lease')
    );
    const grantLockIndex = sqlCalls.findIndex((query) =>
      query.includes('SELECT activation_grant.connection_attempt_id::text')
    );
    expect(sessionLockIndex).toBeGreaterThanOrEqual(0);
    expect(leaseLockIndex).toBeGreaterThan(sessionLockIndex);
    expect(grantLockIndex).toBeGreaterThan(leaseLockIndex);
  });

  it('accepts an exact runtime-owned Baileys pairing draft without deleting it', async () => {
    const baileysFence = {
      ...runtimeFence,
      source_provider: 'baileys',
      connection_attempt_id: CONNECTION_ATTEMPT_ID,
    };
    const { tx, sqlCalls } = createActivationTransaction({
      runtimeRows: [
        {
          runtime_generation: 9,
          connection_epoch: PREVIOUS_CONNECTION_EPOCH,
          connection_sequence: 7,
          source_provider: 'baileys',
          container_id: CONTAINER_ID,
          session_storage: 'postgres',
          runtime_capability_hash: 'capability-hash',
          session_writer_epoch: WRITER_EPOCH,
        },
      ],
      grantRows: [pendingGrant()],
      sessionRows: [
        {
          state: 'preparing',
          provider: 'baileys',
          generation: 9,
          epoch: WRITER_EPOCH,
          capability_hash: 'capability-hash',
          active_revision_id: 42,
          previous_revision_id: null,
          active_device_fingerprint: null,
          active_device_fingerprint_version: null,
          last_persisted_at: '2026-08-10T14:00:00.000Z',
          last_error_at: null,
          operational_tree_empty: false,
          resumable_pairing_draft: true,
        },
      ],
      leaseRows: [
        {
          fencing_token: 8,
          generation: 9,
          owner_id: '019fe777-02cb-738c-8a6f-0daa7c7f65ce',
          provider: 'baileys',
          epoch: WRITER_EPOCH,
          lease_released: false,
          lease_expired: false,
          lease_live: true,
        },
      ],
    });

    await expect(
      activateWhatsappRuntimeFenceInTransaction(tx as never, baileysFence)
    ).resolves.toEqual({
      connection_sequence: 8,
      already_active: false,
    });

    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(
      sqlCalls.some((query) => query.includes('resumable_pairing_draft'))
    ).toBe(true);
    expect(
      sqlCalls.some((query) =>
        query.includes('DELETE FROM public.whatsapp_session_revision')
      )
    ).toBe(false);
  });

  it('rejects malformed UUID fences before querying PostgreSQL', async () => {
    const { tx } = createActivationTransaction();

    await expect(
      activateWhatsappRuntimeFenceInTransaction(tx as never, {
        ...runtimeFence,
        connection_attempt_id: 'not-a-uuid',
      })
    ).rejects.toBeInstanceOf(StaleWhatsappRuntimeDatabaseFenceError);

    expect(tx.select).not.toHaveBeenCalled();
    expect(tx.execute).not.toHaveBeenCalled();
  });
});
