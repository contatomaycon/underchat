import 'reflect-metadata';
import { ContactExistsByEmailAndPhoneRepository } from '@core/repositories/contact/ContactExistsByEmailAndPhone.repository';

function createSelectChain(results: unknown[]) {
  const execute = jest.fn(async () => results);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return {
    dbRo: { select },
    select,
    where,
  };
}

describe('ContactExistsByEmailAndPhoneRepository', () => {
  it('returns false when both email and phone are null', async () => {
    const { dbRo, select } = createSelectChain([{ total: 1 }]);
    const repository = new ContactExistsByEmailAndPhoneRepository(
      dbRo as never
    );

    await expect(
      repository.existsContactByEmailAndPhone(null, null)
    ).resolves.toBe(false);
    expect(select).not.toHaveBeenCalled();
  });

  it('returns false when count query has no rows', async () => {
    const { dbRo } = createSelectChain([]);
    const repository = new ContactExistsByEmailAndPhoneRepository(
      dbRo as never
    );

    await expect(
      repository.existsContactByEmailAndPhone('email-hash', null, 'contact-1')
    ).resolves.toBe(false);
  });

  it('returns true when count is greater than zero for email/phone search', async () => {
    const { dbRo, where } = createSelectChain([{ total: 2 }]);
    const repository = new ContactExistsByEmailAndPhoneRepository(
      dbRo as never
    );

    await expect(
      repository.existsContactByEmailAndPhone(
        'email-hash',
        'phone-hash',
        'contact-1'
      )
    ).resolves.toBe(true);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('checks existence by email', async () => {
    const { dbRo } = createSelectChain([{ total: 1 }]);
    const repository = new ContactExistsByEmailAndPhoneRepository(
      dbRo as never
    );

    await expect(
      repository.existsContactByEmail('acc-1', 'email-hash', 'contact-1')
    ).resolves.toBe(true);
  });

  it('checks existence by phone list', async () => {
    const { dbRo } = createSelectChain([{ total: 0 }]);
    const repository = new ContactExistsByEmailAndPhoneRepository(
      dbRo as never
    );

    await expect(
      repository.existsContactByPhone('acc-1', ['phone-hash'])
    ).resolves.toBe(false);
  });
});
