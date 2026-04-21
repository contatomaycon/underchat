import 'reflect-metadata';
import { ContactGroupListerRepository } from '@core/repositories/contactGroup/ContactGroupLister.repository';

function createTotalChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const queryBuilder = {
    innerJoin: jest.fn(),
    leftJoin: jest.fn(),
    where,
  } as any;
  queryBuilder.innerJoin.mockReturnValue(queryBuilder);
  queryBuilder.leftJoin.mockReturnValue(queryBuilder);
  queryBuilder.where.mockReturnValue({ execute });
  const from = jest.fn(() => queryBuilder);
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('ContactGroupListerRepository', () => {
  it('returns empty list when findMany returns null', async () => {
    const repository = new ContactGroupListerRepository({
      query: {
        contactGroup: {
          findMany: jest.fn(async () => null),
        },
      },
      select: jest.fn(),
    } as never);

    await expect(
      repository.listContactGroups(10, 1, {} as never, 'acc-1')
    ).resolves.toEqual([]);
  });

  it('maps contact groups with contacts and labels', async () => {
    const repository = new ContactGroupListerRepository({
      query: {
        contactGroup: {
          findMany: jest.fn(async () => [
            {
              contact_group_id: 'cg-1',
              name: 'VIP',
              description: 'd',
              created_at: '2026-01-01',
              cga: { account_id: 'acc-1', name: 'Account' },
              cgt: [
                {
                  cga: {
                    contact_id: 'c-1',
                    name: 'John',
                    phone_partial: '9999',
                    clt: [
                      {
                        ltt: {
                          label_template_id: 'lt-1',
                          label: 'Tag',
                          color: '#111',
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ]),
        },
      },
      select: jest.fn(),
    } as never);

    await expect(
      repository.listContactGroups(10, 1, {} as never, 'acc-1')
    ).resolves.toEqual([
      {
        contact_group_id: 'cg-1',
        account: { account_id: 'acc-1', name: 'Account' },
        name: 'VIP',
        description: 'd',
        contacts: [
          {
            contact_id: 'c-1',
            name: 'John',
            phone_partial: '9999',
            label_templates: [
              { label_template_id: 'lt-1', label: 'Tag', color: '#111' },
            ],
          },
        ],
        created_at: '2026-01-01',
      },
    ]);
  });

  it('returns contact group total', async () => {
    const chain = createTotalChain([{ count: 3 }]);
    const repository = new ContactGroupListerRepository({
      query: {
        contactGroup: {
          findMany: jest.fn(),
        },
      },
      select: chain.select,
    } as never);

    await expect(
      repository.listContactGroupTotal({} as never, 'acc-1')
    ).resolves.toBe(3);
  });
});
