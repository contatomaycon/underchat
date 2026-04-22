import 'reflect-metadata';

jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));

import { AccountInfoViewerUseCase } from '@core/useCases/account/AccountInfoViewer.useCase';

describe('AccountInfoViewerUseCase', () => {
  it('throws when account info does not exist', async () => {
    const accountService = {
      existsAccountInfoById: jest.fn(async () => false),
      viewAccountInfoByAccountId: jest.fn(),
    };
    const useCase = new AccountInfoViewerUseCase(accountService as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1')).rejects.toThrow(
      'account_info_not_found'
    );
    expect(accountService.viewAccountInfoByAccountId).not.toHaveBeenCalled();
  });

  it('returns account info when it exists', async () => {
    const accountInfo = { account_info_id: 'info-1' };
    const accountService = {
      existsAccountInfoById: jest.fn(async () => true),
      viewAccountInfoByAccountId: jest.fn(async () => accountInfo),
    };
    const useCase = new AccountInfoViewerUseCase(accountService as never);

    await expect(useCase.execute(jest.fn() as never, 'acc-1')).resolves.toEqual(
      accountInfo
    );
  });
});
