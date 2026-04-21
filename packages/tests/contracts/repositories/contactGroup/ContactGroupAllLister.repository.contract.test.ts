import 'reflect-metadata';
import { ContactGroupAllListerRepository } from '@core/repositories/contactGroup/ContactGroupAllLister.repository';

function createChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));
  return { select };
}

describe('ContactGroupAllListerRepository', () => {
  it('returns null when there are no groups', async () => {
    const chain = createChain([]);
    const repository = new ContactGroupAllListerRepository({
      select: chain.select,
    } as never);

    await expect(repository.listContactGroupAll('acc-1')).resolves.toBeNull();
  });

  it('returns contact groups for account', async () => {
    const chain = createChain([{ contact_group_id: 'cg-1', name: 'VIP' }]);
    const repository = new ContactGroupAllListerRepository({
      select: chain.select,
    } as never);

    await expect(repository.listContactGroupAll('acc-1')).resolves.toEqual([
      { contact_group_id: 'cg-1', name: 'VIP' },
    ]);
  });
});
