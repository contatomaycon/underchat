import 'reflect-metadata';

jest.mock('@core/services/user.service', () => ({
  UserService: class {},
}));

import { AccountSettingsAdditionalInfoViewerUseCase } from '@core/useCases/accountSettings/AccountSettingsAdditionalInfoViewer.useCase';

describe('AccountSettingsAdditionalInfoViewerUseCase', () => {
  it('throws when user is not found', async () => {
    const userService = {
      viewAdditionalInfo: jest.fn(async () => null),
    };
    const useCase = new AccountSettingsAdditionalInfoViewerUseCase(
      userService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'user-1')).rejects.toThrow(
      'user_not_found'
    );
  });

  it('returns additional info when user exists', async () => {
    const additionalInfo = { name: 'Maycon' };
    const userService = {
      viewAdditionalInfo: jest.fn(async () => additionalInfo),
    };
    const useCase = new AccountSettingsAdditionalInfoViewerUseCase(
      userService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'user-1')
    ).resolves.toEqual(additionalInfo);
    expect(userService.viewAdditionalInfo).toHaveBeenCalledWith('user-1');
  });
});
