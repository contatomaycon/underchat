import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';

@injectable()
export class UserDeleterUseCase {
  constructor(private readonly userService: UserService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string,
    accountId: string,
    isAdministrator: boolean
  ): Promise<boolean> {
    const existsUserById = await this.userService.existsUserById(
      userId,
      accountId,
      isAdministrator
    );

    if (!existsUserById) {
      throw new Error(t('user_not_found'));
    }

    const deleteUserById = await this.userService.deleteUserById(
      userId,
      accountId,
      isAdministrator
    );

    if (!deleteUserById) {
      throw new Error(t('user_deleter_error'));
    }

    return true;
  }
}
