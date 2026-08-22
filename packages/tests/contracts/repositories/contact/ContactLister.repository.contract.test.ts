import 'reflect-metadata';
import { ContactListerRepository } from '@core/repositories/contact/ContactLister.repository';

function createCountDbRo(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const leftJoin = jest.fn(() => ({ where }));
  const from = jest.fn(() => ({ leftJoin }));
  const select = jest.fn(() => ({ from }));

  return {
    dbRo: { select },
  };
}

describe('ContactListerRepository', () => {
  it('setFilters applies label filter when filter_label_template_id is provided', () => {
    const repository = new ContactListerRepository({
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          innerJoin: jest.fn(() => ({
            where: jest.fn(() => ({ subquery: true })),
          })),
        })),
      })),
    } as never);

    const filters = (repository as any).setFilters(
      {
        filter_label_template_id: '11111111-1111-1111-1111-111111111111',
      },
      null
    );

    expect(filters).toHaveLength(1);
  });

  it('setFilters does not apply label filter when filter_label_template_id is not provided', () => {
    const repository = new ContactListerRepository({
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          innerJoin: jest.fn(() => ({
            where: jest.fn(() => ({ subquery: true })),
          })),
        })),
      })),
    } as never);

    const filters = (repository as any).setFilters({}, null);

    expect(filters).toHaveLength(0);
  });

  it('setFilters applies filter_without_label_template when provided', () => {
    const repository = new ContactListerRepository({
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          innerJoin: jest.fn(() => ({
            where: jest.fn(() => ({ subquery: true })),
          })),
        })),
      })),
    } as never);

    const filters = (repository as any).setFilters(
      {
        filter_without_label_template: true,
      },
      null
    );

    expect(filters).toHaveLength(1);
  });

  it('setFilters prioritizes filter_without_label_template over filter_label_template_id', () => {
    const repository = new ContactListerRepository({
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          innerJoin: jest.fn(() => ({
            where: jest.fn(() => ({ subquery: true })),
          })),
        })),
      })),
    } as never);

    const filters = (repository as any).setFilters(
      {
        filter_without_label_template: true,
        filter_label_template_id: '11111111-1111-1111-1111-111111111111',
      },
      null
    );

    expect(filters).toHaveLength(1);
  });

  it('returns empty array when contact list is empty', async () => {
    const repository = new ContactListerRepository({} as never);
    (repository as any).findContacts = jest.fn(async () => []);

    await expect(
      repository.listContacts(10, 1, {} as never, 'acc-1', null)
    ).resolves.toEqual([]);
  });

  it('maps list contacts response with labels and responsible attendant', async () => {
    const repository = new ContactListerRepository({} as never);
    (repository as any).findContacts = jest.fn(async () => [
      {
        contact_id: 'contact-1',
        account: { account_id: 'acc-1', name: 'Conta' },
        name: 'Maycon',
        last_name: 'Silva',
        email_partial: 'm***@mail.com',
        phone_ddi: '55',
        phone_partial: '9999',
        nickname: 'May',
        birthday: '2026-04-21',
        notes: 'obs',
        created_at: '2026-04-21T00:00:00.000Z',
        is_valided: true,
        photo: 'photo',
        user_id: 'user-1',
        user_name: ' Maycon Silva ',
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

    await expect(
      repository.listContacts(10, 1, {} as never, 'acc-1', null)
    ).resolves.toEqual([
      {
        contact_id: 'contact-1',
        account: {
          account_id: 'acc-1',
          name: 'Conta',
        },
        label_templates: [
          {
            label_template_id: 'label-1',
            label: 'VIP',
            color: '#fff000',
          },
        ],
        name: 'Maycon',
        last_name: 'Silva',
        email_partial: 'm***@mail.com',
        phone_ddi: '55',
        phone_partial: '9999',
        created_at: '2026-04-21T00:00:00.000Z',
        nickname: 'May',
        birthday: '2026-04-21',
        notes: 'obs',
        is_valided: true,
        validation_status: 'validated',
        photo: 'photo',
        responsible_attendant: {
          user_id: 'user-1',
          name: 'Maycon Silva',
        },
      },
    ]);
  });

  it('returns total count from listContactTotal', async () => {
    const { dbRo } = createCountDbRo([{ count: 4 }]);
    const repository = new ContactListerRepository(dbRo as never);

    await expect(
      repository.listContactTotal({} as never, 'acc-1', null)
    ).resolves.toBe(4);
  });
});
