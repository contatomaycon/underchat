import 'reflect-metadata';

jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));
jest.mock('@core/services/storage.service', () => ({
  StorageService: class {},
}));

import { AccountInfoUpdaterUseCase } from '@core/useCases/account/AccountInfoUpdater.useCase';

describe('AccountInfoUpdaterUseCase', () => {
  it('throws when account info does not exist', async () => {
    const accountService = {
      accountInfoByIdExists: jest.fn(async () => false),
      viewLogoByAccountInfoId: jest.fn(),
      updateAccountInfoById: jest.fn(),
    };
    const storageService = {
      deleteImage: jest.fn(),
      uploadImage: jest.fn(),
    };
    const useCase = new AccountInfoUpdaterUseCase(
      accountService as never,
      storageService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'info-1', {
        account_id: { value: 'acc-1' },
      } as never)
    ).rejects.toThrow('account_info_not_found');
  });

  it('deletes current logo when delete_logo is true', async () => {
    const accountService = {
      accountInfoByIdExists: jest.fn(async () => true),
      viewLogoByAccountInfoId: jest.fn(async () => 'old-logo'),
      updateAccountInfoById: jest.fn(async () => true),
    };
    const storageService = {
      deleteImage: jest.fn(async () => undefined),
      uploadImage: jest.fn(),
    };
    const useCase = new AccountInfoUpdaterUseCase(
      accountService as never,
      storageService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'info-1', {
        account_id: { value: 'acc-1' },
        delete_logo: { value: true },
      } as never)
    ).resolves.toBe(true);
    expect(storageService.deleteImage).toHaveBeenCalledWith('old-logo');
    expect(accountService.updateAccountInfoById).toHaveBeenCalledWith(
      'info-1',
      expect.any(Object),
      null
    );
  });

  it('uploads logo when body has logo and delete_logo is false', async () => {
    const logo = { filename: 'logo.png' };
    const accountService = {
      accountInfoByIdExists: jest.fn(async () => true),
      viewLogoByAccountInfoId: jest.fn(),
      updateAccountInfoById: jest.fn(async () => true),
    };
    const storageService = {
      deleteImage: jest.fn(),
      uploadImage: jest.fn(async () => ({ url: 'new-logo' })),
    };
    const useCase = new AccountInfoUpdaterUseCase(
      accountService as never,
      storageService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'info-1', {
        account_id: { value: 'acc-1' },
        logo,
      } as never)
    ).resolves.toBe(true);
    expect(storageService.uploadImage).toHaveBeenCalledWith(logo, 'acc-1');
    expect(accountService.updateAccountInfoById).toHaveBeenCalledWith(
      'info-1',
      expect.any(Object),
      'new-logo'
    );
  });

  it('throws when update account info fails', async () => {
    const accountService = {
      accountInfoByIdExists: jest.fn(async () => true),
      viewLogoByAccountInfoId: jest.fn(async () => null),
      updateAccountInfoById: jest.fn(async () => false),
    };
    const storageService = {
      deleteImage: jest.fn(),
      uploadImage: jest.fn(),
    };
    const useCase = new AccountInfoUpdaterUseCase(
      accountService as never,
      storageService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'info-1', {
        account_id: { value: 'acc-1' },
        delete_logo: { value: true },
      } as never)
    ).rejects.toThrow('account_info_update_error');
  });
});
