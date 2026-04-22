import 'reflect-metadata';

jest.mock(
  '@core/repositories/accountSettings/AccountPaymentsLister.repository',
  () => ({
    AccountPaymentsListerRepository: class {},
  })
);

import { AccountPaymentsListerUseCase } from '@core/useCases/accountSettings/AccountPaymentsLister.useCase';

describe('AccountPaymentsListerUseCase', () => {
  it('uses default pagination values when query is empty', async () => {
    const repository = {
      listAccountPayments: jest.fn(async () => []),
      listAccountPaymentsTotal: jest.fn(async () => 0),
    };
    const useCase = new AccountPaymentsListerUseCase(repository as never);

    await expect(useCase.execute('acc-1', {} as never)).resolves.toEqual({
      pagings: {
        current_page: 1,
        total_pages: 0,
        per_page: 10,
        count: 0,
        total: 0,
      },
      results: [],
    });
    expect(repository.listAccountPayments).toHaveBeenCalledWith('acc-1', 10, 1);
  });

  it('returns paginated account payments', async () => {
    const results = [{ account_payment_id: 'pay-1' }];
    const repository = {
      listAccountPayments: jest.fn(async () => results),
      listAccountPaymentsTotal: jest.fn(async () => 4),
    };
    const useCase = new AccountPaymentsListerUseCase(repository as never);

    await expect(
      useCase.execute('acc-1', { per_page: 2, current_page: 2 } as never)
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
