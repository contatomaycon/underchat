import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { StorageService } from '@core/services/storage.service';
import { UpdatePhotoRequest } from '@core/schema/accountSettings/updatePhoto/request.schema';
import { UpdatePhotoResponse } from '@core/schema/accountSettings/updatePhoto/response.schema';
import { UploadFileRequest } from '@core/schema/upload/request.schema';

@injectable()
export class AccountSettingsPhotoUpdaterUseCase {
  MAX_FILE_SIZE_BYTES = 16 * 1024 * 1024;

  constructor(
    private readonly userService: UserService,
    private readonly storageService: StorageService
  ) {}

  private async validateFileSize(
    file: UploadFileRequest,
    t: TFunction<'translation', undefined>
  ): Promise<void> {
    const buffer = await file.toBuffer();

    if (buffer.byteLength > this.MAX_FILE_SIZE_BYTES) {
      throw new Error(t('profile_info_file_size_exceeded', { max: '16 MB' }));
    }
  }

  private async deleteCurrentPhotoFromStorage(userId: string): Promise<void> {
    const userPhoto = await this.userService.viewUserNamePhoto(userId);

    if (!userPhoto?.photo) {
      return;
    }

    await this.storageService.deleteImage(userPhoto.photo);
  }

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string,
    accountId: string,
    body: UpdatePhotoRequest
  ): Promise<UpdatePhotoResponse> {
    const photo = body.photo;

    await this.validateFileSize(photo, t);

    const [, result] = await Promise.all([
      this.deleteCurrentPhotoFromStorage(userId),
      this.userService.uploadUserPhoto(t, userId, accountId, photo, false),
    ]);

    return {
      photo: result,
    };
  }
}
