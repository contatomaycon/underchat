import { injectable } from 'tsyringe';
import { AccountService } from '@core/services/account.service';
import { ListUserAccountsResponse } from '@core/schema/user/listUserAccounts/response.schema';

@injectable()
export class UserAccountsListerUseCase {
  constructor(private readonly accountService: AccountService) {}

  async execute(): Promise<ListUserAccountsResponse> {
    const accounts = await this.accountService.listAllAccounts();

    return accounts.map((acc) => ({
      account_id: acc.account_id,
      name: acc.name,
    }));
  }
}
