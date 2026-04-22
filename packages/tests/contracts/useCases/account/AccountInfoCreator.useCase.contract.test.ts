import 'reflect-metadata';

jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));
jest.mock('@core/services/storage.service', () => ({
  StorageService: class {},
}));

import { AccountInfoCreatorUseCase } from '@core/useCases/account/AccountInfoCreator.useCase';

describe('AccountInfoCreatorUseCase', () => {
  it('throws when account does not exist', async () => {
    const accountService = {
      existsAccountById: jest.fn(async () => false),
      createAccountInfo: jest.fn(),
    };
    const storageService = {
      uploadImage: jest.fn(),
    };
    const useCase = new AccountInfoCreatorUseCase(
      accountService as never,
      storageService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(
        t as never,
        {
          account_id: { value: 'acc-1' },
        } as never
      )
    ).rejects.toThrow('account_not_found');
    expect(storageService.uploadImage).not.toHaveBeenCalled();
  });

  it('throws when account info creation fails', async () => {
    const input = {
      account_id: { value: 'acc-1' },
      logo: { filename: 'logo.png' },
    } as never;
    const accountService = {
      existsAccountById: jest.fn(async () => true),
      createAccountInfo: jest.fn(async () => false),
    };
    const storageService = {
      uploadImage: jest.fn(async () => ({ url: 'logo-url' })),
    };
    const useCase = new AccountInfoCreatorUseCase(
      accountService as never,
      storageService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, input)).rejects.toThrow(
      'account_info_creator_error'
    );
  });

  it('creates account info without logo upload when logo is absent', async () => {
    const input = {
      account_id: { value: 'acc-1' },
    } as never;
    const accountService = {
      existsAccountById: jest.fn(async () => true),
      createAccountInfo: jest.fn(async () => true),
    };
    const storageService = {
      uploadImage: jest.fn(),
    };
    const useCase = new AccountInfoCreatorUseCase(
      accountService as never,
      storageService as never
    );

    await expect(useCase.execute(jest.fn() as never, input)).resolves.toBe(
      true
    );
    expect(storageService.uploadImage).not.toHaveBeenCalled();
    expect(accountService.createAccountInfo).toHaveBeenCalledWith(input, null);
  });
});
