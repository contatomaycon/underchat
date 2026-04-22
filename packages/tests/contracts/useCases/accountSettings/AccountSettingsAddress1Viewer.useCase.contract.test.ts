import 'reflect-metadata';

jest.mock('@core/services/user.service', () => ({
  UserService: class {},
}));

import { AccountSettingsAddress1ViewerUseCase } from '@core/useCases/accountSettings/AccountSettingsAddress1Viewer.useCase';

describe('AccountSettingsAddress1ViewerUseCase', () => {
  it('throws when user does not exist', async () => {
    const userService = {
      getUserSensitiveDataRaw: jest.fn(async () => null),
      getUserAddress1Decrypted: jest.fn(),
    };
    const useCase = new AccountSettingsAddress1ViewerUseCase(
      userService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'user-1')).rejects.toThrow(
      'user_not_found'
    );
    expect(userService.getUserAddress1Decrypted).not.toHaveBeenCalled();
  });

  it('returns decrypted address1', async () => {
    const userService = {
      getUserSensitiveDataRaw: jest.fn(async () => ({
        address1: 'enc-address-1',
      })),
      getUserAddress1Decrypted: jest.fn(() => 'Street 1'),
    };
    const useCase = new AccountSettingsAddress1ViewerUseCase(
      userService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'user-1')
    ).resolves.toEqual({
      address1: 'Street 1',
    });
    expect(userService.getUserAddress1Decrypted).toHaveBeenCalledWith(
      'enc-address-1'
    );
  });
});
