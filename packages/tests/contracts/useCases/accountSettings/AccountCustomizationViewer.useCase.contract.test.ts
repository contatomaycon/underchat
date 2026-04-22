import 'reflect-metadata';

jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));
jest.mock('@core/services/planAccount.service', () => ({
  PlanAccountService: class {},
}));

import { AccountCustomizationViewerUseCase } from '@core/useCases/accountSettings/AccountCustomizationViewer.useCase';

describe('AccountCustomizationViewerUseCase', () => {
  it('throws when account info does not exist', async () => {
    const accountService = {
      existsAccountInfoById: jest.fn(async () => false),
      viewAccountInfoByAccountId: jest.fn(),
    };
    const planAccountService = {
      validateCanCreatePersonalization: jest.fn(),
    };
    const useCase = new AccountCustomizationViewerUseCase(
      accountService as never,
      planAccountService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'acc-1')).rejects.toThrow(
      'account_info_not_found'
    );
    expect(accountService.viewAccountInfoByAccountId).not.toHaveBeenCalled();
    expect(
      planAccountService.validateCanCreatePersonalization
    ).not.toHaveBeenCalled();
  });

  it('returns null when account info lookup returns null', async () => {
    const accountService = {
      existsAccountInfoById: jest.fn(async () => true),
      viewAccountInfoByAccountId: jest.fn(async () => null),
    };
    const planAccountService = {
      validateCanCreatePersonalization: jest.fn(),
    };
    const useCase = new AccountCustomizationViewerUseCase(
      accountService as never,
      planAccountService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'acc-1')
    ).resolves.toBeNull();
    expect(
      planAccountService.validateCanCreatePersonalization
    ).not.toHaveBeenCalled();
  });

  it('returns account info with can_edit flag', async () => {
    const accountInfo = { account_info_id: 'info-1', name: 'Acme' };
    const accountService = {
      existsAccountInfoById: jest.fn(async () => true),
      viewAccountInfoByAccountId: jest.fn(async () => accountInfo),
    };
    const planAccountService = {
      validateCanCreatePersonalization: jest.fn(async () => true),
    };
    const useCase = new AccountCustomizationViewerUseCase(
      accountService as never,
      planAccountService as never
    );

    await expect(useCase.execute(jest.fn() as never, 'acc-1')).resolves.toEqual(
      {
        ...accountInfo,
        can_edit: true,
      }
    );
    expect(
      planAccountService.validateCanCreatePersonalization
    ).toHaveBeenCalledWith('acc-1');
  });
});
