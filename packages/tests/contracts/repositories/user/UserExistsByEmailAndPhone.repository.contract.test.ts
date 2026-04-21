import 'reflect-metadata';
import { UserExistsByEmailAndPhoneRepository } from '@core/repositories/user/UserExistsByEmailAndPhone.repository';

function createCountChain(result: unknown[]) {
  return {
    from: jest.fn(() => ({
      where: jest.fn(() => ({
        execute: jest.fn(async () => result),
      })),
    })),
  };
}

describe('UserExistsByEmailAndPhoneRepository', () => {
  it('existsUserByEmail returns false when query has no rows', async () => {
    const dbRo = {
      select: jest.fn(() => createCountChain([])),
    };
    const repository = new UserExistsByEmailAndPhoneRepository(dbRo as never);

    await expect(repository.existsUserByEmail('email-c')).resolves.toBe(false);
  });

  it('existsUserByEmail returns true when total is greater than zero', async () => {
    const dbRo = {
      select: jest.fn(() => createCountChain([{ total: 1 }])),
    };
    const repository = new UserExistsByEmailAndPhoneRepository(dbRo as never);

    await expect(
      repository.existsUserByEmail('email-c', 'exclude-user')
    ).resolves.toBe(true);
  });

  it('existsUserByPhone returns false when total is zero', async () => {
    const subquery = {
      from: jest.fn(() => ({
        where: jest.fn(() => ({ kind: 'subquery' })),
      })),
    };
    const outer = createCountChain([{ total: 0 }]);
    const dbRo = {
      select: jest
        .fn()
        .mockImplementationOnce(() => subquery)
        .mockImplementationOnce(() => outer),
    };
    const repository = new UserExistsByEmailAndPhoneRepository(dbRo as never);

    await expect(repository.existsUserByPhone('phone-c')).resolves.toBe(false);
  });

  it('existsUserByPhone returns true when total is greater than zero', async () => {
    const subquery = {
      from: jest.fn(() => ({
        where: jest.fn(() => ({ kind: 'subquery' })),
      })),
    };
    const outer = createCountChain([{ total: 2 }]);
    const dbRo = {
      select: jest
        .fn()
        .mockImplementationOnce(() => subquery)
        .mockImplementationOnce(() => outer),
    };
    const repository = new UserExistsByEmailAndPhoneRepository(dbRo as never);

    await expect(
      repository.existsUserByPhone('phone-c', 'exclude-user')
    ).resolves.toBe(true);
  });
});
