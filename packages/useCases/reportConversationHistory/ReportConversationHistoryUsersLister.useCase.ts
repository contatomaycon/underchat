import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { UserService } from '@core/services/user.service';
import { ListReportConversationHistoryUsersResponse } from '@core/schema/reportConversationHistory/listReportConversationHistoryUsers/response.schema';

@injectable()
export class ReportConversationHistoryUsersListerUseCase {
  constructor(
    @inject(UserService)
    private readonly userService: UserService,
    @inject(AccountService)
    private readonly accountService: AccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<ListReportConversationHistoryUsersResponse> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const results = await this.userService.listAllUsers(accountId);

    const users = results.map((user) => ({
      user_id: user.user_id,
      first_name: user.first_name,
      last_name: user.last_name,
    }));

    return {
      users,
    };
  }
}
