import 'reflect-metadata';
import { UserAllListerRepository } from '@core/repositories/user/UserAllLister.repository';

describe('UserAllListerRepository', () => {
  it('returns mapped users with account and profile fallbacks', async () => {
    const findMany = jest.fn(async () => [
      {
        user_id: 'user-1',
        uui: { name: 'John', last_name: 'Doe' },
        uac: { account_id: 'account-1', name: 'Main Account' },
      },
      {
        user_id: 'user-2',
        uui: null,
        uac: null,
      },
    ]);

    const repository = new UserAllListerRepository({
      query: {
        user: {
          findMany,
        },
      },
    } as never);

    await expect(repository.listAllUsers('account-1')).resolves.toEqual([
      {
        user_id: 'user-1',
        first_name: 'John',
        last_name: 'Doe',
        account_id: 'account-1',
        account_name: 'Main Account',
      },
      {
        user_id: 'user-2',
        first_name: null,
        last_name: null,
        account_id: 'account-1',
        account_name: '',
      },
    ]);
  });

  it('returns empty list when findMany returns nullish', async () => {
    const repository = new UserAllListerRepository({
      query: {
        user: {
          findMany: jest.fn(async () => null),
        },
      },
    } as never);

    await expect(repository.listAllUsers('account-1')).resolves.toEqual([]);
  });
});
