import { injectable } from 'tsyringe';
import { AccountService } from '@core/services/account.service';
import { IAccountBasic } from '@core/common/interfaces/IAccountBasic';

@injectable()
export class AccountMasterAccessibleListerUseCase {
  constructor(private readonly accountService: AccountService) {}

  async execute(excludeAccountId: string): Promise<IAccountBasic[]> {
    return this.accountService.listMasterAccessibleAccounts(excludeAccountId);
  }
}
