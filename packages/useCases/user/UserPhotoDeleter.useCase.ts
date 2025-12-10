import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { DeletePhotoResponse } from '@core/schema/user/deletePhoto/response.schema';

@injectable()
export class UserPhotoDeleterUseCase {
  constructor(private readonly userService: UserService) {}

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
