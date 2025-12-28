import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { StorageService } from '@core/services/storage.service';
import { DeletePhotoResponse } from '@core/schema/user/deletePhoto/response.schema';

@injectable()
export class UserPhotoDeleterUseCase {
  constructor(
    private readonly userService: UserService,
    private readonly storageService: StorageService
  ) {}

  private async deletePhotoFromStorage(userId: string): Promise<void> {
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
  ): Promise<DeletePhotoResponse> {
    const existsUserById = await this.userService.existsUserById(
      userId,
      accountId
    );

    if (!existsUserById) {
      throw new Error(t('user_not_found'));
    }

    await this.deletePhotoFromStorage(userId);

    const result = await this.userService.uploadUserPhoto(
      t,
      userId,
      accountId,
      null,
      true
    );

    return {
      photo: result,
    };
  }
}
