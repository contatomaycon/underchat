import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';

@injectable()
export class AccountAllListerUseCase {
  constructor(private readonly accountService: AccountService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    isAdministrator: boolean
  ): Promise<{ account_id: string; name: string }[]> {
    if (!isAdministrator) {
      throw new Error(t('is_not_administrator'));
    }

    return this.accountService.listAllAccounts();
  }
}

