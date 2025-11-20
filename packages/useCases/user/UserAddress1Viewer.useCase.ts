import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { ViewUserAddress1Response } from '@core/schema/user/viewUserAddress1/response.schema';

@injectable()
export class UserAddress1ViewerUseCase {
  constructor(private readonly userService: UserService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string
  ): Promise<ViewUserAddress1Response | null> {
    const sensitiveData =
      await this.userService.getUserSensitiveDataDecrypted(userId);

    if (!sensitiveData) {
      throw new Error(t('user_not_found'));
    }

    return {
      address1: sensitiveData.address1,
    };
  }
}
