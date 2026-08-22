import 'reflect-metadata';
import { WorkerDeleterRepository } from '@core/repositories/worker/WorkerDeleter.repository';
import { currentTime } from '@core/common/functions/currentTime';
import {
  contactChannel,
  outboundWebhook,
  outboundWebhookDelivery,
  worker,
  workerWhatsappOfficialConnection,
} from '@core/models';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';

jest.mock('@core/common/functions/currentTime', () => ({
  currentTime: jest.fn(),
}));

describe('WorkerDeleterRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (currentTime as jest.Mock).mockReturnValue('2026-04-21T10:00:00.000Z');
  });

  const createHarness = (workerExists: boolean) => {
    type UpdateTrace = {
      table: unknown;
      values?: Record<string, unknown>;
      condition?: SQL;
    };
    type DeleteTrace = {
      table: unknown;
      condition?: SQL;
    };

    const traces: UpdateTrace[] = [];
    const deleteTraces: DeleteTrace[] = [];
    const update = jest.fn((table: unknown) => {
      const trace: UpdateTrace = { table };
      traces.push(trace);
      const chain = {} as {
        set: jest.Mock;
        where: jest.Mock;
        returning: jest.Mock;
        execute: jest.Mock;
      };
      chain.set = jest.fn((values: Record<string, unknown>) => {
        trace.values = values;
        return chain;
      });
      chain.where = jest.fn((condition: SQL) => {
        trace.condition = condition;
        return chain;
      });
      chain.returning = jest.fn(() => chain);
      chain.execute = jest.fn(async () => {
        if (table === worker) return workerExists ? [{ id: 'w-1' }] : [];
        if (table === outboundWebhook) return [{ id: 'webhook-1' }];
        return [];
      });
      return chain;
    });
    const del = jest.fn((table: unknown) => {
      const trace: DeleteTrace = { table };
      deleteTraces.push(trace);
      const chain = {} as {
        where: jest.Mock;
        execute: jest.Mock;
      };
      chain.where = jest.fn((condition: SQL) => {
        trace.condition = condition;
        return chain;
      });
      chain.execute = jest.fn(async () => ({ rowCount: 1 }));
      return chain;
    });
    const tx = { delete: del, update };
    const database = {
      transaction: jest.fn(
        async (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx)
      ),
    };
    return { database, deleteTraces, traces };
  };

  it('atomically disables channel webhooks and suppresses queued deliveries', async () => {
    const harness = createHarness(true);
    const repository = new WorkerDeleterRepository(harness.database as never);

    await expect(repository.deleteWorkerById('account-1', 'w-1')).resolves.toBe(
      true
    );
    expect(harness.database.transaction).toHaveBeenCalledTimes(1);
    expect(harness.traces.map((trace) => trace.table)).toEqual([
      worker,
      workerWhatsappOfficialConnection,
      outboundWebhook,
      outboundWebhookDelivery,
    ]);
    expect(harness.deleteTraces.map((trace) => trace.table)).toEqual([
      contactChannel,
    ]);
    expect(harness.traces[0]?.values).toEqual({
      deleted_at: '2026-04-21T10:00:00.000Z',
    });
    expect(harness.traces[1]?.values).toEqual({
      deleted_at: '2026-04-21T10:00:00.000Z',
      updated_at: '2026-04-21T10:00:00.000Z',
    });
    const deleteCondition = new PgDialect().sqlToQuery(
      harness.traces[0]?.condition as SQL
    );
    expect(deleteCondition.sql).toContain('"worker"."deleted_at" is null');
    const officialConnectionDeleteCondition = new PgDialect().sqlToQuery(
      harness.traces[1]?.condition as SQL
    );
    expect(officialConnectionDeleteCondition.sql).toContain(
      '"worker_whatsapp_official_connection"."worker_id" ='
    );
    expect(officialConnectionDeleteCondition.sql).toContain(
      '"worker_whatsapp_official_connection"."deleted_at" is null'
    );
    expect(officialConnectionDeleteCondition.params).toEqual(['w-1']);
    const contactChannelDeleteCondition = new PgDialect().sqlToQuery(
      harness.deleteTraces[0]?.condition as SQL
    );
    expect(contactChannelDeleteCondition.sql).toContain(
      '"contact_channel"."account_id" ='
    );
    expect(contactChannelDeleteCondition.sql).toContain(
      '"contact_channel"."channel_id" ='
    );
    expect(contactChannelDeleteCondition.params).toEqual(['account-1', 'w-1']);
    expect(harness.traces[2]?.values).toEqual(
      expect.objectContaining({
        status: 'inactive',
        consecutive_dead_deliveries: 0,
      })
    );
    expect(harness.traces[2]?.values?.config_version).toBeDefined();
    expect(harness.traces[3]?.values).toEqual(
      expect.objectContaining({
        status: 'suppressed',
        last_error: 'channel_unavailable',
        lease_token: null,
        lease_expires_at: null,
      })
    );
  });

  it('returns false when no worker row is affected', async () => {
    const harness = createHarness(false);
    const repository = new WorkerDeleterRepository(harness.database as never);

    await expect(repository.deleteWorkerById('account-1', 'w-1')).resolves.toBe(
      false
    );
    expect(harness.traces).toHaveLength(1);
    expect(harness.deleteTraces).toHaveLength(0);
  });

  it('persists and fences the lifecycle operation used as permanent-deletion proof', async () => {
    const harness = createHarness(true);
    const repository = new WorkerDeleterRepository(harness.database as never);

    await expect(
      repository.deleteWorkerById('account-1', 'w-1', {
        lifecycleOperationId: 'operation-1',
        expectedLifecycleOperationId: 'operation-1',
      })
    ).resolves.toBe(true);

    expect(harness.traces[0]?.values).toEqual({
      deleted_at: '2026-04-21T10:00:00.000Z',
      worker_status_id: EWorkerStatus.deleting,
      lifecycle_operation_id: 'operation-1',
    });
    const deleteCondition = new PgDialect().sqlToQuery(
      harness.traces[0]?.condition as SQL
    );
    expect(deleteCondition.sql).toContain(
      '"worker"."lifecycle_operation_id" ='
    );
    expect(deleteCondition.params).toEqual([
      'account-1',
      'w-1',
      'operation-1',
      EWorkerStatus.deleting,
    ]);
  });
});
