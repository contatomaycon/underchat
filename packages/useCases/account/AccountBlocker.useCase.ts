import { injectable, inject } from 'tsyringe';
import { AccountService } from '@core/services/account.service';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';

@injectable()
export class AccountBlockerUseCase {
  constructor(
    @inject(AccountService)
    private readonly accountService: AccountService
  ) {}

  async execute(accountId: string): Promise<boolean> {
    const result = await this.accountService.updateAccountStatusById(
      accountId,
      EAccountStatus.blocked
    );

    if (result) {
      await this.accountService.clearAllAccountSessions(accountId);
    }

    return result;
  }
}
