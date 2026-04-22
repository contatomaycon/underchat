import 'reflect-metadata';

jest.mock('@core/services/user.service', () => ({
  UserService: class {},
}));

import { AccountSettingsPhoneViewerUseCase } from '@core/useCases/accountSettings/AccountSettingsPhoneViewer.useCase';

describe('AccountSettingsPhoneViewerUseCase', () => {
  it('throws when user does not exist', async () => {
    const userService = {
      getUserSensitiveDataRaw: jest.fn(async () => null),
      getUserPhoneDecrypted: jest.fn(),
    };
    const useCase = new AccountSettingsPhoneViewerUseCase(userService as never);
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'user-1')).rejects.toThrow(
      'user_not_found'
    );
    expect(userService.getUserPhoneDecrypted).not.toHaveBeenCalled();
  });

  it('returns decrypted phone', async () => {
    const userService = {
      getUserSensitiveDataRaw: jest.fn(async () => ({ phone: 'enc-phone' })),
      getUserPhoneDecrypted: jest.fn(() => '5511999999999'),
    };
    const useCase = new AccountSettingsPhoneViewerUseCase(userService as never);

    await expect(
      useCase.execute(jest.fn() as never, 'user-1')
    ).resolves.toEqual({
      phone: '5511999999999',
    });
    expect(userService.getUserPhoneDecrypted).toHaveBeenCalledWith('enc-phone');
  });
});
