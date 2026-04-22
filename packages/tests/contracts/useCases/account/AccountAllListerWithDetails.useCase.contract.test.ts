import 'reflect-metadata';

jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));

import { AccountAllListerWithDetailsUseCase } from '@core/useCases/account/AccountAllListerWithDetails.useCase';

describe('AccountAllListerWithDetailsUseCase', () => {
  it('uses default pagination when query does not provide values', async () => {
    const accountService = {
      listAllAccountsWithDetails: jest.fn(async () => [[], 0]),
    };
    const useCase = new AccountAllListerWithDetailsUseCase(
      accountService as never
    );

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
    expect(accountService.listAllAccountsWithDetails).toHaveBeenCalledWith(
      10,
      1,
      {}
    );
  });

  it('returns paginated account details', async () => {
    const results = [{ account_id: 'acc-1' }];
    const accountService = {
      listAllAccountsWithDetails: jest.fn(async () => [results, 5]),
    };
    const useCase = new AccountAllListerWithDetailsUseCase(
      accountService as never
    );

    await expect(
      useCase.execute({ per_page: 2, current_page: 2 } as never)
    ).resolves.toEqual({
      pagings: {
        current_page: 2,
        total_pages: 3,
        per_page: 2,
        count: 1,
        total: 5,
      },
      results,
    });
  });
});
