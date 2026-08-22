import 'reflect-metadata';
import type { PrepareOutboundWebhookEventInput } from '@core/services/outboundWebhookEvent.service';
import { ContactService } from '@core/services/contact.service';
import { StaleWhatsappRuntimeDatabaseFenceError } from '@core/repositories/worker/WhatsappRuntimeDatabaseFence.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(() => '01900000-0000-7000-8000-000000000004'),
}));

const accountId = '01900000-0000-7000-8000-000000000001';
const contactId = '01900000-0000-7000-8000-000000000002';
const eventId = '01900000-0000-7000-8000-000000000003';
const assignmentId = '01900000-0000-7000-8000-000000000004';
const labelId = '01900000-0000-7000-8000-000000000005';
const groupId = '01900000-0000-7000-8000-000000000006';
const channelId = '01900000-0000-7000-8000-000000000007';
const runtimeFence = {
  account_id: accountId,
  worker_id: '01900000-0000-7000-8000-000000000008',
  source_provider: 'baileys',
  runtime_generation: 7,
  connection_epoch: 'epoch-7',
};

const contact = {
  contact_id: contactId,
  mutation_revision: '42',
  account: { account_id: accountId, name: 'Account' },
  label_templates: [],
  contact_document_type: null,
  name: 'Maycon',
  email_partial: 'm***@example.com',
  phone_ddi: '55',
  phone_partial: '*****0000',
  phone: 'encrypted-phone-must-not-leak',
  document: 'encrypted-document-must-not-leak',
  document_partial: '***1234',
  is_valided: false,
  photo: null,
  channel_ids: [channelId],
};

function makePrepared(input: PrepareOutboundWebhookEventInput) {
  return {
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
  };
}

function makeService(overrides: Record<string, unknown> = {}) {
  const outboundWebhookEventService = {
    prepareBestEffort: jest.fn(
      async (input: PrepareOutboundWebhookEventInput) => makePrepared(input)
    ),
    completeBestEffort: jest.fn(async (_input: unknown) => false),
    completePersistedBestEffort: jest.fn(async (_input: unknown) => false),
    cancel: jest.fn(async (_eventId: string) => undefined),
  };
  const service = Reflect.construct(
    ContactService,
    Array.from({ length: 40 }, () => ({}))
  ) as ContactService;
  const contactUpdaterRepository = {
    viewContactMutationRevision: jest.fn(async () => ({
      revision: '42',
      photo: null,
    })),
    viewContactOutboundWebhookSnapshot: jest.fn(async () => ({
      ...contact,
      account_id: accountId,
    })),
    validateContact: jest.fn(async () => true),
    updateContactIsValided: jest.fn(async () => true),
    updateContactById: jest.fn(async () => true),
    ...((overrides.contactUpdaterRepository as Record<string, unknown>) ?? {}),
  };
  Object.assign(service, {
    outboundWebhookEventService,
    getContactById: jest.fn(async () => contact),
    contactGroupAssignmentViewerExistsRepository: {
      existsContactGroupAssignmentByContactAndGroup: jest.fn(async () => false),
    },
    contactGroupAssignmentCreatorRepository: {
      createContactGroupAssignmentDirectly: jest.fn(async () => assignmentId),
    },
    contactLabelTemplateViewerExistsRepository: {
      existsContactLabelTemplate: jest.fn(async () => false),
    },
    contactLabelTemplateCreatorRepository: {
      createContactLabelTemplateWithoutTransaction: jest.fn(
        async () => assignmentId
      ),
    },
    encryptService: {
      encrypt: jest.fn((value: string) => `deterministic:${value}`),
      sanitize: jest.fn((_value: string, type: string) => {
        if (type === 'email') return 'm***@example.com';
        if (type === 'document') return '***1234';
        return '*****9999';
      }),
    },
    passwordEncryptorService: {
      encrypt: jest.fn((value: string) => `encrypted:${value}`),
    },
    ...overrides,
    contactUpdaterRepository,
  });
  return { service, outboundWebhookEventService, contactUpdaterRepository };
}

describe('ContactService outbound webhook durable operation IDs', () => {
  it('uses the persisted label assignment ID and does not block on completion failure', async () => {
    const { service, outboundWebhookEventService } = makeService();

    await expect(
      service.addContactLabelTemplateIfNotExists(
        contactId,
        labelId,
        accountId,
        {
          source: 'contact_import',
          idempotencyKey: 'label-import',
          changes: { added_label_template_id: labelId },
        }
      )
    ).resolves.toBe(true);

    expect(outboundWebhookEventService.prepareBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregate: { type: 'contact', id: contactId },
        idempotencyKey: `label-import:${assignmentId}`,
      })
    );
    expect(
      outboundWebhookEventService.completePersistedBestEffort
    ).toHaveBeenCalledTimes(1);
  });

  it('uses the persisted group assignment ID and does not block on completion failure', async () => {
    const { service, outboundWebhookEventService } = makeService();

    await expect(
      service.addContactToGroupIfNotExists(contactId, groupId, accountId, {
        source: 'contact_import',
        idempotencyKey: 'group-import',
        changes: { added_contact_group_id: groupId },
      })
    ).resolves.toBe(true);

    expect(outboundWebhookEventService.prepareBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregate: { type: 'contact', id: contactId },
        idempotencyKey: `group-import:${assignmentId}`,
      })
    );
  });

  it('treats a concurrent duplicate group assignment as an idempotent no-op and cancels its unused intent', async () => {
    const { service, outboundWebhookEventService } = makeService({
      contactGroupAssignmentCreatorRepository: {
        createContactGroupAssignmentDirectly: jest.fn(async () => null),
      },
    });

    await expect(
      service.addContactToGroupIfNotExists(contactId, groupId, accountId, {
        source: 'contact_import',
        idempotencyKey: 'duplicate-group',
      })
    ).resolves.toBe(true);

    expect(outboundWebhookEventService.cancel).toHaveBeenCalledWith(eventId);
    expect(
      outboundWebhookEventService.completePersistedBestEffort
    ).not.toHaveBeenCalled();
  });

  it('treats a concurrent duplicate label assignment as an idempotent no-op and cancels its unused intent', async () => {
    const { service, outboundWebhookEventService } = makeService({
      contactLabelTemplateCreatorRepository: {
        createContactLabelTemplateWithoutTransaction: jest.fn(async () => null),
      },
    });

    await expect(
      service.addContactLabelTemplateIfNotExists(
        contactId,
        labelId,
        accountId,
        {
          source: 'contact_import',
          idempotencyKey: 'duplicate-label',
        }
      )
    ).resolves.toBe(true);

    expect(outboundWebhookEventService.cancel).toHaveBeenCalledWith(eventId);
    expect(
      outboundWebhookEventService.completePersistedBestEffort
    ).not.toHaveBeenCalled();
  });

  it('completes from the transactionally persisted snapshot without a post-write reread', async () => {
    const viewContactOutboundWebhookSnapshot = jest.fn(async () => contact);
    const { service, outboundWebhookEventService } = makeService({
      contactUpdaterRepository: {
        viewContactOutboundWebhookSnapshot,
      },
    });

    await expect(
      service.addContactLabelTemplateIfNotExists(
        contactId,
        labelId,
        accountId,
        {
          source: 'integration_webhook',
          idempotencyKey: 'label-transactional-outbox',
        }
      )
    ).resolves.toBe(true);
    expect(viewContactOutboundWebhookSnapshot).toHaveBeenCalledTimes(1);
    expect(
      outboundWebhookEventService.completePersistedBestEffort
    ).toHaveBeenCalledWith({ eventId, accountId });
  });

  it('emits validation updates with a durable revision key and public-only snapshots', async () => {
    const previousContact = { ...contact };
    const canonicalContact = {
      ...contact,
      phone_ddi: '55',
      phone_partial: '*****9999',
      phone: 'new-encrypted-phone-must-not-leak',
      document: 'new-encrypted-document-must-not-leak',
      is_valided: true,
    };
    const { service, outboundWebhookEventService, contactUpdaterRepository } =
      makeService({
        contactUpdaterRepository: {
          viewContactOutboundWebhookSnapshot: jest
            .fn()
            .mockResolvedValueOnce(previousContact)
            .mockResolvedValueOnce(canonicalContact),
        },
      });

    await expect(
      service.validateContact(contactId, '11999999999', '55', accountId, {
        source: 'manager_api',
        idempotencyKey: 'manual-validation',
        actor: { type: 'user', id: 'user-1' },
      })
    ).resolves.toBe(true);

    expect(outboundWebhookEventService.prepareBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId,
        eventType: 'contact.updated',
        idempotencyKey: expect.stringMatching(
          /^manual-validation:[a-f0-9]{64}$/
        ),
        data: expect.objectContaining({
          contact: expect.objectContaining({
            phone: '*****9999',
            document: '***1234',
            is_valided: true,
          }),
        }),
      })
    );
    const validateCalls = contactUpdaterRepository.validateContact.mock
      .calls as unknown as Array<
      [
        unknown,
        unknown,
        unknown,
        { envelope: { data: unknown; previous: unknown } },
      ]
    >;
    const marker = validateCalls[0][3];
    expect(marker.envelope.data).toEqual(
      expect.objectContaining({
        contact: expect.objectContaining({
          phone: '*****9999',
          document: '***1234',
          is_valided: true,
        }),
      })
    );
    expect(JSON.stringify(marker)).not.toContain(
      'new-encrypted-phone-must-not-leak'
    );
    expect(JSON.stringify(marker)).not.toContain(
      'new-encrypted-document-must-not-leak'
    );
    expect(JSON.stringify(marker)).not.toContain(
      'encrypted-phone-must-not-leak'
    );
  });

  it('completes validation from the snapshot frozen in the write transaction', async () => {
    const { service, outboundWebhookEventService } = makeService({
      contactUpdaterRepository: {
        viewContactOutboundWebhookSnapshot: jest
          .fn()
          .mockResolvedValueOnce(contact)
          .mockResolvedValueOnce(contact),
      },
    });

    await expect(
      service.updateContactIsValided(contactId, true, accountId)
    ).resolves.toBe(true);
    expect(
      outboundWebhookEventService.completePersistedBestEffort
    ).toHaveBeenCalledWith({ eventId, accountId });
  });

  it('forwards the durable runtime fence to validation repository mutations', async () => {
    const { service, contactUpdaterRepository } = makeService();
    const mutation = {
      source: 'schedule',
      idempotencyKey: 'runtime-fenced-validation',
      runtimeFence,
    };

    await expect(
      service.updateContactIsValided(contactId, true, accountId, mutation)
    ).resolves.toBe(true);
    await expect(
      service.updateContactValidation(
        contactId,
        '5511999999999',
        true,
        accountId,
        mutation
      )
    ).resolves.toBe(true);

    expect(
      contactUpdaterRepository.updateContactIsValided
    ).toHaveBeenCalledWith(
      contactId,
      true,
      accountId,
      expect.any(Object),
      runtimeFence,
      undefined
    );
    expect(contactUpdaterRepository.updateContactById).toHaveBeenCalledWith(
      contactId,
      expect.any(Object),
      accountId,
      expect.any(Object),
      runtimeFence
    );
  });

  it('cancels a prepared webhook intent when PostgreSQL rejects a stale runtime', async () => {
    const staleError = new StaleWhatsappRuntimeDatabaseFenceError();
    const { service, outboundWebhookEventService } = makeService({
      contactUpdaterRepository: {
        updateContactById: jest.fn(async () => {
          throw staleError;
        }),
      },
    });

    await expect(
      service.updateContactValidation(
        contactId,
        '5511999999999',
        true,
        accountId,
        {
          source: 'schedule',
          idempotencyKey: 'stale-runtime-validation',
          runtimeFence,
        }
      )
    ).rejects.toBe(staleError);

    expect(outboundWebhookEventService.cancel).toHaveBeenCalledWith(eventId);
    expect(
      outboundWebhookEventService.completePersistedBestEffort
    ).not.toHaveBeenCalled();
  });

  it('never falls back to an unscoped mutation when runtime ownership is invalid', async () => {
    const { service, outboundWebhookEventService, contactUpdaterRepository } =
      makeService();

    await expect(
      service.updateContactIsValided(contactId, true, undefined, {
        source: 'schedule',
        idempotencyKey: 'invalid-runtime-owner',
        runtimeFence: {
          ...runtimeFence,
          account_id: '',
        },
      })
    ).rejects.toBeInstanceOf(StaleWhatsappRuntimeDatabaseFenceError);

    expect(
      contactUpdaterRepository.updateContactIsValided
    ).not.toHaveBeenCalled();
    expect(
      outboundWebhookEventService.prepareBestEffort
    ).not.toHaveBeenCalled();
  });

  it('persists private validation changes and emits numbers with identical public masks', async () => {
    const canonicalContact = {
      ...contact,
      phone_ddi: '55',
      phone_partial: '*****9999',
      is_valided: true,
    };
    const updateContactById = jest.fn(async () => true);
    const { service, outboundWebhookEventService } = makeService({
      getContactById: jest
        .fn()
        .mockResolvedValueOnce(contact)
        .mockResolvedValueOnce(canonicalContact)
        .mockResolvedValueOnce(canonicalContact),
      contactUpdaterRepository: {
        viewContactMutationRevision: jest.fn(async () => ({
          revision: '43',
          photo: null,
        })),
        viewContactOutboundWebhookSnapshot: jest
          .fn()
          .mockResolvedValueOnce(contact)
          .mockResolvedValueOnce(canonicalContact)
          .mockResolvedValueOnce(canonicalContact)
          .mockResolvedValueOnce(canonicalContact),
        updateContactById,
      },
    });

    await expect(
      service.updateContactValidation(
        contactId,
        '5511988889999',
        true,
        accountId
      )
    ).resolves.toBe(true);
    await expect(
      service.updateContactValidation(
        contactId,
        '5511999999999',
        true,
        accountId
      )
    ).resolves.toBe(true);

    expect(updateContactById).toHaveBeenCalledTimes(2);
    expect(outboundWebhookEventService.prepareBestEffort).toHaveBeenCalledTimes(
      2
    );
    expect(
      outboundWebhookEventService.completePersistedBestEffort
    ).toHaveBeenCalledTimes(2);
    const idempotencyKeys =
      outboundWebhookEventService.prepareBestEffort.mock.calls.map(
        ([input]) => input.idempotencyKey
      );
    expect(new Set(idempotencyKeys).size).toBe(2);
  });

  it('scopes contact creation idempotency to the generated durable contact ID', async () => {
    let requestedContactId = '';
    const { service, outboundWebhookEventService } = makeService({
      contactCreatorRepository: {
        createContactWithGroup: jest.fn(
          async (
            _t: unknown,
            _input: unknown,
            _groupId: unknown,
            requestedId: string
          ) => {
            requestedContactId = requestedId;
            return requestedId;
          }
        ),
      },
    });

    await expect(
      service.createContactWithGroup(
        ((key: string) => key) as never,
        {
          account_id: accountId,
          name: 'Maycon',
          email_c: null,
          phone_c: null,
          channel_ids: [channelId],
        },
        groupId,
        accountId,
        true,
        {
          source: 'contact_import',
          idempotencyKey: 'create-import',
        }
      )
    ).resolves.toBe(true);

    expect(requestedContactId).not.toBe('');
    expect(outboundWebhookEventService.prepareBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregate: { type: 'contact', id: requestedContactId },
        idempotencyKey: `create-import:${requestedContactId}`,
      })
    );
  });

  it('prepares one masked intended snapshot and completes creation from the RW snapshot', async () => {
    let requestedContactId = '';
    const { service, outboundWebhookEventService } = makeService({
      contactCreatorRepository: {
        createContact: jest.fn(
          async (_input: unknown, _tx: unknown, requestedId: string) => {
            requestedContactId = requestedId;
            return requestedId;
          }
        ),
      },
    });

    await expect(
      service.createContact(
        {
          name: 'Maycon',
          email: 'john@example.com',
          phone_ddi: '55',
          phone: '11999991234',
          contact_document_type_id: 'document-type-1',
          document: '12345678901',
          label_template_ids: [{ value: labelId }],
          channel_ids: [channelId],
        },
        accountId,
        true,
        undefined,
        {
          source: 'manager_api',
          idempotencyKey: 'contact-created',
          actor: { type: 'user', id: 'user-1' },
        }
      )
    ).resolves.toEqual(expect.any(String));

    expect(requestedContactId).not.toBe('');
    expect(outboundWebhookEventService.prepareBestEffort).toHaveBeenCalledTimes(
      1
    );
    expect(outboundWebhookEventService.prepareBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregate: { type: 'contact', id: requestedContactId },
        idempotencyKey: `contact-created:${requestedContactId}`,
        data: expect.objectContaining({
          contact: expect.objectContaining({
            contact_id: requestedContactId,
            email: 'm***@example.com',
            phone: '*****9999',
            document: '***1234',
            is_valided: true,
            label_templates: [{ label_template_id: labelId }],
            channel_ids: [channelId],
            contact_groups: [],
          }),
        }),
      })
    );
    const preparedPayload = JSON.stringify(
      outboundWebhookEventService.prepareBestEffort.mock.calls[0]?.[0]
    );
    expect(preparedPayload).not.toContain('john@example.com');
    expect(preparedPayload).not.toContain('11999991234');
    expect(preparedPayload).not.toContain('12345678901');
    expect(
      outboundWebhookEventService.completePersistedBestEffort
    ).toHaveBeenCalledTimes(1);
  });

  it('includes the persisted group intent without exposing encrypted import fields', async () => {
    const { service, outboundWebhookEventService } = makeService({
      contactCreatorRepository: {
        createContactWithGroup: jest.fn(
          async (
            _t: unknown,
            _input: unknown,
            _groupId: unknown,
            requestedId: string
          ) => requestedId
        ),
      },
    });

    await expect(
      service.createContactWithGroup(
        ((key: string) => key) as never,
        {
          account_id: accountId,
          name: 'Imported',
          email: 'cipher-email',
          email_partial: 'i***@example.com',
          email_c: 'hash-email',
          phone: 'cipher-phone',
          phone_partial: '*****1234',
          phone_c: 'hash-phone',
          phone_ddi: '55',
          is_valided: true,
          channel_ids: [channelId],
        },
        groupId,
        accountId,
        true,
        {
          source: 'contact_import',
          idempotencyKey: 'import-create',
        }
      )
    ).resolves.toBe(true);

    const preparedPayload = outboundWebhookEventService.prepareBestEffort.mock
      .calls[0]?.[0] as PrepareOutboundWebhookEventInput;
    expect(preparedPayload.data.contact).toEqual(
      expect.objectContaining({
        email: 'i***@example.com',
        phone: '*****1234',
        label_templates: [],
        channel_ids: [channelId],
        contact_groups: [{ contact_group_id: groupId }],
      })
    );
    expect(JSON.stringify(preparedPayload)).not.toContain('cipher-');
    expect(JSON.stringify(preparedPayload)).not.toContain('hash-');
    expect(outboundWebhookEventService.prepareBestEffort).toHaveBeenCalledTimes(
      1
    );
  });
});
