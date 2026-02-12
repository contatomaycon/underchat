import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { ViewAdditionalInfoResponse } from '@core/schema/accountSettings/viewAdditionalInfo/response.schema';

@injectable()
export class AccountSettingsAdditionalInfoViewerUseCase {
  constructor(
    @inject(UserService)
    private readonly userService: UserService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string
  ): Promise<ViewAdditionalInfoResponse | null> {
    const additionalInfo = await this.userService.viewAdditionalInfo(userId);

    if (!additionalInfo) {
      throw new Error(t('user_not_found'));
    }

    return additionalInfo;
  }
}
