import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { StorageService } from '@core/services/storage.service';

@injectable()
export class UserDeleterUseCase {
  constructor(
    private readonly userService: UserService,
    private readonly storageService: StorageService
  ) {}

  private async deleteUserPhotoFromStorage(userId: string): Promise<void> {
    const userPhoto = await this.userService.viewUserNamePhoto(userId);
    if (!userPhoto?.photo) {
      return;
    }

    await this.storageService.deleteImage(userPhoto.photo);
  }

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string,
    accountId: string
  ): Promise<boolean> {
    const existsUserById = await this.userService.existsUserById(
      userId,
      accountId
    );

    if (!existsUserById) {
      throw new Error(t('user_not_found'));
    }

    await this.deleteUserPhotoFromStorage(userId);

    const deleteUserById = await this.userService.deleteUserById(
      userId,
      accountId
    );

    if (!deleteUserById) {
      throw new Error(t('user_deleter_error'));
    }

    return true;
  }
}
