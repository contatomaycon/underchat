import 'reflect-metadata';
import { ContactGroupViewerRepository } from '@core/repositories/contactGroup/ContactGroupViewer.repository';

function createChain(result: unknown[]) {
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

describe('ContactGroupViewerRepository', () => {
  it('returns null when group is not found', async () => {
    const chain = createChain([]);
    const repository = new ContactGroupViewerRepository({
      select: chain.select,
    } as never);

    await expect(repository.viewContactGroupById('cg-1')).resolves.toBeNull();
  });

  it('maps viewed contact group with contacts', async () => {
    const chain = createChain([
      {
        contact_group_id: 'cg-1',
        name: 'VIP',
        description: 'd',
        account: { account_id: 'acc-1', name: 'Account' },
        contacts: { contact_id: 'c-1', name: 'John', phone_partial: '9999' },
      },
      {
        contact_group_id: 'cg-1',
        name: 'VIP',
        description: 'd',
        account: { account_id: 'acc-1', name: 'Account' },
        contacts: { contact_id: 'c-2', name: 'Mary', phone_partial: '8888' },
      },
    ]);
    const repository = new ContactGroupViewerRepository({
      select: chain.select,
    } as never);

    await expect(repository.viewContactGroupById('cg-1')).resolves.toEqual({
      contact_group_id: 'cg-1',
      name: 'VIP',
      description: 'd',
      account: { account_id: 'acc-1', name: 'Account' },
      contacts: [
        { contact_id: 'c-1', name: 'John', phone_partial: '9999' },
        { contact_id: 'c-2', name: 'Mary', phone_partial: '8888' },
      ],
    });
  });
});
