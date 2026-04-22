import 'reflect-metadata';

jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));

import { AccountViewerUseCase } from '@core/useCases/account/AccountViewer.useCase';

describe('AccountViewerUseCase', () => {
  it('throws when account does not exist', async () => {
    const accountService = {
      existsAccountById: jest.fn(async () => false),
      viewAccounts: jest.fn(),
    };
    const useCase = new AccountViewerUseCase(accountService as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1')).rejects.toThrow(
      'account_not_found'
    );
    expect(accountService.viewAccounts).not.toHaveBeenCalled();
  });

  it('throws when account view result is null', async () => {
    const accountService = {
      existsAccountById: jest.fn(async () => true),
      viewAccounts: jest.fn(async () => null),
    };
    const useCase = new AccountViewerUseCase(accountService as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1')).rejects.toThrow(
      'account_not_found'
    );
  });

  it('returns account data', async () => {
    const account = { account_id: 'acc-1', name: 'Acme' };
    const accountService = {
      existsAccountById: jest.fn(async () => true),
      viewAccounts: jest.fn(async () => account),
    };
    const useCase = new AccountViewerUseCase(accountService as never);

    await expect(useCase.execute(jest.fn() as never, 'acc-1')).resolves.toEqual(
      account
    );
  });
});
