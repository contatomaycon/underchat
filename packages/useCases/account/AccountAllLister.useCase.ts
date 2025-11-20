import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { IAccountBasic } from '@core/common/interfaces/IAccountBasic';

@injectable()
export class AccountAllListerUseCase {
  constructor(private readonly accountService: AccountService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    isAdministrator: boolean
  ): Promise<IAccountBasic[]> {
    if (!isAdministrator) {
      throw new Error(t('is_not_administrator'));
    }

    return this.accountService.listAllAccounts();
  }
}
