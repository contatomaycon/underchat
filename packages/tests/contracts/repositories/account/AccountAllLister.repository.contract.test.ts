import 'reflect-metadata';
import { AccountAllListerRepository } from '@core/repositories/account/AccountAllLister.repository';

describe('AccountAllListerRepository', () => {
  it('returns mapped account list', async () => {
    const findMany = jest.fn(async () => [
      { account_id: 'acc-1', name: 'Account 1' },
      { account_id: 'acc-2', name: 'Account 2' },
    ]);
    const db = {
      query: {
        account: {
          findMany,
        },
      },
    };

    const repository = new AccountAllListerRepository(db as never);

    await expect(repository.listAllAccounts()).resolves.toEqual([
      { account_id: 'acc-1', name: 'Account 1' },
      { account_id: 'acc-2', name: 'Account 2' },
    ]);
    expect(findMany).toHaveBeenCalledTimes(1);

    const findManyArgs = (findMany as jest.Mock).mock.calls[0]?.[0];
    expect(findManyArgs).toBeDefined();
    const asc = jest.fn((column: unknown) => `asc:${String(column)}`);
    expect(findManyArgs.orderBy({ name: 'name-column' }, { asc })).toEqual([
      'asc:name-column',
    ]);
    expect(asc).toHaveBeenCalledWith('name-column');
  });

  it('returns empty array when query returns nullish', async () => {
    const db = {
      query: {
        account: {
          findMany: jest.fn(async () => undefined),
        },
      },
    };
    const repository = new AccountAllListerRepository(db as never);

    await expect(repository.listAllAccounts()).resolves.toEqual([]);
  });
});
