import 'reflect-metadata';

jest.mock('@core/services/user.service', () => ({
  UserService: class {},
}));

import { AccountSettingsAddress2ViewerUseCase } from '@core/useCases/accountSettings/AccountSettingsAddress2Viewer.useCase';

describe('AccountSettingsAddress2ViewerUseCase', () => {
  it('throws when user does not exist', async () => {
    const userService = {
      getUserSensitiveDataRaw: jest.fn(async () => null),
      getUserAddress2Decrypted: jest.fn(),
    };
    const useCase = new AccountSettingsAddress2ViewerUseCase(
      userService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'user-1')).rejects.toThrow(
      'user_not_found'
    );
    expect(userService.getUserAddress2Decrypted).not.toHaveBeenCalled();
  });

  it('returns decrypted address2', async () => {
    const userService = {
      getUserSensitiveDataRaw: jest.fn(async () => ({
        address2: 'enc-address-2',
      })),
      getUserAddress2Decrypted: jest.fn(() => 'Apt 205'),
    };
    const useCase = new AccountSettingsAddress2ViewerUseCase(
      userService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'user-1')
    ).resolves.toEqual({
      address2: 'Apt 205',
    });
    expect(userService.getUserAddress2Decrypted).toHaveBeenCalledWith(
      'enc-address-2'
    );
  });
});
