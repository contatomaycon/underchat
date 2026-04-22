import 'reflect-metadata';

jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));

import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { AccountBlockerUseCase } from '@core/useCases/account/AccountBlocker.useCase';

describe('AccountBlockerUseCase', () => {
  it('clears account sessions when block succeeds', async () => {
    const accountService = {
      updateAccountStatusById: jest.fn(async () => true),
      clearAllAccountSessions: jest.fn(async () => undefined),
    };
    const useCase = new AccountBlockerUseCase(accountService as never);

    await expect(useCase.execute('acc-1')).resolves.toBe(true);
    expect(accountService.updateAccountStatusById).toHaveBeenCalledWith(
      'acc-1',
      EAccountStatus.blocked
    );
    expect(accountService.clearAllAccountSessions).toHaveBeenCalledWith(
      'acc-1'
    );
  });

  it('does not clear sessions when block fails', async () => {
    const accountService = {
      updateAccountStatusById: jest.fn(async () => false),
      clearAllAccountSessions: jest.fn(),
    };
    const useCase = new AccountBlockerUseCase(accountService as never);

    await expect(useCase.execute('acc-1')).resolves.toBe(false);
    expect(accountService.clearAllAccountSessions).not.toHaveBeenCalled();
  });
});
