import { injectable, inject } from 'tsyringe';
import { AccountService } from '@core/services/account.service';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';

@injectable()
export class AccountUnblockerUseCase {
  constructor(
    @inject(AccountService)
    private readonly accountService: AccountService
  ) {}

  async execute(accountId: string): Promise<boolean> {
    return this.accountService.updateAccountStatusById(
      accountId,
      EAccountStatus.active
    );
  }
}
