import 'reflect-metadata';
import { ReleaseAccountsListerRepository } from '@core/repositories/release/ReleaseAccountsLister.repository';

describe('ReleaseAccountsListerRepository', () => {
  it('returns empty list when query result is null', async () => {
    const repository = new ReleaseAccountsListerRepository({
      query: {
        account: {
          findMany: jest.fn(async () => null),
        },
      },
    } as never);

    await expect(repository.listReleaseAccounts()).resolves.toEqual([]);
  });

  it('maps account rows', async () => {
    const rows = [
      {
        account_id: 'acc-1',
        name: 'Account 1',
      },
    ];

    const repository = new ReleaseAccountsListerRepository({
      query: {
        account: {
          findMany: jest.fn(async () => rows),
        },
      },
    } as never);

    await expect(repository.listReleaseAccounts()).resolves.toEqual(rows);
  });
});
