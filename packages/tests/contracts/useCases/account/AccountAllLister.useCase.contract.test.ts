import 'reflect-metadata';

jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));

import { AccountAllListerUseCase } from '@core/useCases/account/AccountAllLister.useCase';

describe('AccountAllListerUseCase', () => {
  it('returns all accounts from service', async () => {
    const accounts = [{ account_id: 'acc-1' }, { account_id: 'acc-2' }];
    const accountService = {
      listAllAccounts: jest.fn(async () => accounts),
    };
    const useCase = new AccountAllListerUseCase(accountService as never);

    await expect(useCase.execute()).resolves.toEqual(accounts);
    expect(accountService.listAllAccounts).toHaveBeenCalledTimes(1);
  });
});
