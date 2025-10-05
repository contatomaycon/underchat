import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { setPaginationData } from '@core/common/functions/createPaginationData';
import { ListUserRequest } from '@core/schema/user/listUser/request.schema';
import { AccountService } from '@core/services/account.service';
import { UserService } from '@core/services/user.service';
import { ListUserFinalResponse } from '@core/schema/user/listUser/response.schema';

@injectable()
export class UserListerUseCase {
  constructor(
    private readonly userService: UserService,
    private readonly accountService: AccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    query: ListUserRequest,
    accountId: string,
    isAdministrator: boolean
  ): Promise<ListUserFinalResponse> {
    const perPage = query.per_page ?? 10;
    const currentPage = query.current_page ?? 1;

    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const [results, total] = await this.userService.listUsers(
      perPage,
      currentPage,
      query,
      accountId,
      isAdministrator
    );

    const pagings = setPaginationData(
      results.length,
      total,
      perPage,
      currentPage
    );

    return {
      pagings,
      results,
    };
  }
}
