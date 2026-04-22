import 'reflect-metadata';

jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));

import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { AccountUnblockerUseCase } from '@core/useCases/account/AccountUnblocker.useCase';

describe('AccountUnblockerUseCase', () => {
  it('updates account status to active', async () => {
    const accountService = {
      updateAccountStatusById: jest.fn(async () => true),
    };
    const useCase = new AccountUnblockerUseCase(accountService as never);

    await expect(useCase.execute('acc-1')).resolves.toBe(true);
    expect(accountService.updateAccountStatusById).toHaveBeenCalledWith(
      'acc-1',
      EAccountStatus.active
    );
  });
});
