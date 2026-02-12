import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { ListAccountSubscriptionsResponse } from '@core/schema/account/listAccountSubscriptions/response.schema';

@injectable()
export class AccountSubscriptionsListerUseCase {
  constructor(
    @inject(AccountService)
    private readonly accountService: AccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<ListAccountSubscriptionsResponse | null> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const subscriptions =
      await this.accountService.listAccountSubscriptions(accountId);

    if (!subscriptions) {
      throw new Error(t('account_subscriptions_not_found'));
    }

    return subscriptions;
  }
}
