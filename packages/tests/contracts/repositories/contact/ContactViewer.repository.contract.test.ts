import 'reflect-metadata';
import { ContactViewerRepository } from '@core/repositories/contact/ContactViewer.repository';

describe('ContactViewerRepository', () => {
  it('returns null when contact by id is not found', async () => {
    const repository = new ContactViewerRepository({} as never);
    (repository as any).findContactById = jest.fn(async () => null);
    (repository as any).findLabelsByContactId = jest.fn(async () => []);

    await expect(repository.viewContactById('contact-1')).resolves.toBeNull();
  });

  it('maps contact by id with labels and user', async () => {
    const repository = new ContactViewerRepository({} as never);
    (repository as any).findContactById = jest.fn(async () => ({
      contact_id: 'contact-1',
      account: { account_id: 'acc-1', name: 'Conta' },
      contact_document_type: {
        contact_document_type_id: 'doc-1',
        name: 'CPF',
      },
      name: 'Maycon',
      last_name: 'Silva',
      email_partial: 'm***@mail.com',
      phone: '11999999999',
      phone_ddi: '55',
      phone_partial: '9999',
      nickname: 'May',
      photo: 'photo',
      birthday: '2026-04-21',
      notes: 'obs',
      document: '123',
      document_partial: '***',
      created_at: '2026-04-21T00:00:00.000Z',
      is_valided: true,
      ignore: false,
      user: {
        user_id: 'user-1',
        name: 'Maycon Silva',
        photo: 'user-photo',
      },
    }));
    (repository as any).findLabelsByContactId = jest.fn(async () => [
      { label_template_id: 'label-1', label: 'VIP', color: '#fff000' },
    ]);

    const result = await repository.viewContactById('contact-1');

    expect(result).toEqual(
      expect.objectContaining({
        contact_id: 'contact-1',
        phone: '11999999999',
        label_templates: [
          {
            label_template_id: 'label-1',
            label: 'VIP',
            color: '#fff000',
          },
        ],
        user: {
          user_id: 'user-1',
          name: 'Maycon Silva',
          photo: 'user-photo',
        },
      })
    );
  });

  it('throws when account is missing in contact by id', async () => {
    const repository = new ContactViewerRepository({} as never);
    (repository as any).findContactById = jest.fn(async () => ({
      contact_id: 'contact-1',
      account: null,
      contact_document_type: null,
      name: 'Maycon',
      last_name: null,
      email_partial: null,
      phone: null,
      phone_ddi: null,
      phone_partial: null,
      nickname: null,
      photo: null,
      birthday: null,
      notes: null,
      document: null,
      document_partial: null,
      created_at: null,
      is_valided: null,
      ignore: null,
      user: null,
    }));
    (repository as any).findLabelsByContactId = jest.fn(async () => []);

    await expect(repository.viewContactById('contact-1')).rejects.toThrow(
      'Account is required'
    );
  });

  it('returns null when contact by phone is not found', async () => {
    const repository = new ContactViewerRepository({} as never);
    (repository as any).findContactByPhone = jest.fn(async () => null);

    await expect(
      repository.viewContactByPhone('acc-1', ['hash-phone'], '55')
    ).resolves.toBeNull();
  });

  it('maps contact by phone response', async () => {
    const repository = new ContactViewerRepository({} as never);
    (repository as any).findContactByPhone = jest.fn(async () => ({
      contact_id: 'contact-1',
      account: { account_id: 'acc-1', name: 'Conta' },
      contact_document_type: null,
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
      created_at: '2026-04-21T00:00:00.000Z',
      is_valided: true,
      validation_origin: 'official_inbound',
      ignore: false,
      user: null,
    }));
    (repository as any).findLabelsByContactId = jest.fn(async () => [
      { label_template_id: 'label-1', label: 'VIP', color: '#fff000' },
    ]);

    await expect(
      repository.viewContactByPhone('acc-1', ['hash-phone'], '55')
    ).resolves.toEqual(
      expect.objectContaining({
        contact_id: 'contact-1',
        validation_origin: 'official_inbound',
        label_templates: [
          {
            label_template_id: 'label-1',
            label: 'VIP',
            color: '#fff000',
          },
        ],
        user: null,
      })
    );
  });
});
