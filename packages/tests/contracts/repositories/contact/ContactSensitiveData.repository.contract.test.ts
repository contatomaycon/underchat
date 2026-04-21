import 'reflect-metadata';
import { ContactSensitiveDataRepository } from '@core/repositories/contact/ContactSensitiveData.repository';

function createSelectChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return {
    dbRo: { select },
  };
}

describe('ContactSensitiveDataRepository', () => {
  it('returns null when contact is not found', async () => {
    const { dbRo } = createSelectChain([]);
    const repository = new ContactSensitiveDataRepository(dbRo as never);

    await expect(
      repository.getContactSensitiveDataById('contact-1')
    ).resolves.toBe(null);
  });

  it('returns normalized sensitive fields', async () => {
    const { dbRo } = createSelectChain([
      {
        phone: null,
        email: 'contact@email.com',
        document: undefined,
      },
    ]);
    const repository = new ContactSensitiveDataRepository(dbRo as never);

    await expect(
      repository.getContactSensitiveDataById('contact-1')
    ).resolves.toEqual({
      phone: null,
      email: 'contact@email.com',
      document: null,
    });
  });
});
