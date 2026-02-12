import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { UserService } from '@core/services/user.service';
import { ListAllUsersResponse } from '@core/schema/user/listAllUsers/response.schema';

@injectable()
export class UserListerAllUseCase {
  constructor(
    @inject(UserService)
    private readonly userService: UserService,
    @inject(AccountService)
    private readonly accountService: AccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<ListAllUsersResponse[]> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const results = await this.userService.listAllUsers(accountId);

    return results;
  }
}
