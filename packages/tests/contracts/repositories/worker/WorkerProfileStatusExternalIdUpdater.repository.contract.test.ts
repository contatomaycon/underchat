import 'reflect-metadata';

const mockAssertCurrentWhatsappRuntimeInTransaction = jest.fn(
  async () => undefined
);

jest.mock(
  '@core/repositories/worker/WhatsappRuntimeDatabaseFence.repository',
  () => {
    class StaleWhatsappRuntimeDatabaseFenceError extends Error {
      public readonly reason = 'whatsapp_runtime_database_fence_stale' as const;

      constructor() {
        super('WhatsApp runtime database fence is stale');
        this.name = 'StaleWhatsappRuntimeDatabaseFenceError';
      }
    }

    return {
      assertCurrentWhatsappRuntimeInTransaction:
        mockAssertCurrentWhatsappRuntimeInTransaction,
      StaleWhatsappRuntimeDatabaseFenceError,
    };
  }
);

import { WorkerProfileStatusExternalIdUpdaterRepository } from '@core/repositories/worker/WorkerProfileStatusExternalIdUpdater.repository';
import { StaleWhatsappRuntimeDatabaseFenceError } from '@core/repositories/worker/WhatsappRuntimeDatabaseFence.repository';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const runtimeFence = {
  account_id: 'account-1',
  worker_id: 'worker-1',
  source_provider: 'whatsmeow',
  runtime_generation: 9,
  connection_epoch: 'epoch-9',
};

function createRepository(rowCount: number) {
  const execute = jest.fn(async () => ({ rowCount }));
  let updateCondition: SQL | undefined;
  const where = jest.fn((condition: SQL) => {
    updateCondition = condition;
    return { execute };
  });
  const set = jest.fn(() => ({ where }));
  const update = jest.fn(() => ({ set }));
  const tx = { update };
  const dbRw = {
    transaction: jest.fn(
      async (callback: (transaction: typeof tx) => Promise<boolean>) =>
        callback(tx)
    ),
  };

  return {
    repository: new WorkerProfileStatusExternalIdUpdaterRepository(
      dbRw as never
    ),
    dbRw,
    tx,
    update,
    updateCondition: () => updateCondition,
  };
}

describe('WorkerProfileStatusExternalIdUpdaterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAssertCurrentWhatsappRuntimeInTransaction.mockResolvedValue(undefined);
  });

  it('returns true when update affects rows', async () => {
    const { repository, dbRw, tx, updateCondition } = createRepository(1);

    await expect(
      repository.updateExternalId('wps-1', 'ext-1', runtimeFence)
    ).resolves.toBe(true);

    expect(dbRw.transaction).toHaveBeenCalledTimes(1);
    expect(mockAssertCurrentWhatsappRuntimeInTransaction).toHaveBeenCalledWith(
      tx,
      runtimeFence
    );
    const query = new PgDialect().sqlToQuery(updateCondition() as SQL);
    expect(query.sql).toContain(
      '"worker_profile_status"."worker_profile_status_id" ='
    );
    expect(query.sql).toContain('"worker_profile_status"."worker_id" =');
    expect(query.params).toEqual(
      expect.arrayContaining(['wps-1', 'worker-1', 'ext-1'])
    );
  });

  it('returns false when update affects no rows', async () => {
    const { repository } = createRepository(0);

    await expect(
      repository.updateExternalId('wps-1', 'ext-1', runtimeFence)
    ).resolves.toBe(false);
  });

  it('does not mutate when the durable runtime generation is stale', async () => {
    const { repository, update } = createRepository(1);
    mockAssertCurrentWhatsappRuntimeInTransaction.mockRejectedValueOnce(
      new StaleWhatsappRuntimeDatabaseFenceError()
    );

    await expect(
      repository.updateExternalId('wps-1', 'ext-1', runtimeFence)
    ).rejects.toBeInstanceOf(StaleWhatsappRuntimeDatabaseFenceError);

    expect(update).not.toHaveBeenCalled();
  });
});
