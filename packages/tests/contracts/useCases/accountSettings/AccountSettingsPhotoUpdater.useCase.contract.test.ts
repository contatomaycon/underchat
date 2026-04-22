import 'reflect-metadata';

jest.mock('@core/services/user.service', () => ({
  UserService: class {},
}));
jest.mock('@core/services/storage.service', () => ({
  StorageService: class {},
}));

import { AccountSettingsPhotoUpdaterUseCase } from '@core/useCases/accountSettings/AccountSettingsPhotoUpdater.useCase';

describe('AccountSettingsPhotoUpdaterUseCase', () => {
  it('throws when uploaded file exceeds max size', async () => {
    const userService = {
      viewUserNamePhoto: jest.fn(),
      uploadUserPhoto: jest.fn(),
    };
    const storageService = {
      deleteImage: jest.fn(),
    };
    const useCase = new AccountSettingsPhotoUpdaterUseCase(
      userService as never,
      storageService as never
    );
    const file = {
      toBuffer: jest.fn(async () => Buffer.alloc(16 * 1024 * 1024 + 1)),
    };
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'user-1', 'acc-1', { photo: file } as never)
    ).rejects.toThrow('profile_info_file_size_exceeded');
    expect(userService.uploadUserPhoto).not.toHaveBeenCalled();
    expect(storageService.deleteImage).not.toHaveBeenCalled();
  });

  it('uploads photo without deleting storage when user has no previous photo', async () => {
    const userService = {
      viewUserNamePhoto: jest.fn(async () => ({ photo: null })),
      uploadUserPhoto: jest.fn(async () => 'new-photo'),
    };
    const storageService = {
      deleteImage: jest.fn(),
    };
    const useCase = new AccountSettingsPhotoUpdaterUseCase(
      userService as never,
      storageService as never
    );
    const file = {
      toBuffer: jest.fn(async () => Buffer.alloc(16 * 1024 * 1024)),
    };
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'user-1', 'acc-1', { photo: file } as never)
    ).resolves.toEqual({
      photo: 'new-photo',
    });
    expect(storageService.deleteImage).not.toHaveBeenCalled();
    expect(userService.uploadUserPhoto).toHaveBeenCalledWith(
      t,
      'user-1',
      'acc-1',
      file,
      false
    );
  });

  it('deletes previous photo from storage before uploading new one', async () => {
    const userService = {
      viewUserNamePhoto: jest.fn(async () => ({ photo: 'old-photo' })),
      uploadUserPhoto: jest.fn(async () => 'new-photo'),
    };
    const storageService = {
      deleteImage: jest.fn(async () => undefined),
    };
    const useCase = new AccountSettingsPhotoUpdaterUseCase(
      userService as never,
      storageService as never
    );
    const file = {
      toBuffer: jest.fn(async () => Buffer.from('ok')),
    };

    await expect(
      useCase.execute(jest.fn() as never, 'user-1', 'acc-1', {
        photo: file,
      } as never)
    ).resolves.toEqual({ photo: 'new-photo' });
    expect(storageService.deleteImage).toHaveBeenCalledWith('old-photo');
  });
});
