import 'reflect-metadata';

jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));

import { AccountListerUseCase } from '@core/useCases/account/AccountLister.useCase';

describe('AccountListerUseCase', () => {
  it('uses default pagination when query has no pagination values', async () => {
    const accountService = {
      listAccounts: jest.fn(async () => [[], 0]),
    };
    const useCase = new AccountListerUseCase(accountService as never);

    await expect(useCase.execute({} as never)).resolves.toEqual({
      pagings: {
        current_page: 1,
        total_pages: 0,
        per_page: 10,
        count: 0,
        total: 0,
      },
      results: [],
    });
    expect(accountService.listAccounts).toHaveBeenCalledWith(10, 1, {});
  });

  it('returns paginated accounts', async () => {
    const results = [{ account_id: 'acc-1' }];
    const accountService = {
      listAccounts: jest.fn(async () => [results, 4]),
    };
    const useCase = new AccountListerUseCase(accountService as never);

    await expect(
      useCase.execute({ per_page: 2, current_page: 2 } as never)
    ).resolves.toEqual({
      pagings: {
        current_page: 2,
        total_pages: 2,
        per_page: 2,
        count: 1,
        total: 4,
      },
      results,
    });
  });
});
