import 'reflect-metadata';

jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));

import { AccountUpdaterUseCase } from '@core/useCases/account/AccountUpdater.useCase';

describe('AccountUpdaterUseCase', () => {
  it('throws when account does not exist', async () => {
    const accountService = {
      existsAccountById: jest.fn(async () => false),
      updateAccountById: jest.fn(),
    };
    const useCase = new AccountUpdaterUseCase(accountService as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', { name: 'Acme' } as never)
    ).rejects.toThrow('account_not_found');
    expect(accountService.updateAccountById).not.toHaveBeenCalled();
  });

  it('throws when account update fails', async () => {
    const accountService = {
      existsAccountById: jest.fn(async () => true),
      updateAccountById: jest.fn(async () => false),
    };
    const useCase = new AccountUpdaterUseCase(accountService as never);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', { name: 'Acme' } as never)
    ).rejects.toThrow('account_update_error');
  });

  it('returns true when account update succeeds', async () => {
    const body = { name: 'Acme' } as never;
    const accountService = {
      existsAccountById: jest.fn(async () => true),
      updateAccountById: jest.fn(async () => true),
    };
    const useCase = new AccountUpdaterUseCase(accountService as never);

    await expect(
      useCase.execute(jest.fn() as never, 'acc-1', body)
    ).resolves.toBe(true);
    expect(accountService.updateAccountById).toHaveBeenCalledWith(
      body,
      'acc-1'
    );
  });
});
