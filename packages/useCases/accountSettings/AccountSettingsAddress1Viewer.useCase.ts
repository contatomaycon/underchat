import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { ViewAddress1Response } from '@core/schema/accountSettings/viewAddress1/response.schema';

@injectable()
export class AccountSettingsAddress1ViewerUseCase {
  constructor(private readonly userService: UserService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string
  ): Promise<ViewAddress1Response | null> {
    const rawData = await this.userService.getUserSensitiveDataRaw(userId);

    if (!rawData) {
      throw new Error(t('user_not_found'));
    }

    const address1 = this.userService.getUserAddress1Decrypted(
      rawData.address1
    );

    return {
      address1,
    };
  }
}
