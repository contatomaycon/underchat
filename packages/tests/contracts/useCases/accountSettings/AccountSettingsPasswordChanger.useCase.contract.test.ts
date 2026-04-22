import 'reflect-metadata';

jest.mock('@core/services/user.service', () => ({
  UserService: class {},
}));

import { AccountSettingsPasswordChangerUseCase } from '@core/useCases/accountSettings/AccountSettingsPasswordChanger.useCase';

describe('AccountSettingsPasswordChangerUseCase', () => {
  it('throws when current password is invalid', async () => {
    const userService = {
      verifyUserPassword: jest.fn(async () => false),
      updateUserPassword: jest.fn(),
    };
    const useCase = new AccountSettingsPasswordChangerUseCase(
      userService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'user-1', 'acc-1', {
        current_password: 'wrong',
        new_password: 'abc12345',
      } as never)
    ).rejects.toThrow('current_password_invalid');
    expect(userService.updateUserPassword).not.toHaveBeenCalled();
  });

  it('throws when new password fails validation rules', async () => {
    const userService = {
      verifyUserPassword: jest.fn(async () => true),
      updateUserPassword: jest.fn(),
    };
    const useCase = new AccountSettingsPasswordChangerUseCase(
      userService as never
    );

    await expect(
      useCase.execute(
        jest.fn((key: string) => key) as never,
        'user-1',
        'acc-1',
        {
          current_password: 'ok',
          new_password: 'abc',
        } as never
      )
    ).rejects.toThrow(
      'password_minimum_8_characters, password_requires_number_symbol_or_whitespace'
    );
    expect(userService.updateUserPassword).not.toHaveBeenCalled();
  });

  it('updates password when current and new passwords are valid', async () => {
    const userService = {
      verifyUserPassword: jest.fn(async () => true),
      updateUserPassword: jest.fn(async () => undefined),
    };
    const useCase = new AccountSettingsPasswordChangerUseCase(
      userService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'user-1', 'acc-1', {
        current_password: 'ok',
        new_password: 'abcd1234',
      } as never)
    ).resolves.toEqual({ success: true });
    expect(userService.updateUserPassword).toHaveBeenCalledWith(
      t,
      'user-1',
      'acc-1',
      'abcd1234'
    );
  });
});
