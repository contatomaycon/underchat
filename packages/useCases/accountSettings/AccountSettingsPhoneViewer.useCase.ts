import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { ViewPhoneResponse } from '@core/schema/accountSettings/viewPhone/response.schema';

@injectable()
export class AccountSettingsPhoneViewerUseCase {
  constructor(
    @inject(UserService)
    private readonly userService: UserService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string
  ): Promise<ViewPhoneResponse | null> {
    const rawData = await this.userService.getUserSensitiveDataRaw(userId);

    if (!rawData) {
      throw new Error(t('user_not_found'));
    }

    const phone = this.userService.getUserPhoneDecrypted(rawData.phone);

    return {
      phone,
    };
  }
}
