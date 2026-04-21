import 'reflect-metadata';
import { ContactListerByAccountRepository } from '@core/repositories/contact/ContactListerByAccount.repository';

function createSelectChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return {
    dbRo: { select },
  };
}

describe('ContactListerByAccountRepository', () => {
  it('returns an empty list when no contacts are found', async () => {
    const { dbRo } = createSelectChain([]);
    const repository = new ContactListerByAccountRepository(dbRo as never);

    await expect(repository.listContactsByAccountId('acc-1')).resolves.toEqual(
      []
    );
  });

  it('maps contact ids', async () => {
    const { dbRo } = createSelectChain([
      { contact_id: 'contact-1' },
      { contact_id: 'contact-2' },
    ]);
    const repository = new ContactListerByAccountRepository(dbRo as never);

    await expect(repository.listContactsByAccountId('acc-1')).resolves.toEqual([
      'contact-1',
      'contact-2',
    ]);
  });
});
