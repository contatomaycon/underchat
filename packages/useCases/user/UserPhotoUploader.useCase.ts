import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { UploadPhotoRequest } from '@core/schema/user/uploadPhoto/request.schema';
import { UploadPhotoResponse } from '@core/schema/user/uploadPhoto/response.schema';
import { UploadFileRequest } from '@core/schema/upload/request.schema';

@injectable()
export class UserPhotoUploaderUseCase {
  MAX_FILE_SIZE_BYTES = 16 * 1024 * 1024;

  constructor(private readonly userService: UserService) {}

  private async validateFileSize(
    file: UploadFileRequest,
    t: TFunction<'translation', undefined>
  ): Promise<void> {
    const buffer = await file.toBuffer();

    if (buffer.byteLength > this.MAX_FILE_SIZE_BYTES) {
      throw new Error(t('profile_info_file_size_exceeded', { max: '16 MB' }));
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string,
    accountId: string,
    body: UploadPhotoRequest
  ): Promise<UploadPhotoResponse> {
    const existsUserById = await this.userService.existsUserById(
      userId,
      accountId
    );

    if (!existsUserById) {
      throw new Error(t('user_not_found'));
    }

    const photo = body.photo;
    await this.validateFileSize(photo, t);

    const result = await this.userService.uploadUserPhoto(
      t,
      userId,
      accountId,
      photo,
      false
    );

    return {
      photo: result,
    };
  }
}
