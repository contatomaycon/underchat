import { injectable, inject } from 'tsyringe';
import { AccountService } from '@core/services/account.service';
import { IAccountBasic } from '@core/common/interfaces/IAccountBasic';

@injectable()
export class AccountAllListerUseCase {
  constructor(
    @inject(AccountService)
    private readonly accountService: AccountService
  ) {}

  async execute(): Promise<IAccountBasic[]> {
    return this.accountService.listAllAccounts();
  }
}
