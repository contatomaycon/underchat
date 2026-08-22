import 'reflect-metadata';
import { OutboundWebhookEventRecoveryService } from '@core/services/outboundWebhookEventRecovery.service';

const accountId = '01900000-0000-7000-8000-000000000001';
const contactId = '01900000-0000-7000-8000-000000000002';
const eventId = '01900000-0000-7000-8000-000000000003';

const contactRow = {
  contact_id: contactId,
  account_id: accountId,
  name: 'Maycon',
  last_name: null,
  email_partial: 'm***@example.com',
  phone_ddi: '55',
  phone_partial: '*****9999',
  nickname: null,
  photo: null,
  birthday: null,
  notes: null,
  document_partial: null,
  contact_document_type_id: null,
  user_id: null,
  ignore: null,
  is_valided: true,
  created_at: '2026-07-10T12:00:00.000Z',
  updated_at: '2026-07-10T12:01:00.000Z',
  deleted_at: null,
};

function recoveryWithContact(row: Record<string, unknown> | null) {
  const database = {
    execute: jest.fn(async () => ({ rows: row ? [row] : [] })),
  };
  return {
    database,
    recovery: new OutboundWebhookEventRecoveryService(
      database as never,
      {} as never
    ),
  };
}

function event(
  type: 'contact.created' | 'contact.updated' | 'contact.deleted',
  intended: Record<string, unknown>,
  previous: Record<string, unknown> | null
) {
  return {
    outbound_webhook_event_id: eventId,
    account_id: accountId,
    aggregate_type: 'contact',
    aggregate_id: contactId,
    domain_applied_at: null,
    integration_entitlement_revision: '3',
    created_at: '2026-07-10T12:00:00.000Z',
    payload: {
      id: eventId,
      type,
      api_version: '1',
      occurred_at: '2026-07-10T12:00:00.000Z',
      account_id: accountId,
      aggregate: { type: 'contact', id: contactId },
      data: { contact: intended },
      previous: previous ? { contact: previous } : null,
      context: { source: 'contract_test' },
    },
  };
}

describe('OutboundWebhookEventRecoveryService contact proof', () => {
  it('recovers contact.created only when the account-scoped row exists', async () => {
    const { recovery } = recoveryWithContact(contactRow);

    await expect(
      (recovery as any).hasAppliedContactMutation(
        event('contact.created', { contact_id: contactId }, null)
      )
    ).resolves.toBe(true);
  });

  it('recovers contact.updated when every changed public field reached the intended value', async () => {
    const { recovery } = recoveryWithContact(contactRow);

    await expect(
      (recovery as any).hasAppliedContactMutation(
        event(
          'contact.updated',
          {
            contact_id: contactId,
            phone: '*****9999',
            is_valided: true,
          },
          {
            contact_id: contactId,
            phone: '*****0000',
            is_valided: false,
          }
        )
      )
    ).resolves.toBe(true);
  });

  it('does not invent an update when the intended state was not persisted', async () => {
    const { recovery } = recoveryWithContact({
      ...contactRow,
      phone_partial: '*****0000',
      is_valided: false,
    });

    await expect(
      (recovery as any).hasAppliedContactMutation(
        event(
          'contact.updated',
          { contact_id: contactId, phone: '*****9999', is_valided: true },
          { contact_id: contactId, phone: '*****0000', is_valided: false }
        )
      )
    ).resolves.toBe(false);
  });

  it('proves a label addition from the intended relation membership', async () => {
    const labelId = '01900000-0000-7000-8000-000000000010';
    const { recovery } = recoveryWithContact({
      ...contactRow,
      label_templates: [
        { label_template_id: labelId, label: 'VIP', color: '#2563eb' },
      ],
      contact_groups: [],
      channel_ids: [],
    });

    await expect(
      (recovery as any).hasAppliedContactMutation(
        event(
          'contact.updated',
          {
            contact_id: contactId,
            label_templates: [{ label_template_id: labelId }],
          },
          { contact_id: contactId, label_templates: [] }
        )
      )
    ).resolves.toBe(true);
  });

  it('proves a label removal only when the canonical relation count matches', async () => {
    const labelId = '01900000-0000-7000-8000-000000000011';
    const { recovery } = recoveryWithContact({
      ...contactRow,
      label_templates: [],
      contact_groups: [],
      channel_ids: [],
    });

    await expect(
      (recovery as any).hasAppliedContactMutation(
        event(
          'contact.updated',
          { contact_id: contactId, label_templates: [] },
          {
            contact_id: contactId,
            label_templates: [{ label_template_id: labelId }],
          }
        )
      )
    ).resolves.toBe(true);
  });

  it('recovers contact.deleted only from the account-scoped soft-deleted row', async () => {
    const { recovery } = recoveryWithContact({
      ...contactRow,
      deleted_at: '2026-07-10T12:02:00.000Z',
    });

    await expect(
      (recovery as any).hasAppliedContactMutation(
        event(
          'contact.deleted',
          {
            contact_id: contactId,
            deleted_at: '2026-07-10T12:02:00.000Z',
          },
          { contact_id: contactId, deleted_at: null }
        )
      )
    ).resolves.toBe(true);
  });
});

describe('OutboundWebhookEventRecoveryService transactional outbox proof', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const installEventService = (
    recovery: OutboundWebhookEventRecoveryService
  ) => {
    const complete = jest.fn(async () => 'ready' as const);
    Object.assign(recovery as object, { eventService: { complete } });
    return complete;
  };

  it('trusts domain_applied_at without reading a later aggregate snapshot', async () => {
    const auditLog = jest.spyOn(console, 'info').mockImplementation(() => {});
    const persistedEvent = {
      ...event('contact.created', { contact_id: contactId }, null),
      domain_applied_at: '2026-07-10T12:00:30.000Z',
    };
    const database = {
      execute: jest.fn(async () => ({ rows: [persistedEvent] })),
    };
    const elasticDatabaseService = {
      getById: jest.fn(async () => {
        throw new Error('snapshot must not be read');
      }),
    };
    const recovery = new OutboundWebhookEventRecoveryService(
      database as never,
      elasticDatabaseService as never,
      null,
      {
        resolveEntitlement: jest.fn(async () => ({
          accountId,
          planProductId: '0eb84ca1-8145-4770-acd4-b6725fe1cf25',
          allowed: true,
          revision: '3',
          validUntil: '2099-01-01T00:00:00.000Z',
          planIsActive: true,
          source: 'plan' as const,
        })),
      } as never
    );
    const complete = installEventService(recovery);

    await expect(
      recovery.reconcile(100, new Date('2026-07-10T12:02:00.000Z'))
    ).resolves.toEqual({
      scanned: 1,
      recovered: 1,
      quarantined: 0,
      pending: 0,
      failed: 0,
      suppressed: 0,
    });

    expect(database.execute).toHaveBeenCalledTimes(1);
    expect(elasticDatabaseService.getById).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith({
      eventId,
      accountId,
      envelope: persistedEvent.payload,
    });
    expect(auditLog).toHaveBeenCalledWith(
      '[PlanEntitlementAudit] Outbound webhook recovery admitted event',
      expect.objectContaining({
        account_id: accountId,
        revision: '3',
        source: 'plan',
        event_id: eventId,
      })
    );
  });

  it('uses the canonical snapshot proof only for a legacy NULL marker', async () => {
    const persistedEvent = event(
      'contact.created',
      { contact_id: contactId },
      null
    );
    const database = {
      execute: jest
        .fn()
        .mockResolvedValueOnce({ rows: [persistedEvent] })
        .mockResolvedValueOnce({ rows: [contactRow] }),
    };
    const recovery = new OutboundWebhookEventRecoveryService(
      database as never,
      {} as never,
      null,
      {
        resolveEntitlement: jest.fn(async () => ({
          accountId,
          planProductId: '0eb84ca1-8145-4770-acd4-b6725fe1cf25',
          allowed: true,
          revision: '3',
          validUntil: '2099-01-01T00:00:00.000Z',
          planIsActive: true,
          source: 'plan' as const,
        })),
      } as never
    );
    const complete = installEventService(recovery);

    await expect(
      recovery.reconcile(100, new Date('2026-07-10T12:02:00.000Z'))
    ).resolves.toMatchObject({ recovered: 1, failed: 0 });

    expect(database.execute).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenCalledWith({
      eventId,
      accountId,
      envelope: persistedEvent.payload,
    });
  });

  it('terminally suppresses a legacy event without an entitlement revision', async () => {
    const auditLog = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const persistedEvent = {
      ...event('contact.created', { contact_id: contactId }, null),
      integration_entitlement_revision: null,
      domain_applied_at: '2026-07-10T12:00:30.000Z',
    };
    const transactionExecute = jest.fn(async () => ({ rows: [] }));
    const database = {
      execute: jest.fn(async () => ({ rows: [persistedEvent] })),
      transaction: jest.fn(
        async (
          callback: (transaction: {
            execute: typeof transactionExecute;
          }) => unknown
        ) => callback({ execute: transactionExecute })
      ),
    };
    const entitlementRepository = { resolveEntitlement: jest.fn() };
    const recovery = new OutboundWebhookEventRecoveryService(
      database as never,
      {} as never,
      { complete: jest.fn(), quarantine: jest.fn() } as never,
      entitlementRepository as never
    );

    await expect(
      recovery.reconcile(100, new Date('2026-07-10T12:02:00.000Z'))
    ).resolves.toMatchObject({
      scanned: 1,
      recovered: 0,
      suppressed: 1,
      failed: 0,
    });
    expect(entitlementRepository.resolveEntitlement).not.toHaveBeenCalled();
    expect(transactionExecute).toHaveBeenCalledTimes(2);
    expect(auditLog).toHaveBeenCalledWith(
      '[PlanEntitlementAudit] Outbound webhook recovery suppressed event',
      expect.objectContaining({
        account_id: accountId,
        source: null,
        event_id: eventId,
      })
    );
  });

  it('logs the current addon source when suppressing a stale recovery epoch', async () => {
    const persistedEvent = {
      ...event('contact.created', { contact_id: contactId }, null),
      domain_applied_at: '2026-07-10T12:00:30.000Z',
    };
    const auditLog = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const transactionExecute = jest.fn(async () => ({ rows: [] }));
    const database = {
      execute: jest.fn(async () => ({ rows: [persistedEvent] })),
      transaction: jest.fn(
        async (
          callback: (transaction: {
            execute: typeof transactionExecute;
          }) => unknown
        ) => callback({ execute: transactionExecute })
      ),
    };
    const recovery = new OutboundWebhookEventRecoveryService(
      database as never,
      {} as never,
      { complete: jest.fn(), quarantine: jest.fn() } as never,
      {
        resolveEntitlement: jest.fn(async () => ({
          accountId,
          planProductId: '0eb84ca1-8145-4770-acd4-b6725fe1cf25',
          allowed: true,
          revision: '4',
          validUntil: '2099-01-01T00:00:00.000Z',
          planIsActive: true,
          source: 'addon' as const,
        })),
      } as never
    );

    await expect(
      recovery.reconcile(100, new Date('2026-07-10T12:02:00.000Z'))
    ).resolves.toMatchObject({ suppressed: 1, failed: 0 });
    expect(auditLog).toHaveBeenCalledWith(
      '[PlanEntitlementAudit] Outbound webhook recovery suppressed event',
      expect.objectContaining({
        account_id: accountId,
        revision: '4',
        source: 'addon',
        event_id: eventId,
      })
    );
  });
});
