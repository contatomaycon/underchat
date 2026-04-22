import 'reflect-metadata';

jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));
jest.mock('@core/services/storage.service', () => ({
  StorageService: class {},
}));
jest.mock(
  '@core/repositories/account/AccountInfoUpserterTransaction.repository',
  () => ({
    AccountInfoUpserterTransactionRepository: class {},
  })
);
jest.mock('@core/services/planAccount.service', () => ({
  PlanAccountService: class {},
}));

import { AccountCustomizationUpserterUseCase } from '@core/useCases/accountSettings/AccountCustomizationUpserter.useCase';

describe('AccountCustomizationUpserterUseCase', () => {
  it('throws when account plan does not allow customization', async () => {
    const accountService = {
      viewAccountInfoByAccountId: jest.fn(),
      viewLogoByAccountInfoId: jest.fn(),
      updateAccountById: jest.fn(),
    };
    const storageService = {
      deleteImage: jest.fn(),
      uploadImage: jest.fn(),
    };
    const repository = {
      upsertAccountInfo: jest.fn(),
    };
    const planAccountService = {
      validateCanCreatePersonalization: jest.fn(async () => false),
    };
    const useCase = new AccountCustomizationUpserterUseCase(
      accountService as never,
      storageService as never,
      repository as never,
      planAccountService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'acc-1', {
        name: { value: 'Acme' },
      } as never)
    ).rejects.toThrow('personalization_not_available');
    expect(repository.upsertAccountInfo).not.toHaveBeenCalled();
  });

  it('deletes current logo when delete_logo is true and updates account name', async () => {
    const accountService = {
      viewAccountInfoByAccountId: jest.fn(async () => ({
        account_info_id: 'info-1',
      })),
      viewLogoByAccountInfoId: jest.fn(async () => 'old-logo'),
      updateAccountById: jest.fn(async () => true),
    };
    const storageService = {
      deleteImage: jest.fn(async () => undefined),
      uploadImage: jest.fn(),
    };
    const repository = {
      upsertAccountInfo: jest.fn(async () => ({ created: false })),
    };
    const planAccountService = {
      validateCanCreatePersonalization: jest.fn(async () => true),
    };
    const useCase = new AccountCustomizationUpserterUseCase(
      accountService as never,
      storageService as never,
      repository as never,
      planAccountService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'acc-1', {
        delete_logo: { value: true },
        name: { value: '  New Name  ' },
      } as never)
    ).resolves.toEqual({ created: false });

    expect(storageService.deleteImage).toHaveBeenCalledWith('old-logo');
    expect(repository.upsertAccountInfo).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({
        account_id: { value: 'acc-1' },
      }),
      null
    );
    expect(accountService.updateAccountById).toHaveBeenCalledWith(
      { name: 'New Name' },
      'acc-1'
    );
    expect(storageService.uploadImage).not.toHaveBeenCalled();
  });

  it('uploads new logo when logo file exists and delete_logo is false', async () => {
    const logoFile = { filename: 'logo.png' };
    const accountService = {
      viewAccountInfoByAccountId: jest.fn(async () => ({
        account_info_id: 'info-1',
      })),
      viewLogoByAccountInfoId: jest.fn(),
      updateAccountById: jest.fn(),
    };
    const storageService = {
      deleteImage: jest.fn(),
      uploadImage: jest.fn(async () => ({ url: 'new-logo' })),
    };
    const repository = {
      upsertAccountInfo: jest.fn(async () => ({ created: true })),
    };
    const planAccountService = {
      validateCanCreatePersonalization: jest.fn(async () => true),
    };
    const useCase = new AccountCustomizationUpserterUseCase(
      accountService as never,
      storageService as never,
      repository as never,
      planAccountService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'acc-1', {
        delete_logo: { value: false },
        logo: logoFile,
      } as never)
    ).resolves.toEqual({ created: true });

    expect(storageService.uploadImage).toHaveBeenCalledWith(logoFile, 'acc-1');
    expect(repository.upsertAccountInfo).toHaveBeenCalledWith(
      'acc-1',
      expect.any(Object),
      'new-logo'
    );
    expect(accountService.updateAccountById).not.toHaveBeenCalled();
  });

  it('passes null logo when upload does not return url and skips account name update for blank name', async () => {
    const logoFile = { filename: 'logo.png' };
    const accountService = {
      viewAccountInfoByAccountId: jest.fn(async () => null),
      viewLogoByAccountInfoId: jest.fn(),
      updateAccountById: jest.fn(),
    };
    const storageService = {
      deleteImage: jest.fn(),
      uploadImage: jest.fn(async () => undefined),
    };
    const repository = {
      upsertAccountInfo: jest.fn(async () => ({ created: true })),
    };
    const planAccountService = {
      validateCanCreatePersonalization: jest.fn(async () => true),
    };
    const useCase = new AccountCustomizationUpserterUseCase(
      accountService as never,
      storageService as never,
      repository as never,
      planAccountService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'acc-1', {
        delete_logo: { value: false },
        logo: logoFile,
        name: { value: '   ' },
      } as never)
    ).resolves.toEqual({ created: true });

    expect(repository.upsertAccountInfo).toHaveBeenCalledWith(
      'acc-1',
      expect.any(Object),
      null
    );
    expect(accountService.updateAccountById).not.toHaveBeenCalled();
    expect(storageService.deleteImage).not.toHaveBeenCalled();
  });
});
