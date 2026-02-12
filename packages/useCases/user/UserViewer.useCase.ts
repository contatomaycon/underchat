import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { UserService } from '@core/services/user.service';
import { ViewUserResponse } from '@core/schema/user/viewUser/response.schema';

@injectable()
export class UserViewerUseCase {
  constructor(
    @inject(UserService)
    private readonly userService: UserService
  ) {}

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
  ): Promise<string> {
    const userAccountId = await this.userService.getUserAccountId(userId);

    if (!userAccountId) {
      throw new Error(t('user_not_found'));
    }

    return userAccountId;
  }

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string,
    accountId: string,
    canOperateOnOthers: boolean
  ): Promise<ViewUserResponse | null> {
    if (!canOperateOnOthers) {
      await this.validateUserExistsInAccount(t, userId, accountId);

      return this.userService.viewUserById(userId, accountId);
    }

    const userAccountId = await this.validateUserExists(t, userId);
    return this.userService.viewUserById(userId, userAccountId);
  }
}
