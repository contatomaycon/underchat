import 'reflect-metadata';
import { ContactListerByGroupRepository } from '@core/repositories/contact/ContactListerByGroup.repository';

function createSelectChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const innerJoin = jest.fn(() => ({ where }));
  const from = jest.fn(() => ({ innerJoin }));
  const select = jest.fn(() => ({ from }));

  return {
    dbRo: { select },
    select,
  };
}

describe('ContactListerByGroupRepository', () => {
  it('returns empty array and skips query when group list is empty', async () => {
    const { dbRo, select } = createSelectChain([{ contact_id: 'contact-1' }]);
    const repository = new ContactListerByGroupRepository(dbRo as never);

    await expect(
      repository.listContactsByGroupIds('acc-1', [])
    ).resolves.toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it('returns deduplicated contact ids', async () => {
    const { dbRo } = createSelectChain([
      { contact_id: 'contact-1' },
      { contact_id: 'contact-1' },
      { contact_id: 'contact-2' },
    ]);
    const repository = new ContactListerByGroupRepository(dbRo as never);

    await expect(
      repository.listContactsByGroupIds('acc-1', ['group-1'])
    ).resolves.toEqual(['contact-1', 'contact-2']);
  });
});
