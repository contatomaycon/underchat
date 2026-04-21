import 'reflect-metadata';
import { ChatContactViewerRepository } from '@core/repositories/contact/ChatContactViewer.repository';

function createPhoneLookupDb(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const limit = jest.fn(() => ({ execute }));
  const where = jest.fn(() => ({ limit }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return {
    dbRo: { select },
  };
}

describe('ChatContactViewerRepository', () => {
  it('returns null when chat contact by id is not found', async () => {
    const repository = new ChatContactViewerRepository({} as never);
    (repository as any).findChatContactById = jest.fn(async () => null);
    (repository as any).findLabelsByContactId = jest.fn(async () => []);
    (repository as any).findChannelIdsByContactId = jest.fn(async () => []);

    await expect(
      repository.viewChatContactById('contact-1', 'acc-1')
    ).resolves.toBeNull();
  });

  it('maps chat contact by id', async () => {
    const repository = new ChatContactViewerRepository({} as never);
    (repository as any).findChatContactById = jest.fn(async () => ({
      contact_id: 'contact-1',
      name: 'Maycon',
      last_name: 'Silva',
      email_partial: 'm***@mail.com',
      phone_ddi: '55',
      phone_partial: '9999',
      nickname: 'May',
      photo: 'photo',
      birthday: '2026-04-21',
      notes: 'obs',
      document: '123',
      document_partial: '***',
      is_valided: true,
      ignore: false,
      contact_document_type: null,
      user: {
        user_id: 'user-1',
        name: 'Maycon Silva',
        photo: 'user-photo',
      },
    }));
    (repository as any).findLabelsByContactId = jest.fn(async () => [
      { label_template_id: 'label-1', label: 'VIP', color: '#fff000' },
    ]);
    (repository as any).findChannelIdsByContactId = jest.fn(async () => [
      'channel-1',
    ]);

    await expect(
      repository.viewChatContactById('contact-1', 'acc-1')
    ).resolves.toEqual(
      expect.objectContaining({
        contact_id: 'contact-1',
        channel_ids: ['channel-1'],
        label_templates: [
          {
            label_template_id: 'label-1',
            label: 'VIP',
            color: '#fff000',
          },
        ],
      })
    );
  });

  it('returns null when chat contact by phone is not found', async () => {
    const { dbRo } = createPhoneLookupDb([]);
    const repository = new ChatContactViewerRepository(dbRo as never);

    await expect(
      repository.viewChatContactByPhone('acc-1', ['hash-phone'], '55')
    ).resolves.toBeNull();
  });

  it('returns first contact id when chat contact by phone is found', async () => {
    const { dbRo } = createPhoneLookupDb([{ contact_id: 'contact-1' }]);
    const repository = new ChatContactViewerRepository(dbRo as never);

    await expect(
      repository.viewChatContactByPhone('acc-1', ['hash-phone'], '55')
    ).resolves.toEqual({ contact_id: 'contact-1' });
  });

  it('returns empty list when ids are empty', async () => {
    const repository = new ChatContactViewerRepository({} as never);

    await expect(
      repository.viewChatContactsByIds([], 'acc-1')
    ).resolves.toEqual([]);
  });

  it('maps chat contacts by ids with labels and channel ids', async () => {
    const repository = new ChatContactViewerRepository({} as never);
    (repository as any).findChatContactsByIds = jest.fn(async () => [
      {
        contact_id: 'contact-1',
        name: 'Maycon',
        last_name: 'Silva',
        email_partial: 'm***@mail.com',
        phone_ddi: '55',
        phone_partial: '9999',
        nickname: 'May',
        photo: null,
        birthday: null,
        notes: null,
        document: null,
        document_partial: null,
        is_valided: true,
        ignore: null,
        contact_document_type: null,
        user: null,
      },
    ]);
    (repository as any).findLabelsByContactIds = jest.fn(
      async () =>
        new Map([
          [
            'contact-1',
            [{ label_template_id: 'label-1', label: 'VIP', color: '#fff000' }],
          ],
        ])
    );
    (repository as any).findChannelIdsByContactIds = jest.fn(
      async () => new Map([['contact-1', ['channel-1']]])
    );

    await expect(
      repository.viewChatContactsByIds(['contact-1'], 'acc-1')
    ).resolves.toEqual([
      {
        contact_id: 'contact-1',
        name: 'Maycon',
        last_name: 'Silva',
        email_partial: 'm***@mail.com',
        phone_ddi: '55',
        phone_partial: '9999',
        nickname: 'May',
        birthday: null,
        notes: null,
        document: null,
        document_partial: null,
        photo: null,
        is_valided: true,
        label_templates: [
          {
            label_template_id: 'label-1',
            label: 'VIP',
            color: '#fff000',
          },
        ],
        contact_document_type: null,
        user: null,
        ignore: null,
        channel_ids: ['channel-1'],
      },
    ]);
  });
});
