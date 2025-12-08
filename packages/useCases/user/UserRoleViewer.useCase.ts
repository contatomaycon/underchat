import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';

@injectable()
export class UserRoleViewerUseCase {
  constructor(private readonly userService: UserService) {}

  private async validateUserExistsInAccount(
    t: TFunction<'translation', undefined>,
    userId: string,
    accountId: string
  ): Promise<void> {
    const existsUserById = await this.userService.existsUserById(
      userId,
      accountId
    );

    if (!existsUserById) {
      throw new Error(t('user_not_found'));
    }
  }

  private async validateUserExists(
    t: TFunction<'translation', undefined>,
    userId: string
  ): Promise<void> {
    const userAccountId = await this.userService.getUserAccountId(userId);

    if (!userAccountId) {
      throw new Error(t('user_not_found'));
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string,
    accountId: string,
    canOperateOnOthers: boolean
  ): Promise<string | null> {
    if (!canOperateOnOthers) {
      await this.validateUserExistsInAccount(t, userId, accountId);
    }

    if (canOperateOnOthers) {
      await this.validateUserExists(t, userId);
    }

    return this.userService.getUserRole(userId);
  }
}
