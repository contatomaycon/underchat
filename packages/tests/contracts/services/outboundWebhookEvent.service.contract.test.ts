import 'reflect-metadata';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { container } from 'tsyringe';
import {
  OUTBOUND_WEBHOOK_EVENT_CATALOG,
  type OutboundWebhookEventType,
} from '@core/common/constants/outboundWebhookEvents';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import {
  buildOutboundWebhookEnvelope,
  type OutboundWebhookAggregate,
} from '@core/common/functions/outboundWebhookPayload';
import { OutboundWebhookEventService } from '@core/services/outboundWebhookEvent.service';
import { PlanEntitlementDeniedError } from '@core/common/exceptions/PlanEntitlementError';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { PlanEntitlementService } from '@core/services/planEntitlement.service';
import { PlanEntitlementRepository } from '@core/repositories/planEntitlement/PlanEntitlement.repository';

const channelId = '01900000-0000-7000-8000-000000000004';
const secondChannelId = '01900000-0000-7000-8000-000000000005';

const aggregateTypeForEvent = (
  eventType: OutboundWebhookEventType
): OutboundWebhookAggregate['type'] => {
  if (eventType === 'webhook.test') return 'webhook';
  if (eventType.startsWith('chat.')) return 'chat';
  if (eventType.startsWith('message.')) return 'message';
  return 'contact';
};

describe('outbound webhook event service contract', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves the entitlement dependencies through tsyringe', () => {
    const childContainer = container.createChildContainer();
    childContainer.register('DatabaseRw', { useValue: {} });
    childContainer.register(PlanEntitlementService, { useValue: {} as never });
    childContainer.register(PlanEntitlementRepository, {
      useValue: {} as never,
    });

    expect(childContainer.resolve(OutboundWebhookEventService)).toBeInstanceOf(
      OutboundWebhookEventService
    );

    childContainer.reset();
  });

  it('terminally discards prepared work when its Integration epoch is no longer entitled', async () => {
    const auditLog = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const eventId = '01900000-0000-7000-8000-000000000001';
    const accountId = '01900000-0000-7000-8000-000000000002';
    const selectChain = {
      from: jest.fn(),
      where: jest.fn(),
      for: jest.fn(),
      limit: jest.fn(),
      execute: jest.fn(async () => [
        {
          eventType: 'chat.created',
          isTest: false,
          state: 'preparing',
          aggregateType: 'chat',
          aggregateId: 'chat-1',
          routingChannelIds: [channelId],
          targetSnapshot: [
            {
              webhook_id: '01900000-0000-7000-8000-000000000003',
              channel_id: channelId,
              config_version: 1,
            },
          ],
          integrationEntitlementRevision: '3',
        },
      ]),
    };
    selectChain.from.mockReturnValue(selectChain);
    selectChain.where.mockReturnValue(selectChain);
    selectChain.for.mockReturnValue(selectChain);
    selectChain.limit.mockReturnValue(selectChain);
    const updates: Array<Record<string, unknown>> = [];
    const transaction = {
      select: jest.fn(() => selectChain),
      update: jest.fn(() => {
        const chain = {} as {
          set: jest.Mock;
          where: jest.Mock;
          execute: jest.Mock;
        };
        chain.set = jest.fn((values: Record<string, unknown>) => {
          updates.push(values);
          return chain;
        });
        chain.where = jest.fn(() => chain);
        chain.execute = jest.fn(async () => []);
        return chain;
      }),
    };
    const assertEntitled = jest.fn(async () => {
      throw new PlanEntitlementDeniedError({
        accountId,
        planProductId: EPlanProduct.integration,
        allowed: false,
        revision: '4',
      });
    });
    const service = new OutboundWebhookEventService(
      {
        transaction: jest.fn(
          async (callback: (tx: typeof transaction) => Promise<unknown>) =>
            callback(transaction)
        ),
      } as never,
      { assertEntitled } as never
    );
    const envelope = buildOutboundWebhookEnvelope({
      id: eventId,
      type: 'chat.created',
      occurredAt: '2026-07-10T12:00:00.000Z',
      accountId,
      aggregate: { type: 'chat', id: 'chat-1' },
      data: {},
      source: 'contract_test',
      channelIds: [channelId],
    });

    await expect(
      service.complete({ eventId, accountId, envelope })
    ).resolves.toBe('discarded');
    expect(assertEntitled).toHaveBeenCalledWith(
      accountId,
      EPlanProduct.integration,
      { expectedRevision: '3', bypassCache: true }
    );
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: 'discarded' }),
        expect.objectContaining({
          status: 'suppressed',
          last_error: 'integration_entitlement_missing',
        }),
      ])
    );
    expect(auditLog).toHaveBeenCalledWith(
      '[PlanEntitlementAudit] Outbound webhook event suppressed',
      expect.objectContaining({
        account_id: accountId,
        revision: '4',
        source: null,
        event_id: eventId,
      })
    );
  });

  it.each(OUTBOUND_WEBHOOK_EVENT_CATALOG)(
    'preserves aggregate and immutable channel scope for $type',
    async ({ type: eventType }) => {
      const aggregateType = aggregateTypeForEvent(eventType);
      const envelope = buildOutboundWebhookEnvelope({
        id: '01900000-0000-7000-8000-000000000001',
        type: eventType,
        occurredAt: '2026-07-10T12:00:00.000Z',
        accountId: '01900000-0000-7000-8000-000000000002',
        aggregate: { type: aggregateType, id: `${aggregateType}-1` },
        data: { covered: true },
        source: 'event_catalog_contract',
        channelIds: [secondChannelId, channelId, secondChannelId],
      });
      const query = {} as {
        from: jest.Mock;
        where: jest.Mock;
        limit: jest.Mock;
        execute: jest.Mock;
      };
      query.from = jest.fn(() => query);
      query.where = jest.fn(() => query);
      query.limit = jest.fn(() => query);
      query.execute = jest.fn(async () => [
        {
          eventId: envelope.id,
          payload: envelope,
          routingChannelIds: [channelId, secondChannelId],
          state: 'ready',
        },
      ]);
      const database = {
        select: jest.fn(() => query),
        insert: jest.fn(),
      };
      const service = new OutboundWebhookEventService(database as never);

      await expect(
        service.prepare({
          accountId: envelope.account_id,
          eventType,
          aggregate: envelope.aggregate,
          data: { replay: true },
          source: 'replay',
          channelIds: [channelId],
          idempotencyKey: `catalog:${eventType}`,
        })
      ).resolves.toEqual({
        eventId: envelope.id,
        envelope,
        created: false,
        state: 'ready',
      });
      expect(envelope.api_version).toBe('1');
      expect(envelope.aggregate.type).toBe(aggregateType);
      expect(envelope.context?.channel_ids).toEqual([
        channelId,
        secondChannelId,
      ]);
      expect(database.insert).not.toHaveBeenCalled();
    }
  );

  it('fails open when domain-event preparation infrastructure is unavailable', async () => {
    const query = {} as {
      from: jest.Mock;
      innerJoin: jest.Mock;
      where: jest.Mock;
      limit: jest.Mock;
      execute: jest.Mock;
    };
    query.from = jest.fn(() => query);
    query.innerJoin = jest.fn(() => query);
    query.where = jest.fn(() => query);
    query.limit = jest.fn(() => query);
    query.execute = jest.fn(async () => {
      throw new Error('postgres unavailable');
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    const service = new OutboundWebhookEventService({
      select: jest.fn(() => query),
    } as never);

    try {
      await expect(
        service.prepareBestEffort({
          accountId: '01900000-0000-7000-8000-000000000002',
          eventType: 'chat.created',
          aggregate: { type: 'chat', id: 'chat-1' },
          data: {},
          source: 'chat_service',
          channelIds: [channelId],
          idempotencyKey: 'chat-created:chat-1',
        })
      ).resolves.toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(
        '[OutboundWebhook] Unable to prepare domain event',
        expect.objectContaining({ error: 'outbound_webhook_operation_failed' })
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('silently suppresses best-effort capture when Integration is not entitled', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    const service = new OutboundWebhookEventService({} as never);
    service.prepare = jest.fn(async () => {
      throw new PlanEntitlementDeniedError({
        accountId: '01900000-0000-7000-8000-000000000002',
        planProductId: EPlanProduct.integration,
        allowed: false,
        revision: '4',
      });
    });

    try {
      await expect(
        service.prepareBestEffort({
          accountId: '01900000-0000-7000-8000-000000000002',
          eventType: 'message.updated',
          aggregate: { type: 'message', id: 'message-1' },
          data: {},
          source: 'message_status',
          channelIds: [channelId],
          idempotencyKey: 'message-updated:message-1',
        })
      ).resolves.toBeNull();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('leaves an applied event recoverable when completion fails', async () => {
    const service = new OutboundWebhookEventService({} as never);
    service.complete = jest.fn(async () => {
      throw new Error('postgres unavailable');
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    try {
      await expect(
        service.completeBestEffort({
          eventId: '01900000-0000-7000-8000-000000000001',
          accountId: '01900000-0000-7000-8000-000000000002',
          envelope: {
            id: '01900000-0000-7000-8000-000000000001',
            type: 'message.sent',
            api_version: '1',
            occurred_at: '2026-07-10T12:00:00.000Z',
            account_id: '01900000-0000-7000-8000-000000000002',
            aggregate: { type: 'message', id: 'message-1' },
            data: {},
          },
        })
      ).resolves.toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        '[OutboundWebhook] Unable to complete domain event',
        expect.objectContaining({
          event_id: '01900000-0000-7000-8000-000000000001',
          error: 'outbound_webhook_operation_failed',
        })
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('does not create journal rows for event types without active subscribers', async () => {
    const query = {} as {
      from: jest.Mock;
      innerJoin: jest.Mock;
      where: jest.Mock;
      limit: jest.Mock;
      execute: jest.Mock;
    };
    query.from = jest.fn(() => query);
    query.innerJoin = jest.fn(() => query);
    query.where = jest.fn(() => query);
    query.limit = jest.fn(() => query);
    query.execute = jest.fn(async () => []);
    const database = {
      select: jest.fn(() => query),
      insert: jest.fn(),
    };
    const service = new OutboundWebhookEventService(database as never);

    await expect(
      service.prepare({
        accountId: '01900000-0000-7000-8000-000000000002',
        eventType: 'chat.created',
        aggregate: { type: 'chat', id: 'chat-1' },
        data: {},
        source: 'chat_service',
        channelIds: [channelId],
        idempotencyKey: 'chat-created:chat-1',
      })
    ).resolves.toBeNull();
    expect(database.insert).not.toHaveBeenCalled();
  });

  it.each([
    {
      scenario: 'normal event',
      input: {
        eventType: 'chat.created' as const,
        aggregate: { type: 'chat' as const, id: 'chat-1' },
        idempotencyKey: 'ineligible-normal-event',
      },
      expectedError: null,
    },
    {
      scenario: 'targeted control event',
      input: {
        eventType: 'webhook.test' as const,
        aggregate: {
          type: 'webhook' as const,
          id: '01900000-0000-7000-8000-000000000003',
        },
        idempotencyKey: 'ineligible-control-event',
        isTest: true,
        targetWebhookId: '01900000-0000-7000-8000-000000000003',
        targetConfigVersion: 7,
      },
      expectedError: 'outbound_webhook_target_not_found',
    },
  ])(
    'requires a non-blocked account and latest current plan while capturing a $scenario',
    async ({ input, expectedError }) => {
      const whereClauses: SQL[] = [];
      const selectResults: unknown[][] = [[], []];
      const makeSelectChain = () => {
        const query = {} as {
          from: jest.Mock;
          innerJoin: jest.Mock;
          where: jest.Mock;
          limit: jest.Mock;
          execute: jest.Mock;
        };
        query.from = jest.fn(() => query);
        query.innerJoin = jest.fn(() => query);
        query.where = jest.fn((condition: SQL) => {
          whereClauses.push(condition);
          return query;
        });
        query.limit = jest.fn(() => query);
        query.execute = jest.fn(async () => selectResults.shift() ?? []);
        return query;
      };
      const database = {
        select: jest.fn(() => makeSelectChain()),
        insert: jest.fn(),
      };
      const service = new OutboundWebhookEventService(database as never);
      const preparation = service.prepare({
        accountId: '01900000-0000-7000-8000-000000000002',
        data: {},
        source: 'eligibility_contract',
        channelIds: [channelId],
        ...input,
      });

      if (expectedError) {
        await expect(preparation).rejects.toThrow(expectedError);
      } else {
        await expect(preparation).resolves.toBeNull();
      }

      expect(whereClauses).toHaveLength(2);
      const captureQuery = new PgDialect().sqlToQuery(whereClauses[1] as SQL);
      expect(captureQuery.sql).toContain('capture_account.account_status_id');
      expect(captureQuery.sql).toContain('<>');
      expect(captureQuery.sql).toContain('capture_account.deleted_at IS NULL');
      expect(captureQuery.sql).toContain('capture_latest_plan_account');
      expect(captureQuery.sql).toContain(
        'capture_plan_account.created_at DESC NULLS LAST'
      );
      expect(captureQuery.sql).toContain(
        'capture_plan_account.plan_account_id DESC'
      );
      expect(captureQuery.sql).toContain(
        'capture_latest_plan_account.next_payment_date > clock_timestamp()'
      );
      expect(captureQuery.sql).toContain('capture_plan.deleted_at IS NULL');
      expect(captureQuery.params).toContain(EAccountStatus.blocked);
      expect(captureQuery.params).not.toContain(EAccountStatus.active);
      expect(captureQuery.sql).not.toContain('capture_plan.status');
      expect(database.insert).not.toHaveBeenCalled();
    }
  );

  it('captures every active endpoint from channels A and B without leaking to channel C', async () => {
    const auditLog = jest.spyOn(console, 'info').mockImplementation(() => {});
    const channelA = channelId;
    const channelB = secondChannelId;
    const channelC = '01900000-0000-7000-8000-000000000006';
    const webhookA1 = '01900000-0000-7000-8000-000000000010';
    const webhookA2 = '01900000-0000-7000-8000-000000000011';
    const webhookB1 = '01900000-0000-7000-8000-000000000012';
    const selectResults = [
      [],
      [
        {
          webhook_id: webhookB1,
          channel_id: channelB,
          config_version: 5,
        },
        {
          webhook_id: webhookA2,
          channel_id: channelA,
          config_version: 4,
        },
        {
          webhook_id: webhookA1,
          channel_id: channelA,
          config_version: 3,
        },
      ],
    ];
    const whereClauses: SQL[] = [];
    const makeSelectChain = () => {
      const query = {} as {
        from: jest.Mock;
        innerJoin: jest.Mock;
        where: jest.Mock;
        limit: jest.Mock;
        execute: jest.Mock;
      };
      query.from = jest.fn(() => query);
      query.innerJoin = jest.fn(() => query);
      query.where = jest.fn((condition: SQL) => {
        whereClauses.push(condition);
        return query;
      });
      query.limit = jest.fn(() => query);
      query.execute = jest.fn(async () => selectResults.shift() ?? []);
      return query;
    };
    let insertedValues: Record<string, unknown> | undefined;
    const insert = {} as {
      values: jest.Mock;
      onConflictDoNothing: jest.Mock;
      returning: jest.Mock;
      execute: jest.Mock;
    };
    insert.values = jest.fn((values: Record<string, unknown>) => {
      insertedValues = values;
      return insert;
    });
    insert.onConflictDoNothing = jest.fn(() => insert);
    insert.returning = jest.fn(() => insert);
    insert.execute = jest.fn(async () => [
      {
        eventId: '01900000-0000-7000-8000-000000000001',
        state: 'preparing',
      },
    ]);
    const database = {
      select: jest.fn(() => makeSelectChain()),
      insert: jest.fn(() => insert),
    };
    const service = new OutboundWebhookEventService(
      database as never,
      {
        assertEntitled: jest.fn(async () => ({
          accountId: '01900000-0000-7000-8000-000000000002',
          planProductId: EPlanProduct.integration,
          allowed: true,
          revision: '9',
          validUntil: '2099-01-01T00:00:00.000Z',
          planIsActive: true,
          source: 'addon' as const,
        })),
      } as never
    );

    await expect(
      service.prepare({
        eventId: '01900000-0000-7000-8000-000000000001',
        accountId: '01900000-0000-7000-8000-000000000002',
        eventType: 'chat.transferred',
        aggregate: { type: 'chat', id: 'chat-1' },
        data: {},
        source: 'channel_routing_contract',
        channelIds: [channelB, channelA, channelB],
        idempotencyKey: 'chat-transfer-a-b',
      })
    ).resolves.toMatchObject({ state: 'preparing' });

    expect(insertedValues?.routing_channel_ids).toEqual([channelA, channelB]);
    expect(insertedValues?.target_snapshot).toEqual([
      {
        webhook_id: webhookA1,
        channel_id: channelA,
        config_version: 3,
      },
      {
        webhook_id: webhookA2,
        channel_id: channelA,
        config_version: 4,
      },
      {
        webhook_id: webhookB1,
        channel_id: channelB,
        config_version: 5,
      },
    ]);
    const captureQuery = new PgDialect().sqlToQuery(whereClauses[1] as SQL);
    expect(captureQuery.params).toEqual(
      expect.arrayContaining([channelA, channelB])
    );
    expect(captureQuery.params).not.toContain(channelC);
    expect(auditLog).toHaveBeenCalledWith(
      '[PlanEntitlementAudit] Outbound webhook event captured',
      expect.objectContaining({
        account_id: '01900000-0000-7000-8000-000000000002',
        revision: '9',
        source: 'addon',
        event_id: '01900000-0000-7000-8000-000000000001',
      })
    );
  });

  it('reuses an idempotent event without consulting current subscriptions', async () => {
    const persistedEnvelope = {
      id: '01900000-0000-7000-8000-000000000001',
      type: 'chat.created' as const,
      api_version: '1' as const,
      occurred_at: '2026-07-10T12:00:00.000Z',
      account_id: '01900000-0000-7000-8000-000000000002',
      aggregate: { type: 'chat' as const, id: 'chat-1' },
      data: {},
      context: { source: 'chat_service', channel_ids: [channelId] },
    };
    const query = {} as {
      from: jest.Mock;
      where: jest.Mock;
      limit: jest.Mock;
      execute: jest.Mock;
    };
    query.from = jest.fn(() => query);
    query.where = jest.fn(() => query);
    query.limit = jest.fn(() => query);
    query.execute = jest.fn(async () => [
      {
        eventId: persistedEnvelope.id,
        payload: persistedEnvelope,
        routingChannelIds: [channelId],
        state: 'ready',
      },
    ]);
    const database = {
      select: jest.fn(() => query),
      insert: jest.fn(),
    };
    const service = new OutboundWebhookEventService(database as never);

    await expect(
      service.prepare({
        accountId: persistedEnvelope.account_id,
        eventType: 'chat.created',
        aggregate: persistedEnvelope.aggregate,
        data: { replay: true },
        source: 'replay',
        channelIds: [],
        idempotencyKey: 'chat-created:chat-1',
      })
    ).resolves.toEqual({
      eventId: persistedEnvelope.id,
      envelope: persistedEnvelope,
      created: false,
      state: 'ready',
    });
    expect(database.select).toHaveBeenCalledTimes(1);
    expect(database.insert).not.toHaveBeenCalled();
  });

  it('rejects an event whose aggregate type does not match its catalog prefix during preparation', async () => {
    const database = {
      select: jest.fn(),
      insert: jest.fn(),
    };
    const service = new OutboundWebhookEventService(database as never);

    await expect(
      service.prepare({
        accountId: '01900000-0000-7000-8000-000000000002',
        eventType: 'chat.created',
        aggregate: { type: 'message', id: 'message-1' },
        data: {},
        source: 'chat_service',
        channelIds: [channelId],
        idempotencyKey: 'invalid-chat-aggregate',
        isTest: true,
      })
    ).rejects.toThrow('outbound_webhook_event_type_aggregate_mismatch');
    expect(database.select).not.toHaveBeenCalled();
    expect(database.insert).not.toHaveBeenCalled();
  });

  it('rejects an envelope whose event and aggregate types are incompatible before completion', async () => {
    const database = { transaction: jest.fn() };
    const service = new OutboundWebhookEventService(database as never);

    await expect(
      service.complete({
        eventId: '01900000-0000-7000-8000-000000000001',
        accountId: '01900000-0000-7000-8000-000000000002',
        envelope: {
          id: '01900000-0000-7000-8000-000000000001',
          type: 'message.sent',
          api_version: '1',
          occurred_at: '2026-07-10T12:00:00.000Z',
          account_id: '01900000-0000-7000-8000-000000000002',
          aggregate: { type: 'contact', id: 'contact-1' },
          data: {},
        },
      })
    ).rejects.toThrow('outbound_webhook_event_type_aggregate_mismatch');
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('always journals a targeted control test even while the endpoint is inactive', async () => {
    const targetWebhookId = '01900000-0000-7000-8000-000000000003';
    const selectResults = [
      [],
      [
        {
          webhook_id: targetWebhookId.toUpperCase(),
          channel_id: channelId.toUpperCase(),
          config_version: 7,
        },
      ],
    ];
    const makeSelectChain = () => {
      const query = {} as {
        from: jest.Mock;
        innerJoin: jest.Mock;
        where: jest.Mock;
        limit: jest.Mock;
        execute: jest.Mock;
      };
      query.from = jest.fn(() => query);
      query.innerJoin = jest.fn(() => query);
      query.where = jest.fn(() => query);
      query.limit = jest.fn(() => query);
      query.execute = jest.fn(async () => selectResults.shift() ?? []);
      return query;
    };
    let insertedValues: Record<string, unknown> | undefined;
    const insert = {} as {
      values: jest.Mock;
      onConflictDoNothing: jest.Mock;
      returning: jest.Mock;
      execute: jest.Mock;
    };
    insert.values = jest.fn((values: Record<string, unknown>) => {
      insertedValues = values;
      return insert;
    });
    insert.onConflictDoNothing = jest.fn(() => insert);
    insert.returning = jest.fn(() => insert);
    insert.execute = jest.fn(async () => [
      {
        eventId: '01900000-0000-7000-8000-000000000001',
        state: 'preparing',
      },
    ]);
    const database = {
      select: jest.fn(() => makeSelectChain()),
      insert: jest.fn(() => insert),
    };
    const service = new OutboundWebhookEventService(database as never);

    await expect(
      service.prepare({
        eventId: '01900000-0000-7000-8000-000000000001',
        accountId: '01900000-0000-7000-8000-000000000002',
        eventType: 'webhook.test',
        aggregate: {
          type: 'webhook',
          id: targetWebhookId,
        },
        data: {},
        source: 'integration_test',
        channelIds: [channelId],
        idempotencyKey: 'test-request-1',
        isTest: true,
        targetWebhookId,
        targetConfigVersion: 7,
      })
    ).resolves.toMatchObject({
      eventId: '01900000-0000-7000-8000-000000000001',
      state: 'preparing',
    });
    expect(database.select).toHaveBeenCalledTimes(2);
    expect(database.insert).toHaveBeenCalledTimes(1);
    expect(insertedValues?.target_snapshot).toEqual([
      {
        webhook_id: targetWebhookId,
        channel_id: channelId,
        config_version: 7,
      },
    ]);
    expect(insertedValues?.routing_channel_ids).toEqual([channelId]);
  });

  it('journals a compact event instead of losing an oversized public payload', async () => {
    const webhookId = '01900000-0000-7000-8000-000000000010';
    const selectResults = [
      [],
      [{ webhook_id: webhookId, channel_id: channelId, config_version: 2 }],
    ];
    const makeSelectChain = () => {
      const chain = {} as {
        from: jest.Mock;
        innerJoin: jest.Mock;
        where: jest.Mock;
        limit: jest.Mock;
        execute: jest.Mock;
      };
      chain.from = jest.fn(() => chain);
      chain.innerJoin = jest.fn(() => chain);
      chain.where = jest.fn(() => chain);
      chain.limit = jest.fn(() => chain);
      chain.execute = jest.fn(async () => selectResults.shift() ?? []);
      return chain;
    };
    let insertedValues:
      { payload: { data: unknown; previous?: unknown } } | undefined;
    const insert = {} as {
      values: jest.Mock;
      onConflictDoNothing: jest.Mock;
      returning: jest.Mock;
      execute: jest.Mock;
    };
    insert.values = jest.fn((values: unknown) => {
      insertedValues = values as {
        payload: { data: unknown; previous?: unknown };
      };
      return insert;
    });
    insert.onConflictDoNothing = jest.fn(() => insert);
    insert.returning = jest.fn(() => insert);
    insert.execute = jest.fn(async () => [
      {
        eventId: '01900000-0000-7000-8000-000000000001',
        state: 'preparing',
      },
    ]);
    const service = new OutboundWebhookEventService({
      select: jest.fn(() => makeSelectChain()),
      insert: jest.fn(() => insert),
    } as never);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

    try {
      await expect(
        service.prepare({
          eventId: '01900000-0000-7000-8000-000000000001',
          accountId: '01900000-0000-7000-8000-000000000002',
          eventType: 'message.updated',
          aggregate: { type: 'message', id: 'message-1' },
          data: Object.fromEntries(
            Array.from({ length: 5 }, (_, index) => [
              `field_${index}`,
              'x'.repeat(300_000),
            ])
          ),
          source: 'contract_test',
          channelIds: [channelId],
          idempotencyKey: 'oversized-message-1',
        })
      ).resolves.toMatchObject({ state: 'preparing' });

      expect(insertedValues?.payload.data).toEqual({
        payload_omitted: true,
        omission_reason: 'payload_too_large',
      });
      expect(insertedValues?.payload.previous).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        '[OutboundWebhook] Domain event payload was compacted',
        expect.objectContaining({ aggregate_id: 'message-1' })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  const createCompleteHarness = (eventState: 'preparing' | 'ready') => {
    const selectResults: unknown[][] = [
      [
        {
          eventType: 'chat.created',
          isTest: false,
          state: eventState,
          aggregateType: 'chat',
          aggregateId: 'chat-1',
          routingChannelIds: [channelId],
          targetSnapshot: [],
        },
      ],
      [],
    ];
    const updateSets: Array<Record<string, unknown>> = [];
    const makeSelectChain = () => {
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
      chain.where = jest.fn(() => chain);
      chain.for = jest.fn(() => chain);
      chain.limit = jest.fn(() => chain);
      chain.execute = jest.fn(async () => selectResults.shift() ?? []);
      return chain;
    };
    const transaction = {
      select: jest.fn(() => makeSelectChain()),
      update: jest.fn(() => {
        const chain = {} as {
          set: jest.Mock;
          where: jest.Mock;
          execute: jest.Mock;
        };
        chain.set = jest.fn((values: Record<string, unknown>) => {
          updateSets.push(values);
          return chain;
        });
        chain.where = jest.fn(() => chain);
        chain.execute = jest.fn(async () => []);
        return chain;
      }),
      insert: jest.fn(),
    };
    const database = {
      transaction: jest.fn(
        async (callback: (tx: typeof transaction) => Promise<void>) =>
          callback(transaction)
      ),
    };

    return { database, transaction, updateSets };
  };

  it('stores only a dedupe tombstone when an event has no subscribers', async () => {
    const harness = createCompleteHarness('preparing');
    const service = new OutboundWebhookEventService(harness.database as never);
    const envelope = {
      id: '01900000-0000-7000-8000-000000000001',
      type: 'chat.created' as const,
      api_version: '1' as const,
      occurred_at: '2026-07-10T12:00:00.000Z',
      account_id: '01900000-0000-7000-8000-000000000002',
      aggregate: { type: 'chat' as const, id: 'chat-1' },
      data: { large_snapshot: 'not retained without subscribers' },
      previous: { prior_snapshot: true },
      context: {
        source: 'chat_service',
        channel_ids: [channelId],
        actor: null,
      },
    };

    await service.complete({
      eventId: envelope.id,
      accountId: envelope.account_id,
      envelope,
    });

    expect(harness.transaction.insert).not.toHaveBeenCalled();
    expect(harness.updateSets).toEqual([
      expect.objectContaining({ state: 'ready', payload: envelope }),
      expect.objectContaining({
        state: 'discarded',
        payload: expect.objectContaining({
          data: { discarded: true },
          previous: null,
        }),
      }),
    ]);
  });

  it('does not fan out an already-ready event to endpoints added after the fact', async () => {
    const harness = createCompleteHarness('ready');
    const service = new OutboundWebhookEventService(harness.database as never);
    const envelope = {
      id: '01900000-0000-7000-8000-000000000001',
      type: 'chat.created' as const,
      api_version: '1' as const,
      occurred_at: '2026-07-10T12:00:00.000Z',
      account_id: '01900000-0000-7000-8000-000000000002',
      aggregate: { type: 'chat' as const, id: 'chat-1' },
      data: { sequence: 1 },
      previous: null,
      context: {
        source: 'chat_service',
        channel_ids: [channelId],
        actor: null,
      },
    };

    await expect(
      service.complete({
        eventId: envelope.id,
        accountId: envelope.account_id,
        envelope,
      })
    ).resolves.toBe('ready');

    expect(harness.transaction.select).toHaveBeenCalledTimes(1);
    expect(harness.transaction.update).not.toHaveBeenCalled();
    expect(harness.transaction.insert).not.toHaveBeenCalled();
  });

  it('fans out only to the endpoint/config snapshot captured before the fact', async () => {
    const capturedWebhookId = '01900000-0000-7000-8000-000000000010';
    const eventId = '01900000-0000-7000-8000-000000000001';
    const accountId = '01900000-0000-7000-8000-000000000002';
    const selectResults = [
      [
        {
          eventType: 'chat.created',
          isTest: false,
          state: 'preparing',
          aggregateType: 'chat',
          aggregateId: 'chat-1',
          routingChannelIds: [channelId],
          targetSnapshot: [
            {
              webhook_id: capturedWebhookId,
              channel_id: channelId,
              config_version: 3,
            },
          ],
        },
      ],
      [{ webhookId: capturedWebhookId, channelId }],
    ];
    const selectChains: Array<{ innerJoin: jest.Mock }> = [];
    const makeSelectChain = () => {
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
      chain.where = jest.fn(() => chain);
      chain.for = jest.fn(() => chain);
      chain.limit = jest.fn(() => chain);
      chain.execute = jest.fn(async () => selectResults.shift() ?? []);
      selectChains.push(chain);
      return chain;
    };
    let deliveryValues: Array<Record<string, unknown>> = [];
    type InsertChain = {
      values: jest.Mock;
      onConflictDoNothing: jest.Mock;
      execute: jest.Mock;
    };
    const insertChain = {} as InsertChain;
    Object.assign(insertChain, {
      values: jest.fn((values: Array<Record<string, unknown>>) => {
        deliveryValues = values;
        return insertChain;
      }),
      onConflictDoNothing: jest.fn(() => insertChain),
      execute: jest.fn(async () => []),
    });
    type UpdateChain = {
      set: jest.Mock;
      where: jest.Mock;
      execute: jest.Mock;
    };
    const updateChain = {} as UpdateChain;
    Object.assign(updateChain, {
      set: jest.fn(() => updateChain),
      where: jest.fn(() => updateChain),
      execute: jest.fn(async () => []),
    });
    const transaction = {
      select: jest.fn(() => makeSelectChain()),
      update: jest.fn(() => updateChain),
      insert: jest.fn(() => insertChain),
    };
    const database = {
      transaction: jest.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction)
      ),
    };
    const service = new OutboundWebhookEventService(database as never);
    const envelope = {
      id: eventId,
      type: 'chat.created' as const,
      api_version: '1' as const,
      occurred_at: '2026-07-10T12:00:00.000Z',
      account_id: accountId,
      aggregate: { type: 'chat' as const, id: 'chat-1' },
      data: {},
      context: { source: 'chat_service', channel_ids: [channelId] },
    };

    await expect(
      service.complete({ eventId, accountId, envelope })
    ).resolves.toBe('ready');

    expect(transaction.select).toHaveBeenCalledTimes(2);
    expect(selectChains[1]?.innerJoin).toHaveBeenCalledTimes(1);
    expect(deliveryValues).toEqual([
      expect.objectContaining({
        outbound_webhook_id: capturedWebhookId,
        outbound_webhook_event_id: eventId,
        config_version: 3,
        status: 'pending',
      }),
    ]);
  });

  it('does not fan out after the endpoint moves from its captured channel even when both channels are in scope', async () => {
    const capturedWebhookId = '01900000-0000-7000-8000-000000000010';
    const destinationChannelId = '01900000-0000-7000-8000-000000000011';
    const eventId = '01900000-0000-7000-8000-000000000001';
    const accountId = '01900000-0000-7000-8000-000000000002';
    const selectResults = [
      [
        {
          eventType: 'chat.transferred',
          isTest: false,
          state: 'preparing',
          aggregateType: 'chat',
          aggregateId: 'chat-1',
          routingChannelIds: [channelId, destinationChannelId],
          targetSnapshot: [
            {
              webhook_id: capturedWebhookId,
              channel_id: channelId,
              config_version: 3,
            },
          ],
        },
      ],
      [{ webhookId: capturedWebhookId, channelId: destinationChannelId }],
    ];
    const makeSelectChain = () => {
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
      chain.where = jest.fn(() => chain);
      chain.for = jest.fn(() => chain);
      chain.limit = jest.fn(() => chain);
      chain.execute = jest.fn(async () => selectResults.shift() ?? []);
      return chain;
    };
    const updateChain = {
      set: jest.fn(),
      where: jest.fn(),
      execute: jest.fn(async () => []),
    };
    updateChain.set.mockReturnValue(updateChain);
    updateChain.where.mockReturnValue(updateChain);
    const transaction = {
      select: jest.fn(() => makeSelectChain()),
      update: jest.fn(() => updateChain),
      insert: jest.fn(),
    };
    const service = new OutboundWebhookEventService({
      transaction: jest.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction)
      ),
    } as never);
    const envelope = {
      id: eventId,
      type: 'chat.transferred' as const,
      api_version: '1' as const,
      occurred_at: '2026-07-10T12:00:00.000Z',
      account_id: accountId,
      aggregate: { type: 'chat' as const, id: 'chat-1' },
      data: {},
      context: {
        source: 'chat_service',
        channel_ids: [channelId, destinationChannelId],
      },
    };

    await expect(
      service.complete({ eventId, accountId, envelope })
    ).resolves.toBe('discarded');

    expect(transaction.insert).not.toHaveBeenCalled();
    expect(updateChain.set).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'discarded' })
    );
  });

  it('keeps the first persisted envelope when recordReady is replayed', async () => {
    const service = new OutboundWebhookEventService({} as never);
    const persistedEnvelope = {
      id: '01900000-0000-7000-8000-000000000001',
      type: 'chat.created' as const,
      api_version: '1' as const,
      occurred_at: '2026-07-10T12:00:00.000Z',
      account_id: '01900000-0000-7000-8000-000000000002',
      aggregate: { type: 'chat' as const, id: 'chat-1' },
      data: { sequence: 1 },
      previous: null,
      context: {
        source: 'chat_service',
        channel_ids: [channelId],
        actor: null,
      },
    };
    service.prepare = jest.fn(async () => ({
      eventId: persistedEnvelope.id,
      envelope: persistedEnvelope,
      created: false,
      state: 'ready' as const,
    }));
    service.complete = jest.fn(async () => 'ready' as const);

    const result = await service.recordReady({
      accountId: persistedEnvelope.account_id,
      eventType: 'chat.created',
      aggregate: persistedEnvelope.aggregate,
      data: { sequence: 2 },
      source: 'replayed_source',
      channelIds: [channelId],
      idempotencyKey: 'same-operation',
    });

    expect(service.complete).toHaveBeenCalledWith({
      eventId: persistedEnvelope.id,
      accountId: persistedEnvelope.account_id,
      envelope: persistedEnvelope,
      targetWebhookId: undefined,
    });
    expect(result.envelope).toBe(persistedEnvelope);
  });

  it('cannot route a control-test aggregate to a different endpoint', async () => {
    const selectChain = {
      from: jest.fn(),
      where: jest.fn(),
      for: jest.fn(),
      limit: jest.fn(),
      execute: jest.fn(async () => [
        {
          eventType: 'webhook.test',
          isTest: true,
          state: 'preparing',
          aggregateType: 'webhook',
          aggregateId: '01900000-0000-7000-8000-000000000010',
          routingChannelIds: [channelId],
          targetSnapshot: [],
        },
      ]),
    };
    selectChain.from.mockReturnValue(selectChain);
    selectChain.where.mockReturnValue(selectChain);
    selectChain.for.mockReturnValue(selectChain);
    selectChain.limit.mockReturnValue(selectChain);
    const transaction = { select: jest.fn(() => selectChain) };
    const database = {
      transaction: jest.fn(
        async (callback: (tx: typeof transaction) => Promise<void>) =>
          callback(transaction)
      ),
    };
    const service = new OutboundWebhookEventService(database as never);

    await expect(
      service.complete({
        eventId: '01900000-0000-7000-8000-000000000001',
        accountId: '01900000-0000-7000-8000-000000000002',
        targetWebhookId: '01900000-0000-7000-8000-000000000011',
        envelope: {
          id: '01900000-0000-7000-8000-000000000001',
          type: 'webhook.test',
          api_version: '1',
          occurred_at: '2026-07-10T12:00:00.000Z',
          account_id: '01900000-0000-7000-8000-000000000002',
          aggregate: {
            type: 'webhook',
            id: '01900000-0000-7000-8000-000000000010',
          },
          data: {},
          context: { source: 'integration_test', channel_ids: [channelId] },
        },
      })
    ).rejects.toThrow('outbound_webhook_event_invalid_target');
  });
});
