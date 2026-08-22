import 'reflect-metadata';
import type { SQL } from 'drizzle-orm';
import {
  lockContactOutboundWebhookSnapshotInTransaction,
  markContactOutboundWebhookAppliedInTransaction,
  type ContactOutboundWebhookMarker,
} from '@core/repositories/contact/contactOutboundWebhookOutbox';

const accountId = '01900000-0000-7000-8000-000000000001';
const contactId = '01900000-0000-7000-8000-000000000002';
const eventId = '01900000-0000-7000-8000-000000000003';
const channelId = '01900000-0000-7000-8000-000000000004';

type SelectResult = Array<Record<string, unknown>>;

function createSelectHarness(results: SelectResult[]) {
  const locks: string[] = [];
  const executions: jest.Mock[] = [];
  const select = jest.fn(() => {
    const result = results.shift() ?? [];
    const execute = jest.fn(async () => result);
    executions.push(execute);
    const chain = {} as Record<string, jest.Mock>;
    for (const method of [
      'from',
      'leftJoin',
      'innerJoin',
      'where',
      'limit',
      'orderBy',
    ]) {
      chain[method] = jest.fn(() => chain);
    }
    chain.for = jest.fn((lock: string) => {
      locks.push(lock);
      return chain;
    });
    chain.execute = execute;
    return chain;
  });

  return { select, locks, executions };
}

function canonicalResults(): SelectResult[] {
  return [
    [
      {
        contact_id: contactId,
        account_id: accountId,
        mutation_revision: '77',
        name: 'Contato final',
        last_name: null,
        email_partial: 'm***@example.com',
        phone_ddi: '55',
        phone_partial: '*****9999',
        nickname: null,
        photo: null,
        birthday: null,
        notes: 'public note',
        document_partial: '***1234',
        contact_document_type_id: null,
        contact_document_type_name: null,
        user_id: null,
        responsible_name: null,
        responsible_last_name: null,
        responsible_photo: null,
        ignore: 'not_ignore',
        is_valided: true,
        created_at: '2026-07-10T20:00:00.000Z',
        updated_at: '2026-07-10T20:01:00.000Z',
        deleted_at: null,
      },
    ],
    [{ label_template_id: 'label-1', label: 'VIP', color: '#ffffff' }],
    [{ contact_group_id: 'group-1', name: 'Clientes' }],
    [{ channel_id: 'channel-1' }],
  ];
}

function marker(): ContactOutboundWebhookMarker {
  return {
    eventId,
    accountId,
    envelope: {
      id: eventId,
      type: 'contact.updated',
      api_version: '1',
      occurred_at: '2026-07-10T20:01:00.000Z',
      account_id: accountId,
      aggregate: { type: 'contact', id: contactId },
      data: { contact: { contact_id: contactId, name: 'intended' } },
      previous: { contact: { contact_id: contactId, name: 'stale' } },
      context: {
        source: 'contract_test',
        channel_ids: [channelId],
        actor: { type: 'system' },
      },
    },
  };
}

describe('contact transactional outbound webhook projection', () => {
  it('locks the account-scoped mutable contact before reading its complete public snapshot', async () => {
    const harness = createSelectHarness([
      [{ contact_id: contactId }],
      ...canonicalResults(),
    ]);
    const tx = { select: harness.select };

    await expect(
      lockContactOutboundWebhookSnapshotInTransaction(
        tx as never,
        contactId,
        marker()
      )
    ).resolves.toEqual(
      expect.objectContaining({
        contact_id: contactId,
        account_id: accountId,
        mutation_revision: '77',
        email_partial: 'm***@example.com',
        phone_partial: '*****9999',
        label_templates: [
          { label_template_id: 'label-1', label: 'VIP', color: '#ffffff' },
        ],
        contact_groups: [{ contact_group_id: 'group-1', name: 'Clientes' }],
        channel_ids: ['channel-1'],
      })
    );

    expect(harness.locks).toEqual(['update']);
    expect(harness.select).toHaveBeenCalledTimes(5);
    expect(
      harness.executions.every((execute) => execute.mock.calls.length === 1)
    ).toBe(true);
  });

  it('freezes canonical post-write data and the transaction-locked previous snapshot in the event marker', async () => {
    const selects = createSelectHarness(canonicalResults());
    let markedValues: Record<string, unknown> | undefined;
    let markerCondition: SQL | undefined;
    const updateExecute = jest.fn(async () => [{ eventId }]);
    const updateChain = {} as {
      set: jest.Mock;
      where: jest.Mock;
      returning: jest.Mock;
      execute: jest.Mock;
    };
    updateChain.set = jest.fn((values: Record<string, unknown>) => {
      markedValues = values;
      return updateChain;
    });
    updateChain.where = jest.fn((condition: SQL) => {
      markerCondition = condition;
      return updateChain;
    });
    updateChain.returning = jest.fn(() => updateChain);
    updateChain.execute = updateExecute;
    const tx = {
      select: selects.select,
      update: jest.fn(() => updateChain),
    };
    const previous = {
      contact_id: contactId,
      name: 'Contato anterior',
      email_partial: 'a***@example.com',
      phone_partial: '*****0000',
      document_partial: '***0000',
      label_templates: [],
      contact_groups: [],
      channel_ids: [],
      is_valided: false,
    };

    await expect(
      markContactOutboundWebhookAppliedInTransaction(
        tx as never,
        contactId,
        marker(),
        previous
      )
    ).resolves.toBeUndefined();

    const persistedEnvelope = markedValues?.payload as {
      data: { contact: Record<string, unknown> };
      previous: { contact: Record<string, unknown> };
    };
    expect(persistedEnvelope.data.contact).toEqual(
      expect.objectContaining({
        contact_id: contactId,
        name: 'Contato final',
        email: 'm***@example.com',
        phone: '*****9999',
        document: '***1234',
        label_templates: [
          { label_template_id: 'label-1', label: 'VIP', color: '#ffffff' },
        ],
        contact_groups: [{ contact_group_id: 'group-1', name: 'Clientes' }],
        channel_ids: ['channel-1'],
      })
    );
    expect(persistedEnvelope.previous.contact).toEqual(
      expect.objectContaining({
        contact_id: contactId,
        name: 'Contato anterior',
        email: 'a***@example.com',
        phone: '*****0000',
        document: '***0000',
        is_valided: false,
      })
    );
    expect(JSON.stringify(persistedEnvelope)).not.toContain('stale');
    expect(markerCondition).toBeDefined();
    expect(updateExecute.mock.invocationCallOrder[0]).toBeGreaterThan(
      Math.max(
        ...selects.executions.map(
          (execute) => execute.mock.invocationCallOrder[0] ?? 0
        )
      )
    );
  });
});
