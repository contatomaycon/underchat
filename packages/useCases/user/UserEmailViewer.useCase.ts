import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { ViewUserEmailResponse } from '@core/schema/user/viewUserEmail/response.schema';

@injectable()
export class UserEmailViewerUseCase {
  constructor(
    @inject(UserService)
    private readonly userService: UserService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string
  ): Promise<ViewUserEmailResponse | null> {
    const sensitiveData =
      await this.userService.getUserSensitiveDataDecrypted(userId);

    if (!sensitiveData) {
      throw new Error(t('user_not_found'));
    }

    return {
      email: sensitiveData.email,
    };
  }
}
