import 'reflect-metadata';

jest.mock('@core/services/user.service', () => ({
  UserService: class {},
}));
jest.mock('@core/services/encrypt.service', () => ({
  EncryptService: class {},
}));
jest.mock('@core/services/passwordEncryptor.service', () => ({
  PasswordEncryptorService: class {},
}));

import { AccountSettingsAddressUpdaterUseCase } from '@core/useCases/accountSettings/AccountSettingsAddressUpdater.useCase';

describe('AccountSettingsAddressUpdaterUseCase', () => {
  const buildUseCase = (userService: any) => {
    const encryptService = {
      sanitize: jest.fn((value: string) => `partial-${value}`),
      encrypt: jest.fn((value: string) => `enc-${value}`),
    };
    const passwordEncryptorService = {
      encrypt: jest.fn((value: string) => `hash-${value}`),
    };
    const useCase = new AccountSettingsAddressUpdaterUseCase(
      userService as never,
      encryptService as never,
      passwordEncryptorService as never
    );
    return { useCase, encryptService, passwordEncryptorService };
  };

  it('deletes user address when country_id is provided as null', async () => {
    const userService = {
      deleteUserAddressById: jest.fn(async () => undefined),
      existsUserAddressByUserId: jest.fn(),
      createUserAddressWithoutTransaction: jest.fn(),
      updateUserAddressById: jest.fn(),
    };
    const { useCase } = buildUseCase(userService);

    await expect(
      useCase.execute(jest.fn() as never, 'user-1', {
        country_id: null,
      } as never)
    ).resolves.toEqual({ success: true });
    expect(userService.deleteUserAddressById).toHaveBeenCalledWith('user-1');
    expect(userService.existsUserAddressByUserId).not.toHaveBeenCalled();
  });

  it('returns success without creating address when address does not exist and country is absent', async () => {
    const userService = {
      deleteUserAddressById: jest.fn(),
      existsUserAddressByUserId: jest.fn(async () => false),
      createUserAddressWithoutTransaction: jest.fn(),
      updateUserAddressById: jest.fn(),
    };
    const { useCase } = buildUseCase(userService);

    await expect(
      useCase.execute(jest.fn() as never, 'user-1', {} as never)
    ).resolves.toEqual({ success: true });
    expect(
      userService.createUserAddressWithoutTransaction
    ).not.toHaveBeenCalled();
    expect(userService.updateUserAddressById).not.toHaveBeenCalled();
  });

  it('throws when create address fails', async () => {
    const userService = {
      deleteUserAddressById: jest.fn(),
      existsUserAddressByUserId: jest.fn(async () => false),
      createUserAddressWithoutTransaction: jest.fn(async () => false),
      updateUserAddressById: jest.fn(),
    };
    const { useCase } = buildUseCase(userService);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'user-1', {
        country_id: 55,
        address1: 'Rua A',
      } as never)
    ).rejects.toThrow('user_address_create_failed');
  });

  it('creates address when it does not exist and country is provided', async () => {
    const userService = {
      deleteUserAddressById: jest.fn(),
      existsUserAddressByUserId: jest.fn(async () => false),
      createUserAddressWithoutTransaction: jest.fn(async () => true),
      updateUserAddressById: jest.fn(),
    };
    const { useCase } = buildUseCase(userService);

    await expect(
      useCase.execute(jest.fn() as never, 'user-1', {
        country_id: 55,
        zip_code: '01000-000',
        address1: 'Rua A',
        address2: '',
        city_fiscal_code: '3550308',
        state_fiscal_code: '35',
        district: 'Centro',
      } as never)
    ).resolves.toEqual({ success: true });

    expect(
      userService.createUserAddressWithoutTransaction
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        country_id: 55,
        zip_code: '01000-000',
        address1: 'hash-Rua A',
        address1_partial: 'partial-Rua A',
        address1_c: 'enc-Rua A',
        address2: null,
      }),
      'user-1'
    );
  });

  it('returns success without update when address exists and body has no updatable fields', async () => {
    const userService = {
      deleteUserAddressById: jest.fn(),
      existsUserAddressByUserId: jest.fn(async () => true),
      createUserAddressWithoutTransaction: jest.fn(),
      updateUserAddressById: jest.fn(),
    };
    const { useCase } = buildUseCase(userService);

    await expect(
      useCase.execute(jest.fn() as never, 'user-1', {} as never)
    ).resolves.toEqual({ success: true });
    expect(userService.updateUserAddressById).not.toHaveBeenCalled();
  });

  it('throws when address update fails', async () => {
    const userService = {
      deleteUserAddressById: jest.fn(),
      existsUserAddressByUserId: jest.fn(async () => true),
      createUserAddressWithoutTransaction: jest.fn(),
      updateUserAddressById: jest.fn(async () => false),
    };
    const { useCase } = buildUseCase(userService);
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'user-1', {
        address1: 'Rua B',
      } as never)
    ).rejects.toThrow('user_address_update_failed');
  });

  it('updates address when it exists and fields are provided', async () => {
    const userService = {
      deleteUserAddressById: jest.fn(),
      existsUserAddressByUserId: jest.fn(async () => true),
      createUserAddressWithoutTransaction: jest.fn(),
      updateUserAddressById: jest.fn(async () => true),
    };
    const { useCase } = buildUseCase(userService);

    await expect(
      useCase.execute(jest.fn() as never, 'user-1', {
        country_id: 44,
        zip_code: '02000-000',
        address1: 'Street B',
        address2: 'Suite 2',
        city_fiscal_code: '3304557',
        state_fiscal_code: '33',
        district: 'Botafogo',
      } as never)
    ).resolves.toEqual({ success: true });
    expect(userService.updateUserAddressById).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        country_id: 44,
        zip_code: '02000-000',
        address1: 'hash-Street B',
        address2: 'hash-Suite 2',
        city_fiscal_code: '3304557',
        state_fiscal_code: '33',
        district: 'Botafogo',
      })
    );
  });

  it('covers create-input guard when country is missing', () => {
    const { useCase } = buildUseCase({});

    expect(() => (useCase as any).buildCreateUserAddressInput({})).toThrow(
      'country_id is required to create address'
    );
  });
});
