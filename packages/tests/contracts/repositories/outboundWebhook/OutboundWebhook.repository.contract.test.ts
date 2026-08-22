import 'reflect-metadata';
import type { SQL } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import {
  outboundWebhook,
  outboundWebhookDelivery,
  outboundWebhookDeliveryAttempt,
  outboundWebhookEvent,
  worker,
} from '@core/models';
import { OutboundWebhookRepository } from '@core/repositories/outboundWebhook/OutboundWebhook.repository';

const accountId = '01900000-0000-7000-8000-000000000001';
const webhookId = '01900000-0000-7000-8000-000000000002';
const actorUserId = '01900000-0000-7000-8000-000000000003';
const eventId = '01900000-0000-7000-8000-000000000004';
const deliveryId = '01900000-0000-7000-8000-000000000005';
const channelId = '01900000-0000-7000-8000-000000000006';

interface SelectTrace {
  where?: SQL;
  lock?: string;
}

interface MutationTrace {
  table: unknown;
  values?: Record<string, unknown>;
  execute: jest.Mock<Promise<unknown[]>, []>;
}

const createRedeliveryHarness = (
  insertError?: Error,
  webhookOverrides: Record<string, unknown> = {}
) => {
  const selectRows = [
    [
      {
        status: 'active',
        config_version: 7,
        channel_id: channelId,
        channel_available: true,
        ...webhookOverrides,
      },
    ],
    [
      {
        event_id: eventId,
        status: 'dead',
        is_test: false,
        entitlement_epoch_matches: true,
        entitlement_is_live: true,
      },
    ],
  ];
  const selectTraces: SelectTrace[] = [];
  const updateTraces: MutationTrace[] = [];
  const insertTraces: MutationTrace[] = [];

  const select = jest.fn(() => {
    const trace: SelectTrace = {};
    selectTraces.push(trace);
    const chain = {} as {
      from: jest.Mock;
      innerJoin: jest.Mock;
      where: jest.Mock;
      for: jest.Mock;
      limit: jest.Mock;
      execute: jest.Mock;
    };
    chain.from = jest.fn(() => chain);
    chain.innerJoin = jest.fn(() => chain);
    chain.where = jest.fn((condition: SQL) => {
      trace.where = condition;
      return chain;
    });
    chain.for = jest.fn((lock: string) => {
      trace.lock = lock;
      return chain;
    });
    chain.limit = jest.fn(() => chain);
    chain.execute = jest.fn(async () => selectRows.shift() ?? []);
    return chain;
  });

  const update = jest.fn((table: unknown) => {
    const trace: MutationTrace = {
      table,
      execute: jest.fn(async () => []),
    };
    updateTraces.push(trace);
    const chain = {} as {
      set: jest.Mock;
      where: jest.Mock;
      execute: MutationTrace['execute'];
    };
    chain.set = jest.fn((values: Record<string, unknown>) => {
      trace.values = values;
      return chain;
    });
    chain.where = jest.fn(() => chain);
    chain.execute = trace.execute;
    return chain;
  });

  const insert = jest.fn((table: unknown) => {
    const trace: MutationTrace = {
      table,
      execute: jest.fn(async () => {
        if (insertError) throw insertError;
        return [];
      }),
    };
    insertTraces.push(trace);
    const chain = {} as {
      values: jest.Mock;
      execute: MutationTrace['execute'];
    };
    chain.values = jest.fn((values: Record<string, unknown>) => {
      trace.values = values;
      return chain;
    });
    chain.execute = trace.execute;
    return chain;
  });

  const tx = { select, update, insert };
  const database = {
    transaction: jest.fn(
      async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx)
    ),
  };

  return {
    database,
    selectTraces,
    updateTraces,
    insertTraces,
  };
};

describe('OutboundWebhookRepository redelivery retention', () => {
  it('models a mandatory channel scoped to the same account', () => {
    const webhookConfig = getTableConfig(outboundWebhook);
    const workerConfig = getTableConfig(worker);
    const channelColumn = webhookConfig.columns.find(
      (column) => column.name === 'channel_id'
    );
    const channelForeignKey = webhookConfig.foreignKeys.find(
      (foreignKey) =>
        foreignKey.reference().foreignTable === worker &&
        foreignKey.reference().columns.length === 2
    );
    const workerAccountChannelUnique = workerConfig.indexes.find(
      (index) =>
        index.config.unique &&
        index.config.columns
          .map((column) => ('name' in column ? column.name : null))
          .join(',') === 'account_id,worker_id'
    );

    expect(channelColumn?.notNull).toBe(true);
    expect(
      channelForeignKey?.reference().columns.map((column) => column.name)
    ).toEqual(['account_id', 'channel_id']);
    expect(
      channelForeignKey?.reference().foreignColumns.map((column) => column.name)
    ).toEqual(['account_id', 'worker_id']);
    expect(workerAccountChannelUnique).toBeDefined();
  });

  it('keeps delivery and attempt history owned by the renewed event retention', () => {
    const deliveryEventForeignKey = getTableConfig(
      outboundWebhookDelivery
    ).foreignKeys.find(
      (foreignKey) =>
        foreignKey.reference().foreignTable === outboundWebhookEvent
    );
    const attemptDeliveryForeignKey = getTableConfig(
      outboundWebhookDeliveryAttempt
    ).foreignKeys.find(
      (foreignKey) =>
        foreignKey.reference().foreignTable === outboundWebhookDelivery
    );

    expect(deliveryEventForeignKey?.onDelete).toBe('cascade');
    expect(attemptDeliveryForeignKey?.onDelete).toBe('cascade');
  });

  it('renews the parent event and new delivery for the same 30-day transaction window', async () => {
    const harness = createRedeliveryHarness();
    const repository = new OutboundWebhookRepository(harness.database as never);

    await expect(
      repository.redeliver(accountId, webhookId, deliveryId, actorUserId)
    ).resolves.toEqual({
      status: 'created',
      outbound_webhook_event_id: eventId,
      outbound_webhook_delivery_id: expect.any(String),
    });

    expect(harness.database.transaction).toHaveBeenCalledTimes(1);
    expect(harness.selectTraces[1]?.lock).toBe('update');

    const eligibilityQuery = new PgDialect().sqlToQuery(
      harness.selectTraces[1]?.where as SQL
    );
    expect(eligibilityQuery.sql).toContain('subscription.active = TRUE');
    expect(eligibilityQuery.sql).toContain('subscription.deleted_at IS NULL');
    expect(eligibilityQuery.sql).toContain('jsonb_array_elements');
    expect(eligibilityQuery.sql).toContain("->> 'webhook_id'");
    expect(eligibilityQuery.sql).toContain("->> 'channel_id'");
    expect(eligibilityQuery.sql).not.toContain("->> 'config_version'");
    expect(eligibilityQuery.sql).toContain(
      '"outbound_webhook_event"."expires_at" > NOW()'
    );
    expect(eligibilityQuery.params).toEqual(
      expect.arrayContaining([
        deliveryId,
        webhookId,
        'dead',
        'suppressed',
        accountId,
        'ready',
      ])
    );

    expect(harness.updateTraces).toHaveLength(1);
    expect(harness.updateTraces[0]?.table).toBe(outboundWebhookEvent);
    expect(harness.insertTraces).toHaveLength(1);
    expect(harness.insertTraces[0]?.table).toBe(outboundWebhookDelivery);

    const eventExpiry = harness.updateTraces[0]?.values?.expires_at;
    const deliveryExpiry = harness.insertTraces[0]?.values?.expires_at;
    expect(deliveryExpiry).toBe(eventExpiry);
    expect(new PgDialect().sqlToQuery(eventExpiry as SQL).sql).toBe(
      "NOW() + INTERVAL '30 days'"
    );
    expect(harness.insertTraces[0]?.values).toEqual(
      expect.objectContaining({
        outbound_webhook_id: webhookId,
        outbound_webhook_event_id: eventId,
        config_version: 7,
        status: 'pending',
        redelivery_of_delivery_id: deliveryId,
        requested_by_user_id: actorUserId,
      })
    );
    expect(
      harness.updateTraces[0]?.execute.mock.invocationCallOrder[0]
    ).toBeLessThan(
      harness.insertTraces[0]?.execute.mock.invocationCallOrder[0] ?? 0
    );
  });

  it('propagates an insert failure so the transaction can roll back the event extension', async () => {
    const harness = createRedeliveryHarness(new Error('insert failed'));
    const repository = new OutboundWebhookRepository(harness.database as never);

    await expect(
      repository.redeliver(accountId, webhookId, deliveryId, actorUserId)
    ).rejects.toThrow('insert failed');
    expect(harness.database.transaction).toHaveBeenCalledTimes(1);
    expect(harness.updateTraces[0]?.execute).toHaveBeenCalledTimes(1);
  });

  it('reports an unavailable channel before the inactive endpoint state', async () => {
    const harness = createRedeliveryHarness(undefined, {
      status: 'inactive',
      channel_available: false,
    });
    const repository = new OutboundWebhookRepository(harness.database as never);

    await expect(
      repository.redeliver(accountId, webhookId, deliveryId, actorUserId)
    ).resolves.toEqual({ status: 'channel_unavailable' });
    expect(harness.selectTraces).toHaveLength(1);
    expect(harness.updateTraces).toHaveLength(0);
    expect(harness.insertTraces).toHaveLength(0);
  });
});

describe('OutboundWebhookRepository endpoint quota', () => {
  it('serializes account creation and refuses a 26th active record', async () => {
    const selectRows = [
      [{ id: accountId }],
      [{ id: channelId }],
      [{ count: 25 }],
    ];
    const locks: string[] = [];
    const select = jest.fn(() => {
      const chain = {} as {
        from: jest.Mock;
        where: jest.Mock;
        for: jest.Mock;
        limit: jest.Mock;
        execute: jest.Mock;
      };
      chain.from = jest.fn(() => chain);
      chain.where = jest.fn(() => chain);
      chain.for = jest.fn((lock: string) => {
        locks.push(lock);
        return chain;
      });
      chain.limit = jest.fn(() => chain);
      chain.execute = jest.fn(async () => selectRows.shift() ?? []);
      return chain;
    });
    const insert = jest.fn();
    const tx = { select, insert };
    const database = {
      transaction: jest.fn(
        async (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx)
      ),
    };
    const repository = new OutboundWebhookRepository(database as never);

    await expect(
      repository.create({
        outbound_webhook_id: webhookId,
        account_id: accountId,
        channel_id: channelId,
        name: 'CRM',
        url: 'https://example.com/webhook',
        secret_hash: 'hash',
        secret_encrypted: 'encrypted',
        secret_preview: 'uc_whsec_...preview',
        event_types: ['chat.created'],
      })
    ).resolves.toBe('endpoint_limit');

    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(locks).toEqual(['update', 'update']);
    expect(select).toHaveBeenCalledTimes(3);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('OutboundWebhookRepository channel configuration', () => {
  it('bumps the config version only once when URL and channel change together', async () => {
    const newChannelId = '01900000-0000-7000-8000-000000000007';
    const selectRows = [
      [{ id: newChannelId }],
      [{ url: 'https://old.example.com/hook', channel_id: channelId }],
    ];
    const updates: Array<{ table: unknown; values?: Record<string, unknown> }> =
      [];
    const select = jest.fn(() => {
      const chain = {} as {
        from: jest.Mock;
        where: jest.Mock;
        for: jest.Mock;
        limit: jest.Mock;
        execute: jest.Mock;
      };
      chain.from = jest.fn(() => chain);
      chain.where = jest.fn(() => chain);
      chain.for = jest.fn(() => chain);
      chain.limit = jest.fn(() => chain);
      chain.execute = jest.fn(async () => selectRows.shift() ?? []);
      return chain;
    });
    const update = jest.fn((table: unknown) => {
      const trace: { table: unknown; values?: Record<string, unknown> } = {
        table,
      };
      updates.push(trace);
      const chain = {} as {
        set: jest.Mock;
        where: jest.Mock;
        execute: jest.Mock;
      };
      chain.set = jest.fn((values: Record<string, unknown>) => {
        trace.values = values;
        return chain;
      });
      chain.where = jest.fn(() => chain);
      chain.execute = jest.fn(async () => []);
      return chain;
    });
    const tx = { select, update };
    const database = {
      transaction: jest.fn(
        async (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx)
      ),
    };
    const repository = new OutboundWebhookRepository(database as never);

    await expect(
      repository.update(accountId, webhookId, {
        url: 'https://new.example.com/hook',
        channel_id: newChannelId,
      })
    ).resolves.toBe('updated');

    expect(updates).toHaveLength(1);
    expect(updates[0]?.table).toBe(outboundWebhook);
    expect(updates[0]?.values).toEqual(
      expect.objectContaining({
        url: 'https://new.example.com/hook',
        channel_id: newChannelId,
        status: 'inactive',
      })
    );
    const configVersionSql = new PgDialect().sqlToQuery(
      updates[0]?.values?.config_version as SQL
    );
    expect(configVersionSql.sql).toContain('+ 1');
    expect(configVersionSql.sql.match(/\+ 1/g)).toHaveLength(1);
  });
});
