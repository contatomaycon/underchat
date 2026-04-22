import 'reflect-metadata';

jest.mock(
  '@core/repositories/accountSettings/AccountAddonsLister.repository',
  () => ({
    AccountAddonsListerRepository: class {},
  })
);

import { AccountAddonsListerUseCase } from '@core/useCases/accountSettings/AccountAddonsLister.useCase';

describe('AccountAddonsListerUseCase', () => {
  it('returns addons list from repository', async () => {
    const response = [{ plan_cross_sell_account_id: 'pcs-1' }];
    const repository = {
      listAccountAddons: jest.fn(async () => response),
    };
    const useCase = new AccountAddonsListerUseCase(repository as never);

    await expect(useCase.execute('acc-1')).resolves.toEqual(response);
    expect(repository.listAccountAddons).toHaveBeenCalledWith('acc-1');
  });
});
