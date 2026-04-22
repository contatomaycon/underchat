import 'reflect-metadata';

jest.mock('@core/services/user.service', () => ({
  UserService: class {},
}));
jest.mock('@core/services/storage.service', () => ({
  StorageService: class {},
}));

import { AccountSettingsPhotoDeleterUseCase } from '@core/useCases/accountSettings/AccountSettingsPhotoDeleter.useCase';

describe('AccountSettingsPhotoDeleterUseCase', () => {
  it('deletes photo without storage delete when user has no current photo', async () => {
    const userService = {
      viewUserNamePhoto: jest.fn(async () => ({ photo: null })),
      uploadUserPhoto: jest.fn(async () => 'new-photo-url'),
    };
    const storageService = {
      deleteImage: jest.fn(),
    };
    const useCase = new AccountSettingsPhotoDeleterUseCase(
      userService as never,
      storageService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'user-1', 'acc-1')
    ).resolves.toEqual({
      photo: 'new-photo-url',
    });
    expect(storageService.deleteImage).not.toHaveBeenCalled();
    expect(userService.uploadUserPhoto).toHaveBeenCalledWith(
      t,
      'user-1',
      'acc-1',
      null,
      true
    );
  });

  it('deletes current photo from storage before resetting user photo', async () => {
    const userService = {
      viewUserNamePhoto: jest.fn(async () => ({ photo: 'old-photo' })),
      uploadUserPhoto: jest.fn(async () => 'new-photo-url'),
    };
    const storageService = {
      deleteImage: jest.fn(async () => undefined),
    };
    const useCase = new AccountSettingsPhotoDeleterUseCase(
      userService as never,
      storageService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'user-1', 'acc-1')
    ).resolves.toEqual({ photo: 'new-photo-url' });
    expect(storageService.deleteImage).toHaveBeenCalledWith('old-photo');
  });
});
