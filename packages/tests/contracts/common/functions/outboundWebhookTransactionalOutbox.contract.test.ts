import type { SQL } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { outboundWebhookEvent } from '@core/models';
import {
  markOutboundWebhookDomainAppliedInTransaction,
  type MarkOutboundWebhookDomainAppliedInput,
} from '@core/common/functions/outboundWebhookTransactionalOutbox';

const eventId = '01900000-0000-7000-8000-000000000001';
const accountId = '01900000-0000-7000-8000-000000000002';
const channelId = '01900000-0000-7000-8000-000000000004';

const input = (): MarkOutboundWebhookDomainAppliedInput => ({
  eventId,
  accountId,
  envelope: {
    id: eventId,
    type: 'contact.created',
    api_version: '1',
    occurred_at: '2026-07-10T20:00:00.000Z',
    account_id: accountId,
    aggregate: {
      type: 'contact',
      id: '01900000-0000-7000-8000-000000000003',
    },
    data: { contact: { contact_id: 'contact-1', is_valided: true } },
    previous: null,
    context: {
      source: 'contract_test',
      channel_ids: [channelId],
      actor: { type: 'system' },
    },
  },
});

const updateHarness = (
  rows: Array<{ eventId: string }>,
  existingAppliedAt?: string | null
) => {
  let table: unknown;
  let values: Record<string, unknown> | undefined;
  let condition: SQL | undefined;
  const chain = {} as {
    set: jest.Mock;
    where: jest.Mock;
    returning: jest.Mock;
    execute: jest.Mock;
  };
  chain.set = jest.fn((nextValues: Record<string, unknown>) => {
    values = nextValues;
    return chain;
  });
  chain.where = jest.fn((nextCondition: SQL) => {
    condition = nextCondition;
    return chain;
  });
  chain.returning = jest.fn(() => chain);
  chain.execute = jest.fn(async () => rows);
  const selectChain = {} as {
    from: jest.Mock;
    where: jest.Mock;
    limit: jest.Mock;
    execute: jest.Mock;
  };
  selectChain.from = jest.fn(() => selectChain);
  selectChain.where = jest.fn(() => selectChain);
  selectChain.limit = jest.fn(() => selectChain);
  selectChain.execute = jest.fn(async () =>
    existingAppliedAt ? [{ appliedAt: existingAppliedAt }] : []
  );
  const tx = {
    select: jest.fn(() => selectChain),
    update: jest.fn((nextTable: unknown) => {
      table = nextTable;
      return chain;
    }),
  };

  return {
    tx,
    chain,
    trace: {
      table: () => table,
      values: () => values,
      condition: () => condition,
    },
  };
};

describe('transactional outbound webhook outbox marker', () => {
  it('models domain_applied_at as an explicit nullable timestamp', () => {
    const column = getTableConfig(outboundWebhookEvent).columns.find(
      (candidate) => candidate.name === 'domain_applied_at'
    );

    expect(column).toBeDefined();
    expect(column?.notNull).toBe(false);
    expect(column?.hasDefault).toBe(false);
  });

  it('persists the final envelope and applied marker while the event remains preparing', async () => {
    const request = input();
    const harness = updateHarness([{ eventId }]);

    await expect(
      markOutboundWebhookDomainAppliedInTransaction(
        harness.tx as never,
        request
      )
    ).resolves.toBeUndefined();

    expect(harness.trace.table()).toBe(outboundWebhookEvent);
    expect(harness.trace.values()).toEqual(
      expect.objectContaining({
        state: 'preparing',
        payload: request.envelope,
        domain_applied_at: expect.anything(),
      })
    );
    const markerSql = new PgDialect().sqlToQuery(
      harness.trace.values()?.domain_applied_at as SQL
    );
    expect(markerSql.sql).toBe('NOW()');

    const condition = new PgDialect().sqlToQuery(
      harness.trace.condition() as SQL
    );
    expect(condition.sql).toContain('"state" =');
    expect(condition.sql).toContain('"domain_applied_at" is null');
    expect(condition.sql).toContain('"event_type" =');
    expect(condition.sql).toContain('"aggregate_type" =');
    expect(condition.sql).toContain('"aggregate_id" =');
    expect(condition.params).toEqual(
      expect.arrayContaining([
        eventId,
        accountId,
        'preparing',
        request.envelope.type,
        request.envelope.aggregate.type,
        request.envelope.aggregate.id,
      ])
    );
  });

  it('fails the caller transaction when its expected preparing marker was not updated', async () => {
    const harness = updateHarness([]);

    await expect(
      markOutboundWebhookDomainAppliedInTransaction(
        harness.tx as never,
        input()
      )
    ).rejects.toThrow('outbound_webhook_event_domain_marker_not_updated');
    expect(harness.chain.execute).toHaveBeenCalledTimes(1);
  });

  it('rejects a second writer instead of overwriting an applied domain envelope', async () => {
    const harness = updateHarness([], '2026-07-10T20:00:01.000Z');

    await expect(
      markOutboundWebhookDomainAppliedInTransaction(
        harness.tx as never,
        input()
      )
    ).rejects.toThrow('outbound_webhook_event_domain_already_applied');
  });

  it('rejects an envelope for another event before issuing SQL', async () => {
    const harness = updateHarness([{ eventId }]);
    const request = input();
    request.envelope = { ...request.envelope, id: 'another-event' };

    await expect(
      markOutboundWebhookDomainAppliedInTransaction(
        harness.tx as never,
        request
      )
    ).rejects.toThrow('outbound_webhook_event_envelope_identity_mismatch');
    expect(harness.tx.update).not.toHaveBeenCalled();
  });
});
