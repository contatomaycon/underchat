import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { ViewUserAddress2Response } from '@core/schema/user/viewUserAddress2/response.schema';

@injectable()
export class UserAddress2ViewerUseCase {
  constructor(private readonly userService: UserService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string
  ): Promise<ViewUserAddress2Response | null> {
    const sensitiveData =
      await this.userService.getUserSensitiveDataDecrypted(userId);

    if (!sensitiveData) {
      throw new Error(t('user_not_found'));
    }

    return {
      address2: sensitiveData.address2,
    };
  }
}

