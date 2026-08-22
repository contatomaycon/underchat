import 'reflect-metadata';
import type { ViewContactResponse } from '@core/schema/contact/viewContact/response.schema';
import type { PreparedOutboundWebhookEvent } from '@core/services/outboundWebhookEvent.service';
import { ContactDeleterUseCase } from '@core/useCases/contact/ContactDeleter.useCase';
import { ContactPhotoDeleterUseCase } from '@core/useCases/contact/ContactPhotoDeleter.useCase';

const accountId = '01900000-0000-7000-8000-000000000001';
const contactId = '01900000-0000-7000-8000-000000000002';
const eventId = '01900000-0000-7000-8000-000000000003';
const occurredAt = '2026-07-10T20:00:00.000Z';

const previousContact = {
  contact_id: contactId,
  account: { account_id: accountId, name: 'Conta' },
  label_templates: [],
  contact_document_type: null,
  name: 'Maycon',
  last_name: 'Douglas',
  photo: 'https://cdn.example.com/contact.jpg',
  channel_ids: ['01900000-0000-7000-8000-000000000004'],
} satisfies ViewContactResponse & { channel_ids: string[] };

function preparedEvent(
  eventType: 'contact.updated' | 'contact.deleted'
): PreparedOutboundWebhookEvent {
  return {
    eventId,
    created: true,
    state: 'preparing',
    envelope: {
      id: eventId,
      type: eventType,
      api_version: '1',
      occurred_at: occurredAt,
      account_id: accountId,
      aggregate: { type: 'contact', id: contactId },
      data: {
        contact: {
          contact_id: contactId,
          photo:
            eventType === 'contact.updated'
              ? null
              : (previousContact.photo ?? null),
        },
      },
      previous: { contact: { contact_id: contactId } },
      context: {
        source: 'manager_api',
        channel_ids: ['01900000-0000-7000-8000-000000000004'],
        actor: null,
      },
    },
  };
}

const translate = ((key: string) => key) as never;

describe('contact outbound webhook producer isolation', () => {
  it('keeps a confirmed deletion successful when webhook completion is unavailable', async () => {
    const prepared = preparedEvent('contact.deleted');
    const contactService = {
      viewContactOutboundWebhookSnapshot: jest.fn(async () => previousContact),
      deleteContactById: jest.fn(async () => true),
    };
    const outboundWebhookEventService = {
      prepareBestEffort: jest.fn(async () => prepared),
      cancel: jest.fn(async () => undefined),
      completeBestEffort: jest.fn(async () => false),
      completePersistedBestEffort: jest.fn(async () => false),
    };
    const useCase = new ContactDeleterUseCase(
      contactService as never,
      outboundWebhookEventService as never
    );

    await expect(
      useCase.execute(translate, contactId, accountId, undefined, 'public_api')
    ).resolves.toBe(true);
    expect(contactService.deleteContactById).toHaveBeenCalledWith(
      contactId,
      accountId,
      prepared
    );
    expect(
      outboundWebhookEventService.completePersistedBestEffort
    ).toHaveBeenCalledTimes(1);
    expect(outboundWebhookEventService.prepareBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'public_api' })
    );
  });

  it('delegates photo deletion webhook journaling to ContactService', async () => {
    const contactService = {
      getContactById: jest.fn().mockResolvedValueOnce(previousContact),
      deleteContactPhoto: jest.fn(async () => true),
    };
    const contactUpdaterRepository = {
      viewContactMutationRevision: jest.fn(async () => ({
        revision: '100',
        photo: previousContact.photo,
      })),
    };
    const useCase = new ContactPhotoDeleterUseCase(
      contactService as never,
      contactUpdaterRepository as never
    );

    await expect(
      useCase.execute(translate, contactId, accountId, undefined, 'public_api')
    ).resolves.toBe(true);
    expect(contactService.deleteContactPhoto).toHaveBeenCalledWith(
      contactId,
      accountId,
      expect.objectContaining({
        source: 'public_api',
        idempotencyKey: expect.stringContaining(':100:'),
      })
    );
  });

  it('deduplicates concurrent photo deletion and separates a later same-URL cycle', async () => {
    const contactService = {
      getContactById: jest.fn(async () => previousContact),
      deleteContactPhoto: jest.fn(async () => true),
    };
    const contactUpdaterRepository = {
      viewContactMutationRevision: jest
        .fn()
        .mockResolvedValueOnce({
          revision: '100',
          photo: previousContact.photo,
        })
        .mockResolvedValueOnce({
          revision: '100',
          photo: previousContact.photo,
        })
        .mockResolvedValueOnce({
          revision: '101',
          photo: previousContact.photo,
        }),
    };
    const useCase = new ContactPhotoDeleterUseCase(
      contactService as never,
      contactUpdaterRepository as never
    );

    await useCase.execute(translate, contactId, accountId);
    await useCase.execute(translate, contactId, accountId);
    await useCase.execute(translate, contactId, accountId);

    const calls = contactService.deleteContactPhoto.mock
      .calls as unknown as Array<[string, string, { idempotencyKey: string }]>;
    const keys = calls.map((call) => call[2]?.idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toContain(':100:');
    expect(keys[2]).toContain(':101:');
    expect(keys[2]).not.toBe(keys[0]);
  });

  it.each([true, false])(
    'does not cancel an intent when a concurrent primary mutation does not apply (created=%s)',
    async (created) => {
      const prepared = {
        ...preparedEvent('contact.deleted'),
        created,
      };
      const contactService = {
        viewContactOutboundWebhookSnapshot: jest.fn(
          async () => previousContact
        ),
        deleteContactById: jest.fn(async () => false),
      };
      const outboundWebhookEventService = {
        prepareBestEffort: jest.fn(async () => prepared),
        cancel: jest.fn(async () => undefined),
        completeBestEffort: jest.fn(async () => false),
        completePersistedBestEffort: jest.fn(async () => false),
      };
      const useCase = new ContactDeleterUseCase(
        contactService as never,
        outboundWebhookEventService as never
      );

      await expect(
        useCase.execute(translate, contactId, accountId)
      ).resolves.toBe(false);
      expect(outboundWebhookEventService.cancel).not.toHaveBeenCalled();
      expect(
        outboundWebhookEventService.completePersistedBestEffort
      ).not.toHaveBeenCalled();
    }
  );
});
