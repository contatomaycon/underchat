import { injectable } from 'tsyringe';
import { AccountService } from '@core/services/account.service';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';

@injectable()
export class AccountBlockerUseCase {
  constructor(private readonly accountService: AccountService) {}

  async execute(accountId: string): Promise<boolean> {
    return this.accountService.updateAccountStatusById(
      accountId,
      EAccountStatus.blocked
    );
  }
}
