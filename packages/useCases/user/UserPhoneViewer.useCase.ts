import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { ViewUserPhoneResponse } from '@core/schema/user/viewUserPhone/response.schema';

@injectable()
export class UserPhoneViewerUseCase {
  constructor(private readonly userService: UserService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string
  ): Promise<ViewUserPhoneResponse | null> {
    const sensitiveData =
      await this.userService.getUserSensitiveDataDecrypted(userId);

    if (!sensitiveData) {
      throw new Error(t('user_not_found'));
    }

    return {
      phone: sensitiveData.phone,
    };
  }
}

