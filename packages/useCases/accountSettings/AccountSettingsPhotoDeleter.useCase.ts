import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { StorageService } from '@core/services/storage.service';
import { DeletePhotoResponse } from '@core/schema/accountSettings/deletePhoto/response.schema';

@injectable()
export class AccountSettingsPhotoDeleterUseCase {
  constructor(
    @inject(UserService)
    private readonly userService: UserService,
    @inject(StorageService)
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
