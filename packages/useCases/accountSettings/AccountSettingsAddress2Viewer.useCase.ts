import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { ViewAddress2Response } from '@core/schema/accountSettings/viewAddress2/response.schema';

@injectable()
export class AccountSettingsAddress2ViewerUseCase {
  constructor(
    @inject(UserService)
    private readonly userService: UserService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string
  ): Promise<ViewAddress2Response | null> {
    const rawData = await this.userService.getUserSensitiveDataRaw(userId);

    if (!rawData) {
      throw new Error(t('user_not_found'));
    }

    const address2 = this.userService.getUserAddress2Decrypted(
      rawData.address2
    );

    return {
      address2,
    };
  }
}
