import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { ViewUserResponse } from '@core/schema/user/viewUser/response.schema';

@injectable()
export class UserViewerUseCase {
  constructor(private readonly userService: UserService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string,
    accountId: string,
    isAdministrator: boolean
  ): Promise<ViewUserResponse | null> {
    const existsUserById = await this.userService.existsUserById(
      userId,
      accountId,
      isAdministrator
    );

    if (!existsUserById) {
      throw new Error(t('user_not_found'));
    }

    return this.userService.viewUserById(userId, accountId, isAdministrator);
  }
}
