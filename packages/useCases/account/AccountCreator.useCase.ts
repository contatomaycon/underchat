import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { CreateAccountRequest } from '@core/schema/account/createAccount/request.schema';

@injectable()
export class AccountCreatorUseCase {
  constructor(private readonly accountService: AccountService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateAccountRequest
  ): Promise<boolean> {
    if (input.name.length >= 10) {
      throw new Error(t('account_name_cannot_exceed_10_characters'));
    }

    if (input.plan && !input.plan.billing_period) {
      throw new Error(t('billing_period_required_when_plan_selected'));
    }

    const accountId =
      await this.accountService.createAccountWithPlanAndApiKey(input);

    if (!accountId) {
      throw new Error(t('account_creation_failed'));
    }

    return true;
  }
}
