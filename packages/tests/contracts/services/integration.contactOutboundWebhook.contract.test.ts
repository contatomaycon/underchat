import 'reflect-metadata';
import type { PrepareOutboundWebhookEventInput } from '@core/services/outboundWebhookEvent.service';
import { IntegrationService } from '@core/services/integration.service';

const accountId = '01900000-0000-7000-8000-000000000001';
const labelId = '01900000-0000-7000-8000-000000000002';
const eventId = '01900000-0000-7000-8000-000000000003';
const workerId = '01900000-0000-7000-8000-000000000004';

describe('IntegrationService contact outbound webhook coverage', () => {
  it('journals a transaction-created contact with the same durable contact ID', async () => {
    const prepareBestEffort = jest.fn(
      async (input: PrepareOutboundWebhookEventInput) => ({
        eventId,
        created: true,
        state: 'preparing' as const,
        envelope: {
          id: eventId,
          type: input.eventType,
          api_version: '1' as const,
          occurred_at: '2026-07-10T20:00:00.000Z',
          account_id: input.accountId,
          aggregate: input.aggregate,
          data: input.data,
          previous: input.previous ?? null,
          context: {
            source: input.source,
            channel_ids: [...input.channelIds],
            actor: input.actor ?? null,
          },
        },
      })
    );
    const completeBestEffort = jest.fn(async () => false);
    const completePersistedBestEffort = jest.fn(async () => false);
    const getContactById = jest.fn();
    const viewContactOutboundWebhookSnapshot = jest.fn(
      async (_contactId: string, requestedAccountId: string) => ({
        contact_id: _contactId,
        account_id: requestedAccountId,
        name: 'Maycon',
        phone_ddi: '55',
        phone_partial: '61*****999',
        is_valided: true,
        label_templates: [
          {
            label_template_id: labelId,
            label: 'Cliente',
            color: '#000000',
          },
        ],
        contact_groups: [],
        channel_ids: [],
        created_at: '2026-07-10T19:59:59.000Z',
        updated_at: '2026-07-10T20:00:00.000Z',
        deleted_at: null,
      })
    );
    const createContact = jest.fn(
      async (_payload: unknown, _tx: unknown, requestedId: string) =>
        requestedId
    );
    const service = Reflect.construct(
      IntegrationService,
      Array.from({ length: 40 }, () => ({}))
    ) as IntegrationService;
    Object.assign(service, {
      outboundWebhookEventService: {
        prepareBestEffort,
        completeBestEffort,
        completePersistedBestEffort,
      },
      dbRw: {
        transaction: jest.fn(async (callback: (tx: object) => unknown) =>
          callback({})
        ),
      },
      processLabelsInTransaction: jest.fn(async () => [labelId]),
      contactCreatorRepository: { createContact },
      contactService: {
        getContactById,
        viewContactOutboundWebhookSnapshot,
      },
      passwordEncryptorService: { encrypt: jest.fn((value) => value) },
      encryptService: {
        encrypt: jest.fn((value) => value),
        sanitize: jest.fn((value) => value),
      },
    });

    const result = await (
      service as unknown as {
        createContactWithLabels(
          requestedAccountId: string,
          requestedWorkerId: string,
          mappedData: Record<string, unknown>,
          isValidated: boolean
        ): Promise<string | null>;
      }
    ).createContactWithLabels(
      accountId,
      workerId,
      {
        first_name: 'Maycon',
        email: 'maycon@example.com',
        phone_ddi: '55',
        phone: '61999999999',
        labels: ['Cliente'],
      },
      true
    );

    const requestedContactId =
      prepareBestEffort.mock.calls[0]?.[0].aggregate.id;
    expect(result).toBe(requestedContactId);
    expect(createContact).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      requestedContactId,
      expect.objectContaining({
        eventId,
        accountId,
        envelope: expect.objectContaining({
          aggregate: { type: 'contact', id: requestedContactId },
        }),
      })
    );
    expect(prepareBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `integration-contact-created:${requestedContactId}`,
        data: expect.objectContaining({
          contact: expect.objectContaining({
            contact_id: requestedContactId,
            email: expect.stringContaining('*'),
            phone: expect.stringContaining('*'),
            is_valided: true,
            label_templates: [{ label: 'Cliente' }],
            channel_ids: [workerId],
            contact_groups: [],
          }),
        }),
      })
    );
    const preparedPayload = JSON.stringify(
      prepareBestEffort.mock.calls[0]?.[0]
    );
    expect(preparedPayload).not.toContain('maycon@example.com');
    expect(preparedPayload).not.toContain('61999999999');
    expect(viewContactOutboundWebhookSnapshot).not.toHaveBeenCalled();
    expect(getContactById).not.toHaveBeenCalled();
    expect(completeBestEffort).not.toHaveBeenCalled();
    expect(completePersistedBestEffort).toHaveBeenCalledWith({
      eventId,
      accountId,
    });
  });

  it('completes contact.created from the envelope frozen in its transaction', async () => {
    const prepareBestEffort = jest.fn(
      async (input: PrepareOutboundWebhookEventInput) => ({
        eventId,
        created: true,
        state: 'preparing' as const,
        envelope: {
          id: eventId,
          type: input.eventType,
          api_version: '1' as const,
          occurred_at: '2026-07-10T20:00:00.000Z',
          account_id: input.accountId,
          aggregate: input.aggregate,
          data: input.data,
          previous: input.previous ?? null,
          context: {
            source: input.source,
            channel_ids: [...input.channelIds],
            actor: input.actor ?? null,
          },
        },
      })
    );
    const completeBestEffort = jest.fn(async () => true);
    const completePersistedBestEffort = jest.fn(async () => true);
    const viewContactOutboundWebhookSnapshot = jest.fn(async () => null);
    const service = Reflect.construct(
      IntegrationService,
      Array.from({ length: 40 }, () => ({}))
    ) as IntegrationService;
    Object.assign(service, {
      outboundWebhookEventService: {
        prepareBestEffort,
        completeBestEffort,
        completePersistedBestEffort,
      },
      dbRw: {
        transaction: jest.fn(async (callback: (tx: object) => unknown) =>
          callback({})
        ),
      },
      processLabelsInTransaction: jest.fn(async () => []),
      contactCreatorRepository: {
        createContact: jest.fn(
          async (_payload: unknown, _tx: unknown, requestedId: string) =>
            requestedId
        ),
      },
      contactService: { viewContactOutboundWebhookSnapshot },
      passwordEncryptorService: { encrypt: jest.fn((value) => value) },
      encryptService: {
        encrypt: jest.fn((value) => value),
        sanitize: jest.fn((value) => value),
      },
    });

    const result = await (
      service as unknown as {
        createContactWithLabels(
          requestedAccountId: string,
          requestedWorkerId: string,
          mappedData: Record<string, unknown>,
          isValidated: boolean
        ): Promise<string | null>;
      }
    ).createContactWithLabels(
      accountId,
      workerId,
      { first_name: 'Maycon', phone: '61999999999' },
      true
    );

    expect(result).toBe(prepareBestEffort.mock.calls[0]?.[0].aggregate.id);
    expect(prepareBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contact: expect.objectContaining({
            is_valided: true,
            label_templates: [],
            channel_ids: [workerId],
            contact_groups: [],
          }),
        }),
      })
    );
    expect(viewContactOutboundWebhookSnapshot).not.toHaveBeenCalled();
    expect(completeBestEffort).not.toHaveBeenCalled();
    expect(completePersistedBestEffort).toHaveBeenCalledWith({
      eventId,
      accountId,
    });
  });

  it('routes existing-contact label additions through ContactService with account context', async () => {
    const addContactLabelTemplateIfNotExists = jest.fn(async () => true);
    const service = Reflect.construct(
      IntegrationService,
      Array.from({ length: 40 }, () => ({}))
    ) as IntegrationService;
    Object.assign(service, {
      dbRw: {
        transaction: jest.fn(async (callback: (tx: object) => unknown) =>
          callback({})
        ),
      },
      processLabelsInTransaction: jest.fn(async () => [labelId]),
      contactService: { addContactLabelTemplateIfNotExists },
    });

    await (
      service as unknown as {
        addLabelsToExistingContact(
          requestedAccountId: string,
          requestedWorkerId: string,
          contactId: string,
          mappedData: { labels: string[] }
        ): Promise<void>;
      }
    ).addLabelsToExistingContact(accountId, workerId, 'contact-1', {
      labels: ['Cliente'],
    });

    expect(addContactLabelTemplateIfNotExists).toHaveBeenCalledWith(
      'contact-1',
      labelId,
      accountId,
      expect.objectContaining({
        source: 'integration_webhook',
        originChannelId: workerId,
        changes: { added_label_template_id: labelId },
      })
    );
  });

  it('leaves the prepared intent untouched when the contact transaction fails', async () => {
    const prepared = {
      eventId,
      created: true,
      state: 'preparing' as const,
      envelope: {
        id: eventId,
        type: 'contact.created' as const,
        api_version: '1' as const,
        occurred_at: '2026-07-10T20:00:00.000Z',
        account_id: accountId,
        aggregate: { type: 'contact' as const, id: 'contact-requested' },
        data: {},
        previous: null,
        context: {
          source: 'integration_webhook',
          channel_ids: [workerId],
          actor: null,
        },
      },
    };
    const prepareBestEffort = jest.fn(async () => prepared);
    const completeBestEffort = jest.fn(async () => true);
    const completePersistedBestEffort = jest.fn(async () => true);
    const service = Reflect.construct(
      IntegrationService,
      Array.from({ length: 40 }, () => ({}))
    ) as IntegrationService;
    Object.assign(service, {
      outboundWebhookEventService: {
        prepareBestEffort,
        completeBestEffort,
        completePersistedBestEffort,
      },
      dbRw: {
        transaction: jest.fn(async () => {
          throw new Error('contact transaction failed');
        }),
      },
    });

    await expect(
      (
        service as unknown as {
          createContactWithLabels(
            requestedAccountId: string,
            requestedWorkerId: string,
            mappedData: Record<string, unknown>,
            isValidated: boolean
          ): Promise<string | null>;
        }
      ).createContactWithLabels(
        accountId,
        workerId,
        { first_name: 'Maycon', phone: '61999999999' },
        true
      )
    ).rejects.toThrow('contact transaction failed');

    expect(prepareBestEffort).toHaveBeenCalledTimes(1);
    expect(completeBestEffort).not.toHaveBeenCalled();
    expect(completePersistedBestEffort).not.toHaveBeenCalled();
  });
});
