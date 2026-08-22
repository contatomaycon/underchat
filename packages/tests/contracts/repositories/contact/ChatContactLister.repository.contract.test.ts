import 'reflect-metadata';
import { ChatContactListerRepository } from '@core/repositories/contact/ChatContactLister.repository';

function createCountDbRo(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return {
    dbRo: { select },
  };
}

describe('ChatContactListerRepository', () => {
  it('returns empty array when there are no contacts', async () => {
    const repository = new ChatContactListerRepository({} as never);
    (repository as any).findContacts = jest.fn(async () => []);

    await expect(repository.listChatContacts(10, 1, 'acc-1')).resolves.toEqual(
      []
    );
  });

  it('maps list chat contacts with labels', async () => {
    const repository = new ChatContactListerRepository({} as never);
    (repository as any).findContacts = jest.fn(async () => [
      {
        contact_id: 'contact-1',
        name: 'Maycon',
        last_name: 'Silva',
        email_partial: 'm***@mail.com',
        phone_ddi: null,
        phone_partial: '9999',
        photo: 'photo',
        is_valided: true,
        validation_origin: 'official_assumed',
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

    await expect(repository.listChatContacts(10, 1, 'acc-1')).resolves.toEqual([
      {
        contact_id: 'contact-1',
        name: 'Maycon',
        last_name: 'Silva',
        email_partial: 'm***@mail.com',
        phone_ddi: null,
        phone_partial: '9999',
        photo: 'photo',
        is_valided: true,
        validation_status: 'official_only',
        label_templates: [
          {
            label_template_id: 'label-1',
            label: 'VIP',
            color: '#fff000',
          },
        ],
      },
    ]);
  });

  it('returns total contacts count', async () => {
    const { dbRo } = createCountDbRo([{ count: 7 }]);
    const repository = new ChatContactListerRepository(dbRo as never);

    await expect(repository.listChatContactsTotal('acc-1')).resolves.toBe(7);
  });
});
